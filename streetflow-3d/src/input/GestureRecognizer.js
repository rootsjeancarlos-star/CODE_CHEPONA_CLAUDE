/**
 * Reconocedor de gestos del stick derecho ("flick stick"), puro y determinista (sin DOM): se alimenta con
 * muestras `(dt, x, y)` ya filtradas por la zona muerta, en la convención de la Gamepad API (y > 0 = abajo).
 *
 * Gestos (ver tabla completa en docs/INPUT_AUDIO.md):
 *   - Stick ABAJO mantenido            → `crouch` (agacharse; carga de ollie).
 *   - ABAJO → ARRIBA rápido            → `pop` (ollie),             gesture 'D>U',  flick null.
 *   - ABAJO → ARRIBA-IZQ./DER. rápido   → `pop` + flick 'UL'/'UR',   gesture 'D>UL' / 'D>UR'.
 *   - ABAJO → IZQ./DER. rápido          → `pop` + flick 'L'/'R',     gesture 'D>L'  / 'D>R'.
 *   - Stick ARRIBA mantenido           → `crouch` con nollie armado.
 *   - ARRIBA → ABAJO rápido            → `pop` nollie,               gesture 'U>D',  flick null.
 *   - ARRIBA → ABAJO-IZQ./DER. rápido   → `pop` nollie + flick 'DL'/'DR', gesture 'U>DL' / 'U>DR'.
 *   - ARRIBA → IZQ./DER. rápido         → `pop` nollie + flick 'L'/'R',  gesture 'U>L' / 'U>R'.
 *   - Tras un pop (ventana `airFlickWindow`), centro → dirección rápido → flick (gesture 'N>L', 'N>UL'…).
 *   - Sin gesto: el eje horizontal se entrega como `look.x` (órbita de cámara).
 * Un movimiento LENTO de abajo a arriba (más de `popTime`) no produce pop: evita falsos positivos.
 */

const DEG = Math.PI / 180

export const GESTURE_DEFAULTS = Object.freeze({
  /** Magnitud por debajo de la cual el stick está "en el centro". */
  neutral: 0.3,
  /** Magnitud para armar el agachado (zona abajo/arriba). */
  arm: 0.6,
  /** Semiancho angular de la zona de armado alrededor de abajo/arriba. */
  armHalfAngle: 40 * DEG,
  /** Magnitud que debe alcanzar el extremo del gesto. */
  target: 0.75,
  /** Tiempo máximo desde que se abandona la zona de armado hasta alcanzar el objetivo (s). */
  popTime: 0.22,
  /** Tiempo máximo que el stick puede quedarse en el centro durante el gesto antes de cancelarlo (s). */
  neutralCancel: 0.09,
  /** Tiempo de asentamiento tras alcanzar el objetivo, para clasificar la dirección final (s). 0 = inmediato. */
  settleTime: 0.03,
  /** Semiancho angular del sector "arriba"/"abajo" puros (el resto hasta 67.5° son diagonales). */
  verticalHalfAngle: 25 * DEG,
  /** Ventana tras un pop en la que un movimiento rápido desde el centro es un flick aéreo (s). */
  airFlickWindow: 0.6,
  /** Tiempo máximo desde que sale del centro hasta `airFlickTarget` para contar como flick aéreo (s). */
  airFlickTime: 0.1,
  airFlickTarget: 0.85,
  /** Magnitud mínima para considerar el eje horizontal como cámara. */
  lookMin: 0.3,
})

/** Estados internos */
export const GESTURE_STATES = Object.freeze({
  IDLE: 'IDLE',
  ARMED_DOWN: 'ARMED_DOWN',
  ARMED_UP: 'ARMED_UP',
  SWEEP: 'SWEEP',
  SETTLE: 'SETTLE',
  AIR_FLICK: 'AIR_FLICK',
  LOOK: 'LOOK',
  WAIT_NEUTRAL: 'WAIT_NEUTRAL',
})
const S = GESTURE_STATES

/**
 * Clasifica un vector (convención "arriba positivo": ux, uy) en 8 sectores.
 * @param {number} ux  derecha +
 * @param {number} uy  arriba +
 * @param {number} verticalHalfAngle  semiancho de U/D puros (rad)
 * @returns {'U'|'UR'|'R'|'DR'|'D'|'DL'|'L'|'UL'}
 */
export function classifyDirection(ux, uy, verticalHalfAngle = GESTURE_DEFAULTS.verticalHalfAngle) {
  // Ángulo respecto a "arriba", positivo hacia la derecha, en [-π, π].
  const a = Math.atan2(ux, uy)
  const abs = Math.abs(a)
  const side = a >= 0 ? 'R' : 'L'
  const horizLow = 67.5 * DEG
  const horizHigh = 112.5 * DEG
  if (abs <= verticalHalfAngle) return 'U'
  if (abs >= Math.PI - verticalHalfAngle) return 'D'
  if (abs < horizLow) return side === 'R' ? 'UR' : 'UL'
  if (abs <= horizHigh) return side
  return side === 'R' ? 'DR' : 'DL'
}

export class GestureRecognizer {
  /** @param {Partial<typeof GESTURE_DEFAULTS>} [opts] */
  constructor(opts = {}) {
    this.opts = { ...GESTURE_DEFAULTS, ...opts }
    /** Salida reutilizada (no copiar en caliente). Los eventos (pop/flick) duran UNA llamada a update(). */
    this.out = {
      crouch: false,
      nollieArmed: false,
      pop: false,
      nollie: false,
      popStrength: 0,
      flick: null,
      gesture: null,
      look: { x: 0, y: 0 },
      state: S.IDLE,
    }
    this.reset()
  }

  reset() {
    this.state = S.IDLE
    this._t = 0 // tiempo en el estado
    this._neutralT = 0
    this._origin = null // 'D' | 'U' | 'N'
    this._sweepT = 0
    this._settleT = 0
    this._airT = 0
    this._dir = null
    const o = this.out
    o.crouch = false
    o.nollieArmed = false
    o.pop = false
    o.nollie = false
    o.popStrength = 0
    o.flick = null
    o.gesture = null
    o.look.x = 0
    o.look.y = 0
    o.state = S.IDLE
  }

  /** Abre la ventana de flick aéreo (p. ej. tras un pop de teclado o del botón clásico). */
  notifyPop() {
    this._airT = this.opts.airFlickWindow
  }

  /**
   * @param {number} dt  s desde la muestra anterior
   * @param {number} x   eje X tras zona muerta (-1..1, derecha +)
   * @param {number} y   eje Y tras zona muerta (-1..1, ABAJO +, convención Gamepad API)
   * @returns {typeof this.out}
   */
  update(dt, x, y) {
    const o = this.opts
    const out = this.out
    out.pop = false
    out.nollie = false
    out.popStrength = 0
    out.flick = null
    out.gesture = null
    out.look.x = 0
    out.look.y = 0
    if (!(dt > 0)) dt = 0
    const ux = x
    const uy = -y
    const m = Math.hypot(ux, uy)
    // Ángulo desde "abajo" (0 = abajo puro) y desde "arriba".
    const angFromUp = m > 1e-6 ? Math.abs(Math.atan2(ux, uy)) : Math.PI / 2
    const angFromDown = Math.PI - angFromUp
    const inDownZone = m >= o.arm && angFromDown <= o.armHalfAngle
    const inUpZone = m >= o.arm && angFromUp <= o.armHalfAngle
    const neutral = m < o.neutral
    if (this._airT > 0) this._airT = Math.max(0, this._airT - dt)
    this._t += dt

    switch (this.state) {
      case S.IDLE:
      case S.LOOK: {
        if (this.state === S.IDLE && !neutral && this._airT > 0) {
          // En la ventana aérea tras un pop, salir del centro rápido es un flick (tiene prioridad sobre agacharse).
          this._enter(S.AIR_FLICK)
          this._evalAirFlick(dt, ux, uy, m)
        } else if (inDownZone) this._enter(S.ARMED_DOWN)
        else if (inUpZone) this._enter(S.ARMED_UP)
        else if (!neutral) {
          if (this.state !== S.LOOK) this._enter(S.LOOK)
          if (Math.abs(ux) >= o.lookMin * 0.5) out.look.x = ux
        } else if (this.state === S.LOOK) this._enter(S.IDLE)
        break
      }
      case S.ARMED_DOWN:
      case S.ARMED_UP: {
        const down = this.state === S.ARMED_DOWN
        const stillArmed = down ? inDownZone : inUpZone
        if (stillArmed) break
        // Ha salido de la zona de armado: empieza el barrido.
        this._origin = down ? 'D' : 'U'
        this._enter(S.SWEEP)
        this._sweepT = 0
        this._neutralT = 0
        this._evalSweep(0, ux, uy, m, neutral)
        break
      }
      case S.SWEEP:
        this._sweepT += dt
        this._evalSweep(dt, ux, uy, m, neutral)
        break
      case S.SETTLE: {
        this._settleT += dt
        if (m >= o.target * 0.85) {
          const d = classifyDirection(ux, uy, o.verticalHalfAngle)
          if (this._isValidTarget(d)) this._dir = d
        }
        if (this._settleT >= o.settleTime || m < o.target * 0.85) this._firePop()
        break
      }
      case S.AIR_FLICK:
        this._evalAirFlick(dt, ux, uy, m)
        break
      case S.WAIT_NEUTRAL:
        if (neutral) this._enter(S.IDLE)
        break
    }

    out.crouch = this.state === S.ARMED_DOWN || this.state === S.ARMED_UP || this.state === S.SWEEP || this.state === S.SETTLE
    out.nollieArmed = (this.state === S.ARMED_UP) || ((this.state === S.SWEEP || this.state === S.SETTLE) && this._origin === 'U')
    // El pop se entrega con crouch=true en la misma muestra (la PlayerController ve la carga antes del pop).
    if (out.pop) out.crouch = true
    out.state = this.state
    return out
  }

  _enter(state) {
    this.state = state
    this._t = 0
  }

  _evalSweep(dt, ux, uy, m, neutral) {
    const o = this.opts
    if (neutral) this._neutralT += dt
    else this._neutralT = 0
    // ¿Ha vuelto a la zona de armado de origen? (indecisión) → re-armar sin pop.
    const angFromUp = m > 1e-6 ? Math.abs(Math.atan2(ux, uy)) : Math.PI / 2
    if (m >= o.arm) {
      const backToOrigin = this._origin === 'D' ? Math.PI - angFromUp <= o.armHalfAngle : angFromUp <= o.armHalfAngle
      if (backToOrigin) {
        this._enter(this._origin === 'D' ? S.ARMED_DOWN : S.ARMED_UP)
        return
      }
    }
    if (m >= o.target) {
      const dir = classifyDirection(ux, uy, o.verticalHalfAngle)
      if (this._isValidTarget(dir)) {
        this._dir = dir
        if (o.settleTime > 0) {
          this._enter(S.SETTLE)
          this._settleT = 0
        } else this._firePop()
        return
      }
    }
    if (this._sweepT > o.popTime || this._neutralT > o.neutralCancel) {
      // Demasiado lento o soltado: se cancela sin pop (sin falsos positivos).
      this._origin = null
      this._enter(neutral ? S.IDLE : S.WAIT_NEUTRAL)
    }
  }

  _isValidTarget(dir) {
    if (this._origin === 'D') return dir === 'U' || dir === 'UL' || dir === 'UR' || dir === 'L' || dir === 'R'
    return dir === 'D' || dir === 'DL' || dir === 'DR' || dir === 'L' || dir === 'R'
  }

  _firePop() {
    const o = this.opts
    const out = this.out
    const dir = this._dir
    const nollie = this._origin === 'U'
    out.pop = true
    out.nollie = nollie
    // Fuerza 0.6..1 según la rapidez del barrido.
    const t = Math.min(1, Math.max(0, this._sweepT / o.popTime))
    out.popStrength = 1 - 0.4 * t
    const pure = nollie ? 'D' : 'U'
    out.flick = dir === pure ? null : dir
    out.gesture = `${this._origin}>${dir}`
    this._airT = o.airFlickWindow
    this._origin = null
    this._dir = null
    this._enter(S.WAIT_NEUTRAL)
  }

  _evalAirFlick(dt, ux, uy, m) {
    const o = this.opts
    if (m >= o.airFlickTarget) {
      if (this._t <= o.airFlickTime) {
        const dir = classifyDirection(ux, uy, o.verticalHalfAngle)
        this.out.flick = dir
        this.out.gesture = `N>${dir}`
      }
      this._enter(S.WAIT_NEUTRAL)
      return
    }
    if (m < o.neutral) this._enter(S.IDLE)
    else if (this._t > o.airFlickTime) this._enter(S.LOOK)
  }
}
