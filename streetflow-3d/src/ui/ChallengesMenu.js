import { h } from './dom.js'

export class ChallengesMenu {
  constructor({ root, game, ui }) {
    this.game = game
    this.ui = ui
    this.list = h('div', { class: 'sf-challenges' })
    this.el = h(
      'section',
      { class: 'sf-screen sf-panel-screen is-hidden', 'aria-label': 'Trucos y desafíos' },
      h(
        'div',
        { class: 'sf-card sf-panel' },
        h('header', { class: 'sf-panel__head' }, h('h2', { class: 'sf-title', text: 'TRUCOS Y DESAFÍOS' }), h('button', { class: 'sf-btn sf-btn--ghost', type: 'button', onClick: () => ui.back() }, 'Volver')),
        h('p', { class: 'sf-muted', text: 'Elige un objetivo para verlo en el HUD. Los desafíos de tutorial explican los controles.' }),
        this.list,
        h('footer', { class: 'sf-panel__foot' }, h('button', { class: 'sf-btn sf-btn--primary', type: 'button', onClick: () => (ui.click(), game.actions.play('challenges')) }, 'Jugar desafíos')),
      ),
    )
    root.appendChild(this.el)
  }

  onShow() {
    const cm = this.game.challenges
    const items = cm?.list?.() || []
    const active = cm?.getActiveObjective?.()
    this.list.replaceChildren(
      ...items.map((c) => {
        const pct = Math.round(Math.min(1, (c.progress || 0) / c.target) * 100)
        return h(
          'button',
          {
            class: `sf-challenge ${c.completed ? 'is-done' : ''} ${active?.id === c.id ? 'is-active' : ''}`,
            type: 'button',
            onClick: () => {
              cm.select(c.id)
              this.ui.click()
              this.onShow()
            },
          },
          h('div', { class: 'sf-challenge__head' }, h('strong', { text: c.title }), h('span', { class: 'sf-chip', text: c.completed ? 'COMPLETADO' : `${pct}%` })),
          h('p', { text: c.description }),
          c.tutorial ? h('p', { class: 'sf-challenge__tip', text: c.tutorial }) : null,
          h('div', { class: 'sf-progress' }, h('div', { class: 'sf-progress__fill', style: { transform: `scaleX(${pct / 100})` } })),
        )
      }),
    )
  }
}
