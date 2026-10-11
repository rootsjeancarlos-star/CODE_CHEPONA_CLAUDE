/**
 * STUB (WP-TRICKS lo reemplaza): desafíos (data/challenges.js), progreso persistido, spots descubiertos y tutoriales.
 * API: fixedUpdate(dt, telemetry, playerState), list() → [{...challenge, progress, completed}], getActiveObjective(), reset()
 */
export class ChallengeManager {
  constructor({ bus, save, spots }) {
    this.bus = bus
    this.save = save
    this.spots = spots
  }
  fixedUpdate() {}
  list() {
    return []
  }
  getActiveObjective() {
    return null
  }
}
