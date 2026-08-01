import { button, el } from '../../ui'
import type { MockupActions, MockupScreenRenderer } from '../types'

export const mockupBattleScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state, actions: MockupActions): void {
    const backTarget = state.battleMode === 'compete' ? 'compete' : 'campaign'
    const backLabel = state.battleMode === 'compete' ? 'Back to lobby' : 'Back to campaign'
    const modeLabel = state.battleMode === 'compete' ? 'Playable compete battle' : 'Playable AI campaign battle'
    root.append(el('header', { class: 'mockup-real-battle-head' }, button(backLabel, () => actions.go(backTarget), { class: 'mockup-secondary' }), el('span', { class: 'mockup-eyebrow', text: modeLabel })))
    const frame = el('iframe', { class: 'mockup-real-battle', title: 'Playable Card Clash battle', src: '/mockup/card-clash-game.html' })
    frame.addEventListener('load', () => frame.contentWindow?.postMessage({ type: 'cc-configure-battle', deck: state.deck.cards, leader: state.deck.leader, difficulty: state.campaign.difficulty }, '*'))
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'cc-exit-battle') actions.go('home')
      if (event.data?.type === 'cc-battle-result') actions.setResult(event.data.result)
    }, { once: true })
    root.append(frame)
  },
}
