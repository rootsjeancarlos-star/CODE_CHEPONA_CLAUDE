import { test, expect } from '@playwright/test'

// Avisos esperados del entorno headless (sin GPU) que no son errores del juego.
const IGNORED = [/WebGPU is not available/i, /WebGPU is experimental/i, /Failed to create WebGPU Context Provider/i, /GPU stall due to ReadPixels/i, /GL Driver Message/i, /Automatic fallback to software WebGL/i]

function collectErrors(page) {
  const errors = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (IGNORED.some((r) => r.test(t))) return
    errors.push(`console.error: ${t}`)
  })
  return errors
}

const game = (page, fn) => page.evaluate(fn)

test('arranca, juega, salta, aterriza, reinicia y pausa sin errores', async ({ page }) => {
  const errors = collectErrors(page)
  await page.goto('/?autoplay=1&test=1')
  await expect.poll(() => game(page, () => window.__STREETFLOW__?.state?.current), { timeout: 120_000 }).toBe('PLAYING')

  const backend = await game(page, () => window.__STREETFLOW__.rendererManager.backendName)
  expect(['WebGPU', 'WebGL2']).toContain(backend)

  // Empujar con W
  await page.keyboard.down('KeyW')
  await page.waitForTimeout(1500)
  await page.keyboard.up('KeyW')
  await expect.poll(() => game(page, () => window.__STREETFLOW__.player.getTelemetry().speed), { timeout: 20_000 }).toBeGreaterThan(0.5)

  // Ollie: mantener y soltar ESPACIO
  await page.keyboard.down('Space')
  await page.waitForTimeout(350)
  await page.keyboard.up('Space')
  await expect.poll(() => game(page, () => window.__STREETFLOW__.player.getTelemetry().grounded), { timeout: 10_000 }).toBe(false)
  await expect.poll(() => game(page, () => window.__STREETFLOW__.player.getTelemetry().grounded), { timeout: 20_000 }).toBe(true)

  // Reinicio con R
  await page.keyboard.press('KeyR')
  await page.waitForTimeout(800)

  // Pausa y reanudación
  await page.keyboard.press('Escape')
  await expect.poll(() => game(page, () => window.__STREETFLOW__.state.current)).toBe('PAUSED')
  await game(page, () => window.__STREETFLOW__.actions.resume())
  await expect.poll(() => game(page, () => window.__STREETFLOW__.state.current)).toBe('PLAYING')

  expect(errors, errors.join('\n')).toEqual([])
})
