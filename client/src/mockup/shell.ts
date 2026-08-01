import { clear } from '../ui'
import type { DeckPayload } from '../types'
import { createMockupState } from './state'
import type { MockupActions, MockupScreen, MockupScreenRenderer, MockupState } from './types'

export class MockupShell {
  private readonly state: MockupState
  private readonly renderers: Partial<Record<MockupScreen, MockupScreenRenderer>>

  constructor(private readonly root: HTMLElement, catalog: MockupState['catalog'], deck: DeckPayload,
              renderers: Partial<Record<MockupScreen, MockupScreenRenderer>>) {
    this.state = createMockupState(catalog, deck)
    this.renderers = renderers
  }

  mount(): void { this.render() }

  private actions(): MockupActions {
    return {
      go: (screen) => { this.state.screen = screen; this.render() },
      updateDeck: (deck) => { this.state.deck = deck; this.render() },
      setDifficulty: (difficulty) => { this.state.campaign.difficulty = difficulty; this.render() },
      setResult: (result) => { this.state.result = result; this.state.screen = 'result'; this.render() },
      reset: () => { this.state.result = null; this.state.screen = 'home'; this.render() },
    }
  }

  private render(): void {
    clear(this.root)
    this.root.dataset.screen = this.state.screen
    this.renderers[this.state.screen]?.render(this.root, this.state, this.actions())
  }
}
