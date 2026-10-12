/**
 * STUB (WP-WORLD lo reemplaza): registro espacial de aristas grindables (GrindEdge) y spots.
 * API: registerEdge(edge) → id, removeEdge(id), queryEdges(position, radius, out[]) → hits,
 *      registerSpot(spot), querySpots(position), getEdge(id), clear()
 */
export class SpotRegistry {
  constructor() {
    this.edges = new Map()
    this.spots = new Map()
    this._id = 0
  }

  registerEdge(edge) {
    const id = edge.id || `edge-${++this._id}`
    this.edges.set(id, { ...edge, id })
    return id
  }

  removeEdge(id) {
    this.edges.delete(id)
  }

  getEdge(id) {
    return this.edges.get(id) || null
  }

  queryEdges(position, radius, out = []) {
    out.length = 0
    return out
  }

  registerSpot(spot) {
    this.spots.set(spot.id, spot)
    return spot.id
  }

  querySpots() {
    return []
  }

  clear() {
    this.edges.clear()
    this.spots.clear()
  }
}
