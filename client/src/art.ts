/**
 * The artwork the table is dressed with.
 *
 * `data/art.json` is the manifest of record and the files live in
 * `client/public/art/`, which Vite copies to `dist/art/` and the server mounts
 * at `/art`. Real drawings drop in at the same paths and aspects with no code
 * change — that is the contract `docs/ART_BRIEF.md` states and this module is
 * the only place it is spelt out in the client.
 *
 * TWO RULES, AND THE SECOND ONE IS AN OWNERSHIP RULE, NOT A STYLE PREFERENCE.
 *
 * 1. AN ILLUSTRATION IS AN `<img>`. It carries its own hue, it is allowed to,
 *    and it only ever appears inside a card's art window where a frame in the
 *    owner's colour is around it.
 *
 * 2. AN ICON IS A MASK, NEVER AN IMAGE. Every icon in `public/art/icons` is
 *    painted gold (`#dbbd62`), and gold on this board means "yours". Dropped in
 *    as `<img>` on the opponent's half, the set would quietly hand their side
 *    the one hue it may never wear. Used as a mask the glyph is a shape and the
 *    COLOUR is whatever the element already resolved to, so an icon can never
 *    introduce a hue the layout did not choose. This is applied at the module
 *    boundary rather than per call site.
 */

/** Units with a drawing. Mirrors `data/art.json`'s `cards` block. */
const CARD_ART = new Set([
  'berserker', 'brute', 'champion', 'duelist', 'fortress', 'grunt', 'guardian',
  'martyr', 'rallier', 'soldier', 'vanguard', 'warden', 'warlord', 'wraith',
])

/** Leaders with a portrait. Mirrors `data/art.json`'s `leaders` block. */
const LEADER_ART = new Set([
  'second_wind', 'momentum', 'giant_slayer', 'blitz', 'doomsayer', 'sentinel',
  'reaper', 'gravekeeper', 'oracle', 'ritualist',
])

/** The supplied leader sheet is portrait art. Two legacy placeholders remain
 *  PNG until matching portraits are available. */
const LEADER_JPG = new Set([
  'second_wind', 'momentum', 'blitz', 'doomsayer', 'sentinel', 'gravekeeper',
  'oracle', 'ritualist',
])

const slug = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, '_')

/** The unit's illustration, or null when nothing has been drawn for it — the
 *  boss and any card added ahead of its art land here, and the card falls back
 *  to its own frame rather than to a broken image. */
export function cardArt(name: string): string | null {
  const id = slug(name)
  return CARD_ART.has(id) ? `/art/cards/${id}.png` : null
}

export function leaderArt(id: string | null | undefined): string | null {
  if (!id) return null
  if (!LEADER_ART.has(id)) return null
  return `/art/leaders/${id}.${LEADER_JPG.has(id) ? 'jpg' : 'png'}`
}

/** An `<img>` sized to its box by CSS, never by the file. Decoding is async and
 *  the load is lazy off-screen: this client re-renders the whole battle on
 *  every server frame and a synchronous decode per frame is a phone's budget. */
export function image(src: string, cls: string, alt = ''): HTMLImageElement {
  const node = document.createElement('img')
  node.className = cls
  node.src = src
  node.alt = alt
  node.decoding = 'async'
  node.loading = 'lazy'
  node.draggable = false
  return node
}

/**
 * An icon as a MASK — see rule 2 above. The returned span paints in
 * `currentColor`, so it inherits the ownership hue of wherever it is placed.
 */
export function icon(id: string, cls = ''): HTMLElement {
  const node = document.createElement('span')
  node.className = `ico ${cls}`.trim()
  node.setAttribute('aria-hidden', 'true')
  node.style.setProperty('--ico', `url(/art/icons/${id}.png)`)
  return node
}
