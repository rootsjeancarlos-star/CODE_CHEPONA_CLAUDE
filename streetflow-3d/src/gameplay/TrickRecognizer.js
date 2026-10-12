const TAU = Math.PI * 2
const MULT = ['', '', 'Double', 'Triple', 'Quad']

/**
 * Reconoce el truco REALMENTE ejecutado a partir de la rotación medida por la física
 * (telemetry.accumulated: roll/yaw de la tabla y yaw del cuerpo) y del resultado del aterrizaje.
 * Distingue truco solicitado, ejecutado, completado y fallido (docs/ARCHITECTURE.md §8.2).
 */
export class TrickRecognizer {
  constructor({ bus, database }) {
    this.bus = bus
    this.db = database
    this.last = null
  }

  /**
   * @param {{popped:boolean, nollie:boolean, fakie:boolean, requested:Array, airTime:number}} session
   * @param {Object} tel SkaterTelemetry en el aterrizaje
   * @param {{clean:boolean, quality:number, bail:boolean, reason?:string}} landing
   * @returns {?Object} truco completado o null
   */
  recognize(session, tel, landing) {
    const requested = session?.requested?.[0] || null
    if (landing?.bail) {
      for (const r of session?.requested || []) this.bus?.emit('trick:failed', { id: r.id, name: r.name, reason: landing.reason || 'caída' })
      this.last = null
      return null
    }
    const sign = tel.stance === 'goofy' ? -1 : 1
    const acc = tel.accumulated
    const rollTurns = (acc.boardRoll / TAU) * sign
    const yawHalf = (acc.boardYaw / Math.PI) * sign
    const bodyHalf = (acc.bodyYaw / Math.PI) * sign
    const nRoll = Math.round(rollTurns)
    const nYaw = Math.round(yawHalf)
    const nBody = Math.abs(bodyHalf - Math.round(bodyHalf)) < 0.3 ? Math.round(bodyHalf) : Math.trunc(bodyHalf)

    let boardDef = null
    let boardName = null
    let base = 0
    if (nRoll !== 0 || nYaw !== 0) {
      boardDef = this.db.findBySignature(nRoll, nYaw)
      if (boardDef) {
        boardName = boardDef.name
        base = boardDef.score
      } else {
        const parts = []
        if (nRoll) parts.push(`${MULT[Math.min(4, Math.abs(nRoll))] ? MULT[Math.min(4, Math.abs(nRoll))] + ' ' : ''}${nRoll < 0 ? 'Kickflip' : 'Heelflip'}`.trim())
        if (nYaw) parts.push(`${Math.abs(nYaw) * 180} ${nYaw < 0 ? 'BS' : 'FS'} Shove-it`)
        boardName = parts.join(' + ')
        base = 300 * Math.abs(nRoll) + 250 * Math.abs(nYaw)
      }
    }
    let spinId = null
    let spinName = ''
    let spinBonus = 0
    if (nBody !== 0) {
      const deg = Math.abs(nBody) * 180
      spinName = `${nBody > 0 ? 'FS' : 'BS'} ${deg}`
      spinId = `${nBody > 0 ? 'fs' : 'bs'}${deg}`
      spinBonus = [0, 200, 500, 800, 1200, 1700][Math.min(5, Math.abs(nBody))]
    }
    let core = boardName
    if (!core) {
      if (session?.popped) core = session.nollie ? 'Nollie' : 'Ollie'
      else if ((session?.airTime ?? tel.airTime) > 0.45 || tel.maxAirHeight > 0.5) core = 'Air'
    }
    if (!core && !spinName) return null
    if (!boardName) {
      if (core === 'Nollie') base = this.db.get('nollie').score
      else if (core === 'Ollie') base = this.db.get('ollie').score
      else if (core === 'Air') base = 100
    }
    const prefix = session?.fakie && !session?.nollie ? 'Fakie ' : ''
    const displayName = `${prefix}${spinName ? spinName + ' ' : ''}${core || ''}`.trim()
    const quality = landing?.quality ?? 1
    const heightBonus = Math.round(120 * Math.max(0, tel.maxAirHeight - 0.6))
    let score = (base + spinBonus) * (0.5 + 0.75 * quality) * (prefix ? 1.2 : 1) + heightBonus
    score = Math.round(score / 5) * 5
    const id = boardDef?.id || (boardName ? 'customFlip' : spinId || (core === 'Nollie' ? 'nollie' : core === 'Ollie' ? 'ollie' : 'air'))
    const result = {
      id,
      name: boardName || core || spinName,
      displayName,
      score,
      quality,
      category: boardDef?.category || (boardName ? 'flip' : spinId ? 'spin' : 'ollie'),
      spin: spinId,
      executed: { roll: nRoll, yaw: nYaw, body: nBody },
      requested: requested?.id || null,
      clean: !!landing?.clean,
    }
    if (requested && requested.id !== boardDef?.id) {
      this.bus?.emit('trick:failed', { id: requested.id, name: requested.name, reason: 'rotación distinta a la pedida', executed: result.id })
    }
    this.last = result
    this.bus?.emit('trick:completed', result)
    return result
  }

  /** Grinds/slides y manuals: se completan al terminar con duración suficiente. */
  recognizeSustained(id, duration, distance = 0) {
    const def = this.db.get(id)
    if (!def) return null
    const min = def.category === 'manual' ? 0.5 : 0.2
    if (duration < min) return null
    const score = Math.round((def.score + (def.perSecond || 0) * duration + 20 * distance) / 5) * 5
    const result = { id, name: def.name, displayName: def.name, score, quality: 1, category: def.category, duration, distance, clean: true }
    this.last = result
    this.bus?.emit('trick:completed', result)
    return result
  }
}
