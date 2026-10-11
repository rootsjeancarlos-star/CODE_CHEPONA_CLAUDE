/**
 * STUB (WP-PHYS lo reemplaza): minijuego de equilibrio para grinds (lateral) y manuals (pitch).
 * API: start(kind, difficulty), update(dt, correctionInput) → value -1..1, value, isLost(), stop()
 */
export class BalanceSystem {
  constructor() {
    this.value = 0
    this.active = false
  }
  start() {
    this.active = true
    this.value = 0
  }
  update() {
    return this.value
  }
  isLost() {
    return false
  }
  stop() {
    this.active = false
  }
}
