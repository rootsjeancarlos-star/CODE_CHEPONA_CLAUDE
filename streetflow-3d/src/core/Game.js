import * as THREE from 'three/webgpu'
import { EventBus } from './EventBus.js'
import { GameLoop } from './GameLoop.js'
import { GameState, APP_STATES as S } from './GameState.js'
import { DEBUG, PHYSICS } from './Config.js'
import { DebugSystem } from './DebugSystem.js'

import { RendererManager, GraphicsUnavailableError } from '../graphics/RendererManager.js'
import { SceneManager } from '../graphics/SceneManager.js'
import { LightingSystem } from '../graphics/LightingSystem.js'
import { MaterialLibrary } from '../graphics/MaterialLibrary.js'
import { GraphicsSettings } from '../graphics/GraphicsSettings.js'

import { PhysicsWorld } from '../physics/PhysicsWorld.js'

import { WorldManager } from '../world/WorldManager.js'
import { SpotRegistry } from '../world/SpotRegistry.js'

import { InputManager } from '../input/InputManager.js'
import { AudioManager } from '../audio/AudioManager.js'
import { CameraController } from '../camera/CameraController.js'

import { Skateboard } from '../skateboard/Skateboard.js'
import { SkaterCharacter } from '../player/SkaterCharacter.js'
import { CharacterAnimator } from '../player/CharacterAnimator.js'
import { PlayerController } from '../player/PlayerController.js'

import { TrickSystem } from '../gameplay/TrickSystem.js'
import { GrindSystem } from '../gameplay/GrindSystem.js'
import { BalanceSystem } from '../gameplay/BalanceSystem.js'
import { LandingSystem } from '../gameplay/LandingSystem.js'
import { ComboSystem } from '../gameplay/ComboSystem.js'
import { ChallengeManager } from '../gameplay/ChallengeManager.js'
import { RespawnSystem } from '../gameplay/RespawnSystem.js'

import { ReplayRecorder } from '../replay/ReplayRecorder.js'
import { ReplayPlayer } from '../replay/ReplayPlayer.js'
import { ParkEditor } from '../editor/ParkEditor.js'

import { UIManager } from '../ui/UIManager.js'
import { SettingsStorage } from '../persistence/SettingsStorage.js'
import { SaveManager } from '../persistence/SaveManager.js'

export const CHARACTER_URL = 'assets/characters/skater.glb'

const MODE_TO_LEVEL = {
  skatepark: 'skatepark',
  freeSkate: 'skatepark',
  challenges: 'skatepark',
  downtown: 'downtown',
}

/**
 * Orquestador del juego: crea los sistemas, gestiona los estados de la aplicación y
 * ejecuta el bucle (paso fijo de física + render interpolado). Ver docs/ARCHITECTURE.md §4.
 */
export class Game {
  /**
   * @param {{ canvas: HTMLCanvasElement, uiRoot: HTMLElement }} o
   */
  constructor({ canvas, uiRoot }) {
    this.canvas = canvas
    this.uiRoot = uiRoot
    this.mode = 'skatepark'
    this.ready = false
    this._tmpPos = new THREE.Vector3()
    this._tmpQuat = new THREE.Quaternion()
    this._unsubs = []
    /** Acciones invocables desde la UI (menús, HUD, editor). */
    this.actions = {
      play: (mode) => this.play(mode),
      resume: () => this.resume(),
      pause: () => this.pause(),
      restart: () => this.restart(),
      quitToMenu: () => this.quitToMenu(),
      openReplay: () => this.openReplay(),
      closeReplay: () => this.closeReplay(),
      openEditor: () => this.openEditor(),
      closeEditor: () => this.closeEditor(),
      testPark: (descriptor) => this.testPark(descriptor),
      applySettings: (settings) => this.applySettings(settings),
      applyCustomization: (c) => this.applyCustomization(c),
      setPhysicsMode: (m) => this.applySettings({ ...this.settings, gameplay: { ...this.settings.gameplay, physicsMode: m } }),
      toggleFullscreen: () => this.toggleFullscreen(),
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Arranque
  // ---------------------------------------------------------------------------------------------
  async boot() {
    this.bus = new EventBus()
    this.state = new GameState(this.bus)
    this.settings = SettingsStorage.load()
    if (DEBUG.quality) this.settings.graphics.preset = DEBUG.quality
    if (DEBUG.mode) this.settings.gameplay.physicsMode = DEBUG.mode

    this.ui = new UIManager({ root: this.uiRoot, bus: this.bus, game: this })
    this.state.set(S.LOADING)
    this.ui.loading.show()

    try {
      await this._initSystems()
    } catch (err) {
      console.error('[Game] fallo de arranque', err)
      this.state.set(S.ERROR)
      const msg =
        err instanceof GraphicsUnavailableError
          ? err.message
          : 'No se pudo iniciar STREETFLOW 3D. Recarga la página; si el problema persiste, prueba otro navegador moderno (Chrome, Edge o Firefox).'
      this.ui.showFatalError(msg, err)
      return
    }

    this.ready = true
    this.state.set(S.MENU)
    this.ui.loading.hide()
    this.ui.showScreen('main')
    this.bus.emit('game:ready', {})

    if (DEBUG.autoplay) this.play(DEBUG.level === 'downtown' ? 'downtown' : 'skatepark')
  }

  _progress(phase, fraction, label) {
    this.bus.emit('loading:progress', { phase, loaded: fraction, total: 1, label })
    this.ui.loading.setProgress(phase, fraction, label)
  }

  async _initSystems() {
    const bus = this.bus
    const s = this.settings

    // 1) Gráficos
    this._progress('renderer', 0, 'Inicializando gráficos')
    this.rendererManager = new RendererManager(this.canvas, { backend: DEBUG.backend, bus })
    await this.rendererManager.init()
    this.sceneManager = new SceneManager(this.rendererManager)
    this.debug = new DebugSystem(this.uiRoot, { enabled: DEBUG.debug || !!s.graphics.showFps })
    this.debug.addSource('render', () => this.rendererManager.getStats())
    this.debug.addSource('escena', () => this.sceneManager.countObjects())
    this._progress('renderer', 1, `Gráficos listos (${this.rendererManager.backendName})`)

    // 2) Física (WebAssembly)
    this._progress('physics', 0, 'Cargando motor de física')
    this.physics = await PhysicsWorld.create({ bus })
    this._progress('physics', 1, 'Física lista')

    // 3) Guardado
    this.save = new SaveManager({ bus })
    await this.save.init()

    // 4) Materiales, iluminación y ajustes gráficos
    this.materials = new MaterialLibrary({ rendererManager: this.rendererManager, quality: s.graphics.preset })
    await this.materials.init((f, label) => this._progress('materials', f, label || 'Generando materiales'))
    this.lighting = new LightingSystem({ sceneManager: this.sceneManager, rendererManager: this.rendererManager, bus })
    await this.lighting.init()
    this.graphics = new GraphicsSettings({
      rendererManager: this.rendererManager,
      sceneManager: this.sceneManager,
      lighting: this.lighting,
      materials: this.materials,
      bus,
    })
    this.graphics.apply(s.graphics)

    // 5) Mundo
    this.spots = new SpotRegistry()
    this.world = new WorldManager({
      sceneManager: this.sceneManager,
      rendererManager: this.rendererManager,
      physics: this.physics,
      materials: this.materials,
      spots: this.spots,
      lighting: this.lighting,
      bus,
    })

    // 6) Entrada, audio y cámara
    this.input = new InputManager({ canvas: this.canvas, bus, settings: s.controls })
    this.audio = new AudioManager({ bus, settings: s.audio })
    this.cameraController = new CameraController(this.sceneManager.camera, {
      physics: this.physics,
      input: this.input,
      bus,
      settings: s,
    })

    // 7) Tabla y personaje
    const custom = this.save.data.customization
    this.board = new Skateboard({
      physics: this.physics,
      bus,
      sceneManager: this.sceneManager,
      materials: this.materials,
      customization: custom.board,
    })
    this._progress('character', 0, 'Cargando skater')
    this.character = await SkaterCharacter.load(CHARACTER_URL, {
      customization: custom.character,
      materials: this.materials,
      onProgress: (f) => this._progress('character', f, 'Cargando skater'),
    })
    this.sceneManager.actors.add(this.character.object3d)
    this.animator = new CharacterAnimator(this.character, { bus })
    this._progress('character', 1, 'Skater listo')

    // 8) Jugabilidad
    this.balance = new BalanceSystem()
    this.landing = new LandingSystem({ bus })
    this.grind = new GrindSystem({ bus, spots: this.spots, board: this.board, balance: this.balance })
    this.tricks = new TrickSystem({ bus, board: this.board })
    this.combo = new ComboSystem({ bus })
    this.challenges = new ChallengeManager({ bus, save: this.save, spots: this.spots })
    this.respawn = new RespawnSystem({ bus, world: this.world, save: this.save })
    this.player = new PlayerController({
      bus,
      physics: this.physics,
      board: this.board,
      tricks: this.tricks,
      grind: this.grind,
      balance: this.balance,
      landing: this.landing,
      respawn: this.respawn,
      settings: s.gameplay,
      stance: custom.character.stance || s.gameplay.stance,
    })
    this.debug.addSource('skater', () => this.player.getDebugInfo?.())

    // 9) Repeticiones y editor
    this.replayRecorder = new ReplayRecorder({ bus })
    this.replayPlayer = new ReplayPlayer({ game: this })
    this.editor = new ParkEditor({ game: this })

    // 10) Nivel de fondo del menú
    this._progress('world', 0, 'Construyendo skatepark')
    await this.world.loadLevel('skatepark', { onProgress: (f, label) => this._progress('world', f, label || 'Construyendo skatepark') })
    this.lighting.setLampPositions(this.world.getLampPositions?.() || [])
    this._spawnPlayer()
    this.cameraController.setMode('menu')
    this._progress('world', 1, 'Skatepark listo')

    // 11) Bucle
    this.loop = new GameLoop({
      fixedDt: PHYSICS.fixedDt,
      maxStepsPerFrame: PHYSICS.maxStepsPerFrame,
      maxFrameDelta: PHYSICS.maxFrameDelta,
      fixedUpdate: (dt) => this.fixedUpdate(dt),
      render: (alpha, frameDt, time) => this.render(alpha, frameDt, time),
    })
    this.loop.setSimulationPaused(true)
    this.rendererManager.setAnimationLoop((time) => this.loop.frame(time))

    this._bindGlobalEvents()
    this.applySettings(this.settings, { silent: true })
  }

  _bindGlobalEvents() {
    const bus = this.bus
    // Acciones de interfaz que deben funcionar aunque la simulación esté en pausa.
    this._unsubs.push(
      bus.on('input:action', ({ action }) => {
        if (!this.ready) return
        switch (action) {
          case 'pause':
            if (this.state.is(S.PLAYING)) this.pause()
            else if (this.state.is(S.PAUSED) && this.ui.currentScreen === 'pause') this.resume()
            else if (this.state.is(S.REPLAY)) this.closeReplay()
            else if (this.state.is(S.EDITOR)) this.editor.handleEscape?.()
            else this.ui.back?.()
            break
          case 'camera':
            if (this.state.is(S.PLAYING)) this.cameraController.cycleMode()
            else if (this.state.is(S.REPLAY)) this.replayPlayer.cycleCamera?.()
            break
          case 'replay':
            if (this.state.is(S.PLAYING) || this.state.is(S.PAUSED)) this.openReplay()
            else if (this.state.is(S.REPLAY)) this.closeReplay()
            break
          case 'fullscreen':
            this.toggleFullscreen()
            break
        }
      }),
      bus.on('graphics:deviceLost', () => {
        this.state.set(S.ERROR)
        this.ui.showFatalError('Se perdió el dispositivo gráfico (GPU). Recarga la página para continuar.', null)
      }),
    )

    this._onVisibility = () => {
      if (document.hidden) {
        if (this.state.is(S.PLAYING)) this.pause()
        this.input.releaseAll()
      } else {
        this.loop.resetTiming()
      }
    }
    document.addEventListener('visibilitychange', this._onVisibility)
    this._onBlur = () => this.input.releaseAll()
    window.addEventListener('blur', this._onBlur)

    // Pointer Lock solo tras una acción explícita: clic en el canvas durante el juego.
    this._onCanvasClick = () => {
      this.audio.unlock()
      if (this.state.is(S.PLAYING)) this.input.requestPointerLock()
    }
    this.canvas.addEventListener('click', this._onCanvasClick)
    // Primer gesto del usuario en cualquier parte desbloquea el audio.
    const unlock = () => {
      this.audio.unlock()
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
  }

  _spawnPlayer() {
    const spawn = this.world.getSpawn()
    this.player.spawn(spawn)
    this.combo.reset()
  }

  // ---------------------------------------------------------------------------------------------
  // Bucle
  // ---------------------------------------------------------------------------------------------
  fixedUpdate(dt) {
    const t0 = performance.now()
    const intent = this.input.consumeIntent(dt)
    this.player.fixedUpdate(dt, intent)
    this.physics.step(dt)
    this.player.postPhysics(dt)
    const tel = this.player.getTelemetry()
    const pstate = this.player.state
    this.tricks.fixedUpdate(dt, tel, pstate)
    this.combo.fixedUpdate(dt, tel, pstate)
    this.challenges.fixedUpdate(dt, tel, pstate)
    this.respawn.fixedUpdate(dt, tel, intent, this.player)
    this.replayRecorder.record(dt, this)
    this.debug.counters.physicsMs = performance.now() - t0
  }

  render(alpha, frameDt, time) {
    this.input.update(frameDt)
    const st = this.state.current
    const camera = this.sceneManager.camera

    if (st === S.REPLAY) {
      this.replayPlayer.update(frameDt)
    } else if (st === S.EDITOR) {
      this.editor.update(frameDt)
    } else {
      // Visual del skater interpolado entre pasos físicos
      this.board.updateVisual(frameDt, alpha)
      const ctx = this.player.getAnimationContext(alpha)
      this.animator.update(frameDt, ctx)
      this.cameraController.update(frameDt, this.player.getCameraTarget(alpha))
    }

    this.world.update(frameDt, camera.position)
    this.lighting.update(frameDt, st === S.MENU ? camera.position : this.player.getCameraTarget(alpha).position)
    const tel = this.player.getTelemetry()
    this.audio.update(frameDt, tel, camera, st)
    this.ui.update(frameDt, {
      state: st,
      telemetry: tel,
      playerState: this.player.state,
      combo: this.combo.getState(),
      challenges: this.challenges,
      settings: this.settings,
    })

    this.rendererManager.render(this.sceneManager.scene, camera)

    this.debug.counters.physicsSteps = this.loop.stats.stepsLastFrame
    this.debug.counters.droppedTime = this.loop.stats.droppedTime
    this.debug.frame(frameDt, time)
  }

  // ---------------------------------------------------------------------------------------------
  // Acciones de juego
  // ---------------------------------------------------------------------------------------------
  async play(mode = 'skatepark') {
    if (!this.ready) return
    // Solicitar el bloqueo del puntero dentro del gesto del usuario (antes de cualquier await).
    this.input.requestPointerLock()
    this.audio.unlock()
    this.mode = mode
    this.bus.emit('game:modeChanged', { mode })
    const levelId = MODE_TO_LEVEL[mode] || 'skatepark'
    if (this.world.current?.id !== levelId) {
      this.state.set(S.LOADING)
      this.ui.loading.show()
      try {
        await this.world.loadLevel(levelId, { onProgress: (f, label) => this._progress('world', f, label || 'Cargando nivel') })
      } catch (err) {
        console.error('[Game] no se pudo cargar el nivel', err)
        this.bus.emit('ui:notify', { text: 'No se pudo cargar el nivel.', kind: 'error', duration: 4 })
        this.ui.loading.hide()
        this.state.set(S.MENU)
        this.ui.showScreen('main')
        return
      }
      this.ui.loading.hide()
      this.lighting.setLampPositions(this.world.getLampPositions?.() || [])
    }
    this._startPlaying()
  }

  _startPlaying() {
    this._spawnPlayer()
    this.player.setMode(this.settings.gameplay.physicsMode)
    this.cameraController.setMode('follow')
    this.cameraController.snap?.(this.player.getCameraTarget(1))
    this.replayRecorder.clear()
    this.state.set(S.PLAYING)
    this.ui.showScreen(null)
    this.loop.resetTiming()
    this.loop.setSimulationPaused(false)
    this.audio.setScene?.(this.world.current?.id === 'downtown' ? 'city' : 'park')
    if (this.mode === 'challenges') this.bus.emit('ui:notify', { text: 'Modo desafíos: revisa tus objetivos en el HUD', kind: 'info', duration: 4 })
  }

  pause() {
    if (!this.state.is(S.PLAYING)) return
    this.state.set(S.PAUSED)
    this.loop.setSimulationPaused(true)
    this.input.exitPointerLock()
    this.input.releaseAll()
    this.ui.showScreen('pause')
  }

  resume() {
    if (!this.state.is(S.PAUSED)) return
    this.state.set(S.PLAYING)
    this.ui.showScreen(null)
    this.loop.resetTiming()
    this.loop.setSimulationPaused(false)
    this.input.requestPointerLock()
  }

  restart() {
    if (!this.state.is(S.PAUSED) && !this.state.is(S.PLAYING)) return
    this._spawnPlayer()
    this.replayRecorder.clear()
    if (this.state.is(S.PAUSED)) this.resume()
  }

  quitToMenu() {
    if (this.state.is(S.REPLAY)) this.replayPlayer.stop()
    if (this.state.is(S.EDITOR)) this.editor.close()
    this.loop.setSimulationPaused(true)
    this.input.exitPointerLock()
    this.input.releaseAll()
    this.state.set(S.MENU)
    this.cameraController.setMode('menu')
    this.ui.showScreen('main')
    this.audio.setScene?.('menu')
  }

  openReplay() {
    if (!this.replayRecorder.hasData()) {
      this.bus.emit('ui:notify', { text: 'Aún no hay nada que repetir. ¡Patina un poco!', kind: 'info', duration: 3 })
      return
    }
    this.loop.setSimulationPaused(true)
    this.input.exitPointerLock()
    this.state.set(S.REPLAY)
    this.ui.showScreen('replay')
    this.replayPlayer.start()
  }

  closeReplay() {
    if (!this.state.is(S.REPLAY)) return
    this.replayPlayer.stop()
    this.state.set(S.PAUSED)
    this.ui.showScreen('pause')
  }

  openEditor() {
    this.loop.setSimulationPaused(true)
    this.input.exitPointerLock()
    this.state.set(S.EDITOR)
    this.ui.showScreen('editor')
    this.editor.open()
  }

  closeEditor() {
    this.editor.close()
    this.state.set(S.MENU)
    this.cameraController.setMode('menu')
    this.ui.showScreen('main')
  }

  /** Carga un ParkDescriptor del editor y empieza a patinar en él. */
  async testPark(descriptor) {
    this.editor.close()
    this.state.set(S.LOADING)
    this.ui.loading.show()
    try {
      await this.world.loadLevel(descriptor, { onProgress: (f, label) => this._progress('world', f, label || 'Construyendo parque') })
    } catch (err) {
      console.error(err)
      this.ui.loading.hide()
      this.bus.emit('ui:notify', { text: 'El parque no es válido.', kind: 'error', duration: 4 })
      this.state.set(S.EDITOR)
      this.ui.showScreen('editor')
      this.editor.open()
      return
    }
    this.ui.loading.hide()
    this.mode = 'editorTest'
    this._startPlaying()
  }

  applySettings(settings, { silent = false } = {}) {
    this.settings = SettingsStorage.save(settings)
    this.graphics.apply(this.settings.graphics)
    this.audio.applySettings(this.settings.audio)
    this.input.applySettings(this.settings.controls)
    this.cameraController.applySettings?.(this.settings)
    this.player.setMode(this.settings.gameplay.physicsMode)
    this.debug.toggle(DEBUG.debug || !!this.settings.graphics.showFps)
    if (!silent) this.bus.emit('settings:changed', { path: '*', value: null, settings: this.settings })
  }

  applyCustomization(c) {
    this.save.update((d) => {
      d.customization = { character: { ...d.customization.character, ...(c.character || {}) }, board: { ...d.customization.board, ...(c.board || {}) } }
    })
    const cur = this.save.data.customization
    this.character.applyCustomization(cur.character)
    this.board.applyCustomization(cur.board)
    if (cur.character.stance) this.player.setStance?.(cur.character.stance)
  }

  toggleFullscreen() {
    try {
      if (document.fullscreenElement) document.exitFullscreen()
      else document.documentElement.requestFullscreen?.()
    } catch (err) {
      console.warn('Pantalla completa no disponible', err)
    }
  }
}
