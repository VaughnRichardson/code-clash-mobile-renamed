/**
 * Capture the game's key screens as PNGs for visual review.
 *
 *   node tools/capture.mjs [outDir]     (default: ../.review)
 *
 * Drives a real Chromium at a phone viewport and stops at each state worth
 * looking at. Used by the visual review loop — a reviewer reads these files.
 */
import { chromium, devices } from '@playwright/test'
import { existsSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const OUT_ROOT = process.argv[2]
  ?? fileURLToPath(new URL('../../.review', import.meta.url))
const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8000'
/* VIEWPORT=375x667 node tools/capture.mjs — because nothing in this project had
   ever been LOOKED AT below 390x844, and the shortest phone is where a big
   board breaks first. The default is unchanged. */
const [VW, VH] = (process.env.VIEWPORT ?? '390x844').split('x').map(Number)
if (!Number.isFinite(VW) || !Number.isFinite(VH) || VW < 240 || VH < 400) {
  throw new Error('VIEWPORT must look like 390x844')
}
const OUT = join(OUT_ROOT, `${VW}x${VH}`)
mkdirSync(OUT, { recursive: true })

const chromeCandidates = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  process.env.CHROME_PATH,
  process.env.PROGRAMFILES
    ? join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  process.env['PROGRAMFILES(X86)']
    ? join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  process.env.LOCALAPPDATA
    ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe')
    : undefined,
  '/opt/pw-browsers/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
]
const chromePath = chromeCandidates.find(candidate => candidate && existsSync(candidate))
const browser = await chromium.launch(chromePath ? { executablePath: chromePath } : {})
const context = await browser.newContext({
  ...devices['Pixel 5'],
  viewport: { width: VW, height: VH },
  reducedMotion: 'reduce',
})
await context.addInitScript(() => {
  // Stable motes and decorative variation make image diffs reviewable.
  let state = 0xC0FFEE
  Math.random = () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
})

const shot = async (page, name, full = false) => {
  await page.waitForTimeout(220)
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: full })
  process.stdout.write(`  ${name}.png\n`)
}

const promptKind = async (page) =>
  (await page.locator('#prompt').count())
    ? page.locator('#prompt').getAttribute('data-prompt')
    : null

/**
 * Advance the battle until `want` is the pending prompt, or the battle ends.
 *
 * `want` may be `'pick2'`, meaning a pick offering two *different* units. That
 * distinction matters: the starter deck is sorted by role, so a hand of two
 * consecutive cards is usually two copies of the same unit and the screen
 * renders a single forced card. Round 5 of the visual review discovered that
 * every pick screenshot captured so far had been a forced one — the game's
 * central interaction, a blind commit between two real options each carrying a
 * forecast, had never once been reviewed. A capture set that never reaches the
 * main screen is worse than no capture set, because it reads as coverage.
 */
const advanceTo = async (page, want, limit = 70) => {
  for (let i = 0; i < limit; i++) {
    if (await page.locator('.result-banner').count()) return false
    const kind = await promptKind(page)
    if (kind === want) return true
    if (kind === 'pick' && want === 'pick2'
        && await page.locator('[data-pick="1"]').count()) return true
    if (kind === null) { await page.waitForTimeout(200); continue }
    if (kind === 'pick') await page.locator('[data-pick="0"]').first().click()
    else if (kind === 'shop') await page.locator('#shop-skip').click()
    else if (kind === 'withdraw') await page.locator('#withdraw-skip').click()
    else await page.locator('#confirm-yes').click()
    await page.waitForTimeout(140)
  }
  return false
}

const open = async (name) => {
  const page = await context.newPage()
  await page.goto(BASE)
  await page.addStyleTag({ content: `
    *, *::before, *::after {
      animation-duration: 0.001ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001ms !important;
      caret-color: transparent !important;
    }
  ` })
  await page.fill('#name', name)
  return page
}

console.log(`capturing to ${OUT}`)

// ── home + deck builder ──
{
  const page = await open('Ana')
  await shot(page, '01-home')
  await page.click('#edit-deck')
  await page.waitForTimeout(300)
  await shot(page, '02-deckbuilder-top')
  await page.evaluate(() => window.scrollTo(0, 1150))
  await shot(page, '03-deckbuilder-order')
  await page.click('#deck-done')
  await page.close()
}

// ── lobby, waiting for a second player ──
{
  const page = await open('Ana')
  await page.click('#create-room')
  await page.waitForTimeout(500)
  await shot(page, '04-lobby-waiting')
  await page.close()
}

// ── battle ──
{
  const page = await open('Ana')
  await page.selectOption('#difficulty', 'steady')
  await page.click('#play-npc')
  await page.waitForTimeout(700)
  await shot(page, '05-battle-first-pick')

  // The real interaction: two different units, each with a forecast.
  if (await advanceTo(page, 'pick2', 30)) {
    await shot(page, '05b-battle-two-card-pick')
  } else {
    console.log('  !! never reached a two-card pick — check the deck')
  }

  await advanceTo(page, 'shop')
  await shot(page, '06-battle-shop')

  // Play on a while so units, charges and the log all carry real state.
  for (let i = 0; i < 14; i++) {
    if (!(await advanceTo(page, 'pick', 14))) break
    await page.locator('[data-pick="0"]').first().click()
    await page.waitForTimeout(140)
  }
  if (!(await page.locator('.result-banner').count())) {
    if (!(await advanceTo(page, 'pick2', 30))) await advanceTo(page, 'pick')
    await shot(page, '07-battle-midgame')
    await shot(page, '08-battle-midgame-full', true)
  }

  for (let i = 0; i < 200; i++) {
    if (await page.locator('.result-banner').count()) break
    const kind = await promptKind(page)
    if (kind === null) { await page.waitForTimeout(180); continue }
    if (kind === 'pick') await page.locator('[data-pick="0"]').first().click()
    else if (kind === 'shop') await page.locator('#shop-skip').click()
    else if (kind === 'withdraw') await page.locator('#withdraw-skip').click()
    else await page.locator('#confirm-yes').click()
    await page.waitForTimeout(120)
  }
  await shot(page, '09-battle-result')
  await page.close()
}

await browser.close()
console.log('done')
