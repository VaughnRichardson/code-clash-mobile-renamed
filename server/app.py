"""Card Clash server: static client, catalogue endpoints, and the game socket.

Authoritative by construction. The only thing a client may send that affects a
battle is `{"type": "answer", "value": ...}`; the server decides what that
means, and `match.Match` decides when it is allowed to matter.

Run it:  python3 -m uvicorn server.app:app --host 0.0.0.0 --port 8000
Or:      ./scripts/dev.sh          (adds an ngrok tunnel for phones)
"""

from __future__ import annotations

import json
import logging
import random
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from engine import cards as cards_mod
from engine import items as items_mod
from engine.decks import Deck, DeckError, catalog_payload, starter_deck
from engine.policies import DIFFICULTIES

from .match import Match, Player, Room, make_room_code

log = logging.getLogger("cardclash")

ROOT = Path(__file__).resolve().parents[1]
CLIENT_DIST = ROOT / "client" / "dist"

app = FastAPI(title="Card Clash")

#: Live rooms by code. In-memory on purpose — a prototype hosting a handful of
#: friends through a tunnel does not need a database, and a restart clearing
#: the lobby is the correct behaviour for session-only play.
ROOMS: dict[str, Room] = {}
# Names are session identities, not accounts. They are reserved only while a
# socket is connected and are released in the websocket cleanup path.
ACTIVE_NAMES: set[str] = set()
_rng = random.Random()

MAX_ROOMS = 200


# ── HTTP ─────────────────────────────────────────────────────────────────────

@app.get("/api/catalog")
async def get_catalog() -> JSONResponse:
    payload = catalog_payload()
    payload["items"] = items_mod.catalog_payload()
    # Ability text, so the client can explain a keyword where it is shown
    # instead of printing a bare word like "Resolve" at the player.
    payload["abilities"] = list(cards_mod.ABILITY_INFO.values())
    payload["difficulties"] = list(DIFFICULTIES)
    payload["starter_deck"] = starter_deck().to_dict()
    return JSONResponse(payload)


@app.get("/api/health")
async def health() -> JSONResponse:
    return JSONResponse({"ok": True, "rooms": len(ROOMS)})


# ── WebSocket protocol ───────────────────────────────────────────────────────

async def _send(ws: WebSocket, payload: dict) -> None:
    await ws.send_text(json.dumps(payload))


async def _error(ws: WebSocket, message: str) -> None:
    await _send(ws, {"type": "error", "message": message})


def _session_name(raw: object) -> str:
    """Validate the display name used for this connection's session."""
    name = str(raw or "").strip()
    if not name:
        raise ValueError("choose a name before joining a room")
    if len(name) > 20:
        raise ValueError("your name must be 20 characters or fewer")
    if name.casefold() in ACTIVE_NAMES:
        raise ValueError("that name is already in use")
    return name


def _reap_rooms() -> None:
    """Drop finished and abandoned rooms. Called on each create."""
    stale = [
        code for code, room in ROOMS.items()
        if (room.match is not None and room.match.finished)
        or all(not p.connected for p in room.players if not p.is_npc)
    ]
    for code in stale:
        ROOMS.pop(code, None)


@app.websocket("/ws")
async def game_socket(ws: WebSocket) -> None:
    await ws.accept()
    room: Room | None = None
    player: Player | None = None
    seat: int | None = None

    async def send(payload: dict) -> None:
        await _send(ws, payload)

    try:
        while True:
            try:
                message = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                await _error(ws, "that was not valid JSON")
                continue
            if not isinstance(message, dict):
                await _error(ws, "expected an object")
                continue

            kind = message.get("type")

            if kind in ("create", "join"):
                if room is not None:
                    await _error(ws, "you are already in a room")
                    continue
                try:
                    deck = Deck.from_dict(message.get("deck") or {})
                except DeckError as exc:
                    await _error(ws, str(exc))
                    continue

                try:
                    name = _session_name(message.get("name"))
                except ValueError as exc:
                    await _error(ws, str(exc))
                    continue
                player = Player(name=name, deck=deck, send=send, close=ws.close)

                if kind == "create":
                    _reap_rooms()
                    if len(ROOMS) >= MAX_ROOMS:
                        await _error(ws, "the server is full, try again later")
                        continue
                    vs_npc = bool(message.get("vs_npc"))
                    difficulty = str(message.get("difficulty") or "veteran")
                    if difficulty not in DIFFICULTIES:
                        await _error(ws, f"unknown difficulty {difficulty!r}")
                        continue
                    code = make_room_code(_rng)
                    while code in ROOMS:
                        code = make_room_code(_rng)
                    room = Room(code, vs_npc=vs_npc, difficulty=difficulty)
                    ROOMS[code] = room
                    seat = room.add(player)
                    if vs_npc:
                        room.add(Player(name=f"{difficulty.title()} AI",
                                        deck=starter_deck("sentinel"),
                                        send=None, difficulty=difficulty))
                else:
                    code = str(message.get("code") or "").upper().strip()
                    room = ROOMS.get(code)
                    if room is None:
                        await _error(ws, f"no room called {code!r}")
                        room = None
                        continue
                    if room.full:
                        await _error(ws, "that room is already full")
                        room = None
                        continue
                    seat = room.add(player)

                ACTIVE_NAMES.add(name.casefold())

                await room.broadcast_lobby()
                if room.full and room.match is None:
                    room.match = Match(room.players)
                    await room.match.start()
                continue

            if room is None or player is None or seat is None:
                await _error(ws, "join a room first")
                continue

            if kind == "answer":
                if room.match is None:
                    await _error(ws, "the battle has not started")
                    continue
                try:
                    await room.match.answer(seat, message.get("value"))
                except ValueError as exc:
                    await _error(ws, str(exc))
                continue

            if kind == "replay":
                if room.match is None or not room.match.finished:
                    await _error(ws, "no finished battle to replay")
                    continue
                await send({"type": "replay",
                            "log": room.match.log.to_dict()})
                continue

            if kind == "ping":
                await send({"type": "pong"})
                continue

            await _error(ws, f"unknown message type {kind!r}")

    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("socket failed")
    finally:
        if player is not None:
            player.connected = False
            ACTIVE_NAMES.discard(player.name.casefold())
        # A live PvP match cannot safely replace a seat: the authoritative
        # battle already owns both decks and seats. End it explicitly so the
        # remaining browser is not left waiting for a prompt that can never be
        # answered, and free the room code for a new session.
        if (room is not None and room.match is not None
                and not room.match.finished and player is not None):
            room.match.finished = True
            for other in room.players:
                if other is player or other.is_npc or not other.connected:
                    continue
                try:
                    await other.send({
                        "type": "error",
                        "message": f"{player.name} disconnected; the battle ended",
                    })  # type: ignore[misc]
                except Exception:
                    other.connected = False
            ROOMS.pop(room.code, None)
            room = None
        if room is not None:
            try:
                await room.broadcast_lobby()
            except Exception:
                pass
            if all(not p.connected for p in room.players if not p.is_npc):
                ROOMS.pop(room.code, None)


# ── static client, mounted last so /api and /ws win ──────────────────────────

if CLIENT_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=CLIENT_DIST / "assets"),
              name="assets")
    # Vite copies `client/public/` to the root of `dist/`, so artwork lands at
    # `dist/art/...`. Without this mount it 404s in a production build while
    # working fine under `npm run dev` — the classic way art breaks only once
    # it is deployed.
    if (CLIENT_DIST / "art").is_dir():
        app.mount("/art", StaticFiles(directory=CLIENT_DIST / "art"),
                  name="art")
    if (CLIENT_DIST / "mockup").is_dir():
        app.mount("/mockup", StaticFiles(directory=CLIENT_DIST / "mockup"),
                  name="mockup")

    @app.get("/")
    async def index() -> FileResponse:
        return FileResponse(CLIENT_DIST / "index.html")
else:  # pragma: no cover - only hit before the client is built
    @app.get("/")
    async def index_missing() -> JSONResponse:
        return JSONResponse(
            {"error": "client not built", "fix": "cd client && npm run build"},
            status_code=503)
