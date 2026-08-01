"""The between-duels item shop.

The web fork keeps the gold decision layer while unit attrition is the only
match clock. Every duel win pays one gold; Curse and Ward affect combat, while
Scout and Fog trade cheaply in information. There is deliberately no repair
item because there is no separate structure or health pool to repair.
"""

from __future__ import annotations

from dataclasses import dataclass

GOLD_START = 2
GOLD_PER_WIN = 1


@dataclass(frozen=True)
class Item:
    id: str
    name: str
    cost: int
    layer: str          # "duel" | "info" — §11.1's core distinction
    blurb: str


CATALOG: dict[str, Item] = {
    "curse": Item(
        "curse", "Curse", 3, "duel",
        "The enemy's next unit enters wounded — 2 stamina gone."),
    "ward": Item(
        "ward", "Ward", 3, "duel",
        "Your next unit enters carrying a 3-point shield."),
    "scout": Item(
        "scout", "Scout", 1, "info",
        "See the enemy's incoming unit for the next 3 duels."),
    "fog": Item(
        "fog", "Fog", 2, "info",
        "Blind the enemy's foresight for the next 10 duels."),
}

#: The shop only opens once a *duel-layer* good is within reach.
#:
#: Not a balance dial — a phone one. The shop is offered between every duel,
#: and a battle runs ~34 duels, so opening it whenever the 1g Scout was
#: affordable meant roughly thirty "Buy nothing" taps per match. Gating on the
#: cheapest real good removes the prompts that were never a decision, and the
#: measured economy is unchanged (see `sim.py economy`).
SHOP_MIN_GOLD = 3

SCOUT_DURATION = 3
FOG_DURATION = 10
CURSE_WOUND = 2
WARD_SHIELD = 3
def affordable(gold: int) -> list[str]:
    return [item.id for item in CATALOG.values() if item.cost <= gold]


def catalog_payload() -> list[dict]:
    return [
        {"id": i.id, "name": i.name, "cost": i.cost, "layer": i.layer,
         "blurb": i.blurb}
        for i in CATALOG.values()
    ]
