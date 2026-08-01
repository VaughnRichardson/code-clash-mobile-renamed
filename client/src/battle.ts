import { button, clear, el, pretty } from './ui'
import { cardArt, image, leaderArt } from './art'
import type {
  BattleEvent, CardView, Catalog, GameState, ItemSpec, LeaderSpec,
  PromptRequest, SideView,
} from './types'

/** One ability's catalogue entry, as served by `/api/catalog`. Declared here
 *  rather than in `types.ts` because only this screen reads it. */
interface AbilityInfo { id: string; name: string; description: string }

/** What the board shows in a combatant's unit slot: a real unit, or the reason
 *  there isn't one. An empty slot is never rendered blank — during a blind pick
 *  neither side has an active unit, and a bare dash reads as a rendering bug. */
interface UnitSlot {
  name: string
  power: number
  stamina: number
  stolen?: string | null
  /** Set when there is no unit; the string is what the slot says instead. */
  vacant?: string
}

/** The enemy unit as far as this client is allowed to know it. `null` means it
 *  is concealed, which is the normal state during a blind pick.
 *
 *  It carries its ABILITIES, not just its statline: a forecast that ignores
 *  them announces a trade against a Guardian that is about to shrug the hit
 *  off, which is the same lie in the other direction. */
interface Enemy {
  name: string
  power: number
  stamina: number
  ability: string | null
  spent: boolean
  stolen: string | null
  /** Their side-state, for the same entry-buff reading applied to your own
   *  cards: a unit fielded under foresight has not entered yet either. */
  first: boolean
  discards: number
}

/** What a unit will pick up when its ON_ENTRY ability resolves — held apart
 *  from the statline on purpose, see `entryBuff`. */
interface Buff { power: number; stamina: number; note: string }

/** The side-state an offered card's entry buff depends on. */
interface EntryContext { ownFirst: boolean; ownDiscards: number }

/** Catalogue fields this screen reads that the shared wire type does not carry.
 *  Declared here for the same reason `AbilityInfo` is: nothing else wants them. */
interface BattleCatalogExtras {
  abilities?: AbilityInfo[]
}

/** A hatched block standing in for a value this seat is not allowed to see.
 *  Deliberately NOT a `?`: a circled `?` is this screen's help affordance, and
 *  the same glyph must not be both a control and a value. */
function veil(): HTMLElement {
  return el('span', { class: 'veil', 'aria-label': 'concealed' })
}

/**
 * The battle screen: a card table, seen from the near chair.
 *
 * Renders whatever the server last sent and nothing else. It holds no game
 * state of its own — the server is authoritative and the client is a view.
 *
 * THE LAYOUT IS A SEAT, NOT A DIAGRAM. `docs/reference/godot-battle.png` is the
 * original: a horizontal table with your deck as a visible face-down STACK,
 * your card, a versus mark, their card, their stack — the board owning the
 * centre with the log a narrow slab at the edge. Rotated into a portrait phone
 * that becomes a near half and a far half:
 *
 *   FAR    their rail, their deck pile, their card — smaller, tipped away,
 *          face-DOWN while they are still committing. Distance carries "not
 *          yours" so a cool border does not have to do it alone.
 *   FELT   the seam: the duel, the standing, the ornament. One calm surface.
 *   NEAR   your card in its place, your deck pile, your rail.
 *   HAND   the offered cards at the bottom edge, large, fanned and lifted, as
 *          if held. This is the pick, and it is the biggest thing on screen.
 *
 * The rails, the chips and the log are FURNITURE: single-line, sunk, at the
 * margins. They used to be two tall panels owning ~40% of the phone while the
 * decision was a strip at the bottom; that ranking is inverted here.
 *
 * Two colour channels, kept strictly apart, because tangling them was the last
 * round's worst bug:
 *
 *   OWNERSHIP  gold = yours, cool blue = theirs. Applied to bars, stats,
 *              labels, tally columns and the standing line — "who is ahead" is
 *              an ownership question. Says nothing about good or bad.
 *   VALENCE    green = good for YOU, red/amber = bad for YOU. Never used from
 *              the opponent's point of view, and it appears only in forecasts
 *              and warnings about your own units and your own loss races.
 *
 * JEOPARDY — how close a side is to losing — is a third reading, and it is
 * carried by the METERS on BOTH panels: in valence amber/red on yours, and in
 * an intensifying pale blue on theirs. It is deliberately absent from the
 * standing token, which carries lead and only lead.
 */
export class BattleScreen {
  private state: GameState | null = null
  private prompt: PromptRequest | null = null
  private waitingOn: number[] = []
  private events: BattleEvent[] = []
  private abilities: Record<string, AbilityInfo> = {}
  private leaders: Record<string, LeaderSpec> = {}
  /** Which leader chips have their explanation open, per side. Kept on the
   *  screen rather than in the DOM because every server update re-renders. */
  private leaderOpen: Record<'you' | 'them', boolean> = { you: false, them: false }
  /** Set by a prompt builder; rendered last so it can stick to the bottom. */
  private pendingActions: HTMLElement | null = null
  /**
   * Whether the frame being rendered carries a blow landing.
   *
   * The Godot battle punches on a hit — `CLASH_FLASH`, a tween driving
   * `modulate` to Color(1.5, 0.5, 0.5) over 0.15s. This is that beat, on the
   * clash strip: the seam where the two units meet takes a short warm flash
   * when an exchange actually resolves.
   *
   * ONE-SHOT AND SELF-CLEARING. It is set from the events of a single server
   * frame and consumed by the render that frame triggers, so it cannot leak
   * into the next screen — a flash left running over a decision is the one
   * thing this direction may not do.
   */
  private struck = false

  constructor(
    private root: HTMLElement,
    private catalog: Catalog,
    private onAnswer: (value: unknown) => void,
    private onExit: () => void,
  ) {
    const extra = catalog as unknown as BattleCatalogExtras
    for (const ability of extra.abilities ?? []) {
      this.abilities[ability.id] = ability
    }
    for (const leader of catalog.leaders ?? []) this.leaders[leader.id] = leader
  }

  update(state: GameState, events: BattleEvent[], prompt: PromptRequest | null,
         waitingOn: number[]): void {
    this.state = state
    this.prompt = prompt
    this.waitingOn = waitingOn
    // No "last unit they fielded" is kept. That prior was rendered in the slot
    // under the veil, which only ever exists when they have NO active unit —
    // so it always described a unit the log two rows above had just reported
    // dead. Past information must not be dressed as present intelligence; the
    // priors line below the veil is now built from live state only.

    // A blow landed on this frame when a unit fell. Deliberately NOT `entry`
    // or `field`: a unit walking on is not a hit, and flashing on every draw
    // would make the beat mean nothing.
    this.struck = events.some(e => e.kind === 'died')
    this.events.push(...events)
    this.render()
    // Consumed. A re-render from any other cause — opening a leader blurb,
    // toggling a card's keyword — must not replay the punch.
    this.struck = false
  }

  render(): void {
    const state = this.state
    if (!state) return
    clear(this.root)
    this.pendingActions = null

    if (state.result) {
      // No board here. A finished battle's board could only show entry stats,
      // which flatly contradicted a headline like "you ran out of units".
      this.root.append(this.resultBanner(state))
      this.root.append(this.summary(state))
      this.root.append(this.logArea(true))
      // Not `primary`. The cream treatment is the "act now" channel — the one
      // introduced precisely so that acting and owning stopped sharing gold —
      // and leaving a finished battle is a navigational dismissal, not an act.
      // Giving it the same weight as "Field Duelist" is the category error
      // `--action` exists to prevent.
      this.root.append(el('div', { class: 'sticky-actions snug' },
        button('Back to menu', this.onExit, { class: 'wide' })))
      return
    }

    // Table, then the narration of it, then your hand — the hand sits last so
    // it lands under the thumb, which is also where a held hand belongs.
    this.root.append(this.table(state))
    this.root.append(this.logArea(false))
    const prompt = this.promptArea()
    // The sticky bar is an opaque block that sits ON the last of the panel's
    // content. Reserve its height inside the panel rather than letting it
    // occlude a row — on the shop screen that hid half of an item you might buy.
    if (this.pendingActions) prompt.classList.add('has-actions')
    this.root.append(prompt)
    if (this.pendingActions) this.root.append(this.pendingActions)
  }

  // ── the table ──

  /** Two seats across a felt, from the near chair. */
  private table(state: GameState): HTMLElement {
    return el('div', { class: 'table' },
      this.seat(state.them, false),
      this.clashStrip(state),
      this.seat(state.you, true))
  }

  private liveUnit(side: SideView, isYou: boolean): UnitSlot {
    if (!side.active) {
      // Why the slot is empty, not that it is: on a blind pick your unit is
      // still being chosen and theirs is deliberately CONCEALED — a state with
      // a shape of its own, not an absence.
      return { name: '', power: 0, stamina: 0,
               vacant: isYou ? 'open' : 'concealed' }
    }
    return {
      name: side.active.name,
      power: side.power,
      // The engine can be waiting on a revive decision after lethal damage,
      // when its internal total is below zero. A card reads as defeated at
      // zero; negative stamina is combat arithmetic, not player-facing state.
      stamina: Math.max(0, side.stamina),
      stolen: side.active.stolen,
    }
  }

  /**
   * One seat: a rail of furniture, a status row, and the lane the cards are on.
   *
   * The two seats are MIRRORED about the felt, so both rails end up at the
   * outer edges of the phone and the two card lanes meet in the middle with
   * only the seam between them. That is the whole geometry of sitting at a
   * table: what is yours is near and low, what is theirs is far and high.
   */
  private seat(side: SideView, isYou: boolean): HTMLElement {
    const slot = this.liveUnit(side, isYou)
    const node = el('div', { class: `seat ${isYou ? 'you' : 'them'}` })
    node.setAttribute('data-side', isYou ? 'you' : 'them')
    const parts = [this.leaderBlurb(side, isYou),
                   this.lane(side, slot, isYou)].filter(isNode)
    node.append(...(isYou ? parts.reverse() : parts))
    return node
  }

  /**
   * The lane: the deck pile, the card position, and the seat's leader mark.
   *
   * THE PILE IS THE POINT. `docs/reference/README.md`: *"the deck stacks are
   * the strongest card-game signal in the whole scene and the web build has no
   * equivalent"*. It is also the units race made physical — the same number the
   * rail prints, as a stack that thins.
   */
  private lane(side: SideView, slot: UnitSlot, isYou: boolean): HTMLElement {
    const notes = el('div', { class: 'notes' },
      slot.stolen
        ? el('div', { class: 'stolen', text: `stole ${pretty(slot.stolen)}` })
        : null,
      // The danger is marked OUTSIDE the statline. Painting the stamina digit
      // red inside a gold-and-white token put ownership and valence in one
      // four-glyph string; the badge stays pure ownership and the warning gets
      // its own words. Never on their side: their unit dying is not an alarm.
      isYou && !slot.vacant ? this.peril(slot) : null)

    return el('div', { class: 'lane' },
      el('div', { class: 'pile-zone' },
        this.discardPile(side, isYou), this.deckPile(side, isYou)),
      el('div', { class: 'place' }, this.stageNode(slot, isYou), notes),
      // The seat's own column: who is playing, and what they have to spend.
      // Both used to be full-width rows of their own, which cost ~40px of
      // furniture on a screen that measured 16px over the fold — and the lane
      // beside the card had an empty column the whole time.
      el('div', { class: 'seatcol' },
        this.seatMark(side, isYou), this.chips(side, isYou)))
  }

  /**
   * The card position on the felt — always drawn, always card-shaped.
   *
   * Three states, and the middle one is the object this screen was missing:
   *
   *   FACE-UP    their unit, or yours, as a real card.
   *   FACE-DOWN  they are committing at the same moment you are, so there IS a
   *              card in front of them and you may not turn it over. A dashed
   *              box with a hatch read as a failed image; a card back reads as
   *              a hidden card, which is what it is.
   *   EMPTY      yours during a pick. Nothing is concealed from you — your card
   *              is in your hand at the bottom of the screen — so the place is
   *              set and waiting rather than covered.
   */
  private stageNode(slot: UnitSlot, isYou: boolean): HTMLElement {
    const stage = el('div', { class: 'stage' })
    if (!slot.vacant) {
      stage.append(this.unitCard(slot, isYou))
      return stage
    }
    if (!isYou) {
      stage.append(this.cardBack())
      return stage
    }
    // A CARD-SHAPED PLACE, not a gap. It is built as a card so that the two
    // seats stay structurally the same object at two sizes — which is what
    // makes near/far a measurable relation rather than a look.
    stage.classList.add('vacant')
    stage.setAttribute('data-drop-target', 'pick')
    stage.setAttribute('role', 'group')
    stage.setAttribute('aria-label', 'Open field position')
    const ghost = el('div', { class: 'card ghost', 'aria-hidden': 'true' },
      el('div', { class: 'art' }))
    ghost.setAttribute('data-own', 'you')
    stage.append(ghost)
    return stage
  }

  /** A unit on the table: art window, name strip, badge footer — the parent
   *  game's card, at the size distance says it should be. */
  private unitCard(slot: UnitSlot, isYou: boolean): HTMLElement {
    const node = el('div', { class: 'card on-table' },
      this.artWindow(slot.name),
      el('div', { class: 'shelf' },
        el('div', { class: 'unit', text: slot.name }),
        this.statPair(slot, isYou)))
    node.setAttribute('data-own', isYou ? 'you' : 'them')
    return node
  }

  /** The face-down card: the gold diamond back from the original's deck art,
   *  at full card size. The one object doing pure atmosphere work. */
  private cardBack(): HTMLElement {
    const node = el('div', { class: 'card on-table face-down' },
      el('div', { class: 'back', 'aria-hidden': 'true' },
        el('i', { class: 'lozenge' })))
    node.setAttribute('data-own', 'them')
    node.setAttribute('aria-label', 'Face-down opponent card')
    return node
  }

  /** The unit's illustration, or the frame alone when nothing is drawn for it
   *  yet — a card with no art is a card, a card with a broken image is a bug. */
  private artWindow(name: string): HTMLElement {
    const src = cardArt(name)
    return el('div', { class: 'art' },
      src ? image(src, 'ill', '') : el('span', { class: 'ill blank' }),
      el('span', { class: 'gloss', 'aria-hidden': 'true' }))
  }

  /**
   * A deck as a physical pile, thinning as it runs down.
   *
   * The leaf count is a coarse reading on purpose: four is a full deck, one is
   * nearly out. The exact figure is on the rail two rows away, and a pile that
   * dropped one visible card per draw would be an animation nobody asked for.
   */
  private drawPileCount(side: SideView, isYou: boolean): number {
    if (isYou) {
      return Math.max(0, side.remaining - (side.hand?.length ?? 0))
    }
    // The opponent's hand contents are private, but its SIZE follows the
    // public table invariant: one held card behind an active unit, two while
    // choosing, or whatever remains at the end of the deck. This keeps the
    // physical pile honest without exposing a card identity.
    const held = Math.min(side.active ? 1 : 2, Math.max(side.remaining, 0))
    return Math.max(0, side.remaining - held)
  }

  private deckPile(side: SideView, isYou: boolean): HTMLElement {
    const left = this.drawPileCount(side, isYou)
    const leaves = left <= 0 ? 0 : Math.max(1, Math.min(6, Math.ceil(left / 5)))
    const pile = el('div', { class: `pile${leaves ? '' : ' spent'}` })
    for (let i = 0; i < Math.max(leaves, 1); i++) {
      pile.append(el('i', { class: 'leaf', style: `--i:${i}` },
        el('span', { class: 'lozenge', 'aria-hidden': 'true' })))
    }
    const deck = el('div', {
      class: 'deck',
      'aria-label': `${left} cards in ${isYou ? 'your' : 'their'} draw pile`,
    }, pile, el('span', { class: 'pile-count', text: String(left) }))
    return deck
  }

  /** Fallen cards stay on the table as a small, face-up graveyard. The names
   *  are intentionally not reconstructed from log history: revive effects can
   *  change the discard count without leaving a corpse, while the count is
   *  authoritative on every frame. */
  private discardPile(side: SideView, isYou: boolean): HTMLElement {
    const count = Math.max(side.discards, 0)
    const leaves = count <= 0 ? 1 : Math.min(3, count)
    const pile = el('div', { class: `discard-pile${count ? '' : ' empty'}` })
    for (let i = 0; i < leaves; i++) {
      pile.append(el('i', { class: 'discard-leaf', style: `--i:${i}` }))
    }
    return el('div', {
      class: 'discard',
      'aria-label': `${count} cards in ${isYou ? 'your' : 'their'} discard pile`,
    }, pile, count ? el('span', { class: 'pile-count', text: String(count) }) : null)
  }

  /**
   * The one-line warning under YOUR unit's name — and it must be the SAME
   * three-way reading the offered cards get.
   *
   * It used to test `stamina <= enemy.power` and nothing else, so a mutual kill
   * (your Vanguard 6/4 into their Martyr 4/6: your 6 takes their 6, their 4
   * takes your 4) announced only your half of it, in alarm red, on the screen
   * where a 3-gold Ward sits under a purse of exactly 3. A trade is a NEUTRAL
   * outcome — `.forecast.even` says so in as many words — and red is reserved
   * for "you die and they do not".
   */
  private peril(slot: UnitSlot): HTMLElement | null {
    const enemy = this.enemyUnit()
    const active = this.state?.you.active
    if (!enemy || !active) {
      return slot.stamina <= 2
        ? el('div', { class: 'peril', text: 'one hit from falling' })
        : null
    }
    const card: CardView = { ...active, power: slot.power,
                             stamina: slot.stamina }
    // Your unit is on the field but the entry phase runs AFTER the shop, so a
    // unit fielded this duel may still have its buff to collect.
    const view = outlookFor(card, enemy,
                            entryBuff(card.ability, card.spent,
                                      this.entryContext()))
    // Same rule the offered cards follow: when the engine's seat order is what
    // decides it, this client cannot know, and silence was the worst of the
    // three readings — a 50% chance your unit falls, unremarked, because the
    // you-resolve-first branch happened to come back a win.
    if (view.race) {
      return el('div', { class: 'peril calm',
                         text: 'this exchange is a coin flip' })
    }
    if (view.result === 'lose') {
      return el('div', { class: `peril${view.certain ? '' : ' calm'}`,
                         text: 'dies this exchange' })
    }
    if (view.result === 'trade') {
      return el('div', { class: 'peril calm',
                         text: `trades with their ${enemy.name}` })
    }
    return null
  }

  /**
   * The badge footer, from the original card: two discs flanking a `PWR · STA`
   * caption.
   *
   * THE ORIGINAL'S DISCS ARE RED AND GREEN AND THESE ARE NOT, DELIBERATELY.
   * There the pair is on both sides of the table, so red/green cannot be
   * valence — they are just "power" and "stamina". Here they would be, because
   * this screen prints a FORECAST eight pixels under them, in green for "wins"
   * and red for "dies", and the whole reason that line exists is that the
   * screen once steered players onto the losing card. Two greens and two reds
   * a line apart, meaning different things, is the exact misread this codebase
   * has spent nine rounds removing. So the SHAPE is the original's — a struck
   * disc, a caption, a second disc — and the hues are OWNERSHIP: the power
   * disc is filled in the seat's own colour, gold on yours and cool on theirs,
   * and the stamina disc is a dished dark one with a rim in the same hue.
   * Green and red stay exclusively on the forecast, on your half only.
   */
  private statPair(slot: UnitSlot, isYou: boolean): HTMLElement {
    if (slot.vacant) {
      // A concealed statline is a veil, not a `?` — the circled `?` on this
      // screen is the "explain this" control and must stay one thing.
      return el('div', { class: `statpair ${isYou ? 'you' : 'them'}` },
        isYou ? null : el('div', { class: 'nums' }, veil()))
    }
    return el('div', { class: `statpair ${isYou ? 'you' : 'them'}` },
      el('div', { class: 'nums' },
        el('span', { class: 'pip pw', text: String(slot.power) }),
        el('span', { class: 'slash', text: 'pwr · sta' }),
        el('span', { class: 'pip st', text: String(slot.stamina) })))
  }

  /**
   * The seat's own marker: a leader portrait standing beside the deck, the way
   * a player sits beside theirs.
   *
   * It used to be a wide pill in the panel header. On a rail that is one line
   * tall there is nowhere for a 44px tap target to go — and the lane beside it
   * is 130px tall and had an empty column, so the identity went where the
   * space already was. The portrait is `/art/leaders/<id>.png`, one of the
   * three places §"Take, in order" says a glyph genuinely beats a word.
   */
  private seatMark(side: SideView, isYou: boolean): HTMLElement {
    const key: 'you' | 'them' = isYou ? 'you' : 'them'
    const wrap = el('div', { class: 'seatmark' })
    if (!side.leader) return wrap
    const open = this.leaderOpen[key]
    const port = leaderArt(side.leader)
    const spec = this.leaders[side.leader]
    const carriesCharges = side.charges > 0
      || (spec?.tags ?? []).some(tag => tag.includes('charge'))
    const chip = el('button', {
      type: 'button', class: `leader-chip${open ? ' open' : ''}`,
    },
      el('span', { class: 'leader-card-art' },
        port ? image(port, 'port', '') : el('span', { class: 'port blank' }),
        el('span', { class: 'leader-gloss', 'aria-hidden': 'true' })),
      el('span', { class: 'nm', text: spec?.name ?? pretty(side.leader) }),
      carriesCharges
        ? el('span', {
            class: `leader-charge${side.charges ? '' : ' empty'}`,
            'aria-label': `${side.charges} leader charges`,
          }, el('i', { 'aria-hidden': 'true' }),
             el('strong', { text: String(side.charges) }))
        : null,
      el('span', { class: 'q', text: '?' }))
    chip.setAttribute('aria-label', `What ${pretty(side.leader)} does`)
    chip.addEventListener('click', () => {
      this.leaderOpen[key] = !this.leaderOpen[key]
      this.render()
    })
    wrap.append(chip)
    return wrap
  }

  /** What that leader does, opened in place under its own seat. */
  private leaderBlurb(side: SideView, isYou: boolean): HTMLElement | null {
    const key: 'you' | 'them' = isYou ? 'you' : 'them'
    if (!side.leader || !this.leaderOpen[key]) return null
    const spec = this.leaders[side.leader]
    return el('p', { class: 'leader-blurb',
      text: spec?.blurb ?? 'No description available.' })
  }

  /** Spendables and statuses only — one quiet row on the rail's own edge. The
   *  leader is an identity (see `seatMark`) and the units counter is a bar. */
  private chips(side: SideView, isYou: boolean): HTMLElement | null {
    const row = el('div', { class: 'chips' })
    // Charges live on the leader card itself. That makes the counter belong to
    // the object that spends it instead of reading like an unrelated status.
    if (side.shield > 0) {
      row.append(el('span', { class: `chip count${isYou ? ' good' : ''}`,
        text: `Shield ${side.shield}` }))
    }
    if (side.fog_turns > 0) {
      row.append(el('span', { class: `chip${isYou ? ' warn' : ''}`,
        text: 'Fogged' }))
    }
    if (isYou && side.scout_turns) {
      row.append(el('span', { class: 'chip good', text: 'Scouting' }))
    }
    // An empty row is a 6px gap on a screen whose whole point is that the
    // furniture stays out of the way.
    return row.childElementCount ? row : null
  }

  /** The one match resource, drawn as one shared two-colour tug-of-war. */
  private clashStrip(state: GameState): HTMLElement {
    // `state.duel` counts duels COMPLETED — it is 0 before a card is played —
    // so printing it names the duel that just ENDED. It happened to be right
    // once, on the opening pick, and was one behind for every duel after: the
    // strip said "Duel 3" over a log whose own Duel 3 divider was followed by
    // both units falling, and over a panel asking for duel 4's unit. A pick is
    // the opening act of the NEXT duel; every other prompt (shop, withdraw, a
    // leader's confirm) happens inside the duel it belongs to and is already
    // counted.
    // The SHOP is the second act of the coming duel, not the last act of the
    // finished one: `_shop_phase` runs after the draw and before the engine
    // increments, with both units already on the field. It was reading as
    // "Duel 3 · shop" over a board showing duel 4's combatants — and once the
    // log's dividers were corrected the two contradicted each other outright.
    const done = Math.max(state.duel, 0)
    const kind = this.prompt?.kind
    const opening = kind === 'pick' || kind === 'shop'
    const duel = opening ? done + 1 : Math.max(done, 1)
    const phase = kind === 'shop' ? ' · shop'
      : kind === 'withdraw' ? ' · withdraw' : ''
    const mine = Math.max(0, state.you.units
      ?? state.you.remaining + (state.you.active ? 1 : 0))
    const theirs = Math.max(0, state.them.units
      ?? state.them.remaining + (state.them.active ? 1 : 0))
    const total = mine + theirs
    const share = total > 0 ? (mine / total) * 100 : 50
    const reading = mine === theirs ? 'Even'
      : mine > theirs ? `You lead by ${mine - theirs}`
        : `Opponent leads by ${theirs - mine}`

    // THE ORNAMENT, from `main_menu/MenuOrnament.gd`: a gold diamond with a
    // breathing centre dot, flanking the label. The Godot ornament's centre is
    // a bare diamond; here the centre is the duel number, because this strip
    // already has something true to say and an ornament should frame it rather
    // than displace it. Each terminator is a real element rather than a
    // pseudo-element so the outline, the glow and the centre dot can breathe on
    // their own channels — the source pulses all three at different depths.
    const tug = el('div', {
      class: `unit-tug${mine === theirs ? ' even' : mine > theirs ? ' you-lead' : ' them-lead'}`,
      role: 'progressbar',
      'aria-label': `Duel ${duel}${phase}. Unit balance`,
      'aria-valuemin': '0',
      'aria-valuemax': String(Math.max(total, 1)),
      'aria-valuenow': String(mine),
      'aria-valuetext': `You have ${mine} units. Opponent has ${theirs} units. ${reading}.`,
      'data-testid': 'unit-tug',
    },
      el('strong', { class: 'tug-score you', text: String(mine) }),
      el('div', { class: 'tug-track', 'aria-hidden': 'true' },
        el('i', { class: 'tug-fill you', style: `width:${share}%` }),
        el('i', { class: 'tug-fill them', style: `width:${100 - share}%` }),
        el('b', { class: 'tug-knot', style: `left:${share}%` })),
      el('strong', { class: 'tug-score them', text: String(theirs) }))

    return el('div', { class: `clash${this.struck ? ' struck' : ''}` }, tug)
  }

  // ── prompts ──

  private promptArea(): HTMLElement {
    if (!this.prompt) {
      const text = this.waitingOn.length
        ? 'Waiting for your opponent'
        : 'Resolving'
      return el('div', {
        class: 'panel waiting', id: 'waiting', text,
        role: 'status', 'aria-live': 'polite',
      })
    }
    const request = this.prompt
    const panel = el('div', { class: 'panel', id: 'prompt' })
    panel.setAttribute('data-prompt', request.kind)

    switch (request.kind) {
      case 'pick': return this.pickPrompt(panel, request)
      case 'shop': return this.shopPrompt(panel, request)
      case 'withdraw': return this.withdrawPrompt(panel, request)
      case 'smite': return this.confirmPrompt(panel,
        'Soften the enemy?',
        `Spend ${request.context.cost} charges to take `
        + `${request.context.value} stamina off the enemy unit.`)
      case 'empower': return this.confirmPrompt(panel,
        'Empower this unit?',
        `Spend ${request.context.cost} charges for `
        + `+${request.context.value} power this duel.`)
      case 'second_wind': return this.confirmPrompt(panel,
        'Stand back up?',
        request.context.strips_ability
          ? 'Your unit survives at 1 stamina, but loses its ability.'
          : 'Your unit survives at 1 stamina.')
      case 'revive': return this.confirmPrompt(panel,
        'Recover the fallen?',
        'Return this unit to the bottom of your deck at full strength.')
      default: return panel
    }
  }

  private pickPrompt(panel: HTMLElement, request: PromptRequest): HTMLElement {
    const foresight = request.context.foresight === true
    const options = request.options as CardView[]
    const enemy = this.enemyUnit()
    // The forced case is decided FIRST, because everything above it is written
    // for a decision. A two-line essay on how to weigh a pick, printed over a
    // screen with one card and one button, is four elements for one act.
    const forced = options.length === 2 && sameUnit(options[0], options[1])
    // The engine sends both halves of the entry condition with every pick.
    const ctx: EntryContext = {
      ownFirst: request.context.own_first === true,
      ownDiscards: Number(request.context.own_discards ?? 0),
    }

    // The card-shaped open position and the held cards carry the instruction.
    // Keep the decision named for assistive technology without printing a
    // second explanation between the hand and the table.
    panel.classList.add('pick-panel')
    panel.append(el('h3', { class: 'sr-only',
      text: forced ? 'Field your unit' : 'Choose your unit' }))
    if (foresight) panel.setAttribute('aria-description',
      'You can see the unit the opponent committed.')
    panel.append(this.offerArea(forced ? [options[0]] : options, enemy,
                                'data-pick', forced, ctx, null))
    return panel
  }

  /**
   * YOUR HAND — the offered units, at the near edge, held.
   *
   * The enemy is NOT drawn here any more, and that is the move the whole
   * layout turns on (`docs/NEXT_SESSION.md`, "the move that unlocks it"). The
   * old block put a 74px dashed foe tile and a clash mark on the same row as
   * the offers, which left ~112px per card and made the game's one irreversible
   * decision the smallest object on the screen. The opponent's slot is a real
   * card in their own lane at the top of the table now — face-down while they
   * are committing — so the offers get the full width and the enemy is one
   * object instead of two.
   *
   * The cards are fanned rather than gridded: two degrees of splay, the outer
   * edges dropped, lifted off the felt by their own shadow. It is the cheapest
   * honest way to say "these are in your hand and those are on the table".
   */
  private offerArea(options: CardView[], enemy: Enemy | null, hook: string,
                    forced: boolean, ctx: EntryContext | null,
                    head: HTMLElement | null): HTMLElement {
    const offers = el('div', { class: `offers hand${forced ? ' one' : ''}` })
    const target = hook === 'data-pick'
      ? this.root.querySelector<HTMLElement>('[data-drop-target="pick"]')
      : null
    target?.classList.add('ready')
    let committed = false
    const commit = (index: number, node: HTMLButtonElement): void => {
      if (committed) return
      committed = true
      offers.querySelectorAll<HTMLButtonElement>('button.pickable')
        .forEach(choice => {
          choice.disabled = true
          choice.classList.add('locked')
        })
      node.classList.add('chosen')
      node.setAttribute('aria-pressed', 'true')
      this.onAnswer(index)
    }

    options.forEach((card, index) => {
      const node = this.cardNode(card, enemy, ctx)
      if (forced) node.classList.add('flat')
      node.classList.add('pickable')
      node.setAttribute(hook, String(index))
      node.setAttribute('aria-pressed', 'false')
      let suppressClick = false
      node.addEventListener('click', event => {
        if (suppressClick) {
          event.preventDefault()
          suppressClick = false
          return
        }
        commit(index, node)
      })
      if (target) {
        this.bindCardDrag(node, target, () => commit(index, node),
          () => { suppressClick = true })
      }
      offers.append(node)
    })

    // WHOSE CARDS THESE ARE, on the prompt's own heading row rather than on a
    // line of its own. It used to be a centred caption above the cards naming
    // the two figures — but every card's footer now carries `pwr · sta` under
    // its own badges, which is where the original puts it and is one caption
    // per number instead of one per screen. What was left was a second label
    // saying the same thing as the heading two rows above it, for 26px on a
    // screen whose tightest shape had none to spare.
    if (head) head.append(el('span', { class: 'offer-cap',
                                      text: forced ? 'Your card' : 'Your hand' }))
    const column = el('div', { class: 'offer-col' }, offers)
    const wrap = el('div', { class: 'offer-block' }, column)
    if (forced) wrap.classList.add('flat')
    return wrap
  }

  /** Touch-first drag onto the open field position. Tap/click remains the
   *  keyboard-safe and test-safe path to the exact same answer index. */
  private bindCardDrag(node: HTMLButtonElement, target: HTMLElement,
                       commit: () => void,
                       suppressNextClick: () => void): void {
    node.addEventListener('pointerdown', down => {
      if (down.pointerType === 'mouse' && down.button !== 0) return
      const startX = down.clientX
      const startY = down.clientY
      let dragging = false

      const overTarget = (event: PointerEvent): boolean => {
        const rect = target.getBoundingClientRect()
        return event.clientX >= rect.left && event.clientX <= rect.right
          && event.clientY >= rect.top && event.clientY <= rect.bottom
      }
      const clear = (): void => {
        node.style.removeProperty('transform')
        node.classList.remove('dragging')
        target.classList.remove('drag-over')
        node.removeEventListener('pointermove', move)
        node.removeEventListener('pointerup', finish)
        node.removeEventListener('pointercancel', cancel)
      }
      const move = (event: PointerEvent): void => {
        if (event.pointerId !== down.pointerId) return
        const dx = event.clientX - startX
        const dy = event.clientY - startY
        if (!dragging && Math.hypot(dx, dy) < 7) return
        dragging = true
        node.classList.add('dragging')
        node.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
        target.classList.toggle('drag-over', overTarget(event))
      }
      const finish = (event: PointerEvent): void => {
        if (event.pointerId !== down.pointerId) return
        const accepted = dragging && overTarget(event)
        if (dragging) {
          event.preventDefault()
          suppressNextClick()
        }
        clear()
        if (accepted) commit()
      }
      const cancel = (event: PointerEvent): void => {
        if (event.pointerId === down.pointerId) clear()
      }

      node.setPointerCapture(down.pointerId)
      node.addEventListener('pointermove', move)
      node.addEventListener('pointerup', finish)
      node.addEventListener('pointercancel', cancel)
    })
  }

  /**
   * The one thing under the veil that the board above does not already say.
   *
   * Two rounds of this line have now been wrong by saying too much. It first
   * printed their last-fielded statline, which only ever renders when that
   * unit is already dead. It then printed public counters already visible
   * above, which dressed them as intelligence about the hidden card. What
   * belongs here is only the rule that makes this screen what it is: both
   * players commit at once.
   */
  private shopPrompt(panel: HTMLElement, request: PromptRequest): HTMLElement {
    const gold = Number(request.context.gold ?? 0)
    // What you HAVE and what a thing COSTS were the same gold pill, so the
    // screen read "3 gold / 3 gold / 3 gold" with no formal difference between
    // them. The purse is now an object — a coin and a count — and prices below
    // are plain text.
    // Only this round's stock. An "out of reach" section listing every item
    // the shop did not offer said "not offered" under a heading about price,
    // and buried the buy button under it.
    // CHEAPEST FIRST, not catalogue order. `items.py` lists by theme, so a
    // purse of 3 met Curse 3 and Ward 3 above the fold — two items that each
    // cost the whole purse — while Scout 1 and Fog 2, the pair that can be
    // bought TOGETHER, sat below it. Nothing on the screen was untrue; the
    // ranking simply put the affordable combination out of sight. `filter`
    // returns a new array, so the catalogue itself is not reordered, and the
    // sort is stable, so items of equal cost keep their catalogue order.
    const offered = new Set(request.options as string[])
    const stock = this.catalog.items.filter(item => offered.has(item.id))
      .sort((a, b) => a.cost - b.cost)

    // The stock COUNT is the scroll cue: a list that runs past the fold with
    // no idea how long it is looks like a list that has ended.
    panel.append(el('div', { class: 'row spread head' },
      el('span', { class: 'row tight' },
        el('h3', { text: 'Shop' }),
        el('span', { class: 'chip count', text: `${stock.length} in stock` })),
      el('span', { class: 'purse' },
        el('span', { class: 'lab', text: 'Purse' }),
        el('i', { class: 'coin', 'aria-hidden': 'true' }),
        el('span', { class: 'amt', text: String(gold) }))))

    // Two items you can each afford but not both is the whole decision, and
    // nothing said so — both simply showed a price equal to the balance.
    // ABOVE the stock, not under it. The shop occupies the bottom quarter of
    // the viewport, so a warning printed after four rows sat below the fold on
    // the one screen where money is spent — decision-critical text placed
    // where the decision has already been made. It belongs with the purse it
    // is a statement about.
    const costs = stock.filter(i => i.cost <= gold).map(i => i.cost)
      .sort((a, b) => a - b)
    if (costs.length > 1 && costs[0] + costs[1] > gold) {
      panel.append(el('p', { class: 'muted forecloses',
        text: 'You can afford one of these, not both.' }))
    }

    const list = el('div', { class: 'stack' })
    for (const item of stock) list.append(this.shopRow(item, gold))
    if (!stock.length) {
      list.append(el('p', { class: 'muted',
        text: 'Nothing is in stock this round.' }))
    }
    panel.append(list)

    // The ONLY prompt whose content can outrun the screen, and the one screen
    // where money is spent. So the skip does NOT float here: a sticky bar over
    // a scrolling list is a bar sitting on the items, and it gave the lowest-
    // value action the best real estate on the phone. In flow, at the end of
    // the list, where "none of these" belongs — the items keep the thumb zone
    // and nothing can ever be occluded.
    panel.append(button('Buy nothing', () => this.onAnswer(null),
                        { class: 'ghost wide skip', id: 'shop-skip' }))
    return panel
  }

  /** A purchase is the primary act here, and it says plainly when you cannot
   *  afford one. The price is plain text: a bordered pill made it the twin of
   *  the purse chip in the header, which is a different kind of number. */
  private shopRow(item: ItemSpec, gold: number): HTMLElement {
    const afford = gold >= item.cost
    const row = el('button', {
      type: 'button', class: `shop-row${afford ? '' : ' short'}`,
      disabled: !afford,
    },
      el('span', { class: 'line' },
        el('span', { class: 'nm', text: item.name }),
        afford
          ? el('span', { class: 'cost', text: `${item.cost} gold` })
          : el('span', { class: 'need',
                         text: `${item.cost - gold} more gold` })),
      el('span', { class: 'blurb', text: item.blurb }))
    row.setAttribute('data-buy', item.id)
    if (afford) row.addEventListener('click', () => this.onAnswer(item.id))
    return row
  }

  private withdrawPrompt(panel: HTMLElement,
                         request: PromptRequest): HTMLElement {
    const context = request.context
    const head = el('div', { class: 'row spread head' },
      el('h3', { text: 'Withdraw?' }),
      el('span', { class: 'chip count',
                   text: `◆ ${context.cost} charges` }))
    panel.append(head)
    panel.append(el('p', { class: 'muted',
      text: `Pull back your ${(context.active as CardView)?.name} `
          + `(${context.power}/${context.stamina}) and field another unit.`
          + (context.peek ? ' You will also see what comes next.' : '') }))
    const options = request.options as CardView[]
    const enemy = this.enemyUnit()
    const forced = options.length === 2 && sameUnit(options[0], options[1])
    // A withdraw resolves BEFORE the entry phase, so the incoming unit still
    // has its entry to come. `own_first` is not in this request's context; the
    // only duel on which it can be true is the first, which `state.duel` says.
    panel.append(this.offerArea(forced ? [options[0]] : options, enemy,
                                'data-withdraw', forced, this.entryContext(),
                                head))

    this.pendingActions = el('div', { class: 'sticky-actions snug' },
      button('Stay in', () => this.onAnswer(null),
             { class: 'ghost wide', id: 'withdraw-skip' }))
    return panel
  }

  private confirmPrompt(panel: HTMLElement, title: string,
                        body: string): HTMLElement {
    panel.append(el('h3', { text: title }))
    panel.append(el('p', { class: 'muted', text: body }))
    this.pendingActions = el('div', { class: 'sticky-actions snug' },
      el('div', { class: 'row' },
        button('No', () => this.onAnswer(false), { id: 'confirm-no' }),
        button('Yes', () => this.onAnswer(true),
               { class: 'primary', id: 'confirm-yes' })))
    return panel
  }

  /** The enemy unit if this client is allowed to see it — foresight, a Scout,
   *  or simply a duel already under way. `null` during a blind pick. */
  /** Your own side-state, for reading an incoming unit's entry condition off
   *  the board rather than out of a pick request's context. */
  private entryContext(): EntryContext {
    return { ownFirst: (this.state?.duel ?? 0) === 0,
             ownDiscards: this.state?.you.discards ?? 0 }
  }

  private enemyUnit(): Enemy | null {
    const them = this.state?.them
    if (!them || !them.active) return null
    return { name: them.active.name, power: them.power, stamina: them.stamina,
             ability: them.active.ability, spent: them.active.spent,
             stolen: them.active.stolen,
             first: (this.state?.duel ?? 0) === 0,
             discards: them.discards }
  }

  /**
   * A real portrait card: full-bleed animal art, title/stats integrated into
   * the top edge, and a compact rules plate low on the illustration.
   */
  private cardNode(card: CardView, enemy: Enemy | null,
                   ctx: EntryContext | null): HTMLButtonElement {
    const keyword = card.ability ? pretty(card.ability) : ''
    const buff = entryBuff(card.ability, card.spent, ctx)
    const view = forecast(card, enemy, buff)
    const info = card.ability ? this.abilities[card.ability] : undefined
    const spec = this.catalog.cards.find(candidate => candidate.name === card.name)
    const rulesText = info?.description ?? spec?.flavor ?? 'A dependable woodland ally.'
    const head = el('div', { class: 'card-head' },
      el('strong', { class: 'name', text: card.name }),
      el('div', { class: 'stats', 'aria-label':
        `${card.power} power, ${card.stamina} stamina` },
        el('span', { class: 'pip pw', text: String(card.power) }),
        el('span', { class: 'slash', text: '·' }),
        el('span', { class: 'pip st', text: String(card.stamina) })),
    )
    const rules = el('div', { class: 'card-rules' },
      el('div', { class: `ability-name${keyword ? '' : ' flavor'}`,
                  text: keyword || 'Woodland unit' }),
      el('div', { class: `ability-copy${info ? '' : ' flavor'}`,
                  text: rulesText }),
      buff ? el('div', { class: 'ability cond', text: buff.note }) : null,
      view.node)
    const node = el('button', {
      type: 'button',
      class: `card held${card.spent ? ' spent' : ''}`,
      'aria-label': `${card.name}. ${card.power} power, ${card.stamina} stamina. ${rulesText}.`,
    }, this.artWindow(card.name), head, rules)
    node.setAttribute('data-own', 'you')
    return node
  }

  // ── result and log ──

  private resultBanner(state: GameState): HTMLElement {
    const result = state.result!
    const won = result.winner === state.seat
    const drawn = result.winner === null
    const cls = drawn ? 'draw' : won ? 'win' : 'lose'
    const headline = drawn ? 'Draw' : won ? 'Victory' : 'Defeat'
    // The reason is only true from one side: read from the winner's viewpoint
    // it told a beaten player "they ran out of units".
    const why: Record<string, [string, string]> = {
      units: ['they ran out of units', 'you ran out of units'],
      deck: ['they ran out of units', 'you ran out of units'],
      discards: ['you lost fewer units', 'they lost fewer units'],
      damage: ['you dealt more damage', 'they dealt more damage'],
      draw: ['dead even', 'dead even'],
    }
    const pair = why[result.reason]
    const reason = drawn ? 'dead even'
      : pair ? pair[won ? 0 : 1] : result.reason
    return el('div', { class: `result-banner ${cls}` },
      el('div', { class: 'headline', text: headline }),
      el('div', { class: 'muted', text: reason }))
  }

  /** A finished battle needs a tally, not a live HUD. Values are coloured by
   *  OWNER; the better one is marked with a tick rather than by being the only
   *  legible number on the page. */
  private summary(state: GameState): HTMLElement {
    const result = state.result!
    const me = state.seat
    const them = 1 - state.seat
    // `better` is +1 where more is better and -1 where less is. Both rows use
    // +1 now: surviving units and damage dealt are straightforward totals.
    // "Units" counts UNITS LEFT here, matching the live panel's meter. The
    // tally used to count units FALLEN, so the same word ran one way during
    // the battle and the other way on the last screen of it — with the tick on
    // the lower number, which is the good column only under the inverted
    // reading. One polarity, both screens.
    const deck = this.catalog.deck_size || 30
    const left = (fallen: number): number => Math.max(deck - fallen, 0)
    const rows: [string, number, number, number][] = [
      ['Units left', result.units?.[me] ?? left(result.discards[me] ?? 0),
       result.units?.[them] ?? left(result.discards[them] ?? 0), 1],
      ['Damage dealt', result.damage[me] ?? 0, result.damage[them] ?? 0, 1],
    ]
    const cell = (value: number, owner: string, best: boolean): HTMLElement =>
      el('span', { class: `val ${owner}` },
        best ? el('span', { class: 'mark', text: '✓' }) : null,
        el('span', { text: String(value) }))

    // A tick means "did better in this column" and every row can earn one, so
    // three ticks read as three reasons the match ended. Only ONE row ended
    // it: `Damage dealt` is a tiebreak that never came up when the result was
    // `deck`, and it wore the same mark as the race that actually ran out.
    // The row that decided it says so.
    const decidedBy: Record<string, string> = {
      units: 'Units left', deck: 'Units left', discards: 'Units left',
      damage: 'Damage dealt',
    }
    const decided = decidedBy[result.reason] ?? ''

    const grid = el('div', { class: 'tally' },
      el('span', { class: 'lab' }),
      el('span', { class: 'col you', text: 'You' }),
      el('span', { class: 'col them', text: 'Them' }))
    for (const [label, mine, theirs, sign] of rows) {
      const better = mine === theirs ? ''
        : (mine - theirs) * sign > 0 ? 'you' : 'them'
      const ended = label === decided
      grid.append(
        el('span', { class: `lab${ended ? ' decided' : ''}` }, label,
          ended ? el('span', { class: 'why', text: 'decided it' }) : null),
        cell(mine, 'you', better === 'you'),
        cell(theirs, 'them', better === 'them'))
    }
    return el('div', { class: 'panel' },
      el('div', { class: 'row spread head' },
        el('h3', { text: 'Final tally' }),
        el('span', { class: 'chip count', text: `${result.duels} duels` })),
      grid)
  }

  private logArea(final: boolean): HTMLElement {
    // On any screen carrying a DECISION the log was outranking the decision.
    // At the shop it took 25% of the viewport replaying events just watched,
    // over a single buyable row. On a midgame pick it was worse: the log sat
    // at its full 26vh cap while the two forecasts — the entire reason to
    // choose one card over the other — fell 5px past the fold of an 844px
    // phone, under card borders running off the bottom edge. The taps that
    // commit were in the thumb arc and the reason to choose between them was
    // not. History is the lowest-value thing on every one of those screens.
    //
    // EVERY pick and withdraw, INCLUDING a blind one. This used to require a
    // visible enemy, on the reasoning that a concealed-enemy panel is "barely
    // 190px" and capping there would only convert story into background. That
    // was measured false: a blind pick offering two units whose abilities are
    // named differently from the units renders two more rows and comes to
    // 231px, and the page came to 886px against an 844px viewport — the last
    // thing on the phone was the priors sentence sliced through its x-height
    // with the panel's bottom border cut off. Worse, the exemption made FITTING
    // A FUNCTION OF THE DRAW: the same screen fits at exactly 844 when the two
    // offers happen to echo their own keywords (Vanguard/Vanguard,
    // Martyr/Martyr) and the ability rows are suppressed. `tests/match.spec.ts`
    // now pins the whole shape class, not the instance.
    const kind = this.prompt?.kind
    const deciding = kind === 'pick' || kind === 'withdraw'
    // The shop's list can outrun the screen on its own, so it keeps the
    // tighter of the two caps.
    const cap = kind === 'shop' ? ' terse shopping' : deciding ? ' terse' : ''
    const wrap = el('div', { class: `log-wrap${final ? ' final' : ''}${cap}` })
    const log = el('div', { class: 'log', id: 'log' })
    const seat = this.state?.seat ?? 0

    // Duels are the unit of play, so the log is grouped by them; without the
    // dividers several duels read as one undifferentiated stream. Consecutive
    // identical lines collapse to a count rather than repeating.
    interface Row { text: string; side: string; count: number }
    const rows: Row[] = []
    let lastDuel = -1
    // What each side currently has on the field, so a cancellation can be
    // narrated ("both Vanguard entries cancel") instead of announced as
    // bookkeeping. Rebuilt on every render because the log is rebuilt too.
    const fielded: Record<number, string | null> = { 0: null, 1: null }
    for (const event of this.events.slice(-90)) {
      if (event.kind === 'field' && typeof event.seat === 'number') {
        const card = event.card as { ability?: string | null } | undefined
        fielded[event.seat] = card?.ability ?? null
      }
      const line = describe(event, seat, fielded)
      if (!line) continue
      const duel = duelOf(event)
      if (duel > 0 && duel !== lastDuel) {
        lastDuel = duel
        rows.push({ text: `Duel ${duel}`, side: 'divider', count: 1 })
      }
      const side = event.seat === undefined || event.seat === null ? 'neutral'
        : event.seat === seat ? 'hi' : 'them'
      const last = rows[rows.length - 1]
      if (last && last.side === side && last.text === line) last.count += 1
      else rows.push({ text: line, side, count: 1 })
    }
    for (const row of rows) {
      if (row.side === 'divider') {
        log.append(el('div', { class: 'ev divider' },
          el('span', { text: row.text })))
        continue
      }
      log.append(el('div', { class: `ev ${row.side}`,
        text: row.count > 1 ? `${row.text} ×${row.count}` : row.text }))
    }

    wrap.append(log)
    // A solid mask over the top of the log hides earlier duels behind what
    // looks exactly like padding — on the result screen, where the log IS the
    // story, that is the whole first half of it presented as a margin. The cue
    // says so, and appears only when there is in fact something above.
    //
    // ...EXCEPT ON A DECISION SCREEN, where the slab is two lines tall. A 20px
    // uppercase label over a 44px port is half the log spent saying that the
    // log is short, and it would push the mask down over the only two rows
    // there is room for. The MASK still runs — it is what keeps the partial
    // row at the top from being sheared through its ascenders — but it no
    // longer has to clear a label, so its clearance goes to zero.
    if (!deciding) {
      wrap.append(el('div', { class: 'log-more', 'aria-hidden': 'true',
                              text: '▲ earlier duels' }))
    }
    // THE MASK ENDS ON A ROW BOUNDARY, and that is the whole fix.
    //
    // Three rounds running, the top line of the log was reported sheared: its
    // ascenders amputated by a hard horizontal edge with the x-height below
    // surviving at about a third alpha. Two rounds of softening the gradient
    // did not touch it, because the gradient was never the problem. The mask
    // is `--panel` over a `--panel` background — it is invisible as a shape,
    // and the ONLY thing it can ever draw is the place where text stops. Put
    // that place inside a glyph and you have drawn a clip; put it in the blank
    // band between two rows and you have drawn nothing at all.
    //
    // So the solid band is measured, not authored: it runs to the top edge of
    // the first row that clears the "earlier duels" cue. Every row above it is
    // then wholly hidden — including the one the scroll port itself clips — and
    // every row below it is wholly shown. A fixed 32px band could not do this
    // because the rows are not a fixed pitch: an event is 21px, a duel divider
    // 24px with its margins, a wrapped line 40px.
    const CUE = deciding ? 0 : 20
    // ...and a DIVIDER needs more than the cue's own height to clear it. A
    // divider is itself a 10px muted uppercase micro-label; at exactly `CUE`
    // its top lands on the cue's own bottom edge — measured 0px apart — so
    // `▲ EARLIER DUELS` and `DUEL 19` stack as what reads like one header
    // printed twice. The divider's own 6px top margin is charged to the cue
    // here, plus a line of air, so the mask either clears the divider properly
    // or hides it and ends on the row below.
    const CUE_DIVIDER = deciding ? 0 : CUE + 14
    const edgeAt = (from: 'top' | 'bot'): number => {
      const rows = Array.from(log.children) as HTMLElement[]
      if (from === 'bot') rows.reverse()
      for (const row of rows) {
        // Row positions in the WRAP's own coordinates: `.log-wrap` is the
        // offset parent, and the log's border box starts at its origin.
        const top = row.offsetTop - log.scrollTop
        const gap = from === 'top' ? top
          : log.offsetHeight - (top + row.offsetHeight)
        // Only the top edge carries the cue; the bottom band has no label to
        // collide with.
        const need = from === 'top' && row.classList.contains('divider')
          ? CUE_DIVIDER : CUE
        if (gap >= need) return gap
      }
      return 32
    }
    const sync = (): void => {
      const above = log.scrollTop > 2
      const below = log.scrollTop + log.clientHeight < log.scrollHeight - 2
      // Set before the class flips, so the band is never painted at a stale
      // height for a frame.
      if (above) wrap.style.setProperty('--mask-top', `${edgeAt('top')}px`)
      if (below) wrap.style.setProperty('--mask-bot', `${edgeAt('bot')}px`)
      wrap.classList.toggle('fade-top', above)
      wrap.classList.toggle('fade-bot', below)
    }
    log.addEventListener('scroll', sync)
    queueMicrotask(() => { log.scrollTop = log.scrollHeight; sync() })
    return wrap
  }
}

/** Narrows away the slots a panel chose not to render. */
function isNode(node: HTMLElement | null): node is HTMLElement {
  return node !== null
}

function who(event: BattleEvent, seat: number): string {
  return event.seat === seat ? 'You' : 'They'
}

/** Possessive form, for log lines about a unit rather than a player. */
function whose(event: BattleEvent, seat: number): string {
  return event.seat === seat ? 'Your' : 'Their'
}

/** Events emitted by the DRAW and SHOP phases, which both run before the
 *  engine increments its duel counter (`_run`). They carry the number of the
 *  duel that just ENDED, so a divider placed by the raw number lands one event
 *  pair too late: `Duel 36` sat over "Their Grunt takes the field" and the
 *  deaths of the units that entered there appeared under `Duel 37`. Same
 *  off-by-one the clash strip already corrects for a pick prompt. */
const OPENS_NEXT_DUEL = new Set(['field', 'cursed', 'buy'])

function duelOf(event: BattleEvent): number {
  return Number(event.duel ?? 0) + (OPENS_NEXT_DUEL.has(event.kind) ? 1 : 0)
}

/** Two offered cards the player cannot tell apart — the pick is a formality. */
function sameUnit(a: CardView, b: CardView): boolean {
  return a.name === b.name && a.power === b.power && a.stamina === b.stamina
    && a.ability === b.ability
}

/* ── duel arithmetic ────────────────────────────────────────────────────────
 *
 * A mirror of `_round_loop` + `_survive_phase` in `engine/battle.py`, close
 * enough that `client/tools/forecast-check.mjs` drives the two against each
 * other case by case and demands the same answer.
 *
 * It replaces the plain "who runs out of stamina first" sum this screen used
 * to print, which was wrong for six of the thirty cards in the starter deck.
 * A Duelist's Resolve turns the very tie the sum calls a trade into a WIN —
 * "both fall" is literally that ability's trigger condition — and a Guardian
 * absorbs the hit the sum calls lethal. The screen was steering the player off
 * the card that wins.
 */

/** One combatant as the round loop sees it: live stats, plus the abilities
 *  that are still unspent and so will still fire. */
export interface Fighter {
  power: number
  stamina: number
  /** Unspent Ambush: strikes first in round 1 and takes no return blow if that
   *  kills. Two ambushes cancel (`_entry_phase`). */
  ambush: boolean
  /** Unspent Guardian: survives ONE lethal hit at 1 stamina, alone or not. */
  guardian: boolean
  /** Unspent Resolve: survives at 1, but only when BOTH would fall. */
  resolve: boolean
}

export type DuelResult = 'win' | 'lose' | 'trade' | 'stalemate'

export interface DuelOutcome {
  result: DuelResult
  /** Yours when the dust settles; 0 if you fell. */
  stamina: number
  /** Stamina you take off them along the way — overkill included, as the
   *  engine counts it. */
  dealt: number
  rounds: number
  /** Which of your abilities kept you standing, if one did. */
  via: 'guardian' | 'resolve' | null
  /** ...and theirs, which is why you did not win. */
  theirVia: 'guardian' | 'resolve' | null
}

/** Only so a pair that cannot hurt each other terminates. The catalogue's
 *  weakest unit hits for 2, so no real duel comes close. */
const MAX_ROUNDS = 64

/**
 * Fight it out. `meFirst` is the seat-resolution order the engine's `_order()`
 * alternates per duel: it is NOT on the wire, and it changes the answer when
 * both units carry a survive ability, so callers run this both ways and stop
 * asserting when the two disagree.
 */
export function resolveDuel(me: Fighter, foe: Fighter,
                            meFirst: boolean): DuelOutcome {
  const sta = [me.stamina, foe.stamina]
  const pow = [me.power, foe.power]
  const guard = [me.guardian, foe.guardian]
  const res = [me.resolve, foe.resolve]
  const via: ('guardian' | 'resolve' | null)[] = [null, null]
  // `_entry_phase` clears BOTH flags when both units ambush, so neither gets
  // the first strike. A one-sided ambush stands.
  const amb = [me.ambush && !foe.ambush, foe.ambush && !me.ambush]
  let dealt = 0

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const before = sta[1]
    if (amb[0]) {
      sta[1] -= pow[0]
      if (sta[1] > 0) sta[0] -= pow[1]
      amb[0] = false
    } else if (amb[1]) {
      sta[0] -= pow[1]
      if (sta[0] > 0) sta[1] -= pow[0]
      amb[1] = false
    } else {
      sta[0] -= pow[1]
      sta[1] -= pow[0]
    }
    dealt += before - sta[1]

    const dead = [sta[0] <= 0, sta[1] <= 0]
    if (dead[0] || dead[1]) {
      // The survive phase, walked in the engine's own order — and the order is
      // load-bearing: Resolve reads the OTHER seat's death flag AS IT STANDS
      // when this seat is checked, so a Guardian checked first can rob a
      // Resolve of its trigger.
      for (const seat of meFirst ? [0, 1] : [1, 0]) {
        if (!dead[seat]) continue
        if (guard[seat]) {
          guard[seat] = false
          sta[seat] = 1
          dead[seat] = false
          via[seat] = 'guardian'
        } else if (dead[1 - seat] && res[seat]) {
          res[seat] = false
          sta[seat] = 1
          dead[seat] = false
          via[seat] = 'resolve'
        }
      }
      if (dead[0] || dead[1]) {
        const result: DuelResult = dead[0] && dead[1] ? 'trade'
          : dead[0] ? 'lose' : 'win'
        return { result, stamina: dead[0] ? 0 : sta[0], dealt, rounds: round,
                 via: via[0], theirVia: via[1] }
      }
    }
    if (pow[0] <= 0 && pow[1] <= 0) break
  }
  return { result: 'stalemate', stamina: Math.max(sta[0], 0), dealt,
           rounds: MAX_ROUNDS, via: via[0], theirVia: via[1] }
}

/** The abilities a card still has to spend. The wire's `spent` flag covers the
 *  card's OWN ability only; one it STOLE arrives with no flag at all, so it is
 *  read as live and reported as a guess. */
function liveAbilities(ability: string | null, spent: boolean,
                       stolen: string | null): string[] {
  const live: string[] = []
  if (ability && !spent) live.push(ability)
  if (stolen) live.push(stolen)
  return live
}

function fighter(power: number, stamina: number, live: string[]): Fighter {
  return {
    power, stamina,
    ambush: live.includes('ambush'),
    guardian: live.includes('guardian'),
    resolve: live.includes('resolve'),
  }
}

/**
 * The ON_ENTRY buff a unit has not collected yet — returned as a CONDITION,
 * never folded into the statline.
 *
 * Vanguard's +2 and Warcry's stacks are not determinate: a mirror entry
 * cancels the whole phase (`mirror_cancel`), and "Both Vanguard entries
 * cancel." is a line the player sees. Printing 8/4 for a unit that may well
 * enter at 6/4 is the same class of lie as the forecast blocker, so the
 * condition is printed as a card line instead. Mirrors the engine's
 * `effective_entry_stats`, which reads the card's own ability only.
 */
export function entryBuff(ability: string | null, spent: boolean,
                          ctx: EntryContext | null): Buff | null {
  if (!ctx || !ability || spent) return null
  if (ability === 'vanguard' && ctx.ownFirst) {
    // "+2 power if first in" named a condition that is ALREADY SATISFIED —
    // this branch only runs when `ownFirst` is true, so the card stated as
    // open the one thing it knew. What is genuinely unresolved is the mirror
    // cancel, and it went unmentioned.
    return { power: 2, stamina: 0,
             note: '+2 power on entry — unless they field one too' }
  }
  if (ability === 'warcry') {
    const stacks = Math.floor(Math.max(ctx.ownDiscards, 0) / 5)
    if (stacks > 0) {
      return { power: stacks, stamina: stacks,
               note: `+${stacks}/+${stacks} on entry` }
    }
  }
  return null
}

/** One alternative history: the same duel under an assumption we cannot check
 *  from here. `label` completes the sentence "<verdict> …". */
interface Alternative { me: Fighter; foe: Fighter; label: string }

/** What the screen is willing to claim about a fight, and how loudly. */
export interface Outlook {
  result: DuelResult
  outcome: DuelOutcome
  /** False when something off the wire — a seat-order race, an ability we can
   *  only guess at — could still overturn it. Then no colour is claimed. */
  certain: boolean
  /** "Wins if its entry lands" — the alternative that broke the certainty. */
  hedge: string | null
  /**
   * Both readings of a duel that the engine's per-duel SEAT ORDER alone
   * decides, `[you-checked-first, them-checked-first]`. Set only when the two
   * disagree — which is exactly when this client cannot know the answer,
   * because `_order()` is not on the wire.
   *
   * It exists so the screen can say so. Reporting the you-first branch as THE
   * verdict and demoting its contradiction to a grey sub-line meant every
   * unknowable race came out in the player's favour, at an irreversible blind
   * commit, beside a card whose "Wins" was genuinely determined.
   */
  race: [DuelOutcome, DuelOutcome] | null
}

function verdictWord(result: DuelResult): string {
  return result === 'win' ? 'Wins' : result === 'lose' ? 'Dies'
    : result === 'trade' ? 'Trades' : 'Stalls'
}

/** One outcome as the tail of "Coin flip · <a>, or <b>". `short` drops the
 *  repeated verb when both branches survive and only the margin differs. */
function phrase(outcome: DuelOutcome, short: boolean): string {
  if (outcome.result === 'win') {
    return short ? `at ${outcome.stamina}` : `survives at ${outcome.stamina}`
  }
  if (outcome.result === 'lose') return 'dies'
  if (outcome.result === 'trade') return 'both fall'
  return 'stalls'
}

/**
 * The sentence a card prints about its own exchange.
 *
 * Exported so `client/tools/forecast-check.mjs` can assert the presentation
 * and not just the arithmetic: the oracle grounds every duel against the
 * engine FOR A KNOWN SEAT ORDER, and the thing that shipped wrong was a case
 * where the seat order itself is unknowable being phrased as a fact.
 */
export function verdictText(view: Outlook): string {
  if (view.race) {
    const [mine, theirs] = view.race
    // "Wins, or dies" is one symmetric claim; a verdict plus a hedge is two,
    // and the eye reads the loud half.
    const bothWin = mine.result === 'win' && theirs.result === 'win'
    return `Coin flip · ${phrase(mine, false)}, or ${phrase(theirs, bothWin)}`
  }
  const o = view.outcome
  if (o.result === 'win') {
    // Naming the ability that carried it is the whole correction: "Resolve
    // holds" says why the arithmetic below the keyword does not apply.
    return o.via ? `${pretty(o.via)} holds · survives at ${o.stamina}`
      : `Wins · survives at ${o.stamina}`
  }
  if (o.result === 'lose') {
    return o.theirVia ? `Dies · their ${pretty(o.theirVia)} holds`
      : `Dies · deals ${o.dealt}`
  }
  if (o.result === 'trade') return 'Trade · both fall'
  return 'Neither can land a blow'
}

/** The card's OWN ability, when the verdict above has already named it — so
 *  the keyword row can stand down rather than print "Resolve" a second time. */
function namedAbility(view: Outlook): string | null {
  if (view.race) return null
  return view.outcome.result === 'win' ? view.outcome.via : null
}

/**
 * Resolve a fight and decide how confident the screen may sound about it.
 *
 * Everything that depends only on YOUR OWN card state is applied and asserted:
 * your Resolve, your Guardian, your Ambush. Everything that does not — which
 * seat the engine checks first, an ability the opponent stole, an entry buff
 * of theirs that has not landed — is run as an alternative history, and if any
 * of them lands somewhere else the verdict drops to neutral weight. Confident
 * colour is reserved for outcomes that are actually determined.
 */
function look(me: Fighter, foe: Fighter, alts: Alternative[]): Outlook {
  const first = resolveDuel(me, foe, true)
  const second = resolveDuel(me, foe, false)
  // The seat order is not on the wire and cannot be inferred, so when it is
  // what decides the duel there is no verdict to report — there are two, and
  // the screen must hand the player both. This used to return `first.result`
  // (the YOU-resolve-first branch) unconditionally, so every coin flip was
  // headlined as the outcome that favours the player and the other half was
  // relegated to 11px grey. `race` is the whole reading; see `verdictText`.
  const race: [DuelOutcome, DuelOutcome] | null =
    first.result !== second.result || first.stamina !== second.stamina
      ? [first, second] : null
  let certain = race === null
  // Left null for a seat-order race: one symmetric line replaces it, and a
  // verdict-plus-hedge is precisely the shape that misled.
  let hedge: string | null = null
  for (const alt of alts) {
    for (const order of [true, false]) {
      const other = resolveDuel(alt.me, alt.foe, order)
      if (other.result === first.result) continue
      if (certain) hedge = `${verdictWord(other.result)} ${alt.label}`
      certain = false
    }
  }
  return { result: first.result, outcome: first, certain, hedge, race }
}

/**
 * What this card would do against the unit facing it.
 *
 * `card` carries `ability` and `spent`; both used to be dropped on the floor
 * here, which is how a Duelist holding an unspent Resolve came to advertise
 * "Trade · both fall" — the exact condition under which Resolve makes it win.
 */
export function outlookFor(card: CardView, enemy: Enemy,
                           buff: Buff | null): Outlook {
  const mine = liveAbilities(card.ability, card.spent, card.stolen)
  const theirs = liveAbilities(enemy.ability, enemy.spent, enemy.stolen)
  const me = fighter(card.power, card.stamina, mine)
  const foe = fighter(enemy.power, enemy.stamina, theirs)

  const alts: Alternative[] = []
  if (buff) {
    alts.push({ me: fighter(card.power + buff.power,
                            card.stamina + buff.stamina, mine),
                foe, label: 'if its entry lands' })
  }
  // A Warden takes the opposing unit's ability on entry, and whichever side
  // resolves first strips the other — so once a Steal is in play with anything
  // to take, the ability picture itself is up for grabs.
  if ((mine.includes('steal') && theirs.length > 0)
      || (theirs.includes('steal') && mine.length > 0)) {
    alts.push({ me: fighter(card.power, card.stamina, []),
                foe: fighter(enemy.power, enemy.stamina, []),
                label: 'if the steal lands' })
  }
  // Their entry has not resolved yet — it can still change their statline, and
  // exactly like yours it is conditional, so it is a question and not a fact.
  const theirBuff = entryBuff(enemy.ability, enemy.spent,
                              { ownFirst: enemy.first,
                                ownDiscards: enemy.discards })
  if (theirBuff) {
    alts.push({ me, foe: fighter(enemy.power + theirBuff.power,
                                 enemy.stamina + theirBuff.stamina, theirs),
                label: 'if their entry lands' })
  }
  // An ability they stole arrives without a spent flag, so "unspent" is a
  // guess; check what happens if it has in fact already fired.
  if (enemy.stolen) {
    alts.push({ me,
                foe: fighter(enemy.power, enemy.stamina,
                             liveAbilities(enemy.ability, enemy.spent, null)),
                label: 'if their stolen ability is spent' })
  }
  return look(me, foe, alts)
}

/** The forecast line, and the ability its wording already spent — the card
 *  uses the second to stop printing that keyword a third time. */
interface Forecast { node: HTMLElement | null; names: string | null }

function forecast(card: CardView, enemy: Enemy | null,
                  buff: Buff | null): Forecast {
  // Nothing to forecast against a concealed unit — and the reason is said once
  // above the grid, not once per card.
  if (!enemy) return { node: null, names: null }
  const view = outlookFor(card, enemy, buff)
  const o = view.outcome
  const tone = !view.certain ? 'even'
    : o.result === 'win' ? 'good' : o.result === 'lose' ? 'bad' : 'even'
  // `even` is also what a DETERMINED trade uses, so neutral weight alone could
  // not tell "an even exchange" from "we do not know" — and the only thing
  // saying which was an 11px grey sub-line. Uncertainty gets a mark of its own.
  const node = el('div',
    { class: `forecast ${tone}${view.certain ? '' : ' unsure'}` },
    verdictText(view),
    view.hedge ? el('span', { class: 'hedge', text: view.hedge }) : null)
  return { node, names: namedAbility(view) }
}

/** Turns an engine event into one line of English. Unknown kinds are dropped
 *  rather than dumped raw — the log is for the player, not for debugging.
 *  `fielded` is each seat's current unit ability, used to narrate a cancel. */
function describe(event: BattleEvent, seat: number,
                  fielded: Record<number, string | null>): string | null {
  const card = event.card as { name?: string } | string | undefined
  const cardName = typeof card === 'string' ? card : card?.name
  const my = whose(event, seat)
  switch (event.kind) {
    case 'battle_start': return 'The banners are raised.'
    case 'field': return `${my} ${cardName} takes the field `
      + `(${event.power}/${event.stamina}).`
    // A mirror match printed "Wraith falls. / Wraith falls." — say whose.
    case 'died': return `${my} ${cardName} falls.`
    case 'survive': return `${my} ${pretty(String(event.via))} holds.`
    case 'revived': return `${my} ${cardName} returns to the deck.`
    case 'gold': return `${who(event, seat)} earn ${event.amount ?? 1} gold.`
    case 'buy': return `${who(event, seat)} buy ${pretty(String(event.item))}.`
    case 'cursed': return `${my} next unit enters wounded.`
    case 'smite': return `${who(event, seat)} soften the enemy by `
      + `${event.amount}.`
    case 'empower': return `${my} unit is empowered to ${event.power} power.`
    case 'withdraw': return `${who(event, seat)} withdraw and field `
      + `${cardName}.`
    case 'heal': return `${my} unit recovers to ${event.stamina}.`
    case 'entry': {
      const fired = (event.fired as string[])
        .map(f => pretty(f.replace(':', ' ')))
      return `${my} ${fired.join(' and ')} `
        + `${fired.length > 1 ? 'fire' : 'fires'}.`
    }
    // Bookkeeping unless it can be named. The engine only fires this when both
    // units share an unspent entry ability, so say WHICH — and if the log
    // window does not reach back to both `field` events, say nothing at all
    // rather than printing a bare rule at the player every single duel.
    case 'mirror_cancel': {
      const mine = fielded[seat]
      const theirs = fielded[1 - seat]
      if (!mine || !theirs || mine !== theirs) return null
      return `Both ${pretty(mine)} entries cancel.`
    }
    case 'martyr': return `${my} martyr empowers the next unit.`
    case 'rallier': return `${my} rally holds.`
    case 'ritual': return `${my} rite is fed.`
    case 'blitz': return `${my} momentum builds.`
    case 'doom': return `Doom gathers on ${my.toLowerCase()} unit.`
    case 'charge': return `${who(event, seat)} earn a charge `
      + `(${pretty(String(event.via))}).`
    default: return null
  }
}

export type { ItemSpec }
