# STREETFLOW 3D — Arquitectura técnica (contrato del motor)

Este documento es el **contrato** entre los módulos. Cualquier cambio de interfaz debe reflejarse aquí.
Versión del contrato: **1** · Stack: Vite 8 · Three.js 0.186.1 (`three/webgpu`) · Rapier 0.21 (`@dimforge/rapier3d-compat`) · JavaScript ES2022 módulos.

---

## 1. Principios

1. **La física manda, la animación obedece.** El estado del skater sale de la simulación Rapier; la animación y los efectos solo lo representan.
2. **Timestep fijo** de 1/60 s con acumulador; el render es independiente e interpola.
3. **Datos antes que código**: trucos, superficies, parques y desafíos son datos validables (JSON-compatibles).
4. **Un solo bucle de render** (`renderer.setAnimationLoop`), una sola escena activa.
5. **Sin asignaciones por fotograma** en rutas calientes: reutilizar `Vector3`/`Quaternion` temporales de módulo.
6. **Todo recurso creado se puede destruir** (`dispose()`): geometrías, materiales, texturas, colliders.
7. **Fallar con elegancia**: si falta un recurso (GLB, textura) se usa un sustituto y se registra un aviso; si no hay WebGPU ni WebGL2 se muestra un mensaje comprensible.
8. **Originalidad**: ningún recurso, logo, mapa o código propietario de otros juegos o marcas.

## 2. Unidades y ejes

| Magnitud | Unidad |
|---|---|
| Distancia | metro (m) |
| Tiempo | segundo (s) |
| Masa | kilogramo (kg) |
| Ángulo (interno) | radián |
| Velocidad | m/s (el HUD muestra km/h) |

**Mundo**: sistema diestro de Three.js, **+Y arriba**, suelo principal en `y = 0`. Gravedad `(0, -9.81, 0)`.

**Ejes locales de la tabla / cuerpo del skater** (origen = centro del deck, a la altura de la **cara superior de la lija**, donde apoyan los pies):

- `+Z` = **nariz (nose)**; `-Z` = cola (tail).
- `+Y` = arriba (lado de la lija).
- `+X` = `Y × Z` → lado izquierdo de la tabla mirando hacia la nariz.

**Postura (stance)**:
- **Regular** (pie izquierdo adelante, hacia la nariz): el rider **mira hacia −X**. Lado de puntas (toe side) = −X, lado de talones (heel side) = +X.
- **Goofy** (pie derecho adelante): el rider mira hacia **+X**. Toe side = +X.
- `stanceSign = +1` regular, `−1` goofy.
- **Switch/fakie**: se rueda con la cola por delante (`forwardSpeed < 0` respecto a +Z). `isSwitch` lo marca `SkateboardPhysics` con histéresis.

**Convenciones de rotación de trucos** (definidas para REGULAR; para goofy se multiplica por −1):
- *Roll* de la tabla (eje local Z): **kickflip = −1 vuelta** (el canto de puntas sube primero), **heelflip = +1 vuelta**.
- *Yaw* de la tabla relativo al cuerpo (eje local Y): **backside shove-it = −½ vuelta**, frontside shove-it = +½ vuelta.
- *Yaw* del cuerpo (giros 180/360): **frontside = +yaw**, backside = −yaw.

Un personaje en *bind pose* mira hacia **+Z** con los pies en `y = 0`. Para montarlo sobre la tabla se rota −90° (regular, mira −X) o +90° (goofy) alrededor de Y.

## 3. Estructura de carpetas y propiedad

```
streetflow-3d/
├── index.html · vite.config.js · netlify.toml · package.json
├── assets/references/        Referencias del usuario (NO se publican en dist)
├── public/assets/            Recursos servidos tal cual (GLB, texturas, audio)
├── tools/                    Scripts de build de recursos (Node), prototipos y smoke tests
├── docs/                     Arquitectura, investigación, dirección artística, informes
├── src/
│   ├── main.js               Arranque: crea Game y maneja errores fatales
│   ├── core/                 Game, GameLoop, EventBus, GameState, Config, DebugSystem
│   ├── graphics/             RendererManager, SceneManager, LightingSystem, MaterialLibrary, GraphicsSettings, PostFX, TextureFactory
│   ├── physics/              PhysicsWorld, SkateboardPhysics, WheelContactSolver, SurfacePhysics, CollisionManager, GrindPhysics, WalkingController
│   ├── player/               PlayerController, SkaterCharacter, CharacterAnimator, AnimationLibrary, CharacterIK, CharacterCustomization
│   ├── skateboard/           Skateboard, SkateboardVisual, SkateboardSetup, BoardCustomization
│   ├── gameplay/             TrickSystem, TrickRecognizer, TrickDatabase, GrindSystem, BalanceSystem, LandingSystem, ComboSystem, ChallengeManager, RespawnSystem
│   ├── input/                InputManager, KeyboardInput, MouseInput, GamepadInput, InputBindings
│   ├── camera/               CameraController, ReplayCamera
│   ├── world/                WorldManager, SkateparkGenerator, RampBuilder, BowlBuilder, RailBuilder, LedgeBuilder, SpotRegistry, EnvironmentProps, CityGenerator, ChunkStreamer, GeometryUtils
│   ├── audio/                AudioManager, SurfaceAudio, SoundSynth, MusicGenerator
│   ├── replay/               ReplayRecorder, ReplayPlayer
│   ├── editor/               ParkEditor, EditorUI, ParkValidator
│   ├── ui/                   MainMenu, HUD, PauseMenu, SettingsMenu, LoadingScreen, CustomizationMenu, ChallengesMenu, UIManager
│   ├── persistence/          SaveManager, SettingsStorage
│   ├── data/                 tricks.js, surfaces.js, skateparkPresets.js, challenges.js, levels.js
│   └── styles/               main.css, menus.css, hud.css
└── tests/                    Vitest (lógica, física en Node) + Playwright (navegador)
```

Los *work packages* (WP) del plan de implementación son dueños exclusivos de sus archivos. Si un WP necesita un cambio en un archivo ajeno, lo documenta en su informe en vez de editarlo (salvo el integrador).

## 4. Flujo de ejecución

```
TECLADO / RATÓN / GAMEPAD
        │  (eventos DOM, Gamepad API sondeada cada frame)
        ▼
  InputManager ──► InputIntent (normalizado, independiente del dispositivo)
        ▼                (consumido una vez por paso fijo; los flancos no se duplican)
  PlayerController (FSM) ──► TrickSystem (peticiones de truco)
        ▼
  SkateboardPhysics (fuerzas de ruedas, pop, flips, grinds, manuals)
        ▼
  PhysicsWorld.step(1/60)  (Rapier)
        ▼
  PlayerController.postPhysics() → SkaterTelemetry + eventos (EventBus)
        ▼
  TrickRecognizer / Combo / Challenges / Audio / Replay
        ▼  (render, frecuencia variable)
  Interpolación visual → CharacterAnimator (AnimationMixer + capas) → CharacterIK → Cámara → HUD
        ▼
  RendererManager.render() (WebGPU o WebGL2) ──► PANTALLA
```

### 4.1 GameLoop
- `fixedDt = 1/60`, `maxStepsPerFrame = 5`, `maxFrameDelta = 0.25 s`.
- Acumulador: `acc += min(frameDt, maxFrameDelta) * timeScale`; mientras `acc >= fixedDt` y `steps < max`: `fixedUpdate(fixedDt)`. Si se alcanza el máximo, el resto del acumulador se descarta (evita la espiral de la muerte) y se cuenta en `DebugSystem`.
- `alpha = acc / fixedDt` se pasa al render para interpolar.
- La pestaña oculta (`visibilitychange`) pausa la simulación (el juego entra en PAUSED si estaba en PLAYING).
- El render usa `renderer.setAnimationLoop(cb)`; **no** se crea ningún otro bucle `requestAnimationFrame` de render.

### 4.2 Orden de un paso fijo (`Game.fixedUpdate(dt)`)
1. `intent = input.consumeIntent(dt)`
2. `player.fixedUpdate(dt, intent)` — FSM, peticiones de truco, fuerzas antes del paso.
3. `physics.step(dt)` — Rapier + drenado de eventos de colisión.
4. `player.postPhysics(dt)` — lee el estado, detecta aterrizajes/caídas, restricciones de grind, emite eventos.
5. `tricks.fixedUpdate(dt, telemetry)` → reconocimiento, combos.
6. `challenges.fixedUpdate(dt, telemetry)`; `replay.record(...)`.

### 4.3 Orden del render (`Game.render(alpha, frameDt)`)
1. Interpolar la transformación visual del skater entre el estado físico anterior y el actual.
2. `board.updateVisual(frameDt, alpha)` (ruedas giran, trucks pivotan, rotación de flip).
3. `animator.update(frameDt, ctx)` → `ik.solve(ctx)`.
4. `camera.update(frameDt, target)`.
5. `world.update(frameDt, cameraPosition)` (streaming de chunks, LOD).
6. `lighting.update(frameDt, cameraPosition)`; `audio.update(frameDt, telemetry, listener)`; `hud.update(...)`.
7. `renderer.render(scene, camera)` (con post-procesado si el preset lo activa).
8. `debug.endFrame()`.

## 5. Núcleo (`src/core`)

### 5.1 EventBus
```js
bus.on(type, handler) → unsubscribe()
bus.once(type, handler)
bus.off(type, handler)
bus.emit(type, payload)
```
Síncrono. Un handler que lanza no impide a los demás (se registra el error).

**Catálogo de eventos** (payloads mínimos; se pueden añadir campos):

| Evento | Payload | Emisor |
|---|---|---|
| `game:state` | `{ from, to }` | GameState |
| `game:modeChanged` | `{ mode }` | Game |
| `loading:progress` | `{ phase, loaded, total, label }` | Game / cargadores |
| `settings:changed` | `{ path, value, settings }` | SettingsMenu / SettingsStorage |
| `input:device` | `{ device: 'keyboard'\|'gamepad' }` | InputManager |
| `input:action` | `{ action: 'pause'\|'camera'\|'replay'\|'fullscreen' }` (emitido al instante en keydown/botón, funciona con la simulación en pausa) | InputManager |
| `input:gamepadConnected` / `input:gamepadDisconnected` | `{ id, index }` | GamepadInput |
| `skater:push` | `{ foot }` | PlayerController |
| `skater:pop` | `{ nollie, strength, position }` | SkateboardPhysics |
| `skater:airborne` | `{ position, velocity }` | SkateboardPhysics |
| `skater:land` | `{ impact, quality, clean, alignmentError, surface, position }` | LandingSystem |
| `skater:bail` | `{ reason, position, velocity }` | PlayerController |
| `skater:respawn` | `{ position, reason }` | RespawnSystem |
| `skater:stateChanged` | `{ from, to }` | PlayerController |
| `skater:mount` / `skater:dismount` | `{}` | PlayerController |
| `skater:surfaceChanged` | `{ surface }` | SkateboardPhysics |
| `skater:collision` | `{ impulse, normal, surface }` | CollisionManager |
| `trick:requested` | `{ id, input }` | TrickSystem |
| `trick:started` | `{ id, name }` | TrickSystem |
| `trick:completed` | `{ id, name, displayName, score, quality }` | TrickRecognizer |
| `trick:failed` | `{ id, reason }` | TrickRecognizer |
| `grind:start` / `grind:end` | `{ type, spotId, surface, duration?, distance? }` | GrindSystem |
| `manual:start` / `manual:end` | `{ type, duration? }` | PlayerController |
| `combo:update` | `{ tricks, baseScore, multiplier, total }` | ComboSystem |
| `combo:end` | `{ total, landed, tricks }` | ComboSystem |
| `score:changed` | `{ score, delta }` | ComboSystem |
| `challenge:progress` / `challenge:completed` | `{ id, progress, target }` | ChallengeManager |
| `spot:discovered` | `{ id, name }` | ChallengeManager |
| `camera:modeChanged` | `{ mode }` | CameraController |
| `replay:start` / `replay:end` | `{}` | ReplayPlayer |
| `marker:saved` / `marker:loaded` | `{ position }` | RespawnSystem |
| `ui:notify` | `{ text, kind: 'info'\|'success'\|'warn'\|'error', duration }` | cualquiera |
| `graphics:deviceLost` | `{ info }` | RendererManager |

### 5.2 GameState
Estados de aplicación: `BOOT → LOADING → MENU → PLAYING ⇄ PAUSED`, `PLAYING ⇄ REPLAY`, `MENU ⇄ EDITOR`, `ERROR`. Transiciones inválidas se ignoran con aviso. `gameState.is('PLAYING')`.

Modos de juego (`game.mode`): `'skatepark'`, `'downtown'` (mundo abierto), `'challenges'`, `'editorTest'`, `'freeSkate'` (alias de skatepark desde JUGAR).

### 5.3 Config
`src/core/Config.js` exporta constantes congeladas: `PHYSICS` (dt, gravedad, grupos de colisión), `SKATER` (masas, CoM), `CAMERA`, `GAME` (versión), `DEBUG` (flags por query string: `?debug=1`, `?backend=webgl`, `?quality=low`, `?level=downtown`, `?autoplay=1`).

## 6. Entrada (`src/input`)

`InputManager.consumeIntent(dt) → InputIntent`. Se llama **una vez por paso fijo**. Los flancos (`*Pressed`, `*Released`) se acumulan entre pasos y se entregan en el primer paso que los consume.

```js
/** @typedef {Object} InputIntent
 * @property {number} steer        -1..1  (A=-1 izquierda, D=+1 derecha; stick izquierdo X)
 * @property {number} throttle     0..1   (W mantenido)
 * @property {boolean} pushPressed        flanco de W (cada pulsación = una patada si está montado)
 * @property {number} brake        0..1   (S)
 * @property {boolean} crouch             ESPACIO mantenido / stick derecho abajo
 * @property {boolean} popPressed         flanco de soltar ESPACIO tras agacharse (o flick hacia arriba del stick derecho)
 * @property {boolean} nollie             SHIFT mantenido en el momento del pop
 * @property {boolean} modifier           SHIFT
 * @property {?string} flick              dirección de flick en este paso: 'L','R','D','U','DL','DR','UL','UR' o null (flechas o stick derecho)
 * @property {number} spin         -1..1  rotación aérea (A/D en el aire, LB/RB)
 * @property {boolean} grind              E mantenido (intención de grind/slide)
 * @property {boolean} grindPressed       flanco de E
 * @property {number} manual       -1..1  ↑ = +1 (manual), ↓ = -1 (nose manual); en suelo
 * @property {boolean} manualPressed      flanco de ↑/↓ en suelo
 * @property {boolean} qPressed           Q (contextual: revert / cambio de stance)
 * @property {boolean} interactPressed    F (subir/bajar de la tabla)
 * @property {boolean} resetPressed       R
 * @property {boolean} saveMarkerPressed  G
 * @property {boolean} loadMarkerPressed  T
 * @property {boolean} cameraPressed      C
 * @property {boolean} replayPressed      V
 * @property {boolean} pausePressed       ESC / Start
 * @property {{x:number,y:number}} look   delta de cámara (ratón en px escalados / stick derecho)
 * @property {number} zoom                rueda del ratón
 * @property {{lx:number,ly:number,rx:number,ry:number,lt:number,rt:number}} analog  ejes crudos tras dead zone (modo simulación de pies)
 * @property {'keyboard'|'gamepad'} device
 */
```

Bindings por defecto (teclado): W empujar · A/D girar (en el aire: rotar) · S frenar · ESPACIO agacharse/ollie · SHIFT modificador (nollie al soltar ESPACIO con SHIFT) · ←/→/↓/↑ flicks en el aire, manual/nose manual en el suelo · E grind · Q contextual · F subir/bajar · R reiniciar · G guardar marcador · T volver al marcador · C cámara · V repeticiones · ESC pausa. Reasignables y persistidos.

Gamepad (mapeo estándar): stick izq. dirección/rotación · stick der. flick (abajo = agacharse, arriba = ollie, arriba-izq. = kickflip, etc.) o cámara cuando no hay gesto · A empujar · B frenar · X grind · Y manual · LB/RB rotación · LT/RT modo simulación de pies · Start pausa · Select repetición. Dead zone radial configurable (por defecto 0.15).

## 7. Física (`src/physics`)

### 7.1 PhysicsWorld
```js
const physics = await PhysicsWorld.create({ gravity })
physics.RAPIER, physics.world
physics.step(dt)                                  // un paso fijo + drenado de eventos
physics.addStaticTrimesh(positions, indices, { surface, friction?, restitution?, groups?, userData?, position?, quaternion? }) → collider
physics.addStaticBox(halfExtents, position, quaternion, opts) → collider
physics.addStaticCylinder(halfHeight, radius, position, quaternion, opts) → collider
physics.addStaticCapsule(halfHeight, radius, position, quaternion, opts) → collider
physics.addStaticConvexHull(points, opts) → collider
physics.removeCollider(collider)
physics.getColliderData(collider) → { surface, kind, spotId?, ... } | null
physics.castRay(origin, direction, maxDistance, { excludeBody?, excludeCollider?, groups?, solid? }) → RayHit | null
   // RayHit: { point: Vector3, normal: Vector3, distance, collider, surface }
physics.onCollision(handler) → unsubscribe   // eventos de contacto con ActiveEvents
physics.dispose()
```
**Grupos de colisión** (`Config.PHYSICS.GROUPS`, máscara de 16 bits membership | filter):
`STATIC = 1<<0`, `SKATER = 1<<1`, `BOARD_LOOSE = 1<<2` (tabla suelta tras caída), `DYNAMIC_PROP = 1<<3`, `CAMERA_BLOCKER = 1<<4` (para el rayo de cámara), `TRIGGER = 1<<5`.

### 7.2 Superficies (`src/data/surfaces.js`)
Cada collider estático lleva `surface` (id). Datos por superficie: `friction`, `rollingResistance`, `lateralGrip`, `grindFriction`, `audio` (perfil de sonido), `speedFactor`. Ids: `concrete`, `parkConcrete` (liso de skatepark), `asphalt`, `metal`, `wood`, `painted`, `brick`, `tile`, `grass`, `dirt`.

### 7.3 SkateboardPhysics (cuerpo del skater)
Modelo elegido: **un único cuerpo rígido dinámico** que representa *rider + tabla* (masa total ≈ 75 kg, centro de masa configurable con `setAdditionalMassProperties`), con un collider de deck (cuboide) y un collider de cuerpo del rider (cápsula sin masa) para choques; **4 rayos de suspensión** (uno por rueda, `WheelContactSolver`) que aplican fuerza muelle-amortiguador a lo largo de la normal de contacto, fricción lateral limitada por agarre (permite derrapes), resistencia a la rodadura y freno. La dirección se obtiene inclinando la tabla: los ejes delantero y trasero giran en sentidos opuestos (`steerAngle`).

Justificación: simular la tabla (2–4 kg) y el rider por separado con contactos reales es inestable a 60 Hz y poco jugable; los juegos del género combinan un cuerpo principal robusto con grados de libertad de truco controlados. La rotación de los flips es un **grado de libertad propio de la tabla relativo al cuerpo** (`boardRelative`, integrado en el paso fijo con velocidad angular propia), y su resultado se **verifica** al aterrizar (no se puntúa por pulsar una tecla).

API:
```js
const sb = new SkateboardPhysics({ physics, bus, setup /* SkateboardSetup */, params /* SKATER */ })
sb.spawn(position, yaw)                 // coloca el cuerpo en reposo sobre el suelo
sb.body                                 // RAPIER.RigidBody
sb.setMode('arcade'|'realistic')        // parámetros de asistencia (separados del núcleo)
sb.applyControls(dt, controls)          // antes de physics.step: { steer, push(bool, flanco), brake, crouch, lean, spin, manual }
sb.pop({ nollie, strength })            // ollie/nollie si hay contacto válido → bool
sb.startFlip({ roll, yaw, duration })   // vueltas de la tabla relativas al cuerpo (roll/yaw en radianes, signo ya resuelto por stance)
sb.catchBoard()                         // fuerza el "catch" (alinea boardRelative a la orientación más cercana permitida)
sb.setAirSpin(rate)                     // velocidad angular de giro del cuerpo en el aire (rad/s), con límites por modo
sb.beginManual(type) / sb.endManual()   // levanta ruedas delanteras/traseras: rayos desactivados + pitch
sb.attachGrind(grindInfo) / sb.detachGrind({ pop })   // control del cuerpo sobre una arista (GrindPhysics)
sb.bail()                               // separa la tabla (cuerpo suelto) y deja al rider caer
sb.postStep(dt)                         // después de physics.step: lee contactos, actualiza telemetría
sb.getTelemetry() → SkaterTelemetry     // objeto reutilizado (no copiar en caliente)
sb.getInterpolatedTransform(alpha, outPos, outQuat)
sb.reset(position, yaw)
sb.dispose()
```

```js
/** @typedef {Object} SkaterTelemetry
 * @property {THREE.Vector3} position        origen del cuerpo (centro del deck, cara superior)
 * @property {THREE.Quaternion} quaternion   orientación del cuerpo
 * @property {THREE.Vector3} velocity        m/s
 * @property {THREE.Vector3} angularVelocity rad/s
 * @property {number} speed                  |v| m/s
 * @property {number} forwardSpeed           v·(+Z local) (negativo = rodando hacia la cola)
 * @property {boolean} grounded              ≥ 2 ruedas en contacto (o grind)
 * @property {boolean[]} wheelContacts       [FL, FR, RL, RR]  (F = lado nariz +Z, L = +X)
 * @property {number} contactCount
 * @property {THREE.Vector3} groundNormal    normal media de contacto (o +Y si en el aire)
 * @property {string} surface                id de superficie bajo las ruedas
 * @property {number} steerAngle             rad (ángulo de los ejes, para visual)
 * @property {number} lean                   -1..1 inclinación visual
 * @property {number} crouch                 0..1 carga de pop
 * @property {number} airTime                s desde el despegue (0 en suelo)
 * @property {number} takeoffHeight          y al despegar
 * @property {number} maxAirHeight           altura máx. sobre el despegue
 * @property {{bodyYaw:number, bodyPitch:number, bodyRoll:number, boardRoll:number, boardYaw:number}} accumulated  ángulos acumulados con signo desde el despegue (rad)
 * @property {THREE.Quaternion} boardRelative  rotación de la tabla relativa al cuerpo (identidad = atrapada)
 * @property {boolean} flipActive
 * @property {'regular'|'goofy'} stance
 * @property {boolean} isSwitch
 * @property {{active:boolean, type:'manual'|'nose'|null, balance:number, time:number}} manual
 * @property {{active:boolean, type:string|null, spotId:string|null, balance:number, time:number, distance:number}} grind
 * @property {{time:number, impact:number, quality:number, clean:boolean, alignmentError:number}} lastLanding
 * @property {string} mode                   'arcade'|'realistic'
 */
```

### 7.4 Aterrizaje (LandingSystem)
Al recuperar contacto tras `airTime > 0.12 s`: calcula `alignmentError` = ángulo entre el `up` de la tabla y la normal del suelo, error de *yaw* entre la dirección de la tabla y la velocidad (permite fakie: se compara con ±Z), estado del flip (`boardRelative` debe estar dentro de tolerancia de la identidad o de 180° de yaw si el truco lo permite) e impacto vertical. Resultado `{ clean, quality 0..1, bail }`. Tolerancias por modo: arcade amplias (p.ej. 45°), realista estrictas (p.ej. 22°). Los valores viven en `SKATER.landing[mode]`.

### 7.5 Grinds (GrindSystem + GrindPhysics + SpotRegistry)
```js
/** @typedef {Object} GrindEdge
 * @property {string} id
 * @property {'rail'|'ledge'|'coping'|'curb'|'bench'|'funbox'} type
 * @property {string} surface               'metal'|'concrete'|'wood'|'painted'
 * @property {THREE.Vector3[]} points        polilínea de la arista superior (mundo)
 * @property {THREE.Vector3} [up]            normal de la superficie de la arista (por defecto +Y)
 * @property {number} [width]               ancho de la cara superior (ledges)
 * @property {number} [radius]              radio del tubo (rails/coping)
 * @property {number} [captureRadius]       radio de captura (por defecto: arcade 0.28 m, realista 0.14 m)
 * @property {Object} [userData]
 */
spots.registerEdge(edge) → id ; spots.removeEdge(id)
spots.queryEdges(position, radius, out[]) → [{ edge, segment, t, point, tangent, distance }]
spots.registerSpot({ id, name, position, radius, kind }) ; spots.querySpots(position) ; spots.clear()
```
Detección: en el aire (o rodando junto a la arista) con `input.grind` (o asistencia arcade), distancia horizontal ≤ captura, tabla por encima de la arista y descendiendo/nivelada, alineación respecto a la tangente → tipo: |Δ| < 25° → `5050`/`5-0`/`nosegrind` (según ↑/↓), 60–120° → `boardslide`/`noseslide`/`tailslide` (según flick/posición). Durante el grind el cuerpo se restringe a la arista (velocidad proyectada en la tangente, fricción de grind por superficie), `BalanceSystem` gestiona el equilibrio lateral (A/D corrige). Sale al final de la arista, al saltar (pop) o al perder el equilibrio (caída en realista, salida forzada en arcade).

### 7.6 Manuals
En suelo con `manual = +1` (↑) o `−1` (↓): `sb.beginManual('manual'|'nose')` levanta dos ruedas (sus rayos se ignoran) y aplica pitch visual/físico; `BalanceSystem` controla el equilibrio de pitch (W/S o ↑/↓ corrigen). Se rompe si el equilibrio sale de rango (realista: caída de cola/nariz con pérdida de combo; arcade: vuelve a 4 ruedas sin caída).

### 7.7 Modo caminar
`WalkingController` usa `KinematicCharacterController` de Rapier con una cápsula (radio 0.3, altura 1.75). F baja/sube de la tabla. Al bajar, la tabla queda como cuerpo dinámico ligero (`BOARD_LOOSE`) en el suelo; al subir a menos de 1.5 m se monta con animación; si está lejos, "se recoge" (vuelve a los pies).

## 8. Jugabilidad (`src/gameplay`)

### 8.1 Esquema de truco (`src/data/tricks.js`)
```js
{
  id: 'kickflip', name: 'Kickflip', category: 'flip',          // ollie | flip | shuv | spin | grind | slide | manual
  allowedStates: ['POPPING', 'AIRBORNE'],                         // estados del PlayerController donde se puede pedir
  input: { pop: 'ollie', flick: 'L', modifier: false },           // pop: 'ollie'|'nollie'|'any'|null ; flick: dirección
  gesture: 'D>UL',                                                // gesto flick del stick derecho (opcional)
  window: 0.30,                                                   // s tras el pop en que se acepta el flick
  physics: { roll: -1, yaw: 0, bodyYaw: 0, duration: 0.42, popScale: 1.0 },   // VUELTAS (regular); goofy ×(-1)
  animation: 'kickflip',
  landing: { rollTolerance: 35, yawTolerance: 30, allowFakie: true },        // grados
  score: 300, difficulty: 2,
  requires: null                                                  // p.ej. grinds: { edgeTypes: ['rail','ledge'], angle: 'parallel'|'perpendicular' }
}
```
Colección inicial: Ollie, Nollie, Kickflip, Heelflip, Pop Shove-it (BS), FS Shove-it, Frontside 180, Backside 180, 360 Shove-it, Varial Kickflip, 360 Flip, Manual, Nose Manual, Boardslide, 50-50 Grind, Noseslide, Tailslide (+ 5-0, Nosegrind opcionales).

### 8.2 Ciclo de vida de un truco
`solicitado` (input válido en estado válido → `trick:requested`) → `ejecutado` (física aplicada: `startFlip`, `setAirSpin`, `attachGrind`… → `trick:started`) → `completado` (TrickRecognizer compara la rotación **medida** en `telemetry.accumulated` con la esperada dentro de tolerancia **y** el aterrizaje es limpio → `trick:completed`) o `fallido` (`trick:failed` con motivo: rotación incompleta, aterrizaje sucio, caída).
Los giros del cuerpo (FS/BS 180/360) se reconocen por el yaw acumulado (redondeado a múltiplos de 180° con tolerancia), y se combinan con el flip en el nombre mostrado (p.ej. "FS 180 Kickflip").

### 8.3 Puntuación y combos (ComboSystem)
`puntos_truco = base × calidad(0.5..1.25) × factorVariedad × factorRepetición` — repetición: 1ª vez ×1, 2ª ×0.75, 3ª ×0.5, 4ª+ ×0.25 dentro del combo. Multiplicador del combo = nº de trucos distintos encadenados (+0.5 por grind/manual sostenido > 1 s). El combo continúa mientras el skater encadena aire → grind/manual → aire sin tocar el suelo con 4 ruedas más de 0.5 s (*grace*). Se cobra al terminar (`combo:end` landed=true) o se pierde con una caída (`landed=false`).

### 8.4 Desafíos (`src/data/challenges.js`)
`{ id, title, description, type: 'trick'|'combo'|'score'|'grind'|'spot'|'line'|'manual'|'air', target, params, reward, tutorial? }`. Progreso persistido en `SaveManager`.

## 9. Mundo (`src/world`)

### 9.1 Descriptores de parque (compartidos por presets y editor)
```js
/** ParkDescriptor (JSON) */
{ version: 1, id: 'sf-park-01', name: 'Streetflow Park', size: [80, 80],
  ground: { material: 'parkConcrete' },
  spawn: { position: [0, 0, 0], yaw: 0 },
  respawnPoints: [ { position: [x,y,z], yaw } ],
  modules: [ ModuleDescriptor ... ],
  props: [ { type: 'palm'|'bench'|'lamp'|'trashcan'|'planter'|'fence'|..., position, yaw, scale? } ] }

/** ModuleDescriptor */
{ id: 'qp-1', type: 'quarterPipe', position: [x, y, z], yaw: 0, params: { width: 6, height: 1.6, radius: 2.2, deck: 1.2, coping: true }, material: 'parkConcrete' }
```
Tipos de módulo y parámetros principales:
- `quarterPipe { width, height, radius, deckDepth, coping }`
- `halfPipe { width, height, radius, flat, deckDepth, coping }` · `miniRamp` (halfPipe bajo)
- `bowl { width, length, depth, transitionRadius, cornerRadius, coping, extension? }`
- `bank { width, length, height }` · `kicker { width, length, height }`
- `funbox { width, length, height, rampLength, ledges: bool, rail: bool }`
- `ledge { length, width, height, coping: 'angle'|'none', surface }` · `curvedLedge { radius, arc, width, height }`
- `manualPad { length, width, height }`
- `rail { length, height, diameter, supports, style: 'round'|'square' }` · `flatbar` (alias)
- `stairs { steps, rise, run, width, handrail: bool, hubbaLedge: bool }`
- `platform { width, length, height }`

### 9.2 Contrato de builder
```js
// Cada builder es una función pura de datos → recursos
buildModule(descriptor, ctx) → BuiltModule
// ctx = { physics, materials, spots, quality, scene }
/** BuiltModule { object3d: THREE.Object3D, colliders: RAPIER.Collider[], grindEdges: string[], bounds: THREE.Box3, dispose(): void } */
```
Reglas: geometría con normales suaves y continuas en transiciones; coping como tubo real (Ø ≈ 60 mm); colliders **trimesh** para superficies curvas (generados de una malla de colisión de resolución moderada que coincide con la superficie visible), cajas/cilindros para formas simples. Sin escalones invisibles: la base de cada transición coincide exactamente con `y` del suelo.

### 9.3 WorldManager
```js
world.loadLevel(levelId | ParkDescriptor, { onProgress }) → Promise<{ spawn }>
world.unload()
world.update(dt, cameraPosition)        // streaming de chunks, LOD
world.getSpawn(), world.getRespawnPoints()
world.current → { id, descriptor, modules: BuiltModule[] }
```
Niveles (`src/data/levels.js`): `skatepark` (parque principal + telón de fondo urbano de baja densidad) y `downtown` (parque + distrito urbano STREETFLOW DOWNTOWN en chunks de 64 m, cargados por distancia).

## 10. Personaje (`src/player`)

- Recurso: `public/assets/characters/skater.glb` generado por `tools/build-character.mjs` a partir de la malla base CC0 de MakeHuman/MPFB2 (anatomía humana real, UVs, rig *game_engine* de 53 huesos con pesos), ropa y pelo modelados como mallas propias con skinning, texturas procedurales originales. Sin recursos propietarios.
- Huesos (nombres exactos): `Root, pelvis, spine_01, spine_02, spine_03, neck_01, head, clavicle_l/r, upperarm_l/r, lowerarm_l/r, hand_l/r, thumb_0[1-3]_l/r, index_0[1-3]_l/r, middle_0[1-3]_l/r, ring_0[1-3]_l/r, pinky_0[1-3]_l/r, thigh_l/r, calf_l/r, foot_l/r, ball_l/r`.
- Bind pose: mirando +Z, pies en y=0, escala en metros (~1.78 m).

```js
const ch = await SkaterCharacter.load(url, { customization, materials, onProgress })
ch.object3d, ch.skeleton, ch.bones (Map nombre→Bone), ch.meshes
ch.applyCustomization(customization)
ch.dispose()

const anim = new CharacterAnimator(ch)       // AnimationMixer + clips procedurales (AnimationLibrary) + capas aditivas
anim.update(dt, { state, telemetry, intent, stance, boardPose })
anim.captureState() / anim.applyState(s)      // para repeticiones

const ik = new CharacterIK(ch)
ik.solve({ frontFoot, backFoot, pushFoot?, weight, pelvisOffset })   // objetivos en mundo; IK de dos huesos con vector polar
```
`SkateboardVisual.getFootAnchors(stance, out)` devuelve los objetivos de pie sobre el deck (posición + orientación) en coordenadas de mundo.

**Contexto de animación** (`PlayerController.getAnimationContext(alpha)`, objeto reutilizado):
```js
/** @typedef {Object} AnimationContext
 * @property {string} state                 estado de PLAYER_STATES
 * @property {SkaterTelemetry} telemetry
 * @property {InputIntent} intent           última intención consumida
 * @property {'regular'|'goofy'} stance
 * @property {THREE.Vector3} rootPosition   posición mundial de la raíz del personaje (interpolada)
 * @property {THREE.Quaternion} rootQuaternion  orientación de la raíz (cuerpo × rotación de stance ±90°)
 * @property {boolean} boardAttached        true si los pies deben ir a la tabla
 * @property {?{front:{position,quaternion}, back:{position,quaternion}, push:{position,quaternion}}} footAnchors  (mundo)
 * @property {number} crouch                0..1
 * @property {number} lean                  -1..1 (giro/equilibrio)
 * @property {number} pushPhase             0..1 durante PUSHING, -1 si no
 * @property {?{id:string, category:string, progress:number}} trick
 * @property {number} walkSpeed             m/s (modo caminar)
 * @property {{active:boolean, time:number, direction:THREE.Vector3}} bail
 * @property {number} landingImpact         0..1, decae tras aterrizar (para flexionar rodillas)
 */
```
`PlayerController.getCameraTarget(alpha)` → `{ position, quaternion, velocity, forward, grounded, state }` (objeto reutilizado).

## 11. Skateboard (`src/skateboard`)
`SkateboardSetup.js` exporta `DEFAULT_BOARD_SETUP` (dimensiones reales en metros, compartidas por física y visual). `SkateboardVisual` construye deck (concave + kicks paramétricos), lija, 7 capas de arce visibles en el canto, trucks (baseplate, hanger, kingpin, bushings, ejes), 4 ruedas (torno), rodamientos, tornillos y tuercas, gráfico original. API:
```js
const vis = new SkateboardVisual({ setup, materials, customization })
vis.object3d
vis.update(dt, { speed, forwardSpeed, steerAngle, wheelContacts, boardRelative, grounded })
vis.getFootAnchors(stance, out = { front: {position, quaternion}, back: {...}, push: {...} })
vis.applyCustomization(c) ; vis.dispose()
```
`Skateboard` compone `SkateboardPhysics` + `SkateboardVisual` y sincroniza el visual con la transformación interpolada.

## 12. Cámara
`CameraController(camera, { physics, input, settings, bus })` con modos `follow` (por defecto), `cinematic`, `free` y `menu` (órbita lenta para el fondo del menú); `cycleMode()`; `update(dt, target)` donde `target = { position, quaternion, velocity, grounded, state }`. Evita atravesar geometría con un rayo (`CAMERA_BLOCKER | STATIC`) desde el skater a la posición deseada y acerca la cámara con suavizado; FOV dinámico opcional por velocidad.

## 13. Audio
`AudioManager({ bus, settings })`: `unlock()` tras la primera interacción del usuario; buses `master/sfx/music/ambient`; síntesis procedural original (Web Audio) para rodadura por superficie y velocidad, pop, aterrizaje, grind/slide por superficie, empujón, viento, ambiente urbano/skatepark, UI. `update(dt, telemetry, listenerTransform)`.

## 14. Interfaz
DOM superpuesto (`#ui-root`) sobre el canvas. Pantallas: LoadingScreen (progreso real), MainMenu (JUGAR, SKATEPARK, MUNDO ABIERTO, TRUCOS Y DESAFÍOS, PERSONALIZACIÓN, EDITOR DE PARQUES, CONFIGURACIÓN), HUD (truco, puntuación, combo, multiplicador, velocidad, objetivo, equilibrio, botón de pausa), PauseMenu, SettingsMenu, CustomizationMenu, ChallengesMenu (con tutorial). Estética: fondo oscuro, blanco, acentos verde lima `#B6FF3B` y cian `#25D9FF`, tarjetas translúcidas. Pointer Lock solo tras acción explícita (clic en el canvas al jugar); se libera al abrir menús.

## 15. Persistencia
- `SettingsStorage` (localStorage `streetflow.settings.v1`): gráficos, audio, controles, sensibilidad, modo de física, accesibilidad. Esquema versionado con migración y recuperación ante datos dañados (se restauran los valores por defecto y se avisa).
- `SaveManager` (localStorage `streetflow.save.v1` + IndexedDB `streetflow` → store `parks`): progreso, desafíos, estadísticas, personalización, marcadores, parques del editor.

## 16. Repeticiones
`ReplayRecorder` guarda instantáneas a 30 Hz en un búfer circular (60 s): transformación del cuerpo, `boardRelative`, estado del jugador, `animator.captureState()`, eventos de truco. `ReplayPlayer` reproduce con interpolación: reproducir, pausar, retroceder, cámara libre/cinemática, cámara lenta (0.25×/0.5×). No se asume determinismo entre navegadores (no se re-simula).

## 17. Editor de parques
`ParkEditor` trabaja sobre `ParkDescriptor`: paleta de módulos, colocar por raycast en el suelo, mover/rotar/escalar (parámetros con límites), duplicar, eliminar, material, snap (0.5 m / 15°), guardar/cargar (IndexedDB), exportar/importar JSON validado por `ParkValidator` (tamaño máx. 1 MB, tipos y rangos), y "Probar parque" (modo `editorTest`).

## 18. Gráficos
`RendererManager`: `WebGPURenderer` (WebGPU si existe, WebGL2 si no; `?backend=webgl` fuerza WebGL2). `GraphicsSettings` presets:

| Preset | pixelRatio máx. | Sombras | Post-FX | Distancia | Texturas proc. |
|---|---|---|---|---|---|
| BAJO | 1.0 | 1024, PCF | ninguno | 120 m | 512 |
| MEDIO | 1.25 | 2048, PCFSoft | FXAA | 200 m | 1024 |
| ALTO | 1.5 | 2048, PCFSoft | bloom suave + FXAA | 320 m | 1024 |
| ULTRA | 2.0 | 4096, PCFSoft | bloom + AO + SMAA/TRAA | 450 m | 2048 |

Nota r186: `PCFSoftShadowMap` ya no existe en el renderer WebGPU (se sustituye por `PCFShadowMap`); la suavidad se controla con `light.shadow.radius`/`blurSamples` según lo verificado en `docs/tech/THREE_WEBGPU_NOTES.md`.

`LightingSystem`: sol direccional con sombras que siguen al jugador, cielo físico (`SkyMesh`), entorno PMREM para reflejos, hemisférica, niebla de distancia, presets horarios `morning | afternoon (por defecto) | sunset | night` (farolas en la noche).

## 19. Rendimiento (objetivos, no garantías)
Equipo de referencia: CPU 6 núcleos ~3.5 GHz, GPU clase GTX 1660 / RTX 2060, 16 GB RAM, Chrome estable, 1920×1080. Objetivo: 60 FPS en ALTO. Presupuestos: < 400 draw calls en el parque, < 1.5 M triángulos visibles, física < 2 ms/paso, sin asignaciones por fotograma en rutas calientes. Las mediciones reales se documentan en `docs/PERFORMANCE.md` indicando el entorno de medición.

## 20. Pruebas
- Vitest (Node): bus, bucle, entrada, base de datos y reconocimiento de trucos con telemetría sintética, combos, validación de parques, persistencia (mock de localStorage), **física real con Rapier en Node** (rodar, pendiente, ollie, aterrizaje, quarter pipe, independencia de FPS, estabilidad en reposo).
- Playwright (Chromium headless, backend WebGL2): arranque → menú → JUGAR → W mueve → ESPACIO hace ollie → aterriza → R reinicia → pausa/reanuda → sin errores de consola; capturas para comparación visual; build + preview.
