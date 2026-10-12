/**
 * Asignación de teclas (bindings) del teclado: mapa por defecto, reasignación con detección de conflictos,
 * serialización/validación para `settings.controls.keyboard` y nombres legibles en español para la UI.
 * Ver docs/ARCHITECTURE.md §6 y docs/INPUT_AUDIO.md.
 *
 * Formato persistido (`settings.controls.keyboard`): SOLO las acciones que difieren del mapa por defecto,
 * como `{ [actionId]: string[] }` con `KeyboardEvent.code` (p. ej. `{ push: ['ArrowUp'] }`). Así, si una versión
 * futura añade acciones, los jugadores reciben sus teclas por defecto sin migración.
 *
 * Todas las funciones son puras (no tocan el DOM) para poder usarlas en el menú de ajustes y en Vitest.
 */

/** Número máximo de teclas por acción (principal + alternativa). */
export const MAX_KEYS_PER_ACTION = 2

/**
 * Acciones del teclado. `instant` = se emite al instante como `input:action` (funciona con la simulación en pausa).
 * `locked` = no reasignable desde el menú (se muestra pero no se puede cambiar).
 */
export const KEY_ACTIONS = Object.freeze([
  { id: 'push', label: 'Empujar', group: 'move', defaults: ['KeyW'] },
  { id: 'left', label: 'Girar / rotar a la izquierda', group: 'move', defaults: ['KeyA'] },
  { id: 'right', label: 'Girar / rotar a la derecha', group: 'move', defaults: ['KeyD'] },
  { id: 'brake', label: 'Frenar', group: 'move', defaults: ['KeyS'] },
  { id: 'crouch', label: 'Agacharse / ollie (al soltar)', group: 'tricks', defaults: ['Space'] },
  { id: 'modifier', label: 'Modificador (nollie)', group: 'tricks', defaults: ['ShiftLeft', 'ShiftRight'] },
  { id: 'flickLeft', label: 'Flick izquierda', group: 'tricks', defaults: ['ArrowLeft'] },
  { id: 'flickRight', label: 'Flick derecha', group: 'tricks', defaults: ['ArrowRight'] },
  { id: 'flickUp', label: 'Flick arriba / manual', group: 'tricks', defaults: ['ArrowUp'] },
  { id: 'flickDown', label: 'Flick abajo / nose manual', group: 'tricks', defaults: ['ArrowDown'] },
  { id: 'grind', label: 'Grind / slide', group: 'tricks', defaults: ['KeyE'] },
  { id: 'context', label: 'Acción contextual (revert / stance)', group: 'tricks', defaults: ['KeyQ'] },
  { id: 'interact', label: 'Subir / bajar de la tabla', group: 'system', defaults: ['KeyF'] },
  { id: 'reset', label: 'Reiniciar', group: 'system', defaults: ['KeyR'] },
  { id: 'saveMarker', label: 'Guardar marcador', group: 'system', defaults: ['KeyG'] },
  { id: 'loadMarker', label: 'Volver al marcador', group: 'system', defaults: ['KeyT'] },
  { id: 'camera', label: 'Cambiar cámara', group: 'system', defaults: ['KeyC'], instant: true },
  { id: 'replay', label: 'Repeticiones', group: 'system', defaults: ['KeyV'], instant: true },
  { id: 'pause', label: 'Pausa', group: 'system', defaults: ['Escape', 'KeyP'], instant: true, locked: true },
  { id: 'fullscreen', label: 'Pantalla completa', group: 'system', defaults: ['F11'], instant: true },
])

export const ACTION_GROUPS = Object.freeze({ move: 'Movimiento', tricks: 'Trucos', system: 'Sistema' })

const ACTION_BY_ID = new Map(KEY_ACTIONS.map((a) => [a.id, a]))

/** Teclas que nunca se pueden asignar a otra acción (Escape siempre pausa y libera el puntero). */
export const RESERVED_CODES = Object.freeze(['Escape'])

/** Teclas que el navegador/SO no deja capturar de forma fiable (o que romperían la navegación). */
const FORBIDDEN_CODES = new Set(['Tab', 'MetaLeft', 'MetaRight', 'ContextMenu', 'OSLeft', 'OSRight', 'PrintScreen', 'Fn', 'FnLock', ''])

const CODE_RE = /^[A-Za-z][A-Za-z0-9]{0,31}$/

/** @returns {Record<string, string[]>} copia nueva del mapa por defecto */
export function defaultBindings() {
  const out = {}
  for (const a of KEY_ACTIONS) out[a.id] = [...a.defaults]
  return out
}

/** ¿Es un `KeyboardEvent.code` que se puede asignar? */
export function isBindableCode(code) {
  return typeof code === 'string' && CODE_RE.test(code) && !FORBIDDEN_CODES.has(code)
}

export function getActionInfo(actionId) {
  return ACTION_BY_ID.get(actionId) || null
}

/**
 * Valida y completa un objeto de bindings (persistido o editado). Nunca lanza.
 * - Acciones desconocidas se descartan; valores dañados → teclas por defecto de esa acción.
 * - Conflictos (misma tecla en dos acciones): gana la acción por defecto de esa tecla o la primera en orden; la otra
 *   pierde la tecla y, si se queda sin ninguna, recupera su valor por defecto si está libre.
 * @param {any} raw  objeto `{ action: string[] | string }` (normalmente solo las diferencias)
 * @returns {{ bindings: Record<string,string[]>, errors: string[], changed: boolean }}
 */
export function sanitizeBindings(raw) {
  const errors = []
  const merged = defaultBindings()
  const explicitEmpty = new Set()
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    errors.push('formato de teclas inválido: se usan los valores por defecto')
    return { bindings: merged, errors, changed: true }
  }
  if (raw) {
    for (const key of Object.keys(raw)) {
      const info = ACTION_BY_ID.get(key)
      if (!info) {
        errors.push(`acción desconocida "${key}" descartada`)
        continue
      }
      if (info.locked) continue
      let v = raw[key]
      if (typeof v === 'string') v = [v]
      if (!Array.isArray(v)) {
        errors.push(`valor inválido para "${key}"`)
        continue
      }
      const codes = []
      for (const c of v) {
        if (!isBindableCode(c) || RESERVED_CODES.includes(c)) {
          errors.push(`tecla inválida "${String(c)}" en "${key}"`)
          continue
        }
        if (!codes.includes(c) && codes.length < MAX_KEYS_PER_ACTION) codes.push(c)
      }
      if (codes.length === 0) {
        if (v.length === 0) {
          // Lista vacía explícita = acción sin asignar (válido).
          merged[key] = []
          explicitEmpty.add(key)
        } else errors.push(`"${key}" sin teclas válidas: se usa el valor por defecto`)
        continue
      }
      merged[key] = codes
    }
  }
  // Resolver conflictos: recorrido en orden de KEY_ACTIONS; prioridad a la acción cuyo valor por defecto es esa tecla.
  const owner = new Map()
  for (const a of KEY_ACTIONS) {
    for (const c of merged[a.id]) {
      if (!owner.has(c) || a.defaults.includes(c)) {
        const prev = owner.get(c)
        if (prev && prev !== a.id) errors.push(`conflicto: "${c}" estaba en "${prev}" y en "${a.id}"`)
        owner.set(c, a.id)
      } else if (owner.get(c) !== a.id) {
        errors.push(`conflicto: "${c}" estaba en "${owner.get(c)}" y en "${a.id}"`)
      }
    }
  }
  for (const a of KEY_ACTIONS) {
    merged[a.id] = merged[a.id].filter((c) => owner.get(c) === a.id)
    if (merged[a.id].length === 0 && !explicitEmpty.has(a.id)) {
      const free = a.defaults.filter((c) => !owner.has(c))
      merged[a.id] = free
      for (const c of free) owner.set(c, a.id)
      if (free.length === 0) errors.push(`"${a.id}" se ha quedado sin tecla asignada`)
    }
  }
  return { bindings: merged, errors, changed: errors.length > 0 }
}

/**
 * Serializa para `settings.controls.keyboard`: solo las acciones que difieren del valor por defecto.
 * @param {Record<string,string[]>} bindings
 */
export function serializeBindings(bindings) {
  const out = {}
  for (const a of KEY_ACTIONS) {
    if (a.locked) continue
    const codes = bindings?.[a.id]
    if (!Array.isArray(codes)) continue
    if (codes.length !== a.defaults.length || codes.some((c, i) => c !== a.defaults[i])) out[a.id] = [...codes]
  }
  return out
}

/** @returns {string[]} acciones (distintas de `exceptAction`) que usan `code` */
export function findConflicts(bindings, code, exceptAction = null) {
  const out = []
  for (const a of KEY_ACTIONS) {
    if (a.id === exceptAction) continue
    if (bindings?.[a.id]?.includes(code)) out.push(a.id)
  }
  return out
}

/**
 * Reasigna una tecla. No muta `bindings`.
 * @param {Record<string,string[]>} bindings
 * @param {string} action
 * @param {string} code  `KeyboardEvent.code`
 * @param {{ slot?: number, onConflict?: 'swap'|'steal'|'reject' }} [opts]
 *   swap  (por defecto): la acción en conflicto recibe la tecla anterior de esta acción (o su valor por defecto).
 *   steal: la acción en conflicto pierde la tecla (si se queda vacía recupera su valor por defecto libre).
 *   reject: no se aplica y se devuelven los conflictos.
 * @returns {{ ok: boolean, bindings: Record<string,string[]>, conflicts: string[], reason: ?string }}
 */
export function rebind(bindings, action, code, { slot = 0, onConflict = 'swap' } = {}) {
  const base = sanitizeBindings(serializeBindings(bindings || defaultBindings())).bindings
  const info = ACTION_BY_ID.get(action)
  if (!info) return { ok: false, bindings: base, conflicts: [], reason: 'Acción desconocida' }
  if (info.locked) return { ok: false, bindings: base, conflicts: [], reason: 'Esta acción no se puede reasignar' }
  if (!isBindableCode(code)) return { ok: false, bindings: base, conflicts: [], reason: 'Esa tecla no se puede asignar' }
  if (RESERVED_CODES.includes(code)) return { ok: false, bindings: base, conflicts: [], reason: `${keyLabel(code)} está reservada para la pausa` }
  slot = Math.max(0, Math.min(MAX_KEYS_PER_ACTION - 1, slot | 0))

  const next = {}
  for (const k of Object.keys(base)) next[k] = [...base[k]]
  const own = next[action]
  if (own.includes(code)) {
    // Ya es de esta acción: si está en otra ranura, se reordena.
    const i = own.indexOf(code)
    if (i !== slot && slot < own.length) [own[i], own[slot]] = [own[slot], own[i]]
    return { ok: true, bindings: next, conflicts: [], reason: null }
  }
  const conflicts = findConflicts(next, code, action)
  if (conflicts.length && onConflict === 'reject') return { ok: false, bindings: base, conflicts, reason: 'Tecla en uso' }
  const previous = slot < own.length ? own[slot] : null
  if (slot < own.length) own[slot] = code
  else own.push(code)

  for (const other of conflicts) {
    const list = next[other]
    const idx = list.indexOf(code)
    if (onConflict === 'swap' && previous && !findConflicts(next, previous, action).length) list[idx] = previous
    else list.splice(idx, 1)
    if (list.length === 0) {
      // Si se queda vacía, recupera sus teclas por defecto libres (o queda sin asignar).
      const free = ACTION_BY_ID.get(other).defaults.filter((c) => findConflicts(next, c).length === 0)
      list.push(...free)
    }
  }
  return { ok: true, bindings: next, conflicts, reason: null }
}

/** Quita la tecla de una ranura (si la acción se queda sin teclas, se restaura su valor por defecto). */
export function clearBinding(bindings, action, slot = 1) {
  const base = sanitizeBindings(serializeBindings(bindings || defaultBindings())).bindings
  const info = ACTION_BY_ID.get(action)
  if (!info || info.locked) return base
  const list = base[action]
  if (slot >= 0 && slot < list.length) list.splice(slot, 1)
  if (list.length === 0) return sanitizeBindings({ ...serializeBindings(base), [action]: info.defaults }).bindings
  return base
}

/** Restaura una acción (o todas si no se indica) a su valor por defecto, resolviendo conflictos. */
export function resetBindings(bindings, action = null) {
  if (!action) return defaultBindings()
  const ser = serializeBindings(bindings || defaultBindings())
  delete ser[action]
  // Las teclas por defecto de esta acción pasan a ser suyas: se quitan de otras acciones.
  const defs = ACTION_BY_ID.get(action)?.defaults || []
  for (const k of Object.keys(ser)) ser[k] = ser[k].filter((c) => !defs.includes(c))
  return sanitizeBindings(ser).bindings
}

/**
 * Construye el mapa de búsqueda tecla → acción usado por KeyboardInput.
 * @returns {Map<string,string>}
 */
export function buildCodeMap(bindings, out = new Map()) {
  out.clear()
  for (const a of KEY_ACTIONS) {
    for (const c of bindings[a.id] || []) if (!out.has(c)) out.set(c, a.id)
  }
  // Escape siempre pausa, aunque los ajustes digan otra cosa.
  out.set('Escape', 'pause')
  return out
}

// -------------------------------------------------------------------------------------------------
// Nombres legibles (español)
// -------------------------------------------------------------------------------------------------
const KEY_NAMES = {
  Space: 'Espacio',
  Enter: 'Intro',
  NumpadEnter: 'Intro (num.)',
  Escape: 'Esc',
  Backspace: 'Retroceso',
  Tab: 'Tab',
  CapsLock: 'Bloq Mayús',
  ShiftLeft: 'Mayús izq.',
  ShiftRight: 'Mayús der.',
  ControlLeft: 'Ctrl izq.',
  ControlRight: 'Ctrl der.',
  AltLeft: 'Alt',
  AltRight: 'Alt Gr',
  MetaLeft: 'Meta izq.',
  MetaRight: 'Meta der.',
  ArrowUp: 'Flecha ↑',
  ArrowDown: 'Flecha ↓',
  ArrowLeft: 'Flecha ←',
  ArrowRight: 'Flecha →',
  Insert: 'Insert',
  Delete: 'Supr',
  Home: 'Inicio',
  End: 'Fin',
  PageUp: 'Re Pág',
  PageDown: 'Av Pág',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[ (`)',
  BracketRight: '] (+)',
  Backslash: '\\ (ç)',
  Semicolon: 'Ñ',
  Quote: "' (´)",
  Backquote: 'º',
  Comma: ',',
  Period: '.',
  Slash: '- (/)',
  IntlBackslash: '<',
  NumpadAdd: 'Num +',
  NumpadSubtract: 'Num -',
  NumpadMultiply: 'Num *',
  NumpadDivide: 'Num /',
  NumpadDecimal: 'Num .',
  ContextMenu: 'Menú',
  Pause: 'Pausa',
  ScrollLock: 'Bloq Despl',
  NumLock: 'Bloq Num',
}

/**
 * Nombre legible de un `KeyboardEvent.code` (distribución española como referencia para los símbolos).
 * @param {string} code
 */
export function keyLabel(code) {
  if (typeof code !== 'string' || !code) return '—'
  if (KEY_NAMES[code]) return KEY_NAMES[code]
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit(\d)$/.exec(code)
  if (m) return m[1]
  m = /^Numpad(\d)$/.exec(code)
  if (m) return `Num ${m[1]}`
  m = /^F(\d{1,2})$/.exec(code)
  if (m) return code
  return code
}

/** Etiqueta de las teclas de una acción, p. ej. "Mayús izq. / Mayús der." */
export function bindingLabel(bindings, action) {
  const codes = bindings?.[action] || []
  return codes.length ? codes.map(keyLabel).join(' / ') : 'Sin asignar'
}

export function actionLabel(action) {
  return ACTION_BY_ID.get(action)?.label || action
}

/**
 * Lista para el menú de ajustes (orden estable, agrupada).
 * @returns {{ action:string, label:string, group:string, groupLabel:string, keys:{code:string,label:string}[], rebindable:boolean, isDefault:boolean }[]}
 */
export function listBindingsForUi(bindings) {
  const b = bindings || defaultBindings()
  return KEY_ACTIONS.map((a) => {
    const codes = b[a.id] || []
    return {
      action: a.id,
      label: a.label,
      group: a.group,
      groupLabel: ACTION_GROUPS[a.group],
      keys: codes.map((code) => ({ code, label: keyLabel(code) })),
      rebindable: !a.locked,
      isDefault: codes.length === a.defaults.length && codes.every((c, i) => c === a.defaults[i]),
    }
  })
}

/**
 * Esquema del mando (mapeo "standard" de la Gamepad API) para la UI y la documentación. No es reasignable (v1).
 * Índices: https://w3c.github.io/gamepad/#remapping
 */
export const GAMEPAD_LAYOUT = Object.freeze([
  { input: 'Stick izquierdo', action: 'Dirección (en suelo) / rotación (en el aire)' },
  { input: 'Stick derecho', action: 'Gestos de truco (ver tabla de gestos) o cámara horizontal sin gesto' },
  { input: 'A (Cruz)', action: 'Empujar', button: 0 },
  { input: 'B (Círculo)', action: 'Frenar · Atrás en menús', button: 1 },
  { input: 'X (Cuadrado)', action: 'Grind / slide', button: 2 },
  { input: 'Y (Triángulo)', action: 'Manual (con stick izq. abajo: nose manual)', button: 3 },
  { input: 'LB / RB', action: 'Rotación aérea izquierda / derecha', button: [4, 5] },
  { input: 'LT', action: 'Modificador (nollie) · eje analógico para modo simulación de pies', button: 6 },
  { input: 'RT', action: 'Eje analógico para modo simulación de pies (en modo clásico: agacharse/ollie)', button: 7 },
  { input: 'Select / Back', action: 'Repeticiones', button: 8 },
  { input: 'Start', action: 'Pausa', button: 9 },
  { input: 'L3 (pulsar stick izq.)', action: 'Subir / bajar de la tabla', button: 10 },
  { input: 'R3 (pulsar stick der.)', action: 'Cambiar cámara', button: 11 },
  { input: 'Cruceta ↑', action: 'Guardar marcador', button: 12 },
  { input: 'Cruceta ↓', action: 'Volver al marcador', button: 13 },
  { input: 'Cruceta ←', action: 'Acción contextual (revert / stance)', button: 14 },
  { input: 'Cruceta →', action: 'Reiniciar', button: 15 },
])
