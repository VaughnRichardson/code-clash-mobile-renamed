import { button, el } from '../../ui'
import type { MockupActions, MockupScreenRenderer } from '../types'

export const mockupBattleScreen: MockupScreenRenderer = {
  render(root: HTMLElement, _state, actions: MockupActions): void {
    root.append(el('header', { class: 'mockup-real-battle-head' }, button('‹ Back to campaign', () => actions.go('campaign'), { class: 'mockup-secondary' }), el('span', { class: 'mockup-eyebrow', text: 'Playable AI campaign battle' })))
    const frame = el('iframe', { class: 'mockup-real-battle', title: 'Playable Card Clash battle', src: '/mockup/card-clash-game.html' })
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'cc-exit-battle') actions.go('home')
    }, { once: true })
    root.append(frame)
  },
}
