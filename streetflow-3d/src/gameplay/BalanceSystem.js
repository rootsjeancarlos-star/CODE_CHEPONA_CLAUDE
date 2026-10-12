/**
 * Minijuego de equilibrio para grinds (lateral) y manuals (pitch).
 * El valor deriva de forma inestable (péndulo invertido simplificado) y el jugador lo corrige.
 * value ∈ [-1, 1]; |value| ≥ 1 → equilibrio perdido.
 */
export class BalanceSystem {
  constructor() {
    this.value = 0
    this.velocity = 0
    this.active = false
    this.kind = null
    this.difficulty = 1
    this.time = 0
    this._seed = 1
  }

  /**
   * @param {'grind'|'manual'} kind
   * @param {number} difficulty 0.3 (fácil) … 1.5 (difícil)
   * @param {number} [initial] desequilibrio inicial (p.ej. según la calidad de la entrada)
   */
  start(kind, difficulty = 1, initial = 0) {
    this.active = true
    this.kind = kind
    this.difficulty = difficulty
    this.value = initial
    this.velocity = 0
    this.time = 0
  }

  _noise() {
    // LCG determinista: la deriva no depende de Math.random (repeticiones/tests)
    this._seed = (this._seed * 1664525 + 1013904223) % 4294967296
    return this._seed / 4294967296 - 0.5
  }

  /**
   * @param {number} dt
   * @param {number} correction entrada del jugador −1..1 (A/D en grind, ↓/↑ o S/W en manual)
   * @returns {number} value
   */
  update(dt, correction = 0) {
    if (!this.active) return 0
    this.time += dt
    const d = this.difficulty
    // inestabilidad que crece con el tiempo sostenido
    const instability = (1.6 + Math.min(2.5, this.time * 0.35)) * d
    const accel = this.value * instability * 2.2 + this._noise() * 3.2 * d - correction * 5.5 - this.velocity * 1.4
    this.velocity += accel * dt
    this.value += this.velocity * dt
    if (this.value > 1.2) this.value = 1.2
    if (this.value < -1.2) this.value = -1.2
    return this.value
  }

  isLost() {
    return this.active && Math.abs(this.value) >= 1
  }

  stop() {
    this.active = false
    this.kind = null
  }
}
