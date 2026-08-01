# Next session - Card Clash visual board and artifact checkpoint

Read CLAUDE.md first, then this file. Work from main.

## 2026-07-31 checkpoint — green-tint fix shipped; home/deck-builder redesign approved on mockups, not yet implemented

**Shipped this session** (`client/src/styles.css`, merged to main): the battle
screen (`#app:has(> .table)`) painted a translucent forest-green wash over the
woodland background art — every other screen used the plain warm background,
so battle alone read as green-filtered. The wash itself is load-bearing (light
inks like `--good` chip labels need a dark ground to pass contrast against the
bare woodland image — confirmed by removing it outright and watching
`tools/contrast-check.mjs` regress `chip label` from 4.53:1 to 1.46:1), so the
fix re-hued it from forest green to a hue-neutral warm brown at the same
darkening strength rather than deleting it. Re-verified with
`contrast-check.mjs` (same pass/fail set as before the change, `chip label`
actually improved to 6.17:1) — no regressions.

**Designed and owner-approved via static HTML mockups (screenshots only,
`/tmp` scratch — nothing below is implemented in `client/src/` yet):**

- **Home screen**: three stacked full-bleed cards — Campaign, Collection,
  Compete (in that order) — each showing only its name over a background
  image, no icons, no per-card description. Campaign/Compete use deity
  portraits (Ashen Forge = red/Campaign, Dawn Arbiter = gold/Compete) cropped
  from an owner-supplied reference sheet; neither the deity source images nor
  any other deity art exist in the repo yet. Collection (new) uses
  `client/public/art/cards/guardian.png` as a placeholder — that file is
  actually a hedgehog, not a porcupine; there is no porcupine art in the
  current 14-illustration set. Tagline eyebrow text ("A pocket duel of nerve
  and order...") is removed; the "Card Clash" wordmark stays. A circular
  player-profile icon is fixed bottom-right — it is only an entry-point
  affordance, no profile/account screen has been designed.
- **Deck builder**: complete restructure from the shipped `deckbuilder.ts`.
  "Your deck" (all 30 cards, real card art, in the card-pool visual style) is
  the default screen — no separate leader-choice or battle-order-list step.
  Order is set by dragging a tile in front of / behind another (the order
  number is a read-out of position, not a separate control). Power/stamina
  totals render as a tug-of-war bar using the game's own sword/shield icons
  (`client/public/art/icons/power.png` / `stamina.png`), not raw numbers
  alone. Leader selection, card pool, and deck name/switch/duplicate/save all
  live in a bottom sheet that peeks collapsed by default and expands over a
  scrim; the sheet's name field + action buttons are pinned in a non-scrolling
  header band. All instructional copy ("tap to add a copy", "drag to
  reorder") is removed — show, don't tell.

**Explicit open items before any of the above is real** (do not start
implementation without resolving these, or without an explicit decision to
defer them):

1. Deity art (Ashen Forge / Dawn Arbiter) has no source files in the repo —
   only crops crudely lifted from a reference sheet the owner pasted into
   chat. Needs real assets sourced/authored at a usable resolution.
2. Collection's "porcupine" card needs either real porcupine art or an
   explicit owner sign-off that the hedgehog (`guardian.png`) stands in
   permanently.
3. Player profile / account screen does not exist — only the home-screen
   entry icon does.
4. Difficulty selection (house temperament) and room-code join have no home
   now that the mode cards are art + label only; they need a landing spot
   (likely inside Campaign's/Compete's own flow after tapping the card).
5. Real drag-and-drop is unimplemented: the 30-card reorder grid and the
   bottom sheet's expand/collapse gesture are both static screenshots, not
   working interaction code.
6. Multi-deck save/name/switch has no storage model. Today's shipped
   `deckbuilder.ts` persists exactly one unnamed deck under
   `localStorage['cardclash.deck.v1']`; naming, duplicating, and switching
   between saved decks all require a new schema.

None of the above six are blocked on each other in a strict order except that
(4) should be resolved before the home screen is actually built, since it
changes what tapping Campaign/Compete does.

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
