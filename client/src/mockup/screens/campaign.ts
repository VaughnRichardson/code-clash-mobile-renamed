import { button, el } from '../../ui'
import { campaignCopy } from '../state'
import type { MockupActions, MockupScreenRenderer, MockupState } from '../types'

export const campaignScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state: MockupState, actions: MockupActions): void {
    root.append(el('header', { class: 'mockup-screen-head' }, button('‹', () => actions.go('home'), { class: 'mockup-back' }), el('div', {}, el('span', { class: 'mockup-eyebrow', text: 'AI campaign' }), el('h1', { text: 'Ashen Rush' }))))
    root.append(el('section', { class: 'mockup-campaign-hero' }, el('div', { class: 'mockup-score-row' }, el('strong', { text: '187' }), el('span', { text: '30 / 30 cards' }), el('strong', { text: '214' })), el('div', { class: 'mockup-campaign-track' }, el('i', {}))))
    const panel = el('section', { class: 'mockup-panel' }, el('span', { class: 'mockup-eyebrow', text: 'Your deck' }), el('h2', { text: state.deck.name }), el('p', { text: `${state.deck.cards.length} cards · ${state.deck.leader.replace('_', ' ')}` }), el('p', { class: 'mockup-coach', text: campaignCopy(state.campaign.difficulty) }))
    const difficulty = el('select', { class: 'mockup-select' })
    for (const level of state.catalog.difficulties) difficulty.append(el('option', { value: level, text: level[0].toUpperCase() + level.slice(1), selected: level === state.campaign.difficulty }))
    difficulty.addEventListener('change', () => actions.setDifficulty(difficulty.value as typeof state.campaign.difficulty))
    panel.append(button('Choose or edit deck', () => actions.go('collection'), { class: 'mockup-secondary' }), el('label', { text: 'House temperament' }), difficulty, button('Start campaign', () => actions.go('battle'), { class: 'mockup-primary' }))
    root.append(panel)
  },
}
