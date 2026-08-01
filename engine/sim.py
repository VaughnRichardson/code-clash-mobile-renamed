"""Monte-Carlo balance harness — the regression gate for rule changes.

Carried over from `card_sim.py`, whose measurements produced the design this
game implements. Its role here is narrower and more important: the numbers in
`CARD_CLASH_SKILL_EXPRESSION.md` were measured against rules that have since
been *changed* (the seat order alternates now, the leaders carry §10.2's dials,
the shop is repriced, the boss is real). Re-run this after touching any rule
constant, or the design doc's numbers quietly stop describing the game.

    python3 -m engine.sim seat-bias      # is the PvP blocker actually fixed?
    python3 -m engine.sim roster         # 10x10 leader round robin
    python3 -m engine.sim economy        # does the shop reward skill?
    python3 -m engine.sim boss           # does placement matter, both ways?
    python3 -m engine.sim all

Head-to-head is the only valid balance metric — measuring a leader against a
kitless mirror saturates (§9.4). Every table below is leader-vs-leader.
"""

from __future__ import annotations

import argparse
import random
import sys
from collections import defaultdict

from . import leaders as leaders_mod
from . import policies as policies_mod
from .battle import SHOP, Battle
from .cards import CARD_VALUE, DECK_SIZE, FULL_POOL

# Sequencing heuristics, ported verbatim — §11.2 measured aggro and hoard at
# 53.4/53.3 against each other, i.e. two genuinely viable ordering strategies.
_HOARD_PRIORITY = {
    "Vanguard": 0, "Martyr": 1, "Guardian": 2, "Fortress": 3, "Wraith": 4,
    "Duelist": 5, "Warden": 6, "Soldier": 7, "Rallier": 8, "Grunt": 9,
    "Brute": 10, "Champion": 11, "Berserker": 12,
}


def order_deck(names: list[str], style: str = "hoard") -> list[str]:
    if style == "aggro":
        priority = {n: -CARD_VALUE[n] for n in set(names)}
        priority["Vanguard"] = -100
        return sorted(names, key=lambda n: priority[n])
    if style == "hoard":
        return sorted(names, key=lambda n: _HOARD_PRIORITY[n])
    by_value = sorted(names, key=lambda n: -CARD_VALUE[n])
    out: list[str] = []
    lo, hi = 0, len(by_value) - 1
    while lo <= hi:
        out.append(by_value[lo])
        if lo != hi:
            out.append(by_value[hi])
        lo += 1
        hi -= 1
    return out


def random_deck(rng: random.Random, style: str = "hoard") -> list[str]:
    pool = FULL_POOL[:]
    rng.shuffle(pool)
    return order_deck(pool[:DECK_SIZE], style)


def no_shop(policy):
    """Wrap a policy so it never buys — the control for economy measurements."""
    def wrapped(request, rng):
        if request.kind == SHOP:
            return None
        return policy(request, rng)
    return wrapped


def play(deck_a, deck_b, policy_a, policy_b, *, seed: int,
         leaders=(None, None), boss=(None, None), seat_order="alternate",
         shop: bool = True):
    battle = Battle([deck_a, deck_b], leader_ids=list(leaders),
                    boss_slots=list(boss), seed=seed, seat_order=seat_order,
                    shop=shop)
    return policies_mod.play_out(battle, [policy_a, policy_b],
                                 random.Random(seed ^ 0x5EED))


def measure(games: int, seed: int, *, policy_a=None, policy_b=None,
            leaders=(None, None), boss=(None, None),
            seat_order="alternate", style=("hoard", "hoard"),
            shop: bool = True, mirror_decks: bool = False) -> dict:
    """Win rate for seat 0 over `games` battles.

    By default each seat draws its *own* random deck, which is the condition
    real matches are played under. `mirror_decks=True` hands both seats the
    identical list instead: that makes every duel a stat-for-stat mirror, so
    the battle turns on the first asymmetry and any edge snowballs. It is a
    superb detector of seat bias (`run_seat_bias` uses it) and a badly
    inflated measure of how strong a mechanic is — an effect worth +2 points
    in real play can read as +19 there. Do not balance against it.
    """
    policy_a = policy_a or policies_mod.skilled
    policy_b = policy_b or policies_mod.skilled
    rng = random.Random(seed)
    wins = draws = 0
    duels = 0
    for i in range(games):
        base = random_deck(rng, "hoard")
        deck_a = order_deck(base, style[0])
        deck_b = order_deck(base if mirror_decks else random_deck(rng, "hoard"),
                            style[1])
        result = play(deck_a, deck_b, policy_a, policy_b, seed=seed * 7919 + i,
                      leaders=leaders, boss=boss, seat_order=seat_order,
                      shop=shop)
        if result.winner == 0:
            wins += 1
        elif result.winner is None:
            draws += 1
        duels += result.duels
    return {
        "win_rate": 100.0 * wins / games,
        "draw_rate": 100.0 * draws / games,
        "avg_duels": duels / games,
        "games": games,
    }


# ── experiments ──────────────────────────────────────────────────────────────

def run_seat_bias(games: int, seed: int) -> None:
    """The PvP blocker, measured.

    §9.2: entry abilities resolved player-first was worth +3 to +5 points and
    was logged as blocking any PvP or tournament use. A true mirror — same
    deck, same leader, same policy on both seats — must land on 50%.
    """
    print("\n== seat bias (true mirror: identical decks, leaders, policies) ==")
    print(f"{'seat_order':<12} {'leader':<14} {'seat 0 WR':>10} {'draws':>7}")
    for leader in (None, "second_wind", "oracle", "sentinel"):
        for order in ("fixed", "alternate"):
            res = measure(games, seed, leaders=(leader, leader),
                          seat_order=order, mirror_decks=True)
            label = leader or "-none-"
            print(f"{order:<12} {label:<14} {res['win_rate']:>9.1f}% "
                  f"{res['draw_rate']:>6.1f}%")
    print("  fixed  = the original's player-first resolution (the bias)")
    print("  alternate = the fix: who resolves first flips each duel")


def run_roster(games: int, seed: int) -> None:
    """10x10 head-to-head. Row = seat 0's leader; the row average is that
    leader's standing.

    Every cell gets its *own* seed. Reusing one seed across the matrix hands
    all 100 cells the identical deck sequence, so a single unlucky draw shifts
    every row together and the grand mean drifts off 50 — measured at 54.0
    before this was fixed, which made the centre meaningless as a reference.
    """
    ids = list(leaders_mod.ROSTER)
    print(f"\n== leader round robin ({games} games/cell) ==")
    header = "".join(f"{i[:5]:>7}" for i in ids)
    print(f"{'':<14}{header}{'avg':>8}")
    averages: dict[str, float] = {}
    for r, row in enumerate(ids):
        cells = []
        for c, col in enumerate(ids):
            res = measure(games, seed + r * 101 + c * 7919,
                          leaders=(row, col))
            cells.append(res["win_rate"])
        averages[row] = sum(cells) / len(cells)
        body = "".join(f"{c:>7.1f}" for c in cells)
        print(f"{row:<14}{body}{averages[row]:>8.1f}")

    ranked = sorted(averages.items(), key=lambda kv: -kv[1])
    centre = sum(averages.values()) / len(averages)
    print(f"\n  centre {centre:.1f}   spread "
          f"{ranked[0][1] - ranked[-1][1]:.1f} points")
    for name, avg in ranked:
        flag = "  <-- outlier" if abs(avg - centre) > 5 else ""
        print(f"    {name:<14} {avg:>6.1f}  ({avg - centre:+.1f}){flag}")


def run_economy(games: int, seed: int) -> None:
    """Does the shop reward skill, and is information still cheap?

    §11.1 found the economy works (+4.9 for a skilled buyer) but that a
    permanent information item was break-even, which is why this catalogue
    prices info at 1g and puts the real goods on the duel layer.
    """
    print(f"\n== item economy ({games} games/cell) ==")
    skilled = policies_mod.skilled
    rows = [
        ("skilled buyer vs no shop", skilled, no_shop(skilled)),
        ("skilled buyer vs random buyer", skilled, policies_mod.random_policy),
        ("no shop vs no shop (control)", no_shop(skilled), no_shop(skilled)),
    ]
    for label, pa, pb in rows:
        res = measure(games, seed, policy_a=pa, policy_b=pb)
        print(f"  {label:<32} {res['win_rate']:>6.1f}%")


def run_boss(games: int, seed: int) -> None:
    """Placement must be a real choice, not a one-sided trap.

    The legal range keeps the signature unit early enough to influence normal
    play while still making its exact arrival an ordering decision.
    """
    print(f"\n== boss placement ({games} games/cell, vs mid placement) ==")
    for label, slot in (("early (2)", 2), ("mid (11)", 11),
                        ("late (23)", 23), ("none", None)):
        res = measure(games, seed, boss=(slot, 11))
        print(f"  {label:<12} {res['win_rate']:>6.1f}%   "
              f"avg duels {res['avg_duels']:.1f}")


def run_pacing(games: int, seed: int) -> None:
    """How long a units-only battle runs, with and without the shop layer."""
    print(f"\n== pacing ({games} games) ==")
    for label, shop in (("shop on", True), ("shop off", False)):
        res = measure(games, seed, shop=shop)
        print(f"  {label:<10} avg duels {res['avg_duels']:>5.1f}   "
              f"draws {res['draw_rate']:.1f}%")


EXPERIMENTS = {
    "seat-bias": run_seat_bias,
    "roster": run_roster,
    "economy": run_economy,
    "boss": run_boss,
    "pacing": run_pacing,
}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("experiment", nargs="?", default="all",
                        choices=[*EXPERIMENTS, "all"])
    parser.add_argument("--games", type=int, default=400)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args(argv)

    chosen = list(EXPERIMENTS) if args.experiment == "all" \
        else [args.experiment]
    for name in chosen:
        # The round robin is 100 cells; keep it affordable in the "all" sweep.
        games = args.games // 4 if name == "roster" else args.games
        EXPERIMENTS[name](max(games, 20), args.seed)
    return 0


if __name__ == "__main__":
    sys.exit(main())
