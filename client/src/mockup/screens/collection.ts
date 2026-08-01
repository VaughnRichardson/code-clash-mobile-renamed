import { renderDeckBuilder } from '../../deckbuilder'
import { saveDeck } from '../../deckbuilder'
import type { MockupScreenRenderer } from '../types'

export const collectionScreen: MockupScreenRenderer = {
  render(root, state, actions): void {
    renderDeckBuilder(root, state.catalog, state.deck, (updated) => { saveDeck(updated); actions.updateDeck(updated); actions.go('home') }, () => actions.go('home'))
  },
}
