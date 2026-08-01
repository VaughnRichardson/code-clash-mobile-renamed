import { button, el } from '../../ui'
import type { MockupActions, MockupScreenRenderer, MockupState } from '../types'

export const competeScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state: MockupState, actions: MockupActions): void {
    root.append(el('header', { class: 'mockup-screen-head' }, button('‹', () => actions.go('home'), { class: 'mockup-back' }), el('div', {}, el('span', { class: 'mockup-eyebrow', text: 'Shared table' }), el('h1', { text: 'Compete' }))))
    const room = el('section', { class: 'mockup-panel mockup-lobby' }, el('span', { class: 'mockup-eyebrow', text: 'Room code' }), el('strong', { class: 'mockup-room-code', text: state.compete.code }), el('p', { text: 'Share this code with a rival, or ready up to practice against the house.' }))
    const seats = el('div', { class: 'mockup-seats' }, el('div', { class: 'mockup-seat ready' }, el('strong', { text: 'You' }), el('span', { text: state.compete.youReady ? 'Ready' : 'Waiting' })), el('div', { class: `mockup-seat${state.compete.opponentJoined ? ' ready' : ''}` }, el('strong', { text: state.compete.opponentJoined ? 'Rival' : 'Open seat' }), el('span', { text: state.compete.opponentJoined ? 'Connected' : 'Waiting' })))
    room.append(seats, button(state.compete.youReady ? 'Unready' : 'Ready up', () => { state.compete.youReady = !state.compete.youReady; if (state.compete.youReady) state.compete.opponentJoined = true; actions.go('compete') }, { class: 'mockup-primary' }), button('Leave lobby', () => actions.go('home'), { class: 'mockup-secondary' }))
    root.append(room)
  },
}
