import { GAME } from '../core/Config.js'
import { DEFAULT_CHARACTER_CUSTOMIZATION, DEFAULT_BOARD_CUSTOMIZATION } from '../data/customizationDefaults.js'

/**
 * STUB parcial (WP-UI lo completa): progreso del jugador en localStorage versionado + parques en IndexedDB.
 * API: init(), data, update(mutator), saveNow(), parks: { list(), get(id), put(desc), delete(id) }
 */
export const SAVE_KEY = 'streetflow.save.v1'

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

export class SaveManager {
  constructor({ bus } = {}) {
    this.bus = bus
    this.data = defaultSaveData()
    this.parks = {
      list: async () => [],
      get: async () => null,
      put: async () => null,
      delete: async () => false,
    }
  }

  async init() {
    try {
      const raw = localStorage.getItem(SAVE_KEY)
      if (raw) {
        const d = JSON.parse(raw)
        const def = defaultSaveData()
        this.data = { ...def, ...d, customization: { character: { ...def.customization.character, ...(d.customization?.character || {}) }, board: { ...def.customization.board, ...(d.customization?.board || {}) } } }
      }
    } catch (err) {
      console.warn('[SaveManager] partida dañada; se inicia una nueva', err)
      this.data = defaultSaveData()
    }
  }

  update(mutator) {
    mutator(this.data)
    this.saveNow()
  }

  saveNow() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(this.data))
    } catch (err) {
      console.warn('[SaveManager] no se pudo guardar', err)
    }
  }
}
