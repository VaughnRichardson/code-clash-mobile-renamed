import { cardArt, image, leaderArt } from './art'
import { button, clear, el, pretty } from './ui'
import type { Catalog, DeckPayload } from './types'

const STORAGE_KEY = 'cardclash.deck.v1'

export function loadSavedDeck(catalog: Catalog): DeckPayload {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as DeckPayload
  } catch {
    /* Corrupt storage falls back to the starter deck. */
  }
  return structuredClone(catalog.starter_deck)
}

export function saveDeck(deck: DeckPayload): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(deck)) } catch { /* private mode */ }
}

export function renderDeckBuilder(
  root: HTMLElement, catalog: Catalog, initial: DeckPayload,
  onDone: (deck: DeckPayload) => void, onBack: () => void,
  onChange?: (deck: DeckPayload) => void,
): void {
  let deck = structuredClone(initial)
  let validationError = ''

  const counts = (): Map<string, number> => {
    const result = new Map<string, number>()
    for (const name of deck.cards) result.set(name, (result.get(name) ?? 0) + 1)
    return result
  }

  const removeCard = (name: string): void => {
    const index = deck.cards.lastIndexOf(name)
    if (index < 0) return
    deck.cards.splice(index, 1)
    if (deck.boss_slot !== null && deck.boss_slot >= deck.cards.length) deck.boss_slot = null
  }

  const finish = (): void => {
    if (deck.cards.length !== catalog.deck_size) {
      validationError = `A battle deck needs exactly ${catalog.deck_size} cards.`
      draw()
      return
    }
    deck.name = deck.name.trim() || 'Ashen Rush'
    saveDeck(deck)
    onChange?.(structuredClone(deck))
    onDone(structuredClone(deck))
  }

  const draw = (): void => {
    clear(root)
    root.dataset.screen = 'deck'
    const used = counts()
    const leader = catalog.leaders.find(item => item.id === deck.leader)
    const cardSpecs = deck.cards.map(name => catalog.cards.find(card => card.name === name)).filter(Boolean)
    const power = cardSpecs.reduce((sum, card) => sum + (card?.power ?? 0), 0)
    const stamina = cardSpecs.reduce((sum, card) => sum + (card?.stamina ?? 0), 0)
    const total = Math.max(1, power + stamina)
    const powerShare = Math.round((power / total) * 1000) / 10

    root.append(el('div', { class: 'deck-creator-topbar' },
      button('‹', onBack, { class: 'deck-creator-back', 'aria-label': 'Back' }),
      el('span', { class: 'deck-creator-name', text: deck.name }),
      el('span', { class: 'deck-creator-count', text: `${deck.cards.length}/${catalog.deck_size}` })))

    root.append(el('div', { class: 'deck-creator-tug' },
      el('span', { class: 'deck-creator-chip power', text: String(power) }),
      el('div', { class: 'deck-creator-track' },
        el('i', { class: 'deck-creator-fill power', style: `width:${powerShare}%` }),
        el('i', { class: 'deck-creator-fill stamina', style: `width:${100 - powerShare}%` }),
        el('span', { class: 'deck-creator-marker', style: `left:${powerShare}%` })),
      el('span', { class: 'deck-creator-chip stamina', text: String(stamina) })))

    const peek = el('div', { class: 'deck-creator-peek', 'aria-hidden': 'true' })
    for (const name of deck.cards.slice(0, 3)) {
      const art = cardArt(name)
      peek.append(el('div', { class: 'deck-creator-peek-card' }, art ? image(art, '', '') : null))
    }
    root.append(peek, el('div', { class: 'deck-creator-scrim' }))

    const sheet = el('section', { class: 'deck-creator-sheet' }, el('span', { class: 'deck-creator-grabber' }))
    const nameInput = el('input', { class: 'deck-creator-name-input', value: deck.name, 'aria-label': 'Deck name' })
    nameInput.addEventListener('input', () => { deck.name = nameInput.value })
    sheet.append(el('div', { class: 'deck-creator-sheet-header' }, el('div', { class: 'deck-creator-identity' },
      nameInput,
      el('span', { class: 'deck-creator-icon', text: '▾', 'aria-hidden': 'true' }),
      button('⧉', () => { deck = structuredClone(deck); deck.name = `${deck.name} copy`; draw() }, { class: 'deck-creator-icon', 'aria-label': 'Duplicate deck' }),
      button('✓', finish, { class: 'deck-creator-icon save', 'aria-label': 'Save deck' }))))
    if (validationError) sheet.append(el('div', { class: 'error', text: validationError }))

    const scroll = el('div', { class: 'deck-creator-scroll' }, el('p', { class: 'deck-creator-label', text: 'Leader' }))
    const leaders = el('div', { class: 'deck-creator-leaders' })
    for (const choice of catalog.leaders) {
      const selected = choice.id === deck.leader
      const art = leaderArt(choice.id)
      const node = button(choice.name, () => { deck.leader = choice.id; draw() }, {
        class: `deck-creator-leader${selected ? ' selected' : ''}`,
        'aria-pressed': selected,
        'data-leader': choice.id,
      })
      node.replaceChildren(el('span', { class: 'deck-creator-leader-port' }, art ? image(art, '', choice.name) : null), el('span', { text: choice.name }))
      leaders.append(node)
    }
    scroll.append(leaders, el('p', { class: 'deck-creator-leader-blurb' },
      el('strong', { text: leader ? `${leader.name} · ${leader.genre}` : 'Choose a leader' }),
      document.createTextNode(leader ? ` — ${leader.blurb}` : '')),
    el('p', { class: 'deck-creator-label', text: 'Card pool' }))

    const pool = el('div', { class: 'deck-creator-pool' })
    for (const spec of catalog.cards) {
      const count = used.get(spec.name) ?? 0
      const full = count >= spec.deck_limit
      const art = cardArt(spec.name)
      const tile = el('article', { class: `deck-creator-card${full ? ' full' : ''}` }, art ? image(art, '', spec.name) : null,
        el('span', { class: 'deck-creator-badge', text: `${count}/${spec.deck_limit}` }),
        el('div', { class: 'deck-creator-card-band' }, el('strong', { text: spec.name }), el('small', { text: `${spec.power}·${spec.stamina} · ${spec.ability ? pretty(spec.ability) : 'Steady'}` })))
      if (count > 0) tile.append(button('−', () => { removeCard(spec.name); draw() }, { class: 'deck-creator-minus', 'aria-label': `Remove ${spec.name}` }))
      if (!full && deck.cards.length < catalog.deck_size) tile.append(button('+', () => { deck.cards.push(spec.name); draw() }, { class: 'deck-creator-plus', 'aria-label': `Add ${spec.name}` }))
      pool.append(tile)
    }
    scroll.append(pool)
    sheet.append(scroll)
    root.append(sheet)
  }

  draw()
}
