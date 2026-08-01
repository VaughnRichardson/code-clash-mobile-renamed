import { leaderArt, image } from './art'
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deck))
  } catch {
    /* Private mode: the deck simply will not persist. */
  }
}

/**
 * The deck builder.
 *
 * Deck order is play order, so the list is explicit rather than draggable.
 * Large move controls are slower than freeform drag, but they are predictable
 * under a thumb and accessible to keyboards and assistive technology.
 */
export function renderDeckBuilder(
  root: HTMLElement, catalog: Catalog, deck: DeckPayload,
  onDone: (deck: DeckPayload) => void, onBack: () => void,
): void {
  const counts = (): Map<string, number> => {
    const map = new Map<string, number>()
    for (const name of deck.cards) map.set(name, (map.get(name) ?? 0) + 1)
    return map
  }

  const sectionIntro = (
    step: string, title: string, copy?: string,
  ): HTMLElement => el('div', { class: `section-intro${copy ? '' : ' compact'}` },
    el('span', { class: 'step-number', text: step }),
    el('div', {},
      el('h2', { text: title }),
      copy ? el('p', { class: 'muted', text: copy }) : null))

  const move = (index: number, delta: number): void => {
    const target = index + delta
    if (target < 0 || target >= deck.cards.length) return
    const [card] = deck.cards.splice(index, 1)
    deck.cards.splice(target, 0, card)
    // The boss marks a position, so moving cards around it must carry it.
    if (deck.boss_slot === index) deck.boss_slot = target
    else if (deck.boss_slot === target) deck.boss_slot = index
  }

  const draw = (): void => {
    clear(root)
    root.dataset.screen = 'deck'
    const used = counts()
    const completion = Math.round((deck.cards.length / catalog.deck_size) * 100)

    root.append(el('header', { class: 'deck-heading' },
      el('div', { class: 'row spread deck-topline' },
        button('Back', onBack, { class: 'ghost deck-back' }),
        el('span', { class: 'deck-count',
          text: `${deck.cards.length} / ${catalog.deck_size}` })),
      el('span', { class: 'eyebrow', text: 'Write your opening before the duel' }),
      el('h1', { text: 'Battle deck' }),
      el('p', { class: 'screen-dek',
        text: 'The first card in this list is the first card you draw. Every move matters.' }),
      el('div', {
        class: 'deck-progress', role: 'progressbar',
        'aria-label': 'Deck completion',
        'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': completion,
      }, el('i', { style: `width:${completion}%` }))))

    const leaderPanel = el('section', { class: 'panel leader-panel' },
      sectionIntro('01', 'Choose a leader',
        'Your leader changes the rhythm of every duel.'))
    const leaderGrid = el('div', { class: 'leader-grid' })
    for (const leader of catalog.leaders) {
      const selected = leader.id === deck.leader
      const portrait = leaderArt(leader.id)
      const node = el('button', {
        type: 'button',
        class: `leader-card${selected ? ' selected' : ''}`,
        'aria-pressed': selected,
      },
        el('span', { class: 'leader-portrait' },
          portrait ? image(portrait, 'leader-choice-art', '') : null,
          el('i', { class: 'leader-check', 'aria-hidden': 'true' })),
        el('span', { class: 'leader-choice-copy' },
          el('span', { class: 'leader-choice-head' },
            el('strong', { text: leader.name }),
            el('span', { class: 'leader-genre', text: leader.genre })),
          el('span', { class: 'leader-choice-blurb', text: leader.blurb }),
          el('span', { class: 'leader-tags' },
            ...leader.tags.map(tag =>
              el('span', { class: 'chip', text: tag })))))
      node.setAttribute('data-leader', leader.id)
      node.addEventListener('click', () => {
        deck.leader = leader.id
        draw()
      })
      leaderGrid.append(node)
    }
    leaderPanel.append(leaderGrid)
    root.append(leaderPanel)

    const deckPanel = el('section', { class: 'panel order-panel' },
      sectionIntro('02', 'Set the battle order',
        'Cards play from top to bottom. Abilities stay visible so you can build a sequence, not a guess.'))
    const list = el('div', { class: 'deck-list' })
    deck.cards.forEach((name, index) => {
      const spec = catalog.cards.find(c => c.name === name)
      const isBoss = deck.boss_slot === index
      const actions = el('span', { class: 'deck-row-actions' },
        button('↑', () => {
          move(index, -1)
          draw()
        }, {
          class: 'reorder-button ghost',
          disabled: index === 0,
          'aria-label': `Move ${name} earlier`,
          'data-move': 'up',
        }),
        button('↓', () => {
          move(index, 1)
          draw()
        }, {
          class: 'reorder-button ghost',
          disabled: index === deck.cards.length - 1,
          'aria-label': `Move ${name} later`,
          'data-move': 'down',
        }),
        button('×', () => {
          deck.cards.splice(index, 1)
          if (deck.boss_slot !== null && deck.boss_slot >= deck.cards.length) {
            deck.boss_slot = null
          }
          draw()
        }, {
          class: 'remove-card ghost',
          'aria-label': `Remove ${name}`,
          'data-remove': 'true',
        }))
      const row = el('div', { class: `deck-row${isBoss ? ' boss' : ''}` },
        el('span', { class: 'idx', text: String(index + 1).padStart(2, '0') }),
        el('span', { class: 'deck-card-copy' },
          el('span', { class: 'deck-card-head' },
            el('strong', { text: isBoss ? catalog.boss.name : name }),
            el('span', {
              class: 'deck-card-stats',
              text: isBoss
                ? `${catalog.boss.power} / ${catalog.boss.stamina}`
                : `${spec?.power ?? '?'} / ${spec?.stamina ?? '?'}`,
            })),
          el('span', {
            class: 'deck-card-ability',
            text: isBoss
              ? `Boss · replaces ${name}`
              : spec?.ability ? pretty(spec.ability) : 'Steady · no ability',
          })),
        actions)
      row.setAttribute('data-deck-index', String(index))
      list.append(row)
    })
    deckPanel.append(list)
    root.append(deckPanel)

    const bossPanel = el('section', { class: 'panel boss-panel' },
      sectionIntro('03', 'Place the boss'),
      el('p', { class: 'muted',
        text: `${catalog.boss.name} ${catalog.boss.power}/${catalog.boss.stamina} `
            + `takes over a deck slot rather than adding one. It must sit in the `
            + `first ${catalog.boss_max_slot} positions so it arrives before the `
            + `battle is usually decided.` }))
    const bossSelect = el('select', { id: 'boss-slot' })
    bossSelect.append(el('option', { value: 'none', text: 'No boss' }))
    for (let i = 0; i < Math.min(catalog.boss_max_slot, deck.cards.length); i++) {
      bossSelect.append(el('option', {
        value: String(i),
        text: `Position ${i + 1} · replaces ${deck.cards[i]}`,
        selected: deck.boss_slot === i,
      }))
    }
    bossSelect.addEventListener('change', () => {
      deck.boss_slot = bossSelect.value === 'none'
        ? null : Number(bossSelect.value)
      draw()
    })
    bossPanel.append(bossSelect)
    root.append(bossPanel)

    const poolPanel = el('section', { class: 'panel pool-panel' },
      sectionIntro('04', 'Card pool', 'Add replacements from the reserve.'))
    for (const spec of catalog.cards) {
      const have = used.get(spec.name) ?? 0
      const full = have >= spec.deck_limit
      const row = el('div', { class: 'pool-row' },
        el('div', { class: 'pool-card-copy' },
          el('div', { class: 'name',
            text: `${spec.name}  ${spec.power}/${spec.stamina}` }),
          el('div', { class: 'ability',
            text: spec.ability ? pretty(spec.ability) : 'No ability' })),
        el('span', { class: 'chip', text: `${have}/${spec.deck_limit}` }),
        button('+', () => {
          if (deck.cards.length >= catalog.deck_size || full) return
          deck.cards.push(spec.name)
          draw()
        }, {
          class: 'pool-add primary',
          'aria-label': `Add ${spec.name}`,
          disabled: full || deck.cards.length >= catalog.deck_size,
        }))
      row.setAttribute('data-pool', spec.name)
      poolPanel.append(row)
    }
    root.append(poolPanel)

    const short = deck.cards.length !== catalog.deck_size
    const actions = el('div', { class: 'sticky-actions deck-actions' })
    if (short) {
      actions.append(el('div', { class: 'error',
        text: `A deck is exactly ${catalog.deck_size} cards. You have `
            + `${deck.cards.length}.` }))
    }
    actions.append(button(short ? 'Deck incomplete' : 'Use this deck', () => {
      saveDeck(deck)
      onDone(deck)
    }, { class: 'primary wide', disabled: short, id: 'deck-done' }))
    root.append(actions)
  }

  draw()
}
