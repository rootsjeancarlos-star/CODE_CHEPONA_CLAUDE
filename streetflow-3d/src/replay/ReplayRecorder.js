/**
 * STUB (WP-REPLAY lo reemplaza): búfer circular de instantáneas a 30 Hz (60 s) del skater, la tabla,
 * el estado de animación y los eventos de truco. API: record(dt, game), clear(), hasData(), getFrames(), duration
 */
export class ReplayRecorder {
  constructor({ bus }) {
    this.bus = bus
  }
  record() {}
  clear() {}
  hasData() {
    return false
  }
}
