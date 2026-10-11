/** Máquina de estados de la aplicación (no del skater). Ver docs/ARCHITECTURE.md §5.2 */
export const APP_STATES = Object.freeze({
  BOOT: 'BOOT',
  LOADING: 'LOADING',
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  REPLAY: 'REPLAY',
  EDITOR: 'EDITOR',
  ERROR: 'ERROR',
})

const S = APP_STATES
const TRANSITIONS = {
  [S.BOOT]: [S.LOADING, S.ERROR, S.MENU],
  [S.LOADING]: [S.MENU, S.PLAYING, S.EDITOR, S.ERROR],
  [S.MENU]: [S.LOADING, S.PLAYING, S.EDITOR, S.ERROR],
  [S.PLAYING]: [S.PAUSED, S.REPLAY, S.MENU, S.LOADING, S.EDITOR, S.ERROR],
  [S.PAUSED]: [S.PLAYING, S.MENU, S.REPLAY, S.LOADING, S.EDITOR, S.ERROR],
  [S.REPLAY]: [S.PLAYING, S.PAUSED, S.MENU, S.ERROR],
  [S.EDITOR]: [S.MENU, S.LOADING, S.PLAYING, S.ERROR],
  [S.ERROR]: [S.MENU, S.BOOT],
}

export class GameState {
  /** @param {import('./EventBus.js').EventBus} bus */
  constructor(bus) {
    this.bus = bus
    this.current = S.BOOT
    this.previous = null
  }

  is(state) {
    return this.current === state
  }

  canTransition(to) {
    return to === this.current || (TRANSITIONS[this.current] || []).includes(to)
  }

  /** @returns {boolean} true si la transición se aplicó */
  set(to) {
    if (!(to in S)) {
      console.warn(`[GameState] estado desconocido: ${to}`)
      return false
    }
    if (to === this.current) return true
    if (!this.canTransition(to)) {
      console.warn(`[GameState] transición inválida ${this.current} → ${to}`)
      return false
    }
    const from = this.current
    this.previous = from
    this.current = to
    this.bus?.emit('game:state', { from, to })
    return true
  }
}
