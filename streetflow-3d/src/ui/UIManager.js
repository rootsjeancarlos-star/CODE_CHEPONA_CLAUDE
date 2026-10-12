import { h } from './dom.js'
import { LoadingScreen } from './LoadingScreen.js'
import { MainMenu } from './MainMenu.js'
import { PauseMenu } from './PauseMenu.js'
import { SettingsMenu } from './SettingsMenu.js'
import { CustomizationMenu } from './CustomizationMenu.js'
import { ChallengesMenu } from './ChallengesMenu.js'
import { HUD } from './HUD.js'
import { Notifications } from './Notifications.js'

/**
 * Gestor de pantallas (docs/ARCHITECTURE.md §14): main, pause, settings, customization, challenges,
 * replay y editor (estas dos crean su propia interfaz), HUD durante el juego, avisos y errores fatales.
 * Navegación con teclado (Tab/Intro, Esc vuelve) y con mando (bus 'input:ui').
 */
export class UIManager {
  constructor({ root, bus, game }) {
    this.root = root
    this.bus = bus
    this.game = game
    this.currentScreen = null
    this.history = []
    this.loading = new LoadingScreen(root)
    this.hud = new HUD({ root, game, bus })
    const ctx = { root, game, ui: this }
    this.screens = {
      main: new MainMenu(ctx),
      pause: new PauseMenu(ctx),
      settings: new SettingsMenu(ctx),
      customization: new CustomizationMenu(ctx),
      challenges: new ChallengesMenu(ctx),
    }
    this.notifications = new Notifications(root, bus)
    this._offs = []
    if (bus?.on) this._offs.push(bus.on('input:ui', (e) => this._onPadNav(e.action)))
  }

  hover() {
    this.game.audio?.playUi?.('hover')
  }

  click() {
    this.game.audio?.playUi?.('click')
  }

  /** @param {string|null} id */
  showScreen(id) {
    const prev = this.currentScreen
    if (prev && prev !== id && this.screens[prev]) {
      this.screens[prev].el.classList.add('is-hidden')
      this.screens[prev].onHide?.()
    }
    // historial para back(): main/pause son raíces
    if (id === 'main' || id === 'pause' || id === null || id === 'replay' || id === 'editor') this.history = []
    else if (prev && prev !== id) this.history.push(prev)
    this.currentScreen = id
    const scr = id ? this.screens[id] : null
    if (scr) {
      scr.el.classList.remove('is-hidden')
      scr.onShow?.()
      requestAnimationFrame(() => this._focusFirst(scr.el))
    }
    this.hud.setVisible(id === null && this.game.state?.is?.('PLAYING'))
  }

  /** Vuelve a la pantalla anterior (o al menú/pausa). */
  back() {
    const cur = this.currentScreen
    if (cur === 'main' || cur === null) return
    if (cur === 'pause') {
      this.game.actions.resume()
      return
    }
    const prev = this.history.pop() || (this.game.state?.is?.('PAUSED') ? 'pause' : 'main')
    this.click()
    this.showScreen(prev)
  }

  _focusables(el) {
    return [...el.querySelectorAll('button:not([disabled]), select, input')].filter((x) => x.offsetParent !== null)
  }

  _focusFirst(el) {
    if (this.game.input?.device !== 'gamepad') return
    this._focusables(el)[0]?.focus({ preventScroll: true })
  }

  _onPadNav(action) {
    const scr = this.currentScreen && this.screens[this.currentScreen]
    if (!scr) return
    const items = this._focusables(scr.el)
    if (!items.length) return
    let i = items.indexOf(document.activeElement)
    if (action === 'down' || action === 'right') i = (i + 1) % items.length
    else if (action === 'up' || action === 'left') i = (i - 1 + items.length) % items.length
    else if (action === 'confirm') {
      const el = document.activeElement
      if (el && items.includes(el)) el.click()
      return
    } else if (action === 'back') {
      this.back()
      return
    }
    items[Math.max(0, i)].focus({ preventScroll: true })
    this.hover()
  }

  update(dt, frameInfo) {
    if (this.currentScreen === null && frameInfo.state === 'PLAYING') this.hud.update(dt, frameInfo)
  }

  showFatalError(message, err) {
    const box = h(
      'div',
      { class: 'sf-fatal', role: 'alert' },
      h('h1', { class: 'sf-logo' }, 'STREETFLOW ', h('span', { class: 'sf-logo__badge' }, '3D')),
      h('p', { text: message }),
      err?.message ? h('details', { class: 'sf-fatal__details' }, h('summary', { text: 'Detalles técnicos' }), h('code', { text: String(err.message) })) : null,
      h('button', { type: 'button', onClick: () => location.reload() }, 'Recargar'),
    )
    this.loading.hide()
    this.root.appendChild(box)
  }

  dispose() {
    this._offs.forEach((o) => o?.())
  }
}
