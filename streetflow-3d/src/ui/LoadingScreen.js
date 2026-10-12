import { h } from './dom.js'
import { GAME } from '../core/Config.js'

const TIPS = [
  'Mantén ESPACIO para cargar el ollie: cuanto más tiempo, más alto.',
  'Flecha + soltar ESPACIO = flip. ← kickflip, → heelflip, ↓ shove-it.',
  'Salta sobre un rail o ledge manteniendo E para grindar. A/D mantienen el equilibrio.',
  'En el aire, A/D giran el cuerpo: aterriza recto para no caerte.',
  'G guarda un marcador y T te devuelve a él. R reinicia en el punto más cercano.',
  'Cambia entre modo Arcade y Realista en Configuración → Juego.',
]

/** Pantalla de carga con progreso real por fases. */
export class LoadingScreen {
  constructor(root) {
    this.phases = { renderer: 0.1, physics: 0.1, materials: 0.3, character: 0.2, world: 0.3 }
    this.progress = {}
    this.bar = h('div', { class: 'sf-load__bar-fill' })
    this.label = h('div', { class: 'sf-load__label', text: 'Preparando…' })
    this.pct = h('div', { class: 'sf-load__pct', text: '0%' })
    this.tip = h('p', { class: 'sf-load__tip', text: TIPS[Math.floor(Math.random() * TIPS.length)] })
    this.el = h(
      'section',
      { class: 'sf-load', role: 'status', 'aria-live': 'polite' },
      h('div', { class: 'sf-load__brand' }, h('h1', { class: 'sf-logo' }, 'STREETFLOW ', h('span', { class: 'sf-logo__badge' }, '3D')), h('p', { class: 'sf-subtitle', text: GAME.subtitle })),
      h('div', { class: 'sf-load__progress' }, h('div', { class: 'sf-load__row' }, this.label, this.pct), h('div', { class: 'sf-load__bar' }, this.bar)),
      this.tip,
    )
    root.appendChild(this.el)
  }

  show() {
    this.progress = {}
    this.el.classList.remove('is-hidden')
    this.tip.textContent = TIPS[Math.floor(Math.random() * TIPS.length)]
    this._render(0, 'Cargando…')
  }

  hide() {
    this.el.classList.add('is-hidden')
  }

  setProgress(phase, fraction, label) {
    this.progress[phase] = Math.min(1, Math.max(0, fraction || 0))
    let total = 0
    let weights = 0
    for (const [p, w] of Object.entries(this.phases)) {
      weights += w
      total += w * (this.progress[p] ?? 0)
    }
    this._render(total / weights, label)
  }

  _render(f, label) {
    this.bar.style.transform = `scaleX(${f})`
    this.pct.textContent = `${Math.round(f * 100)}%`
    if (label) this.label.textContent = label
  }
}
