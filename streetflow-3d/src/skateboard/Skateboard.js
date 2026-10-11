import * as THREE from 'three/webgpu'
import { SkateboardPhysics } from '../physics/SkateboardPhysics.js'
import { SkateboardVisual } from './SkateboardVisual.js'
import { DEFAULT_BOARD_SETUP } from './SkateboardSetup.js'

/**
 * Compone la física del skater (SkateboardPhysics) y el modelo visual (SkateboardVisual),
 * sincronizando el visual con la transformación interpolada. Ver docs/ARCHITECTURE.md §11.
 * API: physics, visual, spawn(spawn), setMode(m), updateVisual(frameDt, alpha), getTelemetry(),
 *      getInterpolatedTransform(alpha, pos, quat), applyCustomization(c), setAttached(bool), dispose()
 */
export class Skateboard {
  constructor({ physics, bus, sceneManager, materials, customization, setup = DEFAULT_BOARD_SETUP }) {
    this.bus = bus
    this.sceneManager = sceneManager
    this.physics = new SkateboardPhysics({ physics, bus, setup })
    this.visual = new SkateboardVisual({ setup, materials, customization })
    sceneManager.actors.add(this.visual.object3d)
    this._pos = new THREE.Vector3()
    this._quat = new THREE.Quaternion()
    /** Si la tabla está bajo el control del cuerpo del skater (false = tabla suelta tras caída / caminando) */
    this.attached = true
  }

  spawn({ position, yaw = 0 }) {
    this.physics.spawn(position, yaw)
    this.attached = true
  }

  setMode(m) {
    this.physics.setMode(m)
  }

  setAttached(v) {
    this.attached = v
  }

  getTelemetry() {
    return this.physics.getTelemetry()
  }

  getInterpolatedTransform(alpha, outPos, outQuat) {
    this.physics.getInterpolatedTransform(alpha, outPos, outQuat)
  }

  updateVisual(frameDt, alpha) {
    this.physics.getInterpolatedTransform(alpha, this._pos, this._quat)
    this.visual.object3d.position.copy(this._pos)
    this.visual.object3d.quaternion.copy(this._quat)
    const t = this.physics.getTelemetry()
    this.visual.update(frameDt, t)
  }

  applyCustomization(c) {
    this.visual.applyCustomization(c)
  }

  dispose() {
    this.sceneManager.actors.remove(this.visual.object3d)
    this.visual.dispose()
    this.physics.dispose()
  }
}
