/**
 * STUB (WP-PHYS lo reemplaza): detección de grinds/slides contra SpotRegistry, selección de tipo
 * por ángulo y entrada, enganche/desenganche con SkateboardPhysics (GrindPhysics) y equilibrio.
 * API: tryCapture(telemetry, intent, mode) → GrindInfo|null, update(dt, telemetry, intent) → 'continue'|'exit'|'bail', active, current, reset()
 */
export class GrindSystem {
  constructor({ bus, spots, board, balance }) {
    this.bus = bus
    this.spots = spots
    this.board = board
    this.balance = balance
    this.active = false
    this.current = null
  }
  tryCapture() {
    return null
  }
  update() {
    return 'exit'
  }
  reset() {
    this.active = false
    this.current = null
  }
}
