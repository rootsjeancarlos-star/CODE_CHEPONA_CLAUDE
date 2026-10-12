import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three/webgpu'
import { makePlayerScene } from '../helpers/playerScene.js'
import { TrickDatabase, validateTrick } from '../../src/gameplay/TrickDatabase.js'
import { TrickRecognizer } from '../../src/gameplay/TrickRecognizer.js'
import { ComboSystem } from '../../src/gameplay/ComboSystem.js'
import { TRICKS } from '../../src/data/tricks.js'
import { EventBus } from '../../src/core/EventBus.js'

const ev = (sc, type) => sc.bus.events.filter((e) => e.type === type).map((e) => e.payload)
const TAU = Math.PI * 2

async function popAndFlick(sc, flick, modifier = false, wait = 120) {
  sc.step(90, (i) => ({ throttle: 1, pushPressed: i === 0 }))
  sc.step(20, () => ({ crouch: true }))
  sc.step(1, () => ({ popPressed: true, flick, modifier }))
  sc.step(wait)
}

describe('TrickDatabase', () => {
  it('todas las definiciones son válidas y los ids únicos', () => {
    for (const t of TRICKS) expect(validateTrick(t)).toEqual([])
    const db = new TrickDatabase()
    expect(db.list.length).toBe(TRICKS.length)
    expect(db.findByFlick('L').id).toBe('kickflip')
    expect(db.findByFlick('L', true).id).toBe('treflip')
    expect(db.findBySignature(-1, -2).id).toBe('treflip')
  })
})

describe('Reconocimiento basado en la rotación medida', () => {
  const tel = (o) => ({ stance: 'regular', airTime: 0.6, maxAirHeight: 0.7, accumulated: { boardRoll: 0, boardYaw: 0, bodyYaw: 0, ...o } })
  it('reconoce kickflip, 360 flip y FS 180 combinado', () => {
    const r = new TrickRecognizer({ bus: null, database: new TrickDatabase() })
    expect(r.recognize({ popped: true, requested: [] }, tel({ boardRoll: -TAU }), { clean: true, quality: 1 }).id).toBe('kickflip')
    expect(r.recognize({ popped: true, requested: [] }, tel({ boardRoll: -TAU, boardYaw: -TAU }), { clean: true, quality: 1 }).id).toBe('treflip')
    const c = r.recognize({ popped: true, requested: [] }, tel({ boardRoll: -TAU, bodyYaw: Math.PI }), { clean: true, quality: 1 })
    expect(c.displayName).toBe('FS 180 Kickflip')
  })
  it('en goofy el mismo sentido físico es un heelflip', () => {
    const r = new TrickRecognizer({ bus: null, database: new TrickDatabase() })
    const g = r.recognize({ popped: true, requested: [] }, { ...tel({ boardRoll: -TAU }), stance: 'goofy' }, { clean: true, quality: 1 })
    expect(g.id).toBe('heelflip')
  })
  it('una caída no puntúa y marca el truco pedido como fallido', () => {
    const bus = new EventBus()
    const failed = []
    bus.on('trick:failed', (p) => failed.push(p))
    const r = new TrickRecognizer({ bus, database: new TrickDatabase() })
    const res = r.recognize({ popped: true, requested: [{ id: 'kickflip', name: 'Kickflip' }] }, tel({ boardRoll: -TAU * 0.6 }), { bail: true, reason: 'tabla sin atrapar' })
    expect(res).toBeNull()
    expect(failed[0].id).toBe('kickflip')
  })
})

describe('Trucos en juego (física real)', () => {
  it('ESPACIO + ← ejecuta y reconoce un kickflip completado', async () => {
    const sc = await makePlayerScene({ realTricks: true })
    await popAndFlick(sc, 'L')
    const done = ev(sc, 'trick:completed')
    expect(ev(sc, 'trick:requested')[0].id).toBe('kickflip')
    expect(done.length).toBe(1)
    expect(done[0].id).toBe('kickflip')
    expect(ev(sc, 'trick:failed').length).toBe(0)
  })

  it('pop shove-it deja la tabla girada 180° y se reconoce', async () => {
    const sc = await makePlayerScene({ realTricks: true })
    await popAndFlick(sc, 'D')
    expect(ev(sc, 'trick:completed')[0].id).toBe('popShuvit')
    expect(Math.abs(sc.sb.baseYaw)).toBeCloseTo(Math.PI, 5)
  })

  it('sin flick, solo pulsar ESPACIO da un Ollie y el combo se cobra al rodar', async () => {
    const sc = await makePlayerScene({ realTricks: true })
    await popAndFlick(sc, null, false, 180)
    expect(ev(sc, 'trick:completed')[0].id).toBe('ollie')
    const end = ev(sc, 'combo:end')
    expect(end.length).toBe(1)
    expect(end[0].landed).toBe(true)
    expect(sc.combo.score).toBeGreaterThan(0)
  })

  it('kickflip + grind en el mismo combo multiplica la puntuación', async () => {
    const sc = await makePlayerScene({ realTricks: true })
    sc.spots.registerEdge({ id: 'ledge-1', type: 'ledge', surface: 'concrete', radius: 0.0, points: [new Vector3(-4, 0.4, 0), new Vector3(8, 0.4, 0)] })
    sc.player.respawnAt({ position: [-9, 0, 0], yaw: Math.PI / 2 }, 'spawn')
    sc.sb.body.setLinvel({ x: 5.5, y: 0, z: 0 }, true)
    sc.step(5)
    let popped = false
    for (let i = 0; i < 300; i++) {
      const x = sc.tel.position.x
      sc.step(1, () => ({ crouch: !popped && x < -7.2, popPressed: !popped && x >= -7.2 ? ((popped = true), true) : false, flick: popped && x < -6.8 ? 'L' : null, grind: x > -5 }))
    }
    const names = ev(sc, 'trick:completed').map((t) => t.id)
    expect(names).toContain('5050')
    const comboEnd = ev(sc, 'combo:end').pop()
    expect(comboEnd.tricks.length).toBeGreaterThanOrEqual(2)
    expect(comboEnd.multiplier).toBeGreaterThanOrEqual(2)
  })
})

describe('ComboSystem', () => {
  it('penaliza la repetición y pierde el combo con una caída', () => {
    const bus = new EventBus()
    const ends = []
    bus.on('combo:end', (e) => ends.push(e))
    const c = new ComboSystem({ bus })
    for (let i = 0; i < 4; i++) bus.emit('trick:completed', { id: 'kickflip', name: 'Kickflip', score: 300 })
    expect(c.state.baseScore).toBe(300 + 225 + 150 + 75)
    expect(c.state.multiplier).toBe(1)
    bus.emit('skater:bail', {})
    expect(ends[0].landed).toBe(false)
    expect(c.score).toBe(0)
  })
})
