/**
 * Measure the three things the owner said were wrong with the battle screen.
 *
 *   node tools/scene-weight.mjs                 # judge the running build
 *   node tools/scene-weight.mjs --self-test     # prove it rejects the old one
 *
 * The note was: *"it is very dark and doesn't have the same feeling as the
 * original card clash. The cards aren't from the perspective of the individual
 * player and the hand/board doesn't seem to be the main focus."*
 *
 * Three adjectives — dark, not-my-seat, not-the-focus — so three measured
 * gates, each BOTH-SIDED, because every one of them has an opposite failure
 * that is just the fix overshot:
 *
 *   key          too dark → washed out
 *   perspective  flat/symmetric → a foreshortening so steep the foe is unreadable
 *   focus        chrome-dominated → cards so large the state is off-screen
 *
 * The bands are centred on the ORIGINAL, measured — `docs/reference/README.md`
 * records the capture command and the numbers. They are not invented targets,
 * which is the same rule the Godot side's art gates follow: a "match X" grade
 * is calibrated against X's measured render, never against an ideal.
 *
 * Every check that compares a set also carries a floor on the COUNT of things
 * compared. A ratio over one card, or a median over an empty region, is
 * vacuously true and reads as coverage it does not have.
 */
import { chromium, devices } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000'
const SHOTS = mkdtempSync(join(tmpdir(), 'scene-weight-'))
const SELF_TEST = process.argv.includes('--self-test')
const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844 },
  { name: '375x667', width: 375, height: 667 },
]

// ── the reference, measured ───────────────────────────────────────────────
// `frame_key.py docs/reference/godot-battle.png` → ground #241c1c at
// luminance 29.7, median 28.9. A floor alone would pass a screen lit to
// daylight, which is the opposite failure and would lose the cosy key
// entirely — hence a band, not a minimum.
//
// Read the band's WIDTH as the admission it is: luminance turned out NOT to
// be what the owner reacted to. Measured like for like, the build they called
// "very dark" sits at ground 36.6 / median 32.0 — LIGHTER than the original's
// 29.7 / 28.9. What differs is hue and chroma (web ground 40° at sat 0.55;
// the original table 0° at 0.22, its menu sky 270° at 0.44) and the size of
// the calm surface (the Godot frame is 83% one colour, the web build 21%).
// So `key_ground` is a guard against drifting out of the cosy range in either
// direction, and the two checks below it are what actually carry the note.
const KEY = { floor: 23, ceil: 46, ref: 29.7 }

// Hue and chroma of the ground, which is where the difference really lives.
// Both references are at or below 0.44 saturation; amber at 0.55 is the
// outlier. The hue band is expressed as distance from neutral-red measured
// the long way round the wheel, so both 0° (table) and 270° (menu sky) are
// admissible and 40° amber is not — the original is cooler and more purple,
// never warmer.
const GROUND_SAT_MAX = 0.46
const GROUND_HUE_FORBIDDEN = [18, 70]   // amber/olive wedge

// The eye needs one large quiet surface to rest on; the highlight belongs to
// the card art, not to the chrome. Ceilinged too, because a frame that is 95%
// one colour is an empty screen, which is the opposite failure.
const CALM = { floor: 0.30, ceil: 0.90 }

// The original's cards are large and central. In its 720x1280 capture the two
// card objects plus the deck stacks cover roughly a fifth of the frame; a
// portrait phone gives the board more of its height, so the band opens
// upward. Below the floor the screen is chrome with cards in it; above the
// ceiling there is no room left for the gate, purse and log the game is
// actually played on.
const FOCUS = { floor: 0.22, ceil: 0.62 }

// Perspective is not a look, it is a geometry: my side is nearer, so it is
// lower and larger. Both halves are asserted — a build that simply enlarged
// everything would satisfy a size rule while still reading as a flat diagram.
const NEAR = { floor: 1.12, ceil: 3.2 }
const HAND_BOTTOM_MAX = 0.30   // hand's lowest edge within the bottom 30%

const MIN_CARDS = 2            // a "cards cover N%" claim needs cards
const MIN_SAMPLED = 5000       // a median needs pixels

const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b

/**
 * Key of the frame, from the COMPOSITED PNG.
 *
 * Deliberately not read from CSS. An earlier harness in this project read ink
 * from the stylesheet and ground from the render, and consequently scored a
 * darker vignette as an improvement; the same mistake in reverse is what put
 * a wrong number ("--bg is 17 against the original's 28") into the reference
 * notes and briefed two agents to brighten a screen that was already lighter
 * than its reference. A `--bg` token says nothing about the screen once a
 * background image, a vignette and four translucent overlays sit on top of
 * it. So: screenshot, then measure the pixels that actually shipped.
 */
async function key(page, label) {
  const file = join(SHOTS, `${label}.png`)
  writeFileSync(file, await page.screenshot())
  const out = execFileSync('python3',
    [new URL('frame_key.py', import.meta.url).pathname, file],
    { encoding: 'utf8' })
  return JSON.parse(out)[0]
}

/** Hue in degrees and saturation of a #rrggbb, HSV. */
function hsv(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  let h = 0
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return { hue: (h * 60 + 360) % 360, sat: max === 0 ? 0 : d / max }
}

/** Geometry of the card objects, from the DOM rather than from pixels — a
 *  pixel blob cannot say WHOSE card it is, and ownership is half the claim. */
async function geometry(page) {
  return page.evaluate(() => {
    const w = innerWidth, h = innerHeight
    const box = (n) => {
      const r = n.getBoundingClientRect()
      return { x: r.x, y: r.y, w: r.width, h: r.height,
               area: Math.max(r.width, 0) * Math.max(r.height, 0),
               midY: r.y + r.height / 2, bottom: r.bottom }
    }
    // A "card" is anything the layout treats as one: the two board stages and
    // whatever the pick offers. Scoped by ROLE, not by one class name, so a
    // rewrite that renames its own board class is still measured rather than
    // silently exempted.
    const pick = [...document.querySelectorAll('[data-pick]')].map(box)
    const mine = [...document.querySelectorAll(
      '[data-side="you"] .stage, [data-side="you"] .card, .card[data-own="you"]')]
      .map(box).filter(b => b.area > 0)
    const theirs = [...document.querySelectorAll(
      '[data-side="them"] .stage, [data-side="them"] .card, .card[data-own="them"]')]
      .map(box).filter(b => b.area > 0)
    const cards = [...mine, ...theirs, ...pick]
    return {
      viewport: { w, h, area: w * h },
      mine, theirs, pick,
      cardCount: cards.length,
      cardArea: cards.reduce((s, b) => s + b.area, 0),
      docScrollW: document.documentElement.scrollWidth,
    }
  })
}

const band = (name, value, lo, hi, note) => ({
  name, value, band: [lo, hi],
  pass: value !== null && value >= lo && value <= hi, note,
})

async function measure(page, label) {
  const k = await key(page, label)
  const g = await geometry(page)
  const ground = hsv(k.ground_hex)

  const checks = []

  checks.push({
    name: 'sampled_enough', value: k.pixels, band: [MIN_SAMPLED, Infinity],
    pass: k.pixels >= MIN_SAMPLED,
    note: 'a median over nothing is not a median',
  })
  checks.push(band('key_ground', k.ground, KEY.floor, KEY.ceil,
    `original table ground is ${KEY.ref} (this ${k.ground_hex})`))
  checks.push(band('key_median', k.median, KEY.floor - 6, KEY.ceil + 10,
    'a light ground under black ink is still a dark screen'))

  // The two that actually carry the owner's note. See the KEY comment.
  checks.push({
    name: 'ground_not_amber', value: Math.round(ground.hue),
    band: [`outside ${GROUND_HUE_FORBIDDEN[0]}-${GROUND_HUE_FORBIDDEN[1]}`, ''],
    pass: ground.hue < GROUND_HUE_FORBIDDEN[0]
      || ground.hue > GROUND_HUE_FORBIDDEN[1],
    note: 'the original is cooler and more purple, never warmer (table 0, sky 270)',
  })
  checks.push(band('ground_chroma', Number(ground.sat.toFixed(3)),
    0, GROUND_SAT_MAX,
    'both references sit at or below 0.44; amber at 0.55 was the outlier'))
  checks.push(band('calm_surface', k.ground_share, CALM.floor, CALM.ceil,
    'one large quiet surface to rest on — the Godot frame is 0.83'))

  checks.push({
    name: 'cards_counted', value: g.cardCount, band: [MIN_CARDS, Infinity],
    pass: g.cardCount >= MIN_CARDS,
    note: 'a coverage ratio needs cards to be covering anything',
  })
  checks.push(band('focus_card_area', g.cardArea / g.viewport.area,
    FOCUS.floor, FOCUS.ceil,
    'cards as a fraction of the phone screen'))

  // Perspective. Both halves, and each with its own count floor: a near/far
  // ratio computed from one side is not a ratio.
  const myArea = g.mine.reduce((s, b) => s + b.area, 0)
  const theirArea = g.theirs.reduce((s, b) => s + b.area, 0)
  const bothSides = g.mine.length >= 1 && g.theirs.length >= 1
  checks.push({
    name: 'both_seats_present', value: `${g.mine.length}/${g.theirs.length}`,
    band: ['>=1', '>=1'], pass: bothSides,
    note: 'perspective is a relation; one side alone cannot express it',
  })
  checks.push(band('near_far_ratio',
    bothSides && theirArea > 0 ? myArea / theirArea : null,
    NEAR.floor, NEAR.ceil,
    'my card is nearer, so it is larger — but not so large theirs is lost'))

  const myMid = g.mine.length
    ? g.mine.reduce((s, b) => s + b.midY, 0) / g.mine.length : null
  const theirMid = g.theirs.length
    ? g.theirs.reduce((s, b) => s + b.midY, 0) / g.theirs.length : null
  checks.push({
    name: 'seats_split',
    value: myMid === null ? null
      : `mine ${Math.round(myMid)} / theirs ${Math.round(theirMid)}`,
    band: ['mine below theirs', ''],
    pass: bothSides && myMid > theirMid,
    note: 'my seat is the near edge of the table',
  })

  const handBottom = g.pick.length
    ? Math.max(...g.pick.map(b => b.bottom)) : null
  checks.push({
    name: 'hand_at_near_edge',
    value: handBottom === null ? null
      : Number(((g.viewport.h - handBottom) / g.viewport.h).toFixed(3)),
    band: [0, HAND_BOTTOM_MAX],
    pass: handBottom !== null
      && (g.viewport.h - handBottom) / g.viewport.h <= HAND_BOTTOM_MAX,
    note: 'the hand is held, so it sits at the bottom edge',
  })

  checks.push({
    name: 'no_horizontal_scroll', value: g.docScrollW,
    band: [0, g.viewport.w], pass: g.docScrollW <= g.viewport.w,
    note: 'a negative-inset pseudo element counts toward scrollWidth',
  })

  return { label, checks }
}

async function run() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
  })
  const results = []
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      ...devices['Pixel 5'],
      viewport: { width: vp.width, height: vp.height },
    })
    const page = await context.newPage()
    await page.goto(BASE)
    await page.fill('#name', 'Ana')
    await page.click('#play-npc')
    await page.waitForSelector('.board, [data-pick]', { timeout: 15000 })
    // Reach a real two-card offer — a forced pick renders one card and would
    // measure the hand as half its true size.
    for (let i = 0; i < 60; i++) {
      if (await page.locator('[data-pick="1"]').count()) break
      const n = await page.locator('[data-pick="0"]').count()
      if (n) await page.locator('[data-pick="0"]').first().click()
      else if (await page.locator('#shop-skip').count())
        await page.locator('#shop-skip').click()
      else if (await page.locator('#withdraw-skip').count())
        await page.locator('#withdraw-skip').click()
      else if (await page.locator('#confirm-yes').count())
        await page.locator('#confirm-yes').click()
      await page.waitForTimeout(120)
    }
    await page.waitForTimeout(250)
    results.push(await measure(page, vp.name))
    await context.close()
  }
  await browser.close()

  let failed = 0
  for (const r of results) {
    console.log(`\n── ${r.label} ──`)
    for (const c of r.checks) {
      const ok = c.pass ? 'PASS' : 'FAIL'
      if (!c.pass) failed++
      const v = typeof c.value === 'number' ? c.value.toFixed(3) : c.value
      console.log(`  ${ok}  ${c.name.padEnd(20)} ${String(v).padStart(22)}`
        + `  band ${JSON.stringify(c.band)}   ${c.note}`)
    }
  }

  if (SELF_TEST) {
    // A gate has to be shown to do BOTH things: reject what it was written to
    // reject, and accept the thing it is calibrated against. A gate that only
    // ever fails is as useless as one that only ever passes, and this one's
    // bands were tightened after the fact — so they get checked against the
    // reference frame, not just asserted to be centred on it.
    const ref = new URL('../../docs/reference/godot-battle.png',
      import.meta.url).pathname
    const r = JSON.parse(execFileSync('python3',
      [new URL('frame_key.py', import.meta.url).pathname, ref],
      { encoding: 'utf8' }))[0]
    const g = hsv(r.ground_hex)
    const refChecks = [
      ['key_ground', r.ground >= KEY.floor && r.ground <= KEY.ceil, r.ground],
      ['ground_not_amber', g.hue < GROUND_HUE_FORBIDDEN[0]
        || g.hue > GROUND_HUE_FORBIDDEN[1], Math.round(g.hue)],
      ['ground_chroma', g.sat <= GROUND_SAT_MAX, g.sat.toFixed(3)],
      ['calm_surface', r.ground_share >= CALM.floor
        && r.ground_share <= CALM.ceil, r.ground_share],
    ]
    console.log('\nself-test A — the bands must ACCEPT the original:')
    let refFailed = 0
    for (const [name, ok, value] of refChecks) {
      if (!ok) refFailed++
      console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(20)} ${value}`)
    }
    if (refFailed) {
      console.error(`SELF-TEST FAILED: ${refFailed} band(s) reject the `
        + 'reference they were calibrated on, so they encode a target nobody '
        + 'approved rather than the original.')
      return 1
    }

    // The gate exists because the owner rejected a specific build. If it
    // passes that build it is decoration — worse than no gate, because it
    // reads as coverage. Run this against the pre-redesign client.
    console.log(`\nself-test B — the bands must REJECT the build the owner `
      + `turned down:\n  ${failed} failing checks on this build`)
    if (failed === 0) {
      console.error('SELF-TEST FAILED: the rejected layout scores clean, so '
        + 'these bands cannot separate it from the fix.')
      return 1
    }
    console.log('SELF-TEST OK: the gate rejects the layout it was written for.')
    return 0
  }

  console.log(`\n${failed} failing checks`)
  return failed === 0 ? 0 : 2
}

process.exit(await run())
