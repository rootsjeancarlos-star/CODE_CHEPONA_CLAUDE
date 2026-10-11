/**
 * STUB (WP-TRICKS lo reemplaza): combos, multiplicador, penalización por repetición, puntuación total.
 * API: fixedUpdate(dt, telemetry, playerState), getState() → {active, tricks, baseScore, multiplier, total, score, lastTrick}, reset()
 */
export class ComboSystem {
  constructor({ bus }) {
    this.bus = bus
    this.state = { active: false, tricks: [], baseScore: 0, multiplier: 1, total: 0, score: 0, lastTrick: null }
  }
  fixedUpdate() {}
  getState() {
    return this.state
  }
  reset() {
    this.state.active = false
    this.state.tricks = []
    this.state.baseScore = 0
    this.state.multiplier = 1
    this.state.total = 0
  }
}
