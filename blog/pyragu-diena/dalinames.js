// =============================================
// PYRAGŲ DIENA — Dalinamės (#dalinames)
// The cake to slice and share: a round table seen from above, a cake server
// that follows the pointer, cuts that always go through the middle, pieces
// that part as they are cut, and two to six friends who get their pieces,
// hop and say what they think. Takes the reader's own apples from the bake
// game before it (window.pyragas.apples and the 'pyragas:iskeptas' event).
// Runs after /script.js and /blog/blog.js (reveal, tones).
// =============================================

(function () {
  'use strict';

  const root = document.getElementById('dalinames');
  if (!root) return;
  const game = root.querySelector('[data-pp-game]');
  const stage = game && game.querySelector('[data-pp-stage]');
  if (!stage) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = reduceQuery.matches;
  const hasIO = 'IntersectionObserver' in window;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const toRad = (deg) => (deg * Math.PI) / 180;
  const wrap = (deg) => ((deg % 360) + 360) % 360;
  // the smaller angle between two directions
  const apart = (a, b) => {
    const d = wrap(a - b);
    return d > 180 ? 360 - d : d;
  };
  const angleOf = (p) => wrap((Math.atan2(p.y, p.x) * 180) / Math.PI);
  const onRim = (deg, r) => ({ x: Math.cos(toRad(deg)) * r, y: Math.sin(toRad(deg)) * r });
  const pct = (value) => `${(value * 100).toFixed(3)}%`;
  const sleep = (ms) => new Promise((resolve) => window.setTimeout(resolve, ms));

  // ---------------------------------------------
  // The art and the table, in one place
  // ---------------------------------------------
  const ART_DIR = '/blog/assets/pyragu-diena/';
  const STICKERS = '/blog/assets/stickers/';

  // The cakes from above are 900 px squares with the cake a circle inside:
  // cx, cy and r are that circle as fractions of the image's width (measured
  // in GENERATED.md). `top` is the painted apple cake, `cake` the plain one
  // the reader's own apples are laid on.
  // The apple slice lies along x with its skin at the bottom (and 4° off level),
  // so `turn` lays its long axis along r with the skin facing out of the cake.
  // The knife points up: its tip at (tipX, tipY), its handle-to-tip line at `axis` degrees.
  // A plate's `fill` is its diameter against the image's width.
  const ART = {
    top: { src: `${ART_DIR}pyragas-virsus.webp`, cx: 0.4937, cy: 0.5023, r: 0.4672 },
    cake: { src: `${ART_DIR}pyrago-pagrindas.webp`, cx: 0.4968, cy: 0.5024, r: 0.4602 },
    apple: { src: `${ART_DIR}obuolio-skiltele.webp`, w: 168, h: 104, length: 0.46, turn: 184.4 },
    knife: { w: 151, h: 328, tipX: 0.4834, tipY: 0.0122, axis: -91.6, length: 1.15 },
    plate: { fill: 0.9728 },
  };

  // The round table, as fractions of the square stage's side
  // (`gap`, `box` and the knife's length are in cake radii).
  const TABLE = {
    cloth: 0.4, // radius of the tablecloth
    cake: 0.232, // radius of the cake
    platter: 0.262, // radius of the big plate under it
    seat: 0.338, // how far from the middle each friend's plate sits
    plate: 0.058, // radius of a friend's plate
    guest: 0.158, // a friend's size (the square root of the sticker's area)
    sit: 0.04, // how far a friend reaches over the cloth's edge
    served: 0.36, // the most a piece shrinks to on a friend's plate (a whole cake does)
    gap: 0.03, // how far cut pieces part
    box: 1.1, // half the side of the cake's drawing box
    hit: 1.38, // radius of the area that takes the knife
  };

  // Friends in the order they sit down; `says` is their thank-you
  const GUESTS = [
    { id: 'teddy', src: `${STICKERS}teddy.webp`, w: 352, h: 443, size: 1, says: '„Mmm, ačiū!“' },
    { id: 'cat', src: `${STICKERS}cat.webp`, w: 403, h: 480, size: 1, says: '„Murr, skanu!“' },
    { id: 'dog', src: `${STICKERS}dog.webp`, w: 409, h: 480, size: 1, says: '„Au! Ačiū!“' },
    { id: 'frog', src: `${STICKERS}frog.webp`, w: 470, h: 480, size: 0.95, says: '„Kva! Kokie obuoliai!“' },
    { id: 'cow', src: `${STICKERS}cow.webp`, w: 480, h: 403, size: 1.04, says: '„Mū! Kaip kvepia!“' },
    { id: 'bird', src: `${STICKERS}bird.webp`, w: 480, h: 354, size: 1.04, says: '„Čik čirik, ačiū!“' },
  ];

  // Where the first friend sits for each count (degrees, 0 = right, clockwise);
  // the others follow at equal steps, so a fair piece points at every friend.
  const FIRST_SEAT = { 2: 180, 3: -90, 4: -135, 5: -90, 6: -90 };
  const MIN_GUESTS = 2;
  const MAX_GUESTS = 6;
  const MAX_CUTS = 12;
  const EQUAL = 1.12; // biggest piece against the smallest that still counts as fair
  const SNAP = 8; // a cut this close to a guide line lands on it
  const SAME = 4; // a cut this close to an earlier one is the same cut

  // ---------------------------------------------
  // Words
  // ---------------------------------------------
  const PARTS = {
    2: ['pusė', 'pusę'],
    3: ['trečdalis', 'trečdalį'],
    4: ['ketvirtadalis', 'ketvirtadalį'],
    5: ['penktadalis', 'penktadalį'],
    6: ['šeštadalis', 'šeštadalį'],
    7: ['septintadalis', 'septintadalį'],
    8: ['aštuntadalis', 'aštuntadalį'],
    9: ['devintadalis', 'devintadalį'],
    10: ['dešimtadalis', 'dešimtadalį'],
    11: ['vienuoliktadalis', 'vienuoliktadalį'],
    12: ['dvyliktadalis', 'dvyliktadalį'],
  };
  const GLYPHS = { 2: '½', 3: '⅓', 4: '¼', 5: '⅕', 6: '⅙', 7: '⅐', 8: '⅛', 9: '⅑', 10: '⅒' };
  const TO_FRIENDS = ['', 'Vienam draugui', 'Dviem draugams', 'Trims draugams', 'Keturiems draugams', 'Penkiems draugams'];
  const BIGGER = [
    [1.45, 'truputį didesnis'],
    [1.75, 'gerokai didesnis'],
    [2.5, 'dvigubai didesnis'],
    [3.5, 'tris kartus didesnis'],
    [4.5, 'keturis kartus didesnis'],
    [Infinity, 'daug kartų didesnis'],
  ];
  const HINTS = {
    miss: 'Perbraukite per patį vidurį – nuo vieno krašto iki kito',
    tap: 'Bakstelėkite pyrago kraštą arba perbraukite per vidurį',
    same: 'Čia jau įpjauta',
    many: 'Gabaliukai jau labai maži!',
    served: 'Šis pyragas jau padalintas – imkite naują',
  };

  const glyph = (n) => GLYPHS[n] || `1/${n}`;
  const partOf = (n, form) => (PARTS[n] ? PARTS[n][form] : `1/${n}`);
  const them = (n) => (n === 1 ? 'jį' : 'juos');

  function pieces(n) {
    const tens = n % 100;
    if (n % 10 === 1 && tens !== 11) return `${n} gabaliukas`;
    if (n % 10 >= 2 && (tens < 12 || tens > 19)) return `${n} gabaliukai`;
    return `${n} gabaliukų`;
  }

  // ---------------------------------------------
  // The default apples, shared with the bake game: two rings, skins out
  // ---------------------------------------------
  function rosette() {
    const out = [];
    [[0.68, 12, 0], [0.38, 7, 12]].forEach(([radius, count, offset]) => {
      for (let i = 0; i < count; i += 1) {
        const a = (i / count) * 360 + offset;
        const rad = (a * Math.PI) / 180;
        out.push({ x: Math.cos(rad) * radius, y: Math.sin(rad) * radius, r: a + 90 });
      }
    });
    return out;
  }

  // Apples from outside, kept on the cake and to a sensible number
  function cleanApples(list) {
    if (!Array.isArray(list)) return null;
    const out = [];
    list.slice(0, 60).forEach((apple) => {
      if (!apple) return;
      let x = Number(apple.x);
      let y = Number(apple.y);
      const r = Number(apple.r);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      const d = Math.hypot(x, y);
      if (d > 1) {
        x /= d;
        y /= d;
      }
      out.push({ x, y, r: Number.isFinite(r) ? r : 0 });
    });
    return out;
  }

  function isRosette(list) {
    const base = rosette();
    return list.length === base.length && list.every((a, i) => (
      Math.abs(a.x - base[i].x) < 0.01 && Math.abs(a.y - base[i].y) < 0.01 && apart(a.r, base[i].r) < 1
    ));
  }

  // ---------------------------------------------
  // Elements
  // ---------------------------------------------
  const $ = (selector) => game.querySelector(selector);
  const cloth = $('[data-pp-cloth]');
  const platter = $('[data-pp-platter]');
  const seatLayer = $('[data-pp-seats]');
  const guestLayer = $('[data-pp-guests]');
  const cakeBox = $('[data-pp-cake]');
  const bitLayer = $('[data-pp-bits]');
  const pieceLayer = $('[data-pp-pieces]');
  const lineLayer = $('[data-pp-lines]');
  const fx = $('[data-pp-fx]');
  const talk = $('[data-pp-talk]');
  const knife = $('[data-pp-knife]');
  const hit = $('[data-pp-hit]');
  const badge = $('[data-pp-badge]');
  const toast = $('[data-pp-toast]');
  const doneNote = $('[data-pp-done]');
  const status = $('[data-pp-status]');
  const fracBox = $('[data-pp-frac]');
  const countOut = $('[data-pp-count]');
  const lessBtn = $('[data-pp-less]');
  const moreBtn = $('[data-pp-more]');
  const serveBtn = $('[data-pp-serve]');
  const equalBtn = $('[data-pp-equal]');
  const newBtn = $('[data-pp-new]');

  const state = {
    count: 4,
    rays: [], // cut directions in degrees, sorted
    pieces: [],
    guides: null, // the fair cuts for the current count, once the helper has shown them
    apples: rosette(),
    own: false,
    served: false,
    busy: false,
    quiet: false, // the helper is cutting: the status line waits for the end
    aim: -60, // where the keyboard's knife points
    fairAt: 0, // how many pieces there were when they last came out fair
    shared: false, // fair, and one piece for every friend
  };

  let built = false;
  let artGroup = null;
  let uid = 0;
  let side = 0; // the stage's side in px
  let touched = false;
  let demoing = false;

  // ---------------------------------------------
  // Animations: one list, so a new cake can stop everything at once
  // ---------------------------------------------
  let epoch = 0;
  const running = new Set();

  // Plays when motion is welcome; resolves when done or interrupted
  function play(el, frames, options) {
    if (reduceMotion || !el || typeof el.animate !== 'function') return Promise.resolve(false);
    const animation = el.animate(frames, options);
    running.add(animation);
    return new Promise((resolve) => {
      let called = false;
      const once = () => {
        if (called) return;
        called = true;
        running.delete(animation);
        resolve(true);
      };
      animation.addEventListener('finish', once);
      animation.addEventListener('cancel', once);
    });
  }

  function stopAll() {
    epoch += 1;
    running.forEach((animation) => animation.cancel());
    running.clear();
    demoing = false;
    state.quiet = false;
  }

  function restart(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((key) => el.setAttribute(key, attrs[key]));
    return el;
  }

  function img(src, w, h, className) {
    const el = document.createElement('img');
    el.src = src;
    el.width = w;
    el.height = h;
    el.alt = '';
    el.decoding = 'async';
    el.loading = 'lazy';
    if (className) el.className = className;
    return el;
  }

  // Centre an element on (x, y) of the stage, `w` wide (fractions of the side)
  function place(el, x, y, w, h) {
    el.style.left = pct(x - w / 2);
    el.style.top = pct(y - (h == null ? w : h) / 2);
    el.style.width = pct(w);
    if (h != null) el.style.height = pct(h);
  }

  // ---------------------------------------------
  // The table: cloth, platter, cake box, the knife's size
  // ---------------------------------------------
  function layout() {
    place(cloth, 0.5, 0.5, TABLE.cloth * 2);
    place(platter, 0.5, 0.5, (TABLE.platter * 2) / ART.plate.fill);
    place(cakeBox, 0.5, 0.5, TABLE.cake * TABLE.box * 2);
    place(hit, 0.5, 0.5, TABLE.cake * TABLE.hit * 2);
    knife.style.width = pct((ART.knife.length * TABLE.cake * ART.knife.w) / ART.knife.h);
    knife.style.transformOrigin = `${ART.knife.tipX * 100}% ${ART.knife.tipY * 100}%`;
  }

  const seatAngle = (i, n) => FIRST_SEAT[n] + (i * 360) / n;
  const guideAngles = (n) => Array.from({ length: n }, (_, i) => wrap(seatAngle(i, n) + 180 / n));

  function guestSize(guest) {
    const ratio = Math.sqrt(guest.w / guest.h);
    const size = TABLE.guest * guest.size;
    return { w: size * ratio, h: size / ratio };
  }

  // A friend sits just outside the cloth, a little over its edge
  function guestSpot(guest, angle) {
    const box = guestSize(guest);
    const ux = Math.cos(toRad(angle));
    const uy = Math.sin(toRad(angle));
    const d = TABLE.cloth - TABLE.sit + (box.w / 2) * Math.abs(ux) + (box.h / 2) * Math.abs(uy);
    return {
      x: clamp(0.5 + ux * d, box.w / 2, 1 - box.w / 2),
      y: clamp(0.5 + uy * d, box.h / 2, 1 - box.h / 2),
      w: box.w,
      h: box.h,
      back: uy < -0.3, // behind the table, so the cloth covers their feet
    };
  }

  const seatSpot = (angle) => ({ x: 0.5 + Math.cos(toRad(angle)) * TABLE.seat, y: 0.5 + Math.sin(toRad(angle)) * TABLE.seat });

  // Each friend: a sticker (behind or in front of the cloth), a plate and a bubble
  const friends = GUESTS.map((guest) => ({ guest, el: null, seat: null, bubble: null, at: null }));

  function makeFriend(friend) {
    const { guest } = friend;
    friend.el = document.createElement('span');
    friend.el.className = 'pp-guest';
    const body = document.createElement('span');
    body.className = 'pp-guest__body';
    body.appendChild(img(guest.src, guest.w, guest.h, 'pp-guest__img'));
    friend.el.appendChild(body);
    friend.body = body;

    friend.seat = document.createElement('span');
    friend.seat.className = 'pp-seat';
    friend.seat.appendChild(img(`${ART_DIR}lekstute.webp`, 326, 328, 'pp-seat__plate'));
    friend.seat.appendChild(img(`${ART_DIR}trupiniai.webp`, 430, 432, 'pp-seat__crumbs'));

    friend.bubble = document.createElement('span');
    friend.bubble.className = 'pp-bubble talk-bubble talk-bubble--sm';
  }

  function seatFriends(animate) {
    const n = state.count;
    friends.forEach((friend, i) => {
      if (i >= n) {
        if (!friend.el || !friend.el.isConnected) return;
        const { el, seat } = friend;
        friend.at = null;
        hideBubble(friend);
        Promise.all([
          play(el, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(8%) scale(0.6)' }], { duration: 320, easing: 'ease-in' }),
          play(seat, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }),
        ]).then(() => {
          if (i >= state.count) {
            el.remove();
            seat.remove();
          }
        });
        return;
      }
      if (!friend.el) makeFriend(friend);
      const angle = seatAngle(i, n);
      const spot = guestSpot(friend.guest, angle);
      const plate = seatSpot(angle);
      const before = friend.at;
      const fresh = !friend.el.isConnected;
      friend.angle = angle;
      friend.at = spot;
      friend.plateAt = plate;
      place(friend.el, spot.x, spot.y, spot.w, spot.h);
      friend.el.classList.toggle('is-back', spot.back);
      place(friend.seat, plate.x, plate.y, (TABLE.plate * 2) / ART.plate.fill);
      if (fresh) {
        guestLayer.appendChild(friend.el);
        seatLayer.appendChild(friend.seat);
        if (animate) {
          play(friend.el, [
            { opacity: 0, transform: 'translateY(14%) scale(0.5)' },
            { opacity: 1, transform: 'translateY(-10%) scale(1.04)', offset: 0.6 },
            { opacity: 1, transform: 'none' },
          ], { duration: 520, delay: 80, easing: 'ease-out', fill: 'backwards' });
          play(friend.seat, [{ opacity: 0, transform: 'scale(0.7)' }, { opacity: 1, transform: 'none' }], { duration: 360, delay: 40, easing: 'ease-out', fill: 'backwards' });
        }
      } else if (animate && before && side) {
        // Hop from the old chair to the new one
        const dx = (before.x - spot.x) * side;
        const dy = (before.y - spot.y) * side;
        play(friend.el, [
          { transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` },
          { transform: `translate(${(dx / 2).toFixed(1)}px, ${(dy / 2 - side * 0.05).toFixed(1)}px)`, offset: 0.45 },
          { transform: 'none' },
        ], { duration: 560, easing: 'cubic-bezier(0.34, 1.2, 0.64, 1)' });
        const pdx = (friend.plateBefore.x - plate.x) * side;
        const pdy = (friend.plateBefore.y - plate.y) * side;
        play(friend.seat, [{ transform: `translate(${pdx.toFixed(1)}px, ${pdy.toFixed(1)}px)` }, { transform: 'none' }], { duration: 480, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
      }
      friend.plateBefore = plate;
    });
  }

  // ---------------------------------------------
  // The cake: the plain top and the apples, drawn once and copied into every piece
  // ---------------------------------------------
  function cakeImage(art) {
    const width = 1 / art.r; // the cake's radius is the unit
    return svgEl('image', {
      href: art.src,
      x: (-art.cx * width).toFixed(4),
      y: (-art.cy * width).toFixed(4),
      width: width.toFixed(4),
      height: width.toFixed(4),
    });
  }

  // Baked apples: a touch warmer than raw ones, each with a soft shadow on the sponge
  let bakedFilter = false;
  function addBakedFilter() {
    if (bakedFilter) return;
    bakedFilter = true;
    const holder = svgEl('svg', { class: 'pp-defs', width: '0', height: '0', focusable: 'false' });
    const filter = svgEl('filter', { id: 'pp-baked', x: '-0.3', y: '-0.3', width: '1.6', height: '1.7', 'color-interpolation-filters': 'sRGB' });
    filter.appendChild(svgEl('feColorMatrix', { in: 'SourceGraphic', type: 'matrix', values: '1 0.03 0 0 0  0.02 0.95 0.02 0 0  0 0.05 0.8 0 0  0 0 0 1 0', result: 'warm' }));
    filter.appendChild(svgEl('feGaussianBlur', { in: 'SourceAlpha', stdDeviation: '0.022' }));
    filter.appendChild(svgEl('feOffset', { dx: '0.008', dy: '0.022', result: 'drop' }));
    filter.appendChild(svgEl('feFlood', { 'flood-color': '#7A4B0E', 'flood-opacity': '0.38' }));
    filter.appendChild(svgEl('feComposite', { in2: 'drop', operator: 'in', result: 'shadow' }));
    const merge = svgEl('feMerge');
    merge.appendChild(svgEl('feMergeNode', { in: 'shadow' }));
    merge.appendChild(svgEl('feMergeNode', { in: 'warm' }));
    filter.appendChild(merge);
    const defs = svgEl('defs');
    defs.appendChild(filter);
    holder.appendChild(defs);
    cakeBox.appendChild(holder);
  }

  function buildArt() {
    const group = svgEl('g');
    // The painted apple cake, unless the reader laid out apples their own way in the bake game
    if (isRosette(state.apples)) {
      group.appendChild(cakeImage(ART.top));
      artGroup = group;
      return;
    }
    group.appendChild(cakeImage(ART.cake));
    if (state.apples.length) addBakedFilter();
    const length = ART.apple.length;
    const height = (length * ART.apple.h) / ART.apple.w;
    state.apples.forEach((apple) => {
      // the shadow falls the same way for every slice, so the turn goes inside
      const spot = svgEl('g', { transform: `translate(${apple.x.toFixed(4)} ${apple.y.toFixed(4)})`, filter: 'url(#pp-baked)' });
      spot.appendChild(svgEl('image', {
        href: ART.apple.src,
        x: (-length / 2).toFixed(4),
        y: (-height / 2).toFixed(4),
        width: length.toFixed(4),
        height: height.toFixed(4),
        transform: `rotate(${(apple.r + ART.apple.turn).toFixed(2)})`,
      }));
      group.appendChild(spot);
    });
    artGroup = group;
  }

  // The pieces between neighbouring cuts (a whole cake until there are two)
  function piecesOf(rays) {
    if (rays.length < 2) return [{ from: rays.length ? rays[0] : -90, size: 360, whole: true }];
    return rays.map((from, i) => {
      const to = i + 1 < rays.length ? rays[i + 1] : rays[0] + 360;
      return { from, size: to - from, whole: false };
    });
  }

  const midOf = (piece) => piece.from + piece.size / 2;
  const holds = (piece, angle) => piece.whole || wrap(angle - piece.from) < piece.size;

  function wedge(from, size, r) {
    const a = onRim(from, r);
    const b = onRim(from + size, r);
    return `M0 0L${a.x.toFixed(4)} ${a.y.toFixed(4)}A${r} ${r} 0 ${size > 180 ? 1 : 0} 1 ${b.x.toFixed(4)} ${b.y.toFixed(4)}Z`;
  }

  // Where a piece's middle is, in % of the cake box (for scaling it on the way to a plate)
  function centroid(piece) {
    if (piece.whole) return { x: 50, y: 50 };
    const a = toRad(piece.size);
    const d = (4 * Math.sin(a / 2)) / (3 * a);
    const p = onRim(midOf(piece), d);
    return { x: 50 + (p.x / (2 * TABLE.box)) * 100, y: 50 + (p.y / (2 * TABLE.box)) * 100 };
  }

  // How far a piece has parted from the middle, as a transform in % of the cake box
  function partedBy(piece, extra) {
    if (piece.whole) return 'translate(0%, 0%) scale(1)';
    const p = onRim(midOf(piece), TABLE.gap + (extra || 0));
    return `translate(${((p.x / (2 * TABLE.box)) * 100).toFixed(3)}%, ${((p.y / (2 * TABLE.box)) * 100).toFixed(3)}%) scale(1)`;
  }

  function fracEl(n) {
    const frac = document.createElement('span');
    frac.className = 'pp-frac';
    const top = document.createElement('span');
    top.className = 'pp-frac__n';
    top.textContent = '1';
    const bottom = document.createElement('span');
    bottom.className = 'pp-frac__d';
    bottom.textContent = String(n);
    frac.append(top, bottom);
    return frac;
  }

  function pieceEl(piece, total) {
    const el = document.createElement('span');
    el.className = piece.whole ? 'pp-piece' : 'pp-piece is-part';
    const art = artGroup.cloneNode(true);
    const svg = svgEl('svg', { viewBox: `${-TABLE.box} ${-TABLE.box} ${TABLE.box * 2} ${TABLE.box * 2}`, focusable: 'false' });
    if (piece.whole) {
      svg.appendChild(art);
      svg.appendChild(svgEl('circle', { class: 'pp-piece__rim', r: 1 }));
    } else {
      const id = `pp-wedge-${(uid += 1)}`;
      const clip = svgEl('clipPath', { id });
      clip.appendChild(svgEl('path', { d: wedge(piece.from, piece.size, TABLE.box) }));
      const defs = svgEl('defs');
      defs.appendChild(clip);
      const cut = svgEl('g', { 'clip-path': `url(#${id})` });
      cut.appendChild(art);
      // the cut faces catch a little shadow
      const a = onRim(piece.from, 1.02);
      const b = onRim(piece.from + piece.size, 1.02);
      cut.appendChild(svgEl('path', { class: 'pp-piece__cut', d: `M${a.x.toFixed(4)} ${a.y.toFixed(4)}L0 0L${b.x.toFixed(4)} ${b.y.toFixed(4)}` }));
      svg.append(defs, cut, svgEl('path', { class: 'pp-piece__rim', d: wedge(piece.from, piece.size, 1) }));

      const label = document.createElement('span');
      label.className = 'pp-label';
      const at = onRim(midOf(piece), 0.6);
      label.style.left = `${50 + (at.x / (2 * TABLE.box)) * 100}%`;
      label.style.top = `${50 + (at.y / (2 * TABLE.box)) * 100}%`;
      label.appendChild(fracEl(total));
      el.appendChild(label);
    }
    el.insertBefore(svg, el.firstChild);
    const c = centroid(piece);
    el.style.transformOrigin = `${c.x.toFixed(3)}% ${c.y.toFixed(3)}%`;
    return el;
  }

  // Lays the pieces out; new ones start where the piece they came from was
  function renderPieces(before) {
    const list = piecesOf(state.rays);
    pieceLayer.textContent = '';
    list.forEach((piece) => {
      piece.el = pieceEl(piece, list.length);
      piece.el.style.transform = partedBy(piece);
      pieceLayer.appendChild(piece.el);
      const parent = before && before.find((old) => holds(old, midOf(piece)));
      if (parent && list.length > 1) {
        play(piece.el, [{ transform: partedBy(parent) }, { transform: partedBy(piece) }], { duration: 620, easing: 'cubic-bezier(0.34, 1.45, 0.64, 1)' });
      }
    });
    state.pieces = list;
    judge();
  }

  // ---------------------------------------------
  // Lines on the cake: cuts, the fair guides, the drag preview, the keyboard's aim
  // ---------------------------------------------
  function makeLine(kind) {
    const el = document.createElement('span');
    el.className = `pp-line pp-line--${kind}`;
    const bar = document.createElement('span');
    bar.className = 'pp-line__bar';
    el.appendChild(bar);
    lineLayer.appendChild(el);
    return el;
  }

  // A line at `angle` from r0 to r1 (cake radii, negative is the other side)
  function aimLine(el, angle, r0, r1) {
    const span = TABLE.box * 2;
    el.style.transform = `rotate(${angle.toFixed(2)}deg)`;
    el.firstChild.style.left = pct(0.5 + r0 / span);
    el.firstChild.style.width = pct((r1 - r0) / span);
  }

  const preview = makeLine('preview');
  const aim = makeLine('aim');
  let slits = [];
  let guideEls = [];

  function drawGuides(animate) {
    guideEls.forEach((el) => el.remove());
    guideEls = [];
    if (!state.guides) return;
    state.guides.forEach((angle, i) => {
      const el = makeLine('guide');
      aimLine(el, angle, 0, 1.16);
      guideEls.push(el);
      if (animate) {
        play(el.firstChild, [{ transform: 'scaleX(0)', opacity: 0 }, { transform: 'scaleX(1)', opacity: 1 }], { duration: 420, delay: i * 70, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'backwards' });
      }
    });
  }

  // Every guide is cut now: the dotted lines have done their job
  function fadeGuides() {
    const old = guideEls;
    guideEls = [];
    state.guides = null;
    old.forEach((el) => play(el, [{ opacity: 1 }, { opacity: 0 }], { duration: 420 }).then(() => el.remove()));
  }

  function clearSlits() {
    slits.forEach((slit) => slit.el.remove());
    slits = [];
  }

  // A cut drawn in along a ray: 'out' from the middle, 'in' from the crust
  function slit(angle, way, duration, delay) {
    const el = makeLine('slit');
    aimLine(el, angle, 0, 1.03);
    el.firstChild.style.transformOrigin = way === 'out' ? '0 50%' : '100% 50%';
    slits.push({ el, angle });
    play(el.firstChild, [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration, delay, easing: 'ease-in-out', fill: 'backwards' });
    const a = way === 'out' ? { x: 0, y: 0 } : onRim(angle, 1);
    const b = way === 'out' ? onRim(angle, 1) : { x: 0, y: 0 };
    sprinkle(a, b, 6, duration, delay);
  }

  // Once the pieces part, the cut lines are gaps instead
  function settleSlits() {
    if (state.rays.length < 2) return;
    const old = slits;
    slits = [];
    old.forEach((item) => {
      play(item.el, [{ opacity: 1 }, { opacity: 0 }], { duration: 260, delay: 160 }).then(() => item.el.remove());
    });
  }

  // ---------------------------------------------
  // Crumbs: a few fly off every cut, and two stay on the plate by the crust
  // ---------------------------------------------
  const CRUMB_COLORS = ['#E2A55A', '#D08B3E', '#EDC27B', '#C9803A'];

  function crumb(layer, x, y, size) {
    const el = document.createElement('span');
    el.className = 'pp-crumb';
    el.style.left = pct(x);
    el.style.top = pct(y);
    el.style.width = `${size.toFixed(1)}px`;
    el.style.height = `${(size * (0.7 + Math.random() * 0.4)).toFixed(1)}px`;
    el.style.background = CRUMB_COLORS[Math.floor(Math.random() * CRUMB_COLORS.length)];
    el.style.borderRadius = `${40 + Math.random() * 20}% ${60 - Math.random() * 20}% ${45 + Math.random() * 15}% ${55 - Math.random() * 15}%`;
    layer.appendChild(el);
    return el;
  }

  // Crumbs along a cut from a to b (cake radii) while it is drawn
  function sprinkle(a, b, count, duration, delay) {
    if (reduceMotion) return;
    const unit = side * TABLE.cake;
    for (let i = 0; i < count; i += 1) {
      const t = (i + Math.random()) / count;
      const x = 0.5 + (a.x + (b.x - a.x) * t) * TABLE.cake;
      const y = 0.5 + (a.y + (b.y - a.y) * t) * TABLE.cake;
      const el = crumb(fx, x, y, 2.5 + Math.random() * 3.5);
      const throwX = (Math.random() - 0.5) * unit * 0.32;
      const throwY = (Math.random() - 0.5) * unit * 0.32 - unit * 0.05;
      play(el, [
        { transform: 'translate(-50%, -50%) scale(0.4)', opacity: 0 },
        { transform: `translate(calc(-50% + ${(throwX * 0.6).toFixed(1)}px), calc(-50% + ${(throwY * 0.6 - unit * 0.08).toFixed(1)}px)) scale(1.1) rotate(80deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(calc(-50% + ${throwX.toFixed(1)}px), calc(-50% + ${throwY.toFixed(1)}px)) scale(0.9) rotate(160deg)`, opacity: 0 },
      ], { duration: 560 + Math.random() * 260, delay: delay + duration * t, easing: 'cubic-bezier(0.3, 0.6, 0.4, 1)', fill: 'backwards' }).then(() => el.remove());
    }
  }

  // A ring of honey sparkles round the platter when the shares come out fair,
  // and the friends hop for joy one after another
  function sparkle() {
    if (reduceMotion) return;
    const my = epoch;
    seated().forEach((friend, i) => window.setTimeout(() => {
      if (my === epoch) hop(friend);
    }, 140 + i * 90));
    const count = 12;
    const turn = Math.random() * 30;
    for (let i = 0; i < count; i += 1) {
      const p = onRim(turn + (i * 360) / count, 1);
      const el = document.createElement('span');
      el.className = 'pp-spark';
      el.style.left = pct(0.5 + p.x * TABLE.platter);
      el.style.top = pct(0.5 + p.y * TABLE.platter);
      fx.appendChild(el);
      const out = side * (0.04 + Math.random() * 0.05);
      const size = 0.75 + Math.random() * 0.5;
      const to = (k) => `translate(calc(-50% + ${(p.x * out * k).toFixed(1)}px), calc(-50% + ${(p.y * out * k).toFixed(1)}px))`;
      play(el, [
        { transform: `${to(0)} scale(0) rotate(0deg)`, opacity: 0 },
        { transform: `${to(0.55)} scale(${size.toFixed(2)}) rotate(60deg)`, opacity: 1, offset: 0.3 },
        { transform: `${to(0.85)} scale(${(size * 0.9).toFixed(2)}) rotate(110deg)`, opacity: 1, offset: 0.65 },
        { transform: `${to(1)} scale(0) rotate(150deg)`, opacity: 0 },
      ], { duration: 1150, delay: i * 30, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', fill: 'backwards' }).then(() => el.remove());
    }
  }

  function leaveCrumbs(angle) {
    for (let i = 0; i < 2; i += 1) {
      const p = onRim(angle + (Math.random() - 0.5) * 14, 1.03 + Math.random() * 0.06);
      crumb(bitLayer, 0.5 + p.x / (2 * TABLE.box), 0.5 + p.y / (2 * TABLE.box), 2 + Math.random() * 2.5);
    }
  }

  // ---------------------------------------------
  // The knife: follows the pointer, sweeps along the cuts the script makes
  // ---------------------------------------------
  const knifeSize = () => ({
    w: ((ART.knife.length * TABLE.cake * ART.knife.w) / ART.knife.h) * side,
    h: ART.knife.length * TABLE.cake * side,
  });

  // The knife's tip at p (cake radii), the blade pointing along `angle`;
  // a pointer dragged far off the table leaves the knife at the cloth's edge
  function knifePose(p, angle, lift) {
    const size = knifeSize();
    const reach = Math.min(1, 1.6 / (Math.hypot(p.x, p.y) || 1));
    const x = (0.5 + p.x * reach * TABLE.cake) * side - ART.knife.tipX * size.w;
    const y = (0.5 + p.y * reach * TABLE.cake) * side - ART.knife.tipY * size.h;
    return `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(angle - ART.knife.axis).toFixed(1)}deg) scale(${lift ? 1.06 : 1})`;
  }

  function knifeTo(p, angle, lift) {
    knife.style.transform = knifePose(p, angle, lift);
    knife.classList.add('is-on');
    knife.classList.toggle('is-lifted', Boolean(lift));
  }

  function knifeAway() {
    knife.classList.remove('is-on', 'is-lifted');
  }

  // The knife's tip slides from a to b, blade first
  function sweep(a, b, duration) {
    const angle = angleOf({ x: b.x - a.x, y: b.y - a.y });
    knifeTo(b, angle, true);
    return play(knife, [{ transform: knifePose(a, angle, true) }, { transform: knifePose(b, angle, true) }], { duration, easing: 'cubic-bezier(0.45, 0, 0.25, 1)' });
  }

  // ---------------------------------------------
  // How fair is it? Status, the fraction, the biggest and smallest piece
  // ---------------------------------------------
  let lastText = '';
  let proudTimer = 0;

  // A dash never starts a line, and a number stays with its word
  const keepTogether = (text) => text.replace(/ – /g, ' – ').replace(/([\d½⅓¼⅕⅙⅐⅛⅑⅒]) (?=[^\s–])/g, '$1 ');

  function say(raw) {
    const text = keepTogether(raw);
    if (text === lastText) return;
    lastText = text;
    status.textContent = text;
  }

  function sizesOf(list) {
    const sizes = list.map((piece) => piece.size);
    const max = Math.max(...sizes);
    const min = Math.min(...sizes);
    return { max, min, ratio: max / min };
  }

  function judge() {
    const n = state.count;
    const list = state.pieces;
    const total = list.length;
    const cuts = state.rays.length;
    let text;
    let fair = false;
    list.forEach((piece) => piece.el && piece.el.classList.remove('is-big', 'is-small'));
    // while the helper cuts, the line waits for the last cut
    if (state.quiet) return;

    if (cuts === 0) {
      text = `Prie stalo ${n} draugai, o pyragas – vienas. Kaip padalinti, kad visiems užtektų?`;
    } else if (cuts === 1) {
      text = 'Vienas pjūvis pyrago dar nepadalina. Pjaukite dar kartą!';
    } else {
      const { ratio } = sizesOf(list);
      fair = ratio <= EQUAL;
      if (total < n) {
        text = `Gabaliukų ${total}, o draugų ${n}. Kam neužteks?`;
      } else if (total > n) {
        const extra = total - n;
        text = `Gabaliukų ${total}, o draugų ${n} – ${extra === 1 ? 'vienas liks' : `${pieces(extra)} liks`}. Kam ${them(extra)} padovanosime? Gal kaimynei, močiutei ar darželio draugams?`;
      } else if (fair) {
        text = `Visiems po lygiai! Kiekvienas gauna ${partOf(total, 1)} – ${glyph(total)} pyrago.`;
      } else {
        const word = BIGGER.find(([limit]) => ratio <= limit)[1];
        text = `Šitas gabalas ${word} už aną. Ar sąžininga?`;
        const big = list.reduce((a, b) => (b.size > a.size ? b : a));
        const small = list.reduce((a, b) => (b.size < a.size ? b : a));
        big.el.classList.add('is-big');
        small.el.classList.add('is-small');
      }
    }

    // fresh fair pieces show their fractions for a moment; one each for everyone sparkles
    const shared = fair && total === n;
    if (fair && state.fairAt !== total) showFractions();
    if (shared && !state.shared) sparkle();
    state.fairAt = fair ? total : 0;
    state.shared = shared;
    stage.classList.toggle('is-fair', fair);
    fracBox.textContent = '';
    if (fair) fracBox.appendChild(fracEl(total));
    fracBox.classList.toggle('is-on', shared);
    say(text);
  }

  // The fractions stay up on every piece for a moment after it comes out fair
  function showFractions() {
    stage.classList.add('is-proud');
    window.clearTimeout(proudTimer);
    proudTimer = window.setTimeout(() => stage.classList.remove('is-proud'), 2800);
  }

  let toastTimer = 0;
  function hint(text) {
    toast.textContent = keepTogether(text);
    restart(toast, 'is-on');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-on'), 2600);
  }

  function setBusy(on) {
    state.busy = on;
    stage.classList.toggle('is-busy', on);
    updateButtons();
  }

  // Buttons stay focusable while they wait (aria-disabled), so keyboard focus is never lost
  function updateButtons() {
    const lock = (button, off) => button.setAttribute('aria-disabled', String(Boolean(off)));
    lock(serveBtn, state.busy || state.served);
    lock(equalBtn, state.busy);
    lock(lessBtn, state.busy || state.count <= MIN_GUESTS);
    lock(moreBtn, state.busy || state.count >= MAX_GUESTS);
    countOut.textContent = String(state.count);
  }

  const isOff = (button) => button.getAttribute('aria-disabled') === 'true';

  // ---------------------------------------------
  // Cutting
  // ---------------------------------------------
  // New cut directions, snapped to a guide when one is near, without repeats
  function settle(rays) {
    const out = [];
    rays.forEach((ray) => {
      let angle = wrap(ray);
      if (state.guides) {
        const near = state.guides.reduce((a, b) => (apart(b, angle) < apart(a, angle) ? b : a));
        if (apart(near, angle) <= SNAP) angle = near;
      }
      if (state.rays.concat(out).some((other) => apart(other, angle) < SAME)) return;
      out.push(angle);
    });
    return out;
  }

  function commit(rays) {
    const before = state.pieces;
    state.rays = state.rays.concat(rays).sort((a, b) => a - b);
    rays.forEach(leaveCrumbs);
    renderPieces(before);
    settleSlits();
  }

  // Checks a cut before it is made; says why not when it can't be
  function allowed(rays) {
    if (state.served) {
      hint(HINTS.served);
      return null;
    }
    const fresh = settle(rays);
    if (!fresh.length) {
      hint(HINTS.same);
      return null;
    }
    if (state.rays.length + fresh.length > MAX_CUTS) {
      hint(HINTS.many);
      return null;
    }
    return fresh;
  }

  // A cut the reader drew: it happens at once, the line follows their stroke
  function cutByHand(read) {
    const rays = allowed(read.rays);
    if (!rays) return;
    rays.forEach((angle) => {
      let way = read.way;
      let delay = 0;
      if (read.kind === 'cut') {
        // the half where the stroke began is drawn first, toward the middle
        const first = apart(angle, read.start) < 90;
        way = first ? 'in' : 'out';
        delay = first ? 0 : 130;
      }
      slit(angle, way, 150, delay);
    });
    commit(rays);
  }

  // A cut the script makes: the knife sweeps along it first
  async function cutWithKnife(rays, my) {
    if (rays.length === 2 && apart(rays[0], rays[1]) > 179) {
      // through the middle: crust to crust
      const [a, b] = rays;
      slit(a, 'in', 300, 0);
      slit(b, 'out', 300, 300);
      await sweep(onRim(a, 1.12), onRim(b, 1.12), 600);
    } else {
      rays.forEach((angle) => slit(angle, 'in', 360, 0));
      await sweep(onRim(rays[0], 1.12), { x: 0, y: 0 }, 380);
    }
    if (my !== epoch) return;
    commit(rays);
  }

  // A tap on the crust or Enter on the keyboard: one cut from the crust to the middle
  async function cutAt(angle, keepAim) {
    if (state.busy) return;
    const rays = allowed([angle]);
    if (!rays) return;
    const my = epoch;
    setBusy(true);
    await cutWithKnife(rays, my);
    if (my !== epoch) return;
    setBusy(false);
    if (keepAim) showAim();
    else knifeAway();
  }

  // ---------------------------------------------
  // Reading a stroke: through the middle, from the middle out, or a tap
  // ---------------------------------------------
  function nearestToMiddle(path) {
    let best = Infinity;
    for (let i = 1; i < path.length; i += 1) {
      const a = path[i - 1];
      const b = path[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = dx * dx + dy * dy;
      const t = len ? clamp(-(a.x * dx + a.y * dy) / len, 0, 1) : 0;
      best = Math.min(best, Math.hypot(a.x + dx * t, a.y + dy * t));
    }
    return path.length > 1 ? best : Math.hypot(path[0].x, path[0].y);
  }

  function readStroke(a, b, path) {
    const ra = Math.hypot(a.x, a.y);
    const rb = Math.hypot(b.x, b.y);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.1) {
      if (rb >= 0.55 && rb <= TABLE.hit) return { kind: 'tap', rays: [angleOf(b)] };
      return { kind: 'tapmiss' };
    }
    if (ra <= 0.35 && rb >= 0.78) return { kind: 'ray', rays: [angleOf(b)], way: 'out' };
    if (rb <= 0.35 && ra >= 0.78) return { kind: 'ray', rays: [angleOf(a)], way: 'in' };
    if (ra >= 0.45 && rb >= 0.45 && apart(angleOf(a), angleOf(b)) >= 130 && nearestToMiddle(path) <= 0.3) {
      const t = angleOf({ x: b.x - a.x, y: b.y - a.y });
      return { kind: 'cut', rays: [t + 180, t], start: angleOf(a) };
    }
    return { kind: 'miss' };
  }

  function showPreview(read) {
    if (!read || (read.kind !== 'cut' && read.kind !== 'ray') || state.served) {
      preview.classList.remove('is-on');
      return;
    }
    const snapped = read.rays.map((ray) => {
      if (!state.guides) return ray;
      const near = state.guides.reduce((a, b) => (apart(b, ray) < apart(a, ray) ? b : a));
      return apart(near, ray) <= SNAP ? near : ray;
    });
    if (read.kind === 'cut') aimLine(preview, snapped[1], -1.12, 1.12);
    else aimLine(preview, snapped[0], 0, 1.12);
    preview.classList.add('is-on');
  }

  // ---------------------------------------------
  // Pointer: drag across the middle or out from it, or tap the crust
  // ---------------------------------------------
  let stroke = null;

  function toCake(event) {
    const box = stage.getBoundingClientRect();
    side = box.width || side;
    return {
      x: ((event.clientX - box.left) / box.width - 0.5) / TABLE.cake,
      y: ((event.clientY - box.top) / box.height - 0.5) / TABLE.cake,
    };
  }

  // Hovering, the blade points at the middle of the cake
  let hoverAngle = -60;
  function towardMiddle(p) {
    if (Math.hypot(p.x, p.y) > 0.25) hoverAngle = angleOf({ x: -p.x, y: -p.y });
    return hoverAngle;
  }

  function endDemo() {
    if (!demoing) return;
    stopAll();
    preview.classList.remove('is-on');
    knife.classList.remove('is-demo');
  }

  hit.addEventListener('pointerdown', (event) => {
    if (!built || (event.pointerType === 'mouse' && event.button !== 0)) return;
    touched = true;
    endDemo();
    hideAim();
    const p = toCake(event);
    stroke = { id: event.pointerId, type: event.pointerType, start: p, path: [p] };
    try {
      hit.setPointerCapture(event.pointerId);
    } catch (error) {
      // capture is a nicety; the stroke still works inside the cake
    }
    if (!state.busy) knifeTo(p, towardMiddle(p), true);
  });

  hit.addEventListener('pointermove', (event) => {
    if (!built) return;
    const p = toCake(event);
    if (stroke && event.pointerId === stroke.id) {
      if (stroke.path.length < 240) stroke.path.push(p);
      if (state.busy) return;
      const dx = p.x - stroke.start.x;
      const dy = p.y - stroke.start.y;
      knifeTo(p, Math.hypot(dx, dy) > 0.14 ? angleOf({ x: dx, y: dy }) : towardMiddle(p), true);
      showPreview(readStroke(stroke.start, p, stroke.path));
      return;
    }
    if (event.pointerType === 'mouse' && !state.busy && !state.served && !demoing) knifeTo(p, towardMiddle(p), false);
  });

  hit.addEventListener('pointerup', (event) => {
    if (!stroke || event.pointerId !== stroke.id) return;
    const done = stroke;
    stroke = null;
    preview.classList.remove('is-on');
    const p = toCake(event);
    const mouse = done.type === 'mouse';
    if (state.busy) return;
    done.path.push(p);
    const read = readStroke(done.start, p, done.path);
    if (read.kind === 'tap') {
      cutAt(read.rays[0]).then(() => {
        if (mouse && hit.matches(':hover') && !state.busy) knifeTo(p, towardMiddle(p), false);
      });
      return;
    }
    if (read.kind === 'cut' || read.kind === 'ray') cutByHand(read);
    else if (state.served) hint(HINTS.served);
    else hint(read.kind === 'tapmiss' ? HINTS.tap : HINTS.miss);
    if (mouse && !state.served) knifeTo(p, towardMiddle(p), false);
    else knifeAway();
  });

  const dropStroke = () => {
    if (!stroke) return;
    stroke = null;
    preview.classList.remove('is-on');
    if (!state.busy) knifeAway();
  };
  hit.addEventListener('pointercancel', dropStroke);
  // a finger resting on the cake is still cutting, not asking for a menu
  hit.addEventListener('contextmenu', (event) => event.preventDefault());
  hit.addEventListener('lostpointercapture', () => {
    if (stroke) dropStroke();
  });
  hit.addEventListener('pointerleave', (event) => {
    if (!stroke && event.pointerType === 'mouse' && !state.busy && !demoing) knifeAway();
  });

  // ---------------------------------------------
  // Keyboard: arrows turn the knife, Enter or Space cuts there
  // ---------------------------------------------
  function clockText(angle) {
    const hours = wrap(angle + 90) / 30;
    const whole = Math.round(hours);
    if (Math.abs(hours - whole) < 0.01) return `Peilis ties ${whole % 12 || 12} val.`;
    const a = Math.floor(hours) % 12 || 12;
    const b = Math.ceil(hours) % 12 || 12;
    return `Peilis tarp ${a} ir ${b} val.`;
  }

  function showAim() {
    if (state.served || !built) return;
    aimLine(aim, state.aim, 0, 1.06);
    aim.classList.add('is-on');
    knifeTo(onRim(state.aim, 1.12), state.aim + 180, false);
  }

  function hideAim() {
    aim.classList.remove('is-on');
  }

  function turnAim(step) {
    if (state.guides && step) {
      // with guides up, the arrows go from one fair cut to the next
      const sorted = state.guides.slice().sort((a, b) => a - b);
      const now = wrap(state.aim);
      const ahead = step > 0 ? sorted.filter((g) => g > now + 0.5) : sorted.filter((g) => g < now - 0.5);
      if (step > 0) state.aim = ahead.length ? ahead[0] : sorted[0];
      else state.aim = ahead.length ? ahead[ahead.length - 1] : sorted[sorted.length - 1];
    } else {
      state.aim = wrap(state.aim + step);
    }
    hit.setAttribute('aria-valuenow', String(Math.round(wrap(state.aim + 90))));
    hit.setAttribute('aria-valuetext', clockText(state.aim));
    showAim();
  }

  hit.addEventListener('keydown', (event) => {
    if (!built) return;
    const fine = event.shiftKey ? 5 : 15;
    const keys = { ArrowRight: fine, ArrowDown: fine, ArrowLeft: -fine, ArrowUp: -fine };
    if (keys[event.key]) {
      event.preventDefault();
      touched = true;
      endDemo();
      if (!state.busy) turnAim(keys[event.key]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      state.aim = -90;
      turnAim(0);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      touched = true;
      endDemo();
      if (state.served) hint(HINTS.served);
      else cutAt(state.aim, true);
    }
  });

  hit.addEventListener('focus', () => {
    let byKeys = false;
    try {
      byKeys = hit.matches(':focus-visible');
    } catch (error) {
      // an older browser without :focus-visible: the aim shows on the first arrow key
    }
    if (byKeys) showAim();
  });
  hit.addEventListener('blur', () => {
    hideAim();
    if (!state.busy) knifeAway();
  });

  // ---------------------------------------------
  // The helper: dotted lines for fair pieces, and the knife cuts along them
  // ---------------------------------------------
  async function cutFair() {
    if (state.busy) return;
    touched = true;
    endDemo();
    hideAim();
    if (state.served) freshCake(false);
    const n = state.count;
    const guides = guideAngles(n);
    const near = (angle) => guides.reduce((a, b) => (apart(b, angle) < apart(a, angle) ? b : a));
    // cuts that already lie on a guide stay; anything else needs a whole cake again
    // (it drops in while the guides draw; the helper is busy from here on)
    const fits = state.rays.every((angle) => apart(near(angle), angle) <= SNAP)
      && new Set(state.rays.map(near)).size === state.rays.length;
    if (!fits) freshCake(true);
    else if (state.rays.length) {
      const before = state.pieces;
      state.rays = state.rays.map(near).sort((a, b) => a - b);
      renderPieces(before);
    }
    const my = epoch;
    setBusy(true);
    state.guides = guides;
    drawGuides(true);
    say(`Pjauname po lygiai: ${pieces(n)} – po vieną kiekvienam draugui.`);
    state.quiet = true;
    await sleep(reduceMotion ? 0 : 520);
    if (my !== epoch) return;

    const todo = guides.filter((g) => !state.rays.some((angle) => apart(angle, g) < 0.5));
    const plans = [];
    const used = new Set();
    todo.forEach((g) => {
      if (used.has(g)) return;
      used.add(g);
      const across = todo.find((other) => !used.has(other) && apart(other, g + 180) < 0.5);
      if (across !== undefined) {
        used.add(across);
        plans.push([g, across]);
      } else plans.push([g]);
    });
    for (const rays of plans) {
      if (reduceMotion) commit(rays);
      else await cutWithKnife(rays, my);
      if (my !== epoch) return;
      await sleep(reduceMotion ? 0 : 140);
      if (my !== epoch) return;
    }
    knifeAway();
    fadeGuides();
    state.quiet = false;
    setBusy(false);
    judge();
  }

  // ---------------------------------------------
  // Serving: each piece flies to the nearest friend, who hops and says something
  // ---------------------------------------------
  const seated = () => friends.slice(0, state.count);

  // Pairs every piece with the friend it points at; the rest stay on the platter
  function sharePlan() {
    const guests = seated();
    if (state.pieces.length === 1) return [{ piece: state.pieces[0], friend: guests[0] }];
    const pairs = [];
    state.pieces.forEach((piece) => guests.forEach((friend) => pairs.push({ piece, friend, cost: apart(midOf(piece), friend.angle) })));
    pairs.sort((a, b) => a.cost - b.cost);
    const plan = [];
    pairs.forEach((pair) => {
      if (plan.some((p) => p.piece === pair.piece || p.friend === pair.friend)) return;
      plan.push(pair);
    });
    // serve round the table, from the first friend on
    return plan.sort((a, b) => guests.indexOf(a.friend) - guests.indexOf(b.friend));
  }

  // Where a piece goes: its middle on the friend's plate, shrunk to fit
  // How small a piece gets on a friend's plate: it fits on the plate
  // (a whole cake for one friend hangs over the edge)
  function servedScale(piece) {
    if (piece.whole) return TABLE.served;
    const a = toRad(piece.size);
    const d = (4 * Math.sin(a / 2)) / (3 * a);
    const reach = Math.max(d, Math.sqrt(d * d + 1 - 2 * d * Math.cos(a / 2)));
    return clamp(((TABLE.plate / TABLE.cake) * 0.94) / reach, 0.18, TABLE.served);
  }

  function landing(piece, friend) {
    const c = centroid(piece);
    const left = 0.5 - TABLE.cake * TABLE.box;
    const size = TABLE.cake * TABLE.box * 2;
    const tx = ((friend.plateAt.x - left) / size) * 100 - c.x;
    const ty = ((friend.plateAt.y - left) / size) * 100 - c.y;
    const scale = servedScale(piece);
    return { tx, ty, scale, end: `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${scale.toFixed(3)})` };
  }

  // A bubble goes where it hides the least: a few spots round the friend's head,
  // each scored by how much of it would cover the plates, the cake, the other
  // friends, the bubbles already up or the stage's edge
  const BUBBLE_SPOTS = [
    // [left edge, top edge] from the friend's box, and the corner that points at them
    (at, w, h) => [at.x - at.w * 0.12, at.y - at.h * 0.5 - h - 0.006, 'bl'],
    (at, w, h) => [at.x + at.w * 0.12 - w, at.y - at.h * 0.5 - h - 0.006, 'br'],
    (at, w, h) => [at.x + at.w * 0.4, at.y - at.h * 0.36, 'tl'],
    (at, w, h) => [at.x - at.w * 0.4 - w, at.y - at.h * 0.36, 'tr'],
    (at, w, h) => [at.x + at.w * 0.42, at.y - at.h * 0.36 - h, 'bl'],
    (at, w, h) => [at.x - at.w * 0.42 - w, at.y - at.h * 0.36 - h, 'br'],
    (at, w, h) => [at.x + at.w * 0.44, at.y + at.h * 0.02, 'tl'],
    (at, w, h) => [at.x - at.w * 0.44 - w, at.y + at.h * 0.02, 'tr'],
  ];

  function bubbleCost(friend, box) {
    const shapes = [];
    seated().forEach((other) => {
      if (!other.at) return;
      const near = other === friend;
      shapes.push({ c: other.plateAt, r: TABLE.plate * 1.08, cost: 3 });
      const a = other.at;
      shapes.push({ x0: a.x - a.w * 0.36, x1: a.x + a.w * 0.36, y0: a.y - a.h * 0.42, y1: a.y + a.h * 0.42, cost: near ? 5 : 3 });
      if (!near && other.bubbleBox) {
        const b = other.bubbleBox;
        shapes.push({ x0: b.x - 0.008, x1: b.x + b.w + 0.008, y0: b.y - 0.008, y1: b.y + b.h + 0.008, cost: 8 });
      }
    });
    shapes.push({ c: { x: 0.5, y: 0.5 }, r: TABLE.platter, cost: 2 });
    let cost = 0;
    for (let i = 0; i <= 6; i += 1) {
      for (let j = 0; j <= 2; j += 1) {
        const x = box.x + (box.w * i) / 6;
        const y = box.y + (box.h * j) / 2;
        if (x < 0.01 || x > 0.99 || y < 0.01 || y > 0.99) cost += 10;
        shapes.forEach((s) => {
          const inside = s.c ? Math.hypot(x - s.c.x, y - s.c.y) < s.r : x > s.x0 && x < s.x1 && y > s.y0 && y < s.y1;
          if (inside) cost += s.cost;
        });
      }
    }
    return cost;
  }

  function showBubble(friend, text) {
    const { bubble, at } = friend;
    if (!at) return;
    bubble.textContent = text;
    if (!bubble.isConnected) talk.appendChild(bubble);
    const w = bubble.offsetWidth / (side || 1);
    const h = bubble.offsetHeight / (side || 1);
    let best = null;
    BUBBLE_SPOTS.forEach((spot, i) => {
      const [x, y, corner] = spot(at, w, h);
      const box = { x, y, w, h };
      const cost = bubbleCost(friend, box) + i * 0.4;
      if (!best || cost < best.cost) best = { box, corner, cost };
    });
    friend.bubbleBox = best.box;
    bubble.style.left = pct(best.box.x);
    bubble.style.top = pct(best.box.y);
    bubble.dataset.corner = best.corner;
    restart(bubble, 'is-on');
  }

  function hideBubble(friend) {
    friend.bubbleBox = null;
    if (friend.bubble) friend.bubble.classList.remove('is-on');
  }

  function hop(friend) {
    if (friend.body) restart(friend.body, 'is-hop');
  }

  async function serve() {
    if (state.busy || state.served || !built) return;
    touched = true;
    endDemo();
    hideAim();
    knifeAway();
    preview.classList.remove('is-on');
    const my = epoch;
    const plan = sharePlan();
    const list = state.pieces;
    const total = list.length;
    state.served = true;
    setBusy(true);
    state.guides = null;
    drawGuides(false);
    stage.classList.add('is-served');
    stage.classList.remove('is-proud');

    const served = plan.map((p) => p.piece);
    const { ratio } = sizesOf(served);
    const fair = total > 1 && ratio <= EQUAL;
    const smallest = served.reduce((a, b) => (b.size < a.size ? b : a));
    const biggest = served.reduce((a, b) => (b.size > a.size ? b : a));
    const lineFor = (piece, friend) => {
      if (total === 1) return '„Visas man?!“';
      if (!fair && piece === smallest) return '„O mano mažesnis…“';
      if (!fair && piece === biggest && ratio >= 1.45) return '„Oho, koks didelis!“';
      return friend.guest.says;
    };
    list.forEach((piece) => piece.el.classList.remove('is-big', 'is-small'));

    const flights = plan.map(({ piece, friend }, i) => {
      const { end, scale } = landing(piece, friend);
      const from = partedBy(piece);
      piece.landed = end;
      piece.scale = scale;
      piece.el.style.transform = end;
      piece.el.classList.add('is-served');
      const go = async () => {
        await sleep(reduceMotion ? 0 : i * 380);
        if (my !== epoch) return;
        piece.el.classList.add('is-flying');
        await play(piece.el, [
          { transform: from },
          { transform: from.replace('scale(1)', 'scale(1.12)'), offset: 0.22 },
          { transform: end },
        ], { duration: 760, easing: 'cubic-bezier(0.5, 0, 0.25, 1)' });
        if (my !== epoch) return;
        piece.el.classList.remove('is-flying');
        hop(friend);
        showBubble(friend, lineFor(piece, friend));
      };
      return go();
    });
    await Promise.all(flights);
    if (my !== epoch) return;

    const missing = seated().filter((friend) => !plan.some((p) => p.friend === friend));
    missing.forEach((friend, i) => window.setTimeout(() => {
      if (my !== epoch) return;
      hop(friend);
      showBubble(friend, '„O man?“');
    }, i * 160));
    const extra = total - plan.length;
    if (total === 1) say('Visas pyragas – vienam draugui? Kiti liko be nieko. Gal geriau padalinti?');
    else if (missing.length) say(`${TO_FRIENDS[missing.length]} neužteko. Ką darysime? Paklauskite vaiko – gal jis sugalvos.`);
    else {
      let text = fair ? `Visi gavo po ${partOf(total, 1)}.` : 'Visi gavo, bet ne po lygiai – kieno gabaliukas mažiausias?';
      if (extra) text += ` Dar liko ${pieces(extra)} – kam ${them(extra)} padovanosime?`;
      else if (fair) text += ' Skanaus!';
      say(text);
    }
    setBusy(false);

    await sleep(2900);
    if (my !== epoch) return;
    eat(plan, missing.length, extra, my);
  }

  // The friends eat in turn; their plates are left with crumbs and a fork
  async function eat(plan, missing, extra, my) {
    seated().forEach(hideBubble);
    await Promise.all(plan.map(async ({ piece, friend }, i) => {
      await sleep(reduceMotion ? 0 : i * 230);
      if (my !== epoch) return;
      const end = piece.landed;
      const bite = (k) => end.replace(/scale\([^)]*\)/, `scale(${(piece.scale * k).toFixed(3)})`);
      await play(piece.el, [
        { transform: end },
        { transform: bite(0.7), offset: 0.12 },
        { transform: bite(0.7), offset: 0.38 },
        { transform: bite(0.4), offset: 0.5 },
        { transform: bite(0.4), offset: 0.76 },
        { transform: bite(0), opacity: 0, offset: 0.9 },
        { transform: bite(0), opacity: 0 },
      ], { duration: 1100, easing: 'ease-out' });
      if (my !== epoch) return;
      piece.el.remove();
      friend.seat.classList.add('is-eaten');
      hop(friend);
    }));
    if (my !== epoch) return;
    if (!extra) stage.classList.add('is-empty');
    if (plan.length === 1 && state.pieces.length === 1) say('Vienas draugas suvalgė visą pyragą! Kitą kartą padalinkime visiems.');
    else if (!missing && !extra) {
      say('Neliko nė trupinėlio!');
      doneNote.hidden = false;
      restart(doneNote, 'is-on');
    } else if (extra) say(`Suvalgėme! O ${pieces(extra)} dar laukia – kam ${them(extra)} nunešime?`);
    else say(`Suvalgėme. Kitą kartą pjaukime ${state.count} gabaliukus – po vieną kiekvienam?`);
  }

  // ---------------------------------------------
  // A new cake (the reader's own, when the bake game sends one)
  // ---------------------------------------------
  async function freshCake(animate) {
    stopAll();
    const my = epoch;
    stroke = null;
    state.rays = [];
    state.guides = null;
    state.served = false;
    setBusy(false);
    stage.classList.remove('is-served', 'is-empty', 'is-proud');
    doneNote.hidden = true;
    doneNote.classList.remove('is-on');
    toast.classList.remove('is-on');
    preview.classList.remove('is-on');
    clearSlits();
    drawGuides(false);
    bitLayer.textContent = '';
    fx.textContent = '';
    friends.forEach((friend) => {
      hideBubble(friend);
      if (friend.seat) friend.seat.classList.remove('is-eaten');
    });
    if (!built) return;
    renderPieces(null);
    if (animate) {
      seated().forEach((friend, i) => window.setTimeout(() => {
        if (my === epoch) hop(friend);
      }, 200 + i * 90));
      await play(pieceLayer, [
        { opacity: 0, transform: 'translateY(-6%) scale(1.1)' },
        { opacity: 1, transform: 'translateY(0) scale(0.98)', offset: 0.7 },
        { opacity: 1, transform: 'none' },
      ], { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }

  const OWN_CAKE = 'Jūsų iškeptas pyragas jau ant stalo! Kaip jį padalinsime?';
  // baked before the table was built: the line waits for the table
  let ownCakeNews = false;

  function useApples(list, announce) {
    const apples = cleanApples(list);
    if (!apples) return;
    state.apples = apples;
    // baked just now, it is theirs; found on the page at start, only if they changed the apples
    state.own = Boolean(announce) || !isRosette(apples);
    badge.hidden = !state.own;
    if (!built) {
      if (announce) ownCakeNews = true;
      return;
    }
    buildArt();
    freshCake(true);
    if (state.own) {
      restart(badge, 'is-new');
      if (announce) say(OWN_CAKE);
    }
  }

  let heardBake = false;
  document.addEventListener('pyragas:iskeptas', (event) => {
    heardBake = true;
    useApples(event.detail && event.detail.apples, true);
  });

  // ---------------------------------------------
  // How many friends: the stepper re-seats them with a hop
  // ---------------------------------------------
  function setCount(n) {
    const next = clamp(n, MIN_GUESTS, MAX_GUESTS);
    if (next === state.count || state.busy) return;
    if (state.served) freshCake(false);
    state.count = next;
    seatFriends(true);
    if (state.guides) {
      state.guides = guideAngles(next);
      drawGuides(true);
    }
    judge();
    updateButtons();
  }

  lessBtn.addEventListener('click', () => {
    if (!isOff(lessBtn)) setCount(state.count - 1);
  });
  moreBtn.addEventListener('click', () => {
    if (!isOff(moreBtn)) setCount(state.count + 1);
  });
  serveBtn.addEventListener('click', () => {
    if (isOff(serveBtn)) {
      if (state.served) hint(HINTS.served);
      return;
    }
    serve();
  });
  equalBtn.addEventListener('click', () => {
    if (!isOff(equalBtn)) cutFair();
  });
  newBtn.addEventListener('click', () => {
    touched = true;
    hideAim();
    knifeAway();
    freshCake(true);
  });

  // ---------------------------------------------
  // The first look: the knife shows the stroke once, without cutting
  // ---------------------------------------------
  async function demo() {
    if (touched || reduceMotion || state.busy || state.rays.length || demoing) return;
    demoing = true;
    const my = epoch;
    const angle = -12;
    const a = onRim(angle + 180, 1.22);
    const b = onRim(angle, 1.22);
    aimLine(preview, angle, -1.12, 1.12);
    preview.classList.add('is-on');
    // the animation shows the knife; underneath it stays hidden at the far end
    knifeAway();
    knife.style.transform = knifePose(b, angle, false);
    knife.classList.add('is-demo');
    await play(knife, [
      { transform: knifePose(a, angle, false), opacity: 0 },
      { transform: knifePose(a, angle, true), opacity: 1, offset: 0.2 },
      { transform: knifePose(b, angle, true), opacity: 1, offset: 0.85 },
      { transform: knifePose(b, angle, false), opacity: 0 },
    ], { duration: 2100, easing: 'ease-in-out' });
    if (my !== epoch) return;
    preview.classList.remove('is-on');
    knife.classList.remove('is-demo');
    knifeAway();
    demoing = false;
  }

  // ---------------------------------------------
  // Start: geometry now, the pictures when the table is near
  // ---------------------------------------------
  function measure() {
    side = stage.getBoundingClientRect().width || side;
  }

  function build() {
    if (built) return;
    built = true;
    const outside = !heardBake && window.pyragas && cleanApples(window.pyragas.apples);
    if (outside) {
      state.apples = outside;
      state.own = !isRosette(outside);
      badge.hidden = !state.own;
    }
    buildArt();
    renderPieces(null);
    stage.classList.add('is-ready');
    if (ownCakeNews && state.own) {
      ownCakeNews = false;
      restart(badge, 'is-new');
      say(OWN_CAKE);
    }
  }

  layout();
  measure();
  seatFriends(false);
  updateButtons();
  judge();
  hit.setAttribute('aria-valuenow', String(Math.round(wrap(state.aim + 90))));
  hit.setAttribute('aria-valuetext', clockText(state.aim));

  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(stage);
  else window.addEventListener('resize', measure);

  if (hasIO) {
    new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      build();
    }, { rootMargin: '900px 0px' }).observe(stage);

    // the knife's little show, once, when most of the table is in view
    new IntersectionObserver((entries, observer) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      window.setTimeout(() => {
        if (built) demo();
      }, 700);
    }, { threshold: 0.6 }).observe(stage);

    // friends rest while the section is off-screen
    new IntersectionObserver(
      (entries) => entries.forEach((entry) => root.classList.toggle('is-idle', !entry.isIntersecting)),
      { rootMargin: '15% 0px' }
    ).observe(root);
  } else {
    build();
  }

  const onMotionChange = () => {
    reduceMotion = reduceQuery.matches;
  };
  if (typeof reduceQuery.addEventListener === 'function') reduceQuery.addEventListener('change', onMotionChange);
})();
