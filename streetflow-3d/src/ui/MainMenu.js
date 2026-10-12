import { h } from './dom.js'
import { GAME } from '../core/Config.js'

/** Menú principal (docs/ARCHITECTURE.md §14). */
export class MainMenu {
  constructor({ root, game, ui }) {
    this.game = game
    this.ui = ui
    const a = game.actions
    const item = (label, sub, onClick, extra = '') =>
      h('button', { class: `sf-menu__item ${extra}`, type: 'button', onClick: () => (ui.click(), onClick()), onMouseenter: () => ui.hover() }, h('span', { class: 'sf-menu__label', text: label }), h('span', { class: 'sf-menu__sub', text: sub }))
    this.info = h('div', { class: 'sf-card sf-menu__info' })
    this.el = h(
      'section',
      { class: 'sf-screen sf-main is-hidden', 'aria-label': 'Menú principal' },
      h('div', { class: 'sf-main__shade' }),
      h(
        'div',
        { class: 'sf-main__col' },
        h('header', { class: 'sf-main__brand' }, h('h1', { class: 'sf-logo sf-logo--xl' }, 'STREETFLOW ', h('span', { class: 'sf-logo__badge' }, '3D')), h('p', { class: 'sf-subtitle', text: GAME.subtitle })),
        h(
          'nav',
          { class: 'sf-menu' },
          item('JUGAR', 'Sesión libre en el parque', () => a.play('skatepark'), 'sf-menu__item--primary'),
          item('SKATEPARK', 'Streetflow Park · bowls, rails y ledges', () => a.play('skatepark')),
          item('MUNDO ABIERTO', 'Streetflow Downtown', () => a.play('downtown')),
          item('TRUCOS Y DESAFÍOS', 'Tutoriales, objetivos y progreso', () => ui.showScreen('challenges')),
          item('PERSONALIZACIÓN', 'Skater y tabla', () => ui.showScreen('customization')),
          item('EDITOR DE PARQUES', 'Diseña y prueba tus propios parques', () => a.openEditor()),
          item('CONFIGURACIÓN', 'Gráficos, audio, controles y juego', () => ui.showScreen('settings')),
        ),
        h('footer', { class: 'sf-main__foot' }, h('span', { class: 'sf-chip', text: `v${GAME.version}` }), (this.backendChip = h('span', { class: 'sf-chip sf-chip--cyan', text: '' }))),
      ),
      h('aside', { class: 'sf-main__side' }, this.info),
    )
    root.appendChild(this.el)
  }

  onShow() {
    const g = this.game
    this.backendChip.textContent = g.rendererManager?.backendName || ''
    const stats = g.save?.data?.stats || {}
    const done = Object.values(g.save?.data?.challenges || {}).filter((c) => c.completed).length
    const total = g.challenges?.defs?.length || 0
    this.info.replaceChildren(
      h('h2', { class: 'sf-card__title', text: 'CONTROLES RÁPIDOS' }),
      h(
        'ul',
        { class: 'sf-keys' },
        ...[
          ['W', 'Empujar'],
          ['A / D', 'Girar · rotar en el aire'],
          ['S', 'Frenar'],
          ['ESPACIO', 'Mantener y soltar: ollie'],
          ['← → ↓ ↑', 'Flips en el aire · manual en el suelo'],
          ['E', 'Grind / slide'],
          ['F', 'Subir / bajar de la tabla'],
          ['R · G · T', 'Reiniciar · marcador · volver'],
          ['C · V · ESC', 'Cámara · repetición · pausa'],
        ].map(([k, d]) => h('li', null, h('kbd', { text: k }), h('span', { text: d }))),
      ),
      h('div', { class: 'sf-card__stats' }, h('div', null, h('strong', { text: (stats.bestCombo || 0).toLocaleString('es-ES') }), h('span', { text: 'Mejor combo' })), h('div', null, h('strong', { text: `${done}/${total}` }), h('span', { text: 'Desafíos' }))),
    )
  }
}
