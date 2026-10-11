import * as THREE from 'three/webgpu'

/**
 * STUB (WP-CAM lo reemplaza): cámaras follow (por defecto), cinematic, free y menu (órbita del fondo del menú),
 * con anti-oclusión por rayo, suavizado y FOV dinámico.
 * API: setMode(mode), cycleMode(), update(dt, target), snap(target), applySettings(settings), mode
 *   target = { position: Vector3, quaternion: Quaternion, velocity: Vector3, forward: Vector3, grounded: boolean, state: string }
 */
export class CameraController {
  constructor(camera, { physics, input, bus, settings }) {
    this.camera = camera
    this.physics = physics
    this.input = input
    this.bus = bus
    this.settings = settings
    this.mode = 'follow'
    this._t = 0
    this._desired = new THREE.Vector3()
  }

  setMode(mode) {
    this.mode = mode
    this.bus?.emit('camera:modeChanged', { mode })
  }

  cycleMode() {
    const order = ['follow', 'cinematic', 'free']
    this.setMode(order[(order.indexOf(this.mode) + 1) % order.length])
  }

  snap(target) {
    if (target) this.update(1, target)
  }

  update(dt, target) {
    this._t += dt
    if (!target) return
    if (this.mode === 'menu') {
      const a = this._t * 0.08
      this.camera.position.set(target.position.x + Math.cos(a) * 9, target.position.y + 3.5, target.position.z + Math.sin(a) * 9)
    } else {
      this._desired.set(0, 1.6, -3.6).applyQuaternion(target.quaternion).add(target.position)
      this.camera.position.lerp(this._desired, 1 - Math.exp(-6 * dt))
    }
    this.camera.lookAt(target.position.x, target.position.y + 0.9, target.position.z)
  }

  applySettings(s) {
    this.settings = s
  }
}
