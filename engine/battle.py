"""The Card Clash battle engine.

Ported from `testproject/tools/card_sim/card_sim.py`, whose `run_battle` was a
hand-verified mirror of the Godot `BattleManager.gd` / `AbilityHandler.gd`
rules. Two things changed in the port, both deliberate:

1. **It is interruptible.** `run_battle` played a whole battle in one call and
   asked policy callbacks for decisions. Here the battle is a generator that
   *yields* a `Prompt` and suspends until the driver supplies the answers, so a
   remote player can take as long as they like. The control flow is otherwise
   line-for-line the original, which is where all the subtle ordering lives.

2. **Seats are symmetric.** The original hardcoded the player as seat 0 in
   every ordered loop — entry abilities resolved player-first, worth a measured
   +3 to +5 win-rate points (design doc §9.2, logged there as a PvP blocker).
   `seat_order="alternate"` flips who resolves first each duel, from a
   seed-derived start. `seat_order="fixed"` restores the legacy behaviour and
   exists so `tests/test_parity.py` can prove the port against the original.

A `Prompt` carries requests for *both* seats at once when a decision is
simultaneous. The engine cannot see either answer until both arrive, which is
what makes blind picking enforceable rather than merely intended — see
`server/match.py`, which never forwards one seat's commitment to the other.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from math import ceil

from . import items as items_mod
from . import leaders as leaders_mod
from .cards import (AMBUSH, CARD_VALUE, CATALOG, ENTRY_ABILITIES, GUARDIAN,
                    MARTYR, RALLIER, RESOLVE, STEAL, VANGUARD, WARCRY, Card,
                    make_deck)
from .leaders import (CHEAP_VALUE_MAX, EARN_EXECUTE, EARN_GIANT_SLAY,
                      EARN_OWN_DEATH, EARN_OWN_DEATH_CHEAP, Leader)

# ── Decision requests ────────────────────────────────────────────────────────

PICK = "pick"                # choose a unit from your hand to field
SHOP = "shop"                # buy an item, or pass
WITHDRAW = "withdraw"        # pull the active unit back, or pass
SMITE = "smite"              # spend charges to soften the enemy, or pass
EMPOWER = "empower"          # spend charges for +power this duel, or pass
SECOND_WIND = "second_wind"  # let the dying unit stand back up, or let it fall
REVIVE = "revive"            # return the dying unit to the deck, or let it go


@dataclass
class Request:
    """One seat's pending decision."""

    kind: str
    seat: int
    options: list = field(default_factory=list)
    context: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "seat": self.seat,
                "options": self.options, "context": self.context}


@dataclass
class Prompt:
    """A set of requests that must all be answered before the battle resumes.

    More than one request means the decisions are *simultaneous and blind*.
    """

    requests: list[Request]

    @property
    def seats(self) -> list[int]:
        return [r.seat for r in self.requests]


@dataclass
class BattleResult:
    winner: int | None          # seat, or None for a true draw
    reason: str                 # "units" | "discards" | "damage" | "draw"
    duels: int
    rounds: int
    units: list[int]
    discards: list[int]
    damage: list[int]

    def to_dict(self) -> dict:
        return {"winner": self.winner, "reason": self.reason,
                "duels": self.duels, "rounds": self.rounds,
                "units": self.units, "discards": self.discards,
                "damage": self.damage}


# ── Duel prediction (shared by the AI policies and the client's advisor) ─────

def predict_duel(my_pow: int, my_sta: int, opp_pow: int, opp_sta: int,
                 my_ambush: bool = False, opp_ambush: bool = False
                 ) -> tuple[int, int, int]:
    """Returns (outcome, my_remaining_stamina, rounds).

    outcome: 1 win, 0 double-KO, -1 loss. Ignores the survive abilities
    (Guardian/Resolve) — this is the greedy approximation the tuned policies
    were measured with, not an oracle.
    """
    if my_ambush and opp_ambush:
        my_ambush = opp_ambush = False
    if my_ambush and opp_sta <= my_pow:
        return 1, my_sta, 1
    if opp_ambush and my_sta <= opp_pow:
        return -1, 0, 1
    k_kill_opp = ceil(opp_sta / my_pow) if my_pow > 0 else 10 ** 6
    k_kill_me = ceil(my_sta / opp_pow) if opp_pow > 0 else 10 ** 6
    if k_kill_opp < k_kill_me:
        return 1, my_sta - k_kill_opp * opp_pow, k_kill_opp
    if k_kill_opp > k_kill_me:
        return -1, 0, k_kill_me
    return 0, 0, k_kill_opp


# ── Side state ───────────────────────────────────────────────────────────────

class Side:
    """Everything one seat owns. `pow`/`sta` are the *fielded* unit's live
    stats; the card keeps its base stats until it leaves the field alive."""

    def __init__(self, seat: int, deck: list[Card], leader: Leader | None,
                 shop_enabled: bool) -> None:
        self.seat = seat
        self.deck = deck
        self.leader = leader
        self.idx = 0
        self.hand: list[Card] = []
        self.discards = 0
        self.active: Card | None = None
        self.pow = 0
        self.sta = 0
        self.first_unit = True
        self.ambush = False
        self.pend_pow = 0
        self.pend_sta = 0
        self.pend_shield = 0
        self.shield = 0
        self.curse_next = 0
        self.charges = leader.start_charges if leader else 0
        self.earned = 0
        self.one_shot_used = False   # second wind
        self.revives_left = leader.revive_uses if leader else 0
        self.gold = items_mod.GOLD_START if shop_enabled else 0
        self.scout_t = 0
        self.fog_t = 0
        self.peek_next = False       # Sentinel's withdraw payoff
        self.damage_dealt = 0
        self.decisions = 0

    # ── economy helpers ──
    def earn_charge(self) -> None:
        ldr = self.leader
        if ldr is None or self.earned >= ldr.earn_cap:
            return
        self.earned += 1
        self.charges = min(ldr.held_cap, self.charges + 1)

    def count_earn(self) -> bool:
        """For payoff leaders with no charge pool — just consumes the cap."""
        ldr = self.leader
        if ldr is None or self.earned >= ldr.earn_cap:
            return False
        self.earned += 1
        return True

    def remaining(self) -> int:
        return len(self.deck) - self.idx + len(self.hand)

    def live_units(self) -> int:
        """Every unit that can still affect the match, including the field."""
        return self.remaining() + int(self.active is not None)

    def draw_raw(self) -> Card:
        card = self.deck[self.idx]
        self.idx += 1
        return card

    def has_foresight(self) -> bool:
        base = bool(self.leader and self.leader.foresight)
        return base or self.scout_t > 0 or self.peek_next


def effective_entry_stats(card: Card, own_first: bool, own_discards: int
                          ) -> tuple[int, int]:
    """Stats a unit will have once its own ON_ENTRY buffs resolve — what a
    policy needs to compare candidates before committing."""
    p, s = card.pow, card.sta
    if card.ab == VANGUARD and not card.spent and own_first:
        p += 2
    if card.ab == WARCRY and not card.spent:
        stacks = own_discards // 5
        p += stacks
        s += stacks
    return p, s


def mirror_cancel(a: Card | None, b: Card | None) -> bool:
    """Two units entering with the same unspent ON_ENTRY ability cancel."""
    if a is None or b is None:
        return False
    for ab_a, spent_a, _ in a.abilities():
        if spent_a or ab_a not in ENTRY_ABILITIES:
            continue
        for ab_b, spent_b, _ in b.abilities():
            if not spent_b and ab_b == ab_a:
                return True
    return False


def _resolve_entry(side: Side, opp_card: Card | None) -> list[str]:
    """ON_ENTRY resolution for one side, in AbilityHandler's order.

    Snapshot semantics preserved: an ability stolen this duel does NOT fire
    this duel. Order matters — whichever side resolves first gets to strip the
    other's ability before it fires, which is exactly the first-seat bias that
    `seat_order="alternate"` exists to neutralise.
    """
    card = side.active
    log: list[str] = []
    assert card is not None
    for ability, spent, _slot in card.abilities():
        if spent or ability not in ENTRY_ABILITIES:
            continue
        if ability == VANGUARD:
            if side.first_unit:
                card.spend(VANGUARD)
                side.pow += 2
                log.append("vanguard")
        elif ability == WARCRY:
            stacks = side.discards // 5
            if stacks > 0:
                card.spend(WARCRY)
                side.pow += stacks
                side.sta += stacks
                log.append(f"warcry+{stacks}")
        elif ability == AMBUSH:
            card.spend(AMBUSH)
            side.ambush = True
            log.append("ambush")
        elif ability == STEAL:
            if opp_card is None:
                continue
            stolen = None
            if opp_card.ab is not None and not opp_card.spent:
                stolen = opp_card.ab
                opp_card.ab = None
            elif opp_card.ab2 is not None and not opp_card.ab2_spent:
                stolen = opp_card.ab2
                opp_card.ab2 = None
            if stolen is None:
                continue
            card.ab2 = stolen
            card.ab2_spent = False
            card.spend(STEAL)
            log.append(f"steal:{stolen}")
    return log


def _clear_stolen(card: Card | None) -> None:
    if card is not None and card.ab == STEAL:
        card.ab2 = None
        card.ab2_spent = False


# ── The battle ───────────────────────────────────────────────────────────────

class Battle:
    """Drive with `start()`, then `submit(answers)` until `result` is set.

    Both methods return the next `Prompt`, or `None` when the battle is over.
    `events` accumulates a replayable log the client renders from.
    """

    def __init__(self, decks: list[list[str]], *,
                 leader_ids: list[str | None] | None = None,
                 boss_slots: list[int | None] | None = None,
                 seed: int = 0, seat_order: str = "alternate",
                 shop: bool = True, hand_size: int = 2,
                 tiebreak: str = "damage", shuffle: bool = False,
                 tie_to_seat: int | None = None) -> None:
        if len(decks) != 2:
            raise ValueError("a battle needs exactly two decks")
        if seat_order not in ("alternate", "fixed"):
            raise ValueError(f"bad seat_order {seat_order!r}")

        self.rng = random.Random(seed)
        self.seed = seed
        self.seat_order = seat_order
        self.hand_size = hand_size
        self.tiebreak = tiebreak
        self.shop_enabled = shop
        # Who a dead-even game goes to. None = a real draw, which is the only
        # symmetric answer and so the default for PvP. The original engine had
        # a house rule awarding these to the enemy; `tests/test_parity.py`
        # sets `tie_to_seat=1` to reproduce it.
        self.tie_to_seat = tie_to_seat

        leader_ids = leader_ids or [None, None]
        boss_slots = boss_slots or [None, None]
        self.sides: list[Side] = []
        for seat in range(2):
            names = list(decks[seat])
            cards = make_deck(names)
            if shuffle:
                self.rng.shuffle(cards)
            leader = leaders_mod.get(leader_ids[seat])
            self.sides.append(Side(seat, cards, leader, shop))
        self.boss_slots = boss_slots
        # Placed at construction, not at `start()`: an illegal slot is a bad
        # deck, and a bad deck should be rejected when it is submitted rather
        # than after two players have joined a room.
        self._place_bosses()

        # Which seat resolves first on duel 1. Derived from the seed so a
        # match is reproducible, and alternated so neither seat keeps the edge.
        self._first_seat = self.rng.randrange(2) if seat_order == "alternate" \
            else 0

        self.duels = 0
        self.rounds = 0
        self.events: list[dict] = []
        self.result: BattleResult | None = None
        self._dead: list[bool] = [False, False]
        # Stable within one pass of the battle loop: `duels` increments
        # mid-duel, and the resolution order must not change under it.
        self._duel_no = 0
        self._gen = self._run()
        self._pending: Prompt | None = None
        self._primed = False

    # ── driver API ──

    def start(self) -> Prompt | None:
        if self._primed:
            raise RuntimeError("battle already started")
        return self._advance(None)

    def submit(self, answers: dict[int, object]) -> Prompt | None:
        """`answers` maps seat -> that seat's choice. Every seat the pending
        prompt asked for must be present; extras are rejected."""
        if self._pending is None:
            raise RuntimeError("no prompt is pending")
        expected = set(self._pending.seats)
        got = set(answers)
        if got != expected:
            raise ValueError(
                f"expected answers for seats {sorted(expected)}, "
                f"got {sorted(got)}")
        return self._advance(answers)

    def _advance(self, answers) -> Prompt | None:
        try:
            if self._primed:
                self._pending = self._gen.send(answers)
            else:
                self._primed = True
                self._pending = next(self._gen)
        except StopIteration:
            self._pending = None
        if self._pending is not None:
            for seat in self._pending.seats:
                self.sides[seat].decisions += 1
        return self._pending

    # ── event log ──

    def _emit(self, kind: str, **payload) -> None:
        self.events.append({"n": len(self.events), "duel": self.duels,
                            "kind": kind, **payload})

    # ── ordering ──

    def _order(self) -> list[int]:
        """Seat indices in resolution order for the current duel."""
        if self.seat_order == "fixed":
            return [0, 1]
        first = (self._first_seat + self._duel_no) % 2
        return [first, 1 - first]

    def _ordered_sides(self) -> list[tuple[Side, Side]]:
        return [(self.sides[i], self.sides[1 - i]) for i in self._order()]

    # ── the battle itself ──

    def _run(self):
        self._emit("battle_start", seed=self.seed,
                   first_seat=self._first_seat,
                   leaders=[s.leader.id if s.leader else None
                            for s in self.sides],
                   units=[s.live_units() for s in self.sides])

        while True:
            self._duel_no = self.duels
            yield from self._draw_phase()
            if any(s.active is None for s in self.sides):
                break

            if self.shop_enabled:
                yield from self._shop_phase()

            self.duels += 1
            for side in self.sides:
                side.ambush = False

            yield from self._tactics_phase()
            self._entry_phase()
            duel_rounds = yield from self._round_loop()
            yield from self._death_phase(duel_rounds)

            done = self._check_victory()
            if done is not None:
                self.result = done
                self._emit("battle_over", **done.to_dict())
                return

        self.result = self._exhaustion_result()
        self._emit("battle_over", **self.result.to_dict())

    # ── setup ──

    def _place_bosses(self) -> None:
        """Swap the boss into its chosen slot, replacing the card there.

        The boss occupies a deck slot rather than extending the deck, so
        fielding it costs a unit. §11.1 restricts placement to the first
        `BOSS_MAX_SLOT` positions so the signature unit arrives early enough
        to shape a normal match rather than becoming a final-slot non-choice.
        """
        from .cards import BOSS_MAX_SLOT, BOSS_NAME
        for seat, slot in enumerate(self.boss_slots):
            if slot is None:
                continue
            if not 0 <= slot < min(BOSS_MAX_SLOT, len(self.sides[seat].deck)):
                raise ValueError(
                    f"boss slot {slot} out of range 0..{BOSS_MAX_SLOT - 1}")
            self.sides[seat].deck[slot] = Card(BOSS_NAME)

    # ── draw ──

    def _foresight_flags(self) -> list[bool]:
        """Who actually sees the incoming pick this duel.

        Two cancellations apply: §10.4's information mirror rule (matching
        foresight blinds both, measured at 32-33% for the first seat when it
        did not) and the Fog item.
        """
        raw = [s.has_foresight() for s in self.sides]
        if raw[0] and raw[1]:
            return [False, False]
        return [raw[seat] and self.sides[1 - seat].fog_t <= 0
                for seat in range(2)]

    def _draw_phase(self):
        """Both seats field a unit.

        Blind by default: a standing carryover is visible, a unit being chosen
        in this same phase is not. Without that rule the second picker
        counter-picks with perfect information and skilled mirrors collapse —
        the original measured 2.6% for the first picker.

        The original enforced this with a pre-draw snapshot, because it asked
        its two policies one after another. Here blindness is *structural*: a
        blind seat is only ever asked inside a batched prompt whose answers all
        arrive together, so nothing can have been fielded in between. The
        snapshot is kept as a second line of defence and asserted against the
        live board below, so a future refactor back to sequential prompting
        trips here rather than silently leaking a commitment.
        """
        pre = [(s.active, s.pow, s.sta) for s in self.sides]
        sight = self._foresight_flags()

        needs = [seat for seat in self._order()
                 if self.sides[seat].active is None]
        if not needs:
            return

        # A foresight seat is the one sanctioned break of blindness: the other
        # seat commits first and the foresight seat then picks against a live
        # board. With no foresight (or a cancelled mirror) both commit at once.
        groups: list[list[int]]
        if len(needs) == 2 and sight[needs[0]] != sight[needs[1]]:
            blind_first = [s for s in needs if not sight[s]]
            seeing = [s for s in needs if sight[s]]
            groups = [blind_first, seeing]
        else:
            groups = [needs]

        for group in groups:
            requests: list[Request] = []
            auto: dict[int, int] = {}
            for seat in group:
                side = self.sides[seat]
                while (len(side.hand) < self.hand_size
                       and side.idx < len(side.deck)):
                    side.hand.append(side.draw_raw())
                if not side.hand:
                    continue
                if len(side.hand) == 1:
                    auto[seat] = 0
                    continue
                opp = self.sides[1 - seat]
                if sight[seat]:
                    opp_card, opp_pow, opp_sta = opp.active, opp.pow, opp.sta
                else:
                    opp_card, opp_pow, opp_sta = pre[1 - seat]
                    if (opp.active, opp.pow, opp.sta) != pre[1 - seat]:
                        raise AssertionError(
                            "a blind seat was asked after the opponent had "
                            "already fielded — picks are no longer "
                            "simultaneous and the blind-pick rule is broken")
                requests.append(Request(
                    kind=PICK, seat=seat,
                    options=[c.to_dict() for c in side.hand],
                    context={
                        "enemy": opp_card.to_dict() if opp_card else None,
                        "enemy_power": opp_pow if opp_card else 0,
                        "enemy_stamina": opp_sta if opp_card else 0,
                        "foresight": sight[seat],
                        "own_first": side.first_unit,
                        "own_discards": side.discards,
                        "duel": self.duels,
                    }))
            answers: dict[int, int] = dict(auto)
            if requests:
                got = yield Prompt(requests)
                for seat in got:
                    answers[seat] = self._validate_index(
                        got[seat], len(self.sides[seat].hand), "pick")
            for seat in group:
                if seat not in answers:
                    continue
                self._field(self.sides[seat], answers[seat])

    def _field(self, side: Side, hand_index: int) -> None:
        card = side.hand.pop(hand_index)
        side.active = card
        side.pow = card.pow + side.pend_pow
        side.sta = card.sta + side.pend_sta
        side.pend_pow = 0
        side.pend_sta = 0
        side.shield = side.pend_shield
        side.pend_shield = 0
        if side.curse_next > 0:
            side.sta = max(1, side.sta - side.curse_next)
            self._emit("cursed", seat=side.seat, amount=side.curse_next)
            side.curse_next = 0
        side.peek_next = False
        self._emit("field", seat=side.seat, card=card.to_dict(),
                   power=side.pow, stamina=side.sta, shield=side.shield)

    # ── shop ──

    def _shop_phase(self):
        requests = []
        for seat in self._order():
            side = self.sides[seat]
            if side.gold < items_mod.SHOP_MIN_GOLD:
                continue
            offer = items_mod.affordable(side.gold)
            if not offer:
                continue
            requests.append(Request(
                kind=SHOP, seat=seat, options=offer,
                context={"gold": side.gold, "units": side.live_units(),
                         "enemy_units": self.sides[1 - seat].live_units(),
                         "scout_turns": side.scout_t,
                         "fog_turns": side.fog_t}))
        if requests:
            answers = yield Prompt(requests)
            for seat in self._order():
                if seat not in answers:
                    continue
                self._buy(self.sides[seat], answers[seat])

        for side in self.sides:
            if side.scout_t > 0:
                side.scout_t -= 1
            if side.fog_t > 0:
                side.fog_t -= 1

    def _buy(self, side: Side, item_id) -> None:
        if item_id is None:
            return
        item = items_mod.CATALOG.get(item_id)
        if item is None or item.cost > side.gold:
            return
        opp = self.sides[1 - side.seat]
        side.gold -= item.cost
        if item.id == "curse":
            opp.curse_next += items_mod.CURSE_WOUND
        elif item.id == "ward":
            side.pend_shield += items_mod.WARD_SHIELD
            if side.active is not None:
                side.shield += items_mod.WARD_SHIELD
                side.pend_shield -= items_mod.WARD_SHIELD
        elif item.id == "scout":
            side.scout_t = max(side.scout_t, items_mod.SCOUT_DURATION)
        elif item.id == "fog":
            side.fog_t = max(side.fog_t, items_mod.FOG_DURATION)
        self._emit("buy", seat=side.seat, item=item.id, gold=side.gold)

    # ── leader actives ──

    def _tactics_phase(self):
        """Leader actives — simultaneous and blind, like the picks.

        Asking one seat and then the other would hand the second a free read on
        the first's spend: measured, an Oracle mirror collapsed to 6.7% for the
        seat that had to act first. Both decisions are computed against the
        same pre-tactics snapshot and applied together.
        """
        snapshot = [(s.pow, s.sta) for s in self.sides]
        requests: list[Request] = []

        for seat in self._order():
            side = self.sides[seat]
            ldr = side.leader
            if ldr is None or ldr.active is None or side.charges < ldr.cost:
                continue
            opp_pow, opp_sta = snapshot[1 - seat]
            base = {"charges": side.charges, "cost": ldr.cost,
                    "value": ldr.value, "power": side.pow,
                    "stamina": side.sta, "enemy_power": opp_pow,
                    "enemy_stamina": opp_sta}
            if ldr.active == "withdraw":
                if not side.hand:
                    continue
                requests.append(Request(
                    kind=WITHDRAW, seat=seat,
                    options=[c.to_dict() for c in side.hand],
                    context={**base, "active": side.active.to_dict(),
                             "peek": ldr.withdraw_peek}))
            elif ldr.active == "smite":
                requests.append(Request(kind=SMITE, seat=seat,
                                        options=[True, False], context=base))
            elif ldr.active == "pow":
                requests.append(Request(kind=EMPOWER, seat=seat,
                                        options=[True, False], context=base))

        if not requests:
            return
        answers = yield Prompt(requests)

        for seat in self._order():
            if seat not in answers:
                continue
            side = self.sides[seat]
            opp = self.sides[1 - seat]
            ldr = side.leader
            assert ldr is not None
            choice = answers[seat]

            if ldr.active == "withdraw":
                if choice is None:
                    continue
                index = self._validate_index(choice, len(side.hand),
                                             "withdraw")
                side.charges -= ldr.cost
                old = side.active
                assert old is not None
                old.pow = side.pow
                old.sta = side.sta
                new_card = side.hand.pop(index)
                side.hand.append(old)
                side.active = new_card
                side.pow = new_card.pow
                side.sta = new_card.sta
                if ldr.withdraw_peek:
                    side.peek_next = True
                self._emit("withdraw", seat=seat, card=new_card.to_dict(),
                           charges=side.charges)
            elif ldr.active == "smite" and choice:
                side.charges -= ldr.cost
                opp.sta = max(1, opp.sta - ldr.value)
                self._emit("smite", seat=seat, amount=ldr.value,
                           enemy_stamina=opp.sta)
            elif ldr.active == "pow" and choice:
                side.charges -= ldr.cost
                side.pow += ldr.value
                self._emit("empower", seat=seat, amount=ldr.value,
                           power=side.pow)

    # ── entry ──

    def _entry_phase(self) -> None:
        a, b = self.sides
        if mirror_cancel(a.active, b.active):
            # Engine quirk preserved from BattleManager: on a mirror cancel the
            # whole entry phase is skipped and the first-unit flags are NOT
            # cleared, so a Vanguard still counts as first next duel.
            self._emit("mirror_cancel")
            return
        for side, opp in self._ordered_sides():
            fired = _resolve_entry(side, opp.active)
            if fired:
                self._emit("entry", seat=side.seat, fired=fired,
                           power=side.pow, stamina=side.sta)
        if all(s.ambush for s in self.sides):
            for s in self.sides:
                s.ambush = False
        for s in self.sides:
            s.first_unit = False

    # ── rounds ──

    def _hit(self, side: Side, amount: int) -> int:
        if side.shield > 0:
            absorbed = min(side.shield, amount)
            side.shield -= absorbed
            amount -= absorbed
        side.sta -= amount
        return amount

    def _round_loop(self):
        a, b = self.sides
        duel_rounds = 0
        while True:
            self.rounds += 1
            duel_rounds += 1
            pre = [a.sta, b.sta]

            if a.ambush:
                self._hit(b, a.pow)
                if b.sta > 0:
                    self._hit(a, b.pow)
                a.ambush = False
            elif b.ambush:
                self._hit(a, b.pow)
                if a.sta > 0:
                    self._hit(b, a.pow)
                b.ambush = False
            else:
                self._hit(a, b.pow)
                self._hit(b, a.pow)

            a.damage_dealt += pre[1] - b.sta
            b.damage_dealt += pre[0] - a.sta

            dead = [s.sta <= 0 for s in self.sides]
            if not any(dead):
                continue

            dead = yield from self._survive_phase(dead)
            if not any(dead):
                continue
            self._dead = dead
            return duel_rounds

    def _survive_phase(self, dead: list[bool]):
        """Guardian, then Resolve, then the leader one-shot.

        Resolve only fires when *both* units would die, so with a Duelist on
        each side exactly one of them lives — and whoever is checked first is
        the one who does. In a true mirror that single race decided the whole
        battle, which is why this walks `_order()` rather than seat 0 first.
        """
        for seat in self._order():
            if not dead[seat]:
                continue
            side = self.sides[seat]
            card = side.active
            assert card is not None
            if card.has_unspent(GUARDIAN):
                card.spend(GUARDIAN)
                side.sta = 1
                dead[seat] = False
                self._emit("survive", seat=seat, via="guardian")
            elif dead[1 - seat] and card.has_unspent(RESOLVE):
                card.spend(RESOLVE)
                side.sta = 1
                dead[seat] = False
                self._emit("survive", seat=seat, via="resolve")

        requests = []
        for seat in self._order():
            if not dead[seat]:
                continue
            side = self.sides[seat]
            ldr = side.leader
            if ldr is None or not ldr.second_wind or side.one_shot_used:
                continue
            assert side.active is not None
            requests.append(Request(
                kind=SECOND_WIND, seat=seat, options=[True, False],
                context={"card": side.active.to_dict(),
                         "strips_ability": ldr.sw_strip}))
        if requests:
            answers = yield Prompt(requests)
            for seat in self._order():
                if not answers.get(seat):
                    continue
                side = self.sides[seat]
                ldr = side.leader
                assert ldr is not None
                side.one_shot_used = True
                side.sta = 1
                dead[seat] = False
                if ldr.sw_strip and side.active is not None:
                    side.active.strip_abilities()
                self._emit("survive", seat=seat, via="second_wind")
        return dead

    # ── deaths, payoffs, carryover ──

    def _death_phase(self, duel_rounds: int):
        dead = self._dead
        both_dead = all(dead)
        dead_base_pow = 0

        # Gravekeeper's choice is asked for both seats at once for the same
        # reason the picks are: a double-KO must not tell one seat what the
        # other did with its corpse before it decides.
        revive_requests = []
        for seat in self._order():
            if not dead[seat]:
                continue
            side = self.sides[seat]
            ldr = side.leader
            if ldr is not None and side.revives_left > 0:
                assert side.active is not None
                revive_requests.append(Request(
                    kind=REVIVE, seat=seat, options=[True, False],
                    context={"card": side.active.to_dict()}))
        revive_answers = {}
        if revive_requests:
            revive_answers = yield Prompt(revive_requests)

        for seat in self._order():
            if not dead[seat]:
                continue
            side = self.sides[seat]
            corpse = side.active
            assert corpse is not None
            dead_base_pow = max(dead_base_pow, CATALOG[corpse.name].power)
            ldr = side.leader

            if revive_answers.get(seat):
                side.revives_left -= 1
                side.active = None
                corpse.reset_to_base()
                if ldr.revive_to == "hand":
                    side.hand.append(corpse)
                else:
                    side.deck.append(corpse)
                if ldr.revive_discards:
                    # The unit still fell; only its card comes back. Without
                    # this the leader banks a discard *and* a card, which is a
                    # double dip on the fewest-discards tiebreak.
                    side.discards += 1
                self._emit("revived", seat=seat, card=corpse.name,
                           to=ldr.revive_to, discards=side.discards)
                continue

            side.active = None
            side.discards += 1
            for ability, spent, _slot in corpse.abilities():
                if ability == MARTYR and not spent and side.remaining() > 0:
                    side.pend_pow += 2
                    self._emit("martyr", seat=seat)
            _clear_stolen(corpse)
            self._emit("died", seat=seat, card=corpse.name,
                       discards=side.discards)

            if ldr is not None:
                if ldr.earn_on == EARN_OWN_DEATH or (
                        ldr.earn_on == EARN_OWN_DEATH_CHEAP
                        and CARD_VALUE[corpse.name] <= CHEAP_VALUE_MAX):
                    side.earn_charge()
                    if ldr.auto_cost and side.charges >= ldr.auto_cost:
                        side.charges -= ldr.auto_cost
                        side.pend_pow += ldr.auto_pend_pow
                        side.pend_sta += ldr.auto_pend_sta
                        self._emit("ritual", seat=seat)
                if both_dead and ldr.dko_pend_pow and side.count_earn():
                    side.pend_pow += ldr.dko_pend_pow
                    side.pend_sta += ldr.dko_pend_sta
                    self._emit("doom", seat=seat)

        if not both_dead and any(dead):
            self._resolve_winner(dead, duel_rounds, dead_base_pow)

    def _resolve_winner(self, dead: list[bool], duel_rounds: int,
                        dead_base_pow: int) -> None:
        loser_seat = 0 if dead[0] else 1
        winner = self.sides[1 - loser_seat]

        if self.shop_enabled:
            winner.gold += items_mod.GOLD_PER_WIN
            self._emit("gold", seat=winner.seat, gold=winner.gold,
                       via="duel_win")

        wcard = winner.active
        assert wcard is not None
        for ability, spent, _slot in wcard.abilities():
            if ability == RALLIER and not spent and winner.remaining() > 0:
                wcard.spend(RALLIER)
                winner.pend_sta += 1
                self._emit("rallier", seat=winner.seat)
        _clear_stolen(wcard)

        ldr = winner.leader
        if ldr is None:
            return
        if (ldr.win_pend_pow and self.duels <= ldr.win_window
                and winner.count_earn()):
            winner.pend_pow += ldr.win_pend_pow
            self._emit("blitz", seat=winner.seat)
        if ldr.earn_on == EARN_EXECUTE and duel_rounds == 1:
            winner.earn_charge()
            self._emit("charge", seat=winner.seat, charges=winner.charges,
                       via="execute")
        elif (ldr.earn_on == EARN_GIANT_SLAY
                and CATALOG[wcard.name].power < dead_base_pow):
            winner.earn_charge()
            self._emit("charge", seat=winner.seat, charges=winner.charges,
                       via="giant_slay")
        if (ldr.heal_on == EARN_GIANT_SLAY
                and CATALOG[wcard.name].power < dead_base_pow):
            base_sta = CATALOG[wcard.name].stamina
            if ldr.heal_value > 0:
                winner.sta = min(base_sta, winner.sta + ldr.heal_value)
            else:
                winner.sta = max(winner.sta, base_sta)
            winner.earned += 1
            self._emit("heal", seat=winner.seat, stamina=winner.sta)

    # ── victory ──

    def _check_victory(self) -> BattleResult | None:
        alive = [s.live_units() > 0 for s in self.sides]
        if all(alive):
            return None
        if not any(alive):
            return self._exhaustion_result()
        return self._make_result(0 if alive[0] else 1, "units")

    def _exhaustion_result(self) -> BattleResult:
        """Both decks spent. Fewest discards wins; then damage dealt."""
        alive = [s.live_units() > 0 for s in self.sides]
        if alive[0] != alive[1]:
            return self._make_result(0 if alive[0] else 1, "units")
        discards = [s.discards for s in self.sides]
        if discards[0] != discards[1]:
            return self._make_result(
                0 if discards[0] < discards[1] else 1, "discards")
        if self.tiebreak == "damage":
            dealt = [s.damage_dealt for s in self.sides]
            if dealt[0] != dealt[1]:
                return self._make_result(
                    0 if dealt[0] > dealt[1] else 1, "damage")
        return self._make_result(self.tie_to_seat, "draw")

    def _make_result(self, winner: int | None, reason: str) -> BattleResult:
        return BattleResult(
            winner=winner, reason=reason, duels=self.duels,
            rounds=self.rounds, units=[s.live_units() for s in self.sides],
            discards=[s.discards for s in self.sides],
            damage=[s.damage_dealt for s in self.sides])

    # ── helpers ──

    @staticmethod
    def _validate_index(value, length: int, what: str) -> int:
        if not isinstance(value, int) or isinstance(value, bool):
            raise ValueError(f"{what} choice must be an integer, got {value!r}")
        if not 0 <= value < length:
            raise ValueError(f"{what} choice {value} out of range 0..{length-1}")
        return value

    # ── public views ──

    def public_state(self, seat: int) -> dict:
        """What one seat is allowed to see. Never leaks the opponent's hand,
        deck order, or an uncommitted pick."""
        me = self.sides[seat]
        them = self.sides[1 - seat]
        return {
            "duel": self.duels,
            "seat": seat,
            "you": self._side_view(me, own=True),
            "them": self._side_view(them, own=False),
            "result": self.result.to_dict() if self.result else None,
        }

    def _side_view(self, side: Side, own: bool) -> dict:
        view = {
            "seat": side.seat,
            "leader": side.leader.id if side.leader else None,
            "gold": side.gold if own else None,
            "charges": side.charges,
            "discards": side.discards,
            "remaining": side.remaining(),
            "units": side.live_units(),
            "damage_dealt": side.damage_dealt,
            "shield": side.shield,
            "active": side.active.to_dict() if side.active else None,
            "power": side.pow,
            "stamina": side.sta,
            "scout_turns": side.scout_t if own else None,
            "fog_turns": side.fog_t,
        }
        if own:
            view["hand"] = [c.to_dict() for c in side.hand]
        return view
