/** Tiny DOM helpers. No framework: this client is a state-diff renderer and a
 *  handful of buttons, and a dependency-free build is one less thing to break
 *  on a phone at the far end of a tunnel. */

type Attrs = Record<string, string | number | boolean | undefined>
type Child = Node | string | null | undefined | false

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, attrs: Attrs = {}, ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key === 'class') node.className = String(value)
    else if (key === 'text') node.textContent = String(value)
    else if (key.startsWith('data-')) node.setAttribute(key, String(value))
    else if (key in node) (node as never as Record<string, unknown>)[key] = value
    else node.setAttribute(key, String(value))
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(typeof child === 'string' ? document.createTextNode(child)
                                          : child)
  }
  return node
}

export function button(label: string, onClick: () => void,
                       attrs: Attrs = {}): HTMLButtonElement {
  const node = el('button', { ...attrs, type: 'button' }, label)
  node.addEventListener('click', onClick)
  return node
}

export function clear(node: HTMLElement): HTMLElement {
  node.replaceChildren()
  return node
}

/** Title-cases an engine identifier for display: `second_wind` -> `Second Wind`. */
export function pretty(id: string | null | undefined): string {
  if (!id) return ''
  return id.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}
