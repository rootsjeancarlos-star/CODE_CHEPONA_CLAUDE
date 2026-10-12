import { PhysicsWorld } from '../../src/physics/PhysicsWorld.js'
import { SkateboardPhysics } from '../../src/physics/SkateboardPhysics.js'

/** Mundo de prueba con suelo plano (trimesh) y un skater. */
export async function makeScene({ ground = true } = {}) {
  const physics = await PhysicsWorld.create()
  if (ground) {
    const S = 200
    physics.addStaticTrimesh(new Float32Array([-S, 0, -S, S, 0, -S, S, 0, S, -S, 0, S]), new Uint32Array([0, 2, 1, 0, 3, 2]), { surface: 'parkConcrete' })
  }
  const events = []
  const bus = { emit: (type, payload) => events.push({ type, payload }) }
  const sb = new SkateboardPhysics({ physics, bus })
  sb.spawn([0, 0, 0], 0)
  return { physics, sb, events, bus }
}

/** Extrusión de un perfil 2D (en el plano YZ) a lo ancho de X → trimesh. */
export function extrudeProfile(profile, width, xOffset = 0) {
  const pos = []
  const idx = []
  for (const [z, y] of profile) pos.push(xOffset - width / 2, y, z, xOffset + width / 2, y, z)
  for (let i = 0; i < profile.length - 1; i++) {
    const a = i * 2
    idx.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) }
}

/** Perfil de quarter pipe: plano hasta z0 y luego un cuarto de círculo de radio R hasta altura H. */
export function quarterPipeProfile(z0, R, H, segments = 48) {
  const p = [[-60, 0], [z0, 0]]
  const maxA = Math.acos(1 - H / R)
  for (let i = 1; i <= segments; i++) {
    const a = (i / segments) * maxA
    p.push([z0 + R * Math.sin(a), R * (1 - Math.cos(a))])
  }
  const last = p[p.length - 1]
  p.push([last[0] + 0.0001, last[1] + 0.01])
  return p
}

export const neutral = (o = {}) => ({ steer: 0, push: false, pushHeld: false, brake: 0, crouch: false, spin: 0, ...o })

/** Avanza n pasos fijos aplicando controles por paso. */
export function run(scene, steps, controls = () => neutral(), onStep) {
  const { physics, sb } = scene
  for (let i = 0; i < steps; i++) {
    sb.applyControls(1 / 60, typeof controls === 'function' ? controls(i) : controls)
    physics.step(1 / 60)
    sb.postStep(1 / 60)
    if (sb.pendingLanding) sb.resolveLanding({ clean: true, quality: 1, bail: false })
    onStep?.(i)
  }
}
