# Next session — Card Clash collaborative visual pass

Read `CLAUDE.md` first, then this file. Work from `main`.

## 2026-08-02 checkpoint

The owner completed a screen-by-screen improvement loop covering Home,
Campaign, Deck Creator, Compete, Room Lobby, and the opening Battle state. The
approved changes are implemented in both the normal online client and the
`?mockup=1` offline review flow. Keep those two paths visually and behaviorally
in lockstep when making future changes.

## 2026-08-03 deck-order and mockup-battle update

- **Deck Creator now opens on Deck order.** It renders every individual card
  as an unstacked portrait tile, numbered in draw order. The tile's large grip
  supports native desktop drag-and-drop, pointer-based touch/pen reordering,
  and keyboard arrow-key movement. `Use this deck and return` persists that
  exact order; deck order is play order.
- **Card pool remains a real collapsible sheet.** It is collapsed by default
  and opens from the `Open card pool` handle. Leader selection, deck choice,
  duplicate/new deck actions, add/remove controls, and validation remain in
  that sheet; no screenshot/peek or separate route is used.
- **Campaign visibility is explicit.** The Campaign action now reads
  `Edit deck · <selected deck name>` and updates immediately after a saved
  deck choice, so the deck that will start the battle is obvious.
- **Offline mockup battle has one exit.** The working parent `Back to menu`
  control is at the upper left; the obsolete, non-working iframe `Main menu`
  control was removed. Fielding and resolving a duel now trigger visible
  entry, lunge, and impact feedback (with a non-motion visual cue when reduced
  motion is enabled).

Verification for this update:

```text
client: npm run build
result: passed

client: npm test -- --grep "mockup mode|deck builder enforces|compact deck creator|Campaign launches|leader can be chosen"
result: 5 passed

client browser suite (preceding full regression batch)
result: 17 passed, 1 skipped

manual mockup check: ?mockup at 390x844
result: Deck order is the default, the real Card pool expands, the Campaign
deck label updates, Back to menu is the only battle exit, and the iframe
contains no cc-exit-battle control.
```

## 2026-08-03 battle drag reliability update

- **Live battle card drags now keep tracking outside the card.** During a
  hand-card drag, movement, release, and cancellation are listened for at the
  window for the duration of the gesture, with pointer capture retained as an
  additional safeguard. This prevents a finger or pointer released over the
  open field from being lost after the card leaves its original bounds.
- **Mockup drag is covered as a real gesture.** The focused browser test moves
  a battle card from the hand to the field with pointer down/move/up coordinates
  and verifies that it becomes the player field card.

Verification for this update:

```text
client: npm run build
result: passed

client: npm test -- --grep "mockup battle card can be dragged|mockup mode uses"
result: 2 passed
```

## Approved screen flow

1. **Home** — three equal-height portrait cards in this order: Campaign,
   Collection, Compete. Campaign and Compete use deity crops; Collection uses
   the approved hedgehog card. Session identity and deck access remain above
   the mode cards.
2. **Campaign setup** — selected deck, deck-editor link, house temperament,
   and Start Battle. `Choose or edit deck` opens Deck Creator; Back and Save
   return to Campaign.
3. **Deck Creator / Collection** — leader choice is part of the same editor as
   the other cards; there is no separate leader-selection screen. The accepted
   design is the compact 390px bottom-sheet editor with a deck summary bar,
   horizontal leader row, leader rules, and four-column card pool.
4. **Compete** — selected deck, deck-editor link, Create Room, and room-code
   join. Deck Creator returns to Compete when opened here.
5. **Room Lobby** — room code and seat list, with a small secondary `Leave
   room` action beside the primary Start Battle action in offline review mode.
6. **Battle** — diagonally mirrored table furniture: enemy draw/discard at the
   upper-left, enemy leader at the upper-right, player leader at the
   lower-left, and player draw/discard at the lower-right. The active field is
   slightly zoomed out. Draw piles and discard piles are separate, similarly
   scaled card objects. Empty discard slots are visible and labeled; after a
   defeat, the top discarded monster is shown face-up. Leader cards include
   readable names and compact rules text.

The current mobile perspective iteration places each draw pile on the outside
rail (enemy upper-left, player lower-right) and its straight discard pile just
inside it. Far-side cards and piles are smaller and foreshortened; near-side
pieces are larger. This iteration is still in the owner review loop.

Result/end-of-match remains the next screen to review.

## Implementation map

- `client/src/main.ts`
  - Shared normal/mockup navigation for Home, Campaign, Deck Creator, Compete,
    Lobby, and Battle.
  - Session names are visit-scoped rather than persisted as accounts.
  - Deck-editor return targets preserve the calling screen.
  - Campaign does not ask for or use a player-facing session name. Start Battle
    clones the currently selected deck and launches it with an internal unique
    solo connection identity; session names remain a Compete-only concern.
  - Offline room creation uses the real packaged battle artifact.
- `client/src/deckbuilder.ts`
  - Integrated leader/card editor and local deck persistence.
  - Back and Save callbacks return to the correct calling screen.
  - The compact sheet now has a functional saved-deck menu, duplicate/new
    deck actions, a tappable collapse handle/backdrop, and an ordered draw list
    with touch-sized earlier/later controls plus desktop drag-and-drop.
  - The checkmark is wired as `Use this deck and return`; it validates the
    30-card rule, saves the selected library entry, and returns to Campaign or
    Compete according to the screen that opened the editor.
- `client/src/reference.css` and `client/src/reference-fixes.css`
  - Approved visual overrides for the reviewed screens.
  - `reference-fixes.css` owns the latest live battle geometry; keep battle
    adjustments there unless the older rules in `styles.css` are consolidated.
- `client/src/layout-editor.ts` and `client/src/layout-editor.css`
  - Developer-only direct manipulation for the real online battle. Open the
    app with `?layoutEditor=1`, start a live Campaign battle, then tap/drag a
    battlefield object or choose it from the editor.
  - Supports per-object and whole-board zoom, numeric X/Y offsets, undo,
    per-object/all reset, local browser persistence, collapsing the controls,
    and copying a JSON layout payload for the owner to paste into Codex.
- `client/public/mockup/card-clash-game.html`
  - Playable offline battle used by the mockup flow.
  - Mirrors the accepted live battle geometry and face-up discard behavior.
- `engine/battle.py`, `client/src/types.ts`, and `client/src/battle.ts`
  - The authoritative side view now includes optional `discard_top` so the
    online renderer can display the newest discarded monster face-up without
    exposing deck or hand information.
- `client/public/art/ui/modes/`
  - Owner-supplied deity reference sheet plus campaign, compete, and collection
    source/crop assets. The `*-card-hd` files are the active Home assets.
- `tools/refine_mode_art.py`
  - Reproducible crop/export helper for the Home mode art.
- `server/app.py`, `server/match.py`, and `card_clash_mobile_launcher.cmd`
  - Session-only name reservation/release, disconnect cleanup, and the Windows
    local/tunnel launcher.

## Behavioral constraints

- Mockup and online screens must change together. Do not approve a change in
  only `client/public/mockup/card-clash-game.html` or only the live
  `BattleScreen` path.
- Preserve rotational symmetry on Battle: upper-left/lower-right piles and
  upper-right/lower-left leaders.
- Discarded monsters are public and appear face-up; draw piles remain hidden.
- Leader selection belongs inside Deck Creator.
- Campaign and Compete must return to their own setup screen after deck edits.
- Keep all three Home mode cards the same size and avoid stretched deity art.

## Verification at handoff

Completed after the latest lockstep update:

```text
client: npm run build
result: passed

engine/server: python -m pytest -q
result: 50 passed, 1 skipped, 1 deselected

client: npm test
result: 15 passed, 1 skipped

manual browser check: normal online Campaign → Battle at 390×844
result: passed; two discard slots and both leader cards present

client: npm run build (perspective rail + layout editor iteration)
result: passed

client: npm run build (functional compact deck creator iteration)
result: passed

client: npm run build (Campaign exact-deck launch / no player-facing name)
result: passed

client: npm test -- --grep "Campaign launches the exact selected deck"
result: 1 passed

client: Campaign-related online/offline regression batch
result: 3 passed

client browser suite (completed in bounded batches)
result: 17 passed, 1 skipped
```

The skipped browser case is the retired ordered-list Deck Builder contract; the
accepted bottom-sheet editor has a replacement limit/legality test. Remove the
legacy skipped case when old Deck Builder test coverage is next consolidated.

## Next work

1. Review and improve the Result/end-of-match screen with the owner.
2. Exercise at least one full live duel and visually confirm a defeated unit
   appears face-up in each discard pile.
3. Check Battle at 390×844 and 360×640 after any geometry change; the piles,
   leaders, field, and hand must remain legible without horizontal overflow.
4. Consider consolidating the late battle overrides from
   `reference-fixes.css` into the main spatial-board section of `styles.css`
   once the owner finishes the visual loop.
