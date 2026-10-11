import { GAME } from '../core/Config.js'

/**
 * Ajustes del jugador en localStorage, versionados y validados (docs/ARCHITECTURE.md §15).
 * STUB parcial (WP-UI completa validación por campo y migraciones).
 */
export const SETTINGS_KEY = 'streetflow.settings.v1'

export function defaultSettings() {
  return {
    version: GAME.settingsVersion,
    graphics: { preset: 'high', renderScale: 1, shadows: true, postFX: true, dynamicFov: true, motionBlur: false, timeOfDay: 'afternoon', showFps: false },
    audio: { master: 0.8, sfx: 0.9, music: 0.45, ambient: 0.6, muted: false },
    controls: { mouseSensitivity: 1, invertY: false, gamepadDeadzone: 0.15, gamepadSensitivity: 1, flickStick: true, keyboard: {} },
    gameplay: { physicsMode: 'arcade', stance: 'regular', tutorialHints: true, cameraDistance: 1, units: 'kmh' },
    accessibility: { reduceCameraShake: false, highContrastHud: false },
  }
}

function merge(def, src) {
  if (!src || typeof src !== 'object') return def
  const out = Array.isArray(def) ? [...def] : { ...def }
  for (const k of Object.keys(def)) {
    const dv = def[k]
    const sv = src[k]
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) out[k] = merge(dv, sv)
    else if (sv !== undefined && typeof sv === typeof dv) out[k] = sv
  }
  return out
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export const SettingsStorage = {
  load() {
    const s = storage()
    if (!s) return defaultSettings()
    try {
      const raw = s.getItem(SETTINGS_KEY)
      if (!raw) return defaultSettings()
      return merge(defaultSettings(), JSON.parse(raw))
    } catch (err) {
      console.warn('[SettingsStorage] ajustes dañados, se restauran los valores por defecto', err)
      return defaultSettings()
    }
  },
  save(settings) {
    const clean = merge(defaultSettings(), settings)
    try {
      storage()?.setItem(SETTINGS_KEY, JSON.stringify(clean))
    } catch (err) {
      console.warn('[SettingsStorage] no se pudo guardar', err)
    }
    return clean
  },
}
