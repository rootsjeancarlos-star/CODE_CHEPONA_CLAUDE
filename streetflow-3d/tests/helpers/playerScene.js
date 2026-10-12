import { Vector3 } from 'three/webgpu'
import { makeScene } from './physicsScene.js'
import { PlayerController } from '../../src/player/PlayerController.js'
import { GrindSystem } from '../../src/gameplay/GrindSystem.js'
import { BalanceSystem } from '../../src/gameplay/BalanceSystem.js'
import { LandingSystem } from '../../src/gameplay/LandingSystem.js'
import { RespawnSystem } from '../../src/gameplay/RespawnSystem.js'
import { createEmptyIntent } from '../../src/input/InputManager.js'

/** Registro de aristas mínimo conforme al contrato (búsqueda lineal). */
export class FakeSpots {
  constructor() {
    this.edges = []
  }
  registerEdge(e) {
    this.edges.push(e)
    return e.id
  }
  queryEdges(position, radius, out = []) {
    out.length = 0
    for (const edge of this.edges) {
      for (let s = 0; s < edge.points.length - 1; s++) {
        const a = edge.points[s]
        const b = edge.points[s + 1]
        const ab = new Vector3().subVectors(b, a)
        const len2 = ab.lengthSq()
        const t = Math.max(0, Math.min(1, new Vector3().subVectors(position, a).dot(ab) / len2))
        const point = a.clone().addScaledVector(ab, t)
        const distance = point.distanceTo(position)
        if (distance <= radius) out.push({ edge, segment: s, t, point, tangent: ab.clone().normalize(), distance })
      }
    }
    return out
  }
}

export async function makePlayerScene({ mode = 'arcade' } = {}) {
  const sc = await makeScene()
  const bus = { events: [], emit(type, payload) { this.events.push({ type, payload }) } }
  sc.sb.bus = bus
  const spots = new FakeSpots()
  const balance = new BalanceSystem()
  const board = { physics: sc.sb, visual: { getFootAnchors: () => null }, setAttached() {} }
  const world = {
    current: { id: 'test' },
    getSpawn: () => ({ position: [0, 0, 0], yaw: 0 }),
    getRespawnPoints: () => [{ position: [0, 0, 0], yaw: 0 }, { position: [30, 0, 30], yaw: 0 }],
    getBounds: () => ({ min: { x: -100, y: -1, z: -100 }, max: { x: 100, y: 10, z: 100 } }),
  }
  const save = { data: { markers: {} }, update(fn) { fn(this.data) } }
  const tricks = { calls: [], handleIntent() {}, onLanding: (r) => tricks.calls.push(['land', r]), onBail: (r) => tricks.calls.push(['bail', r]), reset() {} }
  const player = new PlayerController({
    bus,
    physics: sc.physics,
    board,
    tricks,
    grind: new GrindSystem({ bus, spots, board, balance }),
    balance,
    landing: new LandingSystem({ bus }),
    respawn: new RespawnSystem({ bus, world, save }),
    settings: { physicsMode: mode },
  })
  player.spawn({ position: [0, 0, 0], yaw: 0 })
  const intent = createEmptyIntent()
  const step = (n, set) => {
    for (let i = 0; i < n; i++) {
      const it = Object.assign(intent, createEmptyIntent(), set ? set(i) : {})
      player.fixedUpdate(1 / 60, it)
      sc.physics.step(1 / 60)
      player.postPhysics(1 / 60)
      player.respawn.fixedUpdate(1 / 60, player.getTelemetry(), it, player)
    }
  }
  return { ...sc, bus, spots, player, step, tel: player.getTelemetry(), save }
}
