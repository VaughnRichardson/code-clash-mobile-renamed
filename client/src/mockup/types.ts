import type { Catalog, DeckPayload } from '../types'

export type MockupScreen = 'home' | 'collection' | 'campaign' | 'compete' | 'battle' | 'result'
export type CampaignDifficulty = 'novice' | 'steady' | 'veteran'
export type MockupBattleMode = 'campaign' | 'compete'

export interface MockupState {
  screen: MockupScreen
  catalog: Catalog
  deck: DeckPayload
  campaign: { difficulty: CampaignDifficulty; opponent: string; phase: 'ready' | 'running' | 'complete' }
  compete: { code: string; youReady: boolean; opponentJoined: boolean; opponentReady: boolean }
  result: 'Victory' | 'Defeat' | 'Draw' | null
  battleMode: MockupBattleMode
  collectionReturn: 'home' | 'campaign' | 'compete'
}

export interface MockupActions {
  go: (screen: MockupScreen) => void
  startBattle: (mode: MockupBattleMode) => void
  openCollection: (returnTo: 'home' | 'campaign' | 'compete') => void
  updateDeck: (deck: DeckPayload) => void
  setDifficulty: (difficulty: CampaignDifficulty) => void
  setResult: (result: NonNullable<MockupState['result']>) => void
  reset: () => void
}

export interface MockupScreenRenderer {
  render: (root: HTMLElement, state: MockupState, actions: MockupActions) => void
}
