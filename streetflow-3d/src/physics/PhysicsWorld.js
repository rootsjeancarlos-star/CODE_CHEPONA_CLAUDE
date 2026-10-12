import RAPIER from '@dimforge/rapier3d-compat'
import { Vector3 } from 'three/webgpu'
import { PHYSICS } from '../core/Config.js'
import { getSurface, DEFAULT_SURFACE } from '../data/surfaces.js'

let rapierReady = null
/** Inicializa el módulo WebAssembly de Rapier una sola vez (navegador y Node). */
export function initRapier() {
  if (!rapierReady) rapierReady = RAPIER.init()
  return rapierReady
}

const _ray = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: -1, z: 0 } }

/**
 * Envoltorio del mundo Rapier: creación de colliders estáticos con datos de superficie,
 * consultas de rayos y eventos de colisión. Ver docs/ARCHITECTURE.md §7.1.
 */
export class PhysicsWorld {
  /**
   * @param {{ gravity?: {x:number,y:number,z:number}, bus?: import('../core/EventBus.js').EventBus }} [o]
   */
  static async create(o = {}) {
    await initRapier()
    return new PhysicsWorld(o)
  }

  constructor({ gravity = PHYSICS.gravity, bus = null } = {}) {
    this.RAPIER = RAPIER
    this.bus = bus
    this.world = new RAPIER.World(new RAPIER.Vector3(gravity.x, gravity.y, gravity.z))
    this.world.timestep = PHYSICS.fixedDt
    this.eventQueue = new RAPIER.EventQueue(true)
    this.ray = new RAPIER.Ray(_ray.origin, _ray.dir)
    /** @type {Map<number, Object>} handle de collider → datos (superficie, tipo, spotId…) */
    this.colliderData = new Map()
    this._collisionHandlers = new Set()
    this._fixedBody = this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed())
    this.stepCount = 0
    /** Subpasos de Rapier por paso lógico (1/60 → 2 × 1/120): mejora la estabilidad de la suspensión. */
    this.substeps = PHYSICS.substeps ?? 2
    /** @type {Set<(subDt:number, index:number)=>void>} se ejecutan antes de cada subpaso */
    this._preSubstep = new Set()
  }

  /** Registra una función que se ejecuta antes de cada subpaso (p.ej. fuerzas de las ruedas). */
  addPreSubstep(fn) {
    this._preSubstep.add(fn)
    return () => this._preSubstep.delete(fn)
  }

  /** Avanza un paso fijo (dividido en `substeps` subpasos de Rapier). */
  step(dt = PHYSICS.fixedDt) {
    const n = Math.max(1, this.substeps | 0)
    const sub = dt / n
    this.world.timestep = sub
    for (let i = 0; i < n; i++) {
      for (const fn of this._preSubstep) fn(sub, i)
      this.world.step(this.eventQueue)
      this._drainEvents()
    }
    this.stepCount++
  }

  /**
   * Actualiza las estructuras de consulta (BVH) sin avanzar la simulación: tras crear o mover colliders,
   * los rayos no los ven hasta el siguiente paso (verificado en tools/proto/wheel-raycast-proto.mjs).
   */
  refreshQueries() {
    const dt = this.world.timestep
    this.world.timestep = 0
    this.world.step(this.eventQueue)
    this.world.timestep = dt
    this.eventQueue.drainCollisionEvents(() => {})
    this.eventQueue.drainContactForceEvents(() => {})
  }

  _drainEvents() {
    if (this._collisionHandlers.size > 0) {
      this.eventQueue.drainCollisionEvents((h1, h2, started) => {
        const c1 = this.world.getCollider(h1)
        const c2 = this.world.getCollider(h2)
        for (const fn of this._collisionHandlers) fn({ collider1: c1, collider2: c2, started })
      })
      this.eventQueue.drainContactForceEvents((ev) => {
        const c1 = this.world.getCollider(ev.collider1())
        const c2 = this.world.getCollider(ev.collider2())
        const magnitude = ev.totalForceMagnitude()
        const dir = ev.maxForceDirection()
        for (const fn of this._collisionHandlers) fn({ collider1: c1, collider2: c2, started: true, force: magnitude, direction: dir })
      })
    } else {
      this.eventQueue.clear()
    }
  }

  /** @param {(e:{collider1:any, collider2:any, started:boolean, force?:number, direction?:any})=>void} fn */
  onCollision(fn) {
    this._collisionHandlers.add(fn)
    return () => this._collisionHandlers.delete(fn)
  }

  // ------------------------------------------------------------------------------------------
  // Colliders estáticos
  // ------------------------------------------------------------------------------------------
  _finish(desc, opts = {}) {
    const surfaceId = opts.surface || DEFAULT_SURFACE
    const surface = getSurface(surfaceId)
    desc.setFriction(opts.friction ?? surface.friction)
    desc.setRestitution(opts.restitution ?? 0)
    desc.setCollisionGroups(opts.groups ?? PHYSICS.GROUP_SETS.static)
    if (opts.position) desc.setTranslation(opts.position.x ?? opts.position[0], opts.position.y ?? opts.position[1], opts.position.z ?? opts.position[2])
    if (opts.quaternion) {
      const q = opts.quaternion
      desc.setRotation({ x: q.x ?? q[0], y: q.y ?? q[1], z: q.z ?? q[2], w: q.w ?? q[3] })
    }
    if (opts.sensor) desc.setSensor(true)
    if (opts.activeEvents) desc.setActiveEvents(opts.activeEvents)
    const collider = this.world.createCollider(desc, opts.body || this._fixedBody)
    this.colliderData.set(collider.handle, { surface: surfaceId, kind: opts.kind || 'static', ...(opts.userData || {}) })
    return collider
  }

  /**
   * @param {Float32Array} positions xyz
   * @param {Uint32Array} indices
   * @param {{surface?:string, friction?:number, restitution?:number, groups?:number, userData?:Object, position?:any, quaternion?:any, flags?:number}} [opts]
   */
  addStaticTrimesh(positions, indices, opts = {}) {
    const flags = opts.flags ?? RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES | RAPIER.TriMeshFlags.MERGE_DUPLICATE_VERTICES
    const desc = RAPIER.ColliderDesc.trimesh(
      positions instanceof Float32Array ? positions : new Float32Array(positions),
      indices instanceof Uint32Array ? indices : new Uint32Array(indices),
      flags,
    )
    return this._finish(desc, opts)
  }

  /** @param {{x:number,y:number,z:number}|number[]} halfExtents */
  addStaticBox(halfExtents, position, quaternion, opts = {}) {
    const h = Array.isArray(halfExtents) ? { x: halfExtents[0], y: halfExtents[1], z: halfExtents[2] } : halfExtents
    return this._finish(RAPIER.ColliderDesc.cuboid(h.x, h.y, h.z), { ...opts, position, quaternion })
  }

  /** Cilindro alineado con su eje local Y. */
  addStaticCylinder(halfHeight, radius, position, quaternion, opts = {}) {
    return this._finish(RAPIER.ColliderDesc.cylinder(halfHeight, radius), { ...opts, position, quaternion })
  }

  /** Cápsula alineada con su eje local Y. */
  addStaticCapsule(halfHeight, radius, position, quaternion, opts = {}) {
    return this._finish(RAPIER.ColliderDesc.capsule(halfHeight, radius), { ...opts, position, quaternion })
  }

  /** @param {Float32Array|number[]} points */
  addStaticConvexHull(points, opts = {}) {
    const desc = RAPIER.ColliderDesc.convexHull(points instanceof Float32Array ? points : new Float32Array(points))
    if (!desc) return null
    return this._finish(desc, opts)
  }

  removeCollider(collider) {
    if (!collider) return
    this.colliderData.delete(collider.handle)
    try {
      this.world.removeCollider(collider, true)
    } catch (err) {
      console.warn('[PhysicsWorld] removeCollider falló', err)
    }
  }

  /** Registra datos para un collider creado fuera de este envoltorio (p.ej. el del skater). */
  setColliderData(collider, data) {
    this.colliderData.set(collider.handle, data)
  }

  getColliderData(collider) {
    if (!collider) return null
    return this.colliderData.get(collider.handle) || null
  }

  // ------------------------------------------------------------------------------------------
  // Consultas
  // ------------------------------------------------------------------------------------------
  /**
   * Lanza un rayo. `direction` debe estar normalizada.
   * @returns {{ point: Vector3, normal: Vector3, distance: number, collider: any, surface: string } | null}
   */
  castRay(origin, direction, maxDistance, opts = {}, out = null) {
    const r = this.ray
    r.origin.x = origin.x
    r.origin.y = origin.y
    r.origin.z = origin.z
    r.dir.x = direction.x
    r.dir.y = direction.y
    r.dir.z = direction.z
    const hit = this.world.castRayAndGetNormal(
      r,
      maxDistance,
      opts.solid ?? true,
      opts.flags,
      opts.groups,
      opts.excludeCollider,
      opts.excludeBody,
      opts.predicate,
    )
    if (!hit) return null
    const res = out || { point: new Vector3(), normal: new Vector3(), distance: 0, collider: null, surface: DEFAULT_SURFACE }
    const t = hit.timeOfImpact
    res.distance = t
    res.point.set(origin.x + direction.x * t, origin.y + direction.y * t, origin.z + direction.z * t)
    res.normal.set(hit.normal.x, hit.normal.y, hit.normal.z)
    res.collider = hit.collider
    res.surface = this.colliderData.get(hit.collider.handle)?.surface || DEFAULT_SURFACE
    return res
  }

  dispose() {
    this._collisionHandlers.clear()
    this.colliderData.clear()
    this.eventQueue.free?.()
    this.world.free()
  }
}
