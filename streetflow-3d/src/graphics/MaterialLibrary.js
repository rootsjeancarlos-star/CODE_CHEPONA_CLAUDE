import * as THREE from 'three/webgpu'

/**
 * STUB (WP-WORLD lo reemplaza): biblioteca de materiales PBR con texturas procedurales
 * (hormigón, asfalto, metal, madera, pintura, lija, tela, caucho…), compartidos y reutilizados.
 * API: init(onProgress), get(name, variant?) → THREE.Material, setQuality(preset), dispose()
 */
export class MaterialLibrary {
  constructor({ rendererManager, quality = 'high' }) {
    this.rendererManager = rendererManager
    this.quality = quality
    this.cache = new Map()
  }

  async init(onProgress) {
    onProgress?.(1)
  }

  get(name) {
    if (!this.cache.has(name)) {
      const colors = { parkConcrete: 0xb9b5ad, concrete: 0xa8a49c, metal: 0x9aa0a6, wood: 0xb78a5a, asphalt: 0x3a3b3d, grass: 0x4d6b35 }
      this.cache.set(name, new THREE.MeshStandardMaterial({ color: colors[name] ?? 0xaaaaaa, roughness: name === 'metal' ? 0.35 : 0.85, metalness: name === 'metal' ? 0.9 : 0 }))
    }
    return this.cache.get(name)
  }

  setQuality(q) {
    this.quality = q
  }

  dispose() {
    this.cache.forEach((m) => m.dispose())
    this.cache.clear()
  }
}
