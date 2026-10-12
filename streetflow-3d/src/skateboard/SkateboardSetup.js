/**
 * Dimensiones reales del skateboard (metros), compartidas por la física y el modelo visual.
 * Ejes locales: +Z nariz, +Y arriba, +X izquierda mirando a la nariz. Origen: centro del deck, cara superior de la lija.
 * Fuentes de rangos: docs/RESEARCH.md (decks 7.75–8.5", wheelbase ~14", ruedas 50–56 mm).
 */
const IN = 0.0254

export const DEFAULT_BOARD_SETUP = Object.freeze({
  deck: Object.freeze({
    length: 32 * IN, // 0.813
    width: 8.25 * IN, // 0.2096
    thickness: 0.0115, // 7 capas de arce ~1.6 mm + lija
    plies: 7,
    wheelbase: 14.25 * IN, // distancia entre los tornillos interiores ≈ entre ejes
    noseKickAngle: 21 * (Math.PI / 180),
    tailKickAngle: 19 * (Math.PI / 180),
    /** distancia desde el centro del eje hasta el inicio de la curva del kick */
    kickStartOffset: 0.035,
    concaveDepth: 0.0085,
    noseShape: 0.5, // 0 = cuadrada, 1 = muy redondeada (forma "popsicle")
  }),
  trucks: Object.freeze({
    /** altura desde el eje de la rueda hasta la base del deck */
    height: 0.053,
    /** ancho total de eje a eje (extremos del eje) */
    axleWidth: 8.0 * IN, // 0.203
    hangerWidth: 0.135,
    baseplateLength: 0.065,
    baseplateWidth: 0.057,
    kingpinAngle: 50 * (Math.PI / 180),
    maxSteerAngle: 9 * (Math.PI / 180),
    bushingColor: '#b3262d',
    metalColor: '#c9ccd1',
  }),
  wheels: Object.freeze({
    diameter: 0.053,
    width: 0.032,
    contactWidth: 0.018,
    color: '#efe6cf',
    durometer: 99,
  }),
  grip: Object.freeze({ color: '#121212', coarseness: 0.8 }),
  graphic: 'sf-ink-01',
})

/**
 * Deriva medidas útiles de un setup.
 * @param {typeof DEFAULT_BOARD_SETUP} setup
 */
export function computeBoardGeometry(setup = DEFAULT_BOARD_SETUP) {
  const r = setup.wheels.diameter / 2
  const deckBottom = -setup.deck.thickness
  const axleY = deckBottom - setup.trucks.height // centro de rueda respecto a la cara superior
  const groundY = axleY - r // contacto con el suelo en reposo (negativo)
  const halfTrack = setup.trucks.axleWidth / 2 - setup.wheels.width / 2
  const halfBase = setup.deck.wheelbase / 2
  // Orden: [FL, FR, RL, RR]. F = lado nariz (+Z). L = +X.
  const wheelCenters = [
    [halfTrack, axleY, halfBase],
    [-halfTrack, axleY, halfBase],
    [halfTrack, axleY, -halfBase],
    [-halfTrack, axleY, -halfBase],
  ]
  return {
    wheelRadius: r,
    axleY,
    deckTopHeight: -groundY, // altura de la cara superior sobre el suelo en reposo
    groundY,
    halfTrack,
    halfBase,
    wheelCenters,
    /** pies: delantero sobre los tornillos delanteros, trasero sobre la cola */
    footPositions: {
      front: [0, 0, halfBase - 0.015],
      back: [0, 0, -halfBase - 0.035],
    },
  }
}
