"""Proof that the ported engine is the original engine.

`engine/battle.py` was lifted out of `testproject/tools/card_sim/card_sim.py`,
which was itself a hand-verified mirror of the Godot `BattleManager.gd`. A port
of rules that subtle is worth exactly as much as the evidence that it did not
change them, so this drives *both* engines through the same battles and demands
identical outcomes.

Method: run the original with a recording wrapper around its draft policy,
capturing every pick it makes in order. Then replay those picks into the port
and compare the result. If control flow diverges anywhere — a prompt raised at
a different moment, an ability resolved in a different order — the recorded
picks land on different hands and the outcomes separate. It is a stricter test
than it looks.

The port is run in its legacy compatibility mode (`seat_order="fixed"`,
`tie_to_seat=1`) because its *deliberate* differences from the original — the
alternating seat order that fixes the first-seat bias, and true draws — would
otherwise show up here as failures. Those are covered in `test_balance.py`.

**What this test cannot catch, measured rather than assumed.** Five rule
perturbations were injected into the port to check the comparison has teeth: a
changed Warcry threshold (18/40 seeds failed), disabled Guardian (40/40), a
changed Martyr payoff (16/40) and a reversed entry order (3/40) were all
caught. Two were not:

  * **Anything about what a seat is shown.** Deleting the blind-pick snapshot
    entirely still passed 40/40 — of course it did, the picks here are
    *replayed* from the reference rather than recomputed, so no view feeds any
    decision. Information rules are the security-critical half of PvP and are
    tested directly in `test_rules.py::test_simultaneous_picks_are_blind`.
  * **The mirror-cancel first-unit quirk**, which needs both units to enter
    with the same ability *and* a Vanguard still pending. Too rare for 40
    random seeds; pinned by a constructed deck in `test_rules.py`.
"""

from __future__ import annotations

import importlib.util
import random
import sys
from pathlib import Path

import pytest

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from engine import cards as cards_mod            # noqa: E402
from engine import policies as policies_mod      # noqa: E402
from engine.battle import Battle                 # noqa: E402

SIM_PATH = (ENGINE_ROOT.parent / "testproject" / "tools" / "card_sim"
            / "card_sim.py")


def _load_sim():
    if not SIM_PATH.exists():
        pytest.skip(f"reference simulator not present at {SIM_PATH}",
                    allow_module_level=True)
    spec = importlib.util.spec_from_file_location("card_sim_ref", SIM_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sim = _load_sim()


def _run_reference(deck_a, deck_b, seed):
    """Play the original engine, recording each draft pick in order.

    Picks made from a one-card hand are not recorded: the original still calls
    its policy there, the port auto-fields without prompting, and neither is a
    decision.
    """
    picks: list[int] = []

    def recording_draft(hand, enemy, state, rng):
        choice = sim.pick_draft_skilled(hand, enemy, state, rng)
        if len(hand) > 1:
            picks.append(choice)
        return choice

    policy = {"draft": recording_draft}
    won, duels, rounds, _decisions, _tie = sim.run_battle(
        deck_a, deck_b, "full", policy, policy, random.Random(seed),
        shuffle_p=False, shuffle_e=False,
        p_leader=sim.LEADERS["bare"], e_leader=sim.LEADERS["bare"],
        tiebreak="damage")
    return won, duels, rounds, picks


def _run_port(deck_a, deck_b, seed, picks):
    """Replay the recorded picks into the port."""
    queue = list(picks)
    battle = Battle([deck_a, deck_b], seed=seed, seat_order="fixed",
                    shop=False, hand_size=2, tiebreak="damage",
                    tie_to_seat=1)

    prompt = battle.start()
    while prompt is not None:
        answers = {}
        for request in prompt.requests:
            assert request.kind == "pick", (
                f"port raised an unexpected {request.kind!r} prompt in "
                "parity mode — the compatibility configuration is wrong")
            assert queue, "port asked for more picks than the reference made"
            answers[request.seat] = queue.pop(0)
        prompt = battle.submit(answers)

    assert not queue, (
        f"port consumed {len(picks) - len(queue)} of {len(picks)} picks — "
        "it stopped asking before the reference did")
    return battle


@pytest.mark.parametrize("seed", range(40))
def test_matches_reference_engine(seed):
    rng = random.Random(seed * 977 + 13)
    deck_a = sim.random_deck_names(rng)
    deck_b = sim.random_deck_names(rng)

    won, duels, rounds, picks = _run_reference(deck_a, deck_b, seed)
    battle = _run_port(deck_a, deck_b, seed, picks)
    result = battle.result

    assert result is not None
    assert (result.winner == 0) == won, (
        f"seed {seed}: reference says player_won={won}, port says "
        f"winner={result.winner} ({result.reason})")
    assert result.duels == duels, f"seed {seed}: duel count diverged"
    assert result.rounds == rounds, f"seed {seed}: round count diverged"


def test_catalog_matches_reference():
    """The card data was re-imported from the `.tres` files; the reference
    hardcoded it. They must still agree, or every measured number moved."""
    for name, spec in sim.CATALOG.items():
        power, stamina, _ability, limit = spec
        ours = cards_mod.CATALOG[name]
        assert (ours.power, ours.stamina, ours.deck_limit) == \
            (power, stamina, limit), f"{name} drifted from the reference"
    ours_playable = {n for n, s in cards_mod.CATALOG.items() if not s.is_boss}
    assert ours_playable == set(sim.CATALOG), "card roster drifted"


def test_ability_mapping_matches_reference():
    """Ability assignment came across the `.tres` import intact."""
    id_by_index = {
        sim.AMBUSH: "ambush", sim.STEAL: "steal", sim.WARCRY: "warcry",
        sim.GUARDIAN: "guardian", sim.RESOLVE: "resolve",
        sim.RALLIER: "rallier", sim.MARTYR: "martyr",
        sim.VANGUARD: "vanguard",
    }
    for name, spec in sim.CATALOG.items():
        expected = id_by_index.get(spec[2]) if spec[2] is not None else None
        assert cards_mod.CATALOG[name].ability == expected, \
            f"{name}'s ability drifted from the reference"


def test_predict_duel_matches_reference():
    """The policies' lookahead is shared with the reference verbatim."""
    for my_pow in range(1, 11):
        for my_sta in range(1, 11):
            for opp_pow in range(1, 11):
                for opp_sta in range(1, 11):
                    for amb in ((False, False), (True, False), (True, True)):
                        assert sim.predict_duel(
                            my_pow, my_sta, opp_pow, opp_sta, *amb) == \
                            policies_mod.predict_duel(
                                my_pow, my_sta, opp_pow, opp_sta, *amb)
