import type { Catalog, DeckPayload, ServerMessage } from './types'

/** Thin WebSocket wrapper. All game traffic is one socket per player. */
export class Connection {
  private ws: WebSocket | null = null
  private queue: string[] = []
  onMessage: (msg: ServerMessage) => void = () => {}
  onStatus: (status: 'connecting' | 'open' | 'closed') => void = () => {}

  connect(): void {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    this.onStatus('connecting')
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.onStatus('open')
      for (const pending of this.queue.splice(0)) ws.send(pending)
    }
    ws.onclose = () => this.onStatus('closed')
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data) as ServerMessage)
      } catch {
        /* a malformed frame is the server's problem, not the player's */
      }
    }
  }

  send(payload: unknown): void {
    const text = JSON.stringify(payload)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(text)
    else this.queue.push(text)
  }

  createRoom(name: string, deck: DeckPayload, vsNpc: boolean,
             difficulty: string): void {
    this.send({ type: 'create', name, deck, vs_npc: vsNpc, difficulty })
  }

  joinRoom(name: string, deck: DeckPayload, code: string): void {
    this.send({ type: 'join', name, deck, code })
  }

  answer(value: unknown): void {
    this.send({ type: 'answer', value })
  }
}

export async function loadCatalog(): Promise<Catalog> {
  const response = await fetch('/api/catalog')
  if (!response.ok) throw new Error(`catalog failed: ${response.status}`)
  return (await response.json()) as Catalog
}
