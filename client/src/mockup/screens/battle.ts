import { button, el } from '../../ui'
import type { MockupActions, MockupScreenRenderer, MockupState } from '../types'

export const mockupBattleScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state: MockupState, actions: MockupActions): void {
    root.append(el('header', { class: 'mockup-screen-head' }, el('div', {}, el('span', { class: 'mockup-eyebrow', text: 'Ashen Rush · AI campaign' }), el('h1', { text: 'Choose your opening' }))))
    root.append(el('section', { class: 'mockup-battle-board' }, el('div', { class: 'mockup-battle-lane' }, el('strong', { text: 'The house is thinking…' }), el('span', { text: 'AI reads your leader and prepares a counter.' })), el('div', { class: 'mockup-battle-lane yours' }, el('strong', { text: state.deck.leader.replace('_', ' ') }), el('span', { text: `${state.deck.cards.length} cards in deck` }))))
    root.append(el('section', { class: 'mockup-panel' }, el('span', { class: 'mockup-eyebrow', text: 'Clash coach' }), el('p', { text: 'Your first move teaches the AI your rhythm. Lead with a card that can survive the reply.' }), button('Resolve mock duel', () => actions.setResult('Victory'), { class: 'mockup-primary' }), button('Forfeit', () => actions.setResult('Defeat'), { class: 'mockup-secondary' })))
  },
}
