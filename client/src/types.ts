/** Wire types. These mirror the Python payloads in `engine/` and `server/`. */

export interface CardSpec {
  name: string
  power: number
  stamina: number
  ability: string | null
  deck_limit: number
  unique: boolean
  flavor: string
  is_boss: boolean
}

export interface LeaderSpec {
  id: string
  name: string
  genre: string
  blurb: string
  tags: string[]
}

export interface ItemSpec {
  id: string
  name: string
  cost: number
  layer: 'duel' | 'info'
  blurb: string
}

export interface Catalog {
  cards: CardSpec[]
  boss: CardSpec
  deck_size: number
  boss_max_slot: number
  leaders: LeaderSpec[]
  items: ItemSpec[]
  difficulties: string[]
  starter_deck: DeckPayload
}

export interface DeckPayload {
  cards: string[]
  leader: string
  boss_slot: number | null
  name: string
}

export interface CardView {
  uid: number
  name: string
  power: number
  stamina: number
  ability: string | null
  stolen: string | null
  spent: boolean
}

export interface SideView {
  seat: number
  leader: string | null
  gold: number | null
  charges: number
  discards: number
  remaining: number
  /** Every surviving unit: deck + hand + the active fielded card. */
  units: number
  damage_dealt: number
  shield: number
  active: CardView | null
  power: number
  stamina: number
  scout_turns: number | null
  fog_turns: number
  hand?: CardView[]
}

export interface BattleResult {
  winner: number | null
  reason: string
  duels: number
  rounds: number
  units: number[]
  discards: number[]
  damage: number[]
}

export interface GameState {
  duel: number
  seat: number
  you: SideView
  them: SideView
  result: BattleResult | null
}

export type RequestKind =
  | 'pick' | 'shop' | 'withdraw' | 'smite' | 'empower'
  | 'second_wind' | 'revive'

export interface PromptRequest {
  kind: RequestKind
  seat: number
  options: unknown[]
  context: Record<string, unknown>
}

export interface BattleEvent {
  n: number
  duel: number
  kind: string
  [key: string]: unknown
}

export type ServerMessage =
  | { type: 'lobby'; code: string; vs_npc: boolean; ready: boolean
      players: { name: string; npc: boolean; connected: boolean }[] }
  | { type: 'update'; state: GameState; events: BattleEvent[]
      waiting_on: number[]; prompt: PromptRequest | null }
  | { type: 'replay'; log: unknown }
  | { type: 'error'; message: string }
  | { type: 'pong' }
