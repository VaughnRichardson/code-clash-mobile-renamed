"""Deck legality.

A deck is an *ordered* list — build order is play order, which is the core of
the 2026-07-27 rework (`CARD_CLASH_SKILL_EXPRESSION.md` §9.3 item 4). It also
carries a leader and, optionally, a boss placement.

Validation lives in the engine rather than the server because it is a rule, not
a transport concern: an illegal deck is illegal for the AI opponent too.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import leaders as leaders_mod
from .cards import BOSS_MAX_SLOT, CATALOG, DECK_SIZE, FULL_POOL


class DeckError(ValueError):
    """A deck that cannot legally be played, with a player-readable reason."""


@dataclass
class Deck:
    cards: list[str]
    leader: str
    boss_slot: int | None = None
    name: str = "Untitled"

    def to_dict(self) -> dict:
        return {"cards": self.cards, "leader": self.leader,
                "boss_slot": self.boss_slot, "name": self.name}

    @classmethod
    def from_dict(cls, raw: dict) -> "Deck":
        if not isinstance(raw, dict):
            raise DeckError("a deck must be an object")
        cards = raw.get("cards")
        if not isinstance(cards, list) or not all(isinstance(c, str)
                                                  for c in cards):
            raise DeckError("`cards` must be a list of card names")
        boss = raw.get("boss_slot")
        if boss is not None and not isinstance(boss, int):
            raise DeckError("`boss_slot` must be a whole number or null")
        deck = cls(cards=list(cards), leader=str(raw.get("leader") or ""),
                   boss_slot=boss, name=str(raw.get("name") or "Untitled")[:40])
        deck.validate()
        return deck


def validate(deck: Deck) -> None:
    if len(deck.cards) != DECK_SIZE:
        raise DeckError(
            f"a deck is exactly {DECK_SIZE} cards — this one has "
            f"{len(deck.cards)}")

    counts: dict[str, int] = {}
    for name in deck.cards:
        spec = CATALOG.get(name)
        if spec is None:
            raise DeckError(f"there is no card called {name!r}")
        if spec.is_boss:
            raise DeckError(
                "the boss is placed with `boss_slot`, not listed as a card")
        counts[name] = counts.get(name, 0) + 1

    for name, count in counts.items():
        limit = CATALOG[name].deck_limit
        if count > limit:
            raise DeckError(
                f"{name} is limited to {limit} "
                f"cop{'y' if limit == 1 else 'ies'} — this deck has {count}")

    if deck.leader not in leaders_mod.ROSTER:
        raise DeckError("choose a leader before playing")

    if deck.boss_slot is not None:
        if not 0 <= deck.boss_slot < BOSS_MAX_SLOT:
            raise DeckError(
                f"the boss must be placed in the first {BOSS_MAX_SLOT} "
                "positions — later than that and the battle usually ends "
                "before it ever fights")


Deck.validate = validate  # type: ignore[attr-defined]


def starter_deck(leader: str = leaders_mod.DEFAULT_LEADER) -> Deck:
    """A legal, reasonable deck so a new player can play immediately.

    Ordered defensively — walls and feeders early, carries late — which §11.2
    measured as one of the two viable archetypes.
    """
    priority = {
        "Vanguard": 0, "Martyr": 1, "Guardian": 2, "Fortress": 3, "Wraith": 4,
        "Duelist": 5, "Warden": 6, "Soldier": 7, "Rallier": 8, "Grunt": 9,
        "Brute": 10, "Champion": 11, "Berserker": 12,
    }
    pool = sorted(FULL_POOL, key=lambda n: priority[n])
    return Deck(cards=pool[:DECK_SIZE], leader=leader, boss_slot=6,
                name="Starter")


def catalog_payload() -> dict:
    """Everything a client needs to render a deck builder."""
    return {
        "cards": [spec.to_dict() for spec in CATALOG.values()
                  if not spec.is_boss],
        "boss": next(spec.to_dict() for spec in CATALOG.values()
                     if spec.is_boss),
        "deck_size": DECK_SIZE,
        "boss_max_slot": BOSS_MAX_SLOT,
        "leaders": leaders_mod.roster_payload(),
    }
