import { CHALLENGES } from '../data/challenges.js'

/**
 * Desafíos con progreso persistido en SaveManager (save.data.challenges) y spots descubiertos
 * (save.data.spots). Escucha eventos de trucos/combos y la telemetría por paso.
 */
export class ChallengeManager {
  constructor({ bus, save, spots, challenges = CHALLENGES }) {
    this.bus = bus
    this.save = save
    this.spots = spots
    this.defs = challenges
    this.sessionScore = 0
    this.selectedId = null
    this._distinct = new Set(Object.keys(save?.data?.stats?.tricksLanded || {}))
    this._spotHits = []
    this._spotTimer = 0
    this._offs = []
    if (bus?.on) {
      this._offs.push(
        bus.on('trick:completed', (t) => this._onTrick(t)),
        bus.on('combo:end', (c) => this._onCombo(c)),
        bus.on('grind:end', (g) => {
          this._progress('grind', g.duration || 0, true)
          this._progress('grindDistance', g.distance || 0, true)
        }),
        bus.on('manual:end', (m) => this._progress('manual', m.duration || 0, true)),
        bus.on('skater:land', (l) => this._progress('air', l.airTime || 0, true)),
        bus.on('skater:bail', () => this._stat((s) => (s.bails = (s.bails || 0) + 1))),
      )
    }
  }

  _record(id) {
    const d = this.save?.data
    if (!d) return { completed: false, progress: 0 }
    d.challenges = d.challenges || {}
    return (d.challenges[id] = d.challenges[id] || { completed: false, progress: 0 })
  }

  _stat(fn) {
    if (!this.save?.data) return
    this.save.data.stats = this.save.data.stats || {}
    fn(this.save.data.stats)
  }

  /** Actualiza el progreso de los desafíos de un tipo (máximo o suma). */
  _progress(type, value, isMax = true, filter = null) {
    for (const def of this.defs) {
      if (def.type !== type) continue
      if (filter && !filter(def)) continue
      const r = this._record(def.id)
      if (r.completed) continue
      const prev = r.progress
      r.progress = isMax ? Math.max(r.progress, value) : r.progress + value
      if (r.progress === prev) continue
      this._dirty = true
      if (r.progress >= def.target) this._complete(def, r)
      else if (type !== 'speed') this.bus?.emit('challenge:progress', { id: def.id, progress: r.progress, target: def.target })
    }
  }

  /** Guardado diferido (no escribir en localStorage a 60 Hz). */
  _flush(force = false) {
    if (!this._dirty) return
    if (!force && this._saveTimer < 2) return
    this._dirty = false
    this._saveTimer = 0
    this.save?.saveNow?.()
  }

  _complete(def, r) {
    this._dirty = true
    this._saveTimer = 99
    r.completed = true
    r.progress = def.target
    r.completedAt = Date.now()
    this.bus?.emit('challenge:completed', { id: def.id, title: def.title, reward: def.reward, progress: def.target, target: def.target })
    this.bus?.emit('ui:notify', { text: `Desafío completado: ${def.title}`, kind: 'success', duration: 3.5 })
  }

  _onTrick(t) {
    this._dirty = true
    this._stat((s) => {
      s.tricksLanded = s.tricksLanded || {}
      s.tricksLanded[t.id] = (s.tricksLanded[t.id] || 0) + 1
    })
    this._distinct.add(t.id)
    this._progress('trick', 1, false, (def) => (def.params?.ids || []).includes(t.id) || (def.params?.spins || []).includes(t.spin))
    this._progress('distinctTricks', this._distinct.size, true)
  }

  _onCombo(c) {
    if (!c.landed) return
    this.sessionScore += c.total
    this._stat((s) => {
      s.totalScore = (s.totalScore || 0) + c.total
      s.bestCombo = Math.max(s.bestCombo || 0, c.total)
    })
    this._progress('combo', c.tricks.length, true)
    this._progress('comboScore', c.total, true)
    this._progress('sessionScore', this.sessionScore, true)
  }

  fixedUpdate(dt, tel) {
    this._saveTimer = (this._saveTimer || 0) + dt
    this._flush()
    if (!tel) return
    this._progress('speed', tel.speed, true)
    // spots (comprobación cada 0.25 s)
    this._spotTimer += dt
    if (this._spotTimer < 0.25 || !this.spots?.querySpots) return
    this._spotTimer = 0
    const found = this.spots.querySpots(tel.position, this._spotHits) || []
    const d = this.save?.data
    if (!d) return
    d.spots = d.spots || {}
    for (const spot of found) {
      if (d.spots[spot.id]) continue
      d.spots[spot.id] = true
      this.bus?.emit('spot:discovered', { id: spot.id, name: spot.name })
      this.bus?.emit('ui:notify', { text: `Spot descubierto: ${spot.name}`, kind: 'info', duration: 3 })
      const total = this.spots.spots?.size ?? 0
      const have = Object.keys(d.spots).filter((id) => this.spots.spots?.has?.(id)).length
      if (total > 0 && have >= total) this._progress('spotsAll', 1, true)
    }
  }

  /** Lista para la UI: desafíos con su progreso. */
  list() {
    return this.defs.map((def) => {
      const r = this.save?.data?.challenges?.[def.id] || { completed: false, progress: 0 }
      return { ...def, progress: r.progress, completed: r.completed }
    })
  }

  select(id) {
    this.selectedId = id
  }

  /** Objetivo para el HUD: el seleccionado o el primero sin completar. */
  getActiveObjective() {
    const all = this.list()
    const sel = all.find((c) => c.id === this.selectedId && !c.completed) || all.find((c) => !c.completed)
    if (!sel) return null
    return { id: sel.id, title: sel.title, description: sel.description, progress: sel.progress, target: sel.target, tutorial: sel.tutorial || null }
  }

  resetSession() {
    this.sessionScore = 0
  }

  dispose() {
    this._offs.forEach((off) => off?.())
  }
}
