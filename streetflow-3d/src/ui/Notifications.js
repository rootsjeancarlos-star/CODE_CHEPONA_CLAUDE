import { h } from './dom.js'

/** Avisos breves (bus 'ui:notify'). */
export class Notifications {
  constructor(root, bus) {
    this.el = h('div', { class: 'sf-toasts', 'aria-live': 'polite' })
    root.appendChild(this.el)
    this._off = bus?.on?.('ui:notify', (n) => this.push(n))
    this._last = { text: '', t: 0 }
  }

  push({ text, kind = 'info', duration = 3 }) {
    const now = performance.now()
    if (text === this._last.text && now - this._last.t < 800) return
    this._last = { text, t: now }
    const t = h('div', { class: `sf-toast sf-toast--${kind}`, text })
    this.el.appendChild(t)
    while (this.el.children.length > 4) this.el.firstChild.remove()
    requestAnimationFrame(() => t.classList.add('is-in'))
    setTimeout(() => {
      t.classList.remove('is-in')
      setTimeout(() => t.remove(), 300)
    }, duration * 1000)
  }

  dispose() {
    this._off?.()
    this.el.remove()
  }
}
