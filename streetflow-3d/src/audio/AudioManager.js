/**
 * STUB (WP-AUDIO lo reemplaza): Web Audio con síntesis procedural original (rodadura por superficie,
 * pop, aterrizaje, grind, viento, ambiente, UI, música procedural). Se desbloquea tras un gesto del usuario.
 * API: unlock(), update(dt, telemetry, listenerObject3D, appState), applySettings(audio), setScene('menu'|'park'|'city'), playUi(name), dispose()
 */
export class AudioManager {
  constructor({ bus, settings }) {
    this.bus = bus
    this.settings = settings
    this.unlocked = false
  }
  unlock() {
    this.unlocked = true
  }
  update() {}
  applySettings(s) {
    this.settings = s
  }
  setScene() {}
  playUi() {}
  dispose() {}
}
