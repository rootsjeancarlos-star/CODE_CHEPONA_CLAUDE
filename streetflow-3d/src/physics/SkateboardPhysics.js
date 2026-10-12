import { Vector3, Quaternion } from 'three/webgpu'
import { PHYSICS, SKATER } from '../core/Config.js'
import { DEFAULT_BOARD_SETUP, computeBoardGeometry } from '../skateboard/SkateboardSetup.js'
import { WheelContactSolver } from './WheelContactSolver.js'
import { GrindPhysics } from './GrindPhysics.js'

/**
 * Física del skater: un único cuerpo rígido dinámico rider+tabla sostenido por 4 rayos de rueda
 * (WheelContactSolver) más un grado de libertad de truco de la tabla relativo al cuerpo (boardRelative).
 * Ver docs/ARCHITECTURE.md §7.3 y docs/PHYSICS.md.
 *
 * Marco del cuerpo = marco del rider: +Z = hacia donde apunta el pie delantero (nariz "natural"),
 * +Y arriba, origen = centro del deck en la cara superior. Tras un shove-it la tabla visual queda girada
 * 180° (boardRelative con yaw π): la física no cambia porque la tabla es simétrica.
 */

const G = -PHYSICS.gravity.y
const TAU = Math.PI * 2
const DEG = Math.PI / 180

/** Parámetros del núcleo y de asistencia por modo (la asistencia está separada del núcleo). */
export const SKATE_PARAMS = Object.freeze({
  mass: SKATER.riderMass + SKATER.boardMass,
  comY: SKATER.centerOfMass.y,
  inertia: Object.freeze({ x: 9, y: 2, z: 9 }),
  pushCycle: 0.62, // s por patada
  pushKickAt: 0.26, // instante del impulso dentro del ciclo
  brakeDecel: 4.2, // m/s²
  steerResponse: 10, // 1/s
  airDensity: 1.2, // kg/m³ (resistencia aerodinámica del rider: F = ½·ρ·CdA·v²)
  airMinTime: 0.12, // aire mínimo para evaluar un aterrizaje
  coyoteTime: 0.1,
  popChargeTime: 0.35,
  popPitchDeg: 26,
  airborneGraceSteps: 3, // pasos sin contacto antes de considerar "en el aire"
  tumbleUpY: 0.25, // up.y por debajo del cual se considera volcado
  modes: Object.freeze({
    arcade: Object.freeze({
      pushStrength: 1.9,
      aLatMax: 8.5,
      alignScale: 1.25,
      airAlignScale: 1.0,
      spinRate: SKATER.modes.arcade.spinRate,
      airControl: 9, // 1/s convergencia de la velocidad de giro en el aire
      ollieHeight: SKATER.modes.arcade.ollieHeight,
      landingMagnet: true,
      vertAssist: true,
      flipAssist: true,
      rollingScale: 0.85,
      dragArea: 0.32, // CdA m²
    }),
    realistic: Object.freeze({
      pushStrength: 1.5,
      aLatMax: 6.5,
      alignScale: 1.0,
      airAlignScale: 0.45,
      spinRate: SKATER.modes.realistic.spinRate,
      airControl: 3,
      ollieHeight: SKATER.modes.realistic.ollieHeight,
      landingMagnet: false,
      vertAssist: false,
      flipAssist: false,
      rollingScale: 1.0,
      dragArea: 0.45,
    }),
  }),
})

export function createTelemetry() {
  return {
    position: new Vector3(),
    quaternion: new Quaternion(),
    velocity: new Vector3(),
    angularVelocity: new Vector3(),
    speed: 0,
    forwardSpeed: 0,
    grounded: true,
    wheelContacts: [false, false, false, false],
    contactCount: 0,
    groundNormal: new Vector3(0, 1, 0),
    surface: 'concrete',
    steerAngle: 0,
    lean: 0,
    crouch: 0,
    airTime: 0,
    takeoffHeight: 0,
    maxAirHeight: 0,
    accumulated: { bodyYaw: 0, bodyPitch: 0, bodyRoll: 0, boardRoll: 0, boardYaw: 0 },
    boardRelative: new Quaternion(),
    flipActive: false,
    stance: 'regular',
    isSwitch: false,
    manual: { active: false, type: null, balance: 0, time: 0 },
    grind: { active: false, type: null, spotId: null, balance: 0, time: 0, distance: 0 },
    lastLanding: { time: 0, impact: 0, quality: 1, clean: true, alignmentError: 0 },
    mode: 'arcade',
    /** extras */
    detached: false,
    popTime: -1,
    nearGroundDistance: Infinity,
  }
}

// temporales
const _v = new Vector3()
const _v2 = new Vector3()
const _up = new Vector3()
const _fwd = new Vector3()
const _x = new Vector3()
const _q = new Quaternion()
const _q2 = new Quaternion()
const _qYaw = new Quaternion()
const _qRoll = new Quaternion()
const _qPitch = new Quaternion()
const _axisY = new Vector3(0, 1, 0)
const _axisZ = new Vector3(0, 0, 1)
const _axisX = new Vector3(1, 0, 0)
const _target = new Vector3()

const wrapPi = (a) => {
  a = (a + Math.PI) % TAU
  if (a < 0) a += TAU
  return a - Math.PI
}

export class SkateboardPhysics {
  /**
   * @param {Object} o
   * @param {import('./PhysicsWorld.js').PhysicsWorld} o.physics
   * @param {import('../core/EventBus.js').EventBus} [o.bus]
   * @param {typeof DEFAULT_BOARD_SETUP} [o.setup]
   */
  constructor({ physics, bus = null, setup = DEFAULT_BOARD_SETUP }) {
    this.physics = physics
    this.RAPIER = physics.RAPIER
    this.bus = bus
    this.setup = setup
    this.geo = computeBoardGeometry(setup)
    this.P = SKATE_PARAMS
    this.mode = 'arcade'
    this.M = this.P.modes.arcade
    this.telemetry = createTelemetry()
    const R = this.RAPIER

    // Cuerpo principal: masa e inercias explícitas (los colliders no aportan masa)
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(0, 1, 0)
      .setCanSleep(false)
      .setCcdEnabled(true)
      .setAdditionalMassProperties(this.P.mass, { x: 0, y: this.P.comY, z: 0 }, this.P.inertia, { x: 0, y: 0, z: 0, w: 1 })
    this.body = physics.world.createRigidBody(desc)
    const d = setup.deck
    this.deckCollider = physics.world.createCollider(
      R.ColliderDesc.cuboid(d.width / 2, d.thickness / 2, d.length / 2)
        .setTranslation(0, -d.thickness / 2, 0)
        .setDensity(0)
        .setFriction(0.3)
        .setCollisionGroups(PHYSICS.GROUP_SETS.skater)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(2500),
      this.body,
    )
    this.riderCollider = physics.world.createCollider(
      R.ColliderDesc.capsule(0.55, 0.2)
        .setTranslation(0, 1.0, 0)
        .setDensity(0)
        .setFriction(0.5)
        .setCollisionGroups(PHYSICS.GROUP_SETS.skater)
        .setActiveEvents(R.ActiveEvents.CONTACT_FORCE_EVENTS)
        .setContactForceEventThreshold(1500),
      this.body,
    )
    physics.setColliderData(this.deckCollider, { kind: 'skaterDeck', surface: 'wood' })
    physics.setColliderData(this.riderCollider, { kind: 'skaterRider', surface: 'concrete' })
    this.body.recomputeMassPropertiesFromColliders()

    this.solver = new WheelContactSolver({
      physics,
      body: this.body,
      geometry: this.geo,
      massProps: { mass: this.P.mass, comY: this.P.comY, inertia: this.P.inertia },
    })
    this.grind = new GrindPhysics({ RAPIER: R, body: this.body, geometry: this.geo, deckThickness: d.thickness })
    this._offSubstep = physics.addPreSubstep((sub) => this._preSubstep(sub))

    // Estado de control
    this.steerAngle = 0
    this.crouch = 0
    this.crouchHeld = false
    this.pushTimer = -1 // <0 sin patada en curso
    this.pushQueued = false
    this.pushHeld = false
    this.brake = 0
    this.spinInput = 0
    this.lean = 0
    // Aire
    this.airborne = false
    this.noContactSteps = 0
    this.airTime = 0
    this.sinceGrounded = 0
    this.popTimer = -1
    this.popNollie = false
    this.takeoffNormal = new Vector3(0, 1, 0)
    this.takeoffPos = new Vector3()
    this.vertAir = false
    this.preLandingVelocity = new Vector3()
    // Flip (grado de libertad de la tabla)
    this.flip = { active: false, roll: 0, yaw: 0, duration: 0.4, progress: 0, startRoll: 0, startYaw: 0 }
    this.boardRoll = 0 // acumulados desde el despegue
    this.boardYaw = 0
    this.baseYaw = 0 // 0 o π: tabla girada tras un shove-it
    this.popPitch = 0
    // Manual
    this.manualType = null
    this.manualPitch = 0
    // Caída
    this.detached = false
    this.looseBoard = null
    this.enabled = true
    // Interpolación
    this.prevPos = new Vector3()
    this.prevQuat = new Quaternion()
    this.curPos = new Vector3()
    this.curQuat = new Quaternion()
    // Aterrizaje pendiente (lo procesa PlayerController/LandingSystem)
    this.pendingLanding = null
    this._landingInfo = {
      alignmentError: 0,
      yawError: 0,
      flipActive: false,
      flipResidualRoll: 0,
      flipResidualYaw: 0,
      impactSpeed: 0,
      airTime: 0,
      surface: 'concrete',
      normal: new Vector3(0, 1, 0),
    }
    this.stance = 'regular'
    this.spawn(new Vector3(0, 0, 0), 0)
  }

  // ------------------------------------------------------------------------------------------------
  // Configuración
  // ------------------------------------------------------------------------------------------------
  setMode(mode) {
    this.mode = mode === 'realistic' ? 'realistic' : 'arcade'
    this.M = this.P.modes[this.mode]
    this.telemetry.mode = this.mode
    this.solver.rollingScale = this.M.rollingScale
  }

  setStance(stance) {
    this.stance = stance === 'goofy' ? 'goofy' : 'regular'
    this.telemetry.stance = this.stance
  }

  get stanceSign() {
    return this.stance === 'goofy' ? -1 : 1
  }

  /** Activa/desactiva el cuerpo (modo caminar). */
  setEnabled(v) {
    this.enabled = v
    this.body.setEnabled(v)
  }

  // ------------------------------------------------------------------------------------------------
  // Aparición
  // ------------------------------------------------------------------------------------------------
  spawn(position, yaw = 0) {
    this.reset(position, yaw)
  }

  /**
   * Coloca el cuerpo en reposo sobre el suelo en `position` (punto del suelo) mirando a `yaw`.
   * @param {Vector3|number[]|{x,y,z}} position
   */
  reset(position, yaw = 0) {
    const p = Array.isArray(position) ? _v.set(position[0], position[1], position[2]) : _v.set(position.x, position.y, position.z)
    if (this.grind.active) this.grind.detach({ popSpeed: 0 })
    this._removeLooseBoard()
    this.detached = false
    if (!this.enabled) this.setEnabled(true)
    this.body.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true)
    this.body.lockRotations(false, true)
    this.body.setLinearDamping(0)
    this.body.setAngularDamping(0)
    // Busca el suelo bajo el punto (los BVH se actualizan con un paso de dt=0)
    this.physics.refreshQueries?.()
    const hit = this.physics.castRay(_v2.set(p.x, p.y + 2.5, p.z), _target.set(0, -1, 0), 10, { groups: PHYSICS.GROUP_SETS.wheelRay, excludeBody: this.body })
    const groundY = hit ? hit.point.y : p.y
    _q.setFromAxisAngle(_axisY, yaw)
    this.body.setTranslation({ x: p.x, y: groundY + this.solver.rideHeight + 0.002, z: p.z }, true)
    this.body.setRotation(_q, true)
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.resetForces(true)
    this.body.resetTorques(true)
    this.steerAngle = 0
    this.crouch = 0
    this.pushTimer = -1
    this.airborne = false
    this.noContactSteps = 0
    this.airTime = 0
    this.popTimer = -1
    this.flip.active = false
    this.boardRoll = 0
    this.boardYaw = 0
    this.baseYaw = 0
    this.popPitch = 0
    this.manualType = null
    this.solver.disabledMask = 0
    this.pendingLanding = null
    this._readState()
    this.prevPos.copy(this.curPos)
    this.prevQuat.copy(this.curQuat)
    const t = this.telemetry
    t.grounded = true
    t.lastLanding.time = 0
    t.detached = false
  }

  // ------------------------------------------------------------------------------------------------
  // Controles (una vez por paso fijo, antes de physics.step)
  // ------------------------------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {{steer:number, push:boolean, pushHeld:boolean, brake:number, crouch:boolean, spin:number, manualBalance?:number}} c
   */
  applyControls(dt, c) {
    this.prevPos.copy(this.curPos)
    this.prevQuat.copy(this.curQuat)
    if (!this.enabled) return
    const t = this.telemetry
    if (this.detached) return

    // Agacharse (carga del pop)
    this.crouchHeld = !!c.crouch
    const target = c.crouch ? 1 : 0
    this.crouch += (target - this.crouch) * Math.min(1, dt / (target ? this.P.popChargeTime * 0.5 : 0.08))
    if (this.crouch < 1e-3) this.crouch = 0

    // Dirección (ángulo de trucks limitado por la aceleración lateral admisible a esa velocidad)
    const speed = t.speed
    const v2 = Math.max(0.25, speed * speed)
    const maxByLat = Math.atan((this.geo.halfBase * 2) / (2 * (v2 / this.M.aLatMax)))
    const maxSteer = Math.min(this.setup.trucks.maxSteerAngle, maxByLat)
    // A/D relativos a la dirección de marcha: en fakie se invierte para que sea intuitivo
    const travelSign = t.forwardSpeed < -0.3 ? -1 : 1
    const steerTarget = -c.steer * maxSteer * travelSign
    this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, dt * this.P.steerResponse)
    this.solver.setSteer(this.airborne || this.grind.active ? 0 : this.steerAngle)
    this.lean = maxSteer > 0 ? -this.steerAngle / this.setup.trucks.maxSteerAngle : 0

    // Patadas
    this.pushHeld = !!c.pushHeld
    const canPush = t.grounded && !this.manualType && !this.grind.active && !this.crouchHeld
    if (c.push) this.pushQueued = true
    if (this.pushTimer >= 0) {
      const prev = this.pushTimer
      this.pushTimer += dt
      if (prev < this.P.pushKickAt && this.pushTimer >= this.P.pushKickAt && canPush) this._kick()
      if (this.pushTimer >= this.P.pushCycle) this.pushTimer = this.pushHeld || this.pushQueued ? 0 : -1
    } else if ((this.pushQueued || this.pushHeld) && canPush) {
      this.pushTimer = 0
    }
    if (this.pushTimer === 0) this.pushQueued = false
    if (!canPush && this.pushTimer >= 0 && this.pushTimer < this.P.pushKickAt) this.pushTimer = -1

    // Freno
    this.brake = c.brake || 0
    if (this.brake > 0 && t.grounded && !this.grind.active) {
      const vt = _v.copy(t.velocity).addScaledVector(t.groundNormal, -t.velocity.dot(t.groundNormal))
      const sp = vt.length()
      if (sp > 1e-3) {
        const dv = Math.min(sp, this.P.brakeDecel * this.brake * dt)
        vt.multiplyScalar(-(dv / sp) * this.P.mass)
        this.body.applyImpulse(vt, true)
      }
    }

    // Resistencia aerodinámica (limita la velocidad en bajadas largas)
    if (!this.grind.active && speed > 0.5) {
      const drag = 0.5 * this.P.airDensity * this.M.dragArea * speed * speed
      const dv = Math.min(speed, (drag / this.P.mass) * dt)
      _v.copy(t.velocity).multiplyScalar(-(dv / speed) * this.P.mass)
      this.body.applyImpulse(_v, true)
    }

    // Giro en el aire alrededor del eje "arriba" de la tabla
    this.spinInput = c.spin ?? this.spinInput
    if (this.airborne && !this.grind.active) this._airControl(dt)

    // Flip de la tabla
    this._integrateFlip(dt)

    // Pitch visual del pop
    if (this.popTimer >= 0) {
      this.popTimer += dt
      const tt = this.popTimer
      const peak = this.P.popPitchDeg * DEG
      const s = tt < 0.06 ? tt / 0.06 : Math.max(0, 1 - (tt - 0.06) / 0.2)
      this.popPitch = peak * s * (this.popNollie ? 1 : -1)
      if (tt > 0.6) this.popTimer = -1
    } else {
      this.popPitch = 0
    }

    // Manual
    if (this.manualType) {
      const base = 11 * DEG
      const bal = c.manualBalance || 0
      this.manualPitch = (this.manualType === 'nose' ? base : -base) * (1 + 0.6 * bal)
    } else {
      this.manualPitch = 0
    }
  }

  _kick() {
    const t = this.telemetry
    const dir = _v.set(0, 0, 1).applyQuaternion(this.curQuat)
    if (t.forwardSpeed < -0.3) dir.negate()
    dir.addScaledVector(t.groundNormal, -dir.dot(t.groundNormal)).normalize()
    const speed = Math.abs(t.forwardSpeed)
    const dv = this.M.pushStrength * Math.max(0, 1 - speed / SKATER.maxPushSpeed)
    if (dv <= 0) return
    this.body.applyImpulse(dir.multiplyScalar(dv * this.P.mass), true)
    this.bus?.emit('skater:push', { foot: 'back', strength: dv })
  }

  _airControl(dt) {
    const av = this.body.angvel()
    _up.set(0, 1, 0).applyQuaternion(this.curQuat)
    const wUp = av.x * _up.x + av.y * _up.y + av.z * _up.z
    let targetW = this.spinInput * this.M.spinRate
    // Imán de aterrizaje (arcade): corrige el yaw hacia la dirección de marcha cerca del suelo
    const t = this.telemetry
    if (this.M.landingMagnet && this.spinInput === 0 && t.velocity.y < 0 && this.solver.result.nearestDist < 1.2) {
      _fwd.set(0, 0, 1).applyQuaternion(this.curQuat)
      _v.copy(t.velocity).addScaledVector(_up, -t.velocity.dot(_up))
      if (_v.lengthSq() > 0.25) {
        _v.normalize()
        let err = Math.atan2(_v2.crossVectors(_fwd, _v).dot(_up), _fwd.dot(_v))
        if (Math.abs(err) > Math.PI / 2) err = wrapPi(err - Math.PI) // permitir fakie
        targetW = err * 6
      }
    }
    const k = Math.min(1, dt * this.M.airControl)
    const dw = (targetW - wUp) * k
    this.body.setAngvel({ x: av.x + _up.x * dw, y: av.y + _up.y * dw, z: av.z + _up.z * dw }, true)
    // Asistencia de vert: sube y baja pegado a la rampa
    if (this.vertAir && this.M.vertAssist) {
      const lv = this.body.linvel()
      _v.set(this.takeoffNormal.x, 0, this.takeoffNormal.z)
      const len = _v.length()
      if (len > 1e-3) {
        _v.divideScalar(len)
        const away = lv.x * _v.x + lv.z * _v.z
        if (away > 0) this.body.setLinvel({ x: lv.x - _v.x * away, y: lv.y, z: lv.z - _v.z * away }, true)
      }
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Pop / flips / giros
  // ------------------------------------------------------------------------------------------------
  /**
   * Ollie/nollie. Requiere contacto (o coyote time).
   * @returns {boolean} true si se ejecutó
   */
  pop({ nollie = false, strength = null } = {}) {
    if (this.detached || !this.enabled || this.grind.active) return false
    const t = this.telemetry
    const canPop = t.grounded || this.sinceGrounded <= this.P.coyoteTime
    if (!canPop || this.popTimer >= 0) return false
    const charge = strength ?? this.crouch
    const [hMin, hMax] = this.M.ollieHeight
    const h = (hMin + (hMax - hMin) * Math.min(1, Math.max(0, charge))) * (nollie ? 0.92 : 1)
    const dvTarget = Math.sqrt(2 * G * h)
    const dir = _v.copy(t.groundNormal).normalize()
    const lv = this.body.linvel()
    const along = lv.x * dir.x + lv.y * dir.y + lv.z * dir.z
    const dv = dvTarget - Math.max(0, along)
    if (dv > 0) this.body.applyImpulse(dir.multiplyScalar(dv * this.P.mass), true)
    if (this.manualType) this.endManual()
    this.pushTimer = -1
    this.popTimer = 0
    this.popNollie = nollie
    this.crouch = 0
    t.popTime = 0
    this.bus?.emit('skater:pop', { nollie, strength: charge, position: t.position })
    return true
  }

  /**
   * Inicia una rotación de la tabla relativa al cuerpo.
   * @param {{roll:number, yaw:number, duration:number}} f radianes (signo ya resuelto por stance)
   */
  startFlip({ roll = 0, yaw = 0, duration = 0.42 }) {
    if (this.detached || this.flip.active) return false
    const f = this.flip
    f.active = true
    f.roll = roll
    f.yaw = yaw
    f.duration = Math.max(0.12, duration)
    f.progress = 0
    f.startRoll = this.boardRoll
    f.startYaw = this.boardYaw
    this.telemetry.flipActive = true
    return true
  }

  _integrateFlip(dt) {
    const f = this.flip
    if (!f.active) return
    let speed = 1
    // Asistencia arcade: acelera el flip si no da tiempo antes de aterrizar
    if (this.M.flipAssist && this.airborne) {
      const vy = this.telemetry.velocity.y
      const h = Math.max(0, this.solver.result.nearestDist - this.solver.restLen)
      const tLand = vy < 0 ? h / Math.max(0.5, -vy) : (vy + Math.sqrt(vy * vy + 2 * G * h)) / G
      const remaining = (1 - f.progress) * f.duration
      if (remaining > tLand && tLand > 0.02) speed = Math.min(1.9, remaining / tLand)
    }
    f.progress = Math.min(1, f.progress + (dt / f.duration) * speed)
    this.boardRoll = f.startRoll + f.roll * f.progress
    this.boardYaw = f.startYaw + f.yaw * f.progress
    if (f.progress >= 1) this._finishFlip()
  }

  _finishFlip() {
    const f = this.flip
    this.boardRoll = f.startRoll + f.roll
    this.boardYaw = f.startYaw + f.yaw
    f.active = false
    this.telemetry.flipActive = false
  }

  /** Atrapa la tabla: completa el flip si la rotación pendiente está dentro de la tolerancia. */
  catchBoard() {
    const f = this.flip
    if (!f.active) return true
    const rr = this._residual(this.boardRoll, TAU)
    const ry = this._residual(this.baseYaw + this.boardYaw, Math.PI)
    const tol = SKATER.modes[this.mode].flipCatchTolerance
    if (Math.abs(rr) <= tol && Math.abs(ry) <= tol) {
      this.boardRoll -= rr
      this.boardYaw -= ry
      f.active = false
      this.telemetry.flipActive = false
      return true
    }
    return false
  }

  _residual(angle, period) {
    return angle - Math.round(angle / period) * period
  }

  /** Velocidad angular objetivo alrededor del eje arriba de la tabla en el aire (rad/s). */
  setAirSpin(rate) {
    this.spinInput = this.M.spinRate > 0 ? rate / this.M.spinRate : 0
  }

  // ------------------------------------------------------------------------------------------------
  // Manuals
  // ------------------------------------------------------------------------------------------------
  beginManual(type) {
    if (this.detached || !this.telemetry.grounded || this.grind.active) return false
    this.manualType = type === 'nose' ? 'nose' : 'manual'
    // manual: ruedas delanteras (0,1) en el aire; nose: traseras (2,3)
    this.solver.disabledMask = this.manualType === 'manual' ? 0b0011 : 0b1100
    this.pushTimer = -1
    return true
  }

  endManual() {
    this.manualType = null
    this.manualPitch = 0
    this.solver.disabledMask = 0
  }

  // ------------------------------------------------------------------------------------------------
  // Grinds
  // ------------------------------------------------------------------------------------------------
  attachGrind(info) {
    if (this.detached) return false
    if (this.manualType) this.endManual()
    if (this.flip.active) this.catchBoard()
    this.flip.active = false
    this.telemetry.flipActive = false
    this.grind.attach(info)
    this.airborne = false
    this.pushTimer = -1
    return true
  }

  /** @param {{pop?:boolean, sideSpeed?:number}} [o] */
  detachGrind({ pop = false, sideSpeed = 0 } = {}) {
    if (!this.grind.active) return
    const popSpeed = pop ? Math.sqrt(2 * G * this.M.ollieHeight[0]) : 0.5
    this.grind.detach({ popSpeed, sideSpeed })
    // Se considera despegue (para aire/combos)
    this._beginAir(true)
    if (pop) {
      this.popTimer = 0
      this.popNollie = false
      this.bus?.emit('skater:pop', { nollie: false, strength: 0.5, position: this.telemetry.position })
    }
  }

  // ------------------------------------------------------------------------------------------------
  // Caídas
  // ------------------------------------------------------------------------------------------------
  /** Separa la tabla (cuerpo dinámico suelto) y deja al rider caer deslizando. */
  bail() {
    if (this.detached) return
    if (this.grind.active) this.grind.detach({ popSpeed: 0 })
    this.endManual()
    this.flip.active = false
    this.telemetry.flipActive = false
    const R = this.RAPIER
    const lv = this.body.linvel()
    // Tabla suelta
    _q.copy(this.curQuat).multiply(this._boardRelative(_q2))
    const d = this.setup.deck
    const bdesc = R.RigidBodyDesc.dynamic()
      .setTranslation(this.curPos.x, this.curPos.y + 0.05, this.curPos.z)
      .setRotation(_q)
      .setLinvel(lv.x * 1.1, Math.max(lv.y, 0) + 1.2, lv.z * 1.1)
      .setAngvel({ x: (Math.random() - 0.5) * 8, y: (Math.random() - 0.5) * 6, z: (Math.random() - 0.5) * 10 })
      .setCcdEnabled(true)
      .setLinearDamping(0.15)
      .setAngularDamping(0.6)
    this.looseBoard = this.physics.world.createRigidBody(bdesc)
    this.looseCollider = this.physics.world.createCollider(
      R.ColliderDesc.cuboid(d.width / 2, (d.thickness + 0.08) / 2, d.length / 2)
        .setTranslation(0, -(d.thickness + 0.08) / 2, 0)
        .setMass(SKATER.boardMass)
        .setFriction(0.6)
        .setRestitution(0.25)
        .setCollisionGroups(PHYSICS.GROUP_SETS.boardLoose),
      this.looseBoard,
    )
    this.physics.setColliderData(this.looseCollider, { kind: 'looseBoard', surface: 'wood' })
    // Rider: sin ruedas, rotación bloqueada y erguida, desliza hasta pararse
    _v.set(0, 0, 1).applyQuaternion(this.curQuat)
    const yaw = Math.atan2(_v.x, _v.z)
    _q.setFromAxisAngle(_axisY, yaw)
    this.body.setRotation(_q, true)
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.body.lockRotations(true, true)
    this.body.setLinearDamping(1.6)
    this.detached = true
    this.airborne = false
    this.telemetry.detached = true
    this.boardRoll = 0
    this.boardYaw = 0
    this.baseYaw = 0
  }

  _removeLooseBoard() {
    if (this.looseBoard) {
      this.physics.colliderData.delete(this.looseCollider?.handle)
      this.physics.world.removeRigidBody(this.looseBoard)
      this.looseBoard = null
      this.looseCollider = null
    }
  }

  /** Transformación de la tabla suelta (si existe). */
  getLooseBoardTransform(outPos, outQuat) {
    if (!this.looseBoard) return false
    const p = this.looseBoard.translation()
    const r = this.looseBoard.rotation()
    outPos.set(p.x, p.y, p.z)
    outQuat.set(r.x, r.y, r.z, r.w)
    return true
  }

  // ------------------------------------------------------------------------------------------------
  // Subpaso: fuerzas de las ruedas y alineación
  // ------------------------------------------------------------------------------------------------
  _preSubstep(subDt) {
    if (!this.enabled) return
    if (this.grind.active) {
      this.body.resetForces(true)
      this.body.resetTorques(true)
      return
    }
    if (this.detached) {
      this.body.resetForces(true)
      this.body.resetTorques(true)
      this.solver.probe()
      return
    }
    const popWindow = this.popTimer >= 0 && this.popTimer < 0.08
    let alignTarget = null
    if (this.airborne && this.vertAir) alignTarget = this.takeoffNormal
    this.solver.solve(subDt, {
      springs: !popWindow,
      align: true,
      alignTarget,
      pitchOffset: this.manualType ? this.manualPitch : 0,
      alignScale: this.M.alignScale,
      airAlignScale: this.vertAir ? this.M.airAlignScale * 1.5 : this.M.airAlignScale,
    })
  }

  // ------------------------------------------------------------------------------------------------
  // Tras el paso de física
  // ------------------------------------------------------------------------------------------------
  postStep(dt) {
    const t = this.telemetry
    if (!this.enabled) {
      this._readState()
      return
    }
    if (this.grind.active) {
      // la posición la dicta GrindPhysics (paso fijo)
      this._readState()
      t.grounded = true
      t.velocity.copy(this.grind.velocity)
      t.speed = t.velocity.length()
      t.groundNormal.copy(this.grind.edgeUp)
      this._updateTelemetryCommon()
      return
    }
    this._readState()
    const res = this.solver.result
    const contact = res.nContact >= 2 || (res.nContact >= 1 && res.nearestDist <= this.solver.restLen + 0.02)
    if (this.detached) {
      t.grounded = contact
      this._updateTelemetryCommon()
      return
    }

    if (contact) {
      this.noContactSteps = 0
      this.sinceGrounded = 0
      if (this.airborne) {
        if (this.airTime >= this.P.airMinTime) this._land(res)
        this.airborne = false
        this.vertAir = false
      }
      if (this.popTimer < 0 || this.popTimer > 0.15) this.airTime = 0
      t.groundNormal.copy(res.avgNormal)
      t.surface = res.surface
    } else {
      this.noContactSteps++
      this.sinceGrounded += dt
      if (!this.airborne && (this.noContactSteps >= this.P.airborneGraceSteps || this.popTimer >= 0)) this._beginAir(false)
      if (this.airborne) {
        this.airTime += dt
        this.preLandingVelocity.copy(t.velocity)
        // acumuladores de rotación del cuerpo
        const av = this.body.angvel()
        _up.set(0, 1, 0).applyQuaternion(this.curQuat)
        _x.set(1, 0, 0).applyQuaternion(this.curQuat)
        _fwd.set(0, 0, 1).applyQuaternion(this.curQuat)
        const acc = t.accumulated
        acc.bodyYaw += (av.x * _up.x + av.y * _up.y + av.z * _up.z) * dt
        acc.bodyPitch += (av.x * _x.x + av.y * _x.y + av.z * _x.z) * dt
        acc.bodyRoll += (av.x * _fwd.x + av.y * _fwd.y + av.z * _fwd.z) * dt
        const h = t.position.y - t.takeoffHeight
        if (h > t.maxAirHeight) t.maxAirHeight = h
      }
      t.groundNormal.set(0, 1, 0)
    }
    t.grounded = contact && !this.airborne
    t.nearGroundDistance = res.nearestDist
    // volcado en suelo
    _up.set(0, 1, 0).applyQuaternion(this.curQuat)
    this.tumbled = contact && _up.dot(t.groundNormal) < this.P.tumbleUpY
    this._updateTelemetryCommon()
  }

  _beginAir(fromGrind) {
    this.airborne = true
    this.airTime = 0
    const t = this.telemetry
    t.takeoffHeight = t.position.y
    t.maxAirHeight = 0
    const acc = t.accumulated
    acc.bodyYaw = acc.bodyPitch = acc.bodyRoll = 0
    acc.boardRoll = acc.boardYaw = 0
    if (!this.flip.active) {
      this.boardRoll = 0
      this.boardYaw = 0
    }
    this.takeoffPos.copy(t.position)
    this.takeoffNormal.copy(fromGrind ? _axisY : t.groundNormal)
    // aire de vert: despegue desde una transición casi vertical moviéndose hacia arriba
    this.vertAir = !fromGrind && this.takeoffNormal.y < 0.6 && t.velocity.y > 0.5
    if (this.manualType) this.endManual()
    this.bus?.emit('skater:airborne', { position: t.position, velocity: t.velocity })
  }

  _land(res) {
    const t = this.telemetry
    const info = this._landingInfo
    _up.set(0, 1, 0).applyQuaternion(this.curQuat)
    _fwd.set(0, 0, 1).applyQuaternion(this.curQuat)
    info.normal.copy(res.avgNormal)
    info.alignmentError = Math.acos(Math.min(1, Math.max(-1, _up.dot(res.avgNormal))))
    // error de yaw respecto a la velocidad tangencial (permite fakie)
    _v.copy(this.preLandingVelocity).addScaledVector(res.avgNormal, -this.preLandingVelocity.dot(res.avgNormal))
    if (_v.lengthSq() > 0.5) {
      _v.normalize()
      const a = Math.acos(Math.min(1, Math.max(-1, _fwd.dot(_v))))
      info.yawError = Math.min(a, Math.PI - a)
      info.fakie = a > Math.PI / 2
    } else {
      info.yawError = 0
      info.fakie = false
    }
    info.flipActive = this.flip.active
    info.flipResidualRoll = this._residual(this.boardRoll, TAU)
    info.flipResidualYaw = this._residual(this.baseYaw + this.boardYaw, Math.PI)
    info.impactSpeed = Math.max(0, -this.preLandingVelocity.dot(res.avgNormal))
    info.airTime = this.airTime
    info.surface = res.surface
    info.vertAir = this.vertAir
    this.pendingLanding = info
  }

  /**
   * Aplica el resultado de LandingSystem al aterrizaje pendiente (asistencias o caída).
   * @param {{clean:boolean, quality:number, bail:boolean}} result
   */
  resolveLanding(result) {
    const info = this.pendingLanding
    this.pendingLanding = null
    if (!info) return
    const t = this.telemetry
    t.lastLanding.time = 0
    t.lastLanding.impact = Math.min(1, info.impactSpeed / 6)
    t.lastLanding.quality = result.quality
    t.lastLanding.clean = result.clean
    t.lastLanding.alignmentError = info.alignmentError
    if (result.bail) {
      this.bail()
      return
    }
    // Atrapa la tabla (los residuos ya están dentro de tolerancia) y normaliza el yaw base
    this.flip.active = false
    t.flipActive = false
    const totalYaw = this.baseYaw + this.boardYaw - info.flipResidualYaw
    this.baseYaw = Math.abs(wrapPi(totalYaw)) > Math.PI / 2 ? Math.PI : 0
    this.boardRoll = 0
    this.boardYaw = 0
    // Aterrizaje sucio en realista: pierde velocidad
    if (!result.clean) {
      const lv = this.body.linvel()
      const k = this.mode === 'realistic' ? 0.7 : 0.88
      this.body.setLinvel({ x: lv.x * k, y: lv.y, z: lv.z * k }, true)
    }
    // Asistencia arcade: endereza el yaw hacia la marcha
    if (this.M.landingMagnet && info.yawError > 0.02) {
      _up.set(0, 1, 0).applyQuaternion(this.curQuat)
      _fwd.set(0, 0, 1).applyQuaternion(this.curQuat)
      _v.copy(t.velocity).addScaledVector(_up, -t.velocity.dot(_up))
      if (_v.lengthSq() > 0.25) {
        _v.normalize()
        let err = Math.atan2(_v2.crossVectors(_fwd, _v).dot(_up), _fwd.dot(_v))
        if (Math.abs(err) > Math.PI / 2) err = wrapPi(err - Math.PI)
        _q.setFromAxisAngle(_up, err * 0.85)
        _q2.copy(this.curQuat).premultiply(_q)
        this.body.setRotation(_q2, true)
      }
    }
  }

  _readState() {
    const b = this.body
    const p = b.translation()
    const r = b.rotation()
    this.curPos.set(p.x, p.y, p.z)
    this.curQuat.set(r.x, r.y, r.z, r.w)
    const t = this.telemetry
    t.position.copy(this.curPos)
    t.quaternion.copy(this.curQuat)
    const lv = b.linvel()
    const av = b.angvel()
    t.velocity.set(lv.x, lv.y, lv.z)
    t.angularVelocity.set(av.x, av.y, av.z)
    t.speed = t.velocity.length()
    _fwd.set(0, 0, 1).applyQuaternion(this.curQuat)
    t.forwardSpeed = t.velocity.dot(_fwd)
  }

  _updateTelemetryCommon() {
    const t = this.telemetry
    const res = this.solver.result
    for (let i = 0; i < 4; i++) t.wheelContacts[i] = this.solver.wheels[i].contact
    t.contactCount = res.nContact
    t.steerAngle = this.steerAngle
    t.lean = this.grind.active ? this.grind.balanceLean : this.lean
    t.crouch = this.crouch
    t.airTime = this.airborne ? this.airTime : 0
    t.flipActive = this.flip.active
    t.accumulated.boardRoll = this.boardRoll
    t.accumulated.boardYaw = this.boardYaw
    this._boardRelative(t.boardRelative)
    // switch con histéresis
    if (t.forwardSpeed < -0.4) t.isSwitch = true
    else if (t.forwardSpeed > 0.4) t.isSwitch = false
    t.manual.active = !!this.manualType
    t.manual.type = this.manualType
    t.grind.active = this.grind.active
    t.grind.type = this.grind.active ? this.grind.type : null
    t.grind.spotId = this.grind.active ? this.grind.edge?.id ?? null : null
    t.grind.time = this.grind.time
    t.grind.distance = this.grind.distance
    t.lastLanding.time += PHYSICS.fixedDt
    if (t.popTime >= 0) t.popTime += PHYSICS.fixedDt
    t.detached = this.detached
  }

  /** Rotación visual de la tabla relativa al cuerpo: yaw(base+flip) · roll(flip) · pitch(pop/manual). */
  _boardRelative(out) {
    _qYaw.setFromAxisAngle(_axisY, this.baseYaw + this.boardYaw)
    _qRoll.setFromAxisAngle(_axisZ, this.boardRoll)
    _qPitch.setFromAxisAngle(_axisX, this.popPitch)
    return out.copy(_qYaw).multiply(_qRoll).multiply(_qPitch)
  }

  /** Avance de grind en el paso fijo (lo llama PlayerController antes de physics.step). */
  stepGrind(dt) {
    return this.grind.step(dt)
  }

  getTelemetry() {
    return this.telemetry
  }

  getInterpolatedTransform(alpha, outPos, outQuat) {
    outPos.lerpVectors(this.prevPos, this.curPos, alpha)
    outQuat.slerpQuaternions(this.prevQuat, this.curQuat, alpha)
  }

  dispose() {
    this._offSubstep?.()
    this._removeLooseBoard()
    this.physics.colliderData.delete(this.deckCollider.handle)
    this.physics.colliderData.delete(this.riderCollider.handle)
    this.physics.world.removeRigidBody(this.body)
  }
}
