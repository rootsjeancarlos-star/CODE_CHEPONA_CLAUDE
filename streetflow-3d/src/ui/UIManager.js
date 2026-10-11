/**
 * STUB (WP-UI lo reemplaza): gestiona pantallas (main, pause, settings, customization, challenges, replay, editor),
 * HUD, LoadingScreen, notificaciones (`ui:notify`) y errores fatales.
 * API: loading {show(), hide(), setProgress(phase, f, label)}, showScreen(id|null), currentScreen, back(),
 *      update(dt, frameInfo), showFatalError(message, err), hud
 */
export class UIManager {
  constructor({ root, bus, game }) {
    this.root = root
    this.bus = bus
    this.game = game
    this.currentScreen = null
    const load = document.createElement('div')
    load.className = 'sf-loading'
    load.style.cssText = 'position:absolute;inset:0;display:grid;place-content:center;background:#0a0d12;color:#fff;font:600 18px system-ui'
    load.textContent = 'STREETFLOW 3D — cargando…'
    root.appendChild(load)
    this.loading = {
      show: () => (load.style.display = 'grid'),
      hide: () => (load.style.display = 'none'),
      setProgress: (phase, f, label) => (load.textContent = `STREETFLOW 3D — ${label || phase} ${Math.round(f * 100)}%`),
    }
    this.menu = document.createElement('div')
    this.menu.className = 'sf-menu-stub'
    this.menu.style.cssText = 'position:absolute;left:40px;top:40px;display:grid;gap:8px'
    const b = document.createElement('button')
    b.textContent = 'JUGAR'
    b.dataset.action = 'play'
    b.addEventListener('click', () => game.actions.play('skatepark'))
    this.menu.appendChild(b)
    this.menu.hidden = true
    root.appendChild(this.menu)
    this.hud = { update() {} }
  }

  showScreen(id) {
    this.currentScreen = id
    this.menu.hidden = id !== 'main'
  }

  back() {}

  update() {}

  showFatalError(message) {
    const box = document.createElement('div')
    box.className = 'sf-fatal'
    box.setAttribute('role', 'alert')
    box.innerHTML = '<h1>STREETFLOW 3D</h1><p></p><button type="button">Recargar</button>'
    box.querySelector('p').textContent = message
    box.querySelector('button').addEventListener('click', () => location.reload())
    this.root.appendChild(box)
  }
}
