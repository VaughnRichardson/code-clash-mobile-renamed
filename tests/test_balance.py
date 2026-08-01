"""Balance regression gate.

The engine's rule constants were re-derived on this codebase (see `sim.py` and
the notes in `items.py` / `leaders.py`); these tests pin the properties those
derivations were aiming at, so a later tweak that quietly undoes one fails here
instead of in someone's match.

Game counts are the smallest that give the bands meaning — the full tables live
behind `python3 -m engine.sim`. Bands are deliberately wide: this catches a
regression, it does not re-tune anything.
"""

from __future__ import annotations

import statistics
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine import items as items_mod                    # noqa: E402
from engine import leaders as leaders_mod                # noqa: E402
from engine import policies as policies_mod              # noqa: E402
from engine.sim import measure, no_shop                  # noqa: E402


def _mean(**kwargs) -> float:
    return statistics.mean(
        measure(kwargs.pop("games", 500), seed, **kwargs)["win_rate"]
        for seed in (1, 2))


# ── the PvP blocker ──────────────────────────────────────────────────────────

def test_alternating_seat_order_removes_the_first_seat_bias():
    """Design doc §9.2 logged player-first entry resolution as blocking PvP.

    A true mirror — identical decks, identical leaders, identical policy — has
    no source of advantage except the seat itself, so it must land on 50%.
    """
    fair = _mean(leaders=(None, None), seat_order="alternate",
                 mirror_decks=True, games=800)
    assert 44 <= fair <= 56, (
        f"a true mirror measured {fair:.1f}% for seat 0 — the seats are not "
        "symmetric")


def test_the_mirror_test_can_actually_detect_a_biased_seat_order():
    """Self-test: the gate above is worthless unless it fails on the bias it
    exists to catch. `fixed` is the original's player-first resolution."""
    biased = _mean(leaders=(None, None), seat_order="fixed",
                   mirror_decks=True, games=800)
    assert not 44 <= biased <= 56, (
        f"the legacy fixed seat order measured {biased:.1f}%, inside the band "
        "the fairness test accepts — that test can no longer detect the bias")


@pytest.mark.parametrize("leader", ["second_wind", "reaper", "gravekeeper"])
def test_leader_mirrors_are_fair(leader):
    fair = _mean(leaders=(leader, leader), seat_order="alternate",
                 mirror_decks=True, games=500)
    assert 42 <= fair <= 58, \
        f"{leader} mirror measured {fair:.1f}% for seat 0"


# ── the units-only clock ─────────────────────────────────────────────────────

def test_the_shop_contains_no_structure_repair():
    """There is one match resource: surviving units."""
    assert "mend" not in items_mod.CATALOG
    assert all("gate" not in item.blurb.lower()
               for item in items_mod.CATALOG.values())


def test_battles_stay_a_reasonable_length_for_a_phone():
    duels = statistics.mean(measure(400, seed)["avg_duels"] for seed in (1, 2))
    assert 20 <= duels <= 45, f"a battle now runs {duels:.0f} duels"


# ── skill ────────────────────────────────────────────────────────────────────

def test_playing_well_beats_playing_randomly():
    gap = _mean(policy_a=policies_mod.skilled,
                policy_b=policies_mod.random_policy, games=600)
    assert gap >= 60, (
        f"skilled play measured only {gap:.1f}% against random — the game has "
        "lost its decision content")


def test_the_shop_is_a_real_decision_layer():
    """§11.1 found the first pricing pass too weak to matter (+4.9). The goods
    are on the duel layer now and should carry weight comparable to picks."""
    with_shop = _mean(policy_a=policies_mod.skilled,
                      policy_b=no_shop(policies_mod.skilled), games=600)
    assert with_shop >= 55, (
        f"using the shop measured {with_shop:.1f}% against never using it — "
        "items are back to being ignorable")


def test_information_stays_cheap():
    """§11.1's structural finding: blind simultaneous picks cap what foresight
    can be worth, so info items must not be priced like duel-layer goods."""
    info = [i for i in items_mod.CATALOG.values() if i.layer == "info"]
    duel = [i for i in items_mod.CATALOG.values() if i.layer == "duel"]
    assert info and duel
    assert max(i.cost for i in info) < min(i.cost for i in duel), \
        "an information item costs as much as a duel-layer good"


# ── roster shape ─────────────────────────────────────────────────────────────

def test_every_leader_has_a_payoff_the_client_can_describe():
    for leader in leaders_mod.ROSTER.values():
        assert leader.payoff_tags(), f"{leader.id} shows the player nothing"
        assert leader.blurb.strip(), f"{leader.id} has no description"


def test_no_leader_prices_an_active_beyond_its_own_charge_cap():
    """Reaper shipped with cost 3 against a 2-charge cap, so its active could
    never be afforded and the leader measured -6.0 as a dead passive."""
    for leader in leaders_mod.ROSTER.values():
        if leader.active is None:
            continue
        reachable = max(leader.held_cap, leader.start_charges)
        assert leader.cost <= reachable, (
            f"{leader.id} costs {leader.cost} charges but can only ever hold "
            f"{reachable} — its active is unusable")


@pytest.mark.slow
def test_the_roster_has_no_runaway_leader():
    """Head-to-head against the whole field. Slow (100 match-ups); run with
    `-m slow`. The full table is `python3 -m engine.sim roster`."""
    ids = list(leaders_mod.ROSTER)
    standings = {}
    for r, row in enumerate(ids):
        cells = [measure(120, 7 + r * 101 + c * 7919, leaders=(row, col))
                 ["win_rate"] for c, col in enumerate(ids)]
        standings[row] = sum(cells) / len(cells)
    centre = statistics.mean(standings.values())
    worst = max(standings, key=lambda k: abs(standings[k] - centre))
    assert abs(standings[worst] - centre) <= 12, (
        f"{worst} sits {standings[worst] - centre:+.1f} from the centre "
        f"({centre:.1f}); the roster has a runaway leader")
