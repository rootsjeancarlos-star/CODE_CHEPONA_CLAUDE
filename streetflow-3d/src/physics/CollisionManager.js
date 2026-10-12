/**
 * Detecta choques del skater a partir de los eventos de fuerza de contacto de Rapier.
 * Choque fuerte del cuerpo del rider (cápsula) o golpe lateral del deck → caída; leve → evento de rebote.
 */
export class CollisionManager {
  /**
   * @param {{physics: import('./PhysicsWorld.js').PhysicsWorld, bus?: any}} o
   */
  constructor({ physics, bus = null }) {
    this.physics = physics
    this.bus = bus
    this.pendingBail = null
    this.riderBailForce = 5200 // N
    this.deckBailForce = Infinity // el deck solo produce rebotes (los aterrizajes duros lo apoyan en el suelo)
    this.cooldown = 0
    this._off = physics.onCollision((e) => this._onCollision(e))
  }

  _onCollision(e) {
    if (e.force == null) return
    const d1 = this.physics.getColliderData(e.collider1)
    const d2 = this.physics.getColliderData(e.collider2)
    const mine = d1?.kind?.startsWith('skater') ? d1 : d2?.kind?.startsWith('skater') ? d2 : null
    if (!mine) return
    const other = mine === d1 ? d2 : d1
    if (other?.kind === 'looseBoard') return
    const threshold = mine.kind === 'skaterRider' ? this.riderBailForce : this.deckBailForce
    if (e.force >= threshold && this.cooldown <= 0) {
      this.pendingBail = { reason: mine.kind === 'skaterRider' ? 'choque' : 'golpe de tabla', force: e.force, surface: other?.surface || 'concrete' }
    } else if (e.force > threshold * 0.25) {
      this.bus?.emit('skater:collision', { impulse: e.force / 60, normal: e.direction || null, surface: other?.surface || 'concrete' })
    }
  }

  /** Devuelve y limpia el choque pendiente (si lo hay). */
  consumeBail() {
    const b = this.pendingBail
    this.pendingBail = null
    return b
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt
  }

  dispose() {
    this._off?.()
  }
}
