import { Vector3, Quaternion, Matrix4 } from 'three/webgpu'
import { PHYSICS } from '../core/Config.js'
import { getSurface } from '../data/surfaces.js'

/**
 * Restricción del cuerpo del skater a una arista grindable (rail, ledge, coping…).
 *
 * Durante el grind el cuerpo pasa a ser cinemático (posición): se desplaza a lo largo de la polilínea
 * con una velocidad tangencial que integra la gravedad proyectada (rails inclinados) y la fricción de
 * grind de la superficie; la orientación depende del tipo (trucks paralelos o tabla perpendicular).
 * Al salir, el cuerpo vuelve a ser dinámico con la velocidad resultante.
 */

const GRAVITY = PHYSICS.gravity
const _p = new Vector3()
const _t = new Vector3()
const _up = new Vector3()
const _x = new Vector3()
const _z = new Vector3()
const _y = new Vector3()
const _lc = new Vector3()
const _m = new Matrix4()
const _q = new Quaternion()
const _qp = new Quaternion()
const _g = new Vector3(GRAVITY.x, GRAVITY.y, GRAVITY.z)
const _Y = new Vector3(0, 1, 0)

/** Tipos de grind: punto de contacto local de la tabla (relativo a la geometría) y pitch. */
export const GRIND_TYPES = Object.freeze({
  '5050': { family: 'grind', perpendicular: false, contact: 'trucks', pitch: 0, label: '50-50 Grind' },
  '5-0': { family: 'grind', perpendicular: false, contact: 'backTruck', pitch: 0.2, label: '5-0 Grind' },
  nosegrind: { family: 'grind', perpendicular: false, contact: 'frontTruck', pitch: -0.2, label: 'Nosegrind' },
  boardslide: { family: 'slide', perpendicular: true, contact: 'deck', pitch: 0, label: 'Boardslide' },
  noseslide: { family: 'slide', perpendicular: true, contact: 'nose', pitch: 0, label: 'Noseslide' },
  tailslide: { family: 'slide', perpendicular: true, contact: 'tail', pitch: 0, label: 'Tailslide' },
})

/** Datos precomputados de una polilínea (longitudes acumuladas). */
const edgeCache = new WeakMap()
export function edgeMetrics(edge) {
  let m = edgeCache.get(edge)
  if (m) return m
  const pts = edge.points
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
  m = { cum, length: cum[cum.length - 1] }
  edgeCache.set(edge, m)
  return m
}

/** Punto y tangente a distancia s a lo largo de la polilínea. */
export function sampleEdge(edge, s, outPoint, outTangent) {
  const { cum } = edgeMetrics(edge)
  const pts = edge.points
  let i = 1
  while (i < pts.length - 1 && cum[i] < s) i++
  const a = pts[i - 1]
  const b = pts[i]
  const segLen = cum[i] - cum[i - 1] || 1e-6
  const u = Math.min(1, Math.max(0, (s - cum[i - 1]) / segLen))
  outPoint.lerpVectors(a, b, u)
  outTangent.subVectors(b, a).normalize()
  return i - 1
}

export class GrindPhysics {
  /**
   * @param {Object} o
   * @param {any} o.RAPIER
   * @param {any} o.body
   * @param {ReturnType<import('../skateboard/SkateboardSetup.js').computeBoardGeometry>} o.geometry
   * @param {number} o.deckThickness
   */
  constructor({ RAPIER, body, geometry, deckThickness }) {
    this.RAPIER = RAPIER
    this.body = body
    this.geo = geometry
    this.deckThickness = deckThickness
    this.active = false
    this.edge = null
    this.type = null
    this.s = 0
    this.vs = 0 // velocidad con signo a lo largo de la tangente
    this.dirSign = 1
    this.side = 1
    this.time = 0
    this.distance = 0
    this.position = new Vector3()
    this.quaternion = new Quaternion()
    this.velocity = new Vector3()
    this.edgeUp = new Vector3(0, 1, 0)
    this.tangent = new Vector3(1, 0, 0)
    this.balanceLean = 0
  }

  /**
   * @param {{edge:any, s:number, type:string, speed:number, vAlong?:number, dirSign:number, side:number}} info  dirSign = orientación de la tabla (+Z según la tangente)
   */
  attach(info) {
    this.active = true
    this.edge = info.edge
    this.type = info.type
    this.s = info.s
    this.dirSign = info.dirSign
    this.side = info.side
    this.vs = info.vAlong ?? info.speed * info.dirSign // velocidad con signo a lo largo de la tangente
    this.time = 0
    this.distance = 0
    this.balanceLean = 0
    this.body.setBodyType(this.RAPIER.RigidBodyType.KinematicPositionBased, true)
    this._computePose()
    this.body.setTranslation(this.position, true)
    this.body.setRotation(this.quaternion, true)
  }

  /** Contacto local de la tabla que apoya sobre la arista. */
  _localContact(out) {
    const g = this.geo
    const hangerR = 0.012
    switch (GRIND_TYPES[this.type]?.contact) {
      case 'trucks':
        return out.set(0, g.axleY - hangerR, 0)
      case 'backTruck':
        return out.set(0, g.axleY - hangerR, -g.halfBase)
      case 'frontTruck':
        return out.set(0, g.axleY - hangerR, g.halfBase)
      case 'nose':
        return out.set(0, -this.deckThickness, g.halfBase + 0.1)
      case 'tail':
        return out.set(0, -this.deckThickness, -(g.halfBase + 0.1))
      default:
        return out.set(0, -this.deckThickness, 0)
    }
  }

  _computePose() {
    sampleEdge(this.edge, this.s, _p, _t)
    this.tangent.copy(_t)
    // normal de la arista ortogonalizada respecto a la tangente
    _up.copy(this.edge.up || _Y)
    _up.addScaledVector(_t, -_up.dot(_t)).normalize()
    this.edgeUp.copy(_up)
    const def = GRIND_TYPES[this.type]
    if (def.perpendicular) {
      _z.crossVectors(_up, _t).multiplyScalar(this.side)
    } else {
      _z.copy(_t).multiplyScalar(this.dirSign)
    }
    _y.copy(_up)
    _x.crossVectors(_y, _z).normalize()
    _m.makeBasis(_x, _y, _z)
    this.quaternion.setFromRotationMatrix(_m)
    if (def.pitch) {
      _qp.setFromAxisAngle(_x, -def.pitch) // pitch > 0: nariz arriba
      this.quaternion.premultiply(_qp)
    }
    // posición: punto de la arista + radio − R·contacto
    const radius = this.edge.radius ?? 0.01
    this._localContact(_lc).applyQuaternion(this.quaternion)
    this.position.copy(_p).addScaledVector(_up, radius).sub(_lc)
  }

  /**
   * Avanza el grind un paso fijo.
   * @returns {'continue'|'end'|'stall'} 'end' al salir por un extremo; 'stall' si la velocidad se agota
   */
  step(dt) {
    if (!this.active) return 'end'
    const surf = getSurface(this.edge.surface || 'metal')
    sampleEdge(this.edge, this.s, _p, _t)
    const gAlong = _g.dot(_t) // la gravedad acelera en rails inclinados
    const fr = surf.grindFriction * (GRIND_TYPES[this.type].family === 'slide' ? 1.15 : 1)
    this.vs += gAlong * dt
    const sign = Math.sign(this.vs) || this.dirSign
    const dec = fr * dt
    if (Math.abs(this.vs) <= dec) this.vs = 0
    else this.vs -= sign * dec
    const ds = this.vs * dt
    this.s += ds
    this.distance += Math.abs(ds)
    this.time += dt
    const len = edgeMetrics(this.edge).length
    let result = 'continue'
    if (this.s < 0 || this.s > len) {
      this.s = Math.min(len, Math.max(0, this.s))
      result = 'end'
    } else if (Math.abs(this.vs) < 0.35) {
      result = 'stall'
    }
    this._computePose()
    this.velocity.copy(this.tangent).multiplyScalar(this.vs)
    this.body.setNextKinematicTranslation(this.position)
    this.body.setNextKinematicRotation(this.quaternion)
    return result
  }

  /**
   * Termina el grind y devuelve el cuerpo a dinámico.
   * @param {{popSpeed?:number, sideSpeed?:number}} [o]
   */
  detach({ popSpeed = 0.6, sideSpeed = 0 } = {}) {
    if (!this.active) return
    this.active = false
    const b = this.body
    b.setBodyType(this.RAPIER.RigidBodyType.Dynamic, true)
    b.setTranslation(this.position, true)
    b.setRotation(this.quaternion, true)
    _x.crossVectors(this.edgeUp, this.tangent)
    const v = this.velocity
    b.setLinvel({ x: v.x + this.edgeUp.x * popSpeed + _x.x * sideSpeed, y: v.y + this.edgeUp.y * popSpeed + _x.y * sideSpeed, z: v.z + this.edgeUp.z * popSpeed + _x.z * sideSpeed }, true)
    b.setAngvel({ x: 0, y: 0, z: 0 }, true)
    this.edge = null
  }
}
