import { SKATER } from '../core/Config.js'

const DEG = Math.PI / 180

/** Tolerancias de aterrizaje por modo (radianes / m/s). */
export const LANDING_TOLERANCES = Object.freeze({
  arcade: { align: SKATER.modes.arcade.landingTolerance, yaw: 55 * DEG, flip: SKATER.modes.arcade.flipCatchTolerance, impact: 13 },
  realistic: { align: SKATER.modes.realistic.landingTolerance, yaw: 30 * DEG, flip: SKATER.modes.realistic.flipCatchTolerance, impact: 9.5 },
})

/**
 * Evalúa un aterrizaje a partir de la información medida por SkateboardPhysics (no de la entrada):
 * alineación tabla-suelo, yaw respecto a la marcha (permitiendo fakie), flip atrapado e impacto.
 */
export class LandingSystem {
  constructor({ bus } = {}) {
    this.bus = bus
    this.last = null
  }

  /**
   * @param {{alignmentError:number, yawError:number, flipActive:boolean, flipResidualRoll:number, flipResidualYaw:number, impactSpeed:number, airTime:number, surface:string, fakie?:boolean, vertAir?:boolean}} info
   * @param {'arcade'|'realistic'} mode
   * @returns {{clean:boolean, quality:number, bail:boolean, reason:?string, fakie:boolean}}
   */
  evaluate(info, mode = 'arcade') {
    const tol = LANDING_TOLERANCES[mode] || LANDING_TOLERANCES.arcade
    const roll = Math.abs(info.flipResidualRoll)
    const yawB = Math.abs(info.flipResidualYaw)
    let reason = null
    if (info.alignmentError > tol.align) reason = 'tabla torcida'
    else if (info.yawError > tol.yaw && !info.vertAir) reason = 'aterrizaje cruzado'
    else if (roll > tol.flip || yawB > tol.flip) reason = 'tabla sin atrapar'
    else if (info.impactSpeed > tol.impact) reason = 'impacto demasiado fuerte'
    const bail = reason !== null
    let quality = 0
    if (!bail) {
      quality =
        1 -
        0.45 * (info.alignmentError / tol.align) -
        0.25 * (info.vertAir ? 0 : info.yawError / tol.yaw) -
        0.2 * (Math.max(roll, yawB) / tol.flip) -
        0.1 * Math.max(0, (info.impactSpeed - 5) / (tol.impact - 5))
      quality = Math.min(1, Math.max(0, quality))
    }
    const result = { clean: !bail && quality >= 0.5, quality, bail, reason, fakie: !!info.fakie }
    this.last = result
    return result
  }
}
