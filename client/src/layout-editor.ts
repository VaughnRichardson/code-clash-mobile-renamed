import './layout-editor.css'
import { button, el } from './ui'

export const layoutEditorEnabled = (() => {
  const query = new URLSearchParams(location.search)
  return query.has('layoutEditor') || query.has('layout-editor')
})()

const TARGETS = [
  { key: 'board', label: 'Whole board (camera)', selector: '.table' },
  { key: 'enemy-deck', label: 'Enemy deck', selector: '.seat.them .deck' },
  { key: 'enemy-discard', label: 'Enemy discard', selector: '.seat.them .discard' },
  { key: 'enemy-leader', label: 'Enemy leader', selector: '.seat.them .seatcol' },
  { key: 'enemy-field', label: 'Enemy field card', selector: '.seat.them .place' },
  { key: 'balance', label: 'Battle balance', selector: '.clash' },
  { key: 'player-leader', label: 'Player leader', selector: '.seat.you .seatcol' },
  { key: 'player-field', label: 'Player field card', selector: '.seat.you .place' },
  { key: 'player-discard', label: 'Player discard', selector: '.seat.you .discard' },
  { key: 'player-deck', label: 'Player deck', selector: '.seat.you .deck' },
  { key: 'hand', label: 'Player hand', selector: '.offers.hand' },
] as const

type LayoutKey = typeof TARGETS[number]['key']

interface LayoutTransform {
  x: number
  y: number
  scale: number
}

interface LayoutState {
  version: 1
  items: Record<LayoutKey, LayoutTransform>
}

interface DragState {
  pointerId: number
  key: LayoutKey
  originX: number
  originY: number
  startX: number
  startY: number
  target: HTMLElement
}

const STORAGE_KEY = 'card-clash:battle-layout-editor:v1'
const MIN_SCALE = 0.5
const MAX_SCALE = 1.8

function defaultTransform(): LayoutTransform {
  return { x: 0, y: 0, scale: 1 }
}

function defaultState(): LayoutState {
  const entries = TARGETS.map(target => [target.key, defaultTransform()])
  return { version: 1, items: Object.fromEntries(entries) as Record<LayoutKey, LayoutTransform> }
}

function copyState(state: LayoutState): LayoutState {
  return JSON.parse(JSON.stringify(state)) as LayoutState
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function normalizeState(value: unknown): LayoutState {
  const clean = defaultState()
  if (!value || typeof value !== 'object') return clean
  const saved = value as { items?: Record<string, Partial<LayoutTransform>> }
  for (const target of TARGETS) {
    const item = saved.items?.[target.key]
    if (!item) continue
    clean.items[target.key] = {
      x: Math.round(numberOr(item.x, 0)),
      y: Math.round(numberOr(item.y, 0)),
      scale: clamp(numberOr(item.scale, 1), MIN_SCALE, MAX_SCALE),
    }
  }
  return clean
}

function loadState(): LayoutState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved ? normalizeState(JSON.parse(saved)) : defaultState()
  } catch {
    return defaultState()
  }
}

/**
 * A developer-only direct-manipulation layer for the real battle renderer.
 * It never changes game state: it adds visual translate/scale longhands to
 * selected pieces, persists them locally, and exports the resulting geometry.
 */
export class BattleLayoutEditor {
  private state = loadState()
  private selected: LayoutKey = 'player-deck'
  private elements = new Map<LayoutKey, HTMLElement>()
  private history: LayoutState[] = []
  private pendingHistory: LayoutState | null = null
  private drag: DragState | null = null
  private collapsed = false
  private active = false

  private panel: HTMLElement
  private launcher: HTMLButtonElement
  private targetSelect: HTMLSelectElement
  private xInput: HTMLInputElement
  private yInput: HTMLInputElement
  private scaleInput: HTMLInputElement
  private scaleOutput: HTMLOutputElement
  private viewportReadout: HTMLElement
  private status: HTMLElement
  private undoButton: HTMLButtonElement

  constructor(private root: HTMLElement) {
    this.targetSelect = el('select', { 'aria-label': 'Battlefield element to move' })
    for (const target of TARGETS) {
      this.targetSelect.append(el('option', {
        value: target.key,
        text: target.label,
        selected: target.key === this.selected,
      }))
    }

    this.xInput = el('input', {
      type: 'number', inputMode: 'numeric', step: 1, value: 0,
      'aria-label': 'Selected element horizontal offset in pixels',
    })
    this.yInput = el('input', {
      type: 'number', inputMode: 'numeric', step: 1, value: 0,
      'aria-label': 'Selected element vertical offset in pixels',
    })
    this.scaleInput = el('input', {
      type: 'range', min: 50, max: 180, step: 1, value: 100,
      'aria-label': 'Selected element zoom',
    })
    this.scaleOutput = el('output', { text: '100%' })
    this.viewportReadout = el('span', { class: 'layout-editor-viewport' })
    this.status = el('p', {
      class: 'layout-editor-status',
      text: 'Tap an object or choose it below, then drag it.',
      role: 'status',
    })

    this.undoButton = button('Undo', () => this.undo(), {
      class: 'layout-editor-button', 'aria-label': 'Undo last layout change',
    })
    const collapseButton = button('Hide', () => this.setCollapsed(true), {
      class: 'layout-editor-button layout-editor-hide', 'aria-label': 'Hide layout editor controls',
    })

    this.panel = el('aside', {
      class: 'layout-editor-panel', 'aria-label': 'Battle layout editor',
    },
    el('div', { class: 'layout-editor-heading' },
      el('strong', { text: 'Battle layout' }), this.viewportReadout, collapseButton),
    el('label', { class: 'layout-editor-select-row' },
      el('span', { text: 'Move' }), this.targetSelect),
    el('div', { class: 'layout-editor-position-row' },
      el('label', {}, el('span', { text: 'X' }), this.xInput),
      el('label', {}, el('span', { text: 'Y' }), this.yInput),
      button('Center', () => this.resetSelectedPosition(), {
        class: 'layout-editor-button', 'aria-label': 'Reset selected element position',
      })),
    el('div', { class: 'layout-editor-scale-row' },
      button('−', () => this.adjustScale(-0.05), {
        class: 'layout-editor-step', 'aria-label': 'Zoom selected element out',
      }),
      el('label', {}, el('span', { text: 'Size' }), this.scaleInput),
      this.scaleOutput,
      button('+', () => this.adjustScale(0.05), {
        class: 'layout-editor-step', 'aria-label': 'Zoom selected element in',
      })),
    el('div', { class: 'layout-editor-actions' },
      this.undoButton,
      button('Reset item', () => this.resetSelected(), {
        class: 'layout-editor-button', 'aria-label': 'Reset selected element',
      }),
      button('Reset all', () => this.resetAll(), {
        class: 'layout-editor-button', 'aria-label': 'Reset the whole battle layout',
      }),
      button('Copy layout', () => { void this.copyLayout() }, {
        class: 'layout-editor-button layout-editor-copy',
      })),
    this.status)

    this.launcher = button('Edit layout', () => this.setCollapsed(false), {
      class: 'layout-editor-launcher', 'aria-label': 'Show battle layout editor controls',
    })
    document.body.append(this.panel, this.launcher)
    document.body.classList.add('layout-editor-active')

    this.bindControls()
    this.root.addEventListener('pointerdown', this.onPointerDown, true)
    this.root.addEventListener('click', this.blockBattleClick, true)
    window.addEventListener('pointermove', this.onPointerMove, { passive: false })
    window.addEventListener('pointerup', this.onPointerUp)
    window.addEventListener('pointercancel', this.onPointerUp)
    window.addEventListener('resize', () => this.updateViewportReadout())

    const observer = new MutationObserver(() => this.refresh())
    observer.observe(this.root, { childList: true })
    this.refresh()
  }

  private bindControls(): void {
    this.targetSelect.addEventListener('change', () => {
      this.select(this.targetSelect.value as LayoutKey)
    })

    const startControlEdit = (): void => this.beginHistory()
    const commitControlEdit = (): void => this.commitHistory()
    for (const input of [this.xInput, this.yInput, this.scaleInput]) {
      input.addEventListener('pointerdown', startControlEdit)
      input.addEventListener('focus', startControlEdit)
      input.addEventListener('change', commitControlEdit)
    }

    this.xInput.addEventListener('input', () => {
      this.current().x = Math.round(numberOr(this.xInput.valueAsNumber, 0))
      this.changed()
    })
    this.yInput.addEventListener('input', () => {
      this.current().y = Math.round(numberOr(this.yInput.valueAsNumber, 0))
      this.changed()
    })
    this.scaleInput.addEventListener('input', () => {
      this.current().scale = clamp(this.scaleInput.valueAsNumber / 100, MIN_SCALE, MAX_SCALE)
      this.changed()
    })
  }

  private refresh(): void {
    const table = this.root.querySelector('.table')
    this.active = Boolean(table)
    this.panel.hidden = !this.active || this.collapsed
    this.launcher.hidden = !this.active || !this.collapsed
    if (!this.active) return

    for (const element of this.elements.values()) {
      element.removeAttribute('data-layout-editor-key')
      element.removeAttribute('data-layout-editor-selected')
    }
    this.elements.clear()

    for (const target of TARGETS) {
      const element = this.root.querySelector<HTMLElement>(target.selector)
      if (!element) continue
      element.dataset.layoutEditorKey = target.key
      this.elements.set(target.key, element)
    }
    this.applyAll()
    this.select(this.selected)
    this.updateViewportReadout()
  }

  private current(): LayoutTransform {
    return this.state.items[this.selected]
  }

  private select(key: LayoutKey): void {
    if (!TARGETS.some(target => target.key === key)) return
    this.selected = key
    this.targetSelect.value = key
    for (const [candidate, element] of this.elements) {
      if (candidate === key) element.dataset.layoutEditorSelected = 'true'
      else element.removeAttribute('data-layout-editor-selected')
    }
    this.updateControls()
  }

  private updateControls(): void {
    const item = this.current()
    this.xInput.value = String(item.x)
    this.yInput.value = String(item.y)
    this.scaleInput.value = String(Math.round(item.scale * 100))
    this.scaleOutput.value = `${Math.round(item.scale * 100)}%`
    this.undoButton.disabled = this.history.length === 0
  }

  private updateViewportReadout(): void {
    const mode = innerWidth <= 600 ? 'mobile' : 'desktop'
    this.viewportReadout.textContent = `${innerWidth}×${innerHeight} · ${mode}`
  }

  private applyAll(): void {
    for (const target of TARGETS) this.apply(target.key)
  }

  private apply(key: LayoutKey): void {
    const element = this.elements.get(key)
    if (!element) return
    const item = this.state.items[key]
    element.style.setProperty('--layout-editor-x', `${item.x}px`)
    element.style.setProperty('--layout-editor-y', `${item.y}px`)
    element.style.setProperty('--layout-editor-scale', String(item.scale))
  }

  private changed(): void {
    this.apply(this.selected)
    this.persist()
    this.updateControls()
  }

  private persist(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state)) } catch { /* preview still works */ }
  }

  private beginHistory(): void {
    if (!this.pendingHistory) this.pendingHistory = copyState(this.state)
  }

  private commitHistory(): void {
    if (!this.pendingHistory) return
    if (JSON.stringify(this.pendingHistory) !== JSON.stringify(this.state)) {
      this.history.push(this.pendingHistory)
      if (this.history.length > 50) this.history.shift()
    }
    this.pendingHistory = null
    this.updateControls()
  }

  private mutate(change: () => void): void {
    this.beginHistory()
    change()
    this.changed()
    this.commitHistory()
  }

  private adjustScale(delta: number): void {
    this.mutate(() => {
      this.current().scale = clamp(
        Math.round((this.current().scale + delta) * 100) / 100,
        MIN_SCALE,
        MAX_SCALE)
    })
  }

  private resetSelectedPosition(): void {
    this.mutate(() => {
      this.current().x = 0
      this.current().y = 0
    })
  }

  private resetSelected(): void {
    this.mutate(() => { this.state.items[this.selected] = defaultTransform() })
  }

  private resetAll(): void {
    this.beginHistory()
    this.state = defaultState()
    this.persist()
    this.applyAll()
    this.updateControls()
    this.commitHistory()
    this.status.textContent = 'All editor adjustments were reset.'
  }

  private undo(): void {
    const previous = this.history.pop()
    if (!previous) return
    this.pendingHistory = null
    this.state = previous
    this.persist()
    this.applyAll()
    this.updateControls()
    this.status.textContent = 'Undid the last layout change.'
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed
    this.panel.hidden = !this.active || collapsed
    this.launcher.hidden = !this.active || !collapsed
  }

  private onPointerDown = (event: PointerEvent): void => {
    if (!this.active || event.button !== 0) return
    const source = event.target
    if (!(source instanceof Element)) return
    const target = source.closest<HTMLElement>('[data-layout-editor-key]')
    const key = target?.dataset.layoutEditorKey as LayoutKey | undefined
    if (!target || !key) return

    event.preventDefault()
    event.stopPropagation()
    this.select(key)
    this.beginHistory()
    const item = this.state.items[key]
    this.drag = {
      pointerId: event.pointerId,
      key,
      originX: item.x,
      originY: item.y,
      startX: event.clientX,
      startY: event.clientY,
      target,
    }
    target.setPointerCapture(event.pointerId)
    target.dataset.layoutEditorDragging = 'true'
    this.status.textContent = `Moving ${TARGETS.find(itemTarget => itemTarget.key === key)?.label ?? key}`
  }

  private onPointerMove = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    event.preventDefault()
    const item = this.state.items[this.drag.key]
    item.x = Math.round(this.drag.originX + event.clientX - this.drag.startX)
    item.y = Math.round(this.drag.originY + event.clientY - this.drag.startY)
    this.apply(this.drag.key)
    this.persist()
    this.updateControls()
  }

  private onPointerUp = (event: PointerEvent): void => {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return
    const { target } = this.drag
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId)
    target.removeAttribute('data-layout-editor-dragging')
    this.drag = null
    this.commitHistory()
    this.status.textContent = 'Position saved in this browser.'
  }

  private blockBattleClick = (event: MouseEvent): void => {
    const source = event.target
    if (!(source instanceof Element)) return
    if (!source.closest('[data-layout-editor-key]')) return
    event.preventDefault()
    event.stopPropagation()
  }

  private async copyLayout(): Promise<void> {
    const payload = JSON.stringify({
      tool: 'card-clash-battle-layout',
      viewport: { width: innerWidth, height: innerHeight },
      settings: this.state.items,
    }, null, 2)

    let copied = false
    try {
      await navigator.clipboard.writeText(payload)
      copied = true
    } catch {
      const fallback = el('textarea', { value: payload, 'aria-hidden': 'true' })
      fallback.style.position = 'fixed'
      fallback.style.opacity = '0'
      document.body.append(fallback)
      fallback.select()
      copied = document.execCommand('copy')
      fallback.remove()
    }
    this.status.textContent = copied
      ? 'Layout copied. Paste it into the Codex chat when you are happy.'
      : 'Copy was blocked. Try again after allowing clipboard access.'
  }
}
