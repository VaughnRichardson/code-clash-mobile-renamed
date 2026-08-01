/**
 * Measure real text-on-textured-ground contrast.
 *
 * Text over a TEXTURED ground is the classic way to lose contrast, and a token
 * pair (`--muted` on `--panel`) does not describe what is actually behind the
 * glyphs: a tooth, a gradient, a vignette and a translucent band are all in the
 * way. So this reads the computed colour of each string, then screenshots the
 * page with every glyph made transparent and samples THE GROUND UNDER THAT
 * STRING'S OWN BOX — worst case being the LIGHTEST pixel there, since all this
 * file's text is light on dark.
 *
 * It is far better than token-pair maths and it has already earned its keep
 * three times: it caught an `overlay` blend swinging a ground ten levels and
 * taking `#ff5a52` to 4.13:1, it caught a drifting mote sitting behind an 11px
 * label at 1.28:1, and it is what proves the page vignette is masked off the
 * commit zone rather than merely believed to be.
 *
 * THE INK IS ATTENUATED TOO, and that correction is not optional. The version
 * this was ported from read the ink's colour from CSS and only the ground from
 * the render — which is right for a texture UNDER the text, and wrong for any
 * layer ABOVE it. The page vignette is above everything, so it darkens the
 * glyphs by exactly as much as it darkens their ground, and an uncorrected
 * harness reported the darker configuration as the BETTER one (10.48 against
 * 9.89 for the same string). It measured the vignette as an improvement. So the
 * overlay is captured on its own over white, its alpha is read per pixel, and
 * the ink is composited through it before the ratio is taken.
 *
 * FIVE POSES, because a screen the harness never reaches is a screen it never
 * checked: a pick against a visible enemy, the blind pick, the forced pick
 * (the only pose carrying the primary commit button), the shop, and the result.
 *
 *   node tools/contrast-check.mjs
 *   BASE_URL=http://127.0.0.1:8000 node tools/contrast-check.mjs
 */
import { chromium, devices } from '@playwright/test'
import { PNG } from 'pngjs'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000'
const OUT = join(tmpdir(), 'card-clash-ground.png')
const OVER = join(tmpdir(), 'card-clash-overlay.png')
const AA = 4.5
/* WCAG's LARGE-TEXT threshold, and the size at which it applies (>=24px, or
   >=18.66px when bold). Applying 4.5 to a 28px title is not strictness, it is
   the wrong rule — and it would push a plate behind the one string on the game
   that is supposed to sit in the light. */
const AA_LARGE = 3.0
/** The log's own floor, which is higher than AA and has been since it was set. */
const LOG_FLOOR = 10.5

const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const ratio = (a, b) => { const hi = Math.max(a, b), lo = Math.min(a, b); return (hi + 0.05) / (lo + 0.05) }
const parse = (css) => css.match(/[\d.]+/g).slice(0, 3).map(Number)

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES
    ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const chromePath = chromeCandidates.find(candidate => candidate && existsSync(candidate))
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {})
const context = await browser.newContext({ ...devices['Pixel 5'], viewport: { width: 390, height: 844 } })
const page = await context.newPage()

await page.addInitScript(() => {
  class FakeSocket {
    static OPEN = 1; static last = null
    readyState = 1; onopen = null; onmessage = null; onclose = null
    constructor() { FakeSocket.last = this; setTimeout(() => this.onopen?.(), 0) }
    send() {}; close() {}
  }
  window.WebSocket = FakeSocket
  window.__push = (m) => FakeSocket.last?.onmessage?.({ data: JSON.stringify(m) })
})

const unit = (name, power, stamina, ability) =>
  ({ uid: power * 100 + stamina, name, power, stamina, ability, stolen: null, spent: false })
const seat = (s, over = {}) => ({
  seat: s, leader: s === 0 ? 'second_wind' : 'sentinel', gold: 3, charges: 1,
  discards: 10, remaining: 5, units: 5, damage_dealt: 40, shield: 0, active: null, power: 0,
  stamina: 0, scout_turns: 0, fog_turns: 0, ...over,
})
const EVENTS = [{ n: 0, duel: 1, kind: 'battle_start' },
                { n: 1, duel: 1, kind: 'field', seat: 1, card: { name: 'Wraith' },
                  power: 6, stamina: 3 }]

/* ── the poses ────────────────────────────────────────────────────────────── */

const enemyState = () => ({
  duel: 19, seat: 0,
  you: seat(0, { shield: 2,
    active: { uid: 4, name: 'Rallier', power: 1, stamina: 1, ability: null,
              stolen: null, spent: true },
    power: 1, stamina: 1 }),
  them: seat(1, {
    active: { uid: 9, name: 'Wraith', power: 6, stamina: 3, ability: 'guardian',
              stolen: 'resolve', spent: false },
    power: 6, stamina: 3 }),
  result: null,
})
const blindState = () => ({
  duel: 19, seat: 0, you: seat(0, { shield: 2 }), them: seat(1), result: null,
})

const POSES = [
  ['home (text on the bare page)', null, [
    ['title', 'h1'],
    ['intro paragraph (on the page ground)', 'p.muted'],
    ['panel heading', '.panel h3'],
    ['field label', 'label'],
    ['deck button label', '#edit-deck'],
    ['primary button label', '#play-npc'],
  ]],

  ['visible-enemy pick', {
    state: enemyState(),
    prompt: { kind: 'pick', seat: 0,
      options: [unit('Vanguard', 6, 4, 'vanguard'), unit('Warden', 2, 7, 'steal')],
      context: { own_first: true, own_discards: 12 } },
  }, [
    ['card name', '.card .name'],
    ['ability keyword', '.card .ability:not(.cond)'],
    ['entry condition', '.card .ability.cond'],
    ['power figure', '.card .stats .pw'],
    ['stamina figure', '.card .stats .st'],
    ['forecast, bad (danger red)', '.card .forecast.bad'],
    ['forecast, neutral', '.card .forecast.even'],
    ['forecast hedge', '.card .forecast .hedge'],
    ['prompt heading', '#prompt h3'],
    ['offer caption', '.offer-cap'],
    ['ability rules text', '.card .ability-copy'],
    ['unit balance, yours', '.unit-tug .tug-side.you strong'],
    ['unit balance reading', '.unit-tug .tug-reading'],
    ['unit balance, theirs', '.unit-tug .tug-side.them strong'],
    ['unit name on the board', '[data-side="them"] .stage .unit'],
    ['statline, theirs', '[data-side="them"] .statpair .pw'],
    ['chip label', '.chip'],
    ['leader name', '[data-side="you"] .leader-chip .nm'],
    ['standing token', '.standing .tok'],
    ['duel label (on the ornament)', '.clash .phase'],
    ['log line', '.log .ev:not(.neutral):not(.divider)'],
    ['deck pile caption', '[data-side="you"] .deck-cap'],
    ['deck pile caption, theirs', '[data-side="them"] .deck-cap'],
    ['badge caption on a held card', '.card.held .stats .slash'],
    ['stamina badge, theirs', '[data-side="them"] .statpair .st'],
    ['whose place this is', '[data-side="you"] .place .who'],
    ['peril line (danger red)', '[data-side="you"] .peril'],
  ]],

  ['blind pick', {
    state: blindState(),
    prompt: { kind: 'pick', seat: 0,
      options: [unit('Duelist', 5, 4, 'resolve'), unit('Warden', 2, 7, 'steal')],
      context: { own_first: false, own_discards: 10 } },
  }, [
    ['COMMIT LINE — name on the pickable card', '.card.pickable .name'],
    ['COMMIT LINE — power figure', '.card.pickable .stats .pw'],
    ['COMMIT LINE — stamina figure', '.card.pickable .stats .st'],
    ['COMMIT LINE — ability keyword', '.card.pickable .ability'],
    ['concealed-foe label', '[data-side="them"] .place .who'],
    ['concealed tag', '[data-side="them"] .card.face-down .unit.tag'],
    ['the open place at your seat', '.card.ghost .unit.vacant'],
    ['priors sentence', '.priors'],
    ['priors stake', '.priors .stake'],
  ]],

  ['forced pick', {
    state: blindState(),
    prompt: { kind: 'pick', seat: 0,
      options: [unit('Vanguard', 6, 4, 'vanguard'), unit('Vanguard', 6, 4, 'vanguard')],
      context: { own_first: false, own_discards: 0 } },
  }, [
    ['COMMIT LINE — primary button label', 'button.primary'],
    ['forced-pick sentence', '#prompt p.muted'],
    ['flat card name', '.card.flat .name'],
    ['flat card power', '.card.flat .stats .pw'],
  ]],

  ['shop', {
    state: enemyState(),
    prompt: { kind: 'shop', seat: 0,
      // `options` is a list of item IDs; the row is built from the catalogue.
      options: ['scout', 'ward', 'fog'], context: { gold: 3 } },
  }, [
    ['shop heading', '#prompt h3'],
    ['item name', '.shop-row .nm'],
    ['item price', '.shop-row .cost'],
    ['item description', '.shop-row .blurb'],
    ['purse amount', '.purse .amt'],
    ['purse label', '.purse .lab'],
    ['skip button label', '#shop-skip'],
  ]],

  ['result', {
    state: { ...enemyState(),
      result: { winner: 1, reason: 'units', units: [0, 7],
                discards: [17, 11], damage: [38, 44] } },
    prompt: null,
  }, [
    ['result headline', '.result-banner .headline'],
    ['result reason', '.result-banner .muted'],
    ['tally heading', '.row.head h3'],
    ['tally label', '.tally .lab.decided'],
    ['tally "decided it" note', '.tally .lab .why'],
    ['duel-count chip', '.chip.count'],
    ['tally value, yours', '.tally .val.you'],
    ['tally value, theirs', '.tally .val.them'],
    ['tally column head', '.tally .col.you'],
    ['back button label', '.sticky-actions button'],
    ['log line (final)', '.log .ev:not(.neutral):not(.divider)'],
    // Moved here from the pick pose: the log is two lines on a decision
    // screen, so its FIRST row — the only neutral narration the battle has —
    // is always scrolled out of view there. The result screen gives the log
    // the whole slack, which is the one place every row is on screen.
    ['log line, neutral narration', '.log .ev.neutral'],
    // ...and the divider for the same reason: on a two-line slab it is
    // scrolled out of its own port on nearly every frame.
    ['log duel divider', '.log .ev.divider'],
  ]],
]

/* ── the measurement ──────────────────────────────────────────────────────── */

let worstOverall = { r: Infinity, label: '', pose: '' }
let failures = 0
let measured = 0
let unsampled = 0
const failed = []
const logRatios = []

for (const [poseName, frame, targets] of POSES) {
  await page.goto(BASE)
  await page.waitForSelector('h1')
  if (frame) {
    await page.evaluate((f) => {
      window.__push({ type: 'update', state: f.state, events: f.events,
                      prompt: f.prompt, waiting_on: [] })
    }, { ...frame, events: EVENTS })
  }
  await page.waitForTimeout(200)

  /* SAMPLING FOLLOWS THE PAGE. A `position: fixed` overlay is painted once at
     the top of a fullPage capture, so the ground and the overlay shots would
     disagree about where the vignette is. The answer is a capture PER SCROLL
     POSITION: everything visible at rest, then whatever is left after scrolling
     to the bottom. A string that is never sampled is REPORTED, because a
     harness that quietly stops covering the tightest colour on the screen —
     `--danger-text`, which lives in the forecast, below the fold — reads
     exactly like a harness with nothing to report. */
  const seen = new Set()
  for (const pass of [0, 1]) {
    if (pass === 1) {
      const more = await page.evaluate(() => {
        if (document.documentElement.scrollHeight <= window.innerHeight) return false
        window.scrollTo(0, document.documentElement.scrollHeight)
        return true
      })
      if (!more) break
      await page.waitForTimeout(120)
    }

    const boxes = []
    for (const [label, sel] of targets) {
      if (seen.has(label)) continue
      const found = await page.evaluate((s) => {
        const n = document.querySelector(s)
        if (!n) return null
        const r = n.getBoundingClientRect()
        if (r.width < 2 || r.height < 2) return null
        if (r.top < 0 || r.bottom > window.innerHeight) return 'offscreen'
        // ...AND NOT CLIPPED BY A SCROLLING ANCESTOR. The battle log is a
        // two-line slab on any screen carrying a decision, so most of its rows
        // are scrolled out of their own port while still reporting a bounding
        // box — over the rail behind them. Sampled there, `--muted` on the log
        // was graded against an amber meter figure at 1.03:1: a real-looking
        // failure on a string that is not on screen at all. A ratio for
        // something nobody can see is noise in either direction.
        for (let up = n.parentElement; up; up = up.parentElement) {
          const cs2 = getComputedStyle(up)
          if (!/auto|scroll|hidden/.test(cs2.overflowY + cs2.overflowX)) continue
          const box = up.getBoundingClientRect()
          if (r.bottom <= box.top + 0.5 || r.top >= box.bottom - 0.5
              || r.right <= box.left + 0.5 || r.left >= box.right - 0.5) {
            return 'offscreen'
          }
        }
        // THE ELEMENT'S OWN RIM IS NOT THE GROUND BEHIND ITS GLYPHS. A dish is a
        // ring around a dark fill and a chip has a lit top edge; sampling the
        // border box scores both against their own rims, where no glyph is ever
        // painted. The sample is the PADDING BOX less a pixel of antialiasing —
        // and less 22% of the short side, because a ROUND rim is still inside
        // the padding box's corners (a circle inscribed in a square leaves 29%
        // of the half-diagonal outside it).
        const cs = getComputedStyle(n)
        const border = Math.max(
          parseFloat(cs.borderTopWidth) || 0, parseFloat(cs.borderRightWidth) || 0,
          parseFloat(cs.borderBottomWidth) || 0, parseFloat(cs.borderLeftWidth) || 0)
        const pad = border + 1 + 0.22 * Math.min(r.width, r.height)
        const size = parseFloat(cs.fontSize) || 16
        const weight = parseInt(cs.fontWeight, 10) || 400
        const large = size >= 24 || (size >= 18.66 && weight >= 700)
        return { color: cs.color, large, x: r.x + pad, y: r.y + pad,
                 w: Math.max(r.width - 2 * pad, 1), h: Math.max(r.height - 2 * pad, 1) }
      }, sel)
      if (found && found !== 'offscreen') { boxes.push([label, found]); seen.add(label) }
      else if (found === null && pass === 1) {
        console.log(`  (absent in this pose: ${label})`); seen.add(label)
      }
    }
    if (!boxes.length) continue

    // Strip the ink, keep every ground — INCLUDING the vignette, which sits
    // ABOVE the text and is the whole reason a token pair cannot answer this.
    const strip = await page.addStyleTag({ content: `*, *::before, *::after {
      color: transparent !important; text-shadow: none !important;
      -webkit-text-fill-color: transparent !important; }` })
    await page.waitForTimeout(120)
    await page.screenshot({ path: OUT })
    // ...and the overlay ON ITS OWN, over white, so its alpha can be read per
    // pixel and applied to the ink as well as to the ground.
    const white = await page.addStyleTag({ content: `html, body, #app {
      background: #fff !important; }
      #app > *, #atmos-motes { visibility: hidden !important; }` })
    await page.waitForTimeout(100)
    await page.screenshot({ path: OVER })
    await page.evaluate(() => {
      for (const n of document.querySelectorAll('style[data-probe]')) n.remove()
    })

    const png = PNG.sync.read(readFileSync(OUT))
    const over = PNG.sync.read(readFileSync(OVER))
    const dpr = png.width / 390

    if (pass === 0) {
      console.log(`\n── ${poseName} ${'─'.repeat(Math.max(1, 44 - poseName.length))}`)
      console.log('string                                   ink        ground min..max   worst  AA')
    }
    for (const [label, b] of boxes) {
      const [r, g, bl] = parse(b.color)
      let lo = 1, hi = 0, loPx = null, hiPx = null, alpha = 0
      const x0 = Math.round(b.x * dpr), x1 = Math.round((b.x + b.w) * dpr)
      const y0 = Math.round(b.y * dpr), y1 = Math.round((b.y + b.h) * dpr)
      for (let y = y0; y < Math.min(y1, png.height); y++) {
        for (let x = x0; x < Math.min(x1, png.width); x++) {
          const i = (png.width * y + x) << 2
          const L = lum(png.data[i], png.data[i + 1], png.data[i + 2])
          if (L < lo) { lo = L; loPx = [png.data[i], png.data[i + 1], png.data[i + 2]] }
          if (L > hi) { hi = L; hiPx = [png.data[i], png.data[i + 1], png.data[i + 2]] }
          // The overlay over white: R = 255(1 - a) + OVERLAY_R * a.
          const a = (255 - over.data[i]) / (255 - 6)
          if (a > alpha) alpha = a
        }
      }
      const hex = (p) => '#' + p.map(v => v.toString(16).padStart(2, '0')).join('')
      if (!hiPx) { console.log(`${label.padEnd(40)} NO GROUND SAMPLED`); continue }
      // Composite the ink through the overlay, worst case (its densest pixel in
      // this box), exactly as the screen composites it.
      const ink = lum(r * (1 - alpha) + 6 * alpha, g * (1 - alpha) + 4 * alpha,
                      bl * (1 - alpha) + 2 * alpha)
      // WHICHEVER GROUND PIXEL IS NEARER THE INK IS THE WORST CASE, and that
      // has to be computed rather than assumed. This file used to take the
      // LIGHTEST pixel, which is right for light ink on a dark ground and
      // exactly backwards for dark ink on a light one — and the card's power
      // badge is now a near-black numeral struck into a gold disc. On that
      // string the old rule reported 10.64 as the worst case while the true
      // worst, against the disc's own shadow, was 8.60: the harness would have
      // graded the badge on its best pixel and called it coverage.
      const worst = Math.min(ratio(ink, hi), ratio(ink, lo))
      const best = Math.max(ratio(ink, hi), ratio(ink, lo))
      const floor = b.large ? AA_LARGE : AA
      measured += 1
      if (worst < floor) { failures += 1; failed.push(`${label} (${poseName})`) }
      if (label === 'log line' || label === 'log line (final)') logRatios.push(worst)
      if (worst < worstOverall.r) worstOverall = { r: worst, label, pose: poseName }
      console.log(`${label.padEnd(40)} ${hex([r, g, bl])}  ${hex(loPx)}..${hex(hiPx)}  `
        + `${worst.toFixed(2).padStart(5)}  ${worst >= floor ? 'pass' : 'FAIL'}`
        + `${b.large ? ' (large, 3:1)' : ''}   (best ${best.toFixed(2)}`
        + `${alpha > 0.005 ? `, vignette ${alpha.toFixed(2)}` : ''})`)
    }
    await strip.evaluate((n) => n.remove())
    await white.evaluate((n) => n.remove())
  }
  for (const [label] of targets) {
    if (!seen.has(label)) {
      console.log(`${label.padEnd(40)} NEVER SAMPLED — not reachable in this pose`)
      unsampled += 1
    }
  }
}

/* A gate that stopped seeing any case at all reads exactly like a gate with no
   failures, so it prints how much it measured next to the verdict. */
console.log(`\n${measured} strings measured across ${POSES.length} poses; `
  + `${failures} below their floor (${AA}:1, or ${AA_LARGE}:1 for large text); `
  + `${unsampled} never reached.`)
for (const f of failed) console.log(`  FAIL: ${f}`)
console.log(`worst: ${worstOverall.r.toFixed(2)}:1  —  ${worstOverall.label} `
  + `(${worstOverall.pose})`)
const logWorst = logRatios.length ? Math.min(...logRatios) : null
if (logWorst !== null) {
  console.log(`log floor ${LOG_FLOOR}:1 — measured ${logWorst.toFixed(2)}:1  `
    + `${logWorst >= LOG_FLOOR ? 'pass' : 'FAIL'}`)
}
const vacuous = measured < 45 || unsampled > 0
if (vacuous) console.log('COVERAGE HAS DROPPED — the poses no longer reach every string.')
await browser.close()
process.exit(failures > 0 || vacuous
  || (logWorst !== null && logWorst < LOG_FLOOR) ? 2 : 0)
