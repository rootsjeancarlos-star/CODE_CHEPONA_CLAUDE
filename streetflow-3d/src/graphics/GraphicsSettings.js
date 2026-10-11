/**
 * STUB (WP-GFX lo reemplaza): aplica presets BAJO/MEDIO/ALTO/ULTRA (pixel ratio, sombras, post-FX,
 * distancia de visión, calidad de texturas) y gestiona el RenderPipeline de post-procesado.
 * API: apply(graphicsSettings), getPreset(id), dispose()
 */
export const GRAPHICS_PRESETS = {
  low: { maxPixelRatio: 1.0, shadowMapSize: 1024, shadows: true, postFX: 'none', viewDistance: 120, textureSize: 512 },
  medium: { maxPixelRatio: 1.25, shadowMapSize: 2048, shadows: true, postFX: 'fxaa', viewDistance: 200, textureSize: 1024 },
  high: { maxPixelRatio: 1.5, shadowMapSize: 2048, shadows: true, postFX: 'bloom', viewDistance: 320, textureSize: 1024 },
  ultra: { maxPixelRatio: 2.0, shadowMapSize: 4096, shadows: true, postFX: 'full', viewDistance: 450, textureSize: 2048 },
}

export class GraphicsSettings {
  constructor({ rendererManager, sceneManager, lighting, materials, bus }) {
    this.rendererManager = rendererManager
    this.sceneManager = sceneManager
    this.lighting = lighting
    this.materials = materials
    this.bus = bus
  }

  getPreset(id) {
    return GRAPHICS_PRESETS[id] || GRAPHICS_PRESETS.high
  }

  apply(g) {
    const p = this.getPreset(g.preset)
    this.rendererManager.setMaxPixelRatio(p.maxPixelRatio)
    this.rendererManager.setRenderScale(g.renderScale ?? 1)
    this.lighting.setTimeOfDay?.(g.timeOfDay || 'afternoon')
  }

  dispose() {}
}
