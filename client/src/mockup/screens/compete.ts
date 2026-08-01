import { button, el } from '../../ui'
import { makeRoomCode } from '../state'
import type { MockupActions, MockupScreenRenderer, MockupState } from '../types'

export const competeScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state: MockupState, actions: MockupActions): void {
    const leave = (): void => { state.compete = { code: makeRoomCode(), youReady: false, opponentJoined: false, opponentReady: false }; actions.go('home') }
    root.append(el('header', { class: 'mockup-screen-head' }, button('‹', leave, { class: 'mockup-back' }), el('div', {}, el('span', { class: 'mockup-eyebrow', text: 'Shared table' }), el('h1', { text: 'Compete' }))))
    const room = el('section', { class: 'mockup-panel mockup-lobby' }, el('span', { class: 'mockup-eyebrow', text: 'Practice room' }), el('strong', { class: 'mockup-room-code', text: state.compete.code }), el('p', { text: 'This mock lobby pairs you with a practice rival. Choose a deck, then ready up to unlock the battle.' }))
    const seats = el('div', { class: 'mockup-seats' }, el('div', { class: 'mockup-seat ready' }, el('strong', { text: 'You' }), el('span', { text: state.compete.youReady ? 'Ready' : 'Waiting' })), el('div', { class: `mockup-seat${state.compete.opponentJoined ? ' ready' : ''}` }, el('strong', { text: state.compete.opponentJoined ? 'Practice rival' : 'Open seat' }), el('span', { text: state.compete.opponentReady ? 'Ready' : 'Waiting' })))
    const canStart = state.compete.youReady && state.compete.opponentJoined && state.compete.opponentReady
    room.append(seats, button('Choose deck', () => actions.openCollection('compete'), { class: 'mockup-secondary' }), button(state.compete.youReady ? 'Unready' : 'Ready up', () => { const ready = !state.compete.youReady; state.compete.youReady = ready; state.compete.opponentJoined = ready; state.compete.opponentReady = ready; actions.go('compete') }, { class: 'mockup-primary' }), button('Start practice battle', () => actions.startBattle('compete'), { class: 'mockup-primary', disabled: !canStart }), button('Leave lobby', leave, { class: 'mockup-secondary' }))
    root.append(room)
  },
}
