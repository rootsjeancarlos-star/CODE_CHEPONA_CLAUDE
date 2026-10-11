import * as THREE from 'three/webgpu'
import { PHYSICS, SKATER } from '../core/Config.js'
import { DEFAULT_BOARD_SETUP, computeBoardGeometry } from '../skateboard/SkateboardSetup.js'

/** Telemetría vacía conforme al contrato (docs/ARCHITECTURE.md §7.3). */
export function createTelemetry() {
  return {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    velocity: new THREE.Vector3(),
    angularVelocity: new THREE.Vector3(),
    speed: 0,
    forwardSpeed: 0,
    grounded: true,
    wheelContacts: [true, true, true, true],
    contactCount: 4,
    groundNormal: new THREE.Vector3(0, 1, 0),
    surface: 'concrete',
    steerAngle: 0,
    lean: 0,
    crouch: 0,
    airTime: 0,
    takeoffHeight: 0,
    maxAirHeight: 0,
    accumulated: { bodyYaw: 0, bodyPitch: 0, bodyRoll: 0, boardRoll: 0, boardYaw: 0 },
    boardRelative: new THREE.Quaternion(),
    flipActive: false,
    stance: 'regular',
    isSwitch: false,
    manual: { active: false, type: null, balance: 0, time: 0 },
    grind: { active: false, type: null, spotId: null, balance: 0, time: 0, distance: 0 },
    lastLanding: { time: 0, impact: 0, quality: 1, clean: true, alignmentError: 0 },
    mode: 'arcade',
  }
}

/**
 * STUB (WP-PHYS lo reemplaza): cuerpo rígido rider+tabla con 4 rayos de suspensión (WheelContactSolver),
 * fricción lateral, pop/ollie, flips verificables, manuals y grinds. API completa en docs/ARCHITECTURE.md §7.3.
 */
export class SkateboardPhysics {
  constructor({ physics, bus, setup = DEFAULT_BOARD_SETUP }) {
    this.physics = physics
    this.bus = bus
    this.setup = setup
    this.geo = computeBoardGeometry(setup)
    this.telemetry = createTelemetry()
    const R = physics.RAPIER
    this.body = physics.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 0.2, 0).setLinearDamping(0.05).setAngularDamping(2))
    this.collider = physics.world.createCollider(
      R.ColliderDesc.cuboid(0.12, this.geo.deckTopHeight / 2, 0.4).setTranslation(0, -this.geo.deckTopHeight / 2, 0).setMass(SKATER.riderMass + SKATER.boardMass).setFriction(0.05).setCollisionGroups(PHYSICS.GROUP_SETS.skater),
      this.body,
    )
    this.prevPos = new THREE.Vector3()
    this.prevQuat = new THREE.Quaternion()
    this.mode = 'arcade'
  }

  setMode(m) {
    this.mode = m
    this.telemetry.mode = m
  }

  spawn(position, yaw = 0) {
    this.reset(position, yaw)
  }

  reset(position, yaw = 0) {
    const p = Array.isArray(position) ? { x: position[0], y: position[1], z: position[2] } : position
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    this.body.setTranslation({ x: p.x, y: p.y + this.geo.deckTopHeight + 0.01, z: p.z }, true)
    this.body.setRotation(q, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this._readState()
    this.prevPos.copy(this.telemetry.position)
    this.prevQuat.copy(this.telemetry.quaternion)
  }

  applyControls(dt, c) {
    this.prevPos.copy(this.telemetry.position)
    this.prevQuat.copy(this.telemetry.quaternion)
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.telemetry.quaternion)
    if (c.push) this.body.applyImpulse({ x: fwd.x * 90, y: 0, z: fwd.z * 90 }, true)
    if (c.steer) this.body.setAngvel({ x: 0, y: -c.steer * 1.8, z: 0 }, true)
    else this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
  }

  pop() {
    this.body.applyImpulse({ x: 0, y: 260, z: 0 }, true)
    return true
  }

  startFlip() {}
  catchBoard() {}
  setAirSpin() {}
  beginManual() {}
  endManual() {}
  attachGrind() {}
  detachGrind() {}
  bail() {}

  _readState() {
    const t = this.telemetry
    const p = this.body.translation()
    const q = this.body.rotation()
    const v = this.body.linvel()
    t.position.set(p.x, p.y, p.z)
    t.quaternion.set(q.x, q.y, q.z, q.w)
    t.velocity.set(v.x, v.y, v.z)
    t.speed = t.velocity.length()
    t.forwardSpeed = t.velocity.dot(new THREE.Vector3(0, 0, 1).applyQuaternion(t.quaternion))
  }

  postStep() {
    this._readState()
  }

  getTelemetry() {
    return this.telemetry
  }

  getInterpolatedTransform(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.telemetry.position, alpha)
    outQuat.slerpQuaternions(this.prevQuat, this.telemetry.quaternion, alpha)
  }

  dispose() {
    this.physics.world.removeRigidBody(this.body)
  }
}
