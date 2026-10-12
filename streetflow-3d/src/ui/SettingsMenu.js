import { h } from './dom.js'
import { GRAPHICS_PRESETS } from '../graphics/GraphicsSettings.js'
import { TIME_PRESETS } from '../graphics/LightingSystem.js'
import { sanitizeBindings, serializeBindings, rebind, listBindingsForUi, resetBindings, GAMEPAD_LAYOUT } from '../input/InputBindings.js'

const TABS = [
  ['graphics', 'Gráficos'],
  ['audio', 'Audio'],
  ['controls', 'Controles'],
  ['gameplay', 'Juego'],
  ['accessibility', 'Accesibilidad'],
]

const clone = (o) => JSON.parse(JSON.stringify(o))

/** Configuración con aplicación inmediata (cada cambio se guarda y se aplica). */
export class SettingsMenu {
  constructor({ root, game, ui }) {
    this.game = game
    this.ui = ui
    this.tab = 'graphics'
    this.body = h('div', { class: 'sf-settings__body' })
    this.tabsEl = h('div', { class: 'sf-tabs', role: 'tablist' })
    this.el = h(
      'section',
      { class: 'sf-screen sf-panel-screen is-hidden', 'aria-label': 'Configuración' },
      h(
        'div',
        { class: 'sf-card sf-panel sf-settings' },
        h('header', { class: 'sf-panel__head' }, h('h2', { class: 'sf-title', text: 'CONFIGURACIÓN' }), h('button', { class: 'sf-btn sf-btn--ghost', type: 'button', onClick: () => ui.back() }, 'Volver')),
        this.tabsEl,
        this.body,
      ),
    )
    root.appendChild(this.el)
    this._capture = null
    this._onKeyCapture = (e) => this._handleCapture(e)
  }

  onShow() {
    this._renderTabs()
    this._render()
  }

  onHide() {
    this._stopCapture()
  }

  _renderTabs() {
    this.tabsEl.replaceChildren(
      ...TABS.map(([id, label]) =>
        h('button', { class: `sf-tab ${this.tab === id ? 'is-active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(this.tab === id), onClick: () => ((this.tab = id), this.ui.click(), this.onShow()) }, label),
      ),
    )
  }

  _apply(mutator) {
    const s = clone(this.game.settings)
    mutator(s)
    this.game.actions.applySettings(s)
  }

  _row(label, control, hint) {
    return h('label', { class: 'sf-row' }, h('span', { class: 'sf-row__label' }, label, hint ? h('small', { text: hint }) : null), control)
  }

  _select(value, options, onChange) {
    const sel = h('select', { class: 'sf-select', onChange: (e) => onChange(e.target.value) }, ...options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)))
    return sel
  }

  _toggle(value, onChange) {
    return h('input', { type: 'checkbox', class: 'sf-toggle', checked: !!value, onChange: (e) => onChange(e.target.checked) })
  }

  _slider(value, min, max, step, onChange, fmt = (v) => v.toFixed(2)) {
    const out = h('output', { class: 'sf-slider__val', text: fmt(value) })
    const input = h('input', {
      type: 'range',
      class: 'sf-slider',
      min,
      max,
      step,
      value,
      onInput: (e) => (out.textContent = fmt(+e.target.value)),
      onChange: (e) => onChange(+e.target.value),
    })
    return h('span', { class: 'sf-slider__wrap' }, input, out)
  }

  _render() {
    const s = this.game.settings
    const pct = (v) => `${Math.round(v * 100)}%`
    let rows = []
    switch (this.tab) {
      case 'graphics':
        rows = [
          this._row('Calidad', this._select(s.graphics.preset, Object.entries(GRAPHICS_PRESETS).map(([k, p]) => [k, p.label]), (v) => this._apply((x) => (x.graphics.preset = v))), 'ULTRA solo en equipos potentes'),
          this._row('Escala de resolución', this._slider(s.graphics.renderScale, 0.5, 1, 0.05, (v) => this._apply((x) => (x.graphics.renderScale = v)), pct)),
          this._row('Sombras', this._toggle(s.graphics.shadows, (v) => this._apply((x) => (x.graphics.shadows = v)))),
          this._row('Post-procesado', this._toggle(s.graphics.postFX, (v) => this._apply((x) => (x.graphics.postFX = v))), 'Bloom y antialiasing'),
          this._row('Hora del día', this._select(s.graphics.timeOfDay, Object.entries(TIME_PRESETS).map(([k, p]) => [k, p.label]), (v) => this._apply((x) => (x.graphics.timeOfDay = v)))),
          this._row('FOV dinámico', this._toggle(s.graphics.dynamicFov, (v) => this._apply((x) => (x.graphics.dynamicFov = v))), 'Amplía el campo de visión con la velocidad'),
          this._row('Mostrar FPS y estadísticas', this._toggle(s.graphics.showFps, (v) => this._apply((x) => (x.graphics.showFps = v))), 'También con F3'),
          h('p', { class: 'sf-muted', text: `Renderizador: ${this.game.rendererManager?.backendName || '—'}` }),
        ]
        break
      case 'audio':
        rows = [
          this._row('Volumen general', this._slider(s.audio.master, 0, 1, 0.05, (v) => this._apply((x) => (x.audio.master = v)), pct)),
          this._row('Efectos', this._slider(s.audio.sfx, 0, 1, 0.05, (v) => this._apply((x) => (x.audio.sfx = v)), pct)),
          this._row('Música', this._slider(s.audio.music, 0, 1, 0.05, (v) => this._apply((x) => (x.audio.music = v)), pct), 'Música procedural original'),
          this._row('Ambiente', this._slider(s.audio.ambient, 0, 1, 0.05, (v) => this._apply((x) => (x.audio.ambient = v)), pct)),
          this._row('Silenciar todo', this._toggle(s.audio.muted, (v) => this._apply((x) => (x.audio.muted = v)))),
        ]
        break
      case 'controls':
        rows = [
          this._row('Sensibilidad del ratón', this._slider(s.controls.mouseSensitivity, 0.1, 4, 0.05, (v) => this._apply((x) => (x.controls.mouseSensitivity = v)))),
          this._row('Invertir eje Y', this._toggle(s.controls.invertY, (v) => this._apply((x) => (x.controls.invertY = v)))),
          this._row('Zona muerta del mando', this._slider(s.controls.gamepadDeadzone, 0.02, 0.5, 0.01, (v) => this._apply((x) => (x.controls.gamepadDeadzone = v)))),
          this._row('Sensibilidad del mando', this._slider(s.controls.gamepadSensitivity, 0.2, 3, 0.05, (v) => this._apply((x) => (x.controls.gamepadSensitivity = v)))),
          this._keyboardSection(),
          this._gamepadSection(),
        ]
        break
      case 'gameplay':
        rows = [
          this._row('Modo de física', this._select(s.gameplay.physicsMode, [['arcade', 'Arcade (asistido)'], ['realistic', 'Realista (simulación)']], (v) => this._apply((x) => (x.gameplay.physicsMode = v))), 'Mismo núcleo físico, distinta asistencia'),
          this._row('Distancia de cámara', this._slider(s.gameplay.cameraDistance, 0.6, 1.6, 0.05, (v) => this._apply((x) => (x.gameplay.cameraDistance = v)), pct)),
          this._row('Unidades de velocidad', this._select(s.gameplay.units, [['kmh', 'km/h'], ['mph', 'mph']], (v) => this._apply((x) => (x.gameplay.units = v)))),
          this._row('Pistas de controles', this._toggle(s.gameplay.tutorialHints, (v) => this._apply((x) => (x.gameplay.tutorialHints = v))), 'Muestra el tutorial del objetivo activo'),
          h('div', { class: 'sf-row' }, h('span', { class: 'sf-row__label', text: 'Progreso' }), h('button', { class: 'sf-btn sf-btn--danger', type: 'button', onClick: () => this._resetProgress() }, 'Borrar progreso')),
        ]
        break
      case 'accessibility':
        rows = [
          this._row('Reducir sacudidas de cámara', this._toggle(s.accessibility.reduceCameraShake, (v) => this._apply((x) => (x.accessibility.reduceCameraShake = v)))),
          this._row('HUD de alto contraste', this._toggle(s.accessibility.highContrastHud, (v) => this._apply((x) => (x.accessibility.highContrastHud = v)))),
        ]
        break
    }
    this.body.replaceChildren(...rows)
  }

  _resetProgress() {
    if (!confirm('¿Borrar todo el progreso (desafíos, estadísticas y marcadores)? La personalización se conserva.')) return
    this.game.save.resetProgress()
    this.game.bus.emit('ui:notify', { text: 'Progreso borrado', kind: 'info', duration: 2 })
  }

  _keyboardSection() {
    const bindings = sanitizeBindings(this.game.settings.controls.keyboard).bindings
    const rows = listBindingsForUi(bindings)
    const groups = new Map()
    for (const r of rows) {
      if (!groups.has(r.groupLabel)) groups.set(r.groupLabel, [])
      groups.get(r.groupLabel).push(r)
    }
    return h(
      'div',
      { class: 'sf-keymap' },
      h('h3', { class: 'sf-subtitle', text: 'TECLADO' }),
      ...[...groups.entries()].map(([g, list]) =>
        h(
          'div',
          { class: 'sf-keymap__group' },
          h('h4', { text: g }),
          ...list.map((r) =>
            h(
              'div',
              { class: 'sf-keymap__row' },
              h('span', { text: r.label }),
              h(
                'span',
                { class: 'sf-keymap__keys' },
                ...[0, 1].map((slot) =>
                  h(
                    'button',
                    {
                      class: `sf-key ${this._capture?.action === r.action && this._capture?.slot === slot ? 'is-capturing' : ''}`,
                      type: 'button',
                      disabled: !r.rebindable || null,
                      onClick: () => this._startCapture(r.action, slot),
                    },
                    this._capture?.action === r.action && this._capture?.slot === slot ? 'Pulsa una tecla…' : r.keys[slot]?.label || '—',
                  ),
                ),
              ),
            ),
          ),
        ),
      ),
      h('button', { class: 'sf-btn sf-btn--ghost', type: 'button', onClick: () => this._apply((x) => (x.controls.keyboard = serializeBindings(resetBindings(bindings)))) }, 'Restaurar teclas por defecto'),
    )
  }

  _gamepadSection() {
    return h('div', { class: 'sf-keymap' }, h('h3', { class: 'sf-subtitle', text: 'MANDO' }), ...(GAMEPAD_LAYOUT || []).map((g) => h('div', { class: 'sf-keymap__row' }, h('span', { text: g.action }), h('kbd', { text: g.input }))))
  }

  _startCapture(action, slot) {
    this._capture = { action, slot }
    this.game.input.setEnabled(false)
    window.addEventListener('keydown', this._onKeyCapture, true)
    this._render()
  }

  _stopCapture() {
    if (!this._capture) return
    this._capture = null
    window.removeEventListener('keydown', this._onKeyCapture, true)
    this.game.input.setEnabled(true)
  }

  _handleCapture(e) {
    e.preventDefault()
    e.stopPropagation()
    const cap = this._capture
    if (!cap) return
    if (e.code === 'Escape') {
      this._stopCapture()
      this._render()
      return
    }
    const bindings = sanitizeBindings(this.game.settings.controls.keyboard).bindings
    const res = rebind(bindings, cap.action, e.code, { slot: cap.slot })
    this._stopCapture()
    if (!res.ok) this.game.bus.emit('ui:notify', { text: res.reason || 'No se pudo asignar', kind: 'warn', duration: 2.5 })
    else this._apply((x) => (x.controls.keyboard = serializeBindings(res.bindings)))
    this._render()
  }
}
