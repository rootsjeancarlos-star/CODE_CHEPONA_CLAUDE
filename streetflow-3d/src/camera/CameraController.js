import * as THREE from 'three/webgpu'
import { CAMERA, PHYSICS } from '../core/Config.js'

const _desired = new THREE.Vector3()
const _look = new THREE.Vector3()
const _dir = new THREE.Vector3()
const _tmp = new THREE.Vector3()
const _hv = new THREE.Vector3()
const _lookDelta = { x: 0, y: 0 }
const MODES = ['follow', 'cinematic', 'free']
const MODE_LABELS = { follow: 'Cámara de seguimiento', cinematic: 'Cámara cinemática', free: 'Cámara libre', menu: 'Menú', orbit: 'Órbita' }

const damp = (k, dt) => 1 - Math.exp(-k * dt)
const wrapPi = (a) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Cámaras (docs/ARCHITECTURE.md §12):
 *  - follow: tercera persona detrás de la dirección de marcha, suavizada, con mirada manual que vuelve al
 *    centro, anti-oclusión por rayo (CAMERA_BLOCKER) y FOV dinámico.
 *  - cinematic: "filmer" con trípode bajo junto a la línea del skater; cambia de plano al alejarse o perder
 *    la línea de visión.
 *  - free: órbita manual con zoom.
 *  - menu: órbita lenta para el fondo del menú.
 */
export class CameraController {
  constructor(camera, { physics, input, bus, settings }) {
    this.camera = camera
    this.physics = physics
    this.input = input
    this.bus = bus
    this.mode = 'follow'
    this.yaw = 0
    this.pitch = 0.18
    this.lookYaw = 0
    this.lookPitch = 0
    this.lookIdle = 0
    this.zoom = 1
    this.distance = CAMERA.follow.distance
    this.currentDistance = CAMERA.follow.distance
    this.position = new THREE.Vector3(0, 2, -4)
    this.target = new THREE.Vector3()
    this.fovBase = CAMERA.fov
    this.dynamicFov = true
    this.shakeEnabled = true
    this.shake = 0
    this._t = 0
    this._tripod = new THREE.Vector3()
    this._tripodAge = 99
    this._orbitYaw = 0
    this._hit = { point: new THREE.Vector3(), normal: new THREE.Vector3(), distance: 0, collider: null, surface: '' }
    this.applySettings(settings)
    this._offs = []
    if (bus?.on) this._offs.push(bus.on('skater:land', (e) => this.addShake(Math.min(1, (e.impact || 0) / 7))))
  }

  applySettings(settings) {
    const s = settings || {}
    this.distance = CAMERA.follow.distance * (s.gameplay?.cameraDistance ?? 1)
    this.dynamicFov = s.graphics?.dynamicFov !== false
    this.shakeEnabled = !s.accessibility?.reduceCameraShake
  }

  setMode(mode) {
    if (this.mode === mode) return
    this.mode = mode
    this._tripodAge = 99
    this.bus?.emit('camera:modeChanged', { mode })
    if (mode !== 'menu') this.bus?.emit('ui:notify', { text: MODE_LABELS[mode] || mode, kind: 'info', duration: 1.2 })
  }

  cycleMode() {
    const i = MODES.indexOf(this.mode)
    this.setMode(MODES[(i + 1) % MODES.length])
  }

  addShake(amount) {
    if (this.shakeEnabled) this.shake = Math.min(1, this.shake + amount * 0.6)
  }

  /** Coloca la cámara inmediatamente detrás del objetivo. */
  snap(target) {
    if (!target) return
    this.yaw = this._headingOf(target, this.yaw)
    this.lookYaw = 0
    this.lookPitch = 0
    this._followDesired(target, _desired)
    this.position.copy(_desired)
    this.currentDistance = this.distance
    this.target.copy(target.position).y += CAMERA.follow.lookHeight
    this._apply()
  }

  _headingOf(target, fallback) {
    _hv.copy(target.velocity).setY(0)
    if (_hv.lengthSq() > 2.25) return Math.atan2(_hv.x, _hv.z)
    _dir.copy(target.forward || _tmp.set(0, 0, 1)).setY(0)
    if (target.state === 'IDLE' || target.state === 'WALKING' || _hv.lengthSq() < 0.04) {
      if (_dir.lengthSq() > 1e-4) return Math.atan2(_dir.x, _dir.z)
    }
    return fallback
  }

  _followDesired(target, out) {
    const yaw = this.yaw + this.lookYaw
    const pitch = Math.min(1.2, Math.max(-0.35, this.pitch + this.lookPitch))
    const d = this.distance * this.zoom
    out.set(-Math.sin(yaw) * Math.cos(pitch) * d, CAMERA.follow.height - 0.6 + Math.sin(pitch) * d, -Math.cos(yaw) * Math.cos(pitch) * d)
    out.add(target.position)
    return out
  }

  update(dt, target) {
    if (!target) return
    this._t += dt
    // entrada de mirada y zoom
    this.input?.takeLook?.(_lookDelta) ?? ((_lookDelta.x = 0), (_lookDelta.y = 0))
    const z = this.input?.takeZoom?.() || 0
    if (z) this.zoom = Math.min(1.7, Math.max(0.55, this.zoom * (1 + z * 0.08)))
    switch (this.mode) {
      case 'menu':
        this._updateMenu(dt, target)
        break
      case 'cinematic':
        this._updateCinematic(dt, target)
        break
      case 'free':
        this._updateFree(dt, target)
        break
      default:
        this._updateFollow(dt, target)
    }
    this._apply(dt, target)
  }

  _updateFollow(dt, target) {
    // mirada manual con retorno al centro
    if (_lookDelta.x || _lookDelta.y) {
      this.lookYaw = wrapPi(this.lookYaw - _lookDelta.x)
      this.lookPitch = Math.min(0.9, Math.max(-0.5, this.lookPitch + _lookDelta.y))
      this.lookIdle = 0
    } else {
      this.lookIdle += dt
      const moving = target.velocity.lengthSq() > 4
      if (this.lookIdle > 1.2 && moving) {
        const k = damp(2.2, dt)
        this.lookYaw += (0 - this.lookYaw) * k
        this.lookPitch += (0 - this.lookPitch) * k
      }
    }
    // giro automático moderado hacia la dirección de marcha
    const heading = this._headingOf(target, this.yaw)
    const rate = target.grounded ? CAMERA.follow.rotationStiffness : CAMERA.follow.rotationStiffness * 0.35
    this.yaw += wrapPi(heading - this.yaw) * damp(rate, dt)
    this._followDesired(target, _desired)
    // suavizado (vertical más blando en el aire)
    const k = damp(CAMERA.follow.stiffness, dt)
    const ky = damp(target.grounded ? CAMERA.follow.stiffness : 3.0, dt)
    this.position.x += (_desired.x - this.position.x) * k
    this.position.z += (_desired.z - this.position.z) * k
    this.position.y += (_desired.y - this.position.y) * ky
    _look.copy(target.position)
    _look.y += CAMERA.follow.lookHeight
    this.target.lerp(_look, damp(12, dt))
    this._avoidOcclusion(dt)
  }

  /** Acerca la cámara si hay geometría entre el skater y la cámara. */
  _avoidOcclusion(dt) {
    if (!this.physics) return
    _dir.subVectors(this.position, this.target)
    const want = _dir.length()
    if (want < 1e-3) return
    _dir.divideScalar(want)
    const hit = this.physics.castRay(this.target, _dir, want + 0.3, { groups: PHYSICS.GROUP_SETS.cameraRay }, this._hit)
    let allowed = want
    if (hit) allowed = Math.max(CAMERA.follow.minDistance, hit.distance - 0.25)
    // acercar rápido, alejar despacio
    if (allowed < this.currentDistance) this.currentDistance = allowed
    else this.currentDistance += (allowed - this.currentDistance) * damp(2.5, dt)
    if (this.currentDistance < want) this.position.copy(this.target).addScaledVector(_dir, this.currentDistance)
    // nunca por debajo del suelo visible
    if (this.position.y < this.target.y - 0.9) this.position.y = this.target.y - 0.9
  }

  _updateCinematic(dt, target) {
    this._tripodAge += dt
    const dist = this._tripod.distanceTo(target.position)
    if (this._tripodAge > 6 || dist > 11 || dist < 1.2 || this._occluded(this._tripod, target.position)) {
      // nuevo plano: adelante en la línea, a un lado y bajo
      _hv.copy(target.velocity).setY(0)
      if (_hv.lengthSq() < 0.25) _hv.set(Math.sin(this.yaw), 0, Math.cos(this.yaw))
      _hv.normalize()
      const side = (Math.floor(this._t * 0.37) % 2 === 0 ? 1 : -1) * (2.6 + (this._t % 1.5))
      this._tripod.copy(target.position).addScaledVector(_hv, 5.5).add(_tmp.set(_hv.z * side, 0, -_hv.x * side))
      this._tripod.y = target.position.y + 0.45
      if (this._occluded(this._tripod, target.position)) this._tripod.add(_tmp.set(-_hv.z * side * 2, 0.6, _hv.x * side * 2))
      this.position.copy(this._tripod)
      this._tripodAge = 0
    }
    _look.copy(target.position)
    _look.y += 0.75
    this.target.lerp(_look, damp(6, dt))
  }

  _occluded(from, to) {
    if (!this.physics) return false
    _dir.subVectors(to, from)
    const d = _dir.length()
    if (d < 1e-3) return false
    _dir.divideScalar(d)
    return !!this.physics.castRay(from, _dir, d - 0.4, { groups: PHYSICS.GROUP_SETS.cameraRay }, this._hit)
  }

  _updateFree(dt, target) {
    this.yaw = wrapPi(this.yaw - _lookDelta.x)
    this.pitch = Math.min(1.35, Math.max(-0.3, this.pitch + _lookDelta.y))
    const d = this.distance * 1.4 * this.zoom
    _desired.set(-Math.sin(this.yaw) * Math.cos(this.pitch) * d, Math.sin(this.pitch) * d + 0.8, -Math.cos(this.yaw) * Math.cos(this.pitch) * d).add(target.position)
    this.position.lerp(_desired, damp(10, dt))
    _look.copy(target.position)
    _look.y += 0.9
    this.target.lerp(_look, damp(12, dt))
    this._avoidOcclusion(dt)
  }

  _updateMenu(dt, target) {
    this._orbitYaw += dt * CAMERA.cinematic.orbitSpeed
    const r = 10.5
    _desired.set(Math.cos(this._orbitYaw) * r, 3.4, Math.sin(this._orbitYaw) * r).add(target.position)
    this.position.lerp(_desired, damp(2, dt))
    _look.copy(target.position)
    _look.y += 1.0
    this.target.lerp(_look, damp(3, dt))
  }

  _apply(dt = 0, target = null) {
    const cam = this.camera
    cam.position.copy(this.position)
    if (this.shake > 0.001) {
      const s = this.shake * 0.06
      cam.position.x += Math.sin(this._t * 61) * s
      cam.position.y += Math.sin(this._t * 47 + 1.3) * s
      this.shake *= Math.exp(-dt * 7)
    }
    cam.lookAt(this.target)
    // FOV dinámico por velocidad
    let fov = this.fovBase
    if (this.dynamicFov && target && CAMERA.dynamicFov.enabled && this.mode !== 'menu') {
      const sp = target.velocity.length()
      fov += CAMERA.dynamicFov.maxExtra * Math.min(1, sp / CAMERA.dynamicFov.speedForMax)
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * (dt ? damp(3, dt) : 1)
      cam.updateProjectionMatrix()
    }
  }

  dispose() {
    this._offs.forEach((o) => o?.())
  }
}
