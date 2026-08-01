# Next session - Card Clash visual board and artifact checkpoint

Read CLAUDE.md first, then this file. Work from main.

## Owner direction

The current request is a visual pass on the battle-choice screen:

- Let the table explain ownership spatially. The far deck is on the left; the
  near deck is on the right. Each discard pile sits above its own deck, and its
  leader card sits on the opposite side of that lane.
- The shared coral-versus-blue tug is the duel and score surface. Do not add
  duplicate VS, duel-number, player, opponent, or score copy around it.
- Keep the open near field visibly card-shaped. The hand card should glow in
  the colour of its edge on hover, press, and drag; tap remains the accessible
  fallback for the same action.
- Keep the board bright, cozy, painterly, cute, and lighthearted. The woodland
  animal illustrations are working art, not a mandate to regenerate them.
- This workstream remains presentation-first. Do not change the battle engine,
  balance, AI policy, networking, shop rules, or match pacing.

## What landed in this checkpoint

- client/src/battle.ts now renders a spatial near/far board:
  - draw and discard piles are physical card stacks with live counts;
  - the near lane is mirrored, with the leader on the left and draw pile on
    the right;
  - the empty near field is a real card-shaped drop target;
  - redundant visible prompt/ownership copy is removed while accessible names
    remain;
  - hand cards support tap or pointer drag onto the open field.
- client/src/styles.css contains the late-cascade spatial battle board
  section. It owns the mirrored lanes, mini leader cards, physical piles,
  numeric tug, compact portrait variants, and card glow/drag states. Keep new
  battle-screen overrides in this section so older layout rules do not win
  accidentally.
- Eight cropped leader portraits are present under client/public/art/leaders/
  and are mapped through data/art.json and client/src/art.ts:

  | Leader | Portrait |
  | --- | --- |
  | Blitz | blitz.jpg |
  | Doomsayer | doomsayer.jpg |
  | Gravekeeper | gravekeeper.jpg |
  | Momentum | momentum.jpg |
  | Oracle | oracle.jpg |
  | Ritualist | ritualist.jpg |
  | Second Wind | second_wind.jpg |
  | Sentinel | sentinel.jpg |

  Giant-Slayer and Reaper continue to use their existing PNG assets.

## Interactive artifact

The in-conversation game artifact is packaged with the repository:

- docs/artifacts/card-clash-game.fragment.html is the editable inline
  fragment.
- docs/artifacts/card-clash-game.html is the rendered standalone wrapper.

It is a playable visual core of the real battle: ordered decks, hand-of-two,
real card stats and core abilities, Second Wind, Sentinel charges, survivor
carryover, discard piles, and live-unit tug scoring. It deliberately omits the
network lobby and shop/tactics prompts, so do not describe it as the
authoritative production match client.

## Verification for this checkpoint

Completed after the spatial-board, portrait, and artifact changes:

    cd client && npm run build
    result: passed

    python -m pytest
    result: 89 passed, 1 deselected

    cd client && npx playwright test
    result: 11 passed

The artifact itself was exercised at 390px and 320px widths: tap and drag both
field the opening Vanguard, the tug/discards/decks advance, no horizontal
overflow was observed at 320px, all embedded art loaded, and the browser
console was clean.

## Suggested next work

1. Start from captures of the opening, two-card choice, mid-battle survivor,
   and result states. Check 390x844 and 320x568 before changing the hierarchy.
2. Refine only the materials and spacing that remain visually noisy. Preserve
   the explicit positional language of deck, discard, leader, field, and hand.
3. If replacing artwork, retain the current 8:11 crop and update
   data/art.json plus client/src/art.ts together.
4. Re-run the three commands above after any client/layout change.

Known caveat: the standalone artifact is for inspection and interaction; the
web game's server remains authoritative for production play.
