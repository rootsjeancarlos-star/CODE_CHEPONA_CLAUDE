const GROUND_STATES = new Set(['SKATING', 'PUSHING', 'BRAKING', 'IDLE', 'CROUCHING'])
const REPEAT_FACTORS = [1, 0.75, 0.5, 0.25]

/**
 * Combos y puntuación (docs/ARCHITECTURE.md §8.3).
 * - Cada truco completado entra en el combo con penalización por repetición (1, 0.75, 0.5, 0.25).
 * - Multiplicador = nº de trucos distintos + 0.5 por grind/manual sostenido > 1 s.
 * - El combo sigue mientras se encadena (aire → grind/manual → aire); se cobra tras estar rodando
 *   normal más de `grace` s y se pierde con una caída.
 */
export class ComboSystem {
  constructor({ bus }) {
    this.bus = bus
    this.grace = 0.65
    this.score = 0
    this.bestCombo = 0
    this.state = { active: false, tricks: [], baseScore: 0, multiplier: 1, total: 0, score: 0, lastTrick: null, graceRemaining: 0, lastResult: null }
    this._ids = new Map()
    this._sustainedBonus = 0
    this._groundTime = 0
    this._offs = []
    if (bus?.on) {
      this._offs.push(
        bus.on('trick:completed', (t) => this.addTrick(t)),
        bus.on('skater:bail', () => this.fail()),
        bus.on('skater:respawn', (p) => p?.reason !== 'bail' && this.cancel()),
      )
    }
  }

  addTrick(t) {
    const s = this.state
    const n = this._ids.get(t.id) || 0
    this._ids.set(t.id, n + 1)
    const factor = REPEAT_FACTORS[Math.min(n, REPEAT_FACTORS.length - 1)]
    const points = Math.round(t.score * factor)
    s.active = true
    s.tricks.push({ id: t.id, name: t.displayName || t.name, points, factor })
    s.baseScore += points
    if ((t.category === 'grind' || t.category === 'slide' || t.category === 'manual') && (t.duration || 0) > 1) this._sustainedBonus += 0.5
    s.multiplier = this._ids.size + this._sustainedBonus
    s.total = Math.round(s.baseScore * s.multiplier)
    s.lastTrick = s.tricks[s.tricks.length - 1]
    this._groundTime = 0
    this.bus?.emit('combo:update', { tricks: s.tricks.map((x) => x.name), baseScore: s.baseScore, multiplier: s.multiplier, total: s.total })
  }

  /** Paso fijo: cobra el combo tras rodar normalmente durante el margen de gracia. */
  fixedUpdate(dt, tel, playerState) {
    const s = this.state
    if (!s.active) return
    if (GROUND_STATES.has(playerState) && tel?.grounded) {
      this._groundTime += dt
      s.graceRemaining = Math.max(0, this.grace - this._groundTime)
      if (this._groundTime >= this.grace) this.land()
    } else {
      this._groundTime = 0
      s.graceRemaining = this.grace
    }
  }

  land() {
    const s = this.state
    if (!s.active) return
    const total = s.total
    const prev = this.score
    this.score += total
    this.bestCombo = Math.max(this.bestCombo, total)
    s.score = this.score
    s.lastResult = { total, landed: true, tricks: s.tricks.map((x) => x.name) }
    this.bus?.emit('combo:end', { total, landed: true, tricks: s.lastResult.tricks, multiplier: s.multiplier })
    this.bus?.emit('score:changed', { score: this.score, delta: this.score - prev })
    this._clearCombo()
  }

  fail() {
    const s = this.state
    if (!s.active) return
    s.lastResult = { total: s.total, landed: false, tricks: s.tricks.map((x) => x.name) }
    this.bus?.emit('combo:end', { total: s.total, landed: false, tricks: s.lastResult.tricks, multiplier: s.multiplier })
    this._clearCombo()
  }

  cancel() {
    this._clearCombo()
  }

  _clearCombo() {
    const s = this.state
    s.active = false
    s.tricks = []
    s.baseScore = 0
    s.multiplier = 1
    s.total = 0
    s.graceRemaining = 0
    this._ids.clear()
    this._sustainedBonus = 0
    this._groundTime = 0
  }

  getState() {
    this.state.score = this.score
    return this.state
  }

  /** Reinicia la sesión (puntuación y combo). */
  reset() {
    this._clearCombo()
    this.score = 0
    this.state.score = 0
    this.state.lastResult = null
    this.state.lastTrick = null
  }

  dispose() {
    this._offs.forEach((off) => off?.())
  }
}
