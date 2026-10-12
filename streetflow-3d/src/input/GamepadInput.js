import { GestureRecognizer } from './GestureRecognizer.js'

/** Índices del mapeo "standard" de la Gamepad API. */
export const PAD = Object.freeze({ A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 })

/** Zona muerta radial con reescalado y curva de respuesta. */
export function radialDeadzone(x, y, deadzone, out = { x: 0, y: 0 }, exponent = 1.3) {
  const m = Math.hypot(x, y)
  if (!(m > deadzone)) {
    out.x = 0
    out.y = 0
    return out
  }
  const nm = Math.min(1, (m - deadzone) / (1 - deadzone))
  const curved = Math.pow(nm, exponent)
  out.x = (x / m) * curved
  out.y = (y / m) * curved
  return out
}

/**
 * Mando (Gamepad API). Se sondea cada fotograma: ejes con zona muerta, flancos de botones y el
 * reconocedor de gestos del stick derecho (flick). El juego funciona sin mando.
 */
export class GamepadInput {
  constructor({ onConnect = null, onDisconnect = null } = {}) {
    this.index = -1
    this.id = null
    this.deadzone = 0.15
    this.sensitivity = 1
    this.left = { x: 0, y: 0 }
    this.right = { x: 0, y: 0 }
    this.lt = 0
    this.rt = 0
    this.buttons = new Array(17).fill(false)
    this.pressed = new Set()
    this.released = new Set()
    this.gesture = new GestureRecognizer()
    this.gestureOut = this.gesture.out
    this.active = false
    this.lastActivity = 0
    this.onConnect = onConnect
    this.onDisconnect = onDisconnect
    this._conn = (e) => {
      if (this.index < 0) this._attach(e.gamepad)
    }
    this._disc = (e) => {
      if (e.gamepad.index === this.index) {
        const id = this.id
        this.index = -1
        this.id = null
        this.releaseAll()
        this.onDisconnect?.({ id, index: e.gamepad.index })
      }
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', this._conn)
      window.addEventListener('gamepaddisconnected', this._disc)
    }
  }

  _attach(gp) {
    if (!gp) return
    this.index = gp.index
    this.id = gp.id
    this.onConnect?.({ id: gp.id, index: gp.index })
  }

  get connected() {
    return this.index >= 0
  }

  /** Sondea el mando (cada fotograma). @returns {boolean} si hubo actividad */
  poll(dt) {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return false
    const pads = navigator.getGamepads()
    let gp = this.index >= 0 ? pads[this.index] : null
    if (!gp) {
      for (const p of pads) {
        if (p && p.connected) {
          this._attach(p)
          gp = p
          break
        }
      }
    }
    if (!gp) return false
    const ax = gp.axes
    radialDeadzone(ax[0] || 0, ax[1] || 0, this.deadzone, this.left)
    radialDeadzone(ax[2] || 0, ax[3] || 0, this.deadzone, this.right)
    let activity = this.left.x !== 0 || this.left.y !== 0 || this.right.x !== 0 || this.right.y !== 0
    for (let i = 0; i < this.buttons.length; i++) {
      const b = gp.buttons[i]
      const down = !!b && (b.pressed || b.value > 0.5)
      if (down && !this.buttons[i]) this.pressed.add(i)
      if (!down && this.buttons[i]) this.released.add(i)
      if (down) activity = true
      this.buttons[i] = down
    }
    this.lt = gp.buttons[PAD.LT]?.value || 0
    this.rt = gp.buttons[PAD.RT]?.value || 0
    this.gesture.update(dt, this.right.x, this.right.y)
    this.active = activity
    return activity
  }

  isHeld(i) {
    return this.buttons[i]
  }

  clearEdges() {
    this.pressed.clear()
    this.released.clear()
  }

  releaseAll() {
    this.buttons.fill(false)
    this.clearEdges()
    this.gesture.reset()
    this.left.x = this.left.y = this.right.x = this.right.y = 0
  }

  dispose() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('gamepadconnected', this._conn)
      window.removeEventListener('gamepaddisconnected', this._disc)
    }
  }
}
