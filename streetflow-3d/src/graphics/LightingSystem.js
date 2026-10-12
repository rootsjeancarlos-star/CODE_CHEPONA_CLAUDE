import * as THREE from 'three/webgpu'
import { SkyMesh } from 'three/addons/objects/SkyMesh.js'

const DEG = Math.PI / 180

/**
 * Presets horarios (docs/ART_DIRECTION.md: tarde soleada por defecto; mañana, atardecer y noche).
 * elevation/azimuth en grados; colores en sRGB.
 */
export const TIME_PRESETS = Object.freeze({
  morning: { label: 'Mañana', elevation: 20, azimuth: 100, sunColor: '#fff2df', sunIntensity: 2.7, hemiSky: '#cfe1ff', hemiGround: '#6f6455', hemiIntensity: 0.85, turbidity: 3, rayleigh: 1.3, mie: 0.004, mieG: 0.8, exposure: 0.5, fog: '#cad8e5', fogDensity: 0.0032, envIntensity: 0.38, clouds: 0.3, lamps: 0 },
  afternoon: { label: 'Tarde', elevation: 36, azimuth: 222, sunColor: '#fff0d8', sunIntensity: 3.3, hemiSky: '#bdd5ff', hemiGround: '#7b6b56', hemiIntensity: 0.8, turbidity: 4, rayleigh: 1.15, mie: 0.005, mieG: 0.8, exposure: 0.48, fog: '#cfdbe7', fogDensity: 0.0026, envIntensity: 0.38, clouds: 0.35, lamps: 0 },
  sunset: { label: 'Atardecer', elevation: 5, azimuth: 252, sunColor: '#ffad66', sunIntensity: 2.6, hemiSky: '#ffc08e', hemiGround: '#5d4636', hemiIntensity: 0.65, turbidity: 9, rayleigh: 2.6, mie: 0.012, mieG: 0.92, exposure: 0.62, fog: '#e6b089', fogDensity: 0.0038, envIntensity: 0.35, clouds: 0.45, lamps: 0.6 },
  night: { label: 'Noche', elevation: 38, azimuth: 140, sunColor: '#93a9ff', sunIntensity: 0.32, hemiSky: '#22314f', hemiGround: '#0b0b10', hemiIntensity: 0.4, turbidity: 2, rayleigh: 0.5, mie: 0.002, mieG: 0.7, exposure: 0.95, fog: '#0c1424', fogDensity: 0.0055, envIntensity: 0.15, clouds: 0.2, lamps: 1, night: true },
})

const SHADOW_QUALITY = {
  low: { size: 1024, half: 22, radius: 1 },
  medium: { size: 2048, half: 30, radius: 2 },
  high: { size: 2048, half: 38, radius: 3 },
  ultra: { size: 4096, half: 50, radius: 3 },
}

const _dir = new THREE.Vector3()
const _right = new THREE.Vector3()
const _up = new THREE.Vector3()
const _focus = new THREE.Vector3()

/**
 * Iluminación: cielo físico (SkyMesh), sol direccional con sombras que siguen al foco (con ajuste a texel
 * para evitar parpadeo), luz hemisférica, mapa de entorno PMREM del cielo, niebla y farolas en la noche.
 */
export class LightingSystem {
  constructor({ sceneManager, rendererManager, bus }) {
    this.sceneManager = sceneManager
    this.rendererManager = rendererManager
    this.bus = bus
    this.scene = sceneManager.scene
    this.timeOfDay = 'afternoon'
    this.quality = 'high'
    this.shadowsEnabled = true
    this.lampPositions = []
    this.lampLights = []
    this.maxLampLights = 6
    this._lampTimer = 0
    this._envDirty = true
  }

  async init() {
    const scene = this.scene
    // Cielo
    this.sky = new SkyMesh()
    this.sky.scale.setScalar(450)
    this.sky.frustumCulled = false
    this.sky.renderOrder = -1
    scene.add(this.sky)
    this.nightColor = new THREE.Color('#070c16')
    // Luces
    this.hemi = new THREE.HemisphereLight(0xbdd5ff, 0x7b6b56, 0.8)
    scene.add(this.hemi)
    this.sun = new THREE.DirectionalLight(0xfff0d8, 3.3)
    this.sun.castShadow = true
    this.sun.shadow.bias = -0.0003
    this.sun.shadow.normalBias = 0.025
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 180
    scene.add(this.sun, this.sun.target)
    // Farolas (luces puntuales reutilizadas, sin sombras)
    for (let i = 0; i < this.maxLampLights; i++) {
      const l = new THREE.PointLight(0xffc58a, 0, 14, 1.6)
      l.visible = false
      scene.add(l)
      this.lampLights.push(l)
    }
    scene.fog = new THREE.FogExp2(0xcfdbe7, 0.0026)
    // Entorno (PMREM del cielo)
    this.pmrem = new THREE.PMREMGenerator(this.rendererManager.renderer)
    this.envScene = new THREE.Scene()
    this.envSky = new SkyMesh()
    this.envSky.scale.setScalar(80)
    this.envScene.add(this.envSky)
    this.setQuality('high')
    this.setTimeOfDay(this.timeOfDay)
  }

  /** @param {'morning'|'afternoon'|'sunset'|'night'} id */
  setTimeOfDay(id) {
    const p = TIME_PRESETS[id] || TIME_PRESETS.afternoon
    this.timeOfDay = TIME_PRESETS[id] ? id : 'afternoon'
    this.preset = p
    _dir.setFromSphericalCoords(1, (90 - p.elevation) * DEG, p.azimuth * DEG)
    this.sunDir = _dir.clone()
    this.sun.color.set(p.sunColor)
    this.sun.intensity = p.sunIntensity
    this.hemi.color.set(p.hemiSky)
    this.hemi.groundColor.set(p.hemiGround)
    this.hemi.intensity = p.hemiIntensity
    for (const sky of [this.sky, this.envSky]) {
      sky.turbidity.value = p.turbidity
      sky.rayleigh.value = p.rayleigh
      sky.mieCoefficient.value = p.mie
      sky.mieDirectionalG.value = p.mieG
      sky.cloudCoverage.value = p.clouds
      sky.sunPosition.value.copy(p.night ? _dir.set(0, -1, 0) : this.sunDir)
      sky.showSunDisc.value = p.night ? 0 : 1
    }
    this.sky.visible = !p.night
    this.scene.background = p.night ? this.nightColor : null
    this.scene.fog.color.set(p.fog)
    this.baseFogDensity = p.fogDensity
    this.scene.fog.density = p.fogDensity * (this.fogScale ?? 1)
    this.rendererManager.renderer.toneMappingExposure = p.exposure
    this.scene.environmentIntensity = p.envIntensity
    this.lampIntensity = p.lamps
    for (const l of this.lampLights) l.visible = p.lamps > 0 && l.userData.assigned
    this._envDirty = true
    this.bus?.emit('lighting:timeOfDay', { id: this.timeOfDay, lamps: p.lamps > 0 })
  }

  /** Calidad de sombras: tamaño del mapa, radio y extensión. */
  setQuality(preset, { shadows = true } = {}) {
    this.quality = SHADOW_QUALITY[preset] ? preset : 'high'
    const q = SHADOW_QUALITY[this.quality]
    this.shadowsEnabled = shadows
    this.sun.castShadow = shadows
    const cam = this.sun.shadow.camera
    cam.left = -q.half
    cam.right = q.half
    cam.top = q.half
    cam.bottom = -q.half
    cam.updateProjectionMatrix()
    this.sun.shadow.radius = q.radius
    if (this.sun.shadow.mapSize.x !== q.size) {
      this.sun.shadow.mapSize.set(q.size, q.size)
      this.sun.shadow.map?.dispose?.()
      this.sun.shadow.map = null
    }
    this.sky.cloudCoverage.value = preset === 'low' ? 0 : this.preset?.clouds ?? 0.35
  }

  /** Escala de la densidad de niebla según la distancia de visión. */
  setFogScale(s) {
    this.fogScale = s
    if (this.scene.fog) this.scene.fog.density = (this.baseFogDensity ?? 0.003) * s
  }

  /** Posiciones de farolas del nivel (WorldManager.getLampPositions()). */
  setLampPositions(positions = []) {
    this.lampPositions = positions.map((p) => (Array.isArray(p) ? new THREE.Vector3(p[0], p[1], p[2]) : new THREE.Vector3(p.x, p.y, p.z)))
    this._lampTimer = 99
  }

  _updateEnvironment() {
    this._envDirty = false
    try {
      const old = this.envRT
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 200)
      this.scene.environment = this.envRT.texture
      old?.dispose?.()
    } catch (err) {
      console.warn('[LightingSystem] no se pudo generar el entorno PMREM', err)
    }
  }

  update(dt, focusPosition) {
    if (this._envDirty) this._updateEnvironment()
    const cam = this.sceneManager.camera
    this.sky.position.copy(cam.position)
    // Sol siguiendo al foco con ajuste a texel de la sombra
    const q = SHADOW_QUALITY[this.quality]
    const texel = (q.half * 2) / q.size
    _focus.copy(focusPosition || cam.position)
    _dir.copy(this.sunDir)
    _right.crossVectors(_dir, THREE.Object3D.DEFAULT_UP).normalize()
    if (_right.lengthSq() < 1e-6) _right.set(1, 0, 0)
    _up.crossVectors(_right, _dir).normalize()
    const a = Math.round(_focus.dot(_right) / texel) * texel
    const b = Math.round(_focus.dot(_up) / texel) * texel
    const c = _focus.dot(_dir)
    _focus.copy(_right).multiplyScalar(a).addScaledVector(_up, b).addScaledVector(_dir, c)
    this.sun.target.position.copy(_focus)
    this.sun.position.copy(_focus).addScaledVector(_dir, 80)
    this.sun.target.updateMatrixWorld()
    // Farolas: asigna las luces a las farolas más cercanas (1 vez por segundo)
    this._lampTimer += dt
    if (this.lampIntensity > 0 && this._lampTimer > 1 && this.lampPositions.length) {
      this._lampTimer = 0
      const sorted = this.lampPositions.slice().sort((p1, p2) => p1.distanceToSquared(cam.position) - p2.distanceToSquared(cam.position))
      for (let i = 0; i < this.lampLights.length; i++) {
        const l = this.lampLights[i]
        const p = sorted[i]
        l.userData.assigned = !!p
        l.visible = !!p
        if (p) {
          l.position.copy(p)
          l.intensity = 18 * this.lampIntensity
        }
      }
    }
  }

  dispose() {
    this.envRT?.dispose?.()
    this.pmrem?.dispose?.()
    this.sky?.geometry?.dispose()
    this.sky?.material?.dispose()
    this.envSky?.geometry?.dispose()
    this.envSky?.material?.dispose()
  }
}
