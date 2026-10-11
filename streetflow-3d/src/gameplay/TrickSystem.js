/**
 * STUB (WP-TRICKS lo reemplaza): interpreta la intención de truco según el estado del skater (TrickDatabase),
 * ejecuta la física del truco vía board.physics (startFlip, setAirSpin, beginManual…) y delega la verificación
 * en TrickRecognizer. API: handleIntent(intent, playerState, telemetry) → TrickRequest|null,
 * fixedUpdate(dt, telemetry, playerState), onLanding(landingResult), onBail(), reset(), recognizer, database
 */
export class TrickSystem {
  constructor({ bus, board }) {
    this.bus = bus
    this.board = board
  }
  handleIntent() {
    return null
  }
  fixedUpdate() {}
  onLanding() {}
  onBail() {}
  reset() {}
}
