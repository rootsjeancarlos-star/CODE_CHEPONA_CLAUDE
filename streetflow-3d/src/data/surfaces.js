/**
 * Propiedades físicas y sonoras de las superficies. Cada collider estático referencia un id.
 * friction: coeficiente de Rapier para choques; rollingResistance: coef. adimensional (F = c·N);
 * lateralGrip: multiplica el límite de fricción lateral de las ruedas; grindFriction: desaceleración en grind (m/s²).
 */
export const SURFACES = Object.freeze({
  parkConcrete: { label: 'Hormigón de skatepark', friction: 0.7, rollingResistance: 0.009, lateralGrip: 1.0, grindFriction: 1.6, speedFactor: 1.0, audio: 'smooth' },
  concrete: { label: 'Hormigón', friction: 0.75, rollingResistance: 0.013, lateralGrip: 1.0, grindFriction: 2.0, speedFactor: 0.97, audio: 'concrete' },
  asphalt: { label: 'Asfalto', friction: 0.8, rollingResistance: 0.02, lateralGrip: 1.05, grindFriction: 2.4, speedFactor: 0.93, audio: 'rough' },
  metal: { label: 'Metal', friction: 0.35, rollingResistance: 0.008, lateralGrip: 0.85, grindFriction: 0.9, speedFactor: 1.0, audio: 'metal' },
  wood: { label: 'Madera', friction: 0.55, rollingResistance: 0.01, lateralGrip: 0.95, grindFriction: 1.4, speedFactor: 1.0, audio: 'wood' },
  painted: { label: 'Superficie pintada', friction: 0.6, rollingResistance: 0.01, lateralGrip: 0.95, grindFriction: 1.2, speedFactor: 1.0, audio: 'smooth' },
  brick: { label: 'Ladrillo', friction: 0.8, rollingResistance: 0.03, lateralGrip: 1.0, grindFriction: 2.6, speedFactor: 0.9, audio: 'brick' },
  tile: { label: 'Baldosa', friction: 0.6, rollingResistance: 0.016, lateralGrip: 0.95, grindFriction: 1.8, speedFactor: 0.95, audio: 'tile' },
  grass: { label: 'Césped', friction: 0.9, rollingResistance: 0.25, lateralGrip: 0.6, grindFriction: 6, speedFactor: 0.4, audio: 'grass' },
  dirt: { label: 'Tierra', friction: 0.85, rollingResistance: 0.12, lateralGrip: 0.7, grindFriction: 5, speedFactor: 0.6, audio: 'dirt' },
})

export const DEFAULT_SURFACE = 'concrete'

/** @param {string} id */
export function getSurface(id) {
  return SURFACES[id] || SURFACES[DEFAULT_SURFACE]
}
