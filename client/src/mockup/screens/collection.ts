import { cardArt, image, leaderArt } from '../../art'
import { saveDeck } from '../../deckbuilder'
import { button, el, pretty } from '../../ui'
import type { CardSpec } from '../../types'
import type { MockupScreenRenderer } from '../types'

const leaderIds = ['second_wind', 'blitz', 'momentum', 'oracle', 'sentinel']

function cardCount(deck: string[], name: string): number {
  return deck.filter((card) => card === name).length
}

function cardTile(card: CardSpec, deck: string[], deckSize: number, onAdd: () => void, onRemove: () => void): HTMLElement {
  const count = cardCount(deck, card.name)
  const tile = el('article', { class: 'mockup-card-tile' })
  const art = cardArt(card.name)
  if (art) tile.append(image(art, 'mockup-card-art', card.name))
  tile.append(el('span', { class: `mockup-card-count${count >= card.deck_limit ? ' full' : ''}`, text: `${count}/${card.deck_limit}` }))
  const controls = el('div', { class: 'mockup-card-controls' }, el('strong', { text: card.name }), el('small', { text: `${card.power} / ${card.stamina}` }))
  const remove = button('-', onRemove, { class: 'mockup-card-minus', 'aria-label': `Remove ${card.name}` })
  const add = button('+', onAdd, { class: 'mockup-card-plus', 'aria-label': `Add ${card.name}` })
  remove.disabled = count === 0
  add.disabled = count >= card.deck_limit || deck.length >= deckSize
  controls.append(remove, add)
  tile.append(controls)
  return tile
}

export const collectionScreen: MockupScreenRenderer = {
  render(root, state, actions): void {
    root.append(el('header', { class: 'mockup-collection-top' }, button('Back', () => actions.go(state.collectionReturn), { class: 'mockup-back' }), el('strong', { text: 'Ashen Rush' }), el('span', { class: 'mockup-deck-count', text: `${state.deck.cards.length}/30` })))
    root.append(el('section', { class: 'mockup-collection-score' }, el('strong', { text: '+ 187' }), el('i', {}), el('strong', { text: '214 v' })))
    const sheet = el('section', { class: 'mockup-collection-sheet' })
    const saveAndReturn = (): void => { saveDeck(state.deck); actions.updateDeck(state.deck); actions.go(state.collectionReturn) }
    const sheetHead = el('div', { class: 'mockup-sheet-head' })
    const deckName = el('input', { class: 'mockup-deck-name', value: state.deck.name, 'aria-label': 'Deck name' })
    deckName.addEventListener('change', () => { state.deck.name = deckName.value.trim() || 'Ashen Rush' })
    sheetHead.append(deckName, button('Close', () => actions.go(state.collectionReturn), { class: 'mockup-icon-button', 'aria-label': 'Close deck builder' }), button('Copy', () => { state.deck.name = `${state.deck.name} copy`; actions.go('collection') }, { class: 'mockup-icon-button', 'aria-label': 'Duplicate deck' }), button('Save', saveAndReturn, { class: 'mockup-save-button', 'aria-label': 'Save deck' }))
    sheet.append(sheetHead, el('span', { class: 'mockup-eyebrow', text: 'Leader' }))
    const leaders = el('div', { class: 'mockup-leader-row' })
    for (const id of leaderIds) {
      const leader = state.catalog.leaders.find((item) => item.id === id)
      if (!leader) continue
      const node = button(pretty(leader.id), () => { state.deck.leader = leader.id; actions.go('collection') }, { class: `mockup-leader-choice${state.deck.leader === id ? ' selected' : ''}` })
      const art = leaderArt(id)
      if (art) node.prepend(image(art, 'mockup-leader-art', leader.name))
      node.append(el('small', { text: leader.name }))
      leaders.append(node)
    }
    sheet.append(leaders)
    const activeLeader = state.catalog.leaders.find((leader) => leader.id === state.deck.leader)
    sheet.append(el('p', { class: 'mockup-leader-blurb', text: activeLeader ? `${activeLeader.name} / ${activeLeader.genre} - ${activeLeader.blurb}` : '' }), el('span', { class: 'mockup-eyebrow', text: 'Card pool' }))
    const pool = el('div', { class: 'mockup-card-grid' })
    for (const card of state.catalog.cards) {
      pool.append(cardTile(card, state.deck.cards, state.catalog.deck_size, () => {
        if (state.deck.cards.length < state.catalog.deck_size && cardCount(state.deck.cards, card.name) < card.deck_limit) { state.deck.cards.push(card.name); actions.go('collection') }
      }, () => {
        const index = state.deck.cards.lastIndexOf(card.name)
        if (index >= 0) { state.deck.cards.splice(index, 1); actions.go('collection') }
      }))
    }
    sheet.append(pool)
    sheet.append(el('div', { class: 'mockup-deck-tray' }, el('span', { class: 'mockup-tray-leader' }, activeLeader?.name ?? 'Leader'), el('span', { text: `${state.deck.cards.length} cards` }), button('Save deck', saveAndReturn, { class: 'mockup-tray-save' })))
    root.append(sheet)
  },
}
