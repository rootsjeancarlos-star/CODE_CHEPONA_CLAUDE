import { h } from './dom.js'
import { CUSTOMIZATION_OPTIONS as O } from '../data/customizationDefaults.js'

const GRAPHIC_NAMES = { 'sf-ink-01': 'Tinta', 'sf-sunset-02': 'Atardecer', 'sf-grid-03': 'Rejilla', 'sf-plain-04': 'Madera', 'sf-mono-01': 'Mono', 'sf-wave-02': 'Ola', none: 'Sin gráfico' }

/** Personalización del skater y de la tabla, aplicada en vivo sobre el modelo 3D del fondo. */
export class CustomizationMenu {
  constructor({ root, game, ui }) {
    this.game = game
    this.ui = ui
    this.tab = 'character'
    this.body = h('div', { class: 'sf-custom__body' })
    this.tabs = h('div', { class: 'sf-tabs' })
    this.el = h(
      'section',
      { class: 'sf-screen sf-custom-screen is-hidden', 'aria-label': 'Personalización' },
      h(
        'div',
        { class: 'sf-card sf-panel sf-custom' },
        h('header', { class: 'sf-panel__head' }, h('h2', { class: 'sf-title', text: 'PERSONALIZACIÓN' }), h('button', { class: 'sf-btn sf-btn--ghost', type: 'button', onClick: () => ui.back() }, 'Volver')),
        this.tabs,
        this.body,
      ),
    )
    root.appendChild(this.el)
  }

  onShow() {
    this.tabs.replaceChildren(
      ...[
        ['character', 'Skater'],
        ['board', 'Tabla'],
      ].map(([id, l]) => h('button', { class: `sf-tab ${this.tab === id ? 'is-active' : ''}`, type: 'button', onClick: () => ((this.tab = id), this.ui.click(), this.onShow()) }, l)),
    )
    this._render()
  }

  _set(part, key, value) {
    this.game.actions.applyCustomization({ [part]: { [key]: value } })
    this.ui.click()
    this._render()
  }

  _swatches(part, key, colors) {
    const cur = this.game.save.data.customization[part][key]
    return h('div', { class: 'sf-swatches' }, ...colors.map((c) => h('button', { class: `sf-swatch ${c.toLowerCase() === String(cur).toLowerCase() ? 'is-active' : ''}`, type: 'button', title: c, style: { background: c }, onClick: () => this._set(part, key, c) })))
  }

  _choices(part, key, values, labels = {}) {
    const cur = this.game.save.data.customization[part][key]
    return h('div', { class: 'sf-choices' }, ...values.map((v) => h('button', { class: `sf-choice ${v === cur ? 'is-active' : ''}`, type: 'button', onClick: () => this._set(part, key, v) }, labels[v] || GRAPHIC_NAMES[v] || String(v))))
  }

  _row(label, control) {
    return h('div', { class: 'sf-row' }, h('span', { class: 'sf-row__label', text: label }), control)
  }

  _render() {
    const c = this.game.save.data.customization
    if (this.tab === 'character') {
      this.body.replaceChildren(
        this._row('Prenda superior', this._choices('character', 'top', O.top, { tee: 'Camiseta', hoodie: 'Sudadera' })),
        this._row('Color superior', this._swatches('character', 'topColor', O.topColors)),
        this._row('Gráfico', this._choices('character', 'topGraphic', O.topGraphics)),
        this._row('Pantalón', this._swatches('character', 'pantsColor', O.pantsColors)),
        this._row('Zapatillas', this._swatches('character', 'shoesColor', O.shoesColors)),
        this._row('Gorra', this._choices('character', 'cap', [true, false], { true: 'Con gorra', false: 'Sin gorra' })),
        c.character.cap ? this._row('Posición de la gorra', this._choices('character', 'capBackwards', [false, true], { false: 'Normal', true: 'Del revés' })) : null,
        c.character.cap ? this._row('Color de gorra', this._swatches('character', 'capColor', O.capColors)) : null,
        this._row('Pelo', this._swatches('character', 'hairColor', O.hairColors)),
        this._row(
          'Tono de piel',
          h('input', { type: 'range', class: 'sf-slider', min: 0, max: 1, step: 0.05, value: c.character.skinTone, onChange: (e) => this._set('character', 'skinTone', +e.target.value) }),
        ),
        this._row('Cadena', this._choices('character', 'chain', [true, false], { true: 'Sí', false: 'No' })),
        this._row('Tatuajes', this._choices('character', 'tattoos', [true, false], { true: 'Sí', false: 'No' })),
        this._row('Postura', this._choices('character', 'stance', ['regular', 'goofy'], { regular: 'Regular (izq. delante)', goofy: 'Goofy (der. delante)' })),
      )
    } else {
      this.body.replaceChildren(
        this._row('Gráfico del deck', this._choices('board', 'graphic', O.boardGraphics)),
        this._row('Lija', this._swatches('board', 'gripColor', O.gripColors)),
        this._row('Ruedas', this._swatches('board', 'wheelColor', O.wheelColors)),
        this._row('Trucks', this._swatches('board', 'truckColor', O.truckColors)),
        this._row('Bushings', this._swatches('board', 'bushingColor', O.bushingColors)),
      )
    }
  }
}
