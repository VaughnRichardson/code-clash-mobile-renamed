# Card Clash

A session-based autobattler for phones. Build a 30-card deck **in the order you
want to play it**, pick a leader, and fight — against the house, or against a
friend who opens a link and types a four-letter room code.

Forked out of the Godot RPG in `../testproject/` and rebuilt as a web game.
Both games exist: the Godot mini-game is still there, still opened by the
town's Card Master. The fork means the two are independent and free to
diverge — this is where new Card Clash design lands.

```
engine/    the rules — pure Python, no I/O
server/    FastAPI + WebSockets, authoritative
client/    TypeScript + Vite, mobile-first, no framework
```

## Running it

```sh
pip install -r requirements.txt
./scripts/dev.sh            # builds the client, serves it, opens an ngrok tunnel
./scripts/dev.sh --local    # no tunnel — same-wifi or desktop
```

Open the printed URL on a phone. To play someone else: **Create a room**, read
them the code, they type it in on theirs.

## How the game works

**Deck order is play order.** There is no shuffle. The sequence you build is the
sequence you fight in, so ordering *is* the strategy — front-load your strength
or hoard it for the late game. Both are viable; that is measured, not assumed.

**Picks are blind and simultaneous.** Each duel you are dealt a hand of 2 and
choose one to field. So does your opponent, at the same moment, without seeing
your choice. Two units trade blows until one falls; the survivor stays out and
fights on with the damage it has taken.

**One way to win.** Outlast the enemy's units. Every unit still in a deck, hand,
or on the field counts toward a single shared tug-of-war bar. Winning exchanges
pull more of that bar into your colour; the last side with a unit wins.

**Leaders** are your identity: 10 of them, one per genre — survive a death,
heal off an upset kill, bank withdrawals, see the enemy's pick, recover the
fallen. Most run on a scarce earn condition feeding a small pool of charges.

**Gold and the shop.** Every duel you win pays 1 gold. Between duels you can buy
a Curse, a Ward, or cheap scouting. The goods that matter act on the duel;
information is deliberately cheap, because blind picks cap what it can be
worth.

**The boss.** One 10/8 unit, placed at a position you choose in the first 24. It
takes over a slot rather than adding one, so fielding it costs you a card.

## Development

```sh
python3 -m pytest                 # engine + server
python3 -m pytest -m slow         # leader round robin
cd client && npx playwright test  # real browsers at a phone viewport
python3 -m engine.sim             # balance tables
python3 -m engine.sim seat-bias   # ...one experiment at a time
```

`engine/sim.py` is a Monte-Carlo harness carried over from the design work. It
is the instrument for any balance claim — re-run it after changing a rule
constant, because the numbers in the design doc describe the rules as they were,
not as they are.

See `CLAUDE.md` for the architecture and the four things that are easy to break.

## Where the design came from

The rules and their tuning are documented in
`../testproject/docs/CARD_CLASH_SKILL_EXPRESSION.md`, a simulator-driven study
of what makes this game reward skill. Code comments cite it by section.

Three of its conclusions were reopened here, with the evidence in the relevant
module docstring:

- **Unit attrition is now the only match clock.** The web fork deliberately
  removed the inherited gate race. The public balance bar and the authoritative
  victory check both count the same live population: deck plus hand plus any
  active unit.
- **Several leader dials differ**, including two the doc had flagged for "one
  more pass during implementation". Reaper's shipped as specced could never
  afford its own active. The roster now spans 9.5 points, down from 33.5.
- **The first-seat bias is fixed**, not just logged. Entry abilities used to
  resolve player-first; who resolves first now alternates each duel. A true
  mirror measured 38% for seat 0 before and ~50% after.
