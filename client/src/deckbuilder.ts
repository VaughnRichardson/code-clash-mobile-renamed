import { cardArt, image, leaderArt } from './art'
import { button, clear, el, pretty } from './ui'
import type { Catalog, DeckPayload } from './types'

const STORAGE_KEY = 'cardclash.deck.v1'
const LIBRARY_KEY = 'cardclash.decks.v1'

interface StoredDeck {
  id: string
  deck: DeckPayload
}

interface DeckLibrary {
  version: 1
  selected: string
  decks: StoredDeck[]
}

function makeDeckId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `deck-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function readLibrary(): DeckLibrary | null {
  try {
    const raw = localStorage.getItem(LIBRARY_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<DeckLibrary>
    if (value.version !== 1 || typeof value.selected !== 'string'
        || !Array.isArray(value.decks) || value.decks.length === 0) return null
    const decks = value.decks.filter((entry): entry is StoredDeck => Boolean(
      entry && typeof entry.id === 'string' && entry.deck
      && typeof entry.deck.name === 'string' && Array.isArray(entry.deck.cards)))
    if (decks.length === 0) return null
    const selected = decks.some(entry => entry.id === value.selected)
      ? value.selected : decks[0].id
    return { version: 1, selected, decks }
  } catch {
    return null
  }
}

function writeLibrary(library: DeckLibrary): void {
  try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(library)) } catch { /* private mode */ }
}

function writeLegacyDeck(deck: DeckPayload): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(deck)) } catch { /* private mode */ }
}

export function loadSavedDeck(catalog: Catalog): DeckPayload {
  const library = readLibrary()
  const selected = library?.decks.find(entry => entry.id === library.selected)
  if (selected) return structuredClone(selected.deck)
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as DeckPayload
  } catch {
    /* Corrupt storage falls back to the starter deck. */
  }
  return structuredClone(catalog.starter_deck)
}

export function saveDeck(deck: DeckPayload): void {
  writeLegacyDeck(deck)
  const library = readLibrary()
  if (!library) {
    const id = makeDeckId()
    writeLibrary({ version: 1, selected: id, decks: [{ id, deck: structuredClone(deck) }] })
    return
  }
  const selected = library.decks.find(entry => entry.id === library.selected)
  if (selected) selected.deck = structuredClone(deck)
  else {
    const id = makeDeckId()
    library.selected = id
    library.decks.push({ id, deck: structuredClone(deck) })
  }
  writeLibrary(library)
}

function uniqueName(base: string, library: DeckLibrary): string {
  const names = new Set(library.decks.map(entry => entry.deck.name.trim().toLowerCase()))
  if (!names.has(base.trim().toLowerCase())) return base
  let suffix = 2
  while (names.has(`${base} ${suffix}`.toLowerCase())) suffix += 1
  return `${base} ${suffix}`
}

export function renderDeckBuilder(
  root: HTMLElement, catalog: Catalog, initial: DeckPayload,
  onDone: (deck: DeckPayload) => void, onBack: () => void,
  onChange?: (deck: DeckPayload) => void,
): void {
  let library = readLibrary()
  if (!library) {
    const id = makeDeckId()
    library = { version: 1, selected: id, decks: [{ id, deck: structuredClone(initial) }] }
  }
  let selectedId = library.selected
  let selectedRecord = library.decks.find(entry => entry.id === selectedId)
  if (!selectedRecord) {
    selectedId = makeDeckId()
    selectedRecord = { id: selectedId, deck: structuredClone(initial) }
    library.decks.push(selectedRecord)
    library.selected = selectedId
  }
  let deck = structuredClone(initial)
  selectedRecord.deck = structuredClone(initial)
  let validationError = ''
  // The ordering view is the primary deck-building surface. The card pool is a
  // real expandable sheet over it, rather than a second screen or a static peek.
  let sheetOpen = false
  let deckMenuOpen = false
  let orderScrollTop = 0
  let draggingIndex: number | null = null
  let pointerDragIndex: number | null = null
  let pointerDragId: number | null = null
  let pointerDropIndex: number | null = null

  const counts = (): Map<string, number> => {
    const result = new Map<string, number>()
    for (const name of deck.cards) result.set(name, (result.get(name) ?? 0) + 1)
    return result
  }

  const syncDraft = (): void => {
    const record = library.decks.find(entry => entry.id === selectedId)
    if (record) record.deck = structuredClone(deck)
    else library.decks.push({ id: selectedId, deck: structuredClone(deck) })
    library.selected = selectedId
  }

  const removeCard = (name: string): void => {
    const index = deck.cards.lastIndexOf(name)
    if (index < 0) return
    deck.cards.splice(index, 1)
    if (deck.boss_slot !== null && deck.boss_slot >= deck.cards.length) deck.boss_slot = null
    validationError = ''
  }

  const moveCard = (from: number, to: number): void => {
    const target = Math.max(0, Math.min(deck.cards.length - 1, to))
    if (from === target || from < 0 || from >= deck.cards.length) return
    const boss = deck.boss_slot
    const [card] = deck.cards.splice(from, 1)
    deck.cards.splice(target, 0, card)
    if (boss === from) deck.boss_slot = target
    else if (boss !== null && from < boss && target >= boss) deck.boss_slot = boss - 1
    else if (boss !== null && from > boss && target <= boss) deck.boss_slot = boss + 1
  }

  const finish = (): void => {
    if (deck.cards.length !== catalog.deck_size) {
      validationError = `A battle deck needs exactly ${catalog.deck_size} cards.`
      sheetOpen = true
      deckMenuOpen = false
      draw()
      return
    }
    deck.name = deck.name.trim() || 'Ashen Rush'
    syncDraft()
    writeLibrary(library)
    saveDeck(deck)
    onChange?.(structuredClone(deck))
    onDone(structuredClone(deck))
  }

  const chooseDeck = (id: string): void => {
    const next = library.decks.find(entry => entry.id === id)
    if (!next) return
    syncDraft()
    selectedId = id
    library.selected = id
    deck = structuredClone(next.deck)
    validationError = ''
    deckMenuOpen = false
    sheetOpen = false
    draw()
  }

  const duplicateDeck = (): void => {
    syncDraft()
    const copy = structuredClone(deck)
    copy.name = uniqueName(`${deck.name.trim() || 'Deck'} copy`, library)
    selectedId = makeDeckId()
    library.selected = selectedId
    library.decks.push({ id: selectedId, deck: copy })
    deck = structuredClone(copy)
    deckMenuOpen = false
    writeLibrary(library)
    draw()
  }

  const newStarterDeck = (): void => {
    syncDraft()
    const fresh = structuredClone(catalog.starter_deck)
    fresh.name = uniqueName(fresh.name || 'Starter', library)
    selectedId = makeDeckId()
    library.selected = selectedId
    library.decks.push({ id: selectedId, deck: fresh })
    deck = structuredClone(fresh)
    deckMenuOpen = false
    writeLibrary(library)
    draw()
  }

  const draw = (): void => {
    const oldOrderList = root.querySelector<HTMLElement>('.deck-creator-order-list')
    if (oldOrderList) orderScrollTop = oldOrderList.scrollTop
    clear(root)
    root.dataset.screen = 'deck'
    root.dataset.deckSheet = sheetOpen ? 'open' : 'collapsed'
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

    const orderPanel = el('section', {
      class: 'deck-creator-order-panel', 'aria-label': 'Deck order',
      'aria-hidden': sheetOpen,
    }, el('div', { class: 'deck-creator-order-heading' },
      el('div', {}, el('strong', { text: 'Deck order' }),
        el('small', { text: 'Drag cards to set draw order.' })),
      el('span', { text: `${deck.cards.length} cards` })))
    const orderList = el('div', { class: 'deck-creator-order-list' })
    deck.cards.forEach((name, index) => {
      const spec = catalog.cards.find(card => card.name === name)
      const art = cardArt(name)
      const row = el('article', {
        class: 'deck-creator-order-card',
        'data-deck-order-index': index,
      },
      el('span', { class: 'deck-creator-order-art' }, art ? image(art, '', '') : null),
      el('span', { class: 'deck-creator-order-number', text: String(index + 1).padStart(2, '0') }),
      el('span', { class: 'deck-creator-order-copy' },
        el('strong', { text: name }),
        el('small', { text: `${spec?.power ?? '?'}·${spec?.stamina ?? '?'} · ${spec?.ability ? pretty(spec.ability) : 'Steady'}` })),
      el('span', {
        class: 'deck-creator-order-grip', text: '⋮⋮', role: 'button', tabindex: 0, draggable: true,
        'aria-label': `Drag ${name} to change its draw position. Use arrow keys to move it.`,
      }))
      row.addEventListener('dragstart', event => {
        draggingIndex = index
        row.classList.add('dragging')
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(index))
        }
      })
      row.addEventListener('dragover', event => {
        event.preventDefault()
        row.classList.add('drag-over')
      })
      row.addEventListener('dragleave', () => row.classList.remove('drag-over'))
      row.addEventListener('drop', event => {
        event.preventDefault()
        const from = draggingIndex ?? Number(event.dataTransfer?.getData('text/plain'))
        draggingIndex = null
        moveCard(from, index)
        draw()
      })
      row.addEventListener('dragend', () => {
        draggingIndex = null
        row.classList.remove('dragging')
      })

      const grip = row.querySelector<HTMLElement>('.deck-creator-order-grip')
      grip?.addEventListener('keydown', event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
        event.preventDefault()
        moveCard(index, index + (event.key === 'ArrowUp' ? -1 : 1))
        draw()
      })
      const clearPointerDrag = (): void => {
        pointerDragIndex = null
        pointerDragId = null
        pointerDropIndex = null
        for (const card of orderList.querySelectorAll<HTMLElement>('.deck-creator-order-card')) {
          card.classList.remove('dragging', 'drag-over')
        }
      }
      grip?.addEventListener('pointerdown', event => {
        // Desktop uses native HTML drag-and-drop; touch and pen use this
        // pointer path because HTML drag events are not dependable on phones.
        if (event.pointerType === 'mouse') return
        pointerDragIndex = index
        pointerDragId = event.pointerId
        pointerDropIndex = null
        row.classList.add('dragging')
        grip.setPointerCapture?.(event.pointerId)
        event.preventDefault()
      })
      grip?.addEventListener('pointermove', event => {
        if (pointerDragIndex === null || pointerDragId !== event.pointerId) return
        event.preventDefault()
        const target = document.elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('.deck-creator-order-card[data-deck-order-index]')
        for (const card of orderList.querySelectorAll<HTMLElement>('.deck-creator-order-card')) {
          card.classList.remove('drag-over')
        }
        const targetIndex = Number(target?.dataset.deckOrderIndex)
        if (target && Number.isInteger(targetIndex) && targetIndex !== pointerDragIndex) {
          pointerDropIndex = targetIndex
          target.classList.add('drag-over')
        } else pointerDropIndex = null
      })
      const completePointerDrag = (event: PointerEvent): void => {
        if (pointerDragIndex === null || pointerDragId !== event.pointerId) return
        event.preventDefault()
        const from = pointerDragIndex
        const target = document.elementFromPoint(event.clientX, event.clientY)
          ?.closest<HTMLElement>('.deck-creator-order-card[data-deck-order-index]')
        const targetIndex = Number(target?.dataset.deckOrderIndex)
        const to = Number.isInteger(targetIndex) ? targetIndex : pointerDropIndex
        clearPointerDrag()
        if (to !== null && to !== from) {
          moveCard(from, to)
          draw()
        }
      }
      grip?.addEventListener('pointerup', completePointerDrag)
      grip?.addEventListener('pointercancel', event => {
        if (pointerDragId === event.pointerId) clearPointerDrag()
      })
      orderList.append(row)
    })
    orderPanel.append(orderList)

    root.append(orderPanel)

    const sheet = el('section', {
      class: `deck-creator-sheet${sheetOpen ? '' : ' collapsed'}`,
    })
    sheet.append(button('', () => {
      sheetOpen = !sheetOpen
      deckMenuOpen = false
      draw()
    }, {
      class: 'deck-creator-grabber',
      'aria-label': sheetOpen ? 'Collapse card pool and edit deck order' : 'Open card pool',
      'aria-expanded': sheetOpen,
    }))

    const nameInput = el('input', {
      class: 'deck-creator-name-input', value: deck.name, 'aria-label': 'Deck name',
    })
    nameInput.addEventListener('input', () => { deck.name = nameInput.value })
    const menuButton = button('▾', () => {
      sheetOpen = true
      deckMenuOpen = !deckMenuOpen
      draw()
    }, {
      class: 'deck-creator-icon deck-creator-choose',
      'aria-label': 'Choose a deck', 'aria-expanded': deckMenuOpen,
    })
    const sheetHeader = el('div', { class: 'deck-creator-sheet-header' },
      el('div', { class: 'deck-creator-identity' },
        nameInput,
        menuButton,
        button('⧉', duplicateDeck, {
          class: 'deck-creator-icon', 'aria-label': 'Duplicate deck',
        }),
        button('✓ Use', finish, {
          class: 'deck-creator-icon save',
          'aria-label': 'Use this deck and return', title: 'Use this deck and return',
        })))

    if (deckMenuOpen) {
      const menu = el('div', { class: 'deck-creator-menu', role: 'menu' })
      for (const entry of library.decks) {
        const menuLeader = catalog.leaders.find(item => item.id === entry.deck.leader)
        const menuItem = button('', () => chooseDeck(entry.id), {
          class: `deck-creator-menu-item${entry.id === selectedId ? ' selected' : ''}`,
          role: 'menuitem', 'aria-label': `Choose ${entry.deck.name}`,
        })
        menuItem.append(el('strong', { text: entry.deck.name }), el('small', {
          text: `${entry.deck.cards.length}/${catalog.deck_size} · ${menuLeader?.name ?? pretty(entry.deck.leader)}`,
        }))
        menu.append(menuItem)
      }
      menu.append(button('+ New starter deck', newStarterDeck, {
        class: 'deck-creator-menu-new', role: 'menuitem',
      }))
      sheetHeader.append(menu)
    }
    sheet.append(sheetHeader)
    if (validationError) sheet.append(el('div', { class: 'error deck-creator-error', text: validationError }))

    const scroll = el('div', { class: 'deck-creator-scroll' },
      el('p', { class: 'deck-creator-label', text: 'Leader' }))
    const leaders = el('div', { class: 'deck-creator-leaders' })
    for (const choice of catalog.leaders) {
      const selected = choice.id === deck.leader
      const art = leaderArt(choice.id)
      const node = button(choice.name, () => {
        deck.leader = choice.id
        validationError = ''
        draw()
      }, {
        class: `deck-creator-leader${selected ? ' selected' : ''}`,
        'aria-pressed': selected,
        'data-leader': choice.id,
      })
      node.replaceChildren(
        el('span', { class: 'deck-creator-leader-port' }, art ? image(art, '', choice.name) : null),
        el('span', { text: choice.name }))
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
      const tile = el('article', {
        class: `deck-creator-card${full ? ' full' : ''}`,
      }, art ? image(art, '', spec.name) : null,
      el('span', { class: 'deck-creator-badge', text: `${count}/${spec.deck_limit}` }),
      el('div', { class: 'deck-creator-card-band' },
        el('strong', { text: spec.name }),
        el('small', {
          text: `${spec.power}·${spec.stamina} · ${spec.ability ? pretty(spec.ability) : 'Steady'}`,
        })))
      if (count > 0) tile.append(button('−', () => {
        removeCard(spec.name)
        draw()
      }, { class: 'deck-creator-minus', 'aria-label': `Remove ${spec.name}` }))
      if (!full && deck.cards.length < catalog.deck_size) tile.append(button('+', () => {
        deck.cards.push(spec.name)
        validationError = ''
        draw()
      }, { class: 'deck-creator-plus', 'aria-label': `Add ${spec.name}` }))
      pool.append(tile)
    }
    scroll.append(pool)
    sheet.append(scroll)
    root.append(sheet)

    requestAnimationFrame(() => { orderList.scrollTop = orderScrollTop })
  }

  draw()
}
