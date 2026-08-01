"""The leader roster.

Ported from the sim-validated design in `CARD_CLASH_SKILL_EXPRESSION.md` §10.1
(the tuned 10-leader genre roster), with §10.2's three flagged dials applied:

  * Second Wind was +7 over centre. Flat power penalties measured useless as a
    nerf dial, so the survivor now comes back with its ABILITIES STRIPPED.
  * Reaper was +6 over centre. Smite cost raised 2 -> 3.
  * Sentinel was -8 under centre (Withdraw's value ceiling), so spending a
    Withdraw now also grants a peek at the next pick.

Design laws these obey, from the same document:
  * §7.1 the scarcity law — an earn condition only bends play if standard play
    cannot saturate it. Giant-slays and cheap deaths are scarce; executes are
    not, which is why no leader here earns on plain executes without a cap.
  * §10.3 +1 STA is worth far more than +1 PWR in a pending payoff, because a
    buffed unit that wins keeps the buff while it keeps fighting.
"""

from __future__ import annotations

from dataclasses import dataclass, field

#: Earn conditions a leader may hook.
EARN_EXECUTE = "execute"            # won a duel in a single round
EARN_GIANT_SLAY = "giant_slay"      # killed a higher-base-power enemy
EARN_OWN_DEATH = "own_death"
EARN_OWN_DEATH_CHEAP = "own_death_cheap"   # base value <= 9


@dataclass(frozen=True)
class Leader:
    """One leader. Every field is a dial the battle engine reads directly.

    A leader is `earn condition -> bounded charge pool -> active with a cost`
    (§7.2), or a pure passive. Anything not used by a given leader stays at its
    zero default, so adding a leader is a data edit here and nothing else.
    """

    id: str
    name: str
    genre: str
    blurb: str

    # Economy
    earn_on: str | None = None
    held_cap: int = 0            # charges you may hold at once
    earn_cap: int = 0            # charges the leader may generate all battle
    start_charges: int = 0
    active: str | None = None    # "pow" | "smite" | "withdraw"
    cost: int = 1
    value: int = 0

    # Automatic payoffs
    heal_on: str | None = None
    heal_value: int = 0          # 0 = heal to full base stamina
    win_pend_pow: int = 0        # early-win aggro payoff
    win_window: int = 0
    dko_pend_pow: int = 0        # double-KO payoffs
    dko_pend_sta: int = 0
    auto_cost: int = 0           # charges auto-spent when the pool fills
    auto_pend_pow: int = 0
    auto_pend_sta: int = 0

    # One-shots and pure passives
    second_wind: bool = False    # first dying unit survives at 1
    sw_strip: bool = False       # ...with its abilities stripped
    revive_uses: int = 0         # dying units you may return to the deck
    revive_to: str = "deck"      # "deck" (bottom) | "hand" (re-fieldable now)
    revive_discards: bool = True  # does a revived unit still count as a loss?
    foresight: bool = False      # see the enemy's incoming pick
    withdraw_peek: bool = False  # spending a Withdraw grants a peek

    #: Player-facing names for the actives. The engine's identifiers are not
    #: shown to anyone — "1 charges -> withdraw" is not a sentence.
    _ACTIVE_LABELS = {
        "withdraw": "Withdraw",
        "smite": "Soften the enemy",
        "pow": "+{value} power",
    }

    def payoff_tags(self) -> list[str]:
        """Short labels the client shows on the leader card."""
        tags: list[str] = []
        if self.foresight:
            tags.append("Sees the enemy's pick")
        if self.second_wind:
            tags.append("Survives once")
        if self.revive_uses:
            tags.append(f"Recovers {self.revive_uses} fallen")
        if self.active:
            label = self._ACTIVE_LABELS.get(self.active, self.active)
            cost = f"{self.cost} charge" + ("s" if self.cost != 1 else "")
            tags.append(f"{label.format(value=self.value)} for {cost}")
        if self.heal_on:
            tags.append(f"Heals {self.heal_value} on a giant-slay")
        if self.win_pend_pow:
            tags.append(f"+{self.win_pend_pow} power after an early win")
        if self.dko_pend_pow:
            tags.append("Pays off on a trade")
        if self.auto_cost:
            tags.append(f"+{self.auto_pend_pow} power every "
                        f"{self.auto_cost} cheap losses")
        return tags


def _leader(**kwargs) -> Leader:
    return Leader(**kwargs)


ROSTER: dict[str, Leader] = {
    "second_wind": _leader(
        id="second_wind", name="Second Wind", genre="Survival",
        blurb="The first of your units to fall stands back up at 1 stamina — "
              "but comes back hollow, its ability spent.",
        second_wind=True, sw_strip=True),

    "momentum": _leader(
        id="momentum", name="Momentum", genre="Sustain",
        blurb="When one of your units kills something stronger than itself, "
              "it recovers 4 stamina.",
        # §10.1 specced 3, which measured -8.4 here. Healing to full overshot
        # to +10.3; 4 is the value in between.
        heal_on=EARN_GIANT_SLAY, heal_value=4),

    "giant_slayer": _leader(
        id="giant_slayer", name="Giant-Slayer", genre="Underdog",
        blurb="Killing a stronger unit earns a charge. Spend 2 charges for "
              "+1 power this duel.",
        earn_on=EARN_GIANT_SLAY, held_cap=3, earn_cap=6,
        active="pow", cost=2, value=1),

    "blitz": _leader(
        id="blitz", name="Blitz", genre="Aggro",
        blurb="Each duel you win in the first 10 grants your next unit "
              "+1 power. Four times a battle.",
        # §10.1 specced +2. Measured +7.8 over centre on this engine; +1 lands
        # at 49.8. Narrowing the cap instead barely moved it (56.2), so the
        # payoff size was the lever, not the count.
        win_pend_pow=1, win_window=10, earn_cap=4),

    "doomsayer": _leader(
        id="doomsayer", name="Doomsayer", genre="Destruction",
        blurb="When one of your units dies trading blow for blow, your next "
              "unit enters at +1/+1. Twice a battle.",
        dko_pend_pow=1, dko_pend_sta=1, earn_cap=2),

    "sentinel": _leader(
        id="sentinel", name="Sentinel", genre="Control",
        blurb="Your losses buy Withdraw uses: pull the active unit back and "
              "field another, and see what is coming next.",
        earn_on=EARN_OWN_DEATH, held_cap=4, earn_cap=8,
        active="withdraw", cost=1, start_charges=3, withdraw_peek=True),

    "reaper": _leader(
        id="reaper", name="Reaper", genre="Execution",
        blurb="One-round kills earn a charge. Spend 3 to soften the enemy "
              "unit by 2 stamina — never below 1.",
        # §10.2 asked for the smite cost to go 2 -> 3 as a nerf. Applied
        # literally against the doc's held_cap of 2 it made the active
        # unaffordable *forever* (measured -6.0 against the field, the
        # leader effectively passive), so the pool grew to match the price.
        earn_on=EARN_EXECUTE, held_cap=3, earn_cap=6,
        active="smite", cost=3, value=2),

    "gravekeeper": _leader(
        id="gravekeeper", name="Gravekeeper", genre="Recursion",
        blurb="Twice a battle, choose a dying unit. It returns to the bottom "
              "of your deck at full strength instead of being discarded.",
        # One use measured -9.8 against the field: a single card returned to
        # the *bottom* of a 30-card deck is worth very little that late.
        revive_uses=2),

    "oracle": _leader(
        id="oracle", name="Oracle", genre="Scout",
        blurb="You see the enemy's incoming unit before you commit — and hold "
              "one free Withdraw.",
        foresight=True, active="withdraw", cost=1, start_charges=1,
        held_cap=1, earn_cap=0),

    "ritualist": _leader(
        id="ritualist", name="Ritualist", genre="Sacrifice",
        blurb="Every second cheap unit you lose feeds the rite: your next "
              "unit enters at +1 power. Twice a battle.",
        # §10.1 specced +1/+1, which measured +7.8 over centre. Dropping the
        # stamina half alone brought it to 49.5 — an independent confirmation
        # of §10.3's law that a pending +1 STA is worth far more than +1 PWR,
        # because a buffed unit that wins keeps the buff while it keeps
        # fighting. Halving the payoff count instead undershot (45.2).
        earn_on=EARN_OWN_DEATH_CHEAP, held_cap=2, earn_cap=4,
        auto_cost=2, auto_pend_pow=1, auto_pend_sta=0),
}

DEFAULT_LEADER = "second_wind"

#: Cheap-unit threshold for the Ritualist's earn condition (§10.3 — the
#: condition had to be narrowed to cheap deaths before the leader stopped
#: dominating; three numeric dials had failed to tame it).
CHEAP_VALUE_MAX = 9


def get(leader_id: str | None) -> Leader | None:
    if leader_id is None:
        return None
    if leader_id not in ROSTER:
        raise KeyError(f"unknown leader {leader_id!r}")
    return ROSTER[leader_id]


def roster_payload() -> list[dict]:
    """Client-facing roster listing."""
    return [
        {"id": ldr.id, "name": ldr.name, "genre": ldr.genre,
         "blurb": ldr.blurb, "tags": ldr.payoff_tags()}
        for ldr in ROSTER.values()
    ]
