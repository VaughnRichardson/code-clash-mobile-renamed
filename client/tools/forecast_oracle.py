"""Ground truth for the battle screen's forecast, taken from the engine itself.

The client tells the player what a card will do before they commit to it. That
claim is arithmetic the engine also performs, in `_round_loop` and
`_survive_phase`, and for one review cycle the two disagreed: the screen called
a Duelist's unspent Resolve a trade — "both fall" being the literal trigger
condition of the ability printed one line above it — and steered the player onto
the card that loses.

A screenshot cannot catch that; it only shows one board. So this emits a case
matrix and, for each case, what the ENGINE does with it, by driving the engine's
own generators over a rigged state. Nothing here is a reimplementation:
`_round_loop`, `_survive_phase`, `_entry_phase` and `effective_entry_stats` are
imported and called. `client/tools/forecast-check.mjs` runs the client's mirror
of the same arithmetic over the same matrix and demands identical answers.

    python3 client/tools/forecast_oracle.py > cases.json

Read-only with respect to `engine/` — it imports, it does not patch.
"""

from __future__ import annotations

import json
import sys
from itertools import product
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from engine.battle import Battle, effective_entry_stats  # noqa: E402
from engine.cards import CATALOG, Card  # noqa: E402

# Every unit that carries an ability, plus two plain ones for the arithmetic
# with nothing on top of it.
UNITS = ["Duelist", "Guardian", "Wraith", "Vanguard", "Berserker", "Warden",
         "Martyr", "Rallier", "Brute", "Fortress", "Soldier", "Champion",
         "Grunt"]

# Live stamina values worth testing against: exactly lethal, one over, one
# under, and the low carryover values a survivor comes back on.
FOE_STAMINA = [1, 2, 3, 5, 6, 9]
FOE_POWER = [2, 4, 5, 7, 10]


def _blank_battle() -> Battle:
    """A battle with no leaders and no shop, so only forecast-relevant prompts
    can yield while the duel is prepared.
    a Second Wind prompt and the round loop runs to completion in one go."""
    deck = ["Grunt"] * 30
    return Battle([deck, deck], leader_ids=[None, None],
                  seed=1, seat_order="fixed", shop=False)


def _fit(battle: Battle, seat: int, name: str, power: int, stamina: int,
         spent: bool) -> Card:
    """Put a unit on the field with the live stats and ability state we want.

    This is exactly the shape `_round_loop` expects to find: `Side.pow`/`sta`
    are the fielded unit's live values and the card keeps its own spent flags.
    """
    side = battle.sides[seat]
    card = Card(name)
    if spent:
        card.spent = True
    side.active = card
    side.pow = power
    side.sta = stamina
    return card


def _run_rounds(battle: Battle) -> tuple[list[bool], int]:
    """Drive `_round_loop` to its end. With no leaders it never yields."""
    gen = battle._round_loop()
    try:
        next(gen)
    except StopIteration as stop:
        return battle._dead, int(stop.value)
    raise AssertionError("the round loop asked for a decision it should not "
                         "have — the oracle's battle has no leaders")


def round_loop_cases() -> list[dict]:
    """Layer A: given a fight as the round loop finds it, who is left standing?

    `me_first` is the engine's `_order()`, which alternates per duel and is not
    on the wire. It is exercised both ways by putting the tested unit on seat 0
    and then on seat 1 of a `seat_order="fixed"` battle.
    """
    cases: list[dict] = []
    for mine, foe_pow, foe_sta, my_spent, foe_spent, me_first in product(
            UNITS, FOE_POWER, FOE_STAMINA, [False, True], [False, True],
            [True, False]):
        spec = CATALOG[mine]
        # The opponent is drawn from the units whose abilities can overturn a
        # result, so the client's "stop asserting" rule gets exercised too.
        for foe_name in ("Duelist", "Guardian", "Grunt", "Wraith"):
            battle = _blank_battle()
            my_seat = 0 if me_first else 1
            my_card = _fit(battle, my_seat, mine, spec.power, spec.stamina,
                           my_spent)
            foe_card = _fit(battle, 1 - my_seat, foe_name, foe_pow, foe_sta,
                            foe_spent)
            # Ambush is a flag the entry phase leaves on the SIDE, and the
            # entry phase has already run by the time the rounds start.
            my_amb = my_card.has_unspent("ambush")
            foe_amb = foe_card.has_unspent("ambush")
            if my_amb and foe_amb:          # `_entry_phase` clears both
                my_amb = foe_amb = False
            battle.sides[my_seat].ambush = my_amb
            battle.sides[1 - my_seat].ambush = foe_amb
            for card in (my_card, foe_card):
                for ability in ("ambush", "steal", "vanguard", "warcry"):
                    card.spend(ability)     # entry abilities are done firing

            my_guardian = my_card.has_unspent("guardian")
            my_resolve = my_card.has_unspent("resolve")
            foe_guardian = foe_card.has_unspent("guardian")
            foe_resolve = foe_card.has_unspent("resolve")
            dead, rounds = _run_rounds(battle)
            me = battle.sides[my_seat]
            result = ("trade" if dead[my_seat] and dead[1 - my_seat]
                      else "lose" if dead[my_seat] else "win")
            cases.append({
                "kind": "rounds",
                "name": f"{mine} vs {foe_name} {foe_pow}/{foe_sta}"
                        f"{' (mine spent)' if my_spent else ''}"
                        f"{' (theirs spent)' if foe_spent else ''}"
                        f"{' me-first' if me_first else ' them-first'}",
                "me": {"power": spec.power, "stamina": spec.stamina,
                       "ambush": my_amb, "guardian": my_guardian,
                       "resolve": my_resolve},
                "foe": {"power": foe_pow, "stamina": foe_sta,
                        "ambush": foe_amb, "guardian": foe_guardian,
                        "resolve": foe_resolve},
                "me_first": me_first,
                "expect": {
                    "result": result,
                    "stamina": 0 if dead[my_seat] else me.sta,
                    "dealt": me.damage_dealt,
                    "rounds": rounds,
                },
            })
    return cases


def entry_cases() -> list[dict]:
    """Layer B: the conditional entry buff, and the ambush cancel.

    The client must NOT fold Vanguard's +2 or Warcry's stacks into the statline
    — a mirror entry cancels the whole phase — but it must print the condition,
    and it must get the numbers right when it does.
    """
    cases: list[dict] = []
    for mine, foe_name, first, discards in product(
            UNITS, ("Vanguard", "Berserker", "Wraith", "Grunt"),
            (True, False), (0, 4, 5, 9, 10, 15)):
        spec = CATALOG[mine]
        battle = _blank_battle()
        my_card = _fit(battle, 0, mine, spec.power, spec.stamina, False)
        foe_card = _fit(battle, 1, foe_name, CATALOG[foe_name].power,
                        CATALOG[foe_name].stamina, False)
        battle.sides[0].first_unit = first
        battle.sides[1].first_unit = first
        battle.sides[0].discards = discards
        battle.sides[1].discards = discards
        buffed_pow, buffed_sta = effective_entry_stats(my_card, first,
                                                       discards)
        battle._entry_phase()
        cases.append({
            "kind": "entry",
            "name": f"{mine} entering vs {foe_name}"
                    f"{' first' if first else ''} discards={discards}",
            "card": {"name": mine, "power": spec.power,
                     "stamina": spec.stamina, "ability": spec.ability,
                     "spent": False},
            "first": first,
            "discards": discards,
            "expect": {
                # What the unit's stats WOULD be once its own entry resolves —
                # the client prints the delta as a condition, so the delta is
                # what is compared.
                "buff_power": buffed_pow - spec.power,
                "buff_stamina": buffed_sta - spec.stamina,
                # ...and whether it actually gets the first strike, which two
                # ambushes cancel.
                "ambush": battle.sides[0].ambush,
                "foe_ambush": battle.sides[1].ambush,
                "foe_ability": foe_card.ab,
            },
        })
    return cases


def blocker_case() -> dict:
    """The exact board from `08-battle-midgame-full.png`.

    An offered Duelist 5/4 with an unspent Resolve, against a Duelist that has
    already spent its own ("Their Resolve holds." is in the log two rows above
    the card). The screen printed "Trade · both fall" under the word Resolve,
    and painted the adjacent card's "Wins" green — steering the player off the
    card that wins.
    """
    battle = _blank_battle()
    mine = _fit(battle, 0, "Duelist", 5, 4, False)
    theirs = _fit(battle, 1, "Duelist", 5, 1, True)
    me = {"power": 5, "stamina": 4, "ambush": False, "guardian": False,
          "resolve": mine.has_unspent("resolve")}
    foe = {"power": 5, "stamina": 1, "ambush": False, "guardian": False,
           "resolve": theirs.has_unspent("resolve")}
    dead, rounds = _run_rounds(battle)
    return {
        "kind": "blocker",
        "name": "offered Duelist 5/4 (Resolve unspent) vs Duelist 5/1 (spent)",
        "me": me,
        "foe": foe,
        "me_first": True,
        "expect": {"result": "trade" if all(dead) else
                             "lose" if dead[0] else "win",
                   "stamina": 0 if dead[0] else battle.sides[0].sta,
                   "dealt": battle.sides[0].damage_dealt,
                   "rounds": rounds},
    }


def main() -> None:
    cases = round_loop_cases() + entry_cases()
    cases.append(blocker_case())
    json.dump({"cases": cases}, sys.stdout)


if __name__ == "__main__":
    main()
