import { Vector3, Quaternion } from 'three/webgpu'
import { PHYSICS, SKATER } from '../core/Config.js'

const _move = new Vector3()
const _Y = new Vector3(0, 1, 0)

/**
 * Modo caminar: cápsula cinemática movida con el KinematicCharacterController de Rapier
 * (pendientes, escalones bajos y ajuste al suelo). Controles tipo tanque: A/D giran, W/S avanzan, SHIFT corre.
 */
export class WalkingController {
  constructor({ physics }) {
    this.physics = physics
    const R = physics.RAPIER
    this.radius = 0.28
    this.halfHeight = 0.6
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100, 0).setEnabled(false))
    this.collider = physics.world.createCollider(
      R.ColliderDesc.capsule(this.halfHeight, this.radius).setCollisionGroups(PHYSICS.GROUP_SETS.skater),
      this.body,
    )
    physics.setColliderData(this.collider, { kind: 'walker', surface: 'concrete' })
    this.controller = physics.world.createCharacterController(0.02)
    this.controller.enableAutostep(0.22, 0.2, false)
    this.controller.enableSnapToGround(0.3)
    this.controller.setMaxSlopeClimbAngle(40 * (Math.PI / 180))
    this.controller.setApplyImpulsesToDynamicBodies(true)
    this.active = false
    this.heading = 0
    this.speed = 0
    this.verticalVel = 0
    this.grounded = true
    this.position = new Vector3()
    this.prevPosition = new Vector3()
    this.quaternion = new Quaternion()
  }

  /** @param {Vector3} feet posición de los pies (suelo) */
  enable(feet, heading) {
    this.active = true
    this.heading = heading
    this.speed = 0
    this.verticalVel = 0
    this.body.setEnabled(true)
    const y = feet.y + this.halfHeight + this.radius + 0.02
    this.body.setTranslation({ x: feet.x, y, z: feet.z }, true)
    this.body.setNextKinematicTranslation({ x: feet.x, y, z: feet.z })
    this.position.set(feet.x, feet.y, feet.z)
    this.prevPosition.copy(this.position)
    this.quaternion.setFromAxisAngle(_Y, heading)
  }

  disable() {
    this.active = false
    this.body.setEnabled(false)
  }

  /**
   * @param {number} dt
   * @param {{steer:number, throttle:number, brake:number, modifier:boolean}} intent
   */
  update(dt, intent) {
    if (!this.active) return
    this.prevPosition.copy(this.position)
    this.heading -= (intent.steer || 0) * 2.6 * dt
    const run = !!intent.modifier
    const want = ((intent.throttle || 0) - (intent.brake || 0) * 0.6) * (run ? SKATER.runSpeed : SKATER.walkSpeed)
    this.speed += (want - this.speed) * Math.min(1, dt * 8)
    this.verticalVel = this.grounded ? -1 : this.verticalVel + PHYSICS.gravity.y * dt
    _move.set(Math.sin(this.heading) * this.speed * dt, this.verticalVel * dt, Math.cos(this.heading) * this.speed * dt)
    this.controller.computeColliderMovement(this.collider, _move, undefined, PHYSICS.GROUP_SETS.wheelRay)
    const m = this.controller.computedMovement()
    this.grounded = this.controller.computedGrounded()
    const t = this.body.translation()
    const nx = t.x + m.x
    const ny = t.y + m.y
    const nz = t.z + m.z
    this.body.setNextKinematicTranslation({ x: nx, y: ny, z: nz })
    this.position.set(nx, ny - this.halfHeight - this.radius, nz)
    this.quaternion.setFromAxisAngle(_Y, this.heading)
  }

  getInterpolated(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPosition, this.position, alpha)
    outQuat.copy(this.quaternion)
  }

  dispose() {
    this.physics.world.removeRigidBody(this.body)
  }
}
