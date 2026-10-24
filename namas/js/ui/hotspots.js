import * as THREE from '../core/three.js';
import { clamp } from '../core/math.js';
import { h, icon, sticker, stickerUrl, prefersReducedMotion } from './dom.js';
import { TEXT } from '../data/house.js';

// A set of markers that float over the scene: the six areas of the house, or
// the spots of one area. Each is a real button pinned to a point in the
// world: it is projected to the screen every frame, nudged clear of its
// neighbours, and joined to its point by a short stem. Only one set is out at
// a time; the others wait hidden. The markers stay through the year; a new
// season may give them new names and stickers. An area's marker wears its
// name at all times, and how many of its spots have been found.

const _v = new THREE.Vector3();
const SIZE = 54; // badge diameter, CSS px at full scale
const AREA_SIZE = 64; // ...and an area's
const LIFT = 50; // how far a badge floats above the point it marks

export function createHotspots(container, places, { onOpen, label, kind = 'spot' }) {
  const set = h('div', { class: `spots__set spots__set--${kind}`, role: 'group', 'aria-label': label });
  container.append(set);
  const area = kind === 'area';
  const describeOf = (place) => (area ? TEXT.enter(place.name) : TEXT.open(place.name));
  let shown = false;

  const spots = places.map((place, index) => {
    const stem = h('span', { class: 'spot__stem', 'aria-hidden': 'true' });
    const dot = h('span', { class: 'spot__dot', 'aria-hidden': 'true' });
    const art = sticker(place.sticker, 72);
    const name = h('span', null, place.name);
    const count = area ? h('span', { class: 'spot__count' }) : null;
    const label = h('span', { class: 'spot__label', 'aria-hidden': 'true' }, name, count);
    const button = h(
      'button',
      { class: 'spot__btn', type: 'button', 'aria-label': describeOf(place), tabindex: '-1' },
      h('span', { class: 'spot__ring', 'aria-hidden': 'true' }),
      h('span', { class: 'spot__badge' }, art),
      h('span', { class: 'spot__check', 'aria-hidden': 'true' }, icon('check', 12)),
      label
    );
    const el = h('div', { class: `spot spot--${kind}`, 'data-tone': place.tone, style: `--i:${index}` }, stem, dot, button);
    const spot = { place, el, stem, dot, button, art, name, count, label, wide: 0, high: 0, pictured: place.sticker, turning: 0, ax: 0, ay: 0, bx: 0, by: 0, depth: 0, on: false, shown: null };
    button.addEventListener('click', () => onOpen(spot.place.id, button));
    set.append(el);
    return spot;
  });
  const byId = new Map(spots.map((s) => [s.place.id, s]));
  // The names are measured again once the page's own font is in, and when
  // the frame crosses to a phone's, where they are worn smaller
  const remeasure = () => spots.forEach((s) => (s.wide = 0));
  document.fonts?.ready.then(remeasure);
  window.matchMedia('(max-width: 760.98px)').addEventListener('change', remeasure);

  function update(camera, width, height, pxPerMetre) {
    if (!shown) return;
    // Smaller when the whole house is in view on a narrow screen
    const scale = area ? clamp(pxPerMetre / 22, 0.66, 1) : clamp(pxPerMetre / 60, 0.7, 1);
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
    if (area) part(scale);
    else {
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
    }

    for (const s of spots) {
      if (s.on !== s.shown) {
        s.shown = s.on;
        s.el.classList.toggle('is-off', !s.on);
      }
      if (!s.on) continue;
      s.el.style.transform = `translate3d(${s.bx.toFixed(1)}px,${s.by.toFixed(1)}px,0) scale(${scale.toFixed(3)})`;
      // An area's name reads over the stems of the markers above it
      s.el.style.zIndex = String(area ? Math.round(s.by + 2000) : Math.round((1 - s.depth) * 4000));
      // The stem runs from the badge to the marked point, in the badge's own scale
      const lx = (s.ax - s.bx) / scale;
      const ly = (s.ay - s.by) / scale;
      const length = Math.hypot(lx, ly);
      s.stem.style.transform = `rotate(${Math.atan2(ly, lx).toFixed(4)}rad) scaleX(${length.toFixed(1)})`;
      s.dot.style.transform = `translate3d(${lx.toFixed(1)}px,${ly.toFixed(1)}px,0)`;
    }
  }

  // An area's marker wears its name above it, so each keeps a box clear of
  // the others: as wide as the name, as tall as badge and name together. Two
  // that meet move apart the shorter way, sideways when it is close, which
  // keeps the stems short.
  function part(scale) {
    for (const s of spots) {
      if (s.wide) continue;
      s.wide = Math.max(AREA_SIZE, s.label.offsetWidth);
      // The name sits a few pixels over the badge
      s.high = AREA_SIZE + s.label.offsetHeight + 8;
    }
    for (let pass = 0; pass < 4; pass++) {
      for (let i = 0; i < spots.length; i++) {
        const a = spots[i];
        if (!a.on) continue;
        for (let j = i + 1; j < spots.length; j++) {
          const b = spots[j];
          if (!b.on) continue;
          const dx = b.bx - a.bx;
          const dy = b.by - a.by;
          const overX = ((a.wide + b.wide) / 2) * scale + 8 - Math.abs(dx);
          const overY = ((a.high + b.high) / 2) * scale + 8 - Math.abs(dy);
          if (overX <= 0 || overY <= 0) continue;
          if (overX < overY * 1.5) {
            const push = (overX / 2) * (dx < 0 ? -1 : 1);
            a.bx -= push;
            b.bx += push;
          } else {
            const push = (overY / 2) * (dy < 0 ? -1 : 1);
            a.by -= push;
            b.by += push;
          }
        }
      }
    }
  }

  function setActive(id) {
    for (const s of spots) {
      s.el.classList.toggle('is-active', s.place.id === id);
      s.el.classList.toggle('is-dim', id != null && s.place.id !== id);
    }
  }

  const describe = (s, seen) => s.button.setAttribute('aria-label', seen ? `${describeOf(s.place)} (${TEXT.visited})` : describeOf(s.place));

  function setVisited(id) {
    const s = byId.get(id);
    if (!s || s.el.classList.contains('is-visited')) return;
    s.el.classList.add('is-visited');
    describe(s, true);
  }

  // How many of an area's spots have been found; all of them puts its check on
  function setCount(id, n, total) {
    const s = byId.get(id);
    if (!s?.count) return;
    s.count.textContent = TEXT.spotsOf(n, total);
    s.wide = 0;
    const done = n === total;
    if (done !== s.el.classList.contains('is-visited')) {
      s.el.classList.toggle('is-visited', done);
      describe(s, done);
    }
  }

  // Another season: the same spots, as that season has them. A badge whose
  // picture changes ducks out, and comes back once the new one is in.
  function setPlaces(next, visited) {
    const still = prefersReducedMotion();
    next.forEach((place, index) => {
      const s = spots[index];
      s.place = place;
      if (!area) {
        const seen = visited.has(place.id);
        s.el.classList.toggle('is-visited', seen);
        describe(s, seen);
      }
      s.name.textContent = place.name;
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
      if (still || !shown) {
        swap();
        return;
      }
      s.el.classList.add('is-turning');
      s.turning = setTimeout(swap, 180 + index * 26);
    });
  }

  // Brings the set out, or sends it away. Only a set that is out can be
  // reached with the keyboard, and only it is placed every frame.
  function setShown(on) {
    if (on === shown) return;
    shown = on;
    set.classList.toggle('is-shown', on);
    for (const s of spots) {
      s.button.tabIndex = on ? 0 : -1;
      // Placed afresh when the set comes back
      s.shown = null;
    }
  }

  return {
    update,
    setActive,
    setVisited,
    setCount,
    setPlaces,
    setShown,
    get shown() {
      return shown;
    },
    button: (id) => byId.get(id)?.button,
  };
}
