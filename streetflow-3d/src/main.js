import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow-condensed/600.css'
import '@fontsource/barlow-condensed/800.css'
import './styles/main.css'
import './styles/menus.css'
import './styles/hud.css'
import { Game } from './core/Game.js'

const canvas = document.getElementById('sf-canvas')
const uiRoot = document.getElementById('ui-root')

function showBootError(message) {
  const box = document.createElement('div')
  box.className = 'sf-fatal'
  box.setAttribute('role', 'alert')
  box.innerHTML = '<h1>STREETFLOW 3D</h1><p></p><button type="button">Recargar</button>'
  box.querySelector('p').textContent = message
  box.querySelector('button').addEventListener('click', () => location.reload())
  uiRoot.appendChild(box)
}

window.addEventListener('unhandledrejection', (e) => {
  console.error('[STREETFLOW] promesa rechazada sin capturar:', e.reason)
})

const game = new Game({ canvas, uiRoot })
// Gancho de pruebas/depuración: solo expone la instancia, no altera el juego.
window.__STREETFLOW__ = game
game.boot().catch((err) => {
  console.error(err)
  showBootError('Error inesperado al iniciar el juego. Recarga la página.')
})
