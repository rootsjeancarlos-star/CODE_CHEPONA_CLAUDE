import { Vector3, Quaternion } from 'three/webgpu'
import { SKATER } from '../core/Config.js'
import { CollisionManager } from '../physics/CollisionManager.js'
import { WalkingController } from '../physics/WalkingController.js'

/** Estados del skater (docs/ARCHITECTURE.md §7, diagrama en docs/PHYSICS.md). */
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
const S = PLAYER_STATES

/** Estados en los que el skater está sobre la tabla y rodando/volando con física dinámica. */
const BOARD_STATES = new Set([S.IDLE, S.SKATING, S.PUSHING, S.BRAKING, S.CROUCHING, S.POPPING, S.AIRBORNE, S.TRICKING, S.MANUAL, S.LANDING])
const GROUND_STATES = new Set([S.IDLE, S.SKATING, S.PUSHING, S.BRAKING, S.CROUCHING, S.LANDING])

const _Y = new Vector3(0, 1, 0)
const _v = new Vector3()
const _fwd = new Vector3()
const NEUTRAL = Object.freeze({ steer: 0, push: false, pushHeld: false, brake: 0, crouch: false, spin: 0, manualBalance: 0 })

/**
 * Máquina de estados del skater: traduce el InputIntent en controles de la física, coordina trucos,
 * manuals, grinds, aterrizajes, caídas, reapariciones y el modo caminar, y produce el contexto de animación.
 */
export class PlayerController {
  constructor({ bus, physics, board, tricks, grind, balance, landing, respawn, settings = {}, stance = 'regular' }) {
    this.bus = bus
    this.physics = physics
    this.board = board
    this.sb = board.physics
    this.tricks = tricks
    this.grind = grind
    this.balance = balance
    this.landing = landing
    this.respawn = respawn
    this.settings = settings
    this.mode = settings.physicsMode === 'realistic' ? 'realistic' : 'arcade'
    this.collisions = new CollisionManager({ physics, bus })
    this.walking = new WalkingController({ physics })
    this.state = S.SKATING
    this.stateTime = 0
    this.idleTime = 0
    this.bailTime = 0
    this.bailDirection = new Vector3()
    this.mountTime = 0
    this._intent = null
    this._controls = { ...NEUTRAL }
    this.setStance(stance)
    this.sb.setMode(this.mode)

    this._ctx = {
      state: this.state,
      telemetry: this.sb.getTelemetry(),
      intent: null,
      stance: this.stance,
      rootPosition: new Vector3(),
      rootQuaternion: new Quaternion(),
      boardAttached: true,
      footAnchors: null,
      crouch: 0,
      lean: 0,
      pushPhase: -1,
      trick: null,
      walkSpeed: 0,
      bail: { active: false, time: 0, direction: this.bailDirection },
      landingImpact: 0,
    }
    this._trickCtx = { id: null, category: null, progress: 0 }
    this._anchors = null
    this._camTarget = { position: new Vector3(), quaternion: new Quaternion(), velocity: new Vector3(), forward: new Vector3(), grounded: true, state: this.state }
  }

  // --------------------------------------------------------------------------------------------
  // Configuración y aparición
  // --------------------------------------------------------------------------------------------
  setMode(m) {
    this.mode = m === 'realistic' ? 'realistic' : 'arcade'
    this.sb.setMode(this.mode)
  }

  setStance(s) {
    this.stance = s === 'goofy' ? 'goofy' : 'regular'
    this.sb.setStance(this.stance)
    // regular mira a −X (−90° sobre Y), goofy a +X
    this._stanceQuat = new Quaternion().setFromAxisAngle(_Y, this.stance === 'goofy' ? Math.PI / 2 : -Math.PI / 2)
    if (this._ctx) this._ctx.stance = this.stance
  }

  spawn(spawn) {
    this.respawnAt(spawn, 'spawn')
  }

  /** @param {{position:number[]|Vector3, yaw?:number}} spawn */
  respawnAt(spawn, reason = 'spawn') {
    if (this.walking.active) this.walking.disable()
    if (this.grind.active) this.grind.reset()
    this.balance.stop()
    this.sb.reset(spawn.position, spawn.yaw || 0)
    this.board.setAttached?.(true)
    this.tricks.reset?.()
    this.collisions.consumeBail()
    this.collisions.cooldown = 0.5
    this._setState(S.SKATING)
    if (reason !== 'spawn') {
      const p = Array.isArray(spawn.position) ? spawn.position : [spawn.position.x, spawn.position.y, spawn.position.z]
      this.bus?.emit('skater:respawn', { position: p, reason })
    }
  }

  _setState(next) {
    if (next === this.state) return
    const from = this.state
    this.state = next
    this.stateTime = 0
    this.bus?.emit('skater:stateChanged', { from, to: next })
  }

  isOnBoard() {
    return BOARD_STATES.has(this.state) || this.state === S.GRINDING
  }

  isStable() {
    const t = this.sb.getTelemetry()
    return GROUND_STATES.has(this.state) && t.grounded && t.contactCount >= 3 && t.speed < 12
  }

  // --------------------------------------------------------------------------------------------
  // Paso fijo (antes de la física)
  // --------------------------------------------------------------------------------------------
  fixedUpdate(dt, intent) {
    this._intent = intent
    this.stateTime += dt
    this.collisions.update(dt)
    this.grind.fixedUpdate(dt)
    const sb = this.sb
    const tel = sb.getTelemetry()
    const c = this._controls

    switch (this.state) {
      case S.WALKING:
      case S.RUNNING:
        sb.applyControls(dt, NEUTRAL)
        this.walking.update(dt, intent)
        this._setState(intent.modifier && intent.throttle > 0 ? S.RUNNING : S.WALKING)
        if (intent.interactPressed) this._startMount()
        return
      case S.MOUNTING_BOARD:
        sb.applyControls(dt, NEUTRAL)
        this.mountTime += dt
        if (this.mountTime >= 0.45) this._finishMount()
        return
      case S.FALLING:
        sb.applyControls(dt, NEUTRAL)
        this.bailTime += dt
        if (this.bailTime >= 1.4) this._setState(S.RECOVERING)
        return
      case S.RECOVERING:
        sb.applyControls(dt, NEUTRAL)
        if (this.stateTime >= 0.5) this.respawnAt(this.respawn.getSafeSpawn(1.2, tel.position), 'bail')
        return
      case S.GRINDING: {
        sb.applyControls(dt, NEUTRAL)
        const r = this.grind.update(dt, sb, intent, this.mode)
        if (r === 'pop') this._setState(S.POPPING)
        else if (r === 'exit') this._setState(S.AIRBORNE)
        else if (r === 'bail') this._enterBail('equilibrio perdido en el grind')
        else this.tricks.handleIntent(intent, this.state, tel)
        return
      }
    }

    // --- Sobre la tabla (física dinámica) ---
    const airborne = this.state === S.AIRBORNE || this.state === S.TRICKING || this.state === S.POPPING
    const manual = this.state === S.MANUAL
    let manualCorrection = 0
    if (manual) {
      manualCorrection = Math.max(-1, Math.min(1, (intent.manual || 0) + (intent.throttle || 0) - (intent.brake || 0)))
      this.balance.update(dt, manualCorrection)
    }
    c.steer = intent.steer
    c.push = !airborne && !manual && intent.pushPressed
    c.pushHeld = !airborne && !manual && intent.throttle > 0
    c.brake = manual ? 0 : intent.brake
    c.crouch = intent.crouch && !manual
    c.spin = airborne ? (intent.spin || intent.steer || 0) : 0
    c.manualBalance = manual ? this.balance.value : 0
    sb.applyControls(dt, c)

    // Trucos (flips/shove-its/giros: TrickSystem decide y llama a la física)
    this.tricks.handleIntent(intent, this.state, tel)

    // Pop (ollie/nollie) al soltar ESPACIO
    if (intent.popPressed && (GROUND_STATES.has(this.state) || manual || this.state === S.CROUCHING)) {
      if (manual) this._endManual(false)
      if (sb.pop({ nollie: !!intent.nollie })) this._setState(S.POPPING)
    }

    // Manual (↑/↓ en el suelo)
    if (intent.manualPressed && GROUND_STATES.has(this.state) && tel.grounded && tel.speed > 0.8 && this.state !== S.CROUCHING) {
      const type = intent.manual > 0 ? 'manual' : 'nose'
      if (sb.beginManual(type)) {
        this.balance.start('manual', SKATER.modes[this.mode].balanceDifficulty * (type === 'nose' ? 1.1 : 1))
        this._setState(S.MANUAL)
        this.bus?.emit('manual:start', { type })
      }
    } else if (manual) {
      if (this.balance.isLost()) {
        if (SKATER.modes[this.mode].bailOnBalanceLoss) this._enterBail('equilibrio perdido en el manual')
        else this._endManual(false)
      } else if (!tel.grounded && tel.airTime > 0.15) this._endManual(false)
    }

    // Grind: captura en el aire (o rodando con E junto a la arista)
    if ((airborne && this.state !== S.POPPING) || (this.state === S.POPPING && this.stateTime > 0.1) || (intent.grind && GROUND_STATES.has(this.state))) {
      const info = this.grind.tryCapture(sb, intent, this.mode)
      if (info) {
        this.grind.begin(sb, info, this.mode)
        this._setState(S.GRINDING)
      }
    }

    // Bajarse de la tabla
    if (intent.interactPressed && GROUND_STATES.has(this.state) && tel.speed < 2.5) this._dismount()
  }

  // --------------------------------------------------------------------------------------------
  // Tras la física
  // --------------------------------------------------------------------------------------------
  postPhysics(dt) {
    const sb = this.sb
    sb.postStep(dt)
    const tel = sb.getTelemetry()
    if (this.state === S.WALKING || this.state === S.RUNNING || this.state === S.MOUNTING_BOARD || this.state === S.FALLING || this.state === S.RECOVERING) return

    // Aterrizaje medido por la física
    if (sb.pendingLanding) {
      const info = sb.pendingLanding
      const result = this.landing.evaluate(info, this.mode)
      sb.resolveLanding(result)
      this.tricks.onLanding(result, tel)
      if (result.bail) {
        this._enterBail(result.reason || 'mal aterrizaje', true)
        return
      }
      this.bus?.emit('skater:land', { impact: info.impactSpeed, quality: result.quality, clean: result.clean, alignmentError: info.alignmentError, surface: info.surface, position: tel.position, fakie: result.fakie, airTime: info.airTime })
      this._setState(S.LANDING)
    }

    // Choques y vuelcos
    const crash = this.collisions.consumeBail()
    if (crash && this.state !== S.GRINDING) {
      this._enterBail(crash.reason)
      return
    }
    if (sb.tumbled && this.state !== S.GRINDING && this.state !== S.MANUAL) {
      this._enterBail('vuelco')
      return
    }

    // Transiciones derivadas de la telemetría
    switch (this.state) {
      case S.POPPING:
        if (!tel.grounded && tel.airTime > 0) this._setState(sb.flip.active ? S.TRICKING : S.AIRBORNE)
        else if (this.stateTime > 0.35) this._setState(S.SKATING)
        break
      case S.AIRBORNE:
      case S.TRICKING:
        if (tel.grounded && !sb.pendingLanding) this._setState(S.SKATING)
        else this._setState(sb.flip.active || this.tricks.isTricking?.() ? S.TRICKING : S.AIRBORNE)
        break
      case S.LANDING:
        if (this.stateTime > 0.25) this._setState(S.SKATING)
        break
      case S.MANUAL:
      case S.GRINDING:
        break
      default:
        if (!tel.grounded && tel.airTime > 0) {
          this._setState(S.AIRBORNE)
          break
        }
        this._updateGroundState(dt, tel)
    }
  }

  _updateGroundState(dt, tel) {
    const i = this._intent || NEUTRAL
    if (i.crouch) return this._setState(S.CROUCHING)
    if (this.sb.pushTimer >= 0) return this._setState(S.PUSHING)
    if (i.brake > 0 && tel.speed > 0.3) return this._setState(S.BRAKING)
    const noInput = !i.throttle && !i.steer && !i.brake
    this.idleTime = tel.speed < 0.08 && noInput ? this.idleTime + dt : 0
    this._setState(this.idleTime > 1.0 ? S.IDLE : S.SKATING)
  }

  _endManual(emitOnly) {
    const t = this.sb.getTelemetry()
    const dur = this.balance.time
    this.sb.endManual()
    this.balance.stop()
    this.bus?.emit('manual:end', { type: t.manual.type, duration: dur })
    if (!emitOnly && this.state === S.MANUAL) this._setState(S.SKATING)
  }

  _enterBail(reason, fromLanding = false) {
    if (this.state === S.FALLING || this.state === S.RECOVERING) return
    const tel = this.sb.getTelemetry()
    if (this.grind.active) this.grind.end(this.sb, { pop: false })
    if (this.state === S.MANUAL) this._endManual(true)
    this.balance.stop()
    this.bailDirection.copy(tel.velocity).setY(0)
    if (this.bailDirection.lengthSq() > 1e-4) this.bailDirection.normalize()
    else this.bailDirection.set(0, 0, 1).applyQuaternion(tel.quaternion)
    this.sb.bail()
    this.board.setAttached?.(false)
    this.tricks.onBail(reason)
    this.bailTime = 0
    this._setState(S.FALLING)
    this.bus?.emit('skater:bail', { reason, position: tel.position.clone(), velocity: tel.velocity.clone(), fromLanding })
  }

  // --------------------------------------------------------------------------------------------
  // Caminar / montar
  // --------------------------------------------------------------------------------------------
  _dismount() {
    const tel = this.sb.getTelemetry()
    _fwd.set(0, 0, 1).applyQuaternion(tel.quaternion)
    const heading = Math.atan2(_fwd.x, _fwd.z)
    // el rider baja al lado de puntas
    _v.set(this.stance === 'goofy' ? 0.45 : -0.45, 0, 0).applyQuaternion(tel.quaternion)
    const feet = tel.position.clone().add(_v)
    feet.y = tel.position.y - this.sb.solver.rideHeight
    this.sb.bail() // deja la tabla como cuerpo suelto en el sitio
    this.sb.looseBoard?.setLinvel({ x: tel.velocity.x, y: 0, z: tel.velocity.z }, true)
    this.sb.looseBoard?.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.sb.setEnabled(false)
    this.board.setAttached?.(false)
    this.walking.enable(feet, heading + (this.stance === 'goofy' ? Math.PI / 2 : -Math.PI / 2))
    this._setState(S.WALKING)
    this.bus?.emit('skater:dismount', {})
  }

  _startMount() {
    this.mountTime = 0
    this._setState(S.MOUNTING_BOARD)
  }

  _finishMount() {
    const p = this.walking.position
    const loose = this.sb.looseBoard
    let target = p
    let yaw = this.walking.heading - (this.stance === 'goofy' ? Math.PI / 2 : -Math.PI / 2)
    if (loose) {
      const lp = loose.translation()
      _v.set(lp.x, lp.y, lp.z)
      if (_v.distanceTo(p) < 1.5) {
        target = _v.clone()
        target.y = p.y
      }
    }
    this.walking.disable()
    this.sb.reset(target, yaw)
    this.board.setAttached?.(true)
    this._setState(S.SKATING)
    this.bus?.emit('skater:mount', {})
  }

  // --------------------------------------------------------------------------------------------
  // Salidas para animación, cámara y depuración
  // --------------------------------------------------------------------------------------------
  getTelemetry() {
    return this.sb.getTelemetry()
  }

  getAnimationContext(alpha) {
    const c = this._ctx
    const tel = this.sb.getTelemetry()
    c.state = this.state
    c.telemetry = tel
    c.intent = this._intent
    c.stance = this.stance
    c.crouch = tel.crouch
    c.lean = tel.lean
    c.walkSpeed = 0
    c.bail.active = this.state === S.FALLING || this.state === S.RECOVERING
    c.bail.time = this.bailTime
    c.landingImpact = tel.lastLanding.impact * Math.max(0, 1 - tel.lastLanding.time / 0.45)
    c.pushPhase = this.sb.pushTimer >= 0 ? this.sb.pushTimer / this.sb.P.pushCycle : -1
    if (this.walking.active) {
      this.walking.getInterpolated(alpha, c.rootPosition, c.rootQuaternion)
      c.boardAttached = false
      c.footAnchors = null
      c.walkSpeed = Math.abs(this.walking.speed)
    } else if (c.bail.active) {
      this.sb.getInterpolatedTransform(alpha, c.rootPosition, c.rootQuaternion)
      c.rootPosition.y -= this.sb.solver.rideHeight * 0.5
      c.rootQuaternion.multiply(this._stanceQuat)
      c.boardAttached = false
      c.footAnchors = null
    } else {
      this.sb.getInterpolatedTransform(alpha, c.rootPosition, c.rootQuaternion)
      c.rootQuaternion.multiply(this._stanceQuat)
      c.boardAttached = true
      this._anchors = this.board.visual.getFootAnchors(this.stance, this._anchors || undefined)
      c.footAnchors = this._anchors
    }
    const active = this.tricks.getActiveTrick?.()
    if (active) c.trick = active
    else if (this.sb.flip.active) {
      this._trickCtx.id = 'flip'
      this._trickCtx.category = 'flip'
      this._trickCtx.progress = this.sb.flip.progress
      c.trick = this._trickCtx
    } else c.trick = null
    return c
  }

  getCameraTarget(alpha) {
    const t = this._camTarget
    const tel = this.sb.getTelemetry()
    if (this.walking.active) {
      this.walking.getInterpolated(alpha, t.position, t.quaternion)
      t.velocity.set(Math.sin(this.walking.heading), 0, Math.cos(this.walking.heading)).multiplyScalar(this.walking.speed)
    } else {
      this.sb.getInterpolatedTransform(alpha, t.position, t.quaternion)
      t.velocity.copy(tel.velocity)
    }
    t.forward.set(0, 0, 1).applyQuaternion(t.quaternion)
    t.grounded = tel.grounded
    t.state = this.state
    return t
  }

  getDebugInfo() {
    const t = this.sb.getTelemetry()
    return {
      estado: this.state,
      kmh: t.speed * 3.6,
      ruedas: t.contactCount,
      aire: t.airTime,
      sup: t.surface,
      modo: this.mode,
      switch: t.isSwitch ? 'sí' : 'no',
    }
  }

  dispose() {
    this.collisions.dispose()
    this.walking.dispose()
  }
}
