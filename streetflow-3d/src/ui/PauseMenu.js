import { h } from './dom.js'

export class PauseMenu {
  constructor({ root, game, ui }) {
    const a = game.actions
    const btn = (label, fn, cls = '') => h('button', { class: `sf-btn ${cls}`, type: 'button', onClick: () => (ui.click(), fn()), onMouseenter: () => ui.hover() }, label)
    this.el = h(
      'section',
      { class: 'sf-screen sf-pause is-hidden', 'aria-label': 'Pausa' },
      h(
        'div',
        { class: 'sf-card sf-pause__card' },
        h('h2', { class: 'sf-title', text: 'PAUSA' }),
        btn('Continuar', () => a.resume(), 'sf-btn--primary'),
        btn('Reiniciar posición', () => a.restart()),
        btn('Ver repetición', () => a.openReplay()),
        btn('Desafíos', () => ui.showScreen('challenges')),
        btn('Configuración', () => ui.showScreen('settings')),
        btn('Personalización', () => ui.showScreen('customization')),
        btn('Menú principal', () => a.quitToMenu(), 'sf-btn--ghost'),
      ),
    )
    root.appendChild(this.el)
  }
}
