/**
 * STUB (WP-REPLAY lo reemplaza): reproduce la grabación con interpolación (play/pausa/retroceso/cámara lenta)
 * y cámaras libre/cinemática; crea sus propios controles de UI. API: start(), stop(), update(dt), cycleCamera(), active
 */
export class ReplayPlayer {
  constructor({ game }) {
    this.game = game
    this.active = false
  }
  start() {
    this.active = true
  }
  stop() {
    this.active = false
  }
  update() {}
  cycleCamera() {}
}
