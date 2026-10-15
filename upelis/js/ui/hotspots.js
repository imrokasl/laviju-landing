import * as THREE from '../core/three.js';
import { clamp } from '../core/math.js';
import { h, icon, sticker, stickerUrl, prefersReducedMotion } from './dom.js';
import { TEXT } from '../data/activities.js';

// The ten markers that float over the scene. Each is a real button pinned to
// a point in the world: it is projected to the screen every frame, nudged
// clear of its neighbours, and joined to its spot by a short stem. The markers
// stay through the year; a new season gives them new names and stickers.

const _v = new THREE.Vector3();
const SIZE = 54; // badge diameter, CSS px at full scale
const LIFT = 50; // how far a badge floats above the point it marks

export function createHotspots(container, places, { onOpen }) {
  const spots = places.map((place, index) => {
    const stem = h('span', { class: 'spot__stem', 'aria-hidden': 'true' });
    const dot = h('span', { class: 'spot__dot', 'aria-hidden': 'true' });
    const art = sticker(place.sticker, 72);
    const label = h('span', { class: 'spot__label', 'aria-hidden': 'true' }, place.name);
    const button = h(
      'button',
      { class: 'spot__btn', type: 'button', 'aria-label': TEXT.open(place.name) },
      h('span', { class: 'spot__ring', 'aria-hidden': 'true' }),
      h('span', { class: 'spot__badge' }, art),
      h('span', { class: 'spot__check', 'aria-hidden': 'true' }, icon('check', 12)),
      label
    );
    const el = h('div', { class: 'spot', 'data-tone': place.tone, style: `--i:${index}` }, stem, dot, button);
    const spot = { place, el, stem, dot, button, art, label, pictured: place.sticker, turning: 0, ax: 0, ay: 0, bx: 0, by: 0, depth: 0, on: false, shown: null };
    button.addEventListener('click', () => onOpen(spot.place.id, button));
    container.append(el);
    return spot;
  });
  const byId = new Map(spots.map((s) => [s.place.id, s]));

  function update(camera, width, height, pxPerMetre) {
    // Smaller when the whole island is in view on a narrow screen
    const scale = clamp(pxPerMetre / 34, 0.66, 1);
    for (const s of spots) {
      s.place.anchor(_v).project(camera);
      s.on = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.12 && Math.abs(_v.y) < 1.2;
      s.ax = (_v.x * 0.5 + 0.5) * width;
      s.ay = (0.5 - _v.y * 0.5) * height;
      s.bx = s.ax;
      s.by = s.ay - LIFT * scale;
      s.depth = _v.z;
    }

    // Push overlapping badges apart; the stems still point home
    const gap = SIZE * scale + 6;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < spots.length; i++) {
        const a = spots[i];
        if (!a.on) continue;
        for (let j = i + 1; j < spots.length; j++) {
          const b = spots[j];
          if (!b.on) continue;
          let dx = b.bx - a.bx;
          let dy = b.by - a.by;
          const d = Math.hypot(dx, dy);
          if (d >= gap) continue;
          if (d < 0.01) {
            dx = 1;
            dy = 0;
          } else {
            dx /= d;
            dy /= d;
          }
          const push = (gap - d) / 2;
          a.bx -= dx * push;
          a.by -= dy * push * 0.7;
          b.bx += dx * push;
          b.by += dy * push * 0.7;
        }
      }
    }

    for (const s of spots) {
      if (s.on !== s.shown) {
        s.shown = s.on;
        s.el.classList.toggle('is-off', !s.on);
      }
      if (!s.on) continue;
      s.el.style.transform = `translate3d(${s.bx.toFixed(1)}px,${s.by.toFixed(1)}px,0) scale(${scale.toFixed(3)})`;
      s.el.style.zIndex = String(Math.round((1 - s.depth) * 4000));
      // The stem runs from the badge to the marked point, in the badge's own scale
      const lx = (s.ax - s.bx) / scale;
      const ly = (s.ay - s.by) / scale;
      const length = Math.hypot(lx, ly);
      s.stem.style.transform = `rotate(${Math.atan2(ly, lx).toFixed(4)}rad) scaleX(${length.toFixed(1)})`;
      s.dot.style.transform = `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0)`;
    }
  }

  function setActive(id) {
    for (const s of spots) {
      s.el.classList.toggle('is-active', s.place.id === id);
      s.el.classList.toggle('is-dim', id != null && s.place.id !== id);
    }
  }

  const describe = (s, seen) => s.button.setAttribute('aria-label', seen ? `${TEXT.open(s.place.name)} (${TEXT.visited})` : TEXT.open(s.place.name));

  function setVisited(id) {
    const s = byId.get(id);
    if (!s || s.el.classList.contains('is-visited')) return;
    s.el.classList.add('is-visited');
    describe(s, true);
  }

  // Another season: the same ten spots, as that season has them. A badge
  // whose picture changes ducks out, and comes back once the new one is in.
  function setPlaces(next, visited) {
    const still = prefersReducedMotion();
    next.forEach((place, index) => {
      const s = spots[index];
      s.place = place;
      const seen = visited.has(place.id);
      s.el.classList.toggle('is-visited', seen);
      describe(s, seen);
      s.label.textContent = place.name;
      clearTimeout(s.turning);
      const back = () => s.el.classList.remove('is-turning');
      if (s.pictured === place.sticker) {
        back();
        return;
      }
      const swap = () => {
        s.pictured = place.sticker;
        s.art.src = stickerUrl(place.sticker);
        if (s.art.complete) back();
        else {
          s.art.addEventListener('load', back, { once: true });
          s.art.addEventListener('error', back, { once: true });
          // Shown again in any case, should the picture be slow to arrive
          s.turning = setTimeout(back, 1500);
        }
      };
      if (still) {
        swap();
        return;
      }
      s.el.classList.add('is-turning');
      s.turning = setTimeout(swap, 180 + index * 26);
    });
  }

  return {
    update,
    setActive,
    setVisited,
    setPlaces,
    show() {
      container.classList.add('is-ready');
    },
    button: (id) => byId.get(id)?.button,
  };
}
