import { defineConfig } from '@playwright/test'

// Pruebas de navegador. Chromium headless usa el backend WebGL2 por software (SwiftShader):
// es lento, por eso los tiempos de espera son generosos.
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4180',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4180 --strictPort',
    url: 'http://localhost:4180',
    timeout: 180_000,
    reuseExistingServer: true,
  },
})
