import { KeyboardInput } from './KeyboardInput.js'
import { MouseInput } from './MouseInput.js'
import { GamepadInput, PAD } from './GamepadInput.js'

const ARROWS = { flickLeft: 'L', flickRight: 'R', flickUp: 'U', flickDown: 'D' }
const DIAGONAL_WINDOW = 0.07 // s de espera para combinar dos flechas en una diagonal

/** InputIntent vacío (docs/ARCHITECTURE.md §6). */
export function createEmptyIntent() {
  return {
    steer: 0, throttle: 0, pushPressed: false, brake: 0, crouch: false, popPressed: false, nollie: false, modifier: false,
    flick: null, spin: 0, grind: false, grindPressed: false, manual: 0, manualPressed: false, qPressed: false,
    interactPressed: false, resetPressed: false, saveMarkerPressed: false, loadMarkerPressed: false,
    cameraPressed: false, replayPressed: false, pausePressed: false, look: { x: 0, y: 0 }, zoom: 0,
    analog: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, device: 'keyboard',
  }
}

/** Combina direcciones de flecha en una dirección de flick ('L', 'DL'…). */
export function combineArrows(dirs) {
  const v = dirs.has('U') ? 'U' : dirs.has('D') ? 'D' : ''
  const h = dirs.has('L') ? 'L' : dirs.has('R') ? 'R' : ''
  const d = v + h
  return d || null
}

/**
 * Agrega teclado, ratón y mando en un InputIntent independiente del dispositivo.
 * - consumeIntent(dt): una vez por paso fijo; los flancos se acumulan entre pasos y se entregan una vez.
 * - update(frameDt): cada fotograma (sondeo del mando, flicks pendientes).
 * - Acciones de interfaz (pausa, cámara, repetición, pantalla completa) → bus 'input:action' al instante.
 */
export class InputManager {
  constructor({ canvas, bus, settings = {} }) {
    this.canvas = canvas
    this.bus = bus
    this.settings = settings
    this.enabled = true
    this.device = 'keyboard'
    this.intent = createEmptyIntent()
    this.edges = { push: false, pop: false, popNollie: false, flick: null, flickModifier: false, grind: false, manual: false, q: false, interact: false, reset: false, saveMarker: false, loadMarker: false }
    this._pendingArrow = null // {dirs:Set, t}
    this._look = { x: 0, y: 0 }
    this._padLook = { x: 0, y: 0 }
    this._zoom = 0
    this._crouchWasHeld = false

    const touch = (dev) => this._setDevice(dev)
    this.keyboard = new KeyboardInput({
      bindings: settings.keyboard,
      onInstant: (action) => this.bus?.emit('input:action', { action }),
      onAny: () => touch('keyboard'),
    })
    this.mouse = new MouseInput({ canvas, onAny: () => touch('keyboard') })
    this.gamepad = new GamepadInput({
      onConnect: (p) => {
        this.bus?.emit('input:gamepadConnected', p)
        this.bus?.emit('ui:notify', { text: 'Mando conectado', kind: 'info', duration: 2 })
      },
      onDisconnect: (p) => {
        this.bus?.emit('input:gamepadDisconnected', p)
        this.bus?.emit('ui:notify', { text: 'Mando desconectado', kind: 'warn', duration: 2.5 })
        this._setDevice('keyboard')
      },
    })
    this.applySettings(settings)
    this._uiRepeat = { dir: null, t: 0 }
  }

  _setDevice(dev) {
    if (this.device === dev) return
    this.device = dev
    this.bus?.emit('input:device', { device: dev })
  }

  applySettings(controls = {}) {
    this.settings = controls
    this.keyboard.setBindings(controls.keyboard)
    this.gamepad.deadzone = Math.min(0.5, Math.max(0.02, controls.gamepadDeadzone ?? 0.15))
    this.gamepad.sensitivity = controls.gamepadSensitivity ?? 1
  }

  setEnabled(v) {
    this.enabled = v
    this.keyboard.enabled = v
    if (!v) this.releaseAll()
  }

  requestPointerLock() {
    this.mouse.requestLock()
  }

  exitPointerLock() {
    this.mouse.exitLock()
  }

  releaseAll() {
    this.keyboard.releaseAll()
    this.keyboard.clearEdges()
    this.gamepad.releaseAll()
    this._pendingArrow = null
    this._crouchWasHeld = false
    for (const k of Object.keys(this.edges)) this.edges[k] = typeof this.edges[k] === 'boolean' ? false : null
  }

  /** Cada fotograma: recoge flancos de teclado/mando en los acumuladores. */
  update(frameDt) {
    const kb = this.keyboard
    const e = this.edges
    // --- Teclado ---
    for (const a of kb.pressed) {
      if (a === 'push') e.push = true
      else if (a === 'grind') e.grind = true
      else if (a === 'context') e.q = true
      else if (a === 'interact') e.interact = true
      else if (a === 'reset') e.reset = true
      else if (a === 'saveMarker') e.saveMarker = true
      else if (a === 'loadMarker') e.loadMarker = true
      else if (ARROWS[a]) {
        if (a === 'flickUp' || a === 'flickDown') e.manual = true
        const dir = ARROWS[a]
        if (this._pendingArrow) {
          this._pendingArrow.dirs.add(dir)
          this._emitFlick(combineArrows(this._pendingArrow.dirs))
        } else {
          const held = new Set()
          for (const [act, d] of Object.entries(ARROWS)) if (kb.isHeld(act)) held.add(d)
          if (held.size > 1) this._emitFlick(combineArrows(held))
          else this._pendingArrow = { dirs: held.size ? held : new Set([dir]), t: 0 }
        }
      }
    }
    for (const a of kb.released) {
      if (a === 'crouch' && (this._crouchWasHeld || kb.pressed.has('crouch'))) {
        e.pop = true
        e.popNollie = kb.isHeld('modifier')
        // flecha mantenida al soltar ESPACIO → flick en el mismo paso que el pop
        const held = new Set()
        for (const [act, d] of Object.entries(ARROWS)) if (kb.isHeld(act)) held.add(d)
        if (held.size) this._emitFlick(combineArrows(held))
      }
    }
    if (kb.isHeld('crouch')) this._crouchWasHeld = true
    else if (!kb.pressed.has('crouch')) this._crouchWasHeld = false
    kb.clearEdges()
    if (this._pendingArrow) {
      this._pendingArrow.t += frameDt
      if (this._pendingArrow.t >= DIAGONAL_WINDOW) this._emitFlick(combineArrows(this._pendingArrow.dirs))
    }

    // --- Ratón ---
    this.mouse.takeDelta(this._look)
    const sens = (this.settings.mouseSensitivity ?? 1) * 0.0025
    this.intent.look.x += this._look.x * sens
    this.intent.look.y += this._look.y * sens * (this.settings.invertY ? -1 : 1)
    this._zoom += this.mouse.takeWheel()

    // --- Mando ---
    const gp = this.gamepad
    if (gp.poll(frameDt)) this._setDevice('gamepad')
    if (gp.connected) {
      const P = gp.pressed
      if (P.has(PAD.A)) e.push = true
      if (P.has(PAD.X)) e.grind = true
      if (P.has(PAD.Y)) e.manual = true
      if (P.has(PAD.L3)) e.q = true
      if (P.has(PAD.R3)) this.bus?.emit('input:action', { action: 'camera' })
      if (P.has(PAD.START)) this.bus?.emit('input:action', { action: 'pause' })
      if (P.has(PAD.BACK)) this.bus?.emit('input:action', { action: 'replay' })
      if (P.has(PAD.UP)) e.manual = true
      if (P.has(PAD.DOWN)) e.manual = true
      // D-pad como flicks alternativos
      if (P.has(PAD.LEFT)) this._emitFlick('L')
      if (P.has(PAD.RIGHT)) this._emitFlick('R')
      const g = gp.gestureOut
      if (g.pop) {
        e.pop = true
        e.popNollie = g.nollie
      }
      if (g.flick) this._emitFlick(g.flick)
      if (!g.crouch && !g.pop && !g.flick) {
        const k = (gp.sensitivity || 1) * 2.6 * frameDt
        this.intent.look.x += g.look.x * k
        this.intent.look.y += g.look.y * k * (this.settings.invertY ? -1 : 1)
      }
      this._emitUiNav(frameDt)
      gp.clearEdges()
    }
  }

  _emitFlick(dir) {
    this._pendingArrow = null
    if (!dir) return
    this.edges.flick = dir
    this.edges.flickModifier = this.keyboard.isHeld('modifier') || this.gamepad.isHeld(PAD.LB) || this.gamepad.isHeld(PAD.RB)
  }

  /** Navegación de menús con el mando (con repetición al mantener). */
  _emitUiNav(dt) {
    const gp = this.gamepad
    const P = gp.pressed
    if (P.has(PAD.A)) this.bus?.emit('input:ui', { action: 'confirm' })
    if (P.has(PAD.B)) this.bus?.emit('input:ui', { action: 'back' })
    let dir = null
    if (gp.isHeld(PAD.UP) || gp.left.y < -0.6) dir = 'up'
    else if (gp.isHeld(PAD.DOWN) || gp.left.y > 0.6) dir = 'down'
    else if (gp.isHeld(PAD.LEFT) || gp.left.x < -0.6) dir = 'left'
    else if (gp.isHeld(PAD.RIGHT) || gp.left.x > 0.6) dir = 'right'
    const r = this._uiRepeat
    if (dir !== r.dir) {
      r.dir = dir
      r.t = 0
      if (dir) this.bus?.emit('input:ui', { action: dir })
    } else if (dir) {
      r.t += dt
      if (r.t > 0.38) {
        r.t = 0.26
        this.bus?.emit('input:ui', { action: dir })
      }
    }
  }

  /** Una vez por paso fijo. */
  consumeIntent() {
    const i = this.intent
    const kb = this.keyboard
    const gp = this.gamepad
    const e = this.edges
    const padOn = gp.connected
    const kSteer = (kb.isHeld('right') ? 1 : 0) - (kb.isHeld('left') ? 1 : 0)
    i.steer = clamp(kSteer + (padOn ? gp.left.x : 0))
    const lbrb = padOn ? (gp.isHeld(PAD.RB) ? 1 : 0) - (gp.isHeld(PAD.LB) ? 1 : 0) : 0
    i.spin = clamp(kSteer + (padOn ? gp.left.x : 0) + lbrb)
    i.throttle = Math.max(kb.isHeld('push') ? 1 : 0, padOn && gp.isHeld(PAD.A) ? 1 : 0)
    i.brake = Math.max(kb.isHeld('brake') ? 1 : 0, padOn && gp.isHeld(PAD.B) ? 1 : 0)
    i.modifier = kb.isHeld('modifier') || (padOn && (gp.isHeld(PAD.LB) || gp.isHeld(PAD.RB)))
    i.crouch = kb.isHeld('crouch') || (padOn && gp.gestureOut.crouch)
    i.grind = kb.isHeld('grind') || (padOn && gp.isHeld(PAD.X))
    const mUp = kb.isHeld('flickUp') || (padOn && (gp.isHeld(PAD.UP) || gp.isHeld(PAD.Y)))
    const mDown = kb.isHeld('flickDown') || (padOn && gp.isHeld(PAD.DOWN))
    i.manual = (mUp ? 1 : 0) - (mDown ? 1 : 0)
    // flancos
    i.pushPressed = e.push
    i.popPressed = e.pop
    i.nollie = e.pop ? e.popNollie || i.modifier : false
    i.flick = e.flick
    if (e.flick) i.modifier = i.modifier || e.flickModifier
    i.grindPressed = e.grind
    i.manualPressed = e.manual && i.manual !== 0
    i.qPressed = e.q
    i.interactPressed = e.interact
    i.resetPressed = e.reset
    i.saveMarkerPressed = e.saveMarker
    i.loadMarkerPressed = e.loadMarker
    i.cameraPressed = false
    i.replayPressed = false
    i.pausePressed = false
    i.zoom = this._zoom
    this._zoom = 0
    const a = i.analog
    a.lx = padOn ? gp.left.x : 0
    a.ly = padOn ? gp.left.y : 0
    a.rx = padOn ? gp.right.x : 0
    a.ry = padOn ? gp.right.y : 0
    a.lt = padOn ? gp.lt : 0
    a.rt = padOn ? gp.rt : 0
    i.device = this.device
    for (const k of Object.keys(e)) e[k] = typeof e[k] === 'boolean' ? false : null
    return i
  }

  /** La cámara consume el delta de mirada acumulado (independiente del paso fijo). */
  takeLook(out) {
    out.x = this.intent.look.x
    out.y = this.intent.look.y
    this.intent.look.x = 0
    this.intent.look.y = 0
    return out
  }

  dispose() {
    this.keyboard.dispose()
    this.mouse.dispose()
    this.gamepad.dispose()
  }
}

function clamp(v) {
  return v > 1 ? 1 : v < -1 ? -1 : v
}
