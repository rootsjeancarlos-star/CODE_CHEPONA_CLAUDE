import { TRICKS } from '../data/tricks.js'

const FLICKS = new Set(['L', 'R', 'D', 'U', 'DL', 'DR', 'UL', 'UR'])
const CATEGORIES = new Set(['ollie', 'flip', 'shuv', 'spin', 'grind', 'slide', 'manual'])

/** Valida una definición de truco; devuelve la lista de errores (vacía si es válida). */
export function validateTrick(t) {
  const e = []
  if (!t || typeof t !== 'object') return ['no es un objeto']
  if (typeof t.id !== 'string' || !t.id) e.push('id')
  if (typeof t.name !== 'string' || !t.name) e.push('name')
  if (!CATEGORIES.has(t.category)) e.push(`category ${t.category}`)
  if (!Array.isArray(t.allowedStates)) e.push('allowedStates')
  if (t.input?.flick != null && !FLICKS.has(t.input.flick)) e.push(`flick ${t.input.flick}`)
  if (!(t.score > 0)) e.push('score')
  if (t.physics && (!Number.isFinite(t.physics.roll) || !Number.isFinite(t.physics.yaw))) e.push('physics')
  return e
}

/**
 * Índices de la base de datos de trucos: por id, por entrada (flick + modificador) y por firma de rotación
 * medida (vueltas de roll, medias vueltas de yaw de la tabla) para el reconocimiento.
 */
export class TrickDatabase {
  constructor(tricks = TRICKS) {
    this.list = []
    this.byId = new Map()
    this.byInput = new Map()
    this.bySignature = new Map()
    for (const t of tricks) this.add(t)
  }

  add(t) {
    const errors = validateTrick(t)
    if (errors.length) throw new Error(`Truco inválido ${t?.id}: ${errors.join(', ')}`)
    if (this.byId.has(t.id)) throw new Error(`Truco duplicado: ${t.id}`)
    this.list.push(t)
    this.byId.set(t.id, t)
    if (t.input?.flick) this.byInput.set(`${t.input.flick}|${t.input.modifier ? 1 : 0}`, t)
    if ((t.category === 'flip' || t.category === 'shuv') && t.physics) this.bySignature.set(this.signatureKey(t.physics.roll, t.physics.yaw * 2), t)
  }

  get(id) {
    return this.byId.get(id) || null
  }

  /** Truco pedido por un flick (regular). */
  findByFlick(flick, modifier = false) {
    return this.byInput.get(`${flick}|${modifier ? 1 : 0}`) || (modifier ? this.byInput.get(`${flick}|0`) : null) || null
  }

  signatureKey(rollTurns, yawHalfTurns) {
    return `${Math.round(rollTurns)}|${Math.round(yawHalfTurns)}`
  }

  /** Truco de tabla cuya rotación (en marco REGULAR) coincide con la medida. */
  findBySignature(rollTurns, yawHalfTurns) {
    return this.bySignature.get(this.signatureKey(rollTurns, yawHalfTurns)) || null
  }

  ofCategory(cat) {
    return this.list.filter((t) => t.category === cat)
  }
}
