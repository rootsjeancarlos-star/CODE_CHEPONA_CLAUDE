/**
 * STUB (WP-INPUT lo reemplaza): normaliza teclado, ratón (Pointer Lock) y gamepad en un InputIntent
 * (docs/ARCHITECTURE.md §6). Emite `input:action` {action:'pause'|'camera'|'replay'|'fullscreen'} al instante.
 * API: consumeIntent(dt) (1 vez por paso fijo), update(frameDt) (cada fotograma: sondeo gamepad),
 *      requestPointerLock(), exitPointerLock(), releaseAll(), applySettings(controls), setEnabled(bool), dispose()
 */
export function createEmptyIntent() {
  return {
    steer: 0, throttle: 0, pushPressed: false, brake: 0, crouch: false, popPressed: false, nollie: false, modifier: false,
    flick: null, spin: 0, grind: false, grindPressed: false, manual: 0, manualPressed: false, qPressed: false,
    interactPressed: false, resetPressed: false, saveMarkerPressed: false, loadMarkerPressed: false,
    cameraPressed: false, replayPressed: false, pausePressed: false, look: { x: 0, y: 0 }, zoom: 0,
    analog: { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0 }, device: 'keyboard',
  }
}

export class InputManager {
  constructor({ canvas, bus, settings }) {
    this.canvas = canvas
    this.bus = bus
    this.settings = settings
    this.keys = new Set()
    this.intent = createEmptyIntent()
    this._edges = new Set()
    this._onDown = (e) => {
      if (!this.keys.has(e.code)) this._edges.add(e.code)
      this.keys.add(e.code)
      if (e.code === 'Escape') this.bus.emit('input:action', { action: 'pause' })
      if (e.code === 'KeyC') this.bus.emit('input:action', { action: 'camera' })
      if (e.code === 'KeyV') this.bus.emit('input:action', { action: 'replay' })
    }
    this._onUp = (e) => {
      this.keys.delete(e.code)
      if (e.code === 'Space') this._edges.add('Space:up')
    }
    window.addEventListener('keydown', this._onDown)
    window.addEventListener('keyup', this._onUp)
  }

  consumeIntent() {
    const i = this.intent
    const k = this.keys
    i.steer = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0)
    i.throttle = k.has('KeyW') ? 1 : 0
    i.pushPressed = this._edges.has('KeyW')
    i.brake = k.has('KeyS') ? 1 : 0
    i.crouch = k.has('Space')
    i.popPressed = this._edges.has('Space:up')
    i.resetPressed = this._edges.has('KeyR')
    this._edges.clear()
    return i
  }

  update() {}
  requestPointerLock() {}
  exitPointerLock() {}
  releaseAll() {
    this.keys.clear()
  }
  applySettings(s) {
    this.settings = s
  }
  setEnabled() {}
  dispose() {
    window.removeEventListener('keydown', this._onDown)
    window.removeEventListener('keyup', this._onUp)
  }
}
