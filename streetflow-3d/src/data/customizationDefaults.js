/**
 * Valores por defecto de personalización (personaje y tabla). Compartidos por
 * SaveManager, SkaterCharacter, SkateboardVisual y la UI de personalización.
 * Basados en la referencia 07 (docs/ART_DIRECTION.md): camiseta negra oversize con gráfico blanco,
 * cargo verde oliva, zapatillas negras con suela blanca, gorra negra, pelo castaño oscuro rizado.
 */
export const DEFAULT_CHARACTER_CUSTOMIZATION = Object.freeze({
  top: 'tee', // 'tee' | 'hoodie'
  topColor: '#1a1a1c',
  topGraphic: 'sf-mono-01', // gráfico original de la espalda/pecho
  pants: 'cargo',
  pantsColor: '#6e6b4f',
  shoesColor: '#141414',
  shoesAccent: '#f2f0ea',
  cap: true,
  capColor: '#151517',
  capBackwards: false,
  chain: true,
  tattoos: true,
  hairColor: '#2b1d15',
  skinTone: 0.45, // 0 = clara, 1 = oscura
  stance: 'regular', // 'regular' | 'goofy'
})

export const DEFAULT_BOARD_CUSTOMIZATION = Object.freeze({
  graphic: 'sf-ink-01',
  gripColor: '#121212',
  wheelColor: '#efe6cf',
  truckColor: '#c9ccd1',
  bushingColor: '#b3262d',
  woodTone: '#d9b27c',
})

/** Opciones válidas que la UI puede mostrar (los módulos pueden ampliarlas). */
export const CUSTOMIZATION_OPTIONS = Object.freeze({
  top: ['tee', 'hoodie'],
  topColors: ['#1a1a1c', '#e9e6df', '#2d3a4a', '#5a1f22', '#3b4a2f'],
  topGraphics: ['sf-mono-01', 'sf-wave-02', 'none'],
  pantsColors: ['#6e6b4f', '#1d1d1f', '#3a4555', '#8a7a5c'],
  shoesColors: ['#141414', '#5a1f22', '#2d3a4a', '#e9e6df'],
  capColors: ['#151517', '#e9e6df', '#2d3a4a', '#5a1f22'],
  hairColors: ['#2b1d15', '#120c09', '#5a3a22', '#8c6a43'],
  boardGraphics: ['sf-ink-01', 'sf-sunset-02', 'sf-grid-03', 'sf-plain-04'],
  wheelColors: ['#efe6cf', '#f4f4f2', '#d8432f', '#2e7bd6', '#1d1d1f'],
  gripColors: ['#121212', '#2a2a2a'],
  bushingColors: ['#b3262d', '#e8b923', '#2e7bd6', '#f4f4f2'],
  truckColors: ['#c9ccd1', '#1d1d1f', '#b8902d'],
})
