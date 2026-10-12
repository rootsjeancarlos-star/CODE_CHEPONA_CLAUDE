import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { makeScene, run, neutral, extrudeProfile, quarterPipeProfile } from '../helpers/physicsScene.js'
import { PhysicsWorld } from '../../src/physics/PhysicsWorld.js'
import { SkateboardPhysics } from '../../src/physics/SkateboardPhysics.js'
import { GameLoop } from '../../src/core/GameLoop.js'

const upY = (q) => new Vector3(0, 1, 0).applyQuaternion(q).y

describe('SkateboardPhysics — suelo plano', () => {
  it('reposa sobre las 4 ruedas sin vibrar ni NaN', async () => {
    const sc = await makeScene()
    const t = sc.sb.getTelemetry()
    let maxV = 0
    run(sc, 30) // asentamiento tras aparecer
    run(sc, 240, neutral(), () => (maxV = Math.max(maxV, t.speed)))
    expect(t.contactCount).toBe(4)
    expect(t.grounded).toBe(true)
    expect(Number.isFinite(t.position.y)).toBe(true)
    expect(maxV).toBeLessThan(0.02)
    expect(Math.abs(t.position.y - sc.sb.solver.rideHeight)).toBeLessThan(0.003)
  })

  it('las patadas aceleran con rendimiento decreciente y la rodadura frena hasta parar', async () => {
    const sc = await makeScene()
    const t = sc.sb.getTelemetry()
    run(sc, 70, (i) => neutral({ push: i === 0 }))
    const afterOne = t.speed
    run(sc, 300, () => neutral({ pushHeld: true }))
    const afterMany = t.speed
    expect(afterOne).toBeGreaterThan(1.2)
    expect(afterOne).toBeLessThan(2.4)
    expect(afterMany).toBeGreaterThan(5)
    expect(afterMany).toBeLessThan(8) // límite de empuje
    run(sc, 60 * 30)
    expect(t.speed).toBeLessThan(afterMany * 0.6) // la rodadura disipa energía
    run(sc, 600, () => neutral({ brake: 1 }))
    expect(t.speed).toBeLessThan(0.05)
  })

  it('A/D giran de forma progresiva sin volcar', async () => {
    const sc = await makeScene()
    const t = sc.sb.getTelemetry()
    run(sc, 200, () => neutral({ pushHeld: true }))
    const v0 = t.velocity.clone().setY(0).normalize()
    run(sc, 60, () => neutral({ steer: 1 })) // derecha
    const v1 = t.velocity.clone().setY(0).normalize()
    const turn = Math.atan2(v0.x * v1.z - v0.z * v1.x, v0.dot(v1)) // >0 = giro hacia la derecha (sentido horario visto desde arriba)
    expect(turn).toBeGreaterThan(0.3)
    expect(upY(t.quaternion)).toBeGreaterThan(0.95)
    expect(t.lean).toBeGreaterThan(0.1)
  })
})

describe('SkateboardPhysics — pendiente, ollie y flips', () => {
  it('desciende una pendiente de 10° acelerando cerca de g·sinθ', async () => {
    const physics = await PhysicsWorld.create()
    const ang = (10 * Math.PI) / 180
    const L = 60
    physics.addStaticTrimesh(new Float32Array([-5, 0, 0, 5, 0, 0, 5, -Math.sin(ang) * L, Math.cos(ang) * L, -5, -Math.sin(ang) * L, Math.cos(ang) * L]), new Uint32Array([0, 2, 1, 0, 3, 2]), { surface: 'parkConcrete' })
    const sb = new SkateboardPhysics({ physics })
    sb.spawn([0, 0, 2], 0)
    const sc = { physics, sb }
    run(sc, 60)
    const v1 = sb.getTelemetry().speed
    run(sc, 60)
    const v2 = sb.getTelemetry().speed
    const a = v2 - v1
    const g = 9.81 * Math.sin(ang)
    expect(a).toBeGreaterThan(g * 0.85)
    expect(a).toBeLessThan(g * 1.02)
  })

  it('el ollie alcanza la altura del modo y aterriza limpio', async () => {
    const sc = await makeScene()
    const t = sc.sb.getTelemetry()
    run(sc, 120, () => neutral({ pushHeld: true }))
    const y0 = t.position.y
    let maxY = y0
    let wasAir = false
    sc.sb.pop({ strength: 1 })
    let landing = null
    for (let i = 0; i < 120; i++) {
      sc.sb.applyControls(1 / 60, neutral())
      sc.physics.step(1 / 60)
      sc.sb.postStep(1 / 60)
      maxY = Math.max(maxY, t.position.y)
      if (!t.grounded) wasAir = true
      if (sc.sb.pendingLanding) {
        landing = { ...sc.sb.pendingLanding }
        sc.sb.resolveLanding({ clean: true, quality: 1, bail: false })
      }
    }
    expect(wasAir).toBe(true)
    expect(maxY - y0).toBeGreaterThan(0.7)
    expect(maxY - y0).toBeLessThan(0.95)
    expect(landing).not.toBeNull()
    expect(landing.alignmentError).toBeLessThan(0.1)
    expect(Math.abs(landing.flipResidualRoll)).toBeLessThan(1e-6)
    expect(upY(t.quaternion)).toBeGreaterThan(0.98)
  })

  it('un kickflip completo deja la tabla atrapada con roll acumulado de −2π', async () => {
    const sc = await makeScene()
    const t = sc.sb.getTelemetry()
    run(sc, 60, () => neutral({ pushHeld: true }))
    sc.sb.pop({ strength: 1 })
    run(sc, 3)
    sc.sb.startFlip({ roll: -Math.PI * 2, yaw: 0, duration: 0.4 })
    let rollAtLanding = null
    let landing = null
    for (let i = 0; i < 120 && !landing; i++) {
      sc.sb.applyControls(1 / 60, neutral())
      sc.physics.step(1 / 60)
      sc.sb.postStep(1 / 60)
      if (sc.sb.pendingLanding) {
        rollAtLanding = t.accumulated.boardRoll
        landing = { ...sc.sb.pendingLanding }
      }
    }
    expect(landing).not.toBeNull()
    expect(rollAtLanding).toBeCloseTo(-Math.PI * 2, 3)
    expect(landing.flipActive).toBe(false)
    expect(Math.abs(landing.flipResidualRoll)).toBeLessThan(1e-6)
  })

  it('un flip pedido demasiado tarde no se completa (residuo grande al aterrizar en realista)', async () => {
    const sc = await makeScene()
    sc.sb.setMode('realistic')
    run(sc, 60, () => neutral({ pushHeld: true }))
    sc.sb.pop({ strength: 0 })
    run(sc, 18)
    sc.sb.startFlip({ roll: -Math.PI * 2, yaw: 0, duration: 0.45 })
    let landing = null
    for (let i = 0; i < 120 && !landing; i++) {
      sc.sb.applyControls(1 / 60, neutral())
      sc.physics.step(1 / 60)
      sc.sb.postStep(1 / 60)
      if (sc.sb.pendingLanding) landing = { ...sc.sb.pendingLanding }
    }
    expect(landing).not.toBeNull()
    expect(landing.flipActive).toBe(true)
    expect(Math.abs(landing.flipResidualRoll)).toBeGreaterThan(0.6)
  })
})

describe('SkateboardPhysics — transiciones', () => {
  it('sube un quarter pipe y vuelve hacia abajo sin volcar', async () => {
    const physics = await PhysicsWorld.create()
    const mesh = extrudeProfile(quarterPipeProfile(10, 2.0, 1.6), 8)
    physics.addStaticTrimesh(mesh.positions, mesh.indices, { surface: 'parkConcrete' })
    const sb = new SkateboardPhysics({ physics })
    sb.spawn([0, 0, 0], 0)
    const sc = { physics, sb }
    const t = sb.getTelemetry()
    sb.body.setLinvel({ x: 0, y: 0, z: 5 }, true)
    let maxH = 0
    let minUp = 1
    let cameBack = false
    run(sc, 60 * 6, neutral(), () => {
      maxH = Math.max(maxH, t.position.y)
      if (t.grounded) minUp = Math.min(minUp, new Vector3(0, 1, 0).applyQuaternion(t.quaternion).dot(t.groundNormal))
      if (t.velocity.z < -2 && t.position.z < 9) cameBack = true
    })
    expect(maxH).toBeGreaterThan(0.8)
    expect(cameBack).toBe(true)
    expect(minUp).toBeGreaterThan(0.85) // la tabla sigue la superficie
    expect(sb.tumbled).toBeFalsy()
  })
})

describe('Paso fijo', () => {
  it('el resultado no depende del patrón de fotogramas', async () => {
    const simulate = async (frameMs) => {
      const sc = await makeScene()
      let i = 0
      const loop = new GameLoop({
        fixedUpdate: (dt) => {
          sc.sb.applyControls(dt, neutral({ pushHeld: true, steer: i > 60 ? 0.5 : 0 }))
          sc.physics.step(dt)
          sc.sb.postStep(dt)
          i++
        },
        render: () => {},
      })
      loop.setSimulationPaused(false)
      let tm = 0
      while (i < 180) {
        loop.frame(tm)
        tm += frameMs[(i + Math.floor(tm)) % frameMs.length]
      }
      return sc.sb.getTelemetry().position.clone()
    }
    const a = await simulate([16.6667])
    const b = await simulate([33.3333, 8.3333, 50, 16.6667])
    expect(a.distanceTo(b)).toBeLessThan(0.05)
  })
})
