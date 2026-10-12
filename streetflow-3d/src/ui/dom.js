/** Utilidades DOM mínimas para la interfaz (sin frameworks). */
export function h(tag, props = null, ...children) {
  const el = document.createElement(tag)
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue
      if (k === 'class') el.className = v
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v)
      else if (k === 'dataset') Object.assign(el.dataset, v)
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v)
      else if (k === 'text') el.textContent = v
      else if (k === 'html') el.innerHTML = v
      else if (v === true) el.setAttribute(k, '')
      else el.setAttribute(k, v)
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)))
  }
  return el
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild)
  return el
}

export const fmtInt = (n) => Math.round(n).toLocaleString('es-ES')

/** Asigna texto solo si cambió (evita trabajo de layout por fotograma). */
export function setText(el, text) {
  if (el._t !== text) {
    el._t = text
    el.textContent = text
  }
}

export function setStyle(el, prop, value) {
  const key = `_s_${prop}`
  if (el[key] !== value) {
    el[key] = value
    el.style[prop] = value
  }
}

export function show(el, visible) {
  if (el._v !== visible) {
    el._v = visible
    el.classList.toggle('is-hidden', !visible)
  }
}
