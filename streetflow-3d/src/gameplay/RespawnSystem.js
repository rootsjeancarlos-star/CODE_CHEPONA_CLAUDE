/**
 * STUB (WP-PHYS lo reemplaza): R reinicia en el punto de aparición más cercano, G guarda marcador, T vuelve al
 * marcador, reaparición automática tras caídas o al salir de los límites del nivel.
 * API: fixedUpdate(dt, telemetry, intent, player), saveMarker(position, yaw), loadMarker(), getMarker()
 */
export class RespawnSystem {
  constructor({ bus, world, save }) {
    this.bus = bus
    this.world = world
    this.save = save
  }
  fixedUpdate(dt, tel, intent, player) {
    if (intent?.resetPressed) {
      player.spawn(this.world.getSpawn())
      this.bus.emit('skater:respawn', { position: this.world.getSpawn().position, reason: 'reset' })
    }
  }
}
