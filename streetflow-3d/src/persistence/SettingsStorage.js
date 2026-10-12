import { GAME } from '../core/Config.js'

/**
 * Ajustes del jugador en localStorage, versionados y validados campo a campo (docs/ARCHITECTURE.md §15).
 * Datos dañados o fuera de rango → valor por defecto (sin lanzar). Las migraciones se aplican por versión.
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

/** Esquema de validación: tipo y rango/valores permitidos por campo. */
const SCHEMA = {
  graphics: {
    preset: { enum: ['low', 'medium', 'high', 'ultra'] },
    renderScale: { min: 0.5, max: 1 },
    shadows: { bool: true },
    postFX: { bool: true },
    dynamicFov: { bool: true },
    motionBlur: { bool: true },
    timeOfDay: { enum: ['morning', 'afternoon', 'sunset', 'night'] },
    showFps: { bool: true },
  },
  audio: { master: { min: 0, max: 1 }, sfx: { min: 0, max: 1 }, music: { min: 0, max: 1 }, ambient: { min: 0, max: 1 }, muted: { bool: true } },
  controls: {
    mouseSensitivity: { min: 0.1, max: 4 },
    invertY: { bool: true },
    gamepadDeadzone: { min: 0.02, max: 0.5 },
    gamepadSensitivity: { min: 0.2, max: 3 },
    flickStick: { bool: true },
    keyboard: { object: true },
  },
  gameplay: {
    physicsMode: { enum: ['arcade', 'realistic'] },
    stance: { enum: ['regular', 'goofy'] },
    tutorialHints: { bool: true },
    cameraDistance: { min: 0.6, max: 1.6 },
    units: { enum: ['kmh', 'mph'] },
  },
  accessibility: { reduceCameraShake: { bool: true }, highContrastHud: { bool: true } },
}

function validField(rule, v) {
  if (rule.enum) return rule.enum.includes(v)
  if (rule.bool) return typeof v === 'boolean'
  if (rule.object) return v !== null && typeof v === 'object' && !Array.isArray(v)
  return typeof v === 'number' && Number.isFinite(v) && v >= rule.min && v <= rule.max
}

/**
 * Normaliza un objeto de ajustes. Devuelve { settings, errors }.
 * @param {any} raw
 */
export function sanitizeSettings(raw) {
  const def = defaultSettings()
  const errors = []
  if (!raw || typeof raw !== 'object') return { settings: def, errors: raw == null ? [] : ['formato inválido'] }
  const migrated = migrate(raw, errors)
  for (const group of Object.keys(SCHEMA)) {
    const src = migrated[group]
    if (src == null) continue
    if (typeof src !== 'object') {
      errors.push(`grupo ${group} inválido`)
      continue
    }
    for (const key of Object.keys(SCHEMA[group])) {
      if (!(key in src)) continue
      if (validField(SCHEMA[group][key], src[key])) def[group][key] = src[key]
      else errors.push(`${group}.${key} inválido`)
    }
  }
  return { settings: def, errors }
}

/** Migraciones entre versiones del formato (de momento solo v1). */
function migrate(raw, errors) {
  const v = raw.version ?? 1
  if (v > GAME.settingsVersion) errors.push(`versión ${v} más nueva que la soportada; se leerán los campos conocidos`)
  return raw
}

function storage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    return null
  }
}

export const SettingsStorage = {
  lastErrors: [],
  load() {
    const s = storage()
    if (!s) return defaultSettings()
    let raw = null
    try {
      raw = s.getItem(SETTINGS_KEY)
      const { settings, errors } = sanitizeSettings(raw ? JSON.parse(raw) : null)
      this.lastErrors = errors
      if (errors.length) console.warn('[SettingsStorage] ajustes corregidos:', errors)
      return settings
    } catch (err) {
      console.warn('[SettingsStorage] ajustes dañados, se restauran los valores por defecto', err)
      this.lastErrors = ['ajustes dañados']
      return defaultSettings()
    }
  },
  save(settings) {
    const { settings: clean } = sanitizeSettings(settings)
    try {
      storage()?.setItem(SETTINGS_KEY, JSON.stringify(clean))
    } catch (err) {
      console.warn('[SettingsStorage] no se pudo guardar', err)
    }
    return clean
  },
  reset() {
    try {
      storage()?.removeItem(SETTINGS_KEY)
    } catch {
      /* ignorar */
    }
    return defaultSettings()
  },
}
