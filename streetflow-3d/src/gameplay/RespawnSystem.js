import { Vector3 } from 'three/webgpu'

const _fwd = new Vector3()
const _p = new Vector3()

/**
 * Reapariciones: R (punto más cercano), G/T (marcador del jugador por nivel), automática tras una caída
 * (última posición segura) y al salir de los límites del nivel.
 */
export class RespawnSystem {
  constructor({ bus, world, save }) {
    this.bus = bus
    this.world = world
    this.save = save
    this.time = 0
    this.safe = [] // {position:Vector3, yaw, t}
    this._sampleTimer = 0
  }

  _yawOf(q) {
    _fwd.set(0, 0, 1).applyQuaternion(q)
    return Math.atan2(_fwd.x, _fwd.z)
  }

  _levelId() {
    return this.world?.current?.id || 'skatepark'
  }

  /** Punto de reaparición más cercano a una posición. */
  nearestRespawn(position) {
    const pts = this.world?.getRespawnPoints?.() || []
    let best = this.world?.getSpawn?.() || { position: [0, 0, 0], yaw: 0 }
    let bestD = Infinity
    for (const sp of pts) {
      const d = _p.set(sp.position[0], sp.position[1], sp.position[2]).distanceToSquared(position)
      if (d < bestD) {
        bestD = d
        best = sp
      }
    }
    return best
  }

  /** Última posición segura registrada al menos `minAge` s antes. */
  getSafeSpawn(minAge = 1.0, fallbackPosition = null) {
    for (let i = this.safe.length - 1; i >= 0; i--) {
      const s = this.safe[i]
      if (this.time - s.t >= minAge) return { position: [s.position.x, s.position.y, s.position.z], yaw: s.yaw }
    }
    return this.nearestRespawn(fallbackPosition || _p.set(0, 0, 0))
  }

  saveMarker(position, yaw) {
    const levelId = this._levelId()
    this.save?.update?.((d) => {
      d.markers = d.markers || {}
      d.markers[levelId] = { position: [position.x, position.y, position.z], yaw }
    })
    this.bus?.emit('marker:saved', { position })
    this.bus?.emit('ui:notify', { text: 'Marcador guardado (T para volver)', kind: 'success', duration: 2 })
  }

  getMarker() {
    return this.save?.data?.markers?.[this._levelId()] || null
  }

  /**
   * @param {number} dt
   * @param {import('../physics/SkateboardPhysics.js').createTelemetry} tel
   * @param {Object} intent
   * @param {import('../player/PlayerController.js').PlayerController} player
   */
  fixedUpdate(dt, tel, intent, player) {
    this.time += dt
    const onBoard = player.isOnBoard?.() ?? true
    // historial de posiciones seguras
    this._sampleTimer += dt
    if (this._sampleTimer >= 0.4 && onBoard && player.isStable?.()) {
      this._sampleTimer = 0
      this.safe.push({ position: tel.position.clone(), yaw: this._yawOf(tel.quaternion), t: this.time })
      if (this.safe.length > 40) this.safe.shift()
    }
    if (!intent) return
    if (intent.resetPressed) {
      player.respawnAt(this.nearestRespawn(tel.position), 'reset')
      return
    }
    if (intent.saveMarkerPressed) {
      if (player.isStable?.()) this.saveMarker(tel.position, this._yawOf(tel.quaternion))
      else this.bus?.emit('ui:notify', { text: 'Para guardar un marcador, detente en el suelo', kind: 'warn', duration: 2 })
    }
    if (intent.loadMarkerPressed) {
      const m = this.getMarker()
      if (m) {
        player.respawnAt(m, 'marker')
        this.bus?.emit('marker:loaded', { position: m.position })
      } else this.bus?.emit('ui:notify', { text: 'No hay marcador guardado (G para guardar)', kind: 'info', duration: 2 })
    }
    // fuera de límites
    const b = this.world?.getBounds?.()
    const minY = b ? b.min.y - 6 : -20
    const outXZ = b && (tel.position.x < b.min.x - 15 || tel.position.x > b.max.x + 15 || tel.position.z < b.min.z - 15 || tel.position.z > b.max.z + 15)
    if (tel.position.y < minY || outXZ) player.respawnAt(this.nearestRespawn(tel.position), 'outOfBounds')
  }

  reset() {
    this.safe.length = 0
  }
}
