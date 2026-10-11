import * as THREE from 'three/webgpu'

/**
 * STUB (WP-WORLD lo reemplaza): carga niveles (ParkDescriptor + distrito urbano), construye módulos
 * con colliders, registra aristas grindables y gestiona streaming de chunks.
 * API: loadLevel(idOrDescriptor, {onProgress}) → Promise<{spawn}>, unload(), update(dt, cameraPosition),
 *      getSpawn() → {position:[x,y,z], yaw}, getRespawnPoints(), current → {id, descriptor, modules}
 */
export class WorldManager {
  constructor({ sceneManager, physics, materials, spots, lighting, bus }) {
    this.sceneManager = sceneManager
    this.physics = physics
    this.materials = materials
    this.spots = spots
    this.lighting = lighting
    this.bus = bus
    this.current = null
    this._colliders = []
    this._root = null
  }

  async loadLevel(idOrDescriptor, { onProgress } = {}) {
    this.unload()
    const id = typeof idOrDescriptor === 'string' ? idOrDescriptor : idOrDescriptor.id || 'custom'
    this._root = new THREE.Group()
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, 120).rotateX(-Math.PI / 2), this.materials.get('parkConcrete'))
    ground.receiveShadow = true
    this._root.add(ground)
    this.sceneManager.world.add(this._root)
    this._colliders.push(this.physics.addStaticBox([60, 0.5, 60], [0, -0.5, 0], null, { surface: 'parkConcrete' }))
    this.current = { id, descriptor: typeof idOrDescriptor === 'object' ? idOrDescriptor : null, modules: [] }
    onProgress?.(1)
    return { spawn: this.getSpawn() }
  }

  unload() {
    for (const c of this._colliders) this.physics.removeCollider(c)
    this._colliders.length = 0
    if (this._root) {
      this.sceneManager.world.remove(this._root)
      this._root = null
    }
    this.spots.clear()
    this.current = null
  }

  getSpawn() {
    return { position: [0, 0, 0], yaw: 0 }
  }

  getRespawnPoints() {
    return [this.getSpawn()]
  }

  update() {}
}
