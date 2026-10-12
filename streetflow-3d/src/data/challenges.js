/**
 * Desafíos (docs/ARCHITECTURE.md §8.4). Los de tipo tutorial muestran instrucciones de control.
 * type: trick | anyTrick | combo | comboScore | sessionScore | grind | manual | air | spot | spotsAll | line
 */
export const CHALLENGES = [
  { id: 'tut-push', title: 'Primeros metros', description: 'Empuja con W hasta superar 15 km/h.', type: 'speed', target: 15 / 3.6, reward: 50, tutorial: 'Mantén W para encadenar patadas. A/D giran, S frena.' },
  { id: 'tut-ollie', title: 'Tu primer ollie', description: 'Aterriza un ollie limpio.', type: 'trick', params: { ids: ['ollie', 'nollie'] }, target: 1, reward: 100, tutorial: 'Mantén ESPACIO para agacharte y suéltalo para saltar. Cuanto más cargas, más alto.' },
  { id: 'tut-kickflip', title: 'Kickflip', description: 'Consigue un kickflip.', type: 'trick', params: { ids: ['kickflip'] }, target: 1, reward: 200, tutorial: 'Suelta ESPACIO y pulsa ← (o mantén ← antes de soltar). En mando: stick derecho abajo y luego arriba-izquierda.' },
  { id: 'tut-shuvit', title: 'Pop shove-it', description: 'Aterriza un pop shove-it.', type: 'trick', params: { ids: ['popShuvit', 'fsShuvit'] }, target: 1, reward: 150, tutorial: 'Ollie + ↓ para un shove-it backside; ↑ para el frontside.' },
  { id: 'tut-manual', title: 'Equilibrio', description: 'Mantén un manual 2 segundos.', type: 'manual', target: 2, reward: 150, tutorial: 'Rodando, pulsa ↑ (manual) o ↓ (nose manual) y corrige el equilibrio con ↑/↓.' },
  { id: 'tut-grind', title: 'Primer grind', description: 'Completa un grind o slide.', type: 'grind', target: 0.4, reward: 200, tutorial: 'Salta sobre un rail o ledge manteniendo E. Paralelo = grind, cruzado = slide. A/D mantienen el equilibrio.' },
  { id: 'combo-3', title: 'Encadena tres', description: 'Encadena 3 trucos en un combo.', type: 'combo', target: 3, reward: 300 },
  { id: 'combo-5k', title: 'Línea de 5.000', description: 'Consigue 5.000 puntos en un solo combo.', type: 'comboScore', target: 5000, reward: 500 },
  { id: 'session-20k', title: 'Sesión productiva', description: 'Suma 20.000 puntos en una sesión.', type: 'sessionScore', target: 20000, reward: 500 },
  { id: 'treflip', title: 'El 360 flip', description: 'Aterriza un 360 flip.', type: 'trick', params: { ids: ['treflip'] }, target: 1, reward: 600, tutorial: 'SHIFT + ← en el aire.' },
  { id: 'spin-360', title: 'Vuelta completa', description: 'Aterriza un giro de 360.', type: 'trick', params: { spins: ['fs360', 'bs360'] }, target: 1, reward: 400, tutorial: 'Mantén A o D en el aire para girar.' },
  { id: 'air-1', title: 'Vuelo', description: 'Consigue 1 segundo de aire.', type: 'air', target: 1, reward: 300 },
  { id: 'grind-long', title: 'Rail largo', description: 'Grinda 6 metros seguidos.', type: 'grindDistance', target: 6, reward: 400 },
  { id: 'spots-all', title: 'Explorador', description: 'Descubre todos los spots del nivel.', type: 'spotsAll', target: 1, reward: 500 },
  { id: 'tricks-10', title: 'Repertorio', description: 'Aterriza 10 trucos distintos.', type: 'distinctTricks', target: 10, reward: 600 },
]
