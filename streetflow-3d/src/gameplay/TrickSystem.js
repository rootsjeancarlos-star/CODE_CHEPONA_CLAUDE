import { TrickDatabase } from './TrickDatabase.js'
import { TrickRecognizer } from './TrickRecognizer.js'

const TAU = Math.PI * 2
const AIR_STATES = new Set(['POPPING', 'AIRBORNE', 'TRICKING'])
const MANUAL_IDS = { manual: 'manual', nose: 'noseManual' }

/**
 * Interpreta la intención de truco según el estado, ejecuta su física (board.physics.startFlip) y
 * delega la verificación en TrickRecognizer al aterrizar. Un flick se acepta desde el pop hasta la
 * ventana del truco; se almacena brevemente para permitir "flecha + soltar ESPACIO".
 */
export class TrickSystem {
  constructor({ bus, board, database = null }) {
    this.bus = bus
    this.board = board
    this.database = database || new TrickDatabase()
    this.recognizer = new TrickRecognizer({ bus, database: this.database })
    this.session = null
    this.flickBuffer = { flick: null, modifier: false, age: 99 }
    this.maxFlipsPerAir = 1
    this._active = { id: null, category: null, progress: 0, name: null }
    this._offs = []
    this._pop = { nollie: false, age: 99 }
    if (bus?.on) {
      this._offs.push(
        bus.on('skater:pop', (p) => {
          this._pop.nollie = !!p?.nollie
          this._pop.age = 0
          // un pop desde un grind/manual abre una sesión nueva
          if (this.session && this.session.time > 0.05) this.session = null
        }),
        // Caer en un rail/ledge cierra la parte aérea: se reconoce como aterrizada sobre la arista.
        bus.on('grind:start', () => this._closeAirOnGrind()),
        bus.on('grind:end', (p) => this.recognizer.recognizeSustained(p.type, p.duration || 0, p.distance || 0)),
        bus.on('manual:end', (p) => this.recognizer.recognizeSustained(MANUAL_IDS[p.type] || 'manual', p.duration || 0)),
      )
    }
  }

  get sb() {
    return this.board.physics
  }

  setMaxFlipsPerAir(n) {
    this.maxFlipsPerAir = n
  }

  /**
   * @param {Object} intent InputIntent
   * @param {string} state estado del PlayerController
   * @param {Object} tel telemetría
   * @returns {?Object} truco iniciado
   */
  handleIntent(intent, state, tel) {
    if (intent?.flick) {
      this.flickBuffer.flick = intent.flick
      this.flickBuffer.modifier = !!intent.modifier
      this.flickBuffer.age = 0
    }
    if (!AIR_STATES.has(state)) return null
    if (!this.session) this._beginSession(state === 'POPPING' || this._pop.age < 0.35, intent, tel)
    const s = this.session
    if (!this.flickBuffer.flick || this.flickBuffer.age > 0.3) return null
    if (this.sb.flip.active || s.requested.length >= this.maxFlipsPerAir) return null
    const def = this.database.findByFlick(this.flickBuffer.flick, this.flickBuffer.modifier)
    if (!def || !def.physics || def.category === 'spin') return null
    if (s.time > Math.max(def.window, 0.12) + 0.12) return null
    const sign = tel.stance === 'goofy' ? -1 : 1
    const ok = this.sb.startFlip({ roll: def.physics.roll * TAU * sign, yaw: def.physics.yaw * TAU * sign, duration: def.physics.duration })
    this.flickBuffer.flick = null
    if (!ok) return null
    s.requested.push(def)
    this.bus?.emit('trick:requested', { id: def.id, input: { flick: def.input.flick, modifier: !!def.input.modifier } })
    this.bus?.emit('trick:started', { id: def.id, name: def.name })
    return def
  }

  _closeAirOnGrind() {
    const s = this.session
    this.session = null
    if (!s) return
    const sb = this.sb
    const tel = sb.getTelemetry()
    tel.accumulated.boardRoll = sb.boardRoll
    tel.accumulated.boardYaw = sb.boardYaw
    if (!s.popped && !s.requested.length && Math.abs(tel.accumulated.bodyYaw) < 2.4) return
    this.recognizer.recognize(s, tel, { clean: true, quality: 0.9, bail: false })
  }

  _beginSession(popped, intent, tel) {
    const nollie = popped && (this._pop.age < 0.35 ? this._pop.nollie : !!intent?.nollie)
    this.session = { popped, nollie, fakie: !!tel?.isSwitch, requested: [], time: 0, airTime: 0 }
  }

  fixedUpdate(dt, tel, state) {
    this.flickBuffer.age += dt
    this._pop.age += dt
    if (this.session) {
      this.session.time += dt
      this.session.airTime = tel?.airTime ?? this.session.airTime
      // sesión abierta pero el skater volvió al suelo sin aterrizaje evaluado (aire muy corto)
      if (!AIR_STATES.has(state) && state !== 'LANDING' && state !== 'GRINDING' && this.session.time > 0.5 && tel?.grounded) this.session = null
    }
  }

  /** Lo llama PlayerController con el resultado de LandingSystem. */
  onLanding(result, tel) {
    const s = this.session
    this.session = null
    if (!s && !result?.bail) {
      // aire sin sesión (p.ej. salida de un grind): reconocer igualmente giros/aire
      return this.recognizer.recognize({ popped: false, nollie: false, fakie: false, requested: [], airTime: tel.airTime }, tel, result)
    }
    return this.recognizer.recognize(s, tel, result)
  }

  onBail(reason) {
    if (this.session) {
      for (const r of this.session.requested) this.bus?.emit('trick:failed', { id: r.id, name: r.name, reason })
    }
    this.session = null
  }

  isTricking() {
    return this.sb.flip.active
  }

  getActiveTrick() {
    if (!this.sb.flip.active || !this.session?.requested.length) return null
    const def = this.session.requested[this.session.requested.length - 1]
    this._active.id = def.id
    this._active.name = def.name
    this._active.category = def.category
    this._active.progress = this.sb.flip.progress
    return this._active
  }

  reset() {
    this.session = null
    this.flickBuffer.flick = null
  }

  dispose() {
    this._offs.forEach((off) => off?.())
  }
}
