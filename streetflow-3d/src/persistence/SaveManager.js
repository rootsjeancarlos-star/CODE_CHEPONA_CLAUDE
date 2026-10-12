import { GAME } from '../core/Config.js'
import { DEFAULT_CHARACTER_CUSTOMIZATION, DEFAULT_BOARD_CUSTOMIZATION, CUSTOMIZATION_OPTIONS } from '../data/customizationDefaults.js'

/**
 * Progreso del jugador (localStorage, versionado) y parques del editor (IndexedDB 'streetflow' → 'parks').
 * Recuperación segura: datos dañados → partida nueva con aviso; IndexedDB no disponible → memoria.
 */
export const SAVE_KEY = 'streetflow.save.v1'
const DB_NAME = 'streetflow'
const DB_VERSION = 1
const PARK_STORE = 'parks'

export function defaultSaveData() {
  return {
    version: GAME.saveVersion,
    stats: { totalScore: 0, bestCombo: 0, tricksLanded: {}, bails: 0, distance: 0, airTime: 0, grindTime: 0, playTime: 0, sessions: 0 },
    challenges: {},
    spots: {},
    customization: { character: { ...DEFAULT_CHARACTER_CUSTOMIZATION }, board: { ...DEFAULT_BOARD_CUSTOMIZATION } },
    markers: {},
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const isColor = (v) => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

/** Valida la personalización: claves conocidas y valores con el tipo del valor por defecto. */
export function sanitizeCustomization(c) {
  const out = { character: { ...DEFAULT_CHARACTER_CUSTOMIZATION }, board: { ...DEFAULT_BOARD_CUSTOMIZATION } }
  for (const part of ['character', 'board']) {
    const src = c?.[part]
    if (!isObj(src)) continue
    for (const [k, def] of Object.entries(out[part])) {
      const v = src[k]
      if (v === undefined) continue
      if (typeof def === 'boolean' && typeof v === 'boolean') out[part][k] = v
      else if (typeof def === 'number' && Number.isFinite(v)) out[part][k] = Math.min(1, Math.max(0, v))
      else if (typeof def === 'string' && typeof v === 'string') {
        if (def.startsWith('#') ? isColor(v) : v.length < 40) out[part][k] = v
      }
    }
  }
  if (!CUSTOMIZATION_OPTIONS.top.includes(out.character.top)) out.character.top = DEFAULT_CHARACTER_CUSTOMIZATION.top
  if (!['regular', 'goofy'].includes(out.character.stance)) out.character.stance = 'regular'
  return out
}

/** Normaliza datos guardados (y migra versiones antiguas). */
export function sanitizeSaveData(raw) {
  const def = defaultSaveData()
  if (!isObj(raw)) return def
  const out = def
  if (isObj(raw.stats)) {
    for (const k of Object.keys(def.stats)) {
      if (k === 'tricksLanded') {
        if (isObj(raw.stats.tricksLanded)) for (const [id, n] of Object.entries(raw.stats.tricksLanded)) if (Number.isFinite(n) && n >= 0) out.stats.tricksLanded[id] = n
      } else if (Number.isFinite(raw.stats[k])) out.stats[k] = Math.max(0, raw.stats[k])
    }
  }
  if (isObj(raw.challenges)) {
    for (const [id, r] of Object.entries(raw.challenges)) {
      if (isObj(r)) out.challenges[id] = { completed: !!r.completed, progress: Number.isFinite(r.progress) ? r.progress : 0, completedAt: r.completedAt || null }
    }
  }
  if (isObj(raw.spots)) for (const id of Object.keys(raw.spots)) out.spots[id] = true
  if (isObj(raw.markers)) {
    for (const [lvl, m] of Object.entries(raw.markers)) {
      if (isObj(m) && Array.isArray(m.position) && m.position.length === 3 && m.position.every(Number.isFinite)) out.markers[lvl] = { position: m.position, yaw: Number.isFinite(m.yaw) ? m.yaw : 0 }
    }
  }
  out.customization = sanitizeCustomization(raw.customization)
  return out
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export class SaveManager {
  constructor({ bus = null } = {}) {
    this.bus = bus
    this.data = defaultSaveData()
    this._timer = null
    this._db = null
    this._memParks = new Map()
    this.parks = {
      list: () => this._parkList(),
      get: (id) => this._parkGet(id),
      put: (desc) => this._parkPut(desc),
      delete: (id) => this._parkDelete(id),
    }
  }

  async init() {
    const s = storage()
    if (s) {
      try {
        const raw = s.getItem(SAVE_KEY)
        if (raw) this.data = sanitizeSaveData(JSON.parse(raw))
      } catch (err) {
        console.warn('[SaveManager] partida dañada; se inicia una nueva', err)
        this.data = defaultSaveData()
        this.bus?.emit('ui:notify', { text: 'La partida guardada estaba dañada: se ha creado una nueva.', kind: 'warn', duration: 5 })
      }
    }
    this.data.stats.sessions++
    this.saveNow()
    try {
      this._db = await this._openDB()
    } catch (err) {
      console.warn('[SaveManager] IndexedDB no disponible: los parques se guardarán solo en memoria', err)
      this._db = null
    }
  }

  update(mutator) {
    mutator(this.data)
    this.saveSoon()
  }

  saveSoon(ms = 800) {
    if (this._timer) return
    this._timer = setTimeout(() => {
      this._timer = null
      this.saveNow()
    }, ms)
  }

  saveNow() {
    try {
      storage()?.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch (err) {
      console.warn('[SaveManager] no se pudo guardar', err)
    }
  }

  resetProgress() {
    const custom = this.data.customization
    this.data = defaultSaveData()
    this.data.customization = custom
    this.saveNow()
  }

  // ------------------------------------------------------------------------------------------
  // IndexedDB: parques del editor
  // ------------------------------------------------------------------------------------------
  _openDB() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('sin IndexedDB'))
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(PARK_STORE)) db.createObjectStore(PARK_STORE, { keyPath: 'id' })
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
      req.onblocked = () => reject(new Error('IndexedDB bloqueada'))
    })
  }

  _tx(mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(PARK_STORE, mode)
      const store = tx.objectStore(PARK_STORE)
      const req = fn(store)
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  }

  async _parkList() {
    if (!this._db) return [...this._memParks.values()].map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt }))
    const all = await this._tx('readonly', (s) => s.getAll())
    return (all || []).map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
  }

  async _parkGet(id) {
    if (!this._db) return this._memParks.get(id) || null
    return (await this._tx('readonly', (s) => s.get(id))) || null
  }

  async _parkPut(desc) {
    const rec = { ...desc, updatedAt: Date.now() }
    if (!this._db) {
      this._memParks.set(rec.id, rec)
      return rec
    }
    await this._tx('readwrite', (s) => s.put(rec))
    return rec
  }

  async _parkDelete(id) {
    if (!this._db) return this._memParks.delete(id)
    await this._tx('readwrite', (s) => s.delete(id))
    return true
  }
}
