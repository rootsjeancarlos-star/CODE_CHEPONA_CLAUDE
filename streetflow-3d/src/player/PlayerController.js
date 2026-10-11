import * as THREE from 'three/webgpu'

/** Estados del skater (docs/ARCHITECTURE.md §7 y prompt maestro §7). */
export const PLAYER_STATES = Object.freeze({
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  RUNNING: 'RUNNING',
  MOUNTING_BOARD: 'MOUNTING_BOARD',
  SKATING: 'SKATING',
  PUSHING: 'PUSHING',
  BRAKING: 'BRAKING',
  CROUCHING: 'CROUCHING',
  POPPING: 'POPPING',
  AIRBORNE: 'AIRBORNE',
  TRICKING: 'TRICKING',
  GRINDING: 'GRINDING',
  MANUAL: 'MANUAL',
  LANDING: 'LANDING',
  FALLING: 'FALLING',
  RECOVERING: 'RECOVERING',
})

/**
 * STUB (WP-PHYS lo reemplaza): FSM del skater que traduce el InputIntent en controles de la tabla,
 * pide trucos al TrickSystem, gestiona grinds/manuals/caídas/caminar y produce el contexto de animación.
 * API: spawn({position,yaw}), setMode(m), setStance(s), fixedUpdate(dt, intent), postPhysics(dt),
 *      getTelemetry(), state, getAnimationContext(alpha), getCameraTarget(alpha), getDebugInfo()
 */
export class PlayerController {
  constructor({ bus, physics, board, tricks, grind, balance, landing, respawn, settings, stance = 'regular' }) {
    this.bus = bus
    this.physics = physics
    this.board = board
    this.tricks = tricks
    this.settings = settings
    this.stance = stance
    this.state = PLAYER_STATES.IDLE
    this._ctx = {
      state: this.state,
      telemetry: null,
      intent: null,
      stance,
      rootPosition: new THREE.Vector3(),
      rootQuaternion: new THREE.Quaternion(),
      boardAttached: true,
      footAnchors: null,
      crouch: 0,
      lean: 0,
      pushPhase: 0,
    }
    this._camTarget = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), forward: new THREE.Vector3(), grounded: true, state: this.state }
    this._stanceQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), stance === 'goofy' ? Math.PI / 2 : -Math.PI / 2)
  }

  spawn({ position, yaw = 0 }) {
    this.board.spawn({ position, yaw })
    this.state = PLAYER_STATES.SKATING
  }

  setMode(m) {
    this.board.setMode(m)
  }

  setStance(s) {
    this.stance = s
  }

  fixedUpdate(dt, intent) {
    this._intent = intent
    this.board.physics.applyControls(dt, { steer: intent.steer, push: intent.pushPressed, brake: intent.brake })
    if (intent.popPressed) this.board.physics.pop({})
  }

  postPhysics(dt) {
    this.board.physics.postStep(dt)
  }

  getTelemetry() {
    return this.board.getTelemetry()
  }

  getAnimationContext(alpha) {
    const c = this._ctx
    this.board.getInterpolatedTransform(alpha, c.rootPosition, c.rootQuaternion)
    c.rootQuaternion.multiply(this._stanceQuat)
    c.state = this.state
    c.telemetry = this.getTelemetry()
    c.intent = this._intent
    return c
  }

  getCameraTarget(alpha) {
    const t = this._camTarget
    this.board.getInterpolatedTransform(alpha, t.position, t.quaternion)
    const tel = this.getTelemetry()
    t.velocity.copy(tel.velocity)
    t.forward.set(0, 0, 1).applyQuaternion(t.quaternion)
    t.grounded = tel.grounded
    t.state = this.state
    return t
  }

  getDebugInfo() {
    const t = this.getTelemetry()
    return { estado: this.state, vel: t.speed * 3.6 }
  }
}
