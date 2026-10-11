/**
 * STUB (WP-PHYS lo reemplaza): evalúa aterrizajes (alineación tabla-suelo, yaw vs velocidad, flip atrapado,
 * impacto) con tolerancias por modo y emite `skater:land`. API: evaluate(telemetry, mode) → {clean, quality, bail, reason}
 */
export class LandingSystem {
  constructor({ bus }) {
    this.bus = bus
  }
  evaluate() {
    return { clean: true, quality: 1, bail: false, reason: null }
  }
}
