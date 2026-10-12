import { CameraController } from './CameraController.js'

const REPLAY_MODES = ['follow', 'cinematic', 'free', 'orbit']

/**
 * Cámara de repeticiones: reutiliza la lógica de CameraController con un objetivo grabado y añade
 * el modo 'orbit' (órbita automática alrededor del skater).
 */
export class ReplayCamera extends CameraController {
  constructor(camera, opts) {
    super(camera, { ...opts, bus: null })
    this.mode = 'cinematic'
  }

  cycleMode() {
    const i = REPLAY_MODES.indexOf(this.mode)
    this.mode = REPLAY_MODES[(i + 1) % REPLAY_MODES.length]
    this._tripodAge = 99
    return this.mode
  }

  update(dt, target) {
    if (this.mode === 'orbit') {
      this.input?.takeLook?.({ x: 0, y: 0 })
      this._updateMenu(dt, target)
      this._apply(dt, target)
      return
    }
    super.update(dt, target)
  }
}
