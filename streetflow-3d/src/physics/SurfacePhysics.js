import { getSurface, SURFACES } from '../data/surfaces.js'

/** Acceso a las propiedades físicas de superficie, con ajustes por modo. */
export const SurfacePhysics = {
  get(id) {
    return getSurface(id)
  },
  /** Multiplicador de velocidad máxima/empuje por superficie. */
  speedFactor(id) {
    return getSurface(id).speedFactor
  },
  isGrindable(id) {
    return id in SURFACES && id !== 'grass' && id !== 'dirt'
  },
}
