/**
 * Bus de eventos síncrono. Un handler que lanza no impide que se ejecuten los demás.
 * Catálogo de eventos: docs/ARCHITECTURE.md §5.1
 */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._handlers = new Map()
    this._emitDepth = 0
    this.onError = (type, err) => console.error(`[EventBus] handler de "${type}" falló:`, err)
  }

  /** @returns {() => void} función para desuscribirse */
  on(type, handler) {
    let set = this._handlers.get(type)
    if (!set) {
      set = new Set()
      this._handlers.set(type, set)
    }
    set.add(handler)
    return () => this.off(type, handler)
  }

  once(type, handler) {
    const off = this.on(type, (payload) => {
      off()
      handler(payload)
    })
    return off
  }

  off(type, handler) {
    const set = this._handlers.get(type)
    if (!set) return
    set.delete(handler)
    if (set.size === 0) this._handlers.delete(type)
  }

  emit(type, payload) {
    const set = this._handlers.get(type)
    if (!set || set.size === 0) return
    // Copia para permitir on/off durante la emisión.
    const list = set.size === 1 ? [set.values().next().value] : Array.from(set)
    this._emitDepth++
    try {
      for (let i = 0; i < list.length; i++) {
        try {
          list[i](payload)
        } catch (err) {
          this.onError(type, err)
        }
      }
    } finally {
      this._emitDepth--
    }
  }

  listenerCount(type) {
    return this._handlers.get(type)?.size ?? 0
  }

  clear() {
    this._handlers.clear()
  }
}
