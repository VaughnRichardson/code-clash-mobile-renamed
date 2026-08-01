import type { Catalog, DeckPayload } from '../types'
import type { CampaignDifficulty, MockupState } from './types'

export function createMockupState(catalog: Catalog, deck: DeckPayload): MockupState {
  return {
    screen: 'home', catalog, deck,
    campaign: { difficulty: 'steady', opponent: 'Ashen Rush', phase: 'ready' },
    compete: { code: makeRoomCode(), youReady: false, opponentJoined: false, opponentReady: false },
    result: null,
  }
}

export function makeRoomCode(): string {
  return Math.random().toString(36).slice(2, 6).toUpperCase()
}

export function campaignCopy(difficulty: CampaignDifficulty): string {
  if (difficulty === 'novice') return 'A gentle opening. The coach will explain each clash.'
  if (difficulty === 'veteran') return 'The house reads patterns and punishes repeated openings.'
  return 'A measured rival. Learn the rhythm, then commit.'
}
