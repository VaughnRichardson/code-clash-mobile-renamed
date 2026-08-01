# CLAUDE.md — Card Clash (web)

**This directory is not the Godot project.** `../CLAUDE.md` governs
`testproject/` and `pipeline/` — its art pipeline, `.tres` authoring rules,
GDScript style and gate discipline do not apply here and should not be read as
constraints on this code. What carries over is the *design*, not the
implementation.

---

## What this is

Card Clash, extracted from the Godot RPG in `testproject/` and rebuilt as a
mobile web game: two players on two phones, or one player against the house,
over a WebSocket to a Python server. Reachable from anywhere through an ngrok
tunnel.

**This is a hard fork, not a replacement.** Both games exist and both are
live: the Godot mini-game (`testproject/scenes/card_game/`) remains the
in-world game the town's Card Master opens, and is not to be deleted. The fork
means the two are INDEPENDENT — no shared code, deliberately not kept in
rules-sync, free to diverge. This directory is where new Card Clash design
lands and is the reference implementation of the rules; that is a statement
about where work happens, not about the Godot game's status.

    engine/    the rules. Pure Python, no I/O, no framework.
    server/    FastAPI + WebSockets. Authoritative; owns every battle.
    client/    TypeScript + Vite. A renderer; holds no game state.
    data/      cards.json — the card catalogue.
    tests/     pytest (engine + server); client/tests is Playwright.

---

## Where the rules came from

`engine/battle.py` is a port of `testproject/tools/card_sim/card_sim.py`, which
was a hand-verified mirror of the Godot `BattleManager.gd` / `AbilityHandler.gd`.
The design it started from — ordered decks, blind hand-of-2 picks, leaders,
items, the boss — is specified and simulator-validated in
`testproject/docs/CARD_CLASH_SKILL_EXPRESSION.md`. Section references in the
code (§9.2, §10.1, §11.2 …) point there.

`tests/test_parity.py` drives both engines through the same battles and demands
identical results. **Do not change a duel rule without re-running it.**

---

## The four things that are easy to break

**1. Blind simultaneous picks are structural, not decorative.**
When both seats must decide, the engine yields ONE `Prompt` containing both
requests and cannot resume until both answers arrive. `server/match.py` buffers
the first answer and never forwards it. Splitting that into two sequential
prompts hands the second player a free counter-pick and invalidates every
balance number in the design doc — the original measured 2.6% for the first
picker when the second could see the commitment. Seven tests fail if you do it.

The one sanctioned exception is a foresight leader (Oracle) or the Scout item,
where the blind seat commits first in its own prompt. Matching foresight
cancels on both sides (§10.4).

**2. Seat symmetry.** Every ordered loop walks `Battle._order()`, which
alternates per duel, rather than seat 0 first. This was the PvP blocker in §9.2.
Two places where it was got wrong and would be again: the Resolve race (with a
Duelist on each side, whoever is *checked* first survives) and the leader
actives phase (whoever acts second sees the other's spend). A true mirror
measuring anything other than ~50% means a new asymmetry has crept in;
`test_balance.py` pins it, and self-tests that the check still detects the bias.

**3. Unit attrition is the one match clock.**
The web fork no longer has gates. The engine decides survival from every live
unit — deck plus hand plus an active unit — and the client tug bar must use that
same count. Do not make the bar a decorative score that can disagree with the
winner. Several leader dials differ from §10.1/§10.2 and each deviation is
commented with what it measured. Re-run `python3 -m engine.sim` after touching
any of them.

**4. The AI must not cheat.** `engine/policies.py` answers a `Request` and sees
only what a human client would. An AI that peeks invalidates every win rate the
simulator measured, including the ones this game is balanced against.

---

## The card layout is already specified — by the Godot game

The mobile client's cards are text rows in a box. That is NOT the house style. The Godot
mini-game's `CardDisplay.gd` defines the real treatment and has since before the fork:
a 160x220 (8:11) card with **full-bleed art that fills the card and crops**, a translucent
ability band over it at y 45-75%, a name strip at y 82-100%, and 26x26 power/stamina badges
in the bottom corners. Text over illustration, One Piece TCG style.

The mobile side now has a complete working set of 14 woodland-creature unit
illustrations, served at `/art/cards/...` and mapped in `data/art.json`.
`docs/ART_BRIEF.md` remains the prompt pack for maintaining that art direction;
dropping replacements at the same paths and aspects needs no code change.

**The battle screen now follows this treatment** (2026-07-29): full-bleed art, an ability
band, a name strip, and two struck discs flanking a `PWR · STA` caption — the original's
furniture, at the original's geometry. It took the badge SHAPE and rejected its red/green
hues, because this screen prints a forecast in green and red eight pixels below that row and
two greens a line apart meaning different things is the misread the review loop spent nine
rounds removing. The reasoning is written out at `statPair()` in `client/src/battle.ts`.

**Before touching the layout or the palette, read `docs/NEXT_SESSION.md` and
`docs/reference/README.md`.** The second records a capture of the real Godot game — nobody had
rendered it before that session — and one correction you would otherwise re-make: the build
called "very dark" was, measured like for like, *lighter* than the original. The gap was hue,
chroma and the size of the calm surface, never brightness. **A declared colour is not a
rendered colour; measure composited pixels.** `client/tools/frame_key.py` and
`client/tools/scene-weight.mjs` are the instruments, and the second self-tests in both
directions — its bands must accept the reference AND reject the build that was turned down.

The forecast line, which the Godot layout has no slot for, lives on a shelf hung under the
card. **The no-external-assets rule below was a prototype choice, not a platform limit —
amend it in the same change that adds real images.**

## Working on it

    pip install -r requirements.txt
    cd client && npm install && npm run build
    ./scripts/dev.sh                  # server + ngrok tunnel

    python3 -m pytest                 # engine + server (fast)
    python3 -m pytest -m slow         # the roster round robin
    cd client && npx playwright test  # real browsers, phone viewport
    python3 -m engine.sim             # balance tables

Playwright: this environment ships one pinned Chromium and blocks downloads, so
the config points at `/opt/pw-browsers/chromium` and uses a Chromium-based
phone profile. Do not run `npx playwright install`.

**Style.** Type annotations on public functions; comments explain *why*,
especially where a constant came from a measurement. Prefer adding a dial to
`leaders.py`/`items.py` over branching in `battle.py` — a leader should be a
data edit. The client uses no framework on purpose.

**Balance changes need evidence.** `engine/sim.py` is the instrument. Two traps
already paid for: measure with independent decks, not `mirror_decks=True` (a
mirror is a knife-edge where a +2 effect reads as +19), and give every cell in a
round robin its own seed (one shared seed moves every row together).
