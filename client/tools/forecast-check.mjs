/**
 * Prove the battle screen's forecast against the engine, case by case.
 *
 *   node tools/forecast-check.mjs            (exits non-zero on any mismatch)
 *
 * The screen tells the player what a card will do BEFORE they commit to it,
 * which is a claim about arithmetic the server also performs. Round 6 of the
 * visual review found the two disagreeing on six of the thirty cards in the
 * starter deck: an offered Duelist holding an unspent Resolve advertised
 * "Trade · both fall" — the literal trigger condition of the ability printed
 * one line above it — while the engine fired that Resolve and handed the
 * player the duel. The screen was steering players off the card that wins.
 *
 * A screenshot cannot catch that, because a screenshot is one board. So:
 * `tools/forecast_oracle.py` emits a case matrix and drives the ENGINE's own
 * `_round_loop` / `_survive_phase` / `_entry_phase` over each case; this script
 * runs the client's mirror (`resolveDuel`, `entryBuff` in `src/battle.ts`) over
 * the same matrix and demands the same answer every time.
 *
 * Nothing is mocked and nothing is duplicated: both sides are the real code.
 */
import { build } from 'esbuild'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')

// ── the client's arithmetic, bundled out of the TypeScript ──
//
// `battle.ts` touches the DOM inside its render functions but not at module
// scope, so the pure duel functions import cleanly into Node.
const work = mkdtempSync(join(tmpdir(), 'forecast-'))
const bundle = join(work, 'battle.mjs')
await build({
  entryPoints: [join(here, '..', 'src', 'battle.ts')],
  outfile: bundle,
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  logLevel: 'warning',
})
const { resolveDuel, entryBuff, outlookFor, verdictText } = await import(bundle)

// ── the engine's answers ──
const raw = execFileSync('python3', [join(here, 'forecast_oracle.py')],
                         { cwd: root, maxBuffer: 1 << 28 })
const { cases } = JSON.parse(raw.toString())

let checked = 0
const failures = []
const note = (name, what, want, got) =>
  failures.push(`${name}\n    ${what}: engine ${want}, client ${got}`)

for (const c of cases) {
  checked += 1
  if (c.kind === 'rounds' || c.kind === 'blocker') {
    const got = resolveDuel(c.me, c.foe, c.me_first)
    for (const field of ['result', 'stamina', 'dealt', 'rounds']) {
      if (got[field] !== c.expect[field]) {
        note(c.name, field, c.expect[field], got[field])
      }
    }
  } else if (c.kind === 'entry') {
    const buff = entryBuff(c.card.ability, c.card.spent,
                           { ownFirst: c.first, ownDiscards: c.discards })
    const power = buff ? buff.power : 0
    const stamina = buff ? buff.stamina : 0
    if (power !== c.expect.buff_power) {
      note(c.name, 'entry buff power', c.expect.buff_power, power)
    }
    if (stamina !== c.expect.buff_stamina) {
      note(c.name, 'entry buff stamina', c.expect.buff_stamina, stamina)
    }
    // Two ambushes cancel, so "does this unit strike first" is not a property
    // of the card alone — the client reads it the same way in `resolveDuel`.
    const mine = c.card.ability === 'ambush' && !c.card.spent
    const theirs = c.expect.foe_ability === 'ambush'
    const first = mine && !theirs
    if (first !== c.expect.ambush) {
      note(c.name, 'gets the first strike', c.expect.ambush, first)
    }
  }
}

// ── the blocker itself, at the level the player actually reads ──
//
// The arithmetic being right is necessary; what shipped wrong was the SENTENCE
// and its COLOUR. This asserts the verdict the card prints, on the exact board
// from `08-battle-midgame-full.png`.
const board = {
  card: { uid: 1, name: 'Duelist', power: 5, stamina: 4, ability: 'resolve',
          stolen: null, spent: false },
  enemy: { name: 'Duelist', power: 5, stamina: 1, ability: 'resolve',
           spent: true, stolen: null, first: false, discards: 6 },
}
const view = outlookFor(board.card, board.enemy, null)
checked += 1
if (view.result !== 'win') {
  failures.push('the blocker board\n    verdict: engine win, client '
                + view.result)
}
if (view.outcome.via !== 'resolve') {
  failures.push('the blocker board\n    Resolve is what saves it, client said '
                + view.outcome.via)
}
if (!view.certain) {
  failures.push('the blocker board\n    their Resolve is SPENT, so the win is '
                + 'determined and must be said in colour')
}

// ...and the mirror of it: the same Duelist against one whose Resolve is still
// live. Now the engine's per-duel seat order decides which of the two lives,
// so the screen must stop asserting rather than pick a side.
const live = { ...board.enemy, spent: false }
const contested = outlookFor(board.card, live, null)
checked += 1
if (contested.certain) {
  failures.push('a Resolve race\n    both Resolves live and the seat order '
                + 'decides it, but the client claimed a determined outcome')
}
if (!verdictText(contested).startsWith('Coin flip')) {
  failures.push('a Resolve race\n    must be ONE symmetric line, not a verdict '
                + `with a hedge under it: got "${verdictText(contested)}"`)
}

// ── every seat-order race the ENGINE knows about, at the level the player
//    reads ──
//
// The check above is one board. This is the general rule, and it is grounded
// in the engine rather than in the client's own opinion of itself: the oracle
// emits each fight under BOTH seat orders (`me_first`), so a pair whose two
// engine results disagree is, by construction, a duel this client cannot call.
// It is the gap the rest of this file cannot see — every case here is checked
// against the engine FOR A KNOWN SEAT ORDER, and what shipped wrong was a case
// where the seat order itself is the unknown being reported as a fact.
//
// A `Fighter` carries up to two live abilities, which is exactly what a card
// can hold (its own, plus one it stole), so the matrix reconstructs one.
const FLAGS = ['ambush', 'guardian', 'resolve']
const asCard = (f, name) => {
  const live = FLAGS.filter(flag => f[flag])
  if (live.length > 2) return null          // not expressible as one card
  return { uid: 0, name, power: f.power, stamina: f.stamina,
           ability: live[0] ?? null, spent: false, stolen: live[1] ?? null }
}
const byFight = new Map()
for (const c of cases) {
  if (c.kind !== 'rounds') continue
  const key = JSON.stringify([c.me, c.foe])
  const seen = byFight.get(key)
  if (seen === undefined) byFight.set(key, c)
  else if (seen.expect.result !== c.expect.result) byFight.set(key, [seen, c])
}
let races = 0
for (const entry of byFight.values()) {
  if (!Array.isArray(entry)) continue       // the order does not change it
  const [a] = entry
  const card = asCard(a.me, 'Mine')
  const foe = asCard(a.foe, 'Theirs')
  if (!card || !foe) continue
  const view = outlookFor(card, { ...foe, first: false, discards: 0 }, null)
  races += 1
  checked += 1
  if (view.certain) {
    failures.push(`${a.name}\n    the engine's seat order decides this duel, `
                  + 'but the client called it determined')
  } else if (!verdictText(view).startsWith('Coin flip')) {
    failures.push(`${a.name}\n    the engine's seat order decides this duel, `
                  + `so it may not be headlined as an outcome: `
                  + `"${verdictText(view)}"`)
  }
}
if (races === 0) {
  failures.push('the seat-order sweep\n    found no race in the whole matrix, '
                + 'so it measured nothing — check how the cases are paired')
}

rmSync(work, { recursive: true, force: true })

// ── does this check still REJECT the thing it was written for? ──
//
// A gate that passes both the good case and the bad one reads as coverage and
// is worse than no gate. `--self-test` replays the matrix through the exact
// arithmetic that shipped in round 5 — the plain "who runs out of stamina
// first" sum, abilities dropped on the floor — and fails if that comes back
// clean.
if (process.argv.includes('--self-test')) {
  const shipped = (me, foe) => {
    const toKill = me.power > 0 ? Math.ceil(foe.stamina / me.power) : Infinity
    const toDie = foe.power > 0 ? Math.ceil(me.stamina / foe.power) : Infinity
    if (toKill === Infinity && toDie === Infinity) return 'stalemate'
    return toKill < toDie ? 'win' : toKill > toDie ? 'lose' : 'trade'
  }
  let caught = 0
  for (const c of cases) {
    if (c.kind === 'entry') continue
    if (shipped(c.me, c.foe) !== c.expect.result) caught += 1
  }
  if (caught === 0) {
    console.error('SELF-TEST FAILED: the round-5 arithmetic passes this '
                  + 'check, so the check cannot be measuring anything')
    process.exit(1)
  }
  const total = cases.filter(c => c.kind !== 'entry').length
  console.log(`self-test: the shipped arithmetic misreads ${caught} of `
              + `${total} duels — the check rejects it`)
}

if (failures.length) {
  console.error(`forecast: ${failures.length} of ${checked} cases disagree `
                + 'with the engine\n')
  for (const line of failures.slice(0, 25)) console.error('  ' + line)
  if (failures.length > 25) {
    console.error(`  ... and ${failures.length - 25} more`)
  }
  process.exit(1)
}
// A gate must also report how much it measured — "no failures" and "nothing
// checked" look identical otherwise, and the seat-order sweep depends on the
// case matrix still pairing both orders of the same fight.
console.log(`forecast: ${checked} cases agree with the engine `
            + `(${races} of them seat-order races, none reported as certain)`)
