/**
 * Panel de depuración: FPS, tiempo de fotograma, tiempo de física, pasos, estadísticas del renderer,
 * número de objetos y datos del skater. Se activa con ?debug=1 o con F3.
 */
export class DebugSystem {
  /**
   * @param {HTMLElement} root contenedor de la UI
   * @param {{ enabled?: boolean }} [o]
   */
  constructor(root, { enabled = false } = {}) {
    this.enabled = enabled
    this.el = document.createElement('pre')
    this.el.className = 'sf-debug'
    this.el.setAttribute('aria-hidden', 'true')
    root.appendChild(this.el)
    this.el.hidden = !enabled
    this._frames = 0
    this._accum = 0
    this.fps = 0
    this.frameMs = 0
    this._worstMs = 0
    this.counters = { physicsMs: 0, physicsSteps: 0, droppedTime: 0 }
    this._sources = new Map()
    this._lastUpdate = 0
    this._onKey = (e) => {
      if (e.code === 'F3') {
        e.preventDefault()
        this.toggle()
      }
    }
    window.addEventListener('keydown', this._onKey)
  }

  toggle(v = !this.enabled) {
    this.enabled = v
    this.el.hidden = !v
  }

  /** Registra una fuente de datos: fn() → objeto plano o string. */
  addSource(name, fn) {
    this._sources.set(name, fn)
  }

  removeSource(name) {
    this._sources.delete(name)
  }

  /** Llamar una vez por fotograma con el delta real (s). */
  frame(frameDt, now = performance.now()) {
    this._frames++
    this._accum += frameDt
    const ms = frameDt * 1000
    if (ms > this._worstMs) this._worstMs = ms
    if (this._accum >= 0.5) {
      this.fps = this._frames / this._accum
      this.frameMs = (this._accum / this._frames) * 1000
      this._frames = 0
      this._accum = 0
      this._worst = this._worstMs
      this._worstMs = 0
    }
    if (!this.enabled || now - this._lastUpdate < 250) return
    this._lastUpdate = now
    const lines = [
      `FPS ${this.fps.toFixed(1)}  frame ${this.frameMs.toFixed(2)} ms  peor ${(this._worst || 0).toFixed(1)} ms`,
      `física ${this.counters.physicsMs.toFixed(2)} ms  pasos ${this.counters.physicsSteps}  descartado ${(this.counters.droppedTime * 1000).toFixed(0)} ms`,
    ]
    for (const [name, fn] of this._sources) {
      try {
        const v = fn()
        if (v == null) continue
        if (typeof v === 'string') lines.push(`${name}: ${v}`)
        else lines.push(`${name}: ${Object.entries(v).map(([k, x]) => `${k}=${typeof x === 'number' ? (Number.isInteger(x) ? x : x.toFixed(2)) : x}`).join('  ')}`)
      } catch (err) {
        lines.push(`${name}: error ${err.message}`)
      }
    }
    if (performance.memory) {
      lines.push(`memoria JS ${(performance.memory.usedJSHeapSize / 1048576).toFixed(0)} MB`)
    }
    this.el.textContent = lines.join('\n')
  }

  dispose() {
    window.removeEventListener('keydown', this._onKey)
    this.el.remove()
  }
}
