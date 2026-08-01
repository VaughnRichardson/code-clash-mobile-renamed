# Card Clash mobile mockup specification

## Goal

Build a screen-faithful, playable mockup around the supplied mobile references. The mockup must demonstrate the complete player loop without requiring a second human or a production matchmaking service:

`Home → Campaign → Deck / Collection → AI campaign battle → Result`

and the competing loop:

`Home → Compete → Lobby → Ready / leave`

The battle engine remains the authoritative rules implementation. The mockup owns navigation, presentation state, and simulated AI/lobby events.

## Reference screens

- Home: three large image-led entries: Campaign, Collection, Compete; compact profile affordance.
- Collection / deckbuilder: current deck name and count, score rail, leader picker, four-column card pool, add/remove affordances, and a bottom deck tray.
- Campaign battle setup: the selected deck and campaign opponent are visible before entering the playable duel.
- Compete lobby: room code, player/AI seats, ready state, and exit action.

## Interaction contract

- Every primary card or tile is keyboard reachable and has a text label.
- Home tiles route to their screens without a server round-trip.
- Collection selection updates the leader, card counts, and deck tray immediately; save returns to the previous screen.
- Campaign difficulty changes the coach copy and AI turn pacing; start enters the existing battle screen through a mock adapter.
- Compete creates a local room code, toggles ready, simulates an opponent joining, and supports leave/back.
- Reset/replay returns to the home screen with the selected deck preserved.

## Architecture

The mockup is split into four boundaries:

1. `mockup/state.ts` — serializable state and pure transitions.
2. `mockup/assets.ts` — image paths and card/leader display data.
3. `mockup/screens/*` — screen renderers; each receives state and callbacks.
4. `mockup/shell.ts` — single mount point, routing, and shared navigation.

The existing `BattleScreen` is not copied or forked. The campaign adapter will provide it with a local session later; collection and lobby remain independent of battle rendering.

## Scaffold acceptance criteria

- A single `MockupShell` can mount into `#app`.
- Screen transitions are explicit (`home`, `collection`, `campaign`, `compete`, `battle`, `result`).
- Screens do not mutate each other’s DOM directly.
- Assets are referenced through one manifest so the supplied art can be swapped without screen rewrites.
- The first scaffold build passes before feature screens are filled in.
