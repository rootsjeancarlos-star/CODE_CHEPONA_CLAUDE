import * as THREE from 'three/webgpu'

/**
 * STUB (WP-GFX lo reemplaza): sol direccional con sombras que siguen al foco, cielo físico (SkyMesh),
 * entorno PMREM, hemisférica, niebla y presets horarios: morning | afternoon | sunset | night.
 * API: init(), setTimeOfDay(id), setQuality(preset), update(dt, focusPosition), sun, dispose()
 */
export class LightingSystem {
  constructor({ sceneManager, rendererManager, bus }) {
    this.sceneManager = sceneManager
    this.rendererManager = rendererManager
    this.bus = bus
    this.timeOfDay = 'afternoon'
  }

  async init() {
    const scene = this.sceneManager.scene
    scene.background = new THREE.Color(0x8fb3d9)
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x5a4a3a, 1.2)
    scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff0dd, 2.5)
    this.sun.position.set(30, 40, 20)
    this.sun.castShadow = true
    scene.add(this.sun, this.sun.target)
  }

  setTimeOfDay(id) {
    this.timeOfDay = id
  }

  setQuality() {}

  update() {}

  dispose() {
    this.sun?.dispose?.()
  }
}
