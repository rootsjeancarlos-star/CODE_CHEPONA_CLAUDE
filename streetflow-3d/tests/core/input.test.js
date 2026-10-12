import { describe, it, expect } from 'vitest'
import { InputManager, combineArrows } from '../../src/input/InputManager.js'
import { radialDeadzone } from '../../src/input/GamepadInput.js'
import { GestureRecognizer } from '../../src/input/GestureRecognizer.js'
import { defaultBindings, rebind, sanitizeBindings, findConflicts } from '../../src/input/InputBindings.js'

const key = (im, code, down = true) => (down ? im.keyboard._onDown({ code, preventDefault() {} }) : im.keyboard._onUp({ code }))

function make() {
  const events = []
  const bus = { emit: (type, payload) => events.push({ type, payload }) }
  const im = new InputManager({ canvas: null, bus, settings: {} })
  return { im, events }
}

describe('InputManager', () => {
  it('los flancos se entregan una sola vez aunque haya varios pasos por fotograma', () => {
    const { im } = make()
    key(im, 'KeyW')
    im.update(1 / 60)
    const a = im.consumeIntent()
    expect(a.pushPressed).toBe(true)
    expect(a.throttle).toBe(1)
    const b = im.consumeIntent()
    expect(b.pushPressed).toBe(false)
    expect(b.throttle).toBe(1)
  })

  it('ESPACIO: agacharse mientras se mantiene y pop al soltar; con SHIFT es nollie', () => {
    const { im } = make()
    key(im, 'Space')
    im.update(1 / 60)
    expect(im.consumeIntent().crouch).toBe(true)
    key(im, 'ShiftLeft')
    key(im, 'Space', false)
    im.update(1 / 60)
    const i = im.consumeIntent()
    expect(i.popPressed).toBe(true)
    expect(i.nollie).toBe(true)
    expect(i.crouch).toBe(false)
  })

  it('un toque rapidísimo de ESPACIO (bajar y subir en el mismo fotograma) también hace ollie', () => {
    const { im } = make()
    key(im, 'Space')
    key(im, 'Space', false)
    im.update(1 / 60)
    expect(im.consumeIntent().popPressed).toBe(true)
  })

  it('dos flechas casi simultáneas producen una diagonal; una sola tras la ventana, un flick simple', () => {
    const { im } = make()
    key(im, 'ArrowDown')
    im.update(0.02)
    key(im, 'ArrowLeft')
    im.update(0.02)
    expect(im.consumeIntent().flick).toBe('DL')
    key(im, 'ArrowDown', false)
    key(im, 'ArrowLeft', false)
    key(im, 'ArrowRight')
    im.update(0.03)
    expect(im.consumeIntent().flick).toBe(null)
    im.update(0.05)
    expect(im.consumeIntent().flick).toBe('R')
  })

  it('una flecha mantenida al soltar ESPACIO llega como flick en el mismo paso que el pop', () => {
    const { im } = make()
    key(im, 'Space')
    im.update(1 / 60)
    im.consumeIntent()
    key(im, 'ArrowLeft')
    im.update(0.2)
    im.consumeIntent()
    key(im, 'Space', false)
    im.update(1 / 60)
    const i = im.consumeIntent()
    expect(i.popPressed).toBe(true)
    expect(i.flick).toBe('L')
  })

  it('pausa, cámara y repetición se emiten al instante como input:action', () => {
    const { im, events } = make()
    key(im, 'Escape')
    key(im, 'KeyC')
    key(im, 'KeyV')
    expect(events.filter((e) => e.type === 'input:action').map((e) => e.payload.action)).toEqual(['pause', 'camera', 'replay'])
  })

  it('releaseAll suelta todo (pérdida de foco)', () => {
    const { im } = make()
    key(im, 'KeyW')
    key(im, 'KeyA')
    im.releaseAll()
    im.update(1 / 60)
    const i = im.consumeIntent()
    expect(i.throttle).toBe(0)
    expect(i.steer).toBe(0)
  })
})

describe('Utilidades de entrada', () => {
  it('combineArrows', () => {
    expect(combineArrows(new Set(['D', 'L']))).toBe('DL')
    expect(combineArrows(new Set(['U']))).toBe('U')
    expect(combineArrows(new Set())).toBe(null)
  })
  it('zona muerta radial con reescalado', () => {
    expect(radialDeadzone(0.1, 0.05, 0.15)).toEqual({ x: 0, y: 0 })
    const o = radialDeadzone(1, 0, 0.15)
    expect(o.x).toBeCloseTo(1, 5)
    const h = radialDeadzone(0.575, 0, 0.15, undefined, 1)
    expect(h.x).toBeCloseTo(0.5, 2)
  })
  it('bindings: reasignar con intercambio y datos dañados → valores por defecto', () => {
    const b = defaultBindings()
    const r = rebind(b, 'push', 'KeyS')
    expect(r.bindings?.push?.[0] ?? b.push[0]).toBeDefined()
    expect(sanitizeBindings({ push: 'tecla rota!', crouch: [123] }).bindings.push).toEqual(defaultBindings().push)
    expect(r.ok).toBe(true)
    expect(r.bindings.push[0]).toBe('KeyS')
    expect(r.bindings.brake[0]).toBe('KeyW')
    expect(findConflicts(defaultBindings(), 'KeyW').length).toBeGreaterThan(0)
  })
  it('gesto de stick: abajo y arriba-izquierda rápido = pop + flick UL; movimiento lento no hace pop', () => {
    const g = new GestureRecognizer()
    let popped = null
    const feed = (x, y, n = 3) => {
      for (let k = 0; k < n; k++) {
        const o = g.update(1 / 60, x, y)
        if (o.pop) popped = { flick: o.flick, gesture: o.gesture }
      }
    }
    feed(0, 1, 8)
    feed(-0.4, 0, 1)
    feed(-0.7, -0.7, 4)
    expect(popped).not.toBeNull()
    expect(popped.flick).toBe('UL')
    const g2 = new GestureRecognizer()
    let p2 = false
    for (let k = 0; k <= 60; k++) {
      const y = 1 - (2 * k) / 60
      if (g2.update(1 / 60, 0, y).pop) p2 = true
    }
    expect(p2).toBe(false)
  })
})
