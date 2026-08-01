import { image } from '../../art'
import { button, el } from '../../ui'
import type { MockupActions, MockupScreenRenderer } from '../types'

export const homeScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state, actions: MockupActions): void {
    root.append(el('header', { class: 'mockup-brand' }, el('span', { class: 'mockup-brand-mark' }), el('h1', { text: 'Card Clash' })))
    const tiles = el('main', { class: 'mockup-home-grid' })
    const tile = (screen: 'campaign' | 'collection' | 'compete', title: string, art: string, copy: string): HTMLElement => {
      const node = button(title, () => screen === 'collection' ? actions.openCollection('home') : actions.go(screen), { class: `mockup-home-tile mockup-tile-${screen}` })
      node.replaceChildren(image(art, 'mockup-tile-art', ''), el('span', { class: 'mockup-tile-shade' }), el('strong', { text: title }), el('small', { text: copy }))
      return node
    }
    tiles.append(tile('campaign', 'Campaign', '/art/scenes/result.jpg', 'Play the house'), tile('collection', 'Collection', '/art/cards/guardian.png', `${state.deck.cards.length} cards ready`), tile('compete', 'Compete', '/art/scenes/table.jpg', 'Find a rival'))
    root.append(tiles, button('Collection', () => actions.openCollection('home'), { class: 'mockup-profile', 'aria-label': 'Open collection' }))
  },
}
