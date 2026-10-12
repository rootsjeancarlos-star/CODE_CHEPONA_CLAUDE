import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { makePlayerScene } from '../helpers/playerScene.js'
import { PLAYER_STATES as S } from '../../src/player/PlayerController.js'

const types = (bus) => bus.events.map((e) => e.type)

describe('PlayerController', () => {
  it('empuja, se agacha, hace ollie y aterriza pasando por los estados esperados', async () => {
    const sc = await makePlayerScene()
    const seen = new Set()
    sc.step(90, (i) => ({ throttle: 1, pushPressed: i === 0 }))
    seen.add(sc.player.state)
    sc.step(20, () => ({ crouch: true }))
    expect(sc.player.state).toBe(S.CROUCHING)
    sc.step(1, () => ({ popPressed: true }))
    sc.step(90, () => ({}))
    for (const e of sc.bus.events) if (e.type === 'skater:stateChanged') seen.add(e.payload.to)
    expect(seen.has(S.PUSHING)).toBe(true)
    expect(seen.has(S.POPPING)).toBe(true)
    expect(seen.has(S.AIRBORNE)).toBe(true)
    expect(seen.has(S.LANDING)).toBe(true)
    expect(types(sc.bus)).toContain('skater:land')
    expect(sc.player.state).toBe(S.SKATING)
  })

  it('captura un 50-50 en un rail, lo recorre y sale por el final', async () => {
    const sc = await makePlayerScene()
    sc.spots.registerEdge({ id: 'rail-1', type: 'rail', surface: 'metal', radius: 0.02, points: [new Vector3(-4, 0.35, 0), new Vector3(6, 0.35, 0)] })
    sc.player.respawnAt({ position: [-9, 0, 0], yaw: Math.PI / 2 }, 'spawn')
    sc.sb.body.setLinvel({ x: 5, y: 0, z: 0 }, true)
    sc.step(10)
    // pop antes del rail (≈1 m)
    let popped = false
    let grindStart = null
    for (let i = 0; i < 240; i++) {
      const x = sc.tel.position.x
      sc.step(1, () => ({ crouch: !popped && x < -6.6, popPressed: !popped && x >= -6.6 ? ((popped = true), true) : false, grind: true }))
      if (!grindStart && sc.player.state === S.GRINDING) grindStart = sc.tel.position.clone()
    }
    expect(grindStart).not.toBeNull()
    expect(Math.abs(grindStart.z)).toBeLessThan(0.1)
    const ev = sc.bus.events.find((e) => e.type === 'grind:start')
    expect(ev.payload.type).toBe('5050')
    const end = sc.bus.events.find((e) => e.type === 'grind:end')
    expect(end).toBeTruthy()
    expect(end.payload.distance).toBeGreaterThan(3)
  })

  it('mantiene un manual y lo termina al perder el equilibrio (arcade sin caída)', async () => {
    const sc = await makePlayerScene()
    sc.step(120, () => ({ throttle: 1 }))
    sc.step(1, () => ({ manualPressed: true, manual: 1 }))
    expect(sc.player.state).toBe(S.MANUAL)
    sc.step(30, () => ({}))
    const contacts = sc.tel.wheelContacts
    expect(contacts[0] || contacts[1]).toBe(false) // ruedas delanteras en el aire
    sc.step(600, () => ({}))
    expect(types(sc.bus)).toContain('manual:end')
    expect(sc.player.state).not.toBe(S.FALLING)
  })

  it('en realista, aterrizar con la tabla cruzada provoca caída y reaparición', async () => {
    const sc = await makePlayerScene({ mode: 'realistic' })
    sc.step(120, () => ({ throttle: 1 }))
    sc.step(20, () => ({ crouch: true }))
    sc.step(1, () => ({ popPressed: true }))
    sc.step(6)
    // fuerza un giro de 90° en el aire
    sc.sb.body.setAngvel({ x: 0, y: 6, z: 0 }, true)
    sc.step(120)
    expect(types(sc.bus)).toContain('skater:bail')
    sc.step(150)
    expect(types(sc.bus)).toContain('skater:respawn')
    expect([S.SKATING, S.IDLE]).toContain(sc.player.state)
  })

  it('F baja de la tabla, camina y vuelve a montar', async () => {
    const sc = await makePlayerScene()
    sc.step(30)
    sc.step(1, () => ({ interactPressed: true }))
    expect(sc.player.state).toBe(S.WALKING)
    sc.step(60, () => ({ throttle: 1 }))
    expect(sc.player.walking.position.length()).toBeGreaterThan(0.5)
    sc.step(1, () => ({ interactPressed: true }))
    sc.step(40)
    expect(sc.player.state).toBe(S.SKATING)
    expect(sc.tel.grounded).toBe(true)
  })

  it('R reaparece en el punto más cercano y G/T guardan y recuperan el marcador', async () => {
    const sc = await makePlayerScene()
    sc.step(60, () => ({ throttle: 1 }))
    sc.step(240)
    sc.step(1, () => ({ saveMarkerPressed: true }))
    expect(sc.save.data.markers.test).toBeTruthy()
    const marker = new Vector3(...sc.save.data.markers.test.position)
    sc.step(120, () => ({ throttle: 1 }))
    sc.step(1, () => ({ loadMarkerPressed: true }))
    expect(sc.tel.position.distanceTo(marker)).toBeLessThan(0.3)
    sc.step(1, () => ({ resetPressed: true }))
    expect(new Vector3(sc.tel.position.x, 0, sc.tel.position.z).length()).toBeLessThan(0.1)
  })
})
