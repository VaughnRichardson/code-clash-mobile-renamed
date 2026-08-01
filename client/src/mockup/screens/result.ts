import { button, el } from '../../ui'
import type { MockupActions, MockupScreenRenderer, MockupState } from '../types'

export const resultScreen: MockupScreenRenderer = {
  render(root: HTMLElement, state: MockupState, actions: MockupActions): void {
    root.append(el('main', { class: 'mockup-result' }, el('span', { class: 'mockup-eyebrow', text: 'Campaign complete' }), el('h1', { text: state.result ?? 'Victory' }), el('p', { text: 'Your line held together. The next rival will remember this opening.' }), button('Play again', () => actions.go('campaign'), { class: 'mockup-primary' }), button('Return home', actions.reset, { class: 'mockup-secondary' })))
  },
}
