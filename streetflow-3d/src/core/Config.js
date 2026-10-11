/**
 * Constantes globales del juego. Unidades SI (m, s, kg, rad). Ver docs/ARCHITECTURE.md §2 y §5.3.
 * Los parámetros de ajuste fino de cada sistema viven en su propio módulo, pero los valores
 * compartidos entre módulos (grupos de colisión, paso fijo, masas) se definen aquí.
 */

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v))
  return Object.freeze(o)
}

export const GAME = deepFreeze({
  name: 'STREETFLOW 3D',
  subtitle: 'URBAN SKATE EXPERIENCE',
  version: '0.1.0',
  saveVersion: 1,
  settingsVersion: 1,
})

/** Bits de los grupos de colisión de Rapier (16 bits de pertenencia | 16 bits de filtro). */
const G = {
  STATIC: 1 << 0,
  SKATER: 1 << 1,
  BOARD_LOOSE: 1 << 2,
  DYNAMIC_PROP: 1 << 3,
  CAMERA_BLOCKER: 1 << 4,
  TRIGGER: 1 << 5,
}

/** Empaqueta pertenencia y filtro en el formato de InteractionGroups de Rapier. */
export function interactionGroups(membership, filter) {
  return ((membership & 0xffff) << 16) | (filter & 0xffff)
}

export const PHYSICS = deepFreeze({
  fixedDt: 1 / 60,
  maxStepsPerFrame: 5,
  maxFrameDelta: 0.25,
  gravity: { x: 0, y: -9.81, z: 0 },
  GROUPS: G,
  /** Combinaciones de uso frecuente */
  GROUP_SETS: {
    static: interactionGroups(G.STATIC | G.CAMERA_BLOCKER, G.SKATER | G.BOARD_LOOSE | G.DYNAMIC_PROP),
    skater: interactionGroups(G.SKATER, G.STATIC | G.DYNAMIC_PROP),
    boardLoose: interactionGroups(G.BOARD_LOOSE, G.STATIC | G.DYNAMIC_PROP),
    dynamicProp: interactionGroups(G.DYNAMIC_PROP, G.STATIC | G.SKATER | G.BOARD_LOOSE | G.DYNAMIC_PROP),
    /** filtro para rayos de rueda: solo geometría estática y props */
    wheelRay: interactionGroups(0xffff, G.STATIC | G.DYNAMIC_PROP),
    /** filtro para el rayo anti-oclusión de la cámara */
    cameraRay: interactionGroups(0xffff, G.CAMERA_BLOCKER),
  },
})

/**
 * Parámetros del skater. `modes` separa la asistencia (arcade/realista) del núcleo físico.
 * SkateboardPhysics puede ampliar estos valores; los que se compartan con otros módulos deben estar aquí.
 */
export const SKATER = deepFreeze({
  riderMass: 70,
  boardMass: 3.5,
  /** Centro de masa local (m) respecto al origen del cuerpo (centro del deck, cara superior). */
  centerOfMass: { x: 0, y: 0.35, z: 0 },
  riderHeight: 1.78,
  /** Velocidades en m/s */
  maxPushSpeed: 7.5,
  maxSpeed: 16,
  walkSpeed: 1.6,
  runSpeed: 4.2,
  defaultStance: 'regular',
  modes: {
    arcade: {
      landingTolerance: 45 * (Math.PI / 180),
      flipCatchTolerance: 55 * (Math.PI / 180),
      airControl: 1.0,
      autoLevel: 3.5,
      grindCapture: 0.28,
      balanceDifficulty: 0.55,
      bailOnBalanceLoss: false,
      ollieHeight: [0.45, 0.85],
      spinRate: 7.5,
    },
    realistic: {
      landingTolerance: 22 * (Math.PI / 180),
      flipCatchTolerance: 30 * (Math.PI / 180),
      airControl: 0.55,
      autoLevel: 0.6,
      grindCapture: 0.14,
      balanceDifficulty: 1.0,
      bailOnBalanceLoss: true,
      ollieHeight: [0.3, 0.75],
      spinRate: 5.5,
    },
  },
})

export const CAMERA = deepFreeze({
  fov: 62,
  near: 0.05,
  far: 600,
  follow: { distance: 3.6, height: 1.55, lookHeight: 0.95, stiffness: 7.5, rotationStiffness: 4.0, minDistance: 0.9 },
  cinematic: { distance: 5.5, height: 0.45, orbitSpeed: 0.12 },
  free: { speed: 8, sensitivity: 0.0022 },
  dynamicFov: { enabled: true, maxExtra: 9, speedForMax: 12 },
})

/** Flags de depuración leídas de la URL: ?debug=1&backend=webgl&quality=low&level=downtown&autoplay=1&mode=arcade */
function readDebugFlags() {
  const flags = { debug: false, backend: 'auto', quality: null, level: null, autoplay: false, mode: null, seed: 1, test: false }
  try {
    if (typeof location === 'undefined') return flags
    const q = new URLSearchParams(location.search)
    flags.debug = q.get('debug') === '1'
    const b = q.get('backend')
    if (b === 'webgl' || b === 'webgpu') flags.backend = b
    const qual = q.get('quality')
    if (['low', 'medium', 'high', 'ultra'].includes(qual)) flags.quality = qual
    flags.level = q.get('level')
    flags.autoplay = q.get('autoplay') === '1'
    const m = q.get('mode')
    if (m === 'arcade' || m === 'realistic') flags.mode = m
    flags.test = q.get('test') === '1'
  } catch {
    /* entornos sin location */
  }
  return flags
}

export const DEBUG = Object.freeze(readDebugFlags())

export const DEG = Math.PI / 180
export const TAU = Math.PI * 2
