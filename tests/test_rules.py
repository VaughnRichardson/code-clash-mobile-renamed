"""Targeted rule tests on constructed decks.

`test_parity.py` covers the engine broadly against the original but has two
measured blind spots (see its docstring): it cannot see information rules,
because it replays recorded picks rather than making them, and it misses
conjunctions too rare to appear in 40 random seeds. Everything here is a
constructed scenario aimed at one of those.
"""

from __future__ import annotations

import random
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from engine import policies as policies_mod       # noqa: E402
from engine.battle import PICK, Battle            # noqa: E402
from engine.cards import BOSS_MAX_SLOT, BOSS_NAME  # noqa: E402


def _deck(*names: str) -> list[str]:
    """Pad a scripted opening out to a legal deck length."""
    out = list(names)
    while len(out) < 30:
        out.append("Grunt")
    return out


def _drive(battle, answer):
    """Run a battle to completion, delegating every prompt to `answer`."""
    rng = random.Random(0)
    prompt = battle.start()
    while prompt is not None:
        prompt = battle.submit(
            {r.seat: answer(r, rng) for r in prompt.requests})
    return battle.result


# ── information rules ────────────────────────────────────────────────────────

def test_simultaneous_picks_are_blind():
    """When both seats field a unit, they are asked in ONE prompt.

    This is the property the whole PvP design rests on. If the engine ever
    asked one seat and then the other, a server could not stop the second from
    being answered with knowledge of the first — and the balance study's own
    numbers stop applying (it measured 2.6% for the first picker when the
    second could see the commitment).
    """
    battle = Battle([_deck(), _deck()], seed=3, shop=False)
    prompt = battle.start()

    assert prompt is not None
    assert len(prompt.requests) == 2, \
        "both seats must be asked in a single prompt, not in sequence"
    assert sorted(prompt.seats) == [0, 1]
    for request in prompt.requests:
        assert request.kind == PICK
        assert request.context["enemy"] is None, \
            "on duel 1 neither seat has fielded — there is nothing to see"


def test_pick_context_shows_pre_draw_enemy_not_the_live_pick():
    """A standing carryover is visible; a unit chosen this phase is not."""
    # Seat 0 fields a Wraith (4/5) into a Fortress (3/9). The Fortress takes
    # two rounds to fall and only needs two to kill, so it survives at 1 and
    # carries over: next duel seat 1 has a standing unit and seat 0 does not.
    battle = Battle([_deck("Wraith", "Champion", "Brute"),
                     _deck("Fortress", "Champion", "Brute")],
                    seed=1, shop=False)
    prompt = battle.start()
    prompt = battle.submit({r.seat: 0 for r in prompt.requests})

    assert prompt is not None
    # Only seat 0 needs a unit now — seat 1's Fortress carried over.
    assert prompt.seats == [0], f"expected only seat 0 to draw, got {prompt.seats}"
    context = prompt.requests[0].context
    assert context["enemy"] is not None
    assert context["enemy"]["name"] == "Fortress"
    assert context["enemy_stamina"] < 9, \
        "the carryover must be shown at its damaged live stamina"


def test_public_state_never_leaks_the_opponent_hand():
    battle = Battle([_deck(), _deck()], seed=5)
    battle.start()
    view = battle.public_state(0)
    assert "hand" in view["you"]
    assert "hand" not in view["them"], "the opponent's hand is not public"
    assert view["them"]["gold"] is None, "the opponent's purse is not public"


def test_public_unit_total_includes_the_fielded_unit():
    """The tug bar counts every unit still able to affect the match."""
    battle = Battle([_deck(), _deck()], seed=5, shop=False)
    battle.start()
    side = battle.sides[0]
    side.active = side.hand.pop()

    view = battle.public_state(0)["you"]
    assert view["remaining"] == 29
    assert view["units"] == 30, \
        "moving a unit from hand to field must not shrink the tug total"


def test_foresight_splits_the_prompt_so_the_seer_answers_second():
    """Oracle's foresight is the one sanctioned break of blindness: the blind
    seat must commit first, in its own prompt."""
    battle = Battle([_deck(), _deck()], leader_ids=["oracle", None],
                    seed=2, shop=False)
    prompt = battle.start()

    assert prompt is not None
    assert prompt.seats == [1], \
        "the seat without foresight must commit alone and first"
    prompt = battle.submit({1: 0})
    assert prompt is not None and prompt.seats == [0]
    assert prompt.requests[0].context["foresight"] is True
    assert prompt.requests[0].context["enemy"] is not None, \
        "the Oracle must see the unit that was just committed"


def test_matching_foresight_blinds_both():
    """Design doc §10.4: Oracle-vs-Oracle measured 32-33% for the first seat
    because the second got the committed-pick information. Matching info
    passives cancel."""
    battle = Battle([_deck(), _deck()], leader_ids=["oracle", "oracle"],
                    seed=2, shop=False)
    prompt = battle.start()

    assert prompt is not None
    assert sorted(prompt.seats) == [0, 1], \
        "two Oracles must blind each other and be asked simultaneously"
    for request in prompt.requests:
        assert request.context["foresight"] is False


def test_fog_blocks_enemy_foresight():
    battle = Battle([_deck(), _deck()], leader_ids=["oracle", None], seed=2)
    battle.sides[1].fog_t = 5
    prompt = battle.start()
    assert sorted(prompt.seats) == [0, 1], \
        "a fogged Oracle loses its split prompt and picks blind"


# ── the conjunction the random seeds miss ────────────────────────────────────

def test_mirror_cancel_preserves_the_first_unit_flag():
    """Both sides open with a Vanguard. Their ON_ENTRY abilities mirror, so
    the entry phase is skipped entirely and — the quirk — the first-unit flags
    are NOT cleared, so the Vanguard bonus is still pending next duel.

    Inherited from `BattleManager.gd`. Deleting it passed all 40 parity seeds.
    """
    battle = Battle([_deck("Vanguard", "Vanguard"), _deck("Vanguard", "Vanguard")],
                    seed=1, shop=False, seat_order="fixed")
    prompt = battle.start()
    battle.submit({r.seat: 0 for r in prompt.requests})

    kinds = [e["kind"] for e in battle.events]
    assert "mirror_cancel" in kinds, "two Vanguards must mirror-cancel"
    assert all(s.first_unit for s in battle.sides), \
        "a cancelled entry phase must leave the first-unit flags standing"
    assert all(s.pow == 6 for s in battle.sides), \
        "neither Vanguard may have taken its +2 this duel"


def test_steal_snapshot_rule():
    """A Warden steals on entry, but the stolen ability does not fire on the
    duel it was taken."""
    battle = Battle([_deck("Warden", "Grunt"), _deck("Wraith", "Grunt")],
                    seed=1, shop=False, seat_order="fixed")
    prompt = battle.start()
    battle.submit({r.seat: 0 for r in prompt.requests})

    # The duel resolves before the engine prompts again, so read the log.
    fired = {e["seat"]: e["fired"]
             for e in battle.events if e["kind"] == "entry"}
    assert fired.get(0) == ["steal:ambush"], \
        f"seat 0's Warden should have stolen the Ambush, fired={fired.get(0)}"
    assert 1 not in fired, \
        "the Wraith's Ambush was taken before it could fire"


# ── boss placement ───────────────────────────────────────────────────────────

def test_boss_occupies_its_slot_rather_than_extending_the_deck():
    deck = _deck()
    battle = Battle([deck, deck], boss_slots=[4, None], seed=1)
    assert len(battle.sides[0].deck) == 30
    assert battle.sides[0].deck[4].name == BOSS_NAME
    assert sum(c.name == BOSS_NAME for c in battle.sides[0].deck) == 1
    assert all(c.name != BOSS_NAME for c in battle.sides[1].deck)


@pytest.mark.parametrize("slot", [BOSS_MAX_SLOT, BOSS_MAX_SLOT + 5, -1])
def test_boss_slot_is_bounded(slot):
    """The signature unit must arrive early enough to shape a normal match."""
    with pytest.raises(ValueError):
        Battle([_deck(), _deck()], boss_slots=[slot, None], seed=1)


# ── driver contract ──────────────────────────────────────────────────────────

def test_submit_rejects_a_partial_answer_set():
    battle = Battle([_deck(), _deck()], seed=1)
    prompt = battle.start()
    assert len(prompt.requests) == 2
    with pytest.raises(ValueError):
        battle.submit({0: 0})


def test_submit_rejects_an_out_of_range_pick():
    battle = Battle([_deck(), _deck()], seed=1)
    prompt = battle.start()
    with pytest.raises(ValueError):
        battle.submit({0: 99, 1: 0})


def test_every_battle_terminates_and_has_a_result():
    """A battle that never ends is a hung room. Random play, many seeds."""
    for seed in range(60):
        battle = Battle([_deck(), _deck()], seed=seed,
                        leader_ids=["sentinel", "gravekeeper"],
                        boss_slots=[3, 20])
        result = _drive(battle, policies_mod.random_policy)
        assert result is not None
        assert battle.duels < 400, "battle failed to converge"
        assert result.winner in (0, 1, None)
