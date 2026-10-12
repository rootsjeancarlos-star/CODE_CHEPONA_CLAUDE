/**
 * Ratón: Pointer Lock (solo tras una acción explícita del usuario), deltas de cámara y rueda.
 */
export class MouseInput {
  constructor({ canvas, onAny = null }) {
    this.canvas = canvas
    this.onAny = onAny
    this.dx = 0
    this.dy = 0
    this.wheel = 0
    this.locked = false
    this.dragging = false
    this._move = (e) => {
      if (this.locked || this.dragging) {
        this.dx += e.movementX || 0
        this.dy += e.movementY || 0
        this.onAny?.()
      }
    }
    this._wheel = (e) => {
      if (e.target !== canvas) return
      this.wheel += Math.sign(e.deltaY)
      e.preventDefault()
    }
    this._lockChange = () => {
      this.locked = typeof document !== 'undefined' && document.pointerLockElement === canvas
    }
    this._lockError = () => {
      this.locked = false
    }
    // Arrastre con botón derecho como alternativa sin Pointer Lock
    this._down = (e) => {
      if (e.button === 2) this.dragging = true
    }
    this._upEv = (e) => {
      if (e.button === 2) this.dragging = false
    }
    this._ctx = (e) => e.target === canvas && e.preventDefault()
    if (typeof document !== 'undefined') {
      document.addEventListener('mousemove', this._move)
      document.addEventListener('pointerlockchange', this._lockChange)
      document.addEventListener('pointerlockerror', this._lockError)
      document.addEventListener('mouseup', this._upEv)
    }
    canvas?.addEventListener('wheel', this._wheel, { passive: false })
    canvas?.addEventListener('mousedown', this._down)
    canvas?.addEventListener('contextmenu', this._ctx)
  }

  requestLock() {
    if (!this.canvas?.requestPointerLock || this.locked) return
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true })
      p?.catch?.(() => {
        // Algunos navegadores no admiten unadjustedMovement: reintento simple
        try {
          this.canvas.requestPointerLock()?.catch?.(() => {})
        } catch {
          /* sin gesto válido: se reintenta al hacer clic */
        }
      })
    } catch {
      /* el navegador puede rechazarlo sin gesto del usuario */
    }
  }

  exitLock() {
    if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock?.()
  }

  /** Devuelve y reinicia los deltas acumulados. */
  takeDelta(out) {
    out.x = this.dx
    out.y = this.dy
    this.dx = 0
    this.dy = 0
    return out
  }

  takeWheel() {
    const w = this.wheel
    this.wheel = 0
    return w
  }

  dispose() {
    if (typeof document !== 'undefined') {
      document.removeEventListener('mousemove', this._move)
      document.removeEventListener('pointerlockchange', this._lockChange)
      document.removeEventListener('pointerlockerror', this._lockError)
      document.removeEventListener('mouseup', this._upEv)
    }
    this.canvas?.removeEventListener('wheel', this._wheel)
    this.canvas?.removeEventListener('mousedown', this._down)
    this.canvas?.removeEventListener('contextmenu', this._ctx)
  }
}
