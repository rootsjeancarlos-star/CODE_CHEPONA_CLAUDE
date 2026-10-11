import * as THREE from 'three/webgpu'
import { CAMERA } from '../core/Config.js'

/**
 * Escena única del juego con grupos lógicos y la cámara principal.
 * - world: geometría del nivel (WorldManager)
 * - actors: skater, tabla, objetos dinámicos
 * - fx: partículas y efectos
 * - debug: ayudas visuales (solo con ?debug=1)
 */
export class SceneManager {
  /** @param {import('./RendererManager.js').RendererManager} rendererManager */
  constructor(rendererManager) {
    this.rendererManager = rendererManager
    this.scene = new THREE.Scene()
    this.scene.name = 'StreetflowScene'
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far)
    this.camera.position.set(0, 2, 6)
    this.world = this._group('world')
    this.actors = this._group('actors')
    this.fx = this._group('fx')
    this.debug = this._group('debug')
    this.debug.visible = false
    this._offResize = rendererManager.onResize((w, h) => this.setAspect(w / h))
    this.setAspect(rendererManager.width / rendererManager.height)
  }

  _group(name) {
    const g = new THREE.Group()
    g.name = name
    this.scene.add(g)
    return g
  }

  setAspect(aspect) {
    if (!Number.isFinite(aspect) || aspect <= 0) return
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  /** Cuenta objetos visibles (para el depurador). */
  countObjects() {
    let meshes = 0
    let total = 0
    this.scene.traverseVisible((o) => {
      total++
      if (o.isMesh) meshes++
    })
    return { total, meshes }
  }

  /** Libera recursos de un subárbol (geometrías, materiales y texturas). */
  static disposeObject(root) {
    const textures = new Set()
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k]
          if (v && v.isTexture) textures.add(v)
        }
        m.dispose()
      }
    })
    textures.forEach((t) => t.dispose())
  }

  dispose() {
    this._offResize?.()
    SceneManager.disposeObject(this.scene)
  }
}
