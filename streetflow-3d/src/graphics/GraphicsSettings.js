import { CAMERA } from '../core/Config.js'
import { createPostFX } from './PostFX.js'

/**
 * Presets gráficos (docs/ARCHITECTURE.md §18). Ajustan resolución, sombras, post-procesado, distancia de
 * visión y tamaño de las texturas procedurales. Los valores "auto" se eligen según el backend y el hardware.
 */
export const GRAPHICS_PRESETS = Object.freeze({
  low: { label: 'Bajo', maxPixelRatio: 1.0, renderScale: 0.85, shadows: true, shadowQuality: 'low', postFX: 'none', viewDistance: 140, textureQuality: 'low', antialias: false },
  medium: { label: 'Medio', maxPixelRatio: 1.25, renderScale: 1, shadows: true, shadowQuality: 'medium', postFX: 'fxaa', viewDistance: 220, textureQuality: 'medium', antialias: true },
  high: { label: 'Alto', maxPixelRatio: 1.5, renderScale: 1, shadows: true, shadowQuality: 'high', postFX: 'bloom', viewDistance: 340, textureQuality: 'high', antialias: true },
  ultra: { label: 'Ultra', maxPixelRatio: 2.0, renderScale: 1, shadows: true, shadowQuality: 'ultra', postFX: 'full', viewDistance: 480, textureQuality: 'ultra', antialias: true },
})

/** Sugerencia inicial según el hardware y el backend. */
export function suggestPreset({ backend = 'WebGL2', cores = 4, memory = 8, softwareRenderer = false } = {}) {
  if (softwareRenderer) return 'low'
  if (backend === 'WebGPU' && cores >= 8 && memory >= 8) return 'high'
  if (cores >= 6) return 'high'
  if (cores >= 4) return 'medium'
  return 'low'
}

export class GraphicsSettings {
  constructor({ rendererManager, sceneManager, lighting, materials, bus }) {
    this.rendererManager = rendererManager
    this.sceneManager = sceneManager
    this.lighting = lighting
    this.materials = materials
    this.bus = bus
    this.current = null
    this._postMode = null
  }

  getPreset(id) {
    return GRAPHICS_PRESETS[id] || GRAPHICS_PRESETS.high
  }

  /** @param {{preset:string, renderScale?:number, shadows?:boolean, postFX?:boolean, timeOfDay?:string}} g */
  apply(g) {
    const p = this.getPreset(g.preset)
    const rm = this.rendererManager
    rm.setMaxPixelRatio(p.maxPixelRatio)
    rm.setRenderScale((g.renderScale ?? 1) * p.renderScale)
    const shadows = g.shadows !== false && p.shadows
    rm.renderer.shadowMap.enabled = shadows
    this.lighting.setQuality(p.shadowQuality, { shadows })
    // distancia de visión: plano lejano y niebla
    const cam = this.sceneManager.camera
    cam.far = Math.max(CAMERA.near * 10, p.viewDistance + 120)
    cam.updateProjectionMatrix()
    this.lighting.setFogScale(320 / p.viewDistance)
    if (g.timeOfDay && g.timeOfDay !== this.lighting.timeOfDay) this.lighting.setTimeOfDay(g.timeOfDay)
    // texturas procedurales (solo si cambia la calidad: regenerarlas es costoso)
    if (this.current?.textureQuality !== p.textureQuality) this.materials.setQuality?.(p.textureQuality)
    // post-procesado
    const postMode = g.postFX === false ? 'none' : p.postFX
    if (postMode !== this._postMode) {
      rm.renderPipeline?.dispose?.()
      rm.renderPipeline = null
      try {
        rm.renderPipeline = createPostFX(rm, this.sceneManager.scene, cam, postMode)
      } catch (err) {
        console.warn('[GraphicsSettings] post-procesado no disponible; se desactiva', err)
        rm.renderPipeline = null
      }
      this._postMode = postMode
    }
    this.current = p
    this.bus?.emit('graphics:applied', { preset: g.preset, postFX: postMode })
  }

  dispose() {
    this.rendererManager.renderPipeline?.dispose?.()
  }
}
