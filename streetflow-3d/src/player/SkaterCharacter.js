import * as THREE from 'three/webgpu'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

/**
 * STUB (WP-CHAR lo reemplaza): carga public/assets/characters/skater.glb (malla humana MakeHuman CC0 con rig
 * game_engine de 53 huesos, ropa y pelo con skinning) y aplica materiales/personalización.
 * Si el GLB falta o está dañado, crea un sustituto visible y avisa (sin bloquear el juego).
 * API: static load(url, {customization, materials, onProgress}), object3d, skeleton, bones (Map), meshes,
 *      isFallback, applyCustomization(c), dispose()
 */
export class SkaterCharacter {
  static async load(url, { customization, materials, onProgress } = {}) {
    const ch = new SkaterCharacter()
    try {
      const gltf = await new GLTFLoader().loadAsync(url, (e) => e.total && onProgress?.(e.loaded / e.total))
      ch._fromGLTF(gltf)
    } catch (err) {
      console.warn('[SkaterCharacter] no se pudo cargar el modelo, usando sustituto:', err?.message || err)
      ch._fallback()
    }
    ch.applyCustomization(customization)
    return ch
  }

  constructor() {
    this.object3d = new THREE.Group()
    this.object3d.name = 'SkaterCharacter'
    this.skeleton = null
    this.bones = new Map()
    this.meshes = []
    this.isFallback = false
  }

  _fromGLTF(gltf) {
    this.object3d.add(gltf.scene)
    gltf.scene.traverse((o) => {
      if (o.isBone) this.bones.set(o.name, o)
      if (o.isSkinnedMesh) {
        this.skeleton = this.skeleton || o.skeleton
        o.castShadow = true
        o.frustumCulled = false
        this.meshes.push(o)
      }
    })
  }

  _fallback() {
    this.isFallback = true
    const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 1.2, 6, 12), new THREE.MeshStandardMaterial({ color: 0x2a2a2a }))
    m.position.y = 0.85
    m.castShadow = true
    this.object3d.add(m)
  }

  applyCustomization() {}

  dispose() {
    this.object3d.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose?.()
    })
  }
}
