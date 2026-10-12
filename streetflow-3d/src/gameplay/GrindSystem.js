import { Vector3 } from 'three/webgpu'
import { SKATER } from '../core/Config.js'
import { edgeMetrics } from '../physics/GrindPhysics.js'

const DEG = Math.PI / 180
const _bottom = new Vector3()
const _up = new Vector3()
const _fwd = new Vector3()
const _edgeUp = new Vector3()
const _horiz = new Vector3()
const _side = new Vector3()
const _Y = new Vector3(0, 1, 0)

/**
 * Detección y gestión de grinds/slides (docs/ARCHITECTURE.md §7.5).
 * Captura: tabla por encima de la arista y descendiendo/nivelada, a menos del radio de captura del modo
 * (sin imanes desde distancias irreales), con velocidad tangencial suficiente. El tipo depende del ángulo
 * entre la tabla y la arista y de la entrada (↑ nosegrind/noseslide, ↓ 5-0/tailslide).
 */
export class GrindSystem {
  constructor({ bus, spots, board, balance }) {
    this.bus = bus
    this.spots = spots
    this.board = board
    this.balance = balance
    this.active = false
    this.current = null
    this._hits = []
    this.cooldown = 0
    this.lastEdgeId = null
  }

  /**
   * @param {import('../physics/SkateboardPhysics.js').SkateboardPhysics} sb
   * @param {Object} intent InputIntent
   * @param {'arcade'|'realistic'} mode
   * @returns {?{edge, s, type, speed, dirSign, side}}
   */
  tryCapture(sb, intent, mode) {
    if (this.active || this.cooldown > 0 || !this.spots) return null
    const tel = sb.getTelemetry()
    const wants = intent?.grind || (mode === 'arcade' && !tel.grounded)
    if (!wants) return null
    const capture = SKATER.modes[mode].grindCapture
    _up.set(0, 1, 0).applyQuaternion(tel.quaternion)
    _fwd.set(0, 0, 1).applyQuaternion(tel.quaternion)
    // punto inferior de la tabla (entre los ejes)
    _bottom.copy(tel.position).addScaledVector(_up, sb.geo.axleY)
    const hits = this.spots.queryEdges(_bottom, capture + 0.6, this._hits)
    let best = null
    let bestScore = Infinity
    for (const h of hits) {
      const edge = h.edge
      _edgeUp.copy(edge.up || _Y)
      _edgeUp.addScaledVector(h.tangent, -_edgeUp.dot(h.tangent)).normalize()
      // altura de la tabla sobre la arista y distancia lateral (perpendicular a tangente y normal)
      const dx = _horiz.subVectors(_bottom, h.point)
      const height = dx.dot(_edgeUp)
      _side.crossVectors(_edgeUp, h.tangent)
      const lateral = Math.abs(dx.dot(_side))
      if (lateral > capture) continue
      if (height < -0.07 || height > 0.32) continue
      const vUp = tel.velocity.dot(_edgeUp)
      if (vUp > 0.8) continue // subiendo con fuerza: aún no
      const vAlong = tel.velocity.dot(h.tangent)
      if (Math.abs(vAlong) < 1.0) continue
      // ángulo tabla-arista (0..90°)
      const c = Math.abs(_fwd.dot(h.tangent))
      const angle = Math.acos(Math.min(1, c)) / DEG
      let family
      if (angle <= 30) family = 'grind'
      else if (angle >= 55) family = 'slide'
      else continue
      const score = lateral + Math.abs(height) * 0.5
      const len = edgeMetrics(edge).length
      const s = this._arcLength(edge, h.segment, h.t)
      if (s <= 0.05 || s >= len - 0.05) continue
      if (score < bestScore) {
        bestScore = score
        let type
        const m = intent?.manual || 0
        if (family === 'grind') type = m > 0 ? 'nosegrind' : m < 0 ? '5-0' : '5050'
        else type = m > 0 ? 'noseslide' : m < 0 ? 'tailslide' : 'boardslide'
        const dirSign = _fwd.dot(h.tangent) >= 0 ? 1 : -1
        const side = _fwd.dot(_side) >= 0 ? 1 : -1
        best = { edge, s, type, speed: Math.abs(vAlong), vAlong, dirSign, side, family }
      }
    }
    return best
  }

  _arcLength(edge, segment, t) {
    const { cum } = edgeMetrics(edge)
    const a = cum[segment]
    const b = cum[segment + 1] ?? a
    return a + (b - a) * t
  }

  /** Inicia el grind en la física y el equilibrio. */
  begin(sb, info, mode) {
    sb.attachGrind(info)
    this.active = true
    this.current = info
    this.lastEdgeId = info.edge.id
    const diff = SKATER.modes[mode].balanceDifficulty * (info.family === 'slide' ? 1.1 : 1)
    this.balance.start('grind', diff, 0)
    this.bus?.emit('grind:start', { type: info.type, spotId: info.edge.id, surface: info.edge.surface || 'metal', family: info.family })
  }

  /**
   * @returns {'continue'|'exit'|'bail'|'pop'}
   */
  update(dt, sb, intent, mode) {
    if (!this.active) return 'exit'
    if (intent?.popPressed) {
      this.end(sb, { pop: true })
      return 'pop'
    }
    const v = this.balance.update(dt, intent?.steer || 0)
    sb.grind.balanceLean = v
    const res = sb.stepGrind(dt)
    if (this.balance.isLost()) {
      const bail = SKATER.modes[mode].bailOnBalanceLoss
      this.end(sb, { pop: false, sideSpeed: Math.sign(v) * 1.2 })
      return bail ? 'bail' : 'exit'
    }
    if (res === 'end' || res === 'stall') {
      this.end(sb, { pop: false })
      return 'exit'
    }
    return 'continue'
  }

  end(sb, { pop = false, sideSpeed = 0 } = {}) {
    if (!this.active) return
    const g = sb.grind
    const payload = { type: g.type, spotId: g.edge?.id ?? null, surface: g.edge?.surface || 'metal', duration: g.time, distance: g.distance, family: this.current?.family }
    sb.detachGrind({ pop, sideSpeed })
    this.active = false
    this.current = null
    this.balance.stop()
    this.cooldown = 0.25
    this.bus?.emit('grind:end', payload)
  }

  fixedUpdate(dt) {
    if (this.cooldown > 0) this.cooldown -= dt
  }

  reset() {
    this.active = false
    this.current = null
    this.cooldown = 0
    this.balance.stop()
  }
}
