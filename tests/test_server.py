"""Server contract tests, with the information rules front and centre.

The engine guarantees that a `Prompt` covering both seats is answered as a unit.
That guarantee only reaches the players if the *transport* also refuses to leak
one seat's commitment to the other, so most of what is checked here is what the
server declines to send.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from engine.decks import Deck, DeckError, starter_deck   # noqa: E402
from server.match import Match, Player, Room, make_room_code  # noqa: E402


class Recorder:
    """Stands in for a websocket; keeps everything the server sent."""

    def __init__(self) -> None:
        self.sent: list[dict] = []

    async def __call__(self, payload: dict) -> None:
        self.sent.append(payload)

    def last(self, kind: str) -> dict | None:
        for payload in reversed(self.sent):
            if payload.get("type") == kind:
                return payload
        return None

    def prompts(self) -> list[dict]:
        return [p["prompt"] for p in self.sent
                if p.get("type") == "update" and p.get("prompt")]


def _players() -> tuple[list[Player], Recorder, Recorder]:
    a, b = Recorder(), Recorder()
    return ([Player("Ana", starter_deck("blitz"), send=a),
             Player("Ben", starter_deck("reaper"), send=b)], a, b)


# ── deck validation ──────────────────────────────────────────────────────────

def test_starter_deck_is_legal():
    starter_deck().validate()


@pytest.mark.parametrize("mutate,fragment", [
    (lambda d: d["cards"].pop(), "exactly 30 cards"),
    (lambda d: d.update(cards=["Champion"] * 30), "limited to 1"),
    (lambda d: d.update(leader="nonesuch"), "choose a leader"),
    (lambda d: d.update(boss_slot=99), "first 24 positions"),
    (lambda d: d.update(cards=["Nonexistent"] * 30), "no card called"),
])
def test_illegal_decks_are_rejected_with_a_readable_reason(mutate, fragment):
    raw = starter_deck().to_dict()
    mutate(raw)
    with pytest.raises(DeckError) as excinfo:
        Deck.from_dict(raw)
    assert fragment in str(excinfo.value)


def test_the_boss_cannot_be_smuggled_in_as_a_card():
    raw = starter_deck().to_dict()
    raw["cards"][0] = "Warlord"
    with pytest.raises(DeckError):
        Deck.from_dict(raw)


# ── room codes ───────────────────────────────────────────────────────────────

def test_room_codes_avoid_ambiguous_characters():
    import random
    rng = random.Random(0)
    codes = "".join(make_room_code(rng) for _ in range(400))
    assert not set(codes) & set("IO01"), \
        "codes get read aloud and typed on phones"


# ── the information rules, over the wire ─────────────────────────────────────

def test_a_seat_is_only_ever_sent_its_own_prompt():
    players, a, b = _players()
    match = Match(players, seed=11)
    asyncio.run(match.start())

    for recorder, seat in ((a, 0), (b, 1)):
        for prompt in recorder.prompts():
            assert prompt["seat"] == seat, \
                "a seat was sent a prompt addressed to the other seat"


def test_a_committed_pick_is_not_forwarded_to_the_opponent():
    """The whole PvP design rests on this. Seat 0 commits; seat 1 must still
    be looking at exactly what it was looking at before."""
    players, a, b = _players()
    match = Match(players, seed=12)
    asyncio.run(match.start())

    before = len(b.sent)
    asyncio.run(match.answer(0, 0))

    new_for_b = b.sent[before:]
    blob = repr(new_for_b)
    assert "hand" not in blob or all(
        payload["state"]["them"].get("hand") is None
        for payload in new_for_b if payload.get("type") == "update"), \
        "seat 1 was sent seat 0's hand"
    # Seat 1's own prompt must not have changed out from under it.
    assert b.last("update")["prompt"]["seat"] == 1


def test_the_battle_does_not_advance_until_both_seats_commit():
    players, a, b = _players()
    match = Match(players, seed=13)
    asyncio.run(match.start())
    assert match.battle.duels == 0

    asyncio.run(match.answer(0, 0))
    assert all(side.active is None for side in match.battle.sides), \
        "one commitment must not field anything"
    assert match._waiting_on() == [1]

    asyncio.run(match.answer(1, 0))
    # With both commitments in, the duel resolves.
    assert match.battle.duels >= 1


def test_a_seat_cannot_answer_twice():
    players, _a, _b = _players()
    match = Match(players, seed=14)
    asyncio.run(match.start())
    asyncio.run(match.answer(0, 0))
    with pytest.raises(ValueError, match="already committed"):
        asyncio.run(match.answer(0, 1))


def test_a_seat_cannot_answer_a_prompt_it_was_not_asked():
    """Seat 1 has a carryover and is not being asked; it may not act anyway."""
    players, _a, _b = _players()
    match = Match(players, seed=15)
    asyncio.run(match.start())
    while match._prompt is not None and set(match._prompt.seats) == {0, 1}:
        asyncio.run(match.answer(0, 0))
        asyncio.run(match.answer(1, 0))
        if match.finished:
            pytest.skip("battle ended before a single-seat prompt appeared")
    assert match._prompt is not None
    idle = next(s for s in (0, 1) if s not in match._prompt.seats)
    with pytest.raises(ValueError, match="not asked"):
        asyncio.run(match.answer(idle, 0))


def test_out_of_range_answers_are_rejected_not_crashed():
    players, _a, _b = _players()
    match = Match(players, seed=16)
    asyncio.run(match.start())
    with pytest.raises(ValueError):
        asyncio.run(match.answer(0, 999))
        asyncio.run(match.answer(1, 0))


# ── the NPC ──────────────────────────────────────────────────────────────────

def test_an_npc_match_plays_itself_to_a_result():
    human = Recorder()
    players = [Player("Ana", starter_deck("oracle"), send=human),
               Player("House", starter_deck("sentinel"), send=None,
                      difficulty="veteran")]
    match = Match(players, seed=17)
    asyncio.run(match.start())

    guard = 0
    while not match.finished:
        guard += 1
        assert guard < 500, "NPC match failed to converge"
        prompt = match._prompt
        assert prompt is not None
        assert match._waiting_on() == [0], \
            "the NPC must answer in-process, never leave the human waiting"
        request = next(r for r in prompt.requests if r.seat == 0)
        asyncio.run(match.answer(0, _first_legal(request)))

    assert match.battle.result is not None
    assert human.last("update")["state"]["result"] is not None


def _first_legal(request):
    if request.kind in ("pick", "withdraw"):
        return 0
    if request.kind == "shop":
        return None
    return True


# ── replay ───────────────────────────────────────────────────────────────────

def test_the_replay_log_captures_the_seed_and_every_answer():
    players, _a, _b = _players()
    match = Match(players, seed=18)
    asyncio.run(match.start())
    asyncio.run(match.answer(0, 0))
    asyncio.run(match.answer(1, 0))

    log = match.log.to_dict()
    assert log["seed"] == 18
    assert len(log["decks"]) == 2
    assert log["answers"], "answers must be recorded in order"
    assert all({"seat", "kind", "value"} <= set(a) for a in log["answers"])


# ── rooms ────────────────────────────────────────────────────────────────────

def test_a_room_holds_two_seats_and_no_more():
    room = Room("ABCD")
    room.add(Player("Ana", starter_deck(), send=Recorder()))
    room.add(Player("Ben", starter_deck(), send=Recorder()))
    assert room.full
    with pytest.raises(ValueError, match="full"):
        room.add(Player("Cal", starter_deck(), send=Recorder()))


def test_a_dropped_socket_does_not_kill_the_battle():
    async def explode(_payload):
        raise ConnectionResetError("client vanished")

    players = [Player("Ana", starter_deck(), send=explode),
               Player("Ben", starter_deck(), send=Recorder())]
    match = Match(players, seed=19)
    asyncio.run(match.start())
    assert players[0].connected is False
    assert match._prompt is not None, "the match must survive the drop"
