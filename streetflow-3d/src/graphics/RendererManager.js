import * as THREE from 'three/webgpu'

/** Error lanzado cuando el navegador no ofrece ni WebGPU ni WebGL2. */
export class GraphicsUnavailableError extends Error {
  constructor(message, cause) {
    super(message)
    this.name = 'GraphicsUnavailableError'
    this.cause = cause
  }
}

/** Comprueba si WebGL2 está disponible creando un contexto temporal. */
export function hasWebGL2() {
  try {
    const c = document.createElement('canvas')
    const gl = c.getContext('webgl2')
    const ok = !!gl
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    return ok
  } catch {
    return false
  }
}

export function hasWebGPU() {
  return typeof navigator !== 'undefined' && !!navigator.gpu
}

/**
 * Crea y gestiona el WebGPURenderer de Three.js (WebGPU con respaldo WebGL2).
 * - Un único bucle de animación (setAnimationLoop).
 * - Redimensionado con ResizeObserver y límite de devicePixelRatio.
 * - Pérdida de dispositivo/contexto → evento `graphics:deviceLost`.
 * - Post-procesado opcional: GraphicsSettings/PostFX asigna `renderPipeline` (THREE.RenderPipeline).
 */
export class RendererManager {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {Object} [o]
   * @param {'auto'|'webgl'|'webgpu'} [o.backend]
   * @param {boolean} [o.antialias]
   * @param {import('../core/EventBus.js').EventBus} [o.bus]
   */
  constructor(canvas, { backend = 'auto', antialias = true, bus = null } = {}) {
    this.canvas = canvas
    this.requestedBackend = backend
    this.antialias = antialias
    this.bus = bus
    /** @type {THREE.WebGPURenderer|null} */
    this.renderer = null
    this.backendName = 'none'
    this.maxPixelRatio = 1.5
    this.renderScale = 1
    /** @type {THREE.RenderPipeline|null} post-procesado activo (opcional) */
    this.renderPipeline = null
    this.width = 1
    this.height = 1
    this._resizeObserver = null
    this._resizeListeners = new Set()
    this.deviceLost = false
  }

  async init() {
    const wantWebGL = this.requestedBackend === 'webgl' || !hasWebGPU()
    if (wantWebGL && !hasWebGL2()) {
      throw new GraphicsUnavailableError(
        'Tu navegador no admite WebGPU ni WebGL2. Actualiza el navegador o activa la aceleración por hardware.',
      )
    }
    try {
      this.renderer = new THREE.WebGPURenderer({
        canvas: this.canvas,
        antialias: this.antialias,
        powerPreference: 'high-performance',
        forceWebGL: this.requestedBackend === 'webgl',
        alpha: false,
      })
      await this.renderer.init()
    } catch (err) {
      // Último intento: forzar WebGL2 si WebGPU falló de forma no recuperable.
      if (this.requestedBackend !== 'webgl' && hasWebGL2()) {
        console.warn('[RendererManager] WebGPU falló, reintentando con WebGL2:', err)
        try {
          this.renderer?.dispose?.()
        } catch {
          /* ignorar */
        }
        this.renderer = new THREE.WebGPURenderer({ canvas: this.canvas, antialias: this.antialias, forceWebGL: true, alpha: false })
        await this.renderer.init()
      } else {
        throw new GraphicsUnavailableError('No se pudo inicializar el renderizador 3D.', err)
      }
    }

    const r = this.renderer
    this.backendName = r.backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2'
    r.outputColorSpace = THREE.SRGBColorSpace
    r.toneMapping = THREE.ACESFilmicToneMapping
    r.toneMappingExposure = 1.0
    r.shadowMap.enabled = true
    r.shadowMap.type = THREE.PCFShadowMap // PCFSoftShadowMap se eliminó en r186 (usa PCF con shadow.radius)
    r.setClearColor(0x0a0d12, 1)

    r.onDeviceLost = (info) => {
      this.deviceLost = true
      console.error('[RendererManager] dispositivo gráfico perdido', info)
      this.bus?.emit('graphics:deviceLost', { info })
    }

    this._setupResize()
    return this
  }

  get isWebGPU() {
    return this.backendName === 'WebGPU'
  }

  /** @param {number} max */
  setMaxPixelRatio(max) {
    this.maxPixelRatio = max
    this._applySize()
  }

  /** Escala de resolución interna (0.5–1). */
  setRenderScale(scale) {
    this.renderScale = Math.min(1, Math.max(0.5, scale))
    this._applySize()
  }

  onResize(fn) {
    this._resizeListeners.add(fn)
    return () => this._resizeListeners.delete(fn)
  }

  _setupResize() {
    const target = this.canvas.parentElement || document.body
    const update = () => this._applySize()
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(update)
      this._resizeObserver.observe(target)
    }
    window.addEventListener('resize', update)
    this._onWindowResize = update
    this._applySize()
  }

  _applySize() {
    if (!this.renderer) return
    const target = this.canvas.parentElement || document.body
    const w = Math.max(1, target.clientWidth || window.innerWidth)
    const h = Math.max(1, target.clientHeight || window.innerHeight)
    const pr = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio) * this.renderScale
    this.width = w
    this.height = h
    this.renderer.setPixelRatio(pr)
    this.renderer.setSize(w, h, true)
    for (const fn of this._resizeListeners) fn(w, h)
  }

  /** @param {(time:number)=>void|null} cb */
  setAnimationLoop(cb) {
    return this.renderer.setAnimationLoop(cb)
  }

  render(scene, camera) {
    if (this.deviceLost) return
    if (this.renderPipeline) this.renderPipeline.render()
    else this.renderer.render(scene, camera)
  }

  /** Estadísticas para el depurador. */
  getStats() {
    const info = this.renderer?.info
    return {
      backend: this.backendName,
      calls: info?.render?.calls ?? 0,
      drawCalls: info?.render?.drawCalls ?? info?.render?.calls ?? 0,
      triangles: info?.render?.triangles ?? 0,
      geometries: info?.memory?.geometries ?? 0,
      textures: info?.memory?.textures ?? 0,
      pixelRatio: this.renderer?.getPixelRatio?.() ?? 1,
      width: this.width,
      height: this.height,
    }
  }

  dispose() {
    this._resizeObserver?.disconnect()
    window.removeEventListener('resize', this._onWindowResize)
    this.renderPipeline?.dispose?.()
    this.renderer?.setAnimationLoop(null)
    this.renderer?.dispose()
  }
}
