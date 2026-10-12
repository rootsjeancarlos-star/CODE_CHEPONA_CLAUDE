import { KEY_ACTIONS, buildCodeMap, sanitizeBindings } from './InputBindings.js'

const INSTANT = new Set(KEY_ACTIONS.filter((a) => a.instant).map((a) => a.id))
const GAME_CODES = new Set(['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'])

function isFormTarget(t) {
  if (!t || !t.tagName) return false
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable
}

/**
 * Teclado: mantiene las acciones pulsadas y una cola de flancos (pulsar/soltar) por acción.
 * Las acciones "instant" (pausa, cámara, repetición, pantalla completa) llaman a onInstant al momento.
 */
export class KeyboardInput {
  /**
   * @param {{bindings?:Object, onInstant?:(action:string)=>void, onAny?:()=>void, target?:EventTarget}} o
   */
  constructor({ bindings = null, onInstant = null, onAny = null, target = typeof window !== 'undefined' ? window : null } = {}) {
    this.codeMap = new Map()
    this.setBindings(bindings)
    this.held = new Set() // acciones
    this.heldCodes = new Set()
    this.pressed = new Set() // flancos de bajada desde el último consume
    this.released = new Set()
    this.onInstant = onInstant
    this.onAny = onAny
    this.enabled = true
    this.target = target
    this._down = (e) => this._onDown(e)
    this._up = (e) => this._onUp(e)
    target?.addEventListener('keydown', this._down)
    target?.addEventListener('keyup', this._up)
  }

  setBindings(bindings) {
    buildCodeMap(sanitizeBindings(bindings || {}).bindings, this.codeMap)
  }

  _onDown(e) {
    if (isFormTarget(e.target)) return
    const action = this.codeMap.get(e.code)
    if (!action) return
    if (GAME_CODES.has(e.code) || action) e.preventDefault?.()
    if (e.repeat || this.heldCodes.has(e.code)) return
    this.heldCodes.add(e.code)
    this.onAny?.()
    if (INSTANT.has(action)) {
      this.onInstant?.(action)
      return
    }
    if (!this.enabled) return
    if (!this.held.has(action)) this.pressed.add(action)
    this.held.add(action)
  }

  _onUp(e) {
    if (!this.heldCodes.has(e.code)) return
    this.heldCodes.delete(e.code)
    const action = this.codeMap.get(e.code)
    if (!action || INSTANT.has(action)) return
    // otra tecla asignada a la misma acción puede seguir pulsada
    for (const c of this.heldCodes) if (this.codeMap.get(c) === action) return
    if (this.held.delete(action)) this.released.add(action)
  }

  isHeld(action) {
    return this.held.has(action)
  }

  clearEdges() {
    this.pressed.clear()
    this.released.clear()
  }

  releaseAll() {
    for (const a of this.held) this.released.add(a)
    this.held.clear()
    this.heldCodes.clear()
  }

  dispose() {
    this.target?.removeEventListener('keydown', this._down)
    this.target?.removeEventListener('keyup', this._up)
  }
}
