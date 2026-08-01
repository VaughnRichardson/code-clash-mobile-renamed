"""Card catalog and runtime card state.

Loaded from `data/cards.json` (imported once from the Godot `.tres` files, see
`scripts/import_from_godot.py`). This module is the only place card stats live.
"""

from __future__ import annotations

import json
from pathlib import Path

DATA_PATH = Path(__file__).resolve().parents[1] / "data" / "cards.json"

# Ability ids. `ENTRY_ABILITIES` fire during RESOLVE_ENTRY; the rest fire on
# death (martyr), on win (rallier) or on lethal damage (guardian, resolve).
AMBUSH = "ambush"
STEAL = "steal"
WARCRY = "warcry"
GUARDIAN = "guardian"
RESOLVE = "resolve"
RALLIER = "rallier"
MARTYR = "martyr"
VANGUARD = "vanguard"

ENTRY_ABILITIES = frozenset({AMBUSH, STEAL, WARCRY, VANGUARD})

DECK_SIZE = 30

# The boss unit (design doc §11): one per deck, placed at a position the player
# chooses. It occupies a deck slot rather than extending the deck, so fielding
# it is a real cost. `BOSS_MAX_SLOT` keeps the signature unit early enough to
# shape a normal phone-length match instead of becoming a final-slot non-choice.
BOSS_NAME = "Warlord"
BOSS_POWER = 10
BOSS_STAMINA = 8
BOSS_MAX_SLOT = 24


class CardSpec:
    """Immutable catalog entry."""

    __slots__ = ("name", "power", "stamina", "ability", "deck_limit",
                 "unique", "flavor", "is_boss")

    def __init__(self, name: str, power: int, stamina: int,
                 ability: str | None, deck_limit: int, unique: bool,
                 flavor: str = "", is_boss: bool = False) -> None:
        self.name = name
        self.power = power
        self.stamina = stamina
        self.ability = ability
        self.deck_limit = deck_limit
        self.unique = unique
        self.flavor = flavor
        self.is_boss = is_boss

    @property
    def value(self) -> int:
        """Raw stat value — the greedy policies' proxy for what a unit costs."""
        return self.power + self.stamina

    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "power": self.power,
            "stamina": self.stamina,
            "ability": self.ability,
            "deck_limit": self.deck_limit,
            "unique": self.unique,
            "flavor": self.flavor,
            "is_boss": self.is_boss,
        }


def _load_catalog() -> tuple[dict[str, CardSpec], dict[str, dict]]:
    raw = json.loads(DATA_PATH.read_text())
    specs: dict[str, CardSpec] = {}
    for entry in raw["cards"]:
        specs[entry["name"]] = CardSpec(
            name=entry["name"],
            power=entry["power"],
            stamina=entry["stamina"],
            ability=entry["ability"],
            deck_limit=entry["deck_limit"],
            unique=entry["unique"],
            flavor=entry.get("flavor", ""),
        )
    specs[BOSS_NAME] = CardSpec(
        name=BOSS_NAME, power=BOSS_POWER, stamina=BOSS_STAMINA, ability=None,
        deck_limit=1, unique=True, is_boss=True,
        flavor="Every banner in the field bends toward one.")
    abilities = {a["id"]: a for a in raw["abilities"]}
    return specs, abilities


CATALOG, ABILITY_INFO = _load_catalog()

#: Every legal deck entry, repeated to its deck limit — the draft pool.
FULL_POOL = [
    name for name, spec in CATALOG.items()
    if not spec.is_boss for _ in range(spec.deck_limit)
]

CARD_VALUE = {name: spec.value for name, spec in CATALOG.items()}


class Card:
    """One runtime copy of a catalog card.

    `pow`/`sta` here are the card's *base* stats; a fielded unit's live stats
    live on its `Side` and are written back onto the card only when it leaves
    the field still alive (withdraw, rotate) so carryover state survives.

    `ab2` holds an ability a Warden stole for the duration it holds it. The
    snapshot rule from the original engine is preserved: a stolen ON_ENTRY
    ability does NOT fire on the duel it was stolen.
    """

    __slots__ = ("name", "pow", "sta", "ab", "spent", "ab2", "ab2_spent", "uid")

    _next_uid = 0

    def __init__(self, name: str) -> None:
        spec = CATALOG[name]
        self.name = name
        self.pow = spec.power
        self.sta = spec.stamina
        self.ab = spec.ability
        self.spent = False
        self.ab2: str | None = None
        self.ab2_spent = False
        Card._next_uid += 1
        self.uid = Card._next_uid

    @property
    def spec(self) -> CardSpec:
        return CATALOG[self.name]

    def abilities(self) -> list[tuple[str, bool, int]]:
        out: list[tuple[str, bool, int]] = []
        if self.ab is not None:
            out.append((self.ab, self.spent, 1))
        if self.ab2 is not None:
            out.append((self.ab2, self.ab2_spent, 2))
        return out

    def has_unspent(self, ability: str) -> bool:
        if self.ab == ability and not self.spent:
            return True
        return self.ab2 == ability and not self.ab2_spent

    def spend(self, ability: str) -> None:
        if self.ab == ability and not self.spent:
            self.spent = True
        elif self.ab2 == ability and not self.ab2_spent:
            self.ab2_spent = True

    def strip_abilities(self) -> None:
        """Second Wind's cost — the revived unit comes back hollow."""
        self.ab = None
        self.ab2 = None
        self.spent = True
        self.ab2_spent = True

    def reset_to_base(self) -> None:
        spec = self.spec
        self.pow = spec.power
        self.sta = spec.stamina

    def to_dict(self) -> dict:
        return {"uid": self.uid, "name": self.name, "power": self.pow,
                "stamina": self.sta, "ability": self.ab,
                "stolen": self.ab2, "spent": self.spent}


def make_deck(names: list[str]) -> list[Card]:
    return [Card(n) for n in names]


def random_deck_names(rng) -> list[str]:
    pool = FULL_POOL[:]
    rng.shuffle(pool)
    return pool[:DECK_SIZE]
