import { h, setText, setStyle, show, fmtInt } from './dom.js'

const STATE_LABELS = {
  MANUAL: 'MANUAL',
  GRINDING: 'GRIND',
  AIRBORNE: 'AIRE',
  TRICKING: 'TRUCO',
  FALLING: 'CAÍDA',
  RECOVERING: 'LEVANTANDO',
  WALKING: 'A PIE',
  RUNNING: 'CORRIENDO',
  MOUNTING_BOARD: 'SUBIENDO',
}

/**
 * HUD: nombre del truco, puntuación, combo, multiplicador, velocidad, objetivo, equilibrio y pausa.
 * Solo toca el DOM cuando cambia un valor (setText/setStyle con caché).
 */
export class HUD {
  constructor({ root, game, bus }) {
    this.game = game
    this.score = h('div', { class: 'sf-hud__score', text: '0' })
    this.comboTricks = h('div', { class: 'sf-hud__combo-tricks' })
    this.comboTotal = h('div', { class: 'sf-hud__combo-total' })
    this.comboGrace = h('div', { class: 'sf-hud__grace-fill' })
    this.combo = h('div', { class: 'sf-hud__combo is-hidden' }, this.comboTricks, this.comboTotal, h('div', { class: 'sf-hud__grace' }, this.comboGrace))
    this.popup = h('div', { class: 'sf-hud__popup' })
    this.speed = h('span', { class: 'sf-hud__speed-val', text: '0' })
    this.speedUnit = h('span', { class: 'sf-hud__speed-unit', text: 'km/h' })
    this.stateChip = h('span', { class: 'sf-chip sf-chip--lime is-hidden' })
    this.modeChip = h('span', { class: 'sf-chip' })
    this.objTitle = h('strong')
    this.objFill = h('div', { class: 'sf-progress__fill' })
    this.objective = h('div', { class: 'sf-hud__objective sf-card is-hidden' }, h('span', { class: 'sf-hud__objective-label', text: 'OBJETIVO' }), this.objTitle, h('div', { class: 'sf-progress' }, this.objFill))
    this.hint = h('div', { class: 'sf-hud__hint is-hidden' })
    this.balanceMark = h('div', { class: 'sf-hud__balance-mark' })
    this.balance = h('div', { class: 'sf-hud__balance is-hidden' }, h('div', { class: 'sf-hud__balance-track' }, this.balanceMark))
    this.pauseBtn = h('button', { class: 'sf-hud__pause', type: 'button', 'aria-label': 'Pausa', onClick: () => game.actions.pause() }, h('span'), h('span'))
    this.el = h(
      'section',
      { class: 'sf-hud is-hidden', 'aria-label': 'HUD' },
      h('div', { class: 'sf-hud__tl' }, h('span', { class: 'sf-hud__label', text: 'PUNTUACIÓN' }), this.score),
      this.combo,
      this.popup,
      h('div', { class: 'sf-hud__tr' }, this.objective, this.pauseBtn),
      h('div', { class: 'sf-hud__bl' }, h('div', { class: 'sf-hud__speed' }, this.speed, this.speedUnit), h('div', { class: 'sf-hud__chips' }, this.modeChip, this.stateChip)),
      this.balance,
      this.hint,
    )
    root.appendChild(this.el)
    this._popTimer = null
    this._offs = []
    if (bus?.on) {
      this._offs.push(
        bus.on('trick:completed', (t) => this.flash(t.displayName || t.name, `+${fmtInt(t.score)}`, t.clean === false ? 'sketchy' : 'ok')),
        bus.on('skater:bail', () => this.flash('¡CAÍDA!', 'combo perdido', 'fail')),
        bus.on('combo:end', (c) => c.landed && c.total > 0 && c.tricks.length > 1 && this.flash(`COMBO ×${c.multiplier.toFixed(1).replace('.0', '')}`, `+${fmtInt(c.total)}`, 'combo')),
      )
    }
  }

  setVisible(v) {
    show(this.el, v)
  }

  flash(title, sub, kind) {
    this.popup.replaceChildren(h('div', { class: `sf-hud__trick sf-hud__trick--${kind}` }, h('strong', { text: title }), h('span', { text: sub })))
    this.popup.classList.remove('is-in')
    void this.popup.offsetWidth
    this.popup.classList.add('is-in')
    clearTimeout(this._popTimer)
    this._popTimer = setTimeout(() => this.popup.classList.remove('is-in'), 1600)
  }

  /** @param {{telemetry:any, playerState:string, combo:any, challenges:any, settings:any}} f */
  update(dt, f) {
    const tel = f.telemetry
    const s = f.settings
    if (!tel) return
    const mph = s?.gameplay?.units === 'mph'
    setText(this.speed, String(Math.round(tel.speed * (mph ? 2.237 : 3.6))))
    setText(this.speedUnit, mph ? 'mph' : 'km/h')
    setText(this.modeChip, tel.mode === 'realistic' ? 'REALISTA' : 'ARCADE')
    const lbl = STATE_LABELS[f.playerState]
    if (lbl) setText(this.stateChip, f.playerState === 'GRINDING' && tel.grind.type ? tel.grind.type.toUpperCase() : lbl)
    show(this.stateChip, !!lbl)
    // Puntuación y combo
    const c = f.combo
    if (c) {
      setText(this.score, fmtInt(c.score || 0))
      show(this.combo, c.active)
      if (c.active) {
        const names = c.tricks.slice(-4).map((t) => t.name)
        setText(this.comboTricks, (c.tricks.length > 4 ? '… + ' : '') + names.join(' + '))
        setText(this.comboTotal, `${fmtInt(c.baseScore)} × ${c.multiplier.toFixed(1).replace('.0', '')}`)
        setStyle(this.comboGrace, 'transform', `scaleX(${(c.graceRemaining ?? 0) / 0.65})`)
      }
    }
    // Equilibrio (grind lateral / manual)
    const bal = tel.grind.active ? tel.lean : tel.manual.active ? this.game.balance?.value ?? 0 : null
    show(this.balance, bal !== null)
    if (bal !== null) {
      this.balance.classList.toggle('is-vertical', !tel.grind.active)
      const v = Math.max(-1, Math.min(1, bal))
      setStyle(this.balanceMark, tel.grind.active ? 'left' : 'top', `${50 + v * 46}%`)
      this.balanceMark.classList.toggle('is-danger', Math.abs(v) > 0.7)
    }
    // Objetivo y pista
    const obj = f.challenges?.getActiveObjective?.()
    show(this.objective, !!obj)
    if (obj) {
      setText(this.objTitle, obj.title)
      setStyle(this.objFill, 'transform', `scaleX(${Math.min(1, (obj.progress || 0) / obj.target)})`)
    }
    const hint = s?.gameplay?.tutorialHints && obj?.tutorial
    show(this.hint, !!hint)
    if (hint) setText(this.hint, obj.tutorial)
    this.el.classList.toggle('is-contrast', !!s?.accessibility?.highContrastHud)
  }

  dispose() {
    this._offs.forEach((o) => o?.())
  }
}
