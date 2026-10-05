# LATIDO DM-16 PRO · Auditoría, correcciones y mejoras

Archivo final: [`latido-dm16-pro.html`](latido-dm16-pro.html) (un solo HTML, sin dependencias nuevas).
El primer commit de la rama es el archivo original tal como llegó, así que cada cambio se puede revisar como diff.

## Cómo se auditó

- Lectura completa de las 6.264 líneas (CSS, HTML y todo el JavaScript) antes de tocar nada.
- Banco de pruebas en Chromium headless (Playwright) con el audio real funcionando: errores de consola,
  medición de niveles y espectro sobre la salida del master, render offline de cada sonido del kit,
  capturas en 6 tamaños de pantalla y un detector automático de desbordes y objetivos táctiles pequeños.
  Para inspeccionar el estado interno se usa una copia de prueba con un gancho (`window.__L`) que **no**
  forma parte del archivo entregado.
- Cada hallazgo se reprodujo en el navegador antes de corregirlo, y se volvió a medir después.

## 1. Auditoría

### CRÍTICO

| # | Problema | Cómo se comprobó |
|---|---|---|
| C1 | `LivePadRec.render()` llamaba a `m.barDuration()`, que no existe. Con cualquier toma seleccionada: (a) las tarjetas de tomas y el texto de la toma nunca se pintaban; (b) QUANTIZE, HUMANIZE, RECORTAR, CORTAR, UNIR, DUPLICAR y DESHACER aplicaban el cambio sin aviso y sin marcar el proyecto para guardar; (c) **al recargar con una toma guardada, la restauración del proyecto fallaba** («No se pudo restaurar el proyecto») y con ella la recuperación de los samples propios. | Excepción reproducida al grabar una toma; 7 botones con error en el recorrido de los 132 botones; recarga con toma = proyecto sin restaurar. |
| C2 | El Drum Roll dibujaba un lienzo del ancho de **toda** la toma × devicePixelRatio. Una toma de 6 min a dpr 2 = 49.094 px de ancho; una de 30 min ≈ 243.000 px (~500 MB). Por encima de los límites de canvas de muchos navegadores (sobre todo móviles) el lienzo queda en blanco o la pestaña se cae. En modo LIBRE, además, el ancho CSS no se actualizaba mientras grababas (dibujo estirado). | Medido con una toma sintética de 3.000 golpes. |
| C3 | Reproducir una toma programaba **todos** sus golpes de una vez (miles de nodos de audio para tomas largas) y el loop se reiniciaba con `setTimeout(d*1000+80)` + 30 ms: hueco audible de ~110 ms y jitter en cada vuelta. | Lectura del código + medición de los `start()` programados. |

### ALTO

| # | Problema |
|---|---|
| A1 | Seleccionar o arrastrar un golpe del Drum Roll solo acertaba ±20 ms desde su inicio (≈1,3 px de un bloque de 8,6 px): casi todos los clics sobre el bloque iniciaban una selección por recuadro. |
| A2 | Durante el arrastre, cada `pointermove` llamaba a `render()` completo: reconstruía el `<select>`, todas las tarjetas con sus 10 botones y sus miniaturas. |
| A3 | OVERDUB grababa «a ciegas» (la toma no sonaba) y al detener volvía a la posición original **todos** los golpes de la toma, deshaciendo una cuantización o edición previa. |
| A4 | Precisión de grabación: el tiempo de cada golpe era `ctx.currentTime` (granularidad de bloque de audio, 3–20 ms según el equipo); con PRE el inicio dependía de un `setTimeout`; con el patrón sonando, el origen de la toma no coincidía con el compás, así que su cuantización no caía en la rejilla que se escucha. |
| A5 | Piano en pantalla: `focus()` y `getBoundingClientRect()` (layout síncrono) se ejecutaban **antes** de disparar la nota. |
| A6 | `chokeVoices()` (hi-hat cerrado → abierto, pads en LOOP) escribía en el DOM dentro de `triggerPad()`, antes de `src.start()`, también en cada paso del secuenciador. |
| A7 | Cuantizar y SNAP aplicaban el swing de semicorcheas a cualquier rejilla: en 1/32 y 1/64 las subdivisiones impares se desplazaban hasta la siguiente (notas que se cruzan); en 1/8 se balanceaban corcheas. |
| A8 | Golpes en vivo sobre pads distintos: cada golpe ejecutaba `selectPad()` completo (editor, 12 perillas, OLED, forma de onda, selects de la biblioteca y carril de fuerza): hasta 7 ms por fotograma en escritorio, más en móviles, lo que retrasa el procesamiento de la siguiente pulsación. |

### MEDIO

| # | Problema |
|---|---|
| M1 | Click al final de un sample recortado (Final < 100 %): el fundido empezaba al terminar la región y `stop()` cortaba al 17 % de ganancia. |
| M2 | `vqPush` descartaba los eventos visuales **más cercanos** al llenarse y el bus visual descartaba los nuevos; con la pestaña oculta se acumulaban y al volver se dibujaba una ráfaga de eventos viejos. |
| M3 | Animaciones: ORBIT y RACE se dibujaban a 60 fps aunque estuvieran fuera de pantalla; creaban gradientes, arrays (`filter`) y objetos de partícula nuevos en cada fotograma; clasificaban los golpes por número de pad (cargar otro sonido en el pad 2 seguía siendo «caja»); texto de 9 px monospace. |
| M4 | La regla de compases del Drum Roll era texto con espacios que no coincidía con la rejilla (y repetía «1.1 1.2 1.3 1.4» en todos los compases). El carril de velocity repartía las barras por orden, no por tiempo, y redimensionaba su lienzo en cada fotograma. |
| M5 | DUPLICAR una toma de «30 SEGUNDOS» o de 32 compases la convertía en 2 compases o la recortaba (golpes fuera de la duración). |
| M6 | Biblioteca de sonidos de pad: todas las variantes de una categoría usaban un solo generador («Open Hat» y «Long Open Hat» eran un hat cerrado de 130 ms; «Low Tom», «Ride», «808 …» igual que los demás). Marcar ★ en un pad de fábrica lo «congelaba» (dejaba de seguir los kits). Los cambios de sonido no se podían deshacer. |
| M7 | Responsive: a 390 px los botones GRABAR SONIDO y CARGAR SAMPLE se pisaban el texto; los controles del Drum Roll (select, IN/OUT, sliders) medían 13–19 px de alto. |
| M8 | Estados de botón poco legibles: ON se notaba solo por un LED de 7 px; PLAY, REC y cualquier ON se veían iguales; no existía estado ARMADO; SOLO no se veía en las filas del secuenciador. |
| M9 | Reproducir una toma con el patrón sonando arrancaba en cualquier punto (fuera de compás). |
| M10 | STOP reiniciaba las animaciones de golpe, sin transición. |
| M11 | `duration()` de una toma libre recorría todos sus eventos varias veces por fotograma. |
| M12 | La barra del Drum Roll tenía 27 controles en un solo bloque; «LOOP ON» decía ON también apagado. |
| M13 | Autoguardado: con localStorage lleno (tomas largas) avisaba de error y reintentaba cada 30 s aunque IndexedDB sí hubiera guardado. |
| M14 | Los 15 kits nuevos eran el CLÁSICO pasado por la misma envolvente pseudoaleatoria: prácticamente indistinguibles. |

### BAJO

| # | Problema |
|---|---|
| B1 | Al restaurar un proyecto, la biblioteca de sonidos quedaba mostrando el último pad procesado, no el seleccionado. |
| B2 | Se guardaban en el proyecto campos temporales y repetidos de cada golpe (`_lastPad`, `audioTime`, `t`, `vel`, `bank`…). |
| B3 | El indicador de latencia reescribía su `innerHTML` cada segundo. |
| B4 | CONVERTIR A PATRÓN redondeaba un golpe al paso 16 y lo recortaba al 15 (en vez del compás siguiente) y no compensaba el swing. |
| B5 | Los medidores caían más rápido a 120 Hz que a 60 Hz. |
| B6 | «Sens. vel.» decía afectar al brillo del pad, pero solo cambiaba el volumen. |
| B7 | Con un golpe seleccionado, la rueda del ratón sobre el Drum Roll dejaba de desplazar la página. |
| B8 | La ayuda describía solo 3 kits. |

## 2. Correcciones

- **C1** – `render()` corregido. Además se separó el trabajo: el lienzo se dibuja por fotograma solo si algo cambió; select, tarjetas e IN/OUT se reconstruyen solo cuando cambia su contenido (firma).
- **C2** – Drum Roll virtual: el lienzo mide lo que la vista y se queda fijo con `position:sticky` dentro de una pista del ancho de la toma; el dibujo usa el desplazamiento. 6 min a dpr 2: de 49.094 × 540 px a 2.400 × 556 px. Regla de compases, columna de nombres y carril de velocity se dibujan en el mismo sistema de coordenadas: alineados al píxel.
- **C3** – La toma se programa por ventanas desde el mismo reloj del secuenciador (`AudioContext.currentTime` + LOOKAHEAD, cada 20 ms desde el Worker): loop sin hueco ni deriva (medido: la vuelta 2 empieza exactamente a `d`), sin miles de nodos de golpe y con las colas intactas al terminar.
- **A1–A2** – Selección en píxeles sobre el bloque dibujado; arrastre que solo marca el lienzo para redibujar.
- **A3** – OVERDUB reproduce la toma mientras grabas (con LOOP, vuelta tras vuelta, los golpes nuevos se envuelven); al detener solo se procesan los golpes de esa pasada; un overdub sin golpes no deja un deshacer vacío.
- **A4** – Cada golpe usa su marca de tiempo real (`e.timeStamp`). Con referencia musical (patrón, PRE u OVERDUB) se corrige con la latencia de salida y la calibración; con el patrón sonando la toma queda **ARMADA** y arranca en el compás exacto que programa el secuenciador; con PRE, en el instante exacto del primer tiempo. Error medido: < 0,15 ms por golpe.
- **A5–A6** – Piano: nota primero, foco y captura después; la fuerza se calcula con la caja medida al empezar el fotograma. `chokeVoices()` y los loops encolan las luces para el siguiente fotograma.
- **A7** – Swing como deformación del tiempo (`swingWarp`/`swingUnwarp`): solo se retrasan las semicorcheas impares y 1/32–1/64 se interpolan.
- **A8** – En ráfagas, el marco del pad cambia en el acto y el editor, la pantalla y la biblioteca se actualizan cuando la ráfaga se calma (110 ms). `UIQ.flush` medio: 1,29 → 0,30 ms; máximo 7,0 → 3,4 ms.
- **M1** – El fundido final cae dentro de la región y el `stop()` llega cuando la ganancia ya es 0.
- **M2, M10** – Nuevo bus visual: entrega sin crear arrays, descarta solo lo viejo y nunca dibuja eventos de una pestaña oculta. STOP lleva a cada animación a su escena de reposo con transición.
- **M4–M5, M11, B2, B4, B7** – Regla y velocity alineados; DUPLICAR conserva la duración real; duración cacheada; eventos guardados sin campos repetidos (−45 % en el proyecto); CONVERTIR A PATRÓN quita el swing y pasa al compás siguiente; la rueda solo cambia la velocity si hay un golpe debajo del puntero.
- **M6** – Cada variante usa el generador que le corresponde por nombre (`variantGen`), las «808 …» usan la 808, los ★ solo marcan la variante (con ★ visible en la lista) y el cambio se deshace con Ctrl+Z.
- **M7, M8, M12** – Botones con estados visibles: ON (texto blanco y halo), PLAYING (verde), RECORDING (rojo con brillo), ARMED (borde rojo y LED intermitente; GRABAR TOQUE en ámbar), DISABLED (sin LED ni brillo), MUTE (rojo), SOLO (amarillo, también en las filas). Teléfonos: dos líneas en los botones de arriba. Drum Roll: grupos de 32 px de alto, selects y campos de 26 px y deslizadores de 24 px (antes medían de 13 a 19 px). Barra del Drum Roll agrupada en REPRODUCIR · REJILLA · RECORTE · EDICIÓN · EXPORTAR (mismos IDs y funciones) y LOOP con LED.
- **M13** – Si localStorage se llena, basta con IndexedDB (se avisa solo si fallan los dos).
- **B1, B3, B5, B8** – Biblioteca sincronizada tras restaurar, latencia escrita solo si cambia, caída de medidores por tiempo, ayuda actualizada.

## 3. Mejoras

- **Sonido** (medido por bandas antes y después, sin cambiar el carácter):
  - Kick: caída en dos tramos con el mismo oscilador (sin capas que se cancelen): +3,9 dB de cola entre 30 y 800 Hz, y un «mazo» en 3,4 kHz (+1,7 dB de transitorio) para parlantes pequeños.
  - Snare: pico de ataque más marcado en el ruido, cuerpo algo más largo y saturado, y «crack» del parche en 2,6 kHz.
  - Hi-hat: «tic» de definición de 4 ms y aire en 11 kHz.
  - Sub 808: 2.º armónico en fase con la fundamental: +4,5 dB relativos en 80–200 Hz, se oye también en un celular.
  - Sinte: filtro de infrasonidos a 24 Hz y +1,2 dB anchos en 2,8 kHz (presencia), sin latencia. Los acordes de 6 notas tocan menos el limitador (Rhodes: 67 → 11 muestras sobre −1,4 dBFS).
  - Fuerza → brillo en los pads: un golpe suave también suena más oscuro (según «Sens. vel.»); a fuerza máxima no se crea ningún nodo extra.
  - Kits con carácter real: afinación por familia, caída, saturación, tono, bits y muestreo (TRAP y ELECTRO sobre la 808). El bombo va de 42 a 58 Hz y de 0,51 a 1,48 s según el kit.
- **Drum Roll**: carril de velocity editable (arrastra; barrer de lado cambia varios), Ctrl + rueda hace zoom anclado al puntero, FOLLOW también al grabar, marca del tiempo original cuando un golpe se cuantiza, zona de recorte IN/OUT visible, «FIN» de la toma y cabezal de grabación; tocar un nombre hace sonar su pad; con el dedo, deslizar sobre el vacío mueve la vista.
- **Tomas**: guardan el BPM con que se grabaron (su rejilla, MIDI y conversión a patrón usan ese tempo).

## 4. Audio

- **Latencia**: el orden INPUT → AUDIO → REGISTRO → UI → ANIMACIÓN se respeta en pads, teclado, MIDI y piano en pantalla; nada del DOM corre entre la pulsación y `start()`; las ráfagas ya no cargan el hilo principal antes de la siguiente pulsación.
- **Estabilidad**: tomas largas sin miles de nodos; colas visuales sin crecer; 0 errores de consola en todo el recorrido.
- **Polifonía**: se mantienen el robo de voces del sinte y el límite de 8 voces por pad (verificado con 40 golpes en 0,5 s y 44 teclas a la vez).
- **Sincronización**: patrón, toma (loop) y arpegiador comparten el reloj del Worker + `AudioContext.currentTime`; las animaciones y los cabezales usan el instante que **se oye** (`getOutputTimestamp`), así coinciden con el sonido incluso con Bluetooth.

## 5. Visuales

Las dos pantallas mantienen su sitio y su tamaño. Todo se dibuja con Canvas 2D a partir de sprites hechos una sola vez (sin imágenes externas) y escucha el bus `Visuals.emit(...)`: `'kick' | 'snare' | 'hat' | 'crash' | 'perc' | 'bass' | 'fx'`, `'synthNote'`, `'pitchbend'`, `'modwheel'`, `'preset'`, `'step'` y `'stop'`. El papel de cada pad sale de su sonido, no de su número.

**LATIDO ORBIT** (master) — mini juego automático en una estación orbital:
- IDLE: el robot calibra su consola (pantallas animadas), la nave espera acoplada, antena y luces de la pasarela parpadean, estrellas a la deriva y planeta con anillos de oro y plata.
- Al sonar música el robot salta a la cabina, la nave se desacopla y la estación queda atrás. Al parar, la nave vuelve marcha atrás, se acopla y el robot sale a su consola.
- KICK = empuje del motor (llama, retroceso, leve sacudida); SNARE = láser que destruye el asteroide más cercano (+10); HAT = chispas de las alas y orbes de energía; PERC = disparos violeta; BASS = escudo; FX = rayo; CRASH = explosión en cadena de todos los asteroides con onda expansiva y destello.
- Retos automáticos: esquivar asteroides (piloto automático), atravesar puertas de energía que aparecen en los compases, recolectar energía; con la barra llena entra TURBO (estrellas en estela y llama magenta). Marcador, combo y estado (DOCK / DESPEGUE / RUN / TURBO / REGRESO).

**LATIDO RACE** (sinte) — carretera pseudo 3D con auto robótico (piloto visible) y rivales a los que adelanta:
- Nota = avanza; acorde = BOOST; fuerza alta = TURBO con chispas; pitch bend = cambio de carril con inclinación; mod wheel = modo NEÓN (bordes y bajos luminosos, estelas).
- IDLE: el auto calienta en la parrilla (vibración, humo del escape, semáforo de salida y línea a cuadros).
- Escenario según el preset: piano/teclas/vientos = CIUDAD nocturna; lead/electrónica = CYBER; bajos = TÚNEL industrial; pads = ESPACIO; FM/eléctricos/mallets = CIRCUITO FM; efectos = LAB robótico; órganos = máquina RETRO.

**Micro-interacciones**: LED de PLAY que late con cada negra, estados de botón visibles, grupo seleccionado del Drum Roll resaltado.

## 6. Rendimiento

- **Canvas**: sprites, fondos, viñetas y horizontes se dibujan una sola vez por tamaño; luz con sprites aditivos en vez de `shadowBlur`; nitidez con devicePixelRatio; sin dibujar fuera de la vista (IntersectionObserver) ni con la pestaña oculta.
- **Partículas**: pool fijo con arrays tipados (240 en ORBIT, 90 en RACE): ningún objeto nuevo por fotograma.
- **Presupuesto**: si las dos pantallas pasan de ~6 ms por fotograma, se dibujan a la mitad de fotogramas (el estado sigue al día). Con `prefers-reduced-motion` el movimiento va al 35 % y sin destellos ni sacudidas.
- **Medido** (escritorio, Chromium headless): animaciones 0,3–0,7 ms por fotograma; `UIQ.flush` 0,30 ms de media; colas y voces estables tras varios minutos; heap estable y mismo número de listeners antes y después (ver pruebas).
- **GC / listeners**: el Drum Roll ya no recrea tarjetas, selects ni lienzos al arrastrar; el carril de velocity no se redimensiona por fotograma; ningún listener nuevo por interacción.

## 7. Pruebas

Las 50 comprobaciones de la lista se ejecutaron sobre la página real: Chromium headless con el audio funcionando (Playwright) y una prueba de resistencia de 3 minutos con patrón y toma en loop. Para leer el estado interno se usó una copia con un gancho de prueba (`window.__L`) que **no** forma parte del archivo entregado. Los tiempos se miden en los `start()` programados y las frecuencias en la señal real (cruces por cero con interpolación), no en los valores de los parámetros.

| # | Área | Prueba | Resultado | Medición |
|---|---|---|---|---|
| 1 | Audio | tocar pad | ✅ | voz creada en el pad 1 |
| 2 | Audio | varios pads | ✅ | voces simultáneas: 9 |
| 3 | Audio | golpes rápidos (40 en 0,5 s) | ✅ | máx. voces del pad 8, al final 0 |
| 4 | Audio | acordes | ✅ | voces del acorde: 4 |
| 5 | Audio | sustain | ✅ | con pedal 4 sostenidas, al soltar 0 |
| 6 | Audio | pitch bend | ✅ | 439,9 Hz → 493,9 Hz (+2,00 st) → 440,1 Hz |
| 7 | Audio | mod wheel | ✅ | vibrato 55,0 cents |
| 8 | Secuenciador | Play | ✅ | pasos programados: 10 |
| 9 | Secuenciador | Stop | ✅ | sin golpes programados pendientes (0) |
| 10 | Secuenciador | cambiar BPM | ✅ | 6 corcheas a 300,00 ms (esperado 300,00 ms a 100 BPM) |
| 11 | Secuenciador | swing | ✅ | largo 168,0 ms / corto 132,0 ms (swing 18,0 ms) |
| 12 | Secuenciador | patrones (A→B al compás) | ✅ | en cola 1, suena 1 |
| 13 | Secuenciador | cadena | ✅ | patrones que sonaron: B,A |
| 14 | Secuenciador | REC en el patrón | ✅ | los golpes se escribieron en la fila del pad 10 |
| 15 | Live take | grabar toma | ✅ | 8 golpes capturados |
| 16 | Live take | stop de la toma | ✅ | tomas: 1 |
| 17 | Live take | reproducir toma | ✅ | 8 golpes programados |
| 18 | Live take | overdub | ✅ | 8 → 9 golpes, la toma sonaba: true |
| 19 | Live take | editar (cuantizar/deshacer) | ✅ | todos los golpes en la rejilla 1/16 con swing |
| 20 | Live take | guardar | ✅ | tomas en el proyecto guardado: 1 |
| 21 | Drum Roll | mover nota | ✅ | Δt 409 ms, pad 3→4 |
| 22 | Drum Roll | velocity (carril) | ✅ | velocity 0,52 |
| 23 | Drum Roll | zoom (anclado) | ✅ | ×2,00, el instante bajo el puntero se mueve 0,0 px |
| 24 | Drum Roll | snap | ✅ | un golpe en 3,3 semicorcheas cae en la 4.ª (con swing) |
| 25 | Drum Roll | playhead (loop) | ✅ | la toma sigue sonando en loop |
| 26 | Drum Roll | follow | ✅ | la vista se movió de 0 a 586 px |
| 27 | Sinte | cambiar preset (con notas) | ✅ | 71 presets cambiados con notas sonando: 0 errores y 0 notas retenidas (a los 2,5 s, 2 voces seguían en su cola de release) |
| 28 | Sinte | tocar acordes | ✅ | voces en curso 12 |
| 29 | Sinte | muchas voces (44 teclas) | ✅ | vivas 16 (máx. 16), al final 0 |
| 30 | Sinte | efectos del sinte (todos) | ✅ | pico 0,491 |
| 31 | Visuales | IDLE | ✅ | ORBIT: dock |
| 32 | Visuales | actividad | ✅ | ORBIT: fly |
| 33 | Visuales | kick → motor | ✅ | empuje 1,00 |
| 34 | Visuales | snare → disparo | ✅ | láseres activos 1 |
| 35 | Visuales | hat → partículas | ✅ | partículas 54 → 56 en el mismo instante del golpe |
| 36 | Visuales | crash → explosión | ✅ | destello 0,30, ondas 4 |
| 37 | Visuales | acorde → boost | ✅ | boost 1,00 |
| 38 | Visuales | pitch bend → carril | ✅ | objetivo lateral -0,7 |
| 39 | Visuales | mod wheel → neón | ✅ | neón 0,9 |
| 40 | Visuales | stop → vuelve a la estación | ✅ | return → dock |
| 41 | Responsive | PC 1920×1080 | ✅ | pads 122px, teclas 48px |
| 42 | Responsive | laptop 1366×768 | ✅ | pads 122px, teclas 48px |
| 43 | Responsive | tablet 820×1180 | ✅ | pads 182px, teclas 28px |
| 44 | Responsive | teléfono 390×844 | ✅ | pads 79px, teclas 38px |
| 45 | Estabilidad | errores de consola | ✅ | ninguno |
| 46 | Estabilidad | notas colgadas | ✅ | voces sinte 0, pads 0 |
| 47 | Estabilidad | clipping (salida ≥ 0 dBFS) | ✅ | pico 0,918 (-0,7 dBFS), muestras ≥0 dBFS: 0 |
| 48 | Estabilidad | memoria (heap tras GC) | ✅ | 8,4 → 8,7 MB en 180 s |
| 49 | Estabilidad | listeners duplicados | ✅ | window+document: 43 → 43 |
| 50 | Estabilidad | rendimiento tras 180 s | ✅ | animaciones 0,32 ms por fotograma de media (máx. 5,8); colas visuales 5 / 3; voces de la toma en loop 24; partículas 63 |

**50/50 superadas.** Después del último ajuste (deslizadores del Drum Roll a 24 px) se repitió todo: 50/50 con 30 s de resistencia.

Además:
- **Recorrido de botones**: se pulsaron los 132 botones visibles uno por uno, con 0 errores.
- **Desbordes** en 6 tamaños (1920×1080, 1366×768, 820×1180, 844×390, 390×844 y 360×740): ningún elemento se sale de la pantalla ni corta su texto. En tablet y teléfono no hay objetivos táctiles de menos de 24 px. En escritorio solo queda la etiqueta de latencia (19 px de alto), que con ratón es suficiente.

## Límites honestos

- Las pruebas son en Chromium headless con dispositivo de audio nulo; Safari y Firefox no se probaron aquí, y el responsive se probó por emulación (sin teléfonos físicos).
- No se puede medir la latencia física de salida sin hardware; lo que se midió es que no queda trabajo síncrono entre la pulsación y el sonido.
- Las tomas siguen guardándose en segundos (con su BPM): si cambias el tempo del proyecto, una toma conserva el suyo y no se estira.
- El WAV de una toma sigue siendo «seco» (sin reverb ni delay generales), como ya indicaba su botón; ahora sí incluye el fundido final y el brillo por fuerza.
