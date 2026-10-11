#!/usr/bin/env node
/**
 * STREETFLOW 3D — Prototipo de viabilidad: tabla de skate con suspensión por rayos sobre Rapier 0.21.
 *
 * NO es código de producción. Sirve para validar que el modelo "un cuerpo rígido dinámico (rider + tabla)
 * sostenido por 4 rayos de rueda" de docs/ARCHITECTURE.md §7.3 es estable con @dimforge/rapier3d-compat 0.21.0
 * y para obtener parámetros de partida. Resultados y explicación: docs/tech/RAPIER_NOTES.md §9.
 *
 * Convenciones (docs/ARCHITECTURE.md §2): +Y arriba; ejes locales del cuerpo: +Z = nariz, +X = izquierda,
 * origen = centro del deck a la altura de la cara superior de la lija.
 *
 * Uso:
 *   node tools/proto/wheel-raycast-proto.mjs                    # escenarios a–e con la configuración por defecto
 *   node tools/proto/wheel-raycast-proto.mjs --scenario=c,d     # solo algunos escenarios
 *   node tools/proto/wheel-raycast-proto.mjs --comY=0.9 --substeps=1 --align=0
 *   node tools/proto/wheel-raycast-proto.mjs --matrix           # barrido comY × subpasos (tabla resumen)
 *   node tools/proto/wheel-raycast-proto.mjs --json             # salida JSON (para comparar ejecuciones)
 *   node tools/proto/wheel-raycast-proto.mjs --help
 * Cualquier clave numérica de DEFAULTS se puede sobrescribir con --clave=valor.
 */
import RAPIER from '@dimforge/rapier3d-compat'
import { pathToFileURL } from 'node:url'

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Parámetros (todos en SI). Los valores por defecto son los que funcionaron en las pruebas.
// ───────────────────────────────────────────────────────────────────────────────────────────────
export const DEFAULTS = {
  hz: 60, //               pasos lógicos por segundo (Game.fixedUpdate)
  substeps: 2, //          subpasos de física por paso lógico → dt de Rapier = 1/(hz·substeps)
  mass: 75, //             kg, rider + tabla en un solo cuerpo
  comY: 0.35, //           m, centro de masa local sobre el origen (Config.SKATER.centerOfMass.y)
  inertiaX: 9, //          kg·m², inercia principal en el COM alrededor de X local (pitch)
  inertiaY: 2, //          kg·m², alrededor de Y (yaw)
  inertiaZ: 9, //          kg·m², alrededor de Z (roll)
  deckLength: 0.8, //      m (Z)
  deckThickness: 0.03, //  m (Y)
  deckWidth: 0.21, //      m (X)
  wheelBase: 0.36, //      m, distancia entre ejes (Z)
  track: 0.17, //          m, ancho de eje (X), centro a centro de rueda
  wheelRadius: 0.027, //   m
  truckHeight: 0.045, //   m, de la cara inferior del deck al eje de la rueda
  rayOriginY: 0.05, //     m, origen del rayo POR ENCIMA del origen del cuerpo (tolera penetraciones del deck)
  probeLength: 1.5, //     m, longitud total del rayo (detecta el suelo antes de aterrizar)
  suspFreq: 8, //          Hz, frecuencia natural del sistema (masa total sobre 4 muelles)
  suspZeta: 1.0, //        razón de amortiguamiento (1 = crítico)
  suspMaxForce: 25000, //  N por rueda (tope)
  contactTol: 0.004, //    m, holgura para considerar la rueda "en contacto" más allá de la longitud de reposo
  muLat: 0.9, //           coeficiente de agarre lateral (tope de la fuerza lateral = muLat·N)
  grip: 0.8, //            fracción [0..1] de la velocidad lateral que se anula por paso
  crr: 0.02, //            coeficiente de resistencia a la rodadura (F = crr·N)
  vStop: 0.15, //          m/s, por debajo se usa el modo "estático" de la rodadura (sin vibración)
  align: 1, //             1 = par de equilibrio/alineación activo; 0 = solo muelles
  alignFreq: 4, //         Hz, frecuencia del par de alineación con la normal media (en suelo)
  alignZeta: 1.0,
  airAlignFreq: 1.5, //    Hz, alineación suave en el aire (hacia la normal del suelo detectado o +Y)
  airAlignZeta: 1.0,
  tangentAtCom: 0, //      1 = aplica fricción lateral/rodadura a la altura del COM (truco anti-vuelco)
  riderCapsule: 1, //      1 = añade la cápsula del rider (densidad 0) como en ARCHITECTURE §7.3
  deckFriction: 0.3,
  ollieHeight: 0.5, //     m, subida objetivo del COM en el escenario d
  carveRadius: 4, //       m, radio de giro objetivo en el escenario e
}

// Grupos de colisión (mismos bits que src/core/Config.js)
const G = { STATIC: 1 << 0, SKATER: 1 << 1, DYNAMIC_PROP: 1 << 3 }
const groups = (membership, filter) => ((((membership & 0xffff) << 16) | (filter & 0xffff)) >>> 0)
const GROUPS_STATIC = groups(G.STATIC, 0xffff)
const GROUPS_SKATER = groups(G.SKATER, G.STATIC | G.DYNAMIC_PROP)
const GROUPS_WHEEL_RAY = groups(0xffff, G.STATIC | G.DYNAMIC_PROP)

const DEG = Math.PI / 180
const GRAVITY = 9.81

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Álgebra mínima (objetos {x,y,z}; sin dependencias para que el script sea autónomo)
// ───────────────────────────────────────────────────────────────────────────────────────────────
const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z })
const add = (a, b) => v3(a.x + b.x, a.y + b.y, a.z + b.z)
const sub = (a, b) => v3(a.x - b.x, a.y - b.y, a.z - b.z)
const scl = (a, s) => v3(a.x * s, a.y * s, a.z * s)
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z
const cross = (a, b) => v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x)
const len = (a) => Math.sqrt(dot(a, a))
const norm = (a) => {
  const l = len(a)
  return l > 1e-12 ? scl(a, 1 / l) : v3()
}
const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x)
/** Rota v por el cuaternión unitario q. */
function qrot(q, v) {
  const tx = 2 * (q.y * v.z - q.z * v.y)
  const ty = 2 * (q.z * v.x - q.x * v.z)
  const tz = 2 * (q.x * v.y - q.y * v.x)
  return v3(v.x + q.w * tx + (q.y * tz - q.z * ty), v.y + q.w * ty + (q.z * tx - q.x * tz), v.z + q.w * tz + (q.x * ty - q.y * tx))
}
const qAxisAngle = (axis, a) => {
  const s = Math.sin(a / 2)
  const n = norm(axis)
  return { x: n.x * s, y: n.y * s, z: n.z * s, w: Math.cos(a / 2) }
}
/** Producto de la matriz simétrica 3×3 de Rapier (SdpMatrix3, getters m11..m33) por un vector. */
const sdpMul = (M, v) =>
  v3(M.m11 * v.x + M.m12 * v.y + M.m13 * v.z, M.m21 * v.x + M.m22 * v.y + M.m23 * v.z, M.m31 * v.x + M.m32 * v.y + M.m33 * v.z)
const angleBetween = (a, b) => Math.atan2(len(cross(a, b)), dot(a, b))

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Geometría de prueba (trimesh)
// ───────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Extruye un perfil 2D (pares [z, y], z creciente) a lo ancho de X ∈ [-w/2, w/2] y devuelve una trimesh.
 * El orden de vértices hace que la normal apunte "hacia arriba / hacia dentro" del perfil.
 */
function extrudeProfile(profile, width) {
  const verts = []
  const idx = []
  for (const [z, y] of profile) verts.push(width / 2, y, z, -width / 2, y, z)
  for (let i = 0; i < profile.length - 1; i++) {
    const a = 2 * i // (+X, p_i)
    const b = a + 1 // (-X, p_i)
    const c = a + 2 // (+X, p_i+1)
    const d = a + 3 // (-X, p_i+1)
    idx.push(a, b, c, b, d, c) // normal ∝ (0, dz, −dy): suelo plano → +Y; rampa que sube hacia +Z → mira a −Z
  }
  return { vertices: new Float32Array(verts), indices: new Uint32Array(idx) }
}

function addStaticTrimesh(world, mesh) {
  const desc = RAPIER.ColliderDesc.trimesh(mesh.vertices, mesh.indices, RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES)
    .setFriction(0.8)
    .setCollisionGroups(GROUPS_STATIC)
  return world.createCollider(desc) // collider sin rigid-body = fijo
}

/** Suelo plano de 400 m de largo (Z) troceado cada 2 m. */
const flatProfile = () => {
  const p = []
  for (let z = -200; z <= 200; z += 2) p.push([z, 0])
  return p
}

/** Pendiente descendente hacia +Z de `deg` grados, con 5 m de llano antes y 20 m después. */
function slopeProfile(deg, length = 80) {
  const t = Math.tan(deg * DEG)
  const p = [[-5, 0]]
  for (let s = 0; s <= length; s += 2) p.push([s, -s * t])
  const zEnd = length
  const yEnd = -length * t
  p.push([zEnd + 20, yEnd])
  return p
}

/** Llano (z<0) + quarter pipe de radio R y altura H que empieza en z=0, + plataforma superior de 3 m. */
function quarterPipeProfile(R, H, segments = 48) {
  const p = []
  for (let z = -40; z < 0; z += 2) p.push([z, 0])
  const thetaMax = Math.acos((R - H) / R)
  for (let i = 0; i <= segments; i++) {
    const th = (thetaMax * i) / segments
    p.push([R * Math.sin(th), R - R * Math.cos(th)])
  }
  const zLip = R * Math.sin(thetaMax)
  p.push([zLip + 3, H])
  return { profile: p, thetaMax, zLip }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Tabla: cuerpo + collider de deck + 4 rayos de rueda
// ───────────────────────────────────────────────────────────────────────────────────────────────
class Board {
  /**
   * @param {RAPIER.World} world
   * @param {typeof DEFAULTS} cfg
   * @param {{position:{x,y,z}, rotation:{x,y,z,w}, velocity?:{x,y,z}}} pose  pose del ORIGEN del cuerpo
   */
  constructor(world, cfg, pose) {
    this.world = world
    this.cfg = cfg
    const m = cfg.mass
    // Geometría derivada
    this.deckBottomY = -cfg.deckThickness
    this.axleY = this.deckBottomY - cfg.truckHeight
    const omega = 2 * Math.PI * cfg.suspFreq
    this.k = (m * omega * omega) / 4 // N/m por rueda
    this.c = (2 * cfg.suspZeta * m * omega) / 4 // N·s/m por rueda
    this.sag = (m * GRAVITY) / (4 * this.k) // hundimiento estático
    // Longitud de reposo del muelle medida desde el origen del rayo: geometría + hundimiento estático
    // (así, con carga estática, la rueda toca justo el suelo).
    this.restLen = cfg.rayOriginY - this.axleY + cfg.wheelRadius + this.sag
    this.rideHeight = this.restLen - this.sag - cfg.rayOriginY // altura del origen sobre el suelo en reposo
    this.travel = this.restLen - (cfg.rayOriginY - this.deckBottomY) // recorrido antes de que el deck toque
    // [FL, FR, RL, RR]: F = nariz (+Z), L = +X
    const hx = cfg.track / 2
    const hz = cfg.wheelBase / 2
    this.wheels = [
      { name: 'FL', x: +hx, z: +hz, front: true },
      { name: 'FR', x: -hx, z: +hz, front: true },
      { name: 'RL', x: +hx, z: -hz, front: false },
      { name: 'RR', x: -hx, z: -hz, front: false },
    ].map((w) => ({ ...w, contact: false, near: false, dist: Infinity, normal: v3(0, 1, 0), point: v3(), N: 0, collider: null }))

    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(pose.position.x, pose.position.y, pose.position.z)
      .setRotation(pose.rotation)
      .setCanSleep(false) // el jugador no debe dormirse (añadimos fuerzas cada paso)
      .setAdditionalMassProperties(
        m,
        { x: 0, y: cfg.comY, z: 0 },
        { x: cfg.inertiaX, y: cfg.inertiaY, z: cfg.inertiaZ },
        { x: 0, y: 0, z: 0, w: 1 },
      )
    if (pose.velocity) desc.setLinvel(pose.velocity.x, pose.velocity.y, pose.velocity.z)
    this.body = world.createRigidBody(desc)
    // Deck: masa 0 (toda la masa viene de setAdditionalMassProperties). Solo para choques/raspado.
    this.deck = world.createCollider(
      RAPIER.ColliderDesc.cuboid(cfg.deckWidth / 2, cfg.deckThickness / 2, cfg.deckLength / 2)
        .setTranslation(0, -cfg.deckThickness / 2, 0)
        .setDensity(0)
        .setFriction(cfg.deckFriction)
        .setCollisionGroups(GROUPS_SKATER),
      this.body,
    )
    if (cfg.riderCapsule) {
      // Cápsula del rider (densidad 0), de 0.25 m a 1.75 m sobre el deck.
      this.rider = world.createCollider(
        RAPIER.ColliderDesc.capsule(0.55, 0.2).setTranslation(0, 1.0, 0).setDensity(0).setFriction(0.5).setCollisionGroups(GROUPS_SKATER),
        this.body,
      )
    }
    this.body.recomputeMassPropertiesFromColliders() // para que mass()/inercia sean válidas antes del primer step
    this.ray = new RAPIER.Ray(v3(), v3(0, -1, 0)) // reutilizado (se muta origin/dir)
    this.steer = 0 // rad; eje delantero +steer, trasero −steer (ARCHITECTURE §7.3)
    this.lastTotalN = 0
  }

  get up() {
    return qrot(this.body.rotation(), v3(0, 1, 0))
  }
  get forward() {
    return qrot(this.body.rotation(), v3(0, 0, 1))
  }

  /**
   * Lanza los 4 rayos y aplica fuerzas antes de world.step(). Las fuerzas de Rapier PERSISTEN entre
   * pasos (addForce acumula hasta resetForces), por eso se reinician al principio.
   */
  applyForces(dt) {
    const cfg = this.cfg
    const body = this.body
    const world = this.world
    body.resetForces(true)
    body.resetTorques(true)

    const q = body.rotation()
    const pos = body.translation()
    const up = qrot(q, v3(0, 1, 0))
    const fwd = qrot(q, v3(0, 0, 1))
    const rayDir = scl(up, -1)
    const com = body.worldCom()
    const invMass = body.invMass()
    const invI = body.effectiveWorldInvInertia()

    // 1) Rayos
    let nContact = 0
    let nNear = 0
    let nSum = v3()
    for (const w of this.wheels) {
      const origin = add(pos, qrot(q, v3(w.x, cfg.rayOriginY, w.z)))
      this.ray.origin = origin
      this.ray.dir = rayDir
      // Firma 0.21: castRayAndGetNormal(ray, maxToi, solid, filterFlags, filterGroups, excludeCollider, excludeRigidBody, predicate)
      const hit = world.castRayAndGetNormal(
        this.ray,
        cfg.probeLength,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_SENSORS,
        GROUPS_WHEEL_RAY,
        undefined,
        body, // excluye el propio cuerpo (deck + cápsula)
      )
      w.near = !!hit
      w.contact = false
      w.N = 0
      if (!hit) {
        w.dist = Infinity
        continue
      }
      w.dist = hit.timeOfImpact // dir es unitaria → toi = distancia
      w.normal = hit.normal
      w.point = add(origin, scl(rayDir, w.dist))
      w.collider = hit.collider
      // Normal orientada hacia el lado del rayo (las trimesh son de doble cara para los rayos)
      if (dot(w.normal, up) < 0) w.normal = scl(w.normal, -1)
      nNear++
      nSum = add(nSum, w.normal)
      if (w.dist <= this.restLen + cfg.contactTol) {
        w.contact = true
        nContact++
      }
    }

    // 2) Fuerzas por rueda
    let totalN = 0
    for (const w of this.wheels) {
      if (!w.contact) continue
      const n = w.normal
      const p = w.point
      const r = sub(p, com)
      const vP = body.velocityAtPoint(p)
      // Masa efectiva en p a lo largo de d, repartida entre las ruedas en contacto (Jacobi)
      const mEff = (d) => {
        const rxd = cross(r, d)
        return 1 / (invMass + dot(rxd, sdpMul(invI, rxd))) / nContact
      }
      // Muelle–amortiguador a lo largo de la normal
      const compression = Math.max(0, this.restLen - w.dist)
      const vn = dot(vP, n) // < 0: acercándose al suelo
      let fDamp = -this.c * vn
      // Tope del amortiguador: no invertir la velocidad normal en un solo paso (evita el "rebote" al aterrizar)
      const fDampMax = (mEff(n) * Math.abs(vn)) / dt
      fDamp = clamp(fDamp, -fDampMax, fDampMax)
      const N = clamp(this.k * compression + fDamp, 0, cfg.suspMaxForce)
      w.N = N
      totalN += N
      body.addForceAtPoint(scl(n, N), p, true)

      // Ejes tangentes de la rueda (con dirección de truck: delantero +steer, trasero −steer)
      const steer = w.front ? this.steer : -this.steer
      const wheelFwd0 = steer ? qrot(qAxisAngle(up, steer), fwd) : fwd
      const tFwd = norm(sub(wheelFwd0, scl(n, dot(wheelFwd0, n))))
      const tLat = norm(cross(n, tFwd))
      const vLat = dot(vP, tLat)
      const vFwd = dot(vP, tFwd)
      // Fricción lateral: anula una fracción de la velocidad lateral, limitada por muLat·N (derrape)
      const mLat = mEff(tLat)
      const fLat = clamp((-vLat * mLat * cfg.grip) / dt, -cfg.muLat * N, cfg.muLat * N)
      // Resistencia a la rodadura: Coulomb a velocidad normal; a baja velocidad, fuerza que lleva a 0 sin cambiar de signo
      const fRollMax = cfg.crr * N
      let fRoll
      if (Math.abs(vFwd) > cfg.vStop) fRoll = -Math.sign(vFwd) * fRollMax
      else fRoll = clamp((-vFwd * mEff(tFwd)) / dt, -fRollMax, fRollMax)
      const fT = add(scl(tLat, fLat), scl(tFwd, fRoll))
      // Punto de aplicación de las fuerzas tangentes: contacto (realista) o elevado a la altura del COM
      const pT = cfg.tangentAtCom ? add(p, scl(n, dot(sub(com, p), n))) : p
      body.addForceAtPoint(fT, pT, true)
    }
    this.lastTotalN = totalN

    // 3) Par de equilibrio / alineación con la normal media (representa el equilibrio del rider)
    const grounded = nContact >= 2
    let target = null
    if (nNear > 0) target = norm(nSum)
    else if (!grounded) target = v3(0, 1, 0)
    if (cfg.align && target) {
      const Ialign = 0.5 * (cfg.inertiaX + cfg.inertiaZ)
      const f = grounded ? cfg.alignFreq : cfg.airAlignFreq
      const z = grounded ? cfg.alignZeta : cfg.airAlignZeta
      const wn = 2 * Math.PI * f
      // En suelo se compensa el par de vuelco de la gravedad (m·g·h) para que la rigidez neta sea I·wn²
      const hCom = cfg.comY + this.rideHeight
      const kA = Ialign * wn * wn + (grounded ? cfg.mass * GRAVITY * Math.max(0, hCom) : 0)
      const cA = 2 * z * Ialign * wn
      const axis = cross(up, target)
      const s = len(axis)
      const ang = Math.atan2(s, dot(up, target))
      let tau = s > 1e-9 ? scl(axis, (kA * ang) / s) : v3()
      // Amortigua el giro excepto el yaw alrededor de la normal (dirección libre)
      const w = body.angvel()
      const wPerp = sub(w, scl(target, dot(w, target)))
      tau = sub(tau, scl(wPerp, cA))
      body.addTorque(tau, true)
    }
    return { nContact, nNear, grounded, totalN }
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Infraestructura de escenarios
// ───────────────────────────────────────────────────────────────────────────────────────────────
function makeWorld(cfg) {
  const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 })
  world.timestep = 1 / (cfg.hz * cfg.substeps)
  return world
}

/** Las consultas usan el BVH del último world.step(): tras crear la geometría se hace un paso con dt = 0. */
function refreshQueries(world) {
  const dt = world.timestep
  world.timestep = 0
  world.step()
  world.timestep = dt
}

/** Pose en reposo sobre un punto de superficie con normal n y dirección de avance dir (tangente). */
function poseOnSurface(board0, surfacePoint, n, dir, speed = 0) {
  const nz = norm(dir)
  const nx = norm(cross(n, nz))
  const ny = norm(cross(nz, nx))
  // Matriz de rotación [nx ny nz] → cuaternión
  const m00 = nx.x, m01 = ny.x, m02 = nz.x
  const m10 = nx.y, m11 = ny.y, m12 = nz.y
  const m20 = nx.z, m21 = ny.z, m22 = nz.z
  const tr = m00 + m11 + m22
  let q
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2
    q = { w: 0.25 * s, x: (m21 - m12) / s, y: (m02 - m20) / s, z: (m10 - m01) / s }
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2
    q = { w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s }
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2
    q = { w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s }
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2
    q = { w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s }
  }
  return { position: add(surfacePoint, scl(ny, board0.rideHeight)), rotation: q, velocity: scl(nz, speed) }
}

/** Valores geométricos de la tabla sin crear un mundo (para colocar el cuerpo). */
function boardGeometry(cfg) {
  const omega = 2 * Math.PI * cfg.suspFreq
  const k = (cfg.mass * omega * omega) / 4
  const sag = (cfg.mass * GRAVITY) / (4 * k)
  const axleY = -cfg.deckThickness - cfg.truckHeight
  const restLen = cfg.rayOriginY - axleY + cfg.wheelRadius + sag
  return { rideHeight: restLen - sag - cfg.rayOriginY }
}

/** Bucle de simulación: callback(t, frame) antes de cada paso lógico; sample() tras cada subpaso. */
function simulate(world, board, cfg, seconds, { onFrame, onSub } = {}) {
  const frames = Math.round(seconds * cfg.hz)
  const dt = world.timestep
  let tPhys = 0
  let cpu = 0
  for (let f = 0; f < frames; f++) {
    const t = f / cfg.hz
    if (onFrame) onFrame(t, f)
    for (let s = 0; s < cfg.substeps; s++) {
      const t0 = performance.now()
      const info = board.applyForces(dt)
      world.step()
      cpu += performance.now() - t0
      tPhys += dt
      if (onSub) onSub(tPhys, info)
    }
  }
  return { cpuPerFrameMs: cpu / frames }
}

const deckTouching = (world, board, groundCol) => {
  let touching = false
  world.contactPair(board.deck, groundCol, (m) => {
    for (let i = 0; i < m.numContacts(); i++) if (m.contactDist(i) < 0.002) touching = true
  })
  return touching
}

const tiltFrom = (board, n) => angleBetween(board.up, n) / DEG
const r2 = (x) => Math.round(x * 100) / 100
const r3 = (x) => Math.round(x * 1000) / 1000
const r4 = (x) => Math.round(x * 10000) / 10000

// (a) Rodar en llano trimesh y detenerse sin vibrar
function scenarioFlat(cfg) {
  const world = makeWorld(cfg)
  const ground = addStaticTrimesh(world, extrudeProfile(flatProfile(), 20))
  refreshQueries(world)
  const v0 = 3
  const g = boardGeometry(cfg)
  const board = new Board(world, cfg, poseOnSurface(g, v3(0, 0, -60), v3(0, 1, 0), v3(0, 0, 1), v0))
  const startZ = board.body.translation().z
  let stopT = null
  let maxTilt = 0
  let fell = false
  const rest = { ys: [], maxV: 0, maxW: 0 }
  const seconds = 26
  const res = simulate(world, board, cfg, seconds, {
    onSub: (t) => {
      const v = len(board.body.linvel())
      maxTilt = Math.max(maxTilt, tiltFrom(board, v3(0, 1, 0)))
      if (board.up.y < 0.5) fell = true
      if (stopT === null && v < 0.01) stopT = t
      if (t > seconds - 3) {
        rest.ys.push(board.body.translation().y)
        rest.maxV = Math.max(rest.maxV, v)
        rest.maxW = Math.max(rest.maxW, len(board.body.angvel()))
      }
    },
  })
  const mean = rest.ys.reduce((a, b) => a + b, 0) / rest.ys.length
  const std = Math.sqrt(rest.ys.reduce((a, b) => a + (b - mean) ** 2, 0) / rest.ys.length)
  const dist = board.body.translation().z - startZ
  const theoryDist = (v0 * v0) / (2 * cfg.crr * GRAVITY)
  const out = {
    v0,
    distancia_m: r2(dist),
    distancia_teorica_m: r2(theoryDist),
    t_parada_s: stopT === null ? null : r2(stopT),
    t_parada_teorico_s: r2(v0 / (cfg.crr * GRAVITY)),
    altura_reposo_m: r4(mean),
    altura_reposo_esperada_m: r4(g.rideHeight),
    jitter_y_mm: r3(std * 1000),
    vmax_reposo_mps: r4(rest.maxV),
    wmax_reposo_rads: r4(rest.maxW),
    inclinacion_max_deg: r2(maxTilt),
    deck_toca_suelo: deckTouching(world, board, ground),
    cae_de_lado: fell,
    cpu_ms_por_frame: r3(res.cpuPerFrameMs),
  }
  out.ok = !fell && stopT !== null && std < 0.0005 && rest.maxV < 0.01 && rest.maxW < 0.02 && Math.abs(dist - theoryDist) / theoryDist < 0.15
  world.free()
  return out
}

// (b) Bajar una pendiente de 10°
function scenarioSlope(cfg) {
  const deg = 10
  const world = makeWorld(cfg)
  addStaticTrimesh(world, extrudeProfile(slopeProfile(deg), 20))
  refreshQueries(world)
  const g = boardGeometry(cfg)
  const t = Math.tan(deg * DEG)
  const n = norm(v3(0, 1, t)) // normal de la pendiente que baja hacia +Z
  const dir = norm(v3(0, -t, 1))
  const board = new Board(world, cfg, poseOnSurface(g, v3(0, -2 * t, 2), n, dir, 0))
  const aTheory = GRAVITY * (Math.sin(deg * DEG) - cfg.crr * Math.cos(deg * DEG))
  const samples = {}
  let maxPitchErr = 0
  let maxLat = 0
  let fell = false
  let minContacts = 4
  simulate(world, board, cfg, 4, {
    onSub: (time, info) => {
      const p = board.body.translation()
      if (p.z < 80) {
        maxPitchErr = Math.max(maxPitchErr, Math.abs(tiltFrom(board, n)))
        if (time > 0.2) minContacts = Math.min(minContacts, info.nContact)
      }
      maxLat = Math.max(maxLat, Math.abs(p.x))
      if (board.up.y < 0.5) fell = true
      for (const s of [1, 2, 4]) if (Math.abs(time - s) < 1e-6) samples[s] = len(board.body.linvel())
    },
  })
  const out = {
    aceleracion_teorica_mps2: r3(aTheory),
    v_1s: r3(samples[1]),
    v_1s_teorica: r3(aTheory * 1),
    v_2s: r3(samples[2]),
    v_4s: r3(samples[4]),
    v_4s_teorica: r3(aTheory * 4),
    error_alineacion_max_deg: r2(maxPitchErr),
    deriva_lateral_max_m: r4(maxLat),
    ruedas_contacto_min: minContacts,
    cae_de_lado: fell,
  }
  out.ok = !fell && Math.abs(samples[4] - aTheory * 4) / (aTheory * 4) < 0.05 && maxPitchErr < 2 && minContacts === 4
  world.free()
  return out
}

// (c) Subir y bajar un quarter pipe curvo (R = 2.0 m, H = 1.6 m)
function scenarioQuarterPipe(cfg, v0) {
  const R = 2.0
  const H = 1.6
  const world = makeWorld(cfg)
  const qp = quarterPipeProfile(R, H)
  const ground = addStaticTrimesh(world, extrudeProfile(qp.profile, 8))
  refreshQueries(world)
  const g = boardGeometry(cfg)
  const board = new Board(world, cfg, poseOnSurface(g, v3(0, 0, -4), v3(0, 1, 0), v3(0, 0, 1), v0))
  let maxH = 0
  let maxAngle = 0
  let fell = false
  let airborneSubsOnRamp = 0
  let subsOnRamp = 0
  let minContactOnRamp = 4
  let deckScrape = false
  let returnSpeed = null
  let reachedTop = false
  let maxRelTilt = 0
  /** Normal analítica de la superficie bajo el punto de contacto (llano, curva o plataforma). */
  const surfaceNormal = (cz) => {
    if (cz <= 0 || cz >= qp.zLip) return v3(0, 1, 0)
    const th = Math.asin(clamp(cz / R, -1, 1))
    return v3(0, Math.cos(th), -Math.sin(th))
  }
  simulate(world, board, cfg, 6, {
    onSub: (t, info) => {
      const p = board.body.translation()
      const up = board.up
      const contact = sub(p, scl(up, g.rideHeight)) // punto bajo las ruedas (aprox.)
      maxH = Math.max(maxH, contact.y)
      maxAngle = Math.max(maxAngle, Math.acos(clamp(up.y, -1, 1)) / DEG)
      const nS = surfaceNormal(contact.z)
      const rel = tiltFrom(board, nS)
      if (rel > 60) fell = true
      if (contact.z > 0.02 && contact.z < qp.zLip) {
        subsOnRamp++
        if (info.nContact === 0) airborneSubsOnRamp++
        minContactOnRamp = Math.min(minContactOnRamp, info.nContact)
        maxRelTilt = Math.max(maxRelTilt, rel)
      }
      if (contact.y > H - 0.02) reachedTop = true
      if (deckTouching(world, board, ground)) deckScrape = true
      if (returnSpeed === null && t > 1 && p.z < -2 && board.body.linvel().z < 0) returnSpeed = len(board.body.linvel())
    },
  })
  const hTheory = (v0 * v0) / (2 * GRAVITY)
  const out = {
    v0,
    altura_max_ruedas_m: r3(maxH),
    altura_teorica_sin_perdidas_m: r3(Math.min(hTheory, H)),
    angulo_max_tabla_deg: r2(maxAngle),
    angulo_labio_deg: r2(qp.thetaMax / DEG),
    error_alineacion_rampa_max_deg: r2(maxRelTilt),
    ruedas_contacto_min_en_rampa: minContactOnRamp,
    subpasos_sin_contacto_en_rampa: airborneSubsOnRamp,
    subpasos_en_rampa: subsOnRamp,
    supera_labio: reachedTop,
    roce_deck: deckScrape,
    v_regreso_mps: returnSpeed === null ? null : r3(returnSpeed),
    retencion_velocidad_pct: returnSpeed === null ? null : r2((100 * returnSpeed) / v0),
    cae: fell,
  }
  out.ok = !fell && returnSpeed !== null && returnSpeed > 0.85 * v0 && airborneSubsOnRamp === 0 && maxRelTilt < 10
  world.free()
  return out
}

// (d) Ollie: impulso vertical en el COM rodando a 3 m/s, vuelo y aterrizaje
function scenarioOllie(cfg) {
  const world = makeWorld(cfg)
  const ground = addStaticTrimesh(world, extrudeProfile(flatProfile(), 20))
  refreshQueries(world)
  const g = boardGeometry(cfg)
  const v0 = 3
  const board = new Board(world, cfg, poseOnSurface(g, v3(0, 0, -40), v3(0, 1, 0), v3(0, 0, 1), v0))
  const tPop = 1.0
  let comY0 = null
  let maxComY = -Infinity
  let state = 'ground'
  let takeoffT = null
  let landT = null
  let bounces = 0
  let maxNg = 0
  let maxCompression = 0
  let bottomOut = false
  let fell = false
  let landVy = null
  let maxTiltAir = 0
  let maxTiltAfter = 0
  let settleT = null
  let calmSince = null
  let lastGrounded = true
  const J = cfg.mass * Math.sqrt(2 * GRAVITY * cfg.ollieHeight)
  simulate(world, board, cfg, 4, {
    onFrame: (t, f) => {
      if (f === Math.round(tPop * cfg.hz)) {
        comY0 = board.body.worldCom().y
        board.body.applyImpulse({ x: 0, y: J, z: 0 }, true) // pop (impulso en el COM, espacio mundo)
      }
    },
    onSub: (t, info) => {
      const com = board.body.worldCom()
      const vy = board.body.linvel().y
      if (board.up.y < 0.5) fell = true
      if (comY0 !== null) maxComY = Math.max(maxComY, com.y)
      const grounded = info.nContact > 0
      if (t > tPop) {
        if (state === 'ground' && !grounded) {
          state = 'air'
          takeoffT = t
        } else if (state === 'air') {
          maxTiltAir = Math.max(maxTiltAir, tiltFrom(board, v3(0, 1, 0)))
          if (grounded) {
            state = 'landed'
            landT = t
            landVy = vy
          }
        } else if (state === 'landed') {
          if (lastGrounded && !grounded) bounces++
          maxNg = Math.max(maxNg, info.totalN / (cfg.mass * GRAVITY))
          for (const w of board.wheels) if (w.contact) maxCompression = Math.max(maxCompression, board.restLen - w.dist)
          if (deckTouching(world, board, ground)) bottomOut = true
          maxTiltAfter = Math.max(maxTiltAfter, tiltFrom(board, v3(0, 1, 0)))
          if (Math.abs(vy) < 0.02 && info.nContact === 4) {
            if (calmSince === null) calmSince = t
            if (settleT === null && t - calmSince > 0.3) settleT = calmSince - landT
          } else calmSince = null
        }
      }
      lastGrounded = grounded
    },
  })
  const out = {
    impulso_Ns: r2(J),
    altura_objetivo_m: cfg.ollieHeight,
    altura_max_com_m: r3(maxComY - comY0),
    tiempo_aire_s: landT && takeoffT ? r3(landT - takeoffT) : null,
    tiempo_aire_teorico_s: r3((2 * Math.sqrt(2 * GRAVITY * cfg.ollieHeight)) / GRAVITY),
    vy_aterrizaje_mps: landVy === null ? null : r3(landVy),
    pico_fuerza_normal_g: r2(maxNg),
    compresion_max_m: r4(maxCompression),
    recorrido_disponible_m: r4(board.travel),
    deck_toca_suelo: bottomOut,
    rebotes: bounces,
    t_estabilizacion_s: settleT === null ? null : r3(settleT),
    inclinacion_max_aire_deg: r2(maxTiltAir),
    inclinacion_max_tras_aterrizar_deg: r2(maxTiltAfter),
    v_final_mps: r3(len(board.body.linvel())),
    cae_de_lado: fell,
  }
  out.ok = !fell && !bottomOut && bounces === 0 && Math.abs(out.altura_max_com_m - cfg.ollieHeight) < 0.1 && settleT !== null && settleT < 0.5
  world.free()
  return out
}

// (e) Giro (carve) con dirección de trucks: radio objetivo, mide vuelco y derrape
function scenarioCarve(cfg) {
  const world = makeWorld(cfg)
  addStaticTrimesh(world, extrudeProfile(flatProfile(), 200))
  refreshQueries(world)
  const g = boardGeometry(cfg)
  const v0 = 4
  const board = new Board(world, cfg, poseOnSurface(g, v3(0, 0, -50), v3(0, 1, 0), v3(0, 0, 1), v0))
  // Radio de giro con los dos ejes girando en sentido opuesto: R = (wheelBase/2) / tan(steer)
  const steer = Math.atan(cfg.wheelBase / 2 / cfg.carveRadius)
  let maxTilt = 0
  let fell = false
  let maxSlip = 0
  const yawRates = []
  simulate(world, board, cfg, 5, {
    onFrame: (t) => {
      board.steer = t > 0.5 ? steer : 0
    },
    onSub: (t) => {
      if (board.up.y < 0.5) fell = true
      maxTilt = Math.max(maxTilt, tiltFrom(board, v3(0, 1, 0)))
      const v = board.body.linvel()
      const lat = dot(v, qrot(board.body.rotation(), v3(1, 0, 0)))
      maxSlip = Math.max(maxSlip, Math.abs(lat))
      if (t > 2) yawRates.push({ w: board.body.angvel().y, v: len(v) })
    },
  })
  const avgW = yawRates.reduce((a, b) => a + b.w, 0) / yawRates.length
  const avgV = yawRates.reduce((a, b) => a + b.v, 0) / yawRates.length
  const out = {
    v0,
    steer_deg: r2(steer / DEG),
    radio_objetivo_m: cfg.carveRadius,
    radio_obtenido_m: r2(avgV / Math.abs(avgW)),
    aceleracion_lateral_mps2: r2((avgV * avgV) / cfg.carveRadius),
    inclinacion_max_deg: r2(maxTilt),
    derrape_lateral_max_mps: r3(maxSlip),
    cae_de_lado: fell,
  }
  out.ok = !fell && Math.abs(out.radio_obtenido_m - cfg.carveRadius) / cfg.carveRadius < 0.15 && maxTilt < 10
  world.free()
  return out
}

const SCENARIOS = {
  a: { name: 'a) llano trimesh: rodar y parar', run: scenarioFlat },
  b: { name: 'b) pendiente 10°', run: scenarioSlope },
  c: { name: 'c) quarter pipe R=2.0 H=1.6', run: (cfg) => [4.5, 5.0, 5.5].map((v) => scenarioQuarterPipe(cfg, v)) },
  d: { name: 'd) ollie + aterrizaje', run: scenarioOllie },
  e: { name: 'e) carve (dirección de trucks)', run: scenarioCarve },
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const cfg = { ...DEFAULTS }
  const opts = { scenarios: Object.keys(SCENARIOS), json: false, matrix: false, help: false }
  for (const a of argv) {
    const m = /^--([^=]+)(?:=(.*))?$/.exec(a)
    if (!m) continue
    const [, key, val] = m
    if (key === 'scenario') opts.scenarios = val.split(',').map((s) => s.trim())
    else if (key === 'json') opts.json = true
    else if (key === 'matrix') opts.matrix = true
    else if (key === 'help') opts.help = true
    else if (key in cfg) cfg[key] = Number(val)
    else throw new Error(`Opción desconocida: --${key}`)
  }
  return { cfg, opts }
}

function printBlock(name, result) {
  const list = Array.isArray(result) ? result : [result]
  for (const r of list) {
    console.log(`\n${r.ok ? 'OK  ' : 'FALLA'} ${name}`)
    for (const [k, v] of Object.entries(r)) if (k !== 'ok') console.log(`   ${k.padEnd(34)} ${v}`)
  }
}

async function main() {
  const { cfg, opts } = parseArgs(process.argv.slice(2))
  if (opts.help) {
    console.log('Opciones: --scenario=a,b,c,d,e  --matrix  --json  y cualquier parámetro: ' + Object.keys(DEFAULTS).map((k) => `--${k}`).join(' '))
    return
  }
  await RAPIER.init()
  if (opts.matrix) {
    const rows = []
    for (const comY of [0.1, 0.35, 0.9]) {
      for (const substeps of [1, 2, 4]) {
        for (const align of [1, 0]) {
          const c = { ...cfg, comY, substeps, align }
          const row = { comY, substeps, align }
          for (const id of opts.scenarios) {
            const r = SCENARIOS[id].run(c)
            row[id] = (Array.isArray(r) ? r.every((x) => x.ok) : r.ok) ? 'OK' : 'falla'
          }
          rows.push(row)
        }
      }
    }
    if (opts.json) console.log(JSON.stringify(rows, null, 2))
    else console.table(rows)
    return
  }
  const geo = new Board(makeWorld(cfg), cfg, { position: v3(), rotation: { x: 0, y: 0, z: 0, w: 1 } })
  const derived = {
    dt: r4(1 / (cfg.hz * cfg.substeps)),
    k_por_rueda_N_m: Math.round(geo.k),
    c_por_rueda_Ns_m: Math.round(geo.c),
    hundimiento_estatico_mm: r2(geo.sag * 1000),
    longitud_reposo_rayo_m: r4(geo.restLen),
    altura_origen_sobre_suelo_m: r4(geo.rideHeight),
    recorrido_hasta_deck_m: r4(geo.travel),
    masa_kg: geo.body.mass(),
    com_local: JSON.stringify(geo.body.localCom()),
  }
  const results = { rapier: RAPIER.version(), cfg, derived, scenarios: {} }
  for (const id of opts.scenarios) results.scenarios[id] = SCENARIOS[id].run(cfg)
  if (opts.json) {
    console.log(JSON.stringify(results, null, 2))
    return
  }
  console.log(`Rapier ${results.rapier} — prototipo de suspensión por rayos (STREETFLOW 3D)`)
  console.log('Parámetros:', JSON.stringify(cfg))
  console.log('Derivados :', JSON.stringify(derived))
  for (const id of opts.scenarios) printBlock(SCENARIOS[id].name, results.scenarios[id])
  const all = Object.values(results.scenarios).flat()
  console.log(`\nResumen: ${all.filter((r) => r.ok).length}/${all.length} pruebas OK`)
}

export { Board, SCENARIOS, makeWorld, refreshQueries, extrudeProfile, addStaticTrimesh, flatProfile, slopeProfile, quarterPipeProfile, poseOnSurface, boardGeometry, simulate }

// Solo se ejecuta como script (permite importar el módulo desde pruebas sin lanzar main)
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
