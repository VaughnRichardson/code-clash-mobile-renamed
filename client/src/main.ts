import './styles.css'
import './reference.css'
import './reference-fixes.css'
import { BattleScreen } from './battle'
import { image } from './art'
import { loadSavedDeck, renderDeckBuilder } from './deckbuilder'
import { Connection, loadCatalog } from './net'
import { button, clear, el } from './ui'
import type { Catalog, DeckPayload, ServerMessage } from './types'
import { mountAtmosphere } from './atmosphere'
import { layoutEditorEnabled } from './layout-editor'

type Screen = 'home' | 'campaign' | 'compete' | 'deck' | 'lobby' | 'battle'

const root = document.getElementById('app')!
const connection = new Connection()
let catalog: Catalog
let deck: DeckPayload
let screen: Screen = 'home'
let deckReturn: 'home' | 'campaign' | 'compete' = 'home'
let playerName = ''
let lastError = ''
let lobby: Extract<ServerMessage, { type: 'lobby' }> | null = null
let battleScreen: BattleScreen | null = null
let status: 'connecting' | 'open' | 'closed' = 'connecting'
let accountOpen = false
const offlineMode = new URLSearchParams(location.search).has('mockup')
const campaignIdentity = `Solo-${(
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replace(/-/g, '')
    : Math.random().toString(36).slice(2)
).slice(0, 8)}`

function go(next: Screen): void { screen = next; render() }
function openDeck(returnTo: 'home' | 'campaign' | 'compete'): void { deckReturn = returnTo; go('deck') }
function fail(message: string): void { lastError = message; render() }
function sessionName(): string { return playerName.trim() }

function sessionNameInput(id: string): HTMLInputElement {
  const input = el('input', {
    id, placeholder: 'Choose a session name', value: playerName, maxLength: 20,
    'aria-label': 'Session name', autocomplete: 'off',
  })
  input.addEventListener('input', () => {
    playerName = input.value
    if (!lastError.toLowerCase().includes('name')) return
    lastError = ''
    root.querySelector('.session-name-error')?.remove()
  })
  return input
}

function startOfflineBattle(mode: 'campaign' | 'compete'): void {
  const selectedDeck = structuredClone(deck)
  clear(root)
  screen = 'battle'
  root.dataset.screen = 'battle'
  root.append(el('header', { class: 'mockup-real-battle-head' },
    button('Back to menu', () => { screen = 'home'; render() }, { class: 'mockup-secondary' }),
    el('span', { class: 'mockup-eyebrow', text: mode === 'compete' ? 'Offline compete preview' : 'Offline campaign preview' })))
  const frame = el('iframe', { class: 'mockup-real-battle', title: 'Offline Card Clash battle', src: '/mockup/card-clash-game.html' })
  frame.addEventListener('load', () => frame.contentWindow?.postMessage({
    type: 'cc-configure-battle', deck: selectedDeck.cards,
    leader: selectedDeck.leader,
  }, '*'))
  root.append(frame)
}

function startCampaign(difficulty: string): void {
  if (offlineMode) return startOfflineBattle('campaign')
  const selectedDeck = structuredClone(deck)
  lastError = ''
  lobby = null
  connection.createRoom(campaignIdentity, selectedDeck, true, difficulty)
  go('lobby')
}

function renderHome(): void {
  clear(root)
  root.dataset.screen = 'home'

  const nameInput = sessionNameInput('name')

  const accountButton = button('♙', () => { accountOpen = !accountOpen; renderHome() }, {
    class: 'home-account-button', id: 'account-button', 'aria-label': 'Open account',
    'aria-expanded': accountOpen,
  })
  const accountPanel = el('section', { class: `home-account-panel${accountOpen ? ' open' : ''}` },
    el('span', { class: 'eyebrow', text: 'Guest profile' }),
    el('strong', { text: 'Your session identity' }),
    el('p', { text: 'Choose a name for this visit. It is not saved as an account.' }),
    el('span', { class: `connection-state ${status}`,
      text: status === 'open' ? 'Table ready' : status === 'closed' ? 'Offline' : 'Waking the room' }))

  root.append(el('header', { class: 'reference-home-header' },
    el('div', { class: 'brand-mark', 'aria-hidden': 'true' }, el('i', { class: 'brand-mark-core' })),
    el('div', { class: 'brand-copy' }, el('h1', { text: 'Card Clash' })), accountButton))
  root.append(el('div', { class: 'home-session-strip' }, el('span', { class: 'eyebrow', text: 'Session name' }), nameInput))
  root.append(button(`${deck.name} · ${deck.cards.length}/${catalog.deck_size} cards · ${catalog.leaders.find(item => item.id === deck.leader)?.name ?? 'Leader'}`, () => openDeck('home'), {
    class: 'home-deck-link', id: 'edit-deck', 'aria-label': 'Open collection and edit deck',
  }))
  root.append(accountPanel)
  if (layoutEditorEnabled) root.append(el('div', {
    class: 'layout-editor-armed-note',
    text: 'Layout editor armed — start a live Campaign battle, then drag and resize the battlefield pieces.',
  }))
  if (lastError) root.append(el('div', { class: 'error home-error', text: lastError }))
  if (status === 'closed') root.append(el('div', { class: 'error home-error', text: 'Disconnected from the server. Reload to try again.' }))

  const tile = (mode: 'campaign' | 'collection' | 'compete', title: string, art: string, copy: string): HTMLElement => {
    const node = button('', () => mode === 'collection' ? openDeck('home') : go(mode), {
      class: `reference-mode-card reference-mode-${mode}`, 'aria-label': `${title}: ${copy}`,
    })
    node.append(image(art, 'reference-mode-art', ''), el('span', { class: 'reference-mode-shade' }), el('strong', { text: title }), el('small', { text: copy }))
    return node
  }
  root.append(el('main', { class: 'reference-home-menu' },
    tile('campaign', 'Campaign', '/art/ui/modes/campaign-deity-card-hd.png', 'Play the house'),
    tile('collection', 'Collection', '/art/ui/modes/collection-hedgehog-card-hd.png', `${deck.cards.length} cards ready`),
    tile('compete', 'Compete', '/art/ui/modes/compete-deity-card-hd.png', 'Find a rival')))

  const difficulty = el('select', { id: 'difficulty' })
  for (const level of catalog.difficulties) difficulty.append(el('option', {
    value: level, text: level[0].toUpperCase() + level.slice(1), selected: level === 'steady',
  }))
  const campaignPanel = el('section', { class: 'panel mode-card house-mode', id: 'campaign-panel' },
    el('div', { class: 'mode-head' }, el('span', { class: 'mode-sigil', 'aria-hidden': 'true' }), el('div', {},
      el('span', { class: 'eyebrow', text: 'Campaign' }), el('h2', { text: 'Play the house' }))),
    el('p', { class: 'mode-copy', text: 'A private match for learning a deck or sharpening an opening.' }),
    el('label', { text: 'House temperament' }), difficulty,
    el('div', { style: 'height:10px' }),
    button('Start battle', () => startCampaign(difficulty.value), {
      class: 'primary wide', id: 'play-npc',
    }))
  root.append(campaignPanel)

  const codeInput = el('input', { id: 'code', placeholder: 'ROOM CODE', maxLength: 4, autocapitalize: 'characters', autocomplete: 'off' })
  codeInput.style.textTransform = 'uppercase'
  const competePanel = el('section', { class: 'panel mode-card compete-mode', id: 'compete-panel' },
    el('div', { class: 'mode-head' }, el('span', { class: 'mode-sigil friend', 'aria-hidden': 'true' }), el('div', {},
      el('span', { class: 'eyebrow', text: 'Compete' }), el('h2', { text: 'Find a rival' }))),
    el('p', { class: 'mode-copy', text: 'Create a room or connect to a rival with a four-letter room key.' }),
    button('Create a room', () => {
      const name = sessionName()
      if (!name) return fail('Choose a name before creating a room.')
      lastError = ''
      if (offlineMode) {
        lobby = { type: 'lobby', code: 'MOCK', vs_npc: false, ready: true, players: [{ name, npc: false, connected: true }, { name: 'Practice rival', npc: false, connected: true }] }
        return go('lobby')
      }
      lobby = null; connection.createRoom(name, deck, false, 'veteran'); go('lobby')
    }, { class: 'primary wide', id: 'create-room' }),
    el('div', { class: 'join-divider', text: 'or join a room' }),
    el('div', { class: 'join-row' }, codeInput, button('Join', () => {
      const code = codeInput.value.trim().toUpperCase()
      if (code.length !== 4) return fail('A room code is 4 characters.')
      const name = sessionName()
      if (!name) return fail('Choose a name before joining a room.')
      lastError = ''
      if (offlineMode) {
        lobby = { type: 'lobby', code, vs_npc: false, ready: true, players: [{ name, npc: false, connected: true }, { name: 'Practice rival', npc: false, connected: true }] }
        return go('lobby')
      }
      lobby = null; connection.joinRoom(name, deck, code); go('lobby')
    }, { id: 'join-room' })))
  root.append(competePanel)
}

function renderCampaign(): void {
  clear(root)
  root.dataset.screen = 'campaign'

  const difficulty = el('select', { id: 'difficulty' })
  for (const level of catalog.difficulties) difficulty.append(el('option', {
    value: level, text: level[0].toUpperCase() + level.slice(1), selected: level === 'steady',
  }))

  root.append(el('header', { class: 'screen-heading' },
    button('‹', () => go('home'), { class: 'mockup-back', 'aria-label': 'Back to home' }),
    el('span', { class: 'eyebrow', text: 'Campaign' }),
    el('h1', { text: 'Play the house' }),
    el('p', { class: 'screen-dek', text: 'A private match for learning a deck or sharpening an opening.' })))

  root.append(el('section', { class: 'panel mode-card house-mode campaign-setup-card' },
    el('span', { class: 'eyebrow', text: 'Your deck' }),
    el('h2', { text: deck.name }),
    el('p', { class: 'mode-copy', text: `${deck.cards.length}/${catalog.deck_size} cards · ${catalog.leaders.find(item => item.id === deck.leader)?.name ?? 'Leader'}` }),
    button(`Edit deck · ${deck.name}`, () => openDeck('campaign'), { class: 'ghost wide' }),
    el('label', { text: 'House temperament' }),
    difficulty,
    button('Start battle', () => startCampaign(difficulty.value), {
      class: 'primary wide', id: 'play-npc',
    })))
}

function renderCompete(): void {
  clear(root)
  root.dataset.screen = 'compete'

  const codeInput = el('input', { id: 'code', placeholder: 'ROOM CODE', maxLength: 4, autocapitalize: 'characters', autocomplete: 'off' })
  codeInput.style.textTransform = 'uppercase'

  root.append(el('header', { class: 'screen-heading' },
    button('‹', () => go('home'), { class: 'mockup-back', 'aria-label': 'Back to home' }),
    el('span', { class: 'eyebrow', text: 'Compete' }),
    el('h1', { text: 'Find a rival' }),
    el('p', { class: 'screen-dek', text: 'Create a room or connect to a rival with a four-letter room key.' })))
  if (lastError) root.append(el('div', { class: 'error', text: lastError }))

  root.append(el('section', { class: 'panel mode-card compete-mode campaign-setup-card' },
    el('span', { class: 'eyebrow', text: 'Selected deck' }),
    el('h2', { text: deck.name }),
    el('p', { class: 'mode-copy', text: `${deck.cards.length}/${catalog.deck_size} cards · ${catalog.leaders.find(item => item.id === deck.leader)?.name ?? 'Leader'}` }),
    button('Choose or edit deck', () => openDeck('compete'), { class: 'ghost wide' }),
    button('Create a room', () => {
      const name = sessionName()
      if (!name) return fail('Choose a session name on the Home screen before creating a room.')
      lastError = ''
      if (offlineMode) {
        lobby = { type: 'lobby', code: 'MOCK', vs_npc: false, ready: true, players: [{ name, npc: false, connected: true }, { name: 'Practice rival', npc: false, connected: true }] }
        return go('lobby')
      }
      lobby = null; connection.createRoom(name, deck, false, 'veteran'); go('lobby')
    }, { class: 'primary wide', id: 'create-room' }),
    el('div', { class: 'join-divider', text: 'or join a room' }),
    el('div', { class: 'join-row' }, codeInput, button('Join', () => {
      const code = codeInput.value.trim().toUpperCase()
      if (code.length !== 4) return fail('A room code is 4 characters.')
      const name = sessionName()
      if (!name) return fail('Choose a session name on the Home screen before joining a room.')
      lastError = ''
      if (offlineMode) {
        lobby = { type: 'lobby', code, vs_npc: false, ready: true, players: [{ name, npc: false, connected: true }, { name: 'Practice rival', npc: false, connected: true }] }
        return go('lobby')
      }
      lobby = null; connection.joinRoom(name, deck, code); go('lobby')
    }, { id: 'join-room' }))))
}

function renderLobby(): void {
  clear(root); root.dataset.screen = 'lobby'
  root.append(el('header', { class: 'screen-heading' }, el('span', { class: 'eyebrow', text: 'The table between worlds' }), el('h1', { text: 'Gathering room' }), el('p', { class: 'screen-dek', text: 'Keep this screen open while the second seat joins.' })))
  if (lastError) root.append(el('div', { class: 'error', text: lastError }))
  if (!lobby) { root.append(el('div', { class: 'panel waiting', text: 'Opening the room' })); return }
  root.append(el('div', { class: 'panel' }, el('h3', { text: 'Room code' }), el('div', { class: 'code-display', id: 'room-code', text: lobby.code }), el('p', { class: 'muted center', text: lobby.vs_npc ? 'Playing the house.' : 'Send this code to your opponent. They enter it on their own phone.' })))
  const players = el('div', { class: 'panel' }, el('h3', { text: 'Seats' }))
  lobby.players.forEach((player, index) => players.append(el('div', { class: 'row tight' }, el('span', { text: `${index + 1}. ${player.name}` }), el('span', { class: `chip${player.connected ? ' gold' : '' }`, text: player.npc ? 'AI' : player.connected ? 'ready' : 'away' }))))
  if (lobby.players.length < 2) players.append(el('div', { class: 'waiting', text: 'Waiting for a second player' }))
  const lobbyActions = el('div', { class: 'sticky-actions lobby-actions' }, button('Leave room', () => location.reload(), { class: 'ghost lobby-leave' }))
  if (offlineMode) lobbyActions.append(button('Start offline battle', () => startOfflineBattle('compete'), { class: 'primary lobby-start' }))
  root.append(players, lobbyActions)
}

function render(): void {
  if (screen === 'home') return renderHome()
  if (screen === 'campaign') return renderCampaign()
  if (screen === 'compete') return renderCompete()
  if (screen === 'deck') return renderDeckBuilder(root, catalog, deck, updated => { deck = updated; go(deckReturn) }, () => go(deckReturn), updated => { deck = updated })
  if (screen === 'lobby') return renderLobby()
  battleScreen?.render()
}

connection.onStatus = next => {
  status = next
  if (next === 'closed') { playerName = ''; lobby = null; battleScreen = null; screen = 'home' }
  if (screen === 'home') render()
}

connection.onMessage = message => {
  switch (message.type) {
    case 'lobby': lobby = message; if (screen !== 'battle') go('lobby'); break
    case 'update':
      if (!battleScreen) battleScreen = new BattleScreen(root, catalog, value => connection.answer(value), () => location.reload())
      screen = 'battle'; battleScreen.update(message.state, message.events, message.prompt, message.waiting_on); break
    case 'error':
      lastError = message.message
      if (screen === 'battle') { location.reload(); return }
      if (screen === 'lobby' && !lobby) go('home'); else render()
      break
    default: break
  }
}

async function boot(): Promise<void> {
  mountAtmosphere()
  try { catalog = await loadCatalog() } catch (error) { root.append(el('div', { class: 'error', text: `Could not reach the server: ${String(error)}` })); return }
  deck = loadSavedDeck(catalog)
  if (offlineMode) { status = 'open'; render(); return }
  connection.connect(); render()
}

void boot()
