import * as THREE from 'three/webgpu'
import { DEFAULT_BOARD_SETUP, computeBoardGeometry } from './SkateboardSetup.js'

/**
 * STUB (WP-BOARD lo reemplaza): modelo detallado (deck con concave y kicks, lija, 7 capas, trucks,
 * ruedas, rodamientos, tornillos, gráfico original). API en docs/ARCHITECTURE.md §11.
 */
export class SkateboardVisual {
  constructor({ setup = DEFAULT_BOARD_SETUP, materials, customization } = {}) {
    this.setup = setup
    this.geo = computeBoardGeometry(setup)
    this.object3d = new THREE.Group()
    this.object3d.name = 'SkateboardVisual'
    this.flipPivot = new THREE.Group()
    this.object3d.add(this.flipPivot)
    const deck = new THREE.Mesh(
      new THREE.BoxGeometry(setup.deck.width, setup.deck.thickness, setup.deck.length),
      new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.95 }),
    )
    deck.position.y = -setup.deck.thickness / 2
    deck.castShadow = true
    this.flipPivot.add(deck)
  }

  update(dt, s) {
    if (s?.boardRelative) this.flipPivot.quaternion.copy(s.boardRelative)
  }

  /** Objetivos de pie en coordenadas de mundo. */
  getFootAnchors(stance, out) {
    const o = out || { front: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, back: { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() } }
    this.flipPivot.updateWorldMatrix(true, false)
    o.front.position.set(...this.geo.footPositions.front).applyMatrix4(this.flipPivot.matrixWorld)
    o.back.position.set(...this.geo.footPositions.back).applyMatrix4(this.flipPivot.matrixWorld)
    this.flipPivot.getWorldQuaternion(o.front.quaternion)
    o.back.quaternion.copy(o.front.quaternion)
    return o
  }

  applyCustomization() {}

  dispose() {
    this.object3d.traverse((o) => {
      o.geometry?.dispose()
      o.material?.dispose?.()
    })
  }
}
