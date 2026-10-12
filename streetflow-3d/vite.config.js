import { defineConfig } from 'vite'

// Rutas relativas para que el build funcione desde cualquier subruta (Netlify, GitHub Pages, file server).
export default defineConfig({
  base: './',
  server: { port: 5173, host: true },
  preview: { port: 4173, host: true },
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    sourcemap: false,
    chunkSizeWarningLimit: 4096,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    exclude: ['tests/browser/**'],
    testTimeout: 30000,
  },
})
