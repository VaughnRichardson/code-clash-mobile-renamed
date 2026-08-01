/**
 * The page's light model: the two atmosphere layers that sit behind and in
 * front of every screen.
 *
 * Both are mounted once on `document.body` and never touched by a render —
 * `main.ts` and `BattleScreen` clear `#app`'s children on every server frame,
 * and an effect that had to be rebuilt each frame would be a per-frame
 * allocation on a phone.
 *
 *   MOTES     a `<canvas>` behind everything (`z-index: -1`, so it paints over
 *             the root background and under every opaque panel). A direct port
 *             of the parent game's `main_menu/MenuParticles.gd` — the same
 *             densities, sizes, speeds, flicker, palette and 18% star share.
 *   VIGNETTE  a fixed layer ABOVE everything, porting
 *             `main_menu/vignette.gdshader`. It is the only layer that costs a
 *             contrast ratio, which is why it carries a floor (see
 *             `--vig-floor`): it may not darken the commit zone.
 *
 * Nothing here is in the flow and nothing here can be tapped, so neither layer
 * can move the document's scroll extents. Both use `inset: 0` and
 * `position: fixed` for that reason — an absolutely-positioned layer with a
 * negative inset contributes to the document's scrollable area even when no
 * element's bounding box reports out of bounds.
 */

/** `MenuParticles.gd`'s PALETTE, as 8-bit triples. */
const PALETTE: [number, number, number][] = [
  [232, 220, 190], // warm white-gold
  [200, 168, 75],  // gold
  [180, 160, 220], // lavender
  [140, 160, 220], // periwinkle
  [255, 255, 255], // pure white
]

interface Speck {
  x: number
  y: number
  size: number
  /** Horizontal wander and downward fall, both in px per 60fps frame. */
  vx: number
  vy: number
  color: [number, number, number]
  baseAlpha: number
  alpha: number
  flickerSpeed: number
  flickerPhase: number
  flickerAmp: number
  star: boolean
}

/**
 * ONE SPECK PER 2,500 px², CAPPED.
 *
 * A 390x844 phone asks for 132 by density, and this repaints every one of them
 * every frame on a battery. The cap takes a phone-sized viewport to 90, which
 * is the measured budget below; a desktop window is allowed the full density
 * up to 200 because it is not the device the frame cost matters on.
 */
function speckCount(w: number, h: number): number {
  const byArea = Math.round((w * h) / 2500)
  const cap = Math.min(w, h) < 480 ? 90 : 200
  return Math.max(12, Math.min(byArea, cap))
}

const rand = (lo: number, hi: number): number => lo + Math.random() * (hi - lo)

/**
 * THE AMBIENT LAYER HAS A CEILING, SO IT CAN NEVER BECOME A GROUND.
 *
 * `MenuParticles.gd` runs base alpha 0.25-0.90 with a flicker on top, and its
 * palette includes pure white. Behind an opaque panel that is free; behind a
 * string with only the page behind it, one bright speck IS that string's
 * ground, and it measured 1.53:1 under the 28px title and 1.16:1 under the home
 * lede. Two of those were fixed where they belonged — a plate under the lede, a
 * cartouche under each of the clash strip's two text rows — but the title is
 * meant to sit in the light with nothing between, so the layer itself carries
 * the bound.
 *
 * 0.18 is derived, not chosen, and the derivation has one trap in it. The worst
 * case is a full-alpha WHITE speck on the page ground (~#161009); the title is
 * `--gold-hi` at 28px/700, i.e. WCAG LARGE text with a 3:1 floor, which needs
 * the composite under ~109/255, i.e. an effective alpha under 0.379.
 *
 * THAT IS NOT THE CEILING, BECAUSE A SPECK IS DRAWN AS A STACK. The source
 * draws a dot as three concentric fills (halo 0.25, mid 0.5, centre 1.0) and a
 * star as four (0.18, 0.85, 0.4, 1.0), so the centre of a star composites to
 * 1 - (1 - 0.18c)(1 - 0.85c)(1 - 0.4c)(1 - c) — at c = 0.30 that is 0.57, not
 * 0.30. The first pass took the ceiling for the answer and measured the title
 * at 1.88:1. At c = 0.18 the stack composites to 0.376 and the title measures
 * above its floor with the margin intact.
 */
const CEILING = 0.18

/** `_make_speck`. `randomY` false spawns it just above the top edge, which is
 *  how a recycled speck re-enters. */
function makeSpeck(w: number, h: number, randomY: boolean): Speck {
  const base = rand(0.25, 0.90)
  return {
    x: Math.random() * w,
    y: randomY ? Math.random() * h : -6,
    size: rand(0.4, 1.8),
    vx: (Math.random() - 0.5) * 0.08,
    vy: rand(0.04, 0.22),
    color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
    baseAlpha: base,
    alpha: base,
    flickerSpeed: rand(0.5, 2.5),
    flickerPhase: Math.random() * Math.PI * 2,
    flickerAmp: rand(0.15, 0.35),
    star: Math.random() < 0.18,
  }
}

export interface AtmosphereStats {
  /** Frames drawn since mount. */
  frames: number
  /** Total ms spent inside the draw call. */
  ms: number
  /** Live speck count. */
  count: number
  /** Backing-store scale actually used. */
  dpr: number
  /** True while the loop is parked (hidden tab, or reduced motion). */
  parked: boolean
}

export function mountAtmosphere(): AtmosphereStats {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')

  const canvas = document.createElement('canvas')
  canvas.id = 'atmos-motes'
  canvas.setAttribute('aria-hidden', 'true')
  const vignette = document.createElement('div')
  vignette.id = 'atmos-vignette'
  vignette.setAttribute('aria-hidden', 'true')
  // After `#app` in tree order on purpose: both this canvas and the clash
  // strip's own lamp band are negative-z-index boxes in the root stacking
  // context, so tree order is what decides which paints on top. The motes have
  // to be the later one or the seam's lamp would paint over them and the strip
  // would be the one place in the room with no dust in the beam.
  document.body.append(canvas, vignette)

  const ctx = canvas.getContext('2d')
  const stats: AtmosphereStats = { frames: 0, ms: 0, count: 0, dpr: 1, parked: false }
  if (!ctx) return stats

  let specks: Speck[] = []
  let w = 0
  let h = 0
  let dpr = 1
  let raf = 0
  let last = 0
  let clock = 0

  /**
   * THE LOW-POWER PATH, part 1: the backing store is capped at 1.5x.
   *
   * A speck is a 1px dot with a soft halo; at 3x device pixels it is the same
   * dot costing four times the fill. 1.5 keeps the halo smooth on a phone and
   * is where the measured cost below was taken.
   */
  const resize = (): void => {
    w = window.innerWidth
    h = window.innerHeight
    dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const want = speckCount(w, h)
    if (specks.length > want) specks.length = want
    while (specks.length < want) specks.push(makeSpeck(w, h, true))
    stats.count = specks.length
    stats.dpr = dpr
    if (parked()) draw()
  }

  /** `_update_specks`, with `scale` converting px/frame at 60fps to this frame. */
  const step = (dt: number): void => {
    clock += dt
    const scale = dt * 60
    for (const s of specks) {
      s.x += s.vx * scale
      s.y += s.vy * scale
      const a = s.baseAlpha
        + Math.sin(clock * s.flickerSpeed + s.flickerPhase) * s.flickerAmp
      s.alpha = Math.max(0.02, Math.min(1, a))
      if (s.y > h + 8) Object.assign(s, makeSpeck(w, h, false))
      if (s.x < -8) s.x = w + 4
      else if (s.x > w + 8) s.x = -4
    }
  }

  const rgba = (c: [number, number, number], a: number): string =>
    `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`

  /** `_draw_dot`: a soft halo, a mid ring and a hard centre. */
  const dot = (s: Speck): void => {
    ctx.fillStyle = rgba(s.color, s.alpha * 0.25)
    ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 3, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = rgba(s.color, s.alpha * 0.5)
    ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 1.4, 0, Math.PI * 2); ctx.fill()
    ctx.fillStyle = rgba(s.color, s.alpha)
    ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 0.55, 0, Math.PI * 2); ctx.fill()
  }

  /** `_draw_star`: four arms, four softer diagonals, halo and centre. */
  const star = (s: Speck): void => {
    const arm = s.size * 2.4
    ctx.fillStyle = rgba(s.color, s.alpha * 0.18)
    ctx.beginPath(); ctx.arc(s.x, s.y, arm * 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.strokeStyle = rgba(s.color, s.alpha * 0.85)
    ctx.lineWidth = 0.7
    ctx.beginPath()
    ctx.moveTo(s.x - arm, s.y); ctx.lineTo(s.x + arm, s.y)
    ctx.moveTo(s.x, s.y - arm); ctx.lineTo(s.x, s.y + arm)
    ctx.stroke()
    const diag = arm * 0.55
    ctx.strokeStyle = rgba(s.color, s.alpha * 0.4)
    ctx.lineWidth = 0.5
    ctx.beginPath()
    ctx.moveTo(s.x - diag, s.y - diag); ctx.lineTo(s.x + diag, s.y + diag)
    ctx.moveTo(s.x + diag, s.y - diag); ctx.lineTo(s.x - diag, s.y + diag)
    ctx.stroke()
    ctx.fillStyle = rgba(s.color, s.alpha)
    ctx.beginPath(); ctx.arc(s.x, s.y, s.size * 0.6, 0, Math.PI * 2); ctx.fill()
  }

  const draw = (): void => {
    const t0 = performance.now()
    ctx.clearRect(0, 0, w, h)
    // One ceiling for the whole layer rather than a clamp per speck: the
    // emitter's own alpha distribution is preserved in relative terms, and no
    // speck can ever be a legible ground. See `CEILING`.
    ctx.globalAlpha = CEILING
    for (const s of specks) (s.star ? star : dot)(s)
    ctx.globalAlpha = 1
    stats.ms += performance.now() - t0
    stats.frames += 1
  }

  const frame = (now: number): void => {
    const dt = last ? Math.min((now - last) / 1000, 0.05) : 1 / 60
    last = now
    step(dt)
    draw()
    raf = requestAnimationFrame(frame)
  }

  /**
   * THE LOW-POWER PATH, part 2 and 3: a hidden tab costs nothing, and reduced
   * motion holds a single still frame rather than an empty canvas — the specks
   * are the room's dust, and removing them removes the room, not the motion.
   */
  const parked = (): boolean => document.hidden || reduce.matches
  const sync = (): void => {
    stats.parked = parked()
    if (parked()) {
      if (raf) { cancelAnimationFrame(raf); raf = 0 }
      draw()
    } else if (!raf) {
      last = 0
      raf = requestAnimationFrame(frame)
    }
  }

  /**
   * WHERE THE VIGNETTE STOPS.
   *
   * The vignette's job is atmosphere and its cost is contrast, and the one
   * place on this phone that may not pay it is the bottom of the screen: the
   * live prompt and its sticky bar are where every commit in the game is made.
   * So the layer is masked to nothing from the top of the decision panel down.
   * Measured, not assumed — the panel's height changes with every prompt.
   */
  const floor = (): void => {
    const tops: number[] = []
    for (const sel of ['#prompt', '#waiting', '.sticky-actions']) {
      const node = document.querySelector(sel)
      if (node) {
        const box = node.getBoundingClientRect()
        if (box.height > 0) tops.push(box.top)
      }
    }
    const y = tops.length ? Math.max(0, Math.min(...tops)) : window.innerHeight
    document.documentElement.style.setProperty('--vig-floor', `${Math.round(y)}px`)
  }

  const relayout = (): void => { resize(); floor() }
  window.addEventListener('resize', relayout)
  document.addEventListener('visibilitychange', sync)
  reduce.addEventListener('change', sync)
  // The renderer replaces `#app`'s children wholesale, so the floor is
  // re-measured from the DOM rather than pushed by each screen — one
  // observer instead of a call site in every render path.
  new MutationObserver(() => floor()).observe(document.getElementById('app')!,
    { childList: true, subtree: true })

  resize()
  floor()
  sync()

  const scope = window as unknown as Record<string, unknown>
  scope.__atmos = stats
  return stats
}
