"""NPC opponents.

These are the tuned policies from `card_sim.py` — the greedy exact-duel
lookahead that the whole skill-expression study measured against. Porting them
means the single-player opponent is the same one every balance number in
`CARD_CLASH_SKILL_EXPRESSION.md` was produced against.

A policy answers a `Request` and nothing else: it is handed the same payload
the engine would send to a human client, so it is structurally incapable of
reading the opponent's hand or an uncommitted pick. That is deliberate — an AI
that cheats invalidates every win rate the sim measured.
"""

from __future__ import annotations

import random
from math import ceil

from . import items as items_mod
from .battle import (EMPOWER, PICK, REVIVE, SECOND_WIND, SHOP, SMITE, WITHDRAW,
                     predict_duel)
from .cards import AMBUSH, CARD_VALUE, VANGUARD, WARCRY

DIFFICULTIES = ("novice", "steady", "veteran")


def _entry_stats(card: dict, own_first: bool, own_discards: int
                 ) -> tuple[int, int]:
    """Mirror of `battle.effective_entry_stats` over the wire payload."""
    p, s = card["power"], card["stamina"]
    if card.get("ability") == VANGUARD and not card.get("spent") and own_first:
        p += 2
    if card.get("ability") == WARCRY and not card.get("spent"):
        stacks = own_discards // 5
        p += stacks
        s += stacks
    return p, s


def _has_ambush(card: dict) -> bool:
    if card.get("ability") == AMBUSH and not card.get("spent"):
        return True
    return card.get("stolen") == AMBUSH


# ── individual decisions ─────────────────────────────────────────────────────

def pick_skilled(request, rng) -> int:
    """Counter-pick: win with the *least valuable* unit that suffices.

    Spending a Champion to kill a Grunt wins the duel and loses the battle;
    the value term is what stops that.
    """
    ctx = request.context
    hand = request.options
    enemy = ctx.get("enemy")
    if enemy is None:
        return max(range(len(hand)),
                   key=lambda i: CARD_VALUE.get(hand[i]["name"], 0))

    e_pow = ctx.get("enemy_power", 0)
    e_sta = ctx.get("enemy_stamina", 0)
    best_i, best_score = 0, -10 ** 9
    for i, card in enumerate(hand):
        my_pow, my_sta = _entry_stats(card, ctx.get("own_first", False),
                                      ctx.get("own_discards", 0))
        outcome, remaining, _ = predict_duel(
            my_pow, my_sta, e_pow, e_sta,
            _has_ambush(card), _has_ambush(enemy))
        value = CARD_VALUE.get(card["name"], 0)
        if outcome == 1:
            score = 100 + remaining * 2 - value
        elif outcome == 0:
            score = 10 - value
        else:
            chip = min(e_sta, ceil(my_sta / max(e_pow, 1)) * my_pow)
            score = -50 + chip * 2 - value
        if score > best_score:
            best_i, best_score = i, score
    return best_i


def shop_skilled(request, rng):
    """Buy on the duel layer first (§11.1: curses and wounds carried the
    skilled buyer; information priced itself out)."""
    ctx = request.context
    offer = set(request.options)
    gold = ctx.get("gold", 0)
    own_units = ctx.get("units", 0)
    enemy_units = ctx.get("enemy_units", 0)

    # Press while level or ahead; stabilise with Ward when the only public race
    # — surviving units — has swung the other way.
    if "curse" in offer and (own_units >= enemy_units or
                             gold >= items_mod.CATALOG["curse"].cost + 1):
        return "curse"
    if "ward" in offer:
        return "ward"
    if "scout" in offer and ctx.get("scout_turns", 0) == 0 and gold >= 3:
        return "scout"
    return None


def withdraw_skilled(request, rng):
    """Pull the active unit only when the swap turns a loss into a win."""
    ctx = request.context
    e_pow = ctx.get("enemy_power", 0)
    e_sta = ctx.get("enemy_stamina", 0)
    if e_sta <= 0:
        return None
    current, _, _ = predict_duel(ctx.get("power", 0), ctx.get("stamina", 0),
                                 e_pow, e_sta)
    if current == 1:
        return None
    best_i, best_gain = None, 0
    for i, card in enumerate(request.options):
        outcome, remaining, _ = predict_duel(card["power"], card["stamina"],
                                             e_pow, e_sta,
                                             _has_ambush(card), False)
        gain = (outcome - current) * 10 + remaining
        if outcome > current and gain > best_gain:
            best_i, best_gain = i, gain
    return best_i


def smite_skilled(request, rng) -> bool:
    """Soften only when it flips the duel — a wasted charge is a lost duel."""
    ctx = request.context
    e_pow = ctx.get("enemy_power", 0)
    e_sta = ctx.get("enemy_stamina", 0)
    value = ctx.get("value", 0)
    before, _, _ = predict_duel(ctx.get("power", 0), ctx.get("stamina", 0),
                                e_pow, e_sta)
    after, _, _ = predict_duel(ctx.get("power", 0), ctx.get("stamina", 0),
                               e_pow, max(1, e_sta - value))
    return after > before


def empower_skilled(request, rng) -> bool:
    ctx = request.context
    e_pow = ctx.get("enemy_power", 0)
    e_sta = ctx.get("enemy_stamina", 0)
    value = ctx.get("value", 0)
    before, _, _ = predict_duel(ctx.get("power", 0), ctx.get("stamina", 0),
                                e_pow, e_sta)
    after, _, _ = predict_duel(ctx.get("power", 0) + value,
                               ctx.get("stamina", 0), e_pow, e_sta)
    return after > before


def second_wind_skilled(request, rng) -> bool:
    """Always stand back up. A unit at 1 stamina still soaks a duel, and the
    charge expires worthless at the end of the battle."""
    return True


def revive_skilled(request, rng) -> bool:
    """Only worth a slot for a unit that can still win one — the corpse goes
    to the deck bottom, so it must be worth reaching."""
    card = request.context.get("card", {})
    return CARD_VALUE.get(card.get("name", ""), 0) >= 11


# ── random counterparts (the skill-gap control, and the novice opponent) ─────

def _random_answer(request, rng):
    if request.kind == PICK:
        return rng.randrange(len(request.options))
    if request.kind == SHOP:
        choices = list(request.options) + [None]
        return rng.choice(choices)
    if request.kind == WITHDRAW:
        if not request.options or rng.random() < 0.5:
            return None
        return rng.randrange(len(request.options))
    if request.kind in (SMITE, EMPOWER, SECOND_WIND, REVIVE):
        return rng.random() < 0.5
    raise ValueError(f"unhandled request kind {request.kind!r}")


_SKILLED = {
    PICK: pick_skilled,
    SHOP: shop_skilled,
    WITHDRAW: withdraw_skilled,
    SMITE: smite_skilled,
    EMPOWER: empower_skilled,
    SECOND_WIND: second_wind_skilled,
    REVIVE: revive_skilled,
}


def skilled(request, rng):
    handler = _SKILLED.get(request.kind)
    if handler is None:
        raise ValueError(f"unhandled request kind {request.kind!r}")
    return handler(request, rng)


def random_policy(request, rng):
    return _random_answer(request, rng)


def make_policy(difficulty: str = "veteran"):
    """Returns `policy(request, rng) -> choice`.

    `steady` is the interesting one for a first opponent: it plays the tuned
    line most of the time and blunders the rest, which reads as a person
    rather than as a solver.
    """
    if difficulty not in DIFFICULTIES:
        raise ValueError(f"unknown difficulty {difficulty!r}")
    if difficulty == "novice":
        return random_policy
    if difficulty == "veteran":
        return skilled

    def steady(request, rng):
        if rng.random() < 0.25:
            return random_policy(request, rng)
        return skilled(request, rng)

    return steady


# ── driving a whole battle with policies (used by the sim and by tests) ──────

def play_out(battle, policies, rng: random.Random | None = None):
    """Run `battle` to completion with a policy per seat."""
    rng = rng or random.Random(battle.seed)
    prompt = battle.start()
    while prompt is not None:
        answers = {}
        for request in prompt.requests:
            answers[request.seat] = policies[request.seat](request, rng)
        prompt = battle.submit(answers)
    return battle.result
