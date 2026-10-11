/**
 * STUB (WP-ANIM lo reemplaza): AnimationMixer con clips procedurales (AnimationLibrary), mezcla por estado,
 * capas aditivas (inclinación, equilibrio), IK de piernas a los anclajes del deck (CharacterIK) y pose de raíz.
 * API: update(dt, ctx), captureState(), applyState(s), dispose()
 *   ctx = PlayerController.getAnimationContext(alpha) (ver docs/ARCHITECTURE.md §10)
 */
export class CharacterAnimator {
  constructor(character, { bus } = {}) {
    this.character = character
    this.bus = bus
  }

  update(dt, ctx) {
    if (!ctx) return
    this.character.object3d.position.copy(ctx.rootPosition)
    this.character.object3d.quaternion.copy(ctx.rootQuaternion)
  }

  captureState() {
    return null
  }

  applyState() {}

  dispose() {}
}
