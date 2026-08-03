"""One battle between two seats, and the rooms that hold them.

This module is where "blind simultaneous picks" stops being a design intention
and becomes a property of the system. The engine hands out a `Prompt` covering
both seats; `Match` buffers each answer as it arrives and only resumes the
battle once both are in. A seat's committed choice is never included in
anything sent to the other seat, and the engine itself cannot observe one
answer before the other because it is suspended until `submit` gets both.

Everything here is authoritative. A client sends `answer` and nothing else —
never state, never a card, never a result.
"""

from __future__ import annotations

import asyncio
import random
import string
from dataclasses import dataclass, field

from engine import policies as policies_mod
from engine.battle import Battle
from engine.decks import Deck

ROOM_CODE_LENGTH = 4
# I, O, 0 and 1 are omitted — codes get read aloud and typed on phones.
ROOM_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def make_room_code(rng: random.Random) -> str:
    return "".join(rng.choice(ROOM_ALPHABET) for _ in range(ROOM_CODE_LENGTH))


@dataclass
class Player:
    """A seat. `send` is None for the AI, which is driven in-process."""

    name: str
    deck: Deck
    send: object | None = None      # async callable, or None for the NPC
    close: object | None = None     # async websocket close callable
    difficulty: str = "veteran"
    connected: bool = True

    @property
    def is_npc(self) -> bool:
        return self.send is None


@dataclass
class ReplayLog:
    """Seed plus every answer, in order. Enough to replay a match exactly.

    Cheap to keep and worth far more than it costs: any reported bug becomes a
    deterministic test case instead of a description.
    """

    seed: int
    decks: list[dict] = field(default_factory=list)
    answers: list[dict] = field(default_factory=list)
    result: dict | None = None

    def record(self, seat: int, kind: str, value) -> None:
        self.answers.append({"seat": seat, "kind": kind, "value": value})

    def to_dict(self) -> dict:
        return {"seed": self.seed, "decks": self.decks,
                "answers": self.answers, "result": self.result}


class Match:
    """Runs one battle. Not thread-safe; guarded by an asyncio lock."""

    def __init__(self, players: list[Player], seed: int | None = None) -> None:
        if len(players) != 2:
            raise ValueError("a match needs exactly two seats")
        self.players = players
        self.seed = seed if seed is not None else random.randrange(1 << 30)
        self.rng = random.Random(self.seed ^ 0xA11CE)
        self.battle = Battle(
            [p.deck.cards for p in players],
            leader_ids=[p.deck.leader for p in players],
            boss_slots=[p.deck.boss_slot for p in players],
            seed=self.seed, seat_order="alternate", shop=True)
        self.log = ReplayLog(seed=self.seed,
                             decks=[p.deck.to_dict() for p in players])
        self._prompt = None
        self._buffered: dict[int, object] = {}
        self._sent_events = 0
        self._lock = asyncio.Lock()
        self.started = False
        self.finished = False

    # ── lifecycle ──

    async def start(self) -> None:
        async with self._lock:
            if self.started:
                return
            self.started = True
            self._prompt = self.battle.start()
            await self._settle()

    async def answer(self, seat: int, value) -> None:
        """Record one seat's choice. Resumes the battle only when both are in.

        A seat may not answer twice, and may not answer a prompt it was not
        asked — both would be an attempt to act out of turn.
        """
        async with self._lock:
            if self.finished:
                raise ValueError("this battle is over")
            if self._prompt is None:
                raise ValueError("nothing to answer right now")
            if seat not in self._prompt.seats:
                raise ValueError("you were not asked for this decision")
            if seat in self._buffered:
                raise ValueError("you have already committed this decision")
            kind = next(r.kind for r in self._prompt.requests
                        if r.seat == seat)
            self._buffered[seat] = value
            self.log.record(seat, kind, value)
            await self._settle()

    async def _settle(self) -> None:
        """Answer for the NPC, resume while every seat has committed, and push
        the results out. Loops because resuming usually raises a new prompt."""
        while self._prompt is not None:
            for request in self._prompt.requests:
                player = self.players[request.seat]
                if player.is_npc and request.seat not in self._buffered:
                    policy = policies_mod.make_policy(player.difficulty)
                    choice = policy(request, self.rng)
                    self._buffered[request.seat] = choice
                    self.log.record(request.seat, request.kind, choice)

            if set(self._buffered) != set(self._prompt.seats):
                break   # still waiting on a human — hold the battle here

            answers, self._buffered = self._buffered, {}
            self._prompt = self.battle.submit(answers)

        if self._prompt is None and self.battle.result is not None:
            self.finished = True
            self.log.result = self.battle.result.to_dict()
        await self._broadcast()

    # ── outbound ──

    async def _broadcast(self) -> None:
        events = self.battle.events[self._sent_events:]
        self._sent_events = len(self.battle.events)
        for seat, player in enumerate(self.players):
            if player.is_npc or not player.connected:
                continue
            payload = {
                "type": "update",
                "state": self.battle.public_state(seat),
                "events": events,
                "waiting_on": self._waiting_on(),
                "prompt": self._prompt_for(seat),
            }
            await self._safe_send(player, payload)

    def _prompt_for(self, seat: int) -> dict | None:
        """Only this seat's own request — never the other seat's.

        The opponent's *pending* request is not forwarded either. Knowing which
        cards the other player is choosing between is itself information the
        blind-pick rule does not grant.
        """
        if self._prompt is None or seat in self._buffered:
            return None
        for request in self._prompt.requests:
            if request.seat == seat:
                return request.to_dict()
        return None

    def _waiting_on(self) -> list[int]:
        if self._prompt is None:
            return []
        return [s for s in self._prompt.seats if s not in self._buffered]

    async def _safe_send(self, player: Player, payload: dict) -> None:
        try:
            await player.send(payload)       # type: ignore[misc]
        except Exception:
            # A dropped socket must not take the battle down with it; the
            # socket is closed explicitly so the app cleanup path releases the
            # session name and tears down an abandoned PvP room.
            player.connected = False
            if player.close is not None:
                try:
                    await player.close()      # type: ignore[misc]
                except Exception:
                    pass


class Room:
    """A code, up to two seats, and the match they are playing."""

    def __init__(self, code: str, vs_npc: bool = False,
                 difficulty: str = "veteran") -> None:
        self.code = code
        self.vs_npc = vs_npc
        self.difficulty = difficulty
        self.players: list[Player] = []
        self.match: Match | None = None

    @property
    def full(self) -> bool:
        return len(self.players) >= 2

    def add(self, player: Player) -> int:
        if self.full:
            raise ValueError("this room is already full")
        self.players.append(player)
        return len(self.players) - 1

    def seat_of(self, player: Player) -> int:
        return self.players.index(player)

    def lobby_payload(self) -> dict:
        return {
            "type": "lobby",
            "code": self.code,
            "vs_npc": self.vs_npc,
            "players": [{"name": p.name, "npc": p.is_npc,
                         "connected": p.connected} for p in self.players],
            "ready": self.full,
        }

    async def broadcast_lobby(self) -> None:
        payload = self.lobby_payload()
        for player in self.players:
            if player.is_npc or not player.connected:
                continue
            try:
                await player.send(payload)   # type: ignore[misc]
            except Exception:
                player.connected = False
                if player.close is not None:
                    try:
                        await player.close()  # type: ignore[misc]
                    except Exception:
                        pass
