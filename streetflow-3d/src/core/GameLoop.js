/**
 * Bucle principal con paso fijo para la física y render a frecuencia variable.
 * - fixedDt (1/60 por defecto) con acumulador.
 * - Límite de pasos por fotograma para evitar la "espiral de la muerte".
 * - alpha = acumulador / fixedDt para interpolar el render.
 * El bucle de render lo dirige RendererManager (renderer.setAnimationLoop) llamando a frame(time).
 */
export class GameLoop {
  /**
   * @param {Object} o
   * @param {(dt:number)=>void} o.fixedUpdate
   * @param {(alpha:number, frameDt:number, time:number)=>void} o.render
   * @param {number} [o.fixedDt]
   * @param {number} [o.maxStepsPerFrame]
   * @param {number} [o.maxFrameDelta]
   */
  constructor({ fixedUpdate, render, fixedDt = 1 / 60, maxStepsPerFrame = 5, maxFrameDelta = 0.25 }) {
    this.fixedUpdate = fixedUpdate
    this.render = render
    this.fixedDt = fixedDt
    this.maxStepsPerFrame = maxStepsPerFrame
    this.maxFrameDelta = maxFrameDelta
    this.timeScale = 1
    this.simulationPaused = true
    this.accumulator = 0
    this.lastTime = null
    this.simTime = 0
    this.frameCount = 0
    // Estadísticas del último fotograma (para DebugSystem)
    this.stats = { stepsLastFrame: 0, droppedTime: 0, totalDroppedTime: 0, frameDt: 0, fixedTimeMs: 0, renderTimeMs: 0 }
  }

  /** Activa/desactiva la simulación (el render sigue). */
  setSimulationPaused(paused) {
    this.simulationPaused = paused
    this.accumulator = 0
  }

  /** Descarta el delta acumulado (p.ej. tras volver de una pestaña oculta). */
  resetTiming() {
    this.lastTime = null
    this.accumulator = 0
  }

  /**
   * Avanza un fotograma. `time` en milisegundos (como en requestAnimationFrame).
   * Devuelve el número de pasos fijos ejecutados.
   */
  frame(time) {
    const now = typeof time === 'number' ? time : performance.now()
    let frameDt = this.lastTime === null ? 0 : (now - this.lastTime) / 1000
    this.lastTime = now
    if (!(frameDt >= 0)) frameDt = 0
    if (frameDt > this.maxFrameDelta) frameDt = this.maxFrameDelta

    let steps = 0
    this.stats.droppedTime = 0
    const t0 = performance.now()
    if (!this.simulationPaused) {
      this.accumulator += frameDt * this.timeScale
      while (this.accumulator >= this.fixedDt && steps < this.maxStepsPerFrame) {
        this.fixedUpdate(this.fixedDt)
        this.accumulator -= this.fixedDt
        this.simTime += this.fixedDt
        steps++
      }
      if (steps >= this.maxStepsPerFrame && this.accumulator >= this.fixedDt) {
        // Descartar el exceso: la simulación se ralentiza en vez de bloquear el navegador.
        this.stats.droppedTime = this.accumulator - (this.accumulator % this.fixedDt)
        this.stats.totalDroppedTime += this.stats.droppedTime
        this.accumulator %= this.fixedDt
      }
    }
    const t1 = performance.now()
    const alpha = this.simulationPaused ? 1 : this.accumulator / this.fixedDt
    this.render(alpha, frameDt, now)
    const t2 = performance.now()

    this.stats.stepsLastFrame = steps
    this.stats.frameDt = frameDt
    this.stats.fixedTimeMs = t1 - t0
    this.stats.renderTimeMs = t2 - t1
    this.frameCount++
    return steps
  }
}
