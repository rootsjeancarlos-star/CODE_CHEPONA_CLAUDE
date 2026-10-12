/**
 * STUB (WP-EDITOR lo reemplaza): editor visual de parques sobre ParkDescriptor (colocar, mover, rotar,
 * escalar parámetros, duplicar, eliminar, snap, materiales, guardar/cargar en IndexedDB, exportar/importar JSON).
 * API: open(), close(), update(dt), handleEscape(), active
 */
export class ParkEditor {
  constructor({ game }) {
    this.game = game
    this.active = false
  }
  open() {
    this.active = true
  }
  close() {
    this.active = false
  }
  update() {}
  handleEscape() {
    this.game.actions.closeEditor()
  }
}
