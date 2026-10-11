// Small DOM helpers. Everything on the page is built from nodes, never from
// HTML strings, so the copy in js/data can hold any character safely.

const SVG_NS = 'http://www.w3.org/2000/svg';

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [key, value] of Object.entries(props)) {
      if (value === false || value == null) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) if (child != null && child !== false) el.append(child);
  return el;
}

// Line icons on a 24 grid, drawn in the current text colour.
const ICONS = {
  close: [['path', { d: 'M6.5 6.5l11 11M17.5 6.5l-11 11' }]],
  left: [['path', { d: 'M14.5 6l-6 6 6 6' }]],
  right: [['path', { d: 'M9.5 6l6 6-6 6' }]],
  down: [['path', { d: 'M6 9.5l6 6 6-6' }]],
  check: [['path', { d: 'M5 12.6l4.4 4.4L19 7.4' }]],
  again: [['path', { d: 'M19.5 11.5a7.5 7.5 0 1 0-2.2 5.6' }], ['path', { d: 'M19.8 5.2v6.4h-6.4' }]],
  home: [
    ['circle', { cx: 12, cy: 12, r: 4.2 }],
    ['path', { d: 'M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21' }],
  ],
  sound: [
    ['path', { d: 'M4 10v4h3.2l4.8 3.8V6.2L7.2 10H4z' }],
    ['path', { d: 'M15.5 9.2a4 4 0 0 1 0 5.6M18 6.8a7.4 7.4 0 0 1 0 10.4' }],
  ],
  mute: [
    ['path', { d: 'M4 10v4h3.2l4.8 3.8V6.2L7.2 10H4z' }],
    ['path', { d: 'M16 9.5l5 5M21 9.5l-5 5' }],
  ],
  clock: [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['path', { d: 'M12 7.8V12l2.8 2.2' }],
  ],
  child: [
    ['circle', { cx: 12, cy: 12, r: 8 }],
    ['path', { d: 'M9 10.4h.01M15 10.4h.01M8.8 14c.8 1.1 1.9 1.7 3.2 1.7s2.4-.6 3.2-1.7' }],
  ],
  drop: [['path', { d: 'M12 3.8c3.6 4.1 5.6 6.9 5.6 9.6a5.6 5.6 0 0 1-11.2 0c0-2.7 2-5.5 5.6-9.6z' }]],
  list: [['path', { d: 'M9 7h10M9 12h10M9 17h10M5 7h.01M5 12h.01M5 17h.01' }]],
};

export function icon(name, size = 20) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('icon');
  for (const [tag, attrs] of ICONS[name] || []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
    svg.append(node);
  }
  return svg;
}

const STICKERS = new URL('../../assets/stickers/', import.meta.url);

export const stickerUrl = (name) => new URL(`${name}.webp`, STICKERS).href;

// A watercolour sticker. Decorative: the name next to it carries the meaning.
export function sticker(name, size = 64) {
  return h('img', { class: 'sticker', src: stickerUrl(name), alt: '', width: size, height: size, decoding: 'async', draggable: 'false' });
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isCoarsePointer = () => window.matchMedia('(pointer: coarse)').matches;
