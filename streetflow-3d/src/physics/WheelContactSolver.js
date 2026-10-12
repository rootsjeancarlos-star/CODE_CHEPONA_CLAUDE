import { Vector3, Quaternion } from 'three/webgpu'
import { PHYSICS } from '../core/Config.js'
import { getSurface } from '../data/surfaces.js'

/**
 * Suspensión por rayos de las 4 ruedas (docs/ARCHITECTURE.md §7.3).
 *
 * Por cada subpaso de Rapier:
 *  1. Lanza un rayo por rueda desde el truck a lo largo de −Y local del cuerpo.
 *  2. Muelle–amortiguador a lo largo de la normal del contacto (con tope que evita rebotes al aterrizar).
 *  3. Fricción lateral limitada por µ·N (permite derrapes) y resistencia a la rodadura por superficie.
 *  4. Par de equilibrio que alinea la tabla con la normal media del suelo (el "equilibrio del rider"),
 *     con prealimentación de la curvatura para seguir transiciones sin retrasarse.
 *
 * Las fuerzas de Rapier PERSISTEN entre pasos: se reinician al principio de cada subpaso.
 * Parámetros validados con tools/proto/wheel-raycast-proto.mjs (8/8 escenarios: plano, pendiente,
 * quarter pipe, ollie y carve).
 */

const GRAVITY = -PHYSICS.gravity.y

// Temporales de módulo (sin asignaciones en el bucle)
const _q = new Quaternion()
const _qs = new Quaternion()
const _pos = new Vector3()
const _up = new Vector3()
const _fwd = new Vector3()
const _rayDir = new Vector3()
const _origin = new Vector3()
const _com = new Vector3()
const _r = new Vector3()
const _vP = new Vector3()
const _tFwd = new Vector3()
const _tLat = new Vector3()
const _wheelFwd = new Vector3()
const _f = new Vector3()
const _pT = new Vector3()
const _tmp = new Vector3()
const _tmp2 = new Vector3()
const _nSum = new Vector3()
const _target = new Vector3()
const _axis = new Vector3()
const _tau = new Vector3()
const _w = new Vector3()
const _wTarget = new Vector3()
const _nF = new Vector3()
const _nR = new Vector3()
const _bodyX = new Vector3()
const _Y = new Vector3(0, 1, 0)

export const WHEEL_DEFAULTS = Object.freeze({
  rayOriginY: 0.05, // origen del rayo por encima del origen del cuerpo (tolera penetraciones)
  probeLength: 1.5, // longitud del rayo (detecta el suelo antes de aterrizar)
  suspFreq: 8, // Hz
  suspZeta: 1.0,
  suspMaxForce: 25000, // N por rueda
  dampClampFrac: 1,
  contactTol: 0.004,
  muLat: 0.9,
  grip: 0.8,
  vStop: 0.15,
  alignFreq: 4,
  alignZeta: 1.0,
  airAlignFreq: 1.5,
  airAlignZeta: 1.0,
  curvatureFF: true,
})

/** Masa efectiva en el punto (_r respecto al COM) a lo largo de d, repartida entre las ruedas en contacto. */
function effMass(invMass, invI, nContact, d) {
  _tmp.crossVectors(_r, d)
  sdpMul(invI, _tmp, _tmp2)
  return 1 / (invMass + _tmp.dot(_tmp2)) / nContact
}

function sdpMul(M, v, out) {
  return out.set(M.m11 * v.x + M.m12 * v.y + M.m13 * v.z, M.m21 * v.x + M.m22 * v.y + M.m23 * v.z, M.m31 * v.x + M.m32 * v.y + M.m33 * v.z)
}

export class WheelContactSolver {
  /**
   * @param {Object} o
   * @param {import('./PhysicsWorld.js').PhysicsWorld} o.physics
   * @param {any} o.body RAPIER.RigidBody
   * @param {ReturnType<import('../skateboard/SkateboardSetup.js').computeBoardGeometry>} o.geometry
   * @param {{mass:number, comY:number, inertia:{x:number,y:number,z:number}}} o.massProps
   * @param {Partial<typeof WHEEL_DEFAULTS>} [o.params]
   */
  constructor({ physics, body, geometry, massProps, params = {} }) {
    this.physics = physics
    this.RAPIER = physics.RAPIER
    this.body = body
    this.geo = geometry
    this.mass = massProps.mass
    this.comY = massProps.comY
    this.inertia = massProps.inertia
    this.p = { ...WHEEL_DEFAULTS, ...params }
    const omega = 2 * Math.PI * this.p.suspFreq
    this.k = (this.mass * omega * omega) / 4
    this.c = (2 * this.p.suspZeta * this.mass * omega) / 4
    this.sag = (this.mass * GRAVITY) / (4 * this.k)
    this.restLen = this.p.rayOriginY - geometry.axleY + geometry.wheelRadius + this.sag
    /** altura del origen del cuerpo sobre el suelo en equilibrio estático */
    this.rideHeight = this.restLen - this.sag - this.p.rayOriginY
    this.wheels = geometry.wheelCenters.map((c, i) => ({
      index: i,
      name: ['FL', 'FR', 'RL', 'RR'][i],
      x: c[0],
      z: c[2],
      front: i < 2,
      contact: false,
      near: false,
      dist: Infinity,
      normal: new Vector3(0, 1, 0),
      point: new Vector3(),
      N: 0,
      vFwd: 0,
      collider: null,
      surface: 'concrete',
    }))
    this.steer = 0
    /** máscara de ruedas ignoradas (bit i = rueda i): manuals */
    this.disabledMask = 0
    this.ray = new this.RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 })
    this.invInertia = new this.RAPIER.SdpMatrix3(new Float32Array(6))
    this.groups = PHYSICS.GROUP_SETS.wheelRay
    this.result = { nContact: 0, nNear: 0, grounded: false, totalN: 0, avgNormal: new Vector3(0, 1, 0), nearestDist: Infinity, surface: 'concrete' }
    /** parámetros de superficie por rueda en contacto */
    this.rollingScale = 1
    this.lateralScale = 1
    this._stopAssist = false
  }

  setSteer(angle) {
    this.steer = angle
  }

  /**
   * Lanza los rayos (sin aplicar fuerzas). Útil para consultas de aterrizaje.
   */
  probe() {
    const body = this.body
    const rq = body.rotation()
    _q.set(rq.x, rq.y, rq.z, rq.w)
    const t = body.translation()
    _pos.set(t.x, t.y, t.z)
    _up.set(0, 1, 0).applyQuaternion(_q)
    _rayDir.copy(_up).negate()
    const res = this.result
    res.nContact = 0
    res.nNear = 0
    res.nearestDist = Infinity
    _nSum.set(0, 0, 0)
    const FLAGS = this.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS
    for (const w of this.wheels) {
      w.contact = false
      w.near = false
      w.N = 0
      if (this.disabledMask & (1 << w.index)) {
        w.dist = Infinity
        continue
      }
      _origin.set(w.x, this.p.rayOriginY, w.z).applyQuaternion(_q).add(_pos)
      this.ray.origin.x = _origin.x
      this.ray.origin.y = _origin.y
      this.ray.origin.z = _origin.z
      this.ray.dir.x = _rayDir.x
      this.ray.dir.y = _rayDir.y
      this.ray.dir.z = _rayDir.z
      const hit = this.physics.world.castRayAndGetNormal(this.ray, this.p.probeLength, true, FLAGS, this.groups, undefined, body)
      if (!hit) {
        w.dist = Infinity
        continue
      }
      w.dist = hit.timeOfImpact
      w.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
      if (w.normal.dot(_up) < 0) w.normal.negate() // trimesh de doble cara
      w.point.copy(_origin).addScaledVector(_rayDir, w.dist)
      w.collider = hit.collider
      w.surface = this.physics.getColliderData(hit.collider)?.surface || 'concrete'
      w.near = true
      res.nNear++
      _nSum.add(w.normal)
      if (w.dist < res.nearestDist) res.nearestDist = w.dist
      if (w.dist <= this.restLen + this.p.contactTol) {
        w.contact = true
        res.nContact++
      }
    }
    res.grounded = res.nContact >= 2
    if (res.nNear > 0) res.avgNormal.copy(_nSum).normalize()
    else res.avgNormal.set(0, 1, 0)
    // superficie dominante: la de la primera rueda en contacto
    for (const w of this.wheels) {
      if (w.contact) {
        res.surface = w.surface
        break
      }
    }
    return res
  }

  /**
   * Aplica las fuerzas de un subpaso. Llamar antes de world.step().
   * @param {number} dt subpaso
   * @param {Object} o
   * @param {boolean} [o.springs=true] aplicar muelles/fricción (false durante la ventana del pop o un grind)
   * @param {boolean} [o.align=true] aplicar el par de equilibrio
   * @param {?Vector3} [o.alignTarget] normal objetivo (por defecto: normal media o +Y en el aire)
   * @param {number} [o.pitchOffset=0] rad de pitch (alrededor de X local) sobre la normal objetivo (manuals)
   * @param {number} [o.alignScale=1] multiplicador de la rigidez de alineación (asistencias por modo)
   * @param {number} [o.airAlignScale=1]
   * @param {boolean} [o.yawFree=true] no amortiguar el giro alrededor de la normal
   */
  solve(dt, o = {}) {
    const p = this.p
    const body = this.body
    body.resetForces(true)
    body.resetTorques(true)
    const res = this.probe()
    const springs = o.springs !== false
    const nContact = res.nContact

    const rq = body.rotation()
    _q.set(rq.x, rq.y, rq.z, rq.w)
    _up.set(0, 1, 0).applyQuaternion(_q)
    _fwd.set(0, 0, 1).applyQuaternion(_q)
    const wc = body.worldCom()
    _com.set(wc.x, wc.y, wc.z)
    const invMass = body.invMass()
    const invI = body.effectiveWorldInvInertia(this.invInertia)

    let totalN = 0
    if (springs && nContact > 0) {
      for (const w of this.wheels) {
        if (!w.contact) continue
        const n = w.normal
        _r.copy(w.point).sub(_com)
        const v = body.velocityAtPoint(w.point)
        _vP.set(v.x, v.y, v.z)
        const surf = getSurface(w.surface)
        const compression = Math.max(0, this.restLen - w.dist)
        const xdot = -_vP.dot(n)
        let fDamp = this.c * xdot
        const fDampMax = (p.dampClampFrac * effMass(invMass, invI, nContact, n) * Math.abs(xdot)) / dt
        fDamp = Math.min(fDampMax, Math.max(-fDampMax, fDamp))
        const N = Math.min(p.suspMaxForce, Math.max(0, this.k * compression + fDamp))
        w.N = N
        totalN += N
        _f.copy(n).multiplyScalar(N)
        body.addForceAtPoint(_f, w.point, true)

        // Ejes de rodadura con dirección de trucks: delantero +steer, trasero −steer
        const steer = w.front ? this.steer : -this.steer
        _wheelFwd.copy(_fwd)
        if (steer !== 0) _wheelFwd.applyQuaternion(_qs.setFromAxisAngle(_up, steer))
        _tFwd.copy(_wheelFwd).addScaledVector(n, -_wheelFwd.dot(n)).normalize()
        _tLat.crossVectors(n, _tFwd).normalize()
        const vLat = _vP.dot(_tLat)
        const vFwd = _vP.dot(_tFwd)
        w.vFwd = vFwd
        const muLat = p.muLat * surf.lateralGrip * this.lateralScale
        const mLat = effMass(invMass, invI, nContact, _tLat)
        const fLat = Math.min(muLat * N, Math.max(-muLat * N, (-vLat * mLat * p.grip) / dt))
        const fRollMax = surf.rollingResistance * this.rollingScale * N
        let fRoll
        if (Math.abs(vFwd) > p.vStop) fRoll = -Math.sign(vFwd) * fRollMax
        else fRoll = Math.min(fRollMax, Math.max(-fRollMax, (-vFwd * effMass(invMass, invI, nContact, _tFwd)) / dt))
        _f.copy(_tLat).multiplyScalar(fLat).addScaledVector(_tFwd, fRoll)
        body.addForceAtPoint(_f, w.point, true)
      }
    }
    res.totalN = totalN

    // Par de equilibrio / alineación
    if (o.align !== false) {
      const grounded = res.grounded && springs
      if (o.alignTarget) _target.copy(o.alignTarget)
      else if (res.nNear > 0) _target.copy(res.avgNormal)
      else _target.copy(_Y)
      if (o.pitchOffset) {
        _bodyX.set(1, 0, 0).applyQuaternion(_q)
        _target.applyQuaternion(_qs.setFromAxisAngle(_bodyX, o.pitchOffset))
      }
      const I = 0.5 * (this.inertia.x + this.inertia.z)
      const f = grounded ? p.alignFreq * (o.alignScale ?? 1) : p.airAlignFreq * (o.airAlignScale ?? 1)
      if (f > 0) {
        const z = grounded ? p.alignZeta : p.airAlignZeta
        const wn = 2 * Math.PI * f
        const hCom = this.comY + this.rideHeight
        const kA = I * wn * wn + (grounded ? this.mass * GRAVITY * Math.max(0, hCom) : 0)
        const cA = 2 * z * I * wn
        _axis.crossVectors(_up, _target)
        const s = _axis.length()
        const ang = Math.atan2(s, _up.dot(_target))
        if (s > 1e-9) _tau.copy(_axis).multiplyScalar((kA * ang) / s)
        else _tau.set(0, 0, 0)
        if (p.curvatureFF && grounded) this._surfaceAngularVelocity(_wTarget)
        else _wTarget.set(0, 0, 0)
        const av = body.angvel()
        _w.set(av.x, av.y, av.z).sub(_wTarget)
        if (o.yawFree !== false) _w.addScaledVector(_target, -_w.dot(_target))
        _tau.addScaledVector(_w, -cA)
        body.addTorque(_tau, true)
      }
    }
    return res
  }

  /** Velocidad angular necesaria para seguir la curvatura del suelo (rad/s), ver el prototipo. */
  _surfaceAngularVelocity(out) {
    _nF.set(0, 0, 0)
    _nR.set(0, 0, 0)
    let cF = 0
    let cR = 0
    let vFwd = 0
    let n = 0
    for (const w of this.wheels) {
      if (!w.contact) continue
      if (w.front) {
        _nF.add(w.normal)
        cF++
      } else {
        _nR.add(w.normal)
        cR++
      }
      vFwd += w.vFwd
      n++
    }
    if (!cF || !cR) return out.set(0, 0, 0)
    _nF.normalize()
    _nR.normalize()
    _axis.crossVectors(_nR, _nF)
    const s = _axis.length()
    if (s < 1e-6) return out.set(0, 0, 0)
    const curvature = Math.atan2(s, _nR.dot(_nF)) / (this.geo.halfBase * 2)
    vFwd /= n
    return out.copy(_axis).multiplyScalar((curvature * vFwd) / s)
  }
}
