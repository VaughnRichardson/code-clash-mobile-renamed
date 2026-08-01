import './styles.css'
import { BattleScreen } from './battle'
import { loadSavedDeck, renderDeckBuilder, saveDeck } from './deckbuilder'
import { Connection, loadCatalog } from './net'
import { button, clear, el } from './ui'
import type { Catalog, DeckPayload, ServerMessage } from './types'
import { mountAtmosphere } from './atmosphere'
import { MockupShell } from './mockup/shell'
import { homeScreen } from './mockup/screens/home'
import { collectionScreen } from './mockup/screens/collection'
import { campaignScreen } from './mockup/screens/campaign'
import { competeScreen } from './mockup/screens/compete'
import { mockupBattleScreen } from './mockup/screens/battle'
import { resultScreen } from './mockup/screens/result'

type Screen = 'home' | 'deck' | 'lobby' | 'battle'

const root = document.getElementById('app')!
const connection = new Connection()

let catalog: Catalog
let deck: DeckPayload
let screen: Screen = 'home'
let playerName = localStorage.getItem('cardclash.name') ?? ''
let lastError = ''
let lobby: Extract<ServerMessage, { type: 'lobby' }> | null = null
let battleScreen: BattleScreen | null = null
let status: 'connecting' | 'open' | 'closed' = 'connecting'

function go(next: Screen): void {
  screen = next
  render()
}

function fail(message: string): void {
  lastError = message
  render()
}

// ── screens ──────────────────────────────────────────────────────────────────

function renderHome(): void {
  clear(root)
  root.dataset.screen = 'home'
  root.append(el('header', { class: 'home-hero' },
    el('div', { class: 'brand-mark', 'aria-hidden': 'true' },
      el('i', { class: 'brand-mark-core' })),
    el('div', { class: 'brand-copy' },
      el('span', { class: 'eyebrow', text: 'A pocket duel of nerve and order' }),
      el('h1', { text: 'Card Clash' }))))
  root.append(el('p', { class: 'home-lede',
    text: 'Set the order. Read the table. Commit before the other player does.' }))

  if (lastError) root.append(el('div', { class: 'error', text: lastError }))
  if (status === 'closed') {
    root.append(el('div', { class: 'error',
      text: 'Disconnected from the server. Reload to try again.' }))
  }

  const nameInput = el('input', {
    id: 'name', placeholder: 'Your name', value: playerName, maxLength: 20,
  })
  nameInput.addEventListener('input', () => {
    playerName = nameInput.value
    localStorage.setItem('cardclash.name', playerName)
  })

  const panel = el('div', { class: 'panel profile-panel' },
    el('div', { class: 'panel-kicker' },
      el('span', { class: 'eyebrow', text: 'Your seat' }),
      el('span', { class: `connection-state ${status}`,
        text: status === 'open' ? 'Table ready'
          : status === 'closed' ? 'Offline' : 'Waking the room' })),
    el('label', { text: 'Name' }), nameInput,
    el('label', { text: 'Battle deck' }),
    button(`${deck.name} — ${deck.cards.length} cards, `
           + `${catalog.leaders.find(l => l.id === deck.leader)?.name
              ?? 'no leader'}`,
           () => go('deck'), { class: 'wide deck-summary', id: 'edit-deck' }))
  root.append(panel)

  const difficulty = el('select', { id: 'difficulty' })
  for (const level of catalog.difficulties) {
    difficulty.append(el('option', {
      value: level, text: level[0].toUpperCase() + level.slice(1),
      selected: level === 'steady',
    }))
  }

  root.append(el('section', { class: 'panel mode-card house-mode' },
    el('div', { class: 'mode-head' },
      el('span', { class: 'mode-sigil', 'aria-hidden': 'true' }),
      el('div', {},
        el('span', { class: 'eyebrow', text: 'Solo table' }),
        el('h2', { text: 'Play the house' }))),
    el('p', { class: 'mode-copy',
      text: 'A private match for learning a deck or sharpening an opening.' }),
    el('label', { text: 'House temperament' }), difficulty,
    el('div', { style: 'height:10px' }),
    button('Start battle', () => {
      lastError = ''
      connection.createRoom(name(), deck, true, difficulty.value)
      go('lobby')
    }, { class: 'primary wide', id: 'play-npc' })))

  const codeInput = el('input', {
    id: 'code', placeholder: 'ROOM CODE', maxLength: 4,
    autocapitalize: 'characters', autocomplete: 'off',
  })
  codeInput.style.textTransform = 'uppercase'

  root.append(el('section', { class: 'panel mode-card friend-mode' },
    el('div', { class: 'mode-head' },
      el('span', { class: 'mode-sigil friend', 'aria-hidden': 'true' }),
      el('div', {},
        el('span', { class: 'eyebrow', text: 'Shared table' }),
        el('h2', { text: 'Play a friend' }))),
    el('p', { class: 'mode-copy',
      text: 'Open a room and pass its four-letter key to another player.' }),
    button('Create a room', () => {
      lastError = ''
      connection.createRoom(name(), deck, false, 'veteran')
      go('lobby')
    }, { class: 'primary wide', id: 'create-room' }),
    el('div', { class: 'join-divider', text: 'or join a room' }),
    el('div', { class: 'join-row' },
      codeInput,
      button('Join', () => {
        const code = codeInput.value.trim().toUpperCase()
        if (code.length !== 4) return fail('A room code is 4 characters.')
        lastError = ''
        connection.joinRoom(name(), deck, code)
        go('lobby')
      }, { id: 'join-room' }))))
}

function name(): string {
  return playerName.trim() || 'Player'
}

function renderLobby(): void {
  clear(root)
  root.dataset.screen = 'lobby'
  root.append(el('header', { class: 'screen-heading' },
    el('span', { class: 'eyebrow', text: 'The table between worlds' }),
    el('h1', { text: 'Gathering room' }),
    el('p', { class: 'screen-dek',
      text: 'Keep this screen open while the second seat joins.' })))
  if (lastError) root.append(el('div', { class: 'error', text: lastError }))

  if (!lobby) {
    root.append(el('div', { class: 'panel waiting', text: 'Opening the room' }))
    return
  }

  root.append(el('div', { class: 'panel' },
    el('h3', { text: 'Room code' }),
    el('div', { class: 'code-display', id: 'room-code', text: lobby.code }),
    el('p', { class: 'muted center',
      text: lobby.vs_npc
        ? 'Playing the house.'
        : 'Send this code to your opponent. They enter it on their own phone.' })))

  const players = el('div', { class: 'panel' }, el('h3', { text: 'Seats' }))
  lobby.players.forEach((player, index) => {
    players.append(el('div', { class: 'row tight' },
      el('span', { text: `${index + 1}. ${player.name}` }),
      el('span', { class: `chip${player.connected ? ' gold' : ''}`,
        text: player.npc ? 'AI' : player.connected ? 'ready' : 'away' })))
  })
  if (lobby.players.length < 2) {
    players.append(el('div', { class: 'waiting', text: 'Waiting for a second player' }))
  }
  root.append(players)

  root.append(el('div', { class: 'sticky-actions' },
    button('Leave', () => location.reload(), { class: 'ghost wide' })))
}

function render(): void {
  if (screen === 'home') return renderHome()
  if (screen === 'deck') {
    return renderDeckBuilder(root, catalog, deck, (updated) => {
      deck = updated
      saveDeck(deck)
      go('home')
    }, () => go('home'))
  }
  if (screen === 'lobby') return renderLobby()
  if (screen === 'battle') battleScreen?.render()
}

// ── wiring ───────────────────────────────────────────────────────────────────

connection.onStatus = (next) => {
  status = next
  if (screen === 'home') render()
}

connection.onMessage = (message) => {
  switch (message.type) {
    case 'lobby':
      lobby = message
      if (screen !== 'battle') go('lobby')
      break
    case 'update':
      if (!battleScreen) {
        battleScreen = new BattleScreen(
          root, catalog,
          (value) => connection.answer(value),
          () => location.reload())
      }
      screen = 'battle'
      battleScreen.update(message.state, message.events, message.prompt,
                          message.waiting_on)
      break
    case 'error':
      lastError = message.message
      if (screen === 'lobby' && !lobby) go('home')
      else render()
      break
    default:
      break
  }
}

async function boot(): Promise<void> {
  // Before anything renders: the room the screens are laid out in. It is
  // mounted once, on `document.body`, because every screen below clears
  // `#app`'s children.
  mountAtmosphere()
  try {
    catalog = await loadCatalog()
  } catch (error) {
    root.append(el('div', { class: 'error',
      text: `Could not reach the server: ${String(error)}` }))
    return
  }
  deck = loadSavedDeck(catalog)
  if (new URLSearchParams(location.search).has('mockup')) {
    const mockup = new MockupShell(root, catalog, deck, {
      home: homeScreen,
      collection: collectionScreen,
      campaign: campaignScreen,
      compete: competeScreen,
      battle: mockupBattleScreen,
      result: resultScreen,
    })
    mockup.mount()
    return
  }
  connection.connect()
  render()
}

void boot()
