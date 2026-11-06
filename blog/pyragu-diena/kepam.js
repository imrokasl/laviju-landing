/* ==========================================================================
   Pyragų diena: „Iškepkite pyragą ekrane“, the bake game in #receptas
   --------------------------------------------------------------------------
   A painted kitchen. The empty yogurt pot measures, the bowl fills, the
   batter is stirred and poured into the tin, apple slices go on top, the
   cake bakes and comes out. The reader's apples are then handed to the
   slice game further down (window.pyragas and the 'pyragas:iskeptas' event).

   Every step works by tapping the stage, by dragging, or with the one big
   button (so also by keyboard). With reduced motion the states change at
   once. One rAF loop drives the camera, tweens, stirring and the particle
   canvas; it stops when nothing moves and rests while the stage is away.
   ========================================================================== */
(function () {
  'use strict';

  const root = document.getElementById('receptas');
  if (!root) return;

  const stage = root.querySelector('[data-pk-stage]');
  const scene = root.querySelector('[data-pk-scene]');
  const canvas = root.querySelector('[data-pk-fx]');
  const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
  const ui = {
    dots: Array.from(root.querySelectorAll('[data-pk-dots] li')),
    step: root.querySelector('[data-pk-step]'),
    who: root.querySelector('[data-pk-who]'),
    say: root.querySelector('[data-pk-say]'),
    note: root.querySelector('[data-pk-note]'),
    hug: root.querySelector('[data-pk-hug]'),
    go: root.querySelector('[data-pk-go]'),
    label: root.querySelector('[data-pk-label]'),
    count: root.querySelector('[data-pk-count]'),
    alt: root.querySelector('[data-pk-alt]'),
    share: root.querySelector('[data-pk-share]'),
    again: root.querySelector('[data-pk-again]'),
    sound: root.querySelector('[data-pk-sound]'),
    recipe: Array.from(root.querySelectorAll('[data-pk-steps] > li')),
  };
  if (!stage || !scene || !ctx || !ui.go || !ui.label || !ui.say || !ui.note) return;

  // ---------------------------------------------
  // Small helpers
  // ---------------------------------------------
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const any = (list) => list[Math.floor(Math.random() * list.length)];
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const linear = (t) => t;
  const EASE = {
    move: 'cubic-bezier(.45, .05, .3, 1)',
    out: 'cubic-bezier(.2, .8, .3, 1)',
    in: 'cubic-bezier(.55, 0, .85, .35)',
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function el(tag, className, parent) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (parent) parent.appendChild(n);
    return n;
  }

  function svgEl(tag, attrs, parent) {
    const n = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((k) => n.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(n);
    return n;
  }

  function textOf(selector) {
    const n = root.querySelector(selector);
    return n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgb = (c) => `rgb(${c.map((v) => Math.round(v)).join(',')})`;
  const blend = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));

  // Reduced motion: no flights, pans or particles; the states change at once
  const reduceQuery = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  let reduce = !!(reduceQuery && reduceQuery.matches);
  function onReduceChange(event) {
    reduce = event.matches;
    if (reduce) {
      parts.length = 0;
      emitters.length = 0;
    }
  }
  if (reduceQuery) {
    if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onReduceChange);
    else if (reduceQuery.addListener) reduceQuery.addListener(onReduceChange);
  }
  // A beat of an animation (cut short with reduced motion) and reading time (never cut).
  // PACE speeds up every animated beat alike, so a step never keeps a child waiting long.
  const PACE = 0.6;
  const wait = (ms) => sleep(reduce ? Math.min(ms, 120) : ms * PACE);
  const pause = (ms) => sleep(ms);

  // ---------------------------------------------
  // The amounts come from the recipe card, so they live in the HTML only
  // ---------------------------------------------
  function amount(text, fallback) {
    if (!text) return fallback;
    if (text.indexOf('½') !== -1) return (parseFloat(text) || 0) + 0.5;
    const m = text.match(/\d+(?:[.,]\d+)?/);
    return m ? parseFloat(m[0].replace(',', '.')) : fallback;
  }
  const item = (name) => textOf(`[data-pk-item="${name}"] b`);
  const timeText = textOf('[data-pk-time]').replace(/\s*min.*$/i, '') || '35–40';
  const timeNumbers = (timeText.match(/\d+/g) || []).map(Number);
  const Q = {
    sugar: clamp(Math.round(amount(item('cukrus'), 1)), 1, 3),
    eggs: clamp(Math.round(amount(item('kiausiniai'), 3)), 1, 6),
    oil: clamp(amount(item('aliejus'), 0.5), 0.25, 1),
    flour: clamp(Math.round(amount(item('miltai'), 3)), 1, 5),
    temp: Math.round(amount(textOf('[data-pk-temp]'), 180)),
    time: timeText,
    minutes: timeNumbers.length ? Math.max.apply(null, timeNumbers) : 40,
    cool: Math.round(amount(textOf('[data-pk-cool]'), 15)),
  };

  const COUNT = ['nulis', 'vienas', 'du', 'trys', 'keturi', 'penki', 'šeši'];
  const COUNT_F = ['nulis', 'viena', 'dvi', 'trys', 'keturios', 'penkios'];
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const WHO = { vaikas: 'Vaikas', suauges: 'Suaugęs', kartu: 'Kartu' };

  // ---------------------------------------------
  // The kitchen: a 1000 × 640 scene. Each picture stands with its top-left
  // corner at (x, y) and is w scene units wide; px is the file's own size.
  // Points inside a picture are fractions of its box, measured in
  // GENERATED.md (bowl, tins, oven) or by eye on the files (the rest).
  // `origin` is the point it turns about: the peg for the hanging tools.
  // ---------------------------------------------
  const ART_DIR = '/blog/assets/pyragu-diena/';
  const ART = {
    miltai: { file: 'miltai', px: [319, 328], x: 20, y: 141, w: 94, mouth: [0.45, 0.14] },
    cukrus: { file: 'cukrus', px: [218, 308], x: 124, y: 150, w: 62, mouth: [0.5, 0.2] },
    aliejus: { file: 'aliejus', px: [182, 308], x: 200, y: 163, w: 44, neck: [0.5, 0.07] },
    cinamonas: { file: 'cinamonas', px: [288, 220], x: 256, y: 180, w: 76 },
    plaktuvas: { file: 'plaktuvas', px: [286, 348], x: 547.6, y: 52, w: 80, origin: [0.88, 0.05], rot: -33, tip: [0.25, 0.84] },
    samtis: { file: 'samtis', px: [315, 348], x: 648.7, y: -21, w: 76, origin: [0.07, 0.93], rot: 139, head: [0.78, 0.2] },
    prijuoste: { file: 'prijuoste', px: [345, 348], x: 670, y: 53, w: 116, origin: [0.5, 0.03] },
    puodkele: { file: 'puodkele', px: [236, 308], x: 782.2, y: -16.6, w: 62, origin: [0.9, 0.91], rot: 180, grip: [0.45, 0.5] },
    orkaite: { file: 'orkaite', px: [539, 652], x: 752, y: 342, w: 238 },
    laikmatis: { file: 'laikmatis', px: [205, 248], x: 902, y: 278, w: 58 },
    obuolysR: { file: 'obuolys-raudonas', px: [256, 288], x: 16, y: 404, w: 62 },
    obuolysZ: { file: 'obuolys-zalias', px: [262, 268], x: 62, y: 439, w: 54, z: 3 },
    kiausiniai: { file: 'kiausiniai', px: [288, 251], x: 120, y: 409, w: 84, egg: [0.73, 0.55] },
    dubuo: { file: 'dubuo', px: [572, 377], x: 284, y: 309.5, w: 280, z: 5 },
    forma: { file: 'forma-tuscia', px: [520, 442], x: 572, y: 350, w: 172, z: 4 },
    indelis: { file: 'indelis', px: [256, 268], x: 214, y: 431, w: 62, z: 8, mouth: [0.496, 0.187], mouthR: 0.371 },
  };

  // The bowl (GENERATED.md): the opening is the inner edge of the white lip,
  // the bottom the empty bowl's flat bottom; the batter sits between them.
  const BOWL = {
    open: { cx: 0.4983, cy: 0.3515, rx: 0.4528, ry: 0.2958 },
    bottom: { cx: 0.4869, cy: 0.5918, rx: 0.2806, ry: 0.1833 },
  };
  // The tins share one 520 × 442 canvas (GENERATED.md)
  const TIN = {
    rimInner: { cx: 0.499, cy: 0.3552, rx: 0.4433, ry: 0.3009 }, // the empty tin's lip
    surface: { cx: 0.501, cy: 0.4419, rx: 0.4471, ry: 0.2653 }, // the poured batter's whole oval
    top: { cx: 0.5019, cy: 0.4152, rx: 0.4413, ry: 0.2398 }, // the batter you see: where the apples go
    baked: { cx: 0.5, cy: 0.3462, rx: 0.4548, ry: 0.3088 }, // the baked cake's top
  };
  const OVEN = { window: { x: 0.0742, y: 0.3512, w: 0.8479, h: 0.4402, r: 0.103 }, led: [0.5, 0.1] };
  // The timer's face in its file's pixels (by eye): no numbers, no hands
  const DIAL = { cx: 103, cy: 148 };

  // The apple slice lies along x with its skin at the bottom. Like the slice
  // game, it is 0.46 of the cake's radius long and turned r + 184.4° so the
  // skin faces out; on the tin it is then squashed onto the batter's oval.
  const SLICE = { file: 'obuolio-skiltele', px: [168, 104], length: 0.46, turn: 184.4 };
  const SQUASH = (TIN.top.ry * 442) / (TIN.top.rx * 520);
  const MAX_SLICES = 24;

  // Where the camera looks at each moment: a box of the scene and how far it may zoom
  const CAMS = {
    start: { box: [560, 40, 1000, 640], max: 1 },
    pot: { box: [180, 270, 590, 510], max: 1.9 },
    eggs: { box: [100, 270, 590, 510], max: 1.9 },
    left: { box: [6, 120, 590, 512], max: 1.7 },
    bowl: { box: [262, 262, 590, 512], max: 2 },
    pour: { box: [268, 196, 760, 512], max: 1.8 },
    tin: { box: [548, 318, 768, 506], max: 2.4 },
    spice: { box: [240, 150, 780, 520], max: 1.6 },
    oven: { box: [548, 250, 1000, 640], max: 1.6 },
    out: { box: [540, 40, 1000, 640], max: 1.4 },
    end: { box: [380, 200, 1000, 640], max: 1.4 },
  };

  // Spots in the scene the choreography uses
  const AT = {
    potOver: [404, 318], // the pot's mouth, over the bowl
    eggRim: [372, 311], // an egg is cracked here, on the back of the rim
  };

  const COL = {
    yogurt: hex('#FFFCF4'),
    whisked: hex('#F9DF9C'),
    batter: hex('#FCE7B0'),
  };
  const YOLKS = [[-0.3, -0.06], [0.26, 0.1], [0.02, -0.38], [0.32, -0.3], [-0.16, 0.32], [0.04, 0.12]];
  const MOUNDS = [[-0.22, -0.04], [0.24, 0.06], [0.0, -0.32], [0.28, -0.28], [-0.12, 0.3]];

  // ---------------------------------------------
  // State
  // ---------------------------------------------
  const state = { i: 0, busy: false, count: 0, apples: [], built: false, heat: 0 };
  const O = {}; // the pictures by name
  const mix = { level: 0, turn: 0, color: COL.yogurt.slice() };
  const pot = {};
  const tin = {};
  const oven = {};
  const timer = {};
  let flow = null; // the scene-wide svg for streams

  // ---------------------------------------------
  // Placing pictures: boxes in scene units, turned about their origin
  // ---------------------------------------------
  function placeBox(n, x, y, w, h) {
    n.style.left = `${(x / 10).toFixed(3)}%`;
    n.style.top = `${(y / 6.4).toFixed(3)}%`;
    n.style.width = `${(w / 10).toFixed(3)}%`;
    if (h != null) n.style.height = `${(h / 6.4).toFixed(3)}%`;
  }

  function picture(file, w, h, className, parent) {
    const img = el('img', className, parent);
    img.src = `${ART_DIR}${file}.webp`;
    img.width = w;
    img.height = h;
    img.alt = '';
    img.decoding = 'async';
    img.draggable = false;
    return img;
  }

  // The scene point of fraction f of a picture at home
  const spot = (o, f) => [o.x + f[0] * o.w, o.y + f[1] * o.h];

  // Where fraction f ends up when fraction p stands at m, turned deg° and scaled s
  function pointAt(o, m, p, deg, s, f) {
    const a = (deg * Math.PI) / 180;
    const dx = (f[0] - p[0]) * o.w * s;
    const dy = (f[1] - p[1]) * o.h * s;
    return [m[0] + Math.cos(a) * dx - Math.sin(a) * dy, m[1] + Math.sin(a) * dx + Math.cos(a) * dy];
  }

  // A transform that puts fraction p of the picture at scene point m, turned deg°
  // clockwise and scaled s about its origin. The shift is in % of the picture's
  // own box, so it holds when the stage is resized.
  function pose(o, m, p, deg, s) {
    const d = deg || 0;
    const k = s == null ? 1 : s;
    const a = (d * Math.PI) / 180;
    const ox = o.origin[0] * o.w;
    const oy = o.origin[1] * o.h;
    const px = p[0] * o.w - ox;
    const py = p[1] * o.h - oy;
    const tx = m[0] - o.x - ox - k * (Math.cos(a) * px - Math.sin(a) * py);
    const ty = m[1] - o.y - oy - k * (Math.sin(a) * px + Math.cos(a) * py);
    return `translate(${((tx / o.w) * 100).toFixed(3)}%, ${((ty / o.h) * 100).toFixed(3)}%) rotate(${d.toFixed(2)}deg) scale(${k.toFixed(4)})`;
  }

  const homePos = (o) => ({ m: spot(o, o.origin), p: o.origin, deg: o.rot, s: 1 });

  // The fraction of the picture (at home) under a scene point
  function fractionAt(o, pt) {
    const a = (-o.rot * Math.PI) / 180;
    const ox = o.origin[0] * o.w;
    const oy = o.origin[1] * o.h;
    const dx = pt[0] - (o.x + ox);
    const dy = pt[1] - (o.y + oy);
    return [(ox + Math.cos(a) * dx - Math.sin(a) * dy) / o.w, (oy + Math.sin(a) * dx + Math.cos(a) * dy) / o.h];
  }

  function hits(o, pt, pad) {
    const f = fractionAt(o, pt);
    const p = pad == null ? 0.06 : pad;
    return f[0] > -p && f[0] < 1 + p && f[1] > -p && f[1] < 1 + p;
  }

  function setZ(o, z) {
    o.el.style.zIndex = String(z);
  }

  // ---------------------------------------------
  // Animation: WAAPI for the pictures, with the end state written back
  // ---------------------------------------------
  function setStyle(n, frame) {
    Object.keys(frame).forEach((k) => {
      if (k !== 'offset' && k !== 'easing' && k !== 'composite') n.style[k] = frame[k];
    });
  }

  function animateNode(n, frames, ms, easing, delay) {
    const last = frames[frames.length - 1];
    if (reduce || typeof n.animate !== 'function' || !(ms > 0)) {
      if (n._pkAnim) {
        n._pkAnim.cancel();
        n._pkAnim = null;
      }
      setStyle(n, last);
      return Promise.resolve();
    }
    const previous = n._pkAnim;
    const anim = n.animate(frames, { duration: ms * PACE, easing: easing || EASE.move, delay: (delay || 0) * PACE, fill: 'both' });
    n._pkAnim = anim;
    if (previous) previous.cancel();
    return new Promise((resolve) => {
      anim.onfinish = () => {
        if (n._pkAnim === anim) {
          setStyle(n, last);
          anim.cancel();
          n._pkAnim = null;
        }
        resolve();
      };
      anim.oncancel = () => resolve();
    });
  }

  // A short fade that stays even with reduced motion
  function fade(n, from, to, ms) {
    if (typeof n.animate !== 'function') {
      n.style.opacity = String(to);
      return Promise.resolve();
    }
    const quick = reduce ? Math.min(ms, 160) : ms * PACE;
    return new Promise((resolve) => {
      const anim = n.animate([{ opacity: from }, { opacity: to }], { duration: quick, fill: 'both' });
      anim.onfinish = () => {
        n.style.opacity = String(to);
        anim.cancel();
        resolve();
      };
      anim.oncancel = () => resolve();
    });
  }

  function fly(o, frames, ms, easing) {
    const all = [{ transform: o.now }].concat(frames.map((f) => (typeof f === 'string' ? { transform: f } : f)));
    o.now = all[all.length - 1].transform;
    return Promise.all(o.els.map((n) => animateNode(n, all, ms, easing)));
  }

  // Fly a picture so that its point t.p lands on t.m, on an arc when `lift` is set
  function flyTo(o, target, ms, opts) {
    const t = Object.assign({ deg: 0, s: 1 }, target);
    const f = o.pos;
    const options = opts || {};
    const start = pointAt(o, f.m, f.p, f.deg, f.s, t.p);
    const frames = [];
    if (options.lift) {
      [0.25, 0.5, 0.75].forEach((k) => {
        const m = [lerp(start[0], t.m[0], k), lerp(start[1], t.m[1], k) - options.lift * 4 * k * (1 - k)];
        frames.push({ transform: pose(o, m, t.p, lerp(f.deg, t.deg, k), lerp(f.s, t.s, k)), offset: k });
      });
    }
    frames.push({ transform: pose(o, t.m, t.p, t.deg, t.s) });
    o.pos = t;
    return fly(o, frames, ms, options.easing || EASE.move);
  }

  function goHome(o, ms, opts) {
    return flyTo(o, homePos(o), ms || 650, opts).then(() => {
      o.now = o.home;
      setZ(o, o.z);
    });
  }

  // Put a picture somewhere at once (drags, stirring, resets)
  function setNow(o, transform) {
    o.now = transform;
    o.els.forEach((n) => {
      if (n._pkAnim) {
        n._pkAnim.cancel();
        n._pkAnim = null;
      }
      n.style.transform = transform;
    });
  }

  // ---------------------------------------------
  // The rAF loop: camera, tweens, the held stir button and particles
  // ---------------------------------------------
  const loop = { running: false, visible: true, last: 0 };
  const tweens = new Set();
  let camMove = null;

  function kick() {
    if (loop.running || !loop.visible) return;
    loop.running = true;
    loop.last = performance.now();
    requestAnimationFrame(frame);
  }

  function frame(now) {
    const dt = clamp(now - loop.last, 0, 48);
    loop.last = now;
    let more = false;

    if (camMove) {
      camMove.t += dt;
      const p = easeInOut(clamp(camMove.t / camMove.ms, 0, 1));
      cam.cx = lerp(camMove.from.cx, camMove.to.cx, p);
      cam.cy = lerp(camMove.from.cy, camMove.to.cy, p);
      cam.z = Math.exp(lerp(Math.log(camMove.from.z), Math.log(camMove.to.z), p));
      applyCam();
      if (camMove.t >= camMove.ms) {
        const done = camMove.done;
        camMove = null;
        done();
      } else more = true;
    }

    tweens.forEach((t) => {
      t.t += dt;
      const p = clamp(t.t / t.ms, 0, 1);
      t.fn(t.ease(p));
      if (p >= 1) {
        tweens.delete(t);
        t.done();
      }
    });
    if (tweens.size) more = true;

    if (stir.holding) {
      stirBy(dt * 0.00032, dt * 0.35);
      more = more || stir.holding;
    }

    if (parts.length || emitters.length || fxDirty) more = drawFx(dt) || more;

    if (more && loop.visible) requestAnimationFrame(frame);
    else loop.running = false;
  }

  function tween(ms, fn, ease) {
    if (reduce || !(ms > 0)) {
      fn(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      tweens.add({ ms: ms * PACE, t: 0, fn, ease: ease || easeInOut, done: resolve });
      kick();
    });
  }

  // ---------------------------------------------
  // The camera: a point of the scene at the stage's centre and a zoom
  // ---------------------------------------------
  let SW = 0;
  let SH = 0;
  let U = 1; // px per scene unit at zoom 1 (the scene always covers the stage)
  const cam = { name: 'start', cx: 780, cy: 340, z: 1 };
  const view = { tx: 0, ty: 0, k: 1 };

  // The centre the stage really shows at that zoom (the scene must cover it)
  function settle(c) {
    const k = c.z * U;
    const tx = clamp(SW / 2 - k * c.cx, SW - k * 1000, 0);
    const ty = clamp(SH / 2 - k * c.cy, SH - k * 640, 0);
    return { cx: (SW / 2 - tx) / k, cy: (SH / 2 - ty) / k, z: c.z };
  }

  function aim(name) {
    const c = CAMS[name] || CAMS.start;
    const [x0, y0, x1, y1] = c.box;
    const z = clamp(Math.min(SW / ((x1 - x0) * U), SH / ((y1 - y0) * U)), 1, c.max);
    return settle({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, z });
  }

  function applyCam() {
    const k = cam.z * U;
    const tx = clamp(SW / 2 - k * cam.cx, SW - k * 1000, 0);
    const ty = clamp(SH / 2 - k * cam.cy, SH - k * 640, 0);
    view.tx = tx;
    view.ty = ty;
    view.k = k;
    scene.style.transform = `translate3d(${tx.toFixed(2)}px, ${ty.toFixed(2)}px, 0) scale(${cam.z.toFixed(4)})`;
  }

  function camTo(name, ms) {
    cam.name = name;
    if (!SW) return Promise.resolve();
    const to = aim(name);
    if (camMove) {
      camMove.done();
      camMove = null;
    }
    if (reduce || !(ms > 0)) {
      Object.assign(cam, to);
      applyCam();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      camMove = { from: { cx: cam.cx, cy: cam.cy, z: cam.z }, to, t: 0, ms: ms * PACE, done: resolve };
      kick();
    });
  }

  function layout() {
    const r = stage.getBoundingClientRect();
    if (!r.width || !r.height) return;
    SW = r.width;
    SH = r.height;
    U = Math.max(SW / 1000, SH / 640);
    stage.style.setProperty('--pk-u', `${U.toFixed(5)}px`);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(SW * dpr);
    canvas.height = Math.round(SH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fxDirty = true;
    if (camMove) {
      camMove.to = aim(cam.name);
    } else {
      Object.assign(cam, aim(cam.name));
    }
    applyCam();
    kick();
  }

  // ---------------------------------------------
  // Particles on one canvas: sugar, flour, cinnamon, steam, sparkles, confetti.
  // They live in scene units and are drawn through the camera.
  // ---------------------------------------------
  const parts = [];
  const emitters = [];
  let fxDirty = false;
  const puff = (() => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    if (g) {
      const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.45, 'rgba(255,253,248,.6)');
      grd.addColorStop(1, 'rgba(255,253,248,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, 64, 64);
    }
    return c;
  })();

  function spawn(p) {
    if (reduce || !loop.visible || parts.length > 480) return;
    parts.push(Object.assign({ age: 0, vx: 0, vy: 0, g: 0, drag: 1, size: 2, life: 900, alpha: 1, kind: 'dot', color: '#FFFFFF', rot: 0, vr: 0, grow: 0, floor: null }, p));
    kick();
  }

  function emit(e) {
    if (reduce) return;
    emitters.push(Object.assign({ acc: 0 }, e));
    kick();
  }

  function drawFx(dt) {
    ctx.clearRect(0, 0, SW, SH);
    fxDirty = false;
    for (let i = emitters.length - 1; i >= 0; i -= 1) {
      const e = emitters[i];
      e.left -= dt;
      e.acc += dt * e.rate;
      while (e.acc >= 1) {
        e.acc -= 1;
        e.make();
      }
      if (e.left <= 0) emitters.splice(i, 1);
    }
    const { tx, ty, k } = view;
    for (let i = parts.length - 1; i >= 0; i -= 1) {
      const p = parts[i];
      p.age += dt;
      p.vy += p.g * dt;
      if (p.drag !== 1) {
        const d = Math.pow(p.drag, dt / 16.7);
        p.vx *= d;
        p.vy *= d;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      if (p.age >= p.life || (p.floor != null && p.y >= p.floor)) {
        parts.splice(i, 1);
        continue;
      }
      const t = p.age / p.life;
      const sx = tx + p.x * k;
      const sy = ty + p.y * k;
      const size = p.size * k * (1 + p.grow * t);
      let a = p.alpha;
      if (p.kind === 'puff') a *= t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
      else if (t > 0.75) a *= (1 - t) / 0.25;
      if (a <= 0.01) continue;
      ctx.globalAlpha = a;
      if (p.kind === 'puff') {
        ctx.drawImage(puff, sx - size, sy - size, size * 2, size * 2);
      } else if (p.kind === 'grain') {
        ctx.fillStyle = p.color;
        ctx.fillRect(sx - size / 2, sy - size / 2, size, size);
      } else if (p.kind === 'confetti') {
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-size, -size * 0.45, size * 2, size * 0.9);
        ctx.restore();
      } else if (p.kind === 'spark') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.moveTo(sx, sy - size);
        ctx.quadraticCurveTo(sx, sy, sx + size, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy + size);
        ctx.quadraticCurveTo(sx, sy, sx - size, sy);
        ctx.quadraticCurveTo(sx, sy, sx, sy - size);
        ctx.fill();
      } else {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(sx, sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    if (parts.length) fxDirty = true;
    return parts.length > 0 || emitters.length > 0;
  }

  function sparkle(x, y, n, spread) {
    const s = spread || 30;
    for (let i = 0; i < (n || 8); i += 1) {
      spawn({
        kind: 'spark',
        x: x + rand(-s, s),
        y: y + rand(-s, s) * 0.6,
        vx: rand(-0.03, 0.03),
        vy: rand(-0.07, -0.02),
        g: 0.00008,
        size: rand(3, 6.5),
        life: rand(520, 900),
        color: any(['#FFD27A', '#FFFFFF', '#F7B84B', '#FFE7A8']),
      });
    }
  }

  function steamFrom(x, y, w, ms, rate) {
    emit({
      left: ms,
      rate: rate || 0.012,
      make: () =>
        spawn({ kind: 'puff', x: x + rand(-w / 2, w / 2), y, vx: rand(-0.006, 0.006), vy: rand(-0.034, -0.02), size: rand(6, 11), grow: 1.5, life: rand(1300, 1900), alpha: 0.55 }),
    });
  }

  function confetti(x, y) {
    const colours = ['#E9A94B', '#E07A62', '#9ED3B0', '#9CC3EE', '#F6C4AE', '#FFD27A', '#C9BEF2'];
    for (let i = 0; i < 80; i += 1) {
      spawn({
        kind: 'confetti',
        x: x + rand(-50, 50),
        y: y + rand(-20, 10),
        vx: rand(-0.2, 0.2),
        vy: rand(-0.42, -0.16),
        g: 0.0007,
        drag: 0.988,
        size: rand(2.6, 4.2),
        life: rand(1500, 2300),
        color: any(colours),
        rot: rand(0, 6),
        vr: rand(-0.014, 0.014),
      });
    }
  }

  // ---------------------------------------------
  // Speech bubbles and small loose bits (eggs, yolks, the yogurt dollop)
  // ---------------------------------------------
  function popAt(text, x, y, opts) {
    const o = opts || {};
    const b = el('div', `pk-pop${o.big ? ' pk-pop--big' : ''}`, scene);
    b.textContent = text;
    b.style.left = `${(x / 10).toFixed(3)}%`;
    b.style.top = `${(y / 6.4).toFixed(3)}%`;
    if (!reduce && typeof b.animate === 'function') {
      b.animate(
        [
          { opacity: 0, transform: 'translate(-50%, -100%) scale(.5)' },
          { opacity: 1, transform: 'translate(-50%, -100%) scale(1.08)', offset: 0.6 },
          { opacity: 1, transform: 'translate(-50%, -100%) scale(1)' },
        ],
        { duration: 320, easing: 'ease-out' }
      );
    } else {
      fade(b, 0, 1, 140);
    }
    setTimeout(() => {
      if (!b.isConnected) return;
      fade(b, 1, 0, 240).then(() => b.remove());
    }, o.hold || 1100);
    return b;
  }

  function bit(markup, x, y, w, h, z) {
    const b = el('div', 'pk-bit', scene);
    placeBox(b, x, y, w, h);
    b.style.zIndex = String(z || 9);
    b.innerHTML = markup;
    b._w = w;
    b._h = h;
    return b;
  }

  // A transform that shifts a bit by (dx, dy) scene units
  function shift(b, dx, dy, deg, sx, sy) {
    const x = sx == null ? 1 : sx;
    const y = sy == null ? x : sy;
    return `translate(${((dx / b._w) * 100).toFixed(2)}%, ${((dy / b._h) * 100).toFixed(2)}%) rotate(${(deg || 0).toFixed(1)}deg) scale(${x.toFixed(3)}, ${y.toFixed(3)})`;
  }

  const EGG_L = 'M62 5C40 6 3 24 3 50s37 44 59 45l4-12-10-13 10-13-10-13 10-13-10-13Z';
  const EGG_R = 'M62 5c22-2 59 8 59 45s-37 44-59 45l4-12-10-13 10-13-10-13 10-13-10-13Z';
  const eggHalf = (d) => `<svg viewBox="0 0 124 100" aria-hidden="true"><path d="${d}" fill="url(#pk-g-egg)" stroke="#C98663" stroke-width="3" stroke-linejoin="round"/></svg>`;
  const YOLK = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#FFFFFF" opacity=".75"/><circle cx="20" cy="21" r="11" fill="url(#pk-g-yolk)"/><ellipse cx="16.5" cy="17" rx="3.5" ry="2.4" fill="#FFF3C4"/></svg>';
  const DOLLOP = '<svg viewBox="0 0 60 48" aria-hidden="true"><path d="M30 4c12 0 22 9 22 21 0 12-10 19-22 19S8 37 8 25C8 13 18 4 30 4Z" fill="#FFFDF8" stroke="#E6DCCB" stroke-width="2.5"/><path d="M21 16c4-4 11-5 16-2" stroke="#FFFFFF" stroke-width="4" fill="none" stroke-linecap="round"/></svg>';

  // ---------------------------------------------
  // Building the kitchen (once the stage comes near)
  // ---------------------------------------------
  function makeObject(name, a) {
    const o = Object.assign({ name, z: 2, origin: [0.5, 0.5], rot: 0 }, a);
    o.h = (o.w * o.px[1]) / o.px[0];
    o.el = el('div', `pk-o pk-o--${name}`, scene);
    placeBox(o.el, o.x, o.y, o.w, o.h);
    o.img = picture(o.file, o.px[0], o.px[1], 'pk-o__img', o.el);
    o.el.style.transformOrigin = `${(o.origin[0] * 100).toFixed(2)}% ${(o.origin[1] * 100).toFixed(2)}%`;
    o.els = [o.el];
    o.home = pose(o, spot(o, o.origin), o.origin, o.rot, 1);
    o.pos = homePos(o);
    setNow(o, o.home);
    setZ(o, o.z);
    O[name] = o;
    return o;
  }

  function buildDefs() {
    const s = svgEl('svg', { class: 'pk-defs', width: 0, height: 0, 'aria-hidden': 'true', focusable: 'false' }, scene);
    s.innerHTML =
      '<defs>' +
      '<radialGradient id="pk-g-egg" cx=".42" cy=".36" r=".75"><stop offset="0" stop-color="#FBDCC2"/><stop offset=".6" stop-color="#EDB48E"/><stop offset="1" stop-color="#D99067"/></radialGradient>' +
      '<radialGradient id="pk-g-yolk" cx=".38" cy=".34" r=".7"><stop offset="0" stop-color="#FFE08A"/><stop offset=".55" stop-color="#F8BC3A"/><stop offset="1" stop-color="#E99A1E"/></radialGradient>' +
      '<radialGradient id="pk-g-mound" cx=".5" cy=".45" r=".5"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#FFFDF7"/><stop offset="1" stop-color="#FFFDF7" stop-opacity="0"/></radialGradient>' +
      '<radialGradient id="pk-g-shade" cx=".5" cy=".5" r=".5"><stop offset=".62" stop-color="#8A5A20" stop-opacity="0"/><stop offset="1" stop-color="#8A5A20" stop-opacity=".2"/></radialGradient>' +
      '<radialGradient id="pk-g-oil" cx=".42" cy=".4" r=".6"><stop offset="0" stop-color="#FFE38A"/><stop offset="1" stop-color="#EBB43A"/></radialGradient>' +
      '</defs>';
  }

  // The bowl's front wall, drawn again over the tools so they sit inside it
  function frontClip() {
    const { cx, cy, rx, ry } = BOWL.open;
    const pts = [];
    for (let i = 0; i <= 28; i += 1) {
      const a = (i / 28) * Math.PI;
      pts.push(`${((cx + rx * Math.cos(a)) * 100).toFixed(2)}% ${((cy + ry * Math.sin(a)) * 100).toFixed(2)}%`);
    }
    const y = (cy * 100).toFixed(2);
    return `polygon(${pts.join(', ')}, 0% ${y}%, 0% 100%, 100% 100%, 100% ${y}%)`;
  }

  function buildBowl() {
    const o = O.dubuo;
    const front = el('div', 'pk-o pk-o--front', scene);
    placeBox(front, o.x, o.y, o.w, o.h);
    front.style.transformOrigin = o.el.style.transformOrigin;
    front.style.zIndex = '7';
    front.style.transform = o.home;
    picture('dubuo', 572, 377, 'pk-o__img', front);
    const clip = frontClip();
    front.style.clipPath = clip;
    front.style.webkitClipPath = clip;
    o.els.push(front);

    // What is in the bowl: a surface oval that rises from the bottom to the
    // rim, clipped by the opening; the bits on it turn when stirred
    const s = svgEl('svg', { class: 'pk-layer pk-mix', viewBox: '0 0 572 377', 'aria-hidden': 'true', focusable: 'false' }, o.el);
    const clipPath = svgEl('clipPath', { id: 'pk-clip-bowl' }, svgEl('defs', {}, s));
    svgEl('ellipse', { cx: 285, cy: 133.5, rx: 254, ry: 108.5 }, clipPath);
    const inside = svgEl('g', { 'clip-path': 'url(#pk-clip-bowl)' }, s);
    mix.svg = s;
    mix.surface = svgEl('g', {}, inside);
    mix.base = svgEl('circle', { r: 1, fill: rgb(COL.yogurt) }, mix.surface);
    mix.spin = svgEl('g', {}, mix.surface);
    mix.sugar = svgEl('g', { opacity: 0 }, mix.spin);
    for (let i = 0; i < 40; i += 1) {
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(Math.random()) * 0.42;
      svgEl('circle', { cx: (0.1 + Math.cos(a) * d).toFixed(3), cy: (0.04 + Math.sin(a) * d).toFixed(3), r: rand(0.016, 0.028).toFixed(3), fill: '#FFFFFF', stroke: '#E2D3B6', 'stroke-width': 0.008 }, mix.sugar);
    }
    mix.yolks = svgEl('g', {}, mix.spin);
    mix.oil = svgEl('g', { opacity: 0 }, mix.spin);
    svgEl('ellipse', { cx: 0.16, cy: 0.04, rx: 0.3, ry: 0.27, fill: 'url(#pk-g-oil)', opacity: 0.85 }, mix.oil);
    svgEl('ellipse', { cx: 0.08, cy: -0.04, rx: 0.1, ry: 0.06, fill: '#FFF2C2', opacity: 0.9 }, mix.oil);
    mix.flour = svgEl('g', {}, mix.spin);
    let d = '';
    for (let i = 0; i <= 64; i += 1) {
      const a = (i / 64) * 4 * Math.PI;
      const r = 0.08 + 0.5 * (i / 64);
      d += `${i ? 'L' : 'M'}${(Math.cos(a) * r).toFixed(3)} ${(Math.sin(a) * r).toFixed(3)}`;
    }
    mix.swirl = svgEl('path', { d, fill: 'none', stroke: '#EFC96E', 'stroke-width': 0.04, 'stroke-linecap': 'round', opacity: 0 }, mix.spin);
    svgEl('circle', { r: 1, fill: 'url(#pk-g-shade)' }, mix.surface);
    svgEl('ellipse', { cx: -0.3, cy: -0.46, rx: 0.36, ry: 0.13, fill: '#FFFFFF', opacity: 0.45 }, mix.surface);
    paintMix();
  }

  // The batter's surface at level L (0 the bottom, 1 the rim), in the bowl
  // file's pixels: halfway up, its radius is 70 % of the way out (GENERATED.md)
  function surfaceAt(L) {
    const t = clamp(L, 0, 1);
    const b = BOWL.bottom;
    const o = BOWL.open;
    const rx = lerp(b.rx, o.rx, Math.sqrt(t)) * 572 * 0.96;
    return { cx: lerp(b.cx, o.cx, t) * 572, cy: lerp(b.cy, o.cy, t) * 377, rx, ry: (rx * (o.ry * 377)) / (o.rx * 572) };
  }

  function paintMix() {
    const s = surfaceAt(mix.level);
    mix.surface.setAttribute('transform', `translate(${s.cx.toFixed(2)} ${s.cy.toFixed(2)}) scale(${s.rx.toFixed(2)} ${s.ry.toFixed(2)})`);
    mix.spin.setAttribute('transform', `rotate(${(mix.turn % 360).toFixed(2)})`);
    mix.base.setAttribute('fill', rgb(mix.color));
    mix.svg.style.opacity = mix.level > 0.002 ? String(1 - 0.5 * (mix.film || 0)) : '0';
  }

  // A point on the batter (unit disc, as seen) in scene units, the bowl at home
  function onBatter(u, v) {
    const s = surfaceAt(mix.level);
    const o = O.dubuo;
    const k = o.w / 572;
    return [o.x + (s.cx + u * s.rx) * k, o.y + (s.cy + v * s.ry) * k];
  }

  function batterOval() {
    const s = surfaceAt(mix.level);
    const o = O.dubuo;
    const k = o.w / 572;
    return { x: o.x + s.cx * k, y: o.y + s.cy * k, rx: s.rx * k, ry: s.ry * k };
  }

  // Something new on the batter where it fell: undo the stir's turn
  function onSpin(u, v) {
    const a = (-mix.turn * Math.PI) / 180;
    return [u * Math.cos(a) - v * Math.sin(a), u * Math.sin(a) + v * Math.cos(a)];
  }

  function fadeAttr(n, from, to, ms) {
    return tween(ms, (p) => n.setAttribute('opacity', lerp(from, to, p).toFixed(3)), linear);
  }

  function levelTo(L, ms) {
    const from = mix.level;
    return tween(ms, (p) => {
      mix.level = lerp(from, L, p);
      paintMix();
    });
  }

  function addYolk(i) {
    const [u, v] = onSpin(YOLKS[i % YOLKS.length][0], YOLKS[i % YOLKS.length][1]);
    const g = svgEl('g', { transform: `translate(${u.toFixed(3)} ${v.toFixed(3)})`, opacity: 0 }, mix.yolks);
    svgEl('circle', { r: 0.27, fill: '#FFFFFF', opacity: 0.55 }, g);
    svgEl('circle', { r: 0.15, fill: 'url(#pk-g-yolk)' }, g);
    svgEl('ellipse', { cx: -0.05, cy: -0.05, rx: 0.05, ry: 0.035, fill: '#FFF3C4', opacity: 0.9 }, g);
    return fadeAttr(g, 0, 1, 200);
  }

  function addMound(i) {
    const [u, v] = onSpin(MOUNDS[i % MOUNDS.length][0], MOUNDS[i % MOUNDS.length][1]);
    const g = svgEl('g', { transform: `translate(${u.toFixed(3)} ${v.toFixed(3)})`, opacity: 0 }, mix.flour);
    svgEl('circle', { r: 0.36, fill: 'url(#pk-g-mound)' }, g);
    svgEl('ellipse', { cx: -0.05, cy: -0.08, rx: 0.15, ry: 0.09, fill: '#FFFFFF' }, g);
    return fadeAttr(g, 0, 1, 260);
  }

  // The pot's contents, just inside its lip (the mouth is 95 × 36 px at 127, 50)
  const POT_FILL = {
    yogurt: '<ellipse cx="127" cy="55" rx="86" ry="29" fill="#FFFDF8" stroke="#E6DCCB" stroke-width="3"/><path d="M98 52c14-9 44-11 62-2" stroke="#EFE6D6" stroke-width="5" fill="none" stroke-linecap="round"/>',
    sugar: '<ellipse cx="127" cy="55" rx="86" ry="29" fill="#FFFFFF" stroke="#E2D5BE" stroke-width="3"/><g fill="#E6D8BF"><circle cx="98" cy="50" r="3"/><circle cx="122" cy="62" r="2.6"/><circle cx="150" cy="48" r="2.8"/><circle cx="170" cy="58" r="2.4"/><circle cx="84" cy="60" r="2.2"/><circle cx="136" cy="70" r="2.2"/></g>',
    flour: '<path d="M42 57C58 30 96 20 128 20s70 10 86 37c-22 12-150 12-172 0Z" fill="#FFFEFA" stroke="#E6DED0" stroke-width="3"/><path d="M92 38c12-6 34-8 50-4" stroke="#FFFFFF" stroke-width="6" fill="none" stroke-linecap="round"/>',
    oil: '<ellipse cx="127" cy="67" rx="80" ry="26" fill="#F2C14E"/><ellipse cx="108" cy="62" rx="26" ry="7" fill="#FFE59A" opacity=".85"/>',
  };

  function buildPot() {
    const o = O.indelis;
    pot.svg = svgEl('svg', { class: 'pk-layer pk-fill', viewBox: '0 0 256 268', 'aria-hidden': 'true', focusable: 'false' }, o.el);
    pot.g = svgEl('g', {}, pot.svg);
    setFill('yogurt', true);
  }

  function setFill(kind, on) {
    pot.kind = kind;
    pot.g.innerHTML = POT_FILL[kind] || '';
    pot.svg.style.opacity = on ? '1' : '0';
  }

  function buildTin() {
    const o = O.forma;
    tin.zalia = picture('forma-zalia', 520, 442, 'pk-tin', o.el);
    tin.poolSvg = svgEl('svg', { class: 'pk-layer pk-pool', viewBox: '0 0 520 442', 'aria-hidden': 'true', focusable: 'false' }, o.el);
    const clipPath = svgEl('clipPath', { id: 'pk-clip-tin' }, svgEl('defs', {}, tin.poolSvg));
    const r = TIN.rimInner;
    svgEl('ellipse', { cx: r.cx * 520, cy: r.cy * 442, rx: r.rx * 520 - 3, ry: r.ry * 442 - 3 }, clipPath);
    const g = svgEl('g', { 'clip-path': 'url(#pk-clip-tin)' }, tin.poolSvg);
    tin.pool = svgEl('ellipse', { cx: TIN.surface.cx * 520, cy: TIN.surface.cy * 442, rx: 0, ry: 0, fill: rgb(COL.batter) }, g);
    tin.kepta = picture('forma-kepta', 520, 442, 'pk-tin', o.el);
    // The apples lie on the batter's oval: the box is the oval, a slice is
    // placed in it at (50 + 50x %, 50 + 50y %)
    tin.apples = el('div', 'pk-apples', o.el);
    const t = TIN.top;
    tin.apples.style.left = `${((t.cx - t.rx) * 100).toFixed(3)}%`;
    tin.apples.style.top = `${((t.cy - t.ry) * 100).toFixed(3)}%`;
    tin.apples.style.width = `${(t.rx * 200).toFixed(3)}%`;
    tin.apples.style.height = `${(t.ry * 200).toFixed(3)}%`;
    tin.cin = svgEl('svg', { class: 'pk-cin', viewBox: '-1 -1 2 2', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }, tin.apples);
  }

  // When baked, the apples ride up onto the cake's top oval
  const BAKED = (() => {
    const z = TIN.top;
    const k = TIN.baked;
    const tx = ((k.cx - z.cx) / (2 * z.rx)) * 100;
    const ty = ((k.cy - z.cy) / (2 * z.ry)) * 100;
    return `translate(${tx.toFixed(3)}%, ${ty.toFixed(3)}%) scale(${(k.rx / z.rx).toFixed(4)}, ${(k.ry / z.ry).toFixed(4)})`;
  })();

  // The tin's batter top in scene units, the tin at home
  function tinOval() {
    const o = O.forma;
    const t = TIN.top;
    return { x: o.x + t.cx * o.w, y: o.y + t.cy * o.h, rx: t.rx * o.w, ry: t.ry * o.h };
  }

  function buildOven() {
    const o = O.orkaite;
    const w = OVEN.window;
    const box = [o.x + w.x * o.w, o.y + w.y * o.h, w.w * o.w, w.h * o.h];
    const radius = `${(((w.r * o.w) / box[2]) * 100).toFixed(2)}% / ${(((w.r * o.w) / box[3]) * 100).toFixed(2)}%`;
    oven.box = box;
    oven.light = el('div', 'pk-oven pk-oven--light', scene);
    placeBox(oven.light, box[0], box[1], box[2], box[3]);
    oven.light.style.borderRadius = radius;
    el('span', 'pk-oven__rack', oven.light);
    oven.glass = el('div', 'pk-oven pk-oven--glass', scene);
    placeBox(oven.glass, box[0], box[1], box[2], box[3]);
    oven.glass.style.borderRadius = radius;
    const led = spot(o, OVEN.led);
    oven.led = el('div', 'pk-led', scene);
    placeBox(oven.led, led[0] - 5, led[1] - 5, 10, 10);
    oven.chip = el('div', 'pk-chip', scene);
    oven.chip.style.left = '81%';
    oven.chip.style.top = `${(326 / 6.4).toFixed(3)}%`;
  }

  function buildTimer() {
    const o = O.laikmatis;
    const s = svgEl('svg', { class: 'pk-layer pk-dial', viewBox: '0 0 205 248', 'aria-hidden': 'true', focusable: 'false' }, o.el);
    const ticks = svgEl('g', { stroke: '#D9C6A2', 'stroke-width': 5, 'stroke-linecap': 'round' }, s);
    for (let i = 0; i < 12; i += 1) {
      const a = (i * 30 * Math.PI) / 180;
      const r1 = i % 3 ? 61 : 55;
      svgEl('line', { x1: DIAL.cx + r1 * Math.sin(a), y1: DIAL.cy - r1 * Math.cos(a), x2: DIAL.cx + 67 * Math.sin(a), y2: DIAL.cy - 67 * Math.cos(a) }, ticks);
    }
    timer.wedge = svgEl('path', { fill: '#E07A62', opacity: 0.55 }, s);
    timer.hand = svgEl('line', { x1: DIAL.cx, y1: DIAL.cy, x2: DIAL.cx, y2: DIAL.cy - 50, stroke: '#7A4B0E', 'stroke-width': 7, 'stroke-linecap': 'round' }, s);
    svgEl('circle', { cx: DIAL.cx, cy: DIAL.cy, r: 9, fill: '#7A4B0E' }, s);
    timer.chip = el('div', 'pk-chip pk-chip--time', scene);
    timer.chip.style.left = `${(880 / 10).toFixed(3)}%`;
    timer.chip.style.top = `${(300 / 6.4).toFixed(3)}%`;
    timer.shown = -1;
    setDial(0);
  }

  // The dial shows the minutes left as an apple-red wedge (a 60-minute face)
  function setDial(minutes) {
    const a = (clamp(minutes, 0, 59.9) / 60) * Math.PI * 2;
    const r = 48;
    if (minutes <= 0.05) timer.wedge.setAttribute('d', '');
    else {
      const x = DIAL.cx + r * Math.sin(a);
      const y = DIAL.cy - r * Math.cos(a);
      timer.wedge.setAttribute('d', `M${DIAL.cx} ${DIAL.cy}L${DIAL.cx} ${DIAL.cy - r}A${r} ${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)}Z`);
    }
    timer.hand.setAttribute('x2', (DIAL.cx + 50 * Math.sin(a)).toFixed(2));
    timer.hand.setAttribute('y2', (DIAL.cy - 50 * Math.cos(a)).toFixed(2));
    const shown = Math.ceil(minutes - 0.001);
    if (shown !== timer.shown) {
      timer.shown = shown;
      timer.chip.textContent = `${Math.max(0, shown)} min`;
    }
  }

  function setHeat(h) {
    state.heat = h;
    oven.light.style.opacity = h.toFixed(3);
    root.style.setProperty('--pk-warm', (h * 0.9).toFixed(3));
  }

  function heatTo(h, ms) {
    const from = state.heat;
    return tween(ms, (p) => setHeat(lerp(from, h, p)));
  }

  function build() {
    if (state.built) return;
    state.built = true;
    buildDefs();
    Object.keys(ART).forEach((name) => makeObject(name, ART[name]));
    buildBowl();
    buildPot();
    buildTin();
    buildOven();
    buildTimer();
    flow = svgEl('svg', { class: 'pk-flow', viewBox: '0 0 1000 640', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' }, scene);
    stage.classList.add('is-ready');
    layout();
    goTo(0, true);
  }

  // ---------------------------------------------
  // The choreography
  // ---------------------------------------------

  // The pot over the bowl, tipped; what it holds falls in
  async function potToBowl(kind, last) {
    const o = O.indelis;
    setZ(o, 9);
    await flyTo(o, { m: AT.potOver, p: o.mouth, deg: 0 }, 640, { lift: 46 });
    await flyTo(o, { m: AT.potOver, p: o.mouth, deg: 118 }, 360, { easing: EASE.out });
    const lip = pointAt(o, AT.potOver, o.mouth, 118, 1, [o.mouth[0] + o.mouthR * 0.85, o.mouth[1]]);
    if (kind === 'yogurt') await dropDollop(lip);
    else if (kind === 'oil') await pourStream(lip, '#F2C14E', 3, 560, () => showOil());
    else await pourGrains(lip, kind, last);
    await flyTo(o, { m: AT.potOver, p: o.mouth, deg: 0 }, 300, { easing: EASE.out });
    await goHome(o, 620, { lift: 36 });
  }

  async function dropDollop(lip) {
    const land = onBatter(0, 0);
    const b = bit(DOLLOP, lip[0] - 21, lip[1] - 17, 42, 34, 9);
    fade(pot.svg, 1, 0, 140);
    await animateNode(b, [{ transform: shift(b, 0, 0, 0, 0.7) }, { transform: shift(b, land[0] - lip[0], land[1] - lip[1], 0, 1) }], 380, EASE.in);
    popAt('Pliumpt!', land[0] + 54, land[1] - 40);
    mix.color = COL.yogurt.slice();
    levelTo(0.16, 320);
    await animateNode(b, [{ transform: shift(b, land[0] - lip[0], land[1] - lip[1], 0, 1) }, { transform: shift(b, land[0] - lip[0], land[1] - lip[1] + 4, 0, 1.6, 0.35), opacity: 0 }], 220, EASE.out);
    b.remove();
  }

  async function pourGrains(lip, kind, last) {
    const land = onBatter(0.05, 0);
    const flour = kind === 'flour';
    const floor = land[1];
    fade(pot.svg, 1, 0, 560);
    emit({
      left: 600,
      rate: flour ? 0.16 : 0.2,
      make: () =>
        spawn({
          kind: flour ? 'dot' : 'grain',
          x: lip[0] + rand(-3, 3),
          y: lip[1] + rand(-2, 2),
          vx: rand(0.002, 0.03),
          vy: rand(0.01, 0.05),
          g: 0.0011,
          size: flour ? rand(0.9, 1.7) : rand(1.6, 2.6),
          life: 900,
          color: flour ? any(['#FFFFFF', '#FFFDF5', '#F7F0E2']) : any(['#FFFFFF', '#FFFDF7', '#EFE4CF']),
          floor: floor + rand(-6, 6),
        }),
    });
    popAt(flour ? (last ? 'Pūkšt!' : 'Byra!') : 'Byra!', land[0] + 64, land[1] - 54);
    await wait(560);
    if (flour) {
      const n = last ? 18 : 6;
      for (let i = 0; i < n; i += 1) {
        spawn({ kind: 'puff', x: land[0] + rand(-40, 40), y: land[1] + rand(-14, 6), vx: rand(-0.03, 0.03), vy: rand(-0.05, -0.012), drag: 0.99, size: rand(14, last ? 34 : 22), grow: 1.3, life: rand(1000, last ? 1900 : 1300), alpha: last ? 0.9 : 0.7 });
      }
      mix.color = blend(mix.color, [255, 253, 246], 0.08);
      addMound(state.count);
      levelTo(mix.level + 0.085, 420);
    } else {
      fadeAttr(mix.sugar, Number(mix.sugar.getAttribute('opacity')) || 0, 1, 300);
      levelTo(mix.level + 0.06 / Q.sugar, 380);
    }
    await wait(260);
  }

  // A thin stream from a lip down to the batter (oil, and the batter into the tin)
  async function pourStream(from, color, width, ms, onLand, to) {
    const end = to || onBatter(0.05, 0);
    const d = `M${from[0].toFixed(1)} ${from[1].toFixed(1)}C${(from[0] + 6).toFixed(1)} ${(from[1] + 18).toFixed(1)} ${end[0].toFixed(1)} ${(end[1] - 24).toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`;
    const path = svgEl('path', { d, pathLength: 100, fill: 'none', stroke: color, 'stroke-width': width, 'stroke-linecap': 'round', 'stroke-dasharray': '100 100', 'stroke-dashoffset': 100 }, flow);
    fade(pot.svg, 1, 0, ms);
    await tween(ms * 0.35, (p) => path.setAttribute('stroke-dashoffset', (100 - 100 * p).toFixed(2)), linear);
    if (onLand) onLand();
    await wait(ms * 0.4);
    await tween(ms * 0.3, (p) => path.setAttribute('stroke-dashoffset', (-100 * p).toFixed(2)), linear);
    path.remove();
  }

  function showOil() {
    fadeAttr(mix.oil, 0, 1, 320);
    levelTo(mix.level + 0.04, 400);
  }

  // The sugar jar or the flour sack: the pot dips in behind it and comes up full
  async function scoop(name, kind) {
    const p = O.indelis;
    const src = O[name];
    const m = spot(src, src.mouth);
    setZ(p, 9);
    await flyTo(p, { m: [m[0], m[1] - 40], p: [0.5, 0.95], deg: -18 }, 720, { lift: 40 });
    setZ(p, 1);
    await flyTo(p, { m: [m[0] + 3, m[1] + 30], p: [0.5, 0.95], deg: -26 }, 280, { easing: EASE.in });
    setFill(kind, true);
    if (kind === 'flour') {
      for (let i = 0; i < 4; i += 1) spawn({ kind: 'puff', x: m[0] + rand(-14, 14), y: m[1] - 4, vy: rand(-0.03, -0.01), size: rand(8, 13), grow: 1, life: 900, alpha: 0.75 });
    } else sparkle(m[0], m[1] - 6, 5, 14);
    await wait(120);
    await flyTo(p, { m: [m[0], m[1] - 46], p: [0.5, 0.95], deg: 0 }, 320, { easing: EASE.out });
    setZ(p, 9);
  }

  async function crackEgg(i) {
    const k = O.kiausiniai;
    const from = spot(k, k.egg);
    const w = 40;
    const h = 32;
    const rim = AT.eggRim;
    const left = bit(eggHalf(EGG_L), from[0] - w / 2, from[1] - h / 2, w, h, 9);
    const right = bit(eggHalf(EGG_R), from[0] - w / 2, from[1] - h / 2, w, h, 9);
    left.style.transformOrigin = right.style.transformOrigin = '50% 90%';
    const dx = rim[0] - from[0];
    const dy = rim[1] - from[1];
    const path = [
      { transform: shift(left, 0, 0, -10, 0.85) },
      { transform: shift(left, dx * 0.5, dy * 0.5 - 60, 12, 1.1), offset: 0.55 },
      { transform: shift(left, dx, dy, 0, 1) },
    ];
    if (!reduce && typeof k.el.animate === 'function') {
      k.el.animate([{ translate: '0 0' }, { translate: '0 -6%' }, { translate: '0 0' }], { duration: 300, easing: 'ease-out' });
    }
    await Promise.all([animateNode(left, path, 620), animateNode(right, path, 620)]);
    const tap = [{ transform: shift(left, dx, dy, 0, 1) }, { transform: shift(left, dx, dy + 6, 10, 1) }, { transform: shift(left, dx, dy, 0, 1) }];
    await Promise.all([animateNode(left, tap, 200, 'ease-out'), animateNode(right, tap, 200, 'ease-out')]);
    popAt(`${i}!`, rim[0] + 48, rim[1] - 22, { big: true });
    const yolk = bit(YOLK, rim[0] - 9, rim[1] - 6, 18, 18, 9);
    const at = YOLKS[(i - 1) % YOLKS.length];
    const land = onBatter(at[0], at[1]);
    animateNode(left, [{ transform: shift(left, dx, dy, 0, 1), opacity: 1 }, { transform: shift(left, dx - 16, dy - 10, -40, 1), opacity: 1, offset: 0.6 }, { transform: shift(left, dx - 24, dy - 2, -55, 1), opacity: 0 }], 560, EASE.out);
    animateNode(right, [{ transform: shift(right, dx, dy, 0, 1), opacity: 1 }, { transform: shift(right, dx + 16, dy - 10, 40, 1), opacity: 1, offset: 0.6 }, { transform: shift(right, dx + 24, dy - 2, 55, 1), opacity: 0 }], 560, EASE.out);
    await animateNode(yolk, [{ transform: shift(yolk, 0, 0, 0, 0.8) }, { transform: shift(yolk, land[0] - rim[0], land[1] - rim[1] + 3, 0, 1.1, 0.8) }], 380, EASE.in);
    addYolk(i - 1);
    levelTo(mix.level + 0.05, 260);
    await fade(yolk, 1, 0, 140);
    yolk.remove();
    await wait(200);
    left.remove();
    right.remove();
  }

  async function whiskBowl() {
    const w = O.plaktuvas;
    const c = batterOval();
    const tip = [c.x + 6, c.y + 2];
    setZ(w, 6);
    await flyTo(w, { m: [tip[0], tip[1] - 64], p: w.tip, deg: -18 }, 760, { lift: 24 });
    await flyTo(w, { m: tip, p: w.tip, deg: -18 }, 240, { easing: EASE.in });
    popAt('Plak plak!', c.x + 86, c.y - 70);
    // the wires swing about the handle's end while the yolks and the sugar mix in
    const hinge = pointAt(w, tip, w.tip, -18, 1, w.origin);
    const frames = [];
    for (let i = 0; i < 8; i += 1) frames.push({ transform: pose(w, hinge, w.origin, i % 2 ? -30 : -6) });
    frames.push({ transform: pose(w, hinge, w.origin, -18) });
    const startColor = mix.color.slice();
    const turn0 = mix.turn;
    const yolks = Array.from(mix.yolks.children);
    const sugar0 = Number(mix.sugar.getAttribute('opacity')) || 0;
    tween(1400, (p) => {
      mix.turn = turn0 + p * 600;
      mix.color = blend(startColor, COL.whisked, p);
      yolks.forEach((y) => y.setAttribute('opacity', (1 - p).toFixed(3)));
      mix.sugar.setAttribute('opacity', (sugar0 * (1 - p)).toFixed(3));
      mix.swirl.setAttribute('opacity', (0.5 * Math.sin(Math.PI * p)).toFixed(3));
      paintMix();
    });
    await fly(w, frames, reduce ? 0 : 1400, 'linear');
    w.pos = { m: hinge, p: w.origin, deg: -18, s: 1 };
    yolks.forEach((y) => y.remove());
    await flyTo(w, { m: [tip[0], tip[1] - 70], p: w.tip, deg: -18 }, 300, { easing: EASE.out });
    await goHome(w, 780, { lift: 20 });
  }

  async function oilIntoPot() {
    const b = O.aliejus;
    const p = O.indelis;
    const mouth = spot(p, p.mouth);
    const neck = [mouth[0] + 16, mouth[1] - 36];
    setZ(b, 9);
    await flyTo(b, { m: neck, p: b.neck, deg: 0 }, 700, { lift: 40 });
    await flyTo(b, { m: neck, p: b.neck, deg: -122 }, 360, { easing: EASE.out });
    const lip = pointAt(b, neck, b.neck, -122, 1, [0.5, 0.01]);
    setFill('oil', false);
    const fill = pot.svg;
    const path = svgEl('path', { d: `M${lip[0].toFixed(1)} ${lip[1].toFixed(1)}Q${(lip[0] - 4).toFixed(1)} ${(lip[1] + 12).toFixed(1)} ${mouth[0].toFixed(1)} ${(mouth[1] + 4).toFixed(1)}`, pathLength: 100, fill: 'none', stroke: '#F2C14E', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-dasharray': '100 100', 'stroke-dashoffset': 100 }, flow);
    await tween(200, (q) => path.setAttribute('stroke-dashoffset', (100 - 100 * q).toFixed(2)), linear);
    await fade(fill, 0, 1, 520);
    await tween(160, (q) => path.setAttribute('stroke-dashoffset', (-100 * q).toFixed(2)), linear);
    path.remove();
    popAt('Pusė!', mouth[0] - 40, mouth[1] - 30);
    await flyTo(b, { m: neck, p: b.neck, deg: 0 }, 300, { easing: EASE.out });
    await goHome(b, 700, { lift: 30 });
  }

  // Stirring: the spoon goes round the batter; the colours run together
  const stir = { on: false, p: 0, angle: -90, pointer: null, lastA: null, holding: false, half: false, done: false, level0: 0, color0: null };

  function spoonTarget() {
    const a = (stir.angle * Math.PI) / 180;
    return { m: onBatter(Math.cos(a) * 0.42, Math.sin(a) * 0.42), p: O.samtis.head, deg: 169 + Math.sin(a) * 8, s: 1 };
  }

  async function spoonIn() {
    const s = O.samtis;
    Object.assign(stir, { on: false, p: 0, angle: -90, pointer: null, lastA: null, holding: false, half: false, done: false, level0: mix.level, color0: mix.color.slice() });
    stir.mounds = Array.from(mix.flour.children);
    setZ(s, 6);
    const t = spoonTarget();
    await flyTo(s, { m: [t.m[0], t.m[1] - 56], p: t.p, deg: t.deg }, 800, { lift: 20 });
    await flyTo(s, t, 240, { easing: EASE.in });
    stir.on = true;
  }

  function stirBy(dp, dAngle) {
    if (!stir.on || stir.done) return;
    stir.p = clamp(stir.p + dp, 0, 1);
    stir.angle += dAngle;
    mix.turn += dAngle * 0.7;
    const p = stir.p;
    mix.color = blend(stir.color0, COL.batter, p);
    mix.level = lerp(stir.level0, stir.level0 - 0.03, p);
    stir.mounds.forEach((m) => m.setAttribute('opacity', (1 - p).toFixed(3)));
    mix.oil.setAttribute('opacity', (1 - p).toFixed(3));
    mix.swirl.setAttribute('opacity', (0.55 * Math.sin(Math.PI * Math.min(1, p * 1.15)) + 0.18 * p).toFixed(3));
    paintMix();
    const s = O.samtis;
    s.pos = spoonTarget();
    setNow(s, pose(s, s.pos.m, s.pos.p, s.pos.deg, 1));
    if (!stir.half && p >= 0.5) {
      stir.half = true;
      setNote('Dar truputį – gumulėliai nyksta!');
    }
    if (p >= 1) {
      stir.done = true;
      stir.holding = false;
      stir.pointer = null;
      act('stirred');
    }
  }

  async function spoonOut() {
    const s = O.samtis;
    stir.on = false;
    const t = s.pos;
    await flyTo(s, { m: [t.m[0], t.m[1] - 60], p: t.p, deg: t.deg }, 320, { easing: EASE.out });
    await goHome(s, 800, { lift: 24 });
  }

  async function pourBatter() {
    const b = O.dubuo;
    const lipF = [BOWL.open.cx + BOWL.open.rx * 0.97, BOWL.open.cy];
    const M = [604, 348];
    await flyTo(b, { m: [M[0] - 34, M[1] - 44], p: lipF, deg: 0 }, 760, { lift: 30 });
    await flyTo(b, { m: M, p: lipF, deg: 34 }, 520, { easing: EASE.out });
    const o = O.forma;
    const land = [o.x + TIN.surface.cx * o.w, o.y + TIN.surface.cy * o.h];
    const d = `M${M[0]} ${M[1] + 2}C${M[0] + 16} ${M[1] + 8} ${land[0] - 10} ${land[1] - 46} ${land[0]} ${land[1]}`;
    const ribbon = svgEl('path', { d, pathLength: 100, fill: 'none', stroke: rgb(COL.batter), 'stroke-width': 12, 'stroke-linecap': 'round', 'stroke-dasharray': '100 100', 'stroke-dashoffset': 100 }, flow);
    const shine = svgEl('path', { d, pathLength: 100, fill: 'none', stroke: '#FFF4D2', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-dasharray': '100 100', 'stroke-dashoffset': 100, transform: 'translate(-2 0)' }, flow);
    const dash = (v) => {
      ribbon.setAttribute('stroke-dashoffset', v.toFixed(2));
      shine.setAttribute('stroke-dashoffset', v.toFixed(2));
    };
    await tween(340, (p) => dash(100 - 100 * p), linear);
    tin.poolSvg.style.opacity = '1';
    const L0 = mix.level;
    const S = TIN.surface;
    await tween(1200, (p) => {
      const e = easeOut(p);
      tin.pool.setAttribute('rx', (S.rx * 520 * e).toFixed(2));
      tin.pool.setAttribute('ry', (S.ry * 442 * e).toFixed(2));
      mix.level = lerp(L0, 0.03, p);
      mix.film = p;
      paintMix();
    }, linear);
    fade(tin.zalia, 0, 1, 320);
    await tween(280, (p) => dash(-100 * p), linear);
    ribbon.remove();
    shine.remove();
    fade(tin.poolSvg, 1, 0, 200);
    popAt('Čiurkšt!', land[0] + 30, land[1] - 60);
    await flyTo(b, { m: [M[0] - 34, M[1] - 44], p: lipF, deg: 0 }, 420, { easing: EASE.out });
    await goHome(b, 720, { lift: 20 });
  }

  // The apples: a slice dropped where the batter was tapped. The wrapper is
  // squashed onto the oval and carries the shadow, so it falls the same way
  // for every slice; the picture inside turns.
  function sliceEl(a) {
    const wrap = el('span', 'pk-slice', null);
    wrap.style.left = `${(50 + a.x * 50).toFixed(3)}%`;
    wrap.style.top = `${(50 + a.y * 50).toFixed(3)}%`;
    wrap.style.width = `${(SLICE.length * 50).toFixed(2)}%`;
    wrap.style.transform = `translate(-50%, -50%) scale(1, ${SQUASH.toFixed(4)})`;
    const img = picture(SLICE.file, SLICE.px[0], SLICE.px[1], 'pk-slice__img', wrap);
    img.style.transform = `rotate(${(a.r + SLICE.turn).toFixed(2)}deg)`;
    tin.apples.insertBefore(wrap, tin.cin);
    return wrap;
  }

  function dropSlice(img, delay) {
    if (reduce || typeof img.animate !== 'function') return Promise.resolve();
    return new Promise((resolve) => {
      const anim = img.animate(
        [
          { translate: '0 -170%', opacity: 0 },
          { translate: '0 14%', opacity: 1, offset: 0.7 },
          { translate: '0 0', opacity: 1 },
        ],
        { duration: 420, delay: delay || 0, easing: 'cubic-bezier(.3,.7,.4,1)', fill: 'backwards' }
      );
      anim.onfinish = resolve;
      anim.oncancel = resolve;
    });
  }

  function clearSlices() {
    Array.from(tin.apples.querySelectorAll('.pk-slice')).forEach((n) => n.remove());
    state.apples = [];
  }

  // The rosette the slice game knows: two rings, skins out (do not change)
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

  // A tap on the tin, un-squashed from the batter's oval into cake-top coordinates
  function sliceAt(pt) {
    const t = tinOval();
    let x = (pt[0] - t.x) / t.rx;
    let y = (pt[1] - t.y) / t.ry;
    const d = Math.hypot(x, y);
    if (d > 1.18) return null;
    if (d > 0.84) {
      x *= 0.84 / d;
      y *= 0.84 / d;
    }
    const r = d < 0.12 ? rand(0, 360) : (Math.atan2(y, x) * 180) / Math.PI + 90;
    return { x, y, r };
  }

  async function layRosette() {
    clearSlices();
    state.apples = rosette();
    const imgs = state.apples.map(sliceEl);
    await Promise.all(imgs.map((img, i) => dropSlice(img, i * 55)));
    const t = tinOval();
    sparkle(t.x, t.y - 6, 12, 50);
  }

  async function sprinkle() {
    const c = O.cinamonas;
    const t = tinOval();
    const over = [t.x + 4, t.y - 64];
    setZ(c, 9);
    await flyTo(c, { m: over, p: [0.5, 0.5], deg: -8, s: 0.9 }, 760, { lift: 50 });
    const colours = ['#9A5B2E', '#B5703A', '#7E4521'];
    emit({
      left: 1000,
      rate: 0.09,
      make: () => spawn({ kind: 'dot', x: over[0] + rand(-26, 26), y: over[1] + 14, vx: rand(-0.012, 0.012), vy: rand(0.01, 0.04), g: 0.0006, size: rand(1, 1.9), color: any(colours), floor: t.y + rand(-t.ry, t.ry) * 0.8, life: 1500 }),
    });
    const specks = [];
    for (let i = 0; i < 52; i += 1) {
      const a = rand(0, Math.PI * 2);
      const d = Math.sqrt(Math.random()) * 0.92;
      specks.push(svgEl('ellipse', { cx: (Math.cos(a) * d).toFixed(3), cy: (Math.sin(a) * d).toFixed(3), rx: rand(0.011, 0.022).toFixed(3), ry: rand(0.011, 0.022).toFixed(3), fill: any(colours), opacity: 0 }, tin.cin));
    }
    tween(1300, (p) => specks.forEach((s, i) => s.setAttribute('opacity', clamp(p * 2.2 - i / specks.length, 0, 0.9).toFixed(3))), linear);
    const frames = [];
    for (let i = 0; i < 6; i += 1) frames.push({ transform: pose(c, over, [0.5, 0.5], i % 2 ? 12 : -24, 0.9) });
    frames.push({ transform: pose(c, over, [0.5, 0.5], -8, 0.9) });
    popAt('Šiu šiu!', over[0] + 70, over[1] - 4);
    await fly(c, frames, reduce ? 0 : 1050, 'ease-in-out');
    c.pos = { m: over, p: [0.5, 0.5], deg: -8, s: 0.9 };
    await goHome(c, 760, { lift: 40 });
  }

  function ovenOn() {
    oven.led.classList.add('is-on');
    oven.chip.textContent = `${Q.temp} °C`;
    oven.chip.classList.add('is-on');
  }

  async function apronOn() {
    const a = O.prijuoste;
    const hang = spot(a, a.origin);
    const frames = [14, -10, 6, -3, 0].map((d) => ({ transform: pose(a, hang, a.origin, d) }));
    sparkle(hang[0], hang[1] + 64, 12, 44);
    ovenOn();
    heatTo(0.24, 900);
    const glass = [oven.box[0] + oven.box[2] / 2, oven.box[1] + oven.box[3] * 0.45];
    popAt('Kaista!', glass[0], glass[1]);
    setTimeout(() => {
      if (STEPS[state.i].id !== 'orkaite') oven.chip.classList.remove('is-on');
    }, 3200);
    await fly(a, frames, reduce ? 0 : 1100, 'ease-in-out');
    a.pos = homePos(a);
    await wait(250);
  }

  async function bake() {
    const t = O.forma;
    const box = oven.box;
    const inside = [box[0] + box[2] / 2, box[1] + box[3] / 2 + 6];
    heatTo(0.45, 600);
    oven.chip.classList.add('is-on');
    setZ(t, 4);
    await flyTo(t, { m: inside, p: [0.5, 0.5], deg: 0, s: 0.64 }, 950, { lift: 90 });
    setNote(`Kepa… ${Q.temp} °C.`);
    timer.chip.classList.add('is-on');
    await tween(420, (p) => setDial(Q.minutes * p), easeOut);
    // the baking itself: a few seconds for 40 minutes
    const ms = reduce ? 0 : 6000;
    steamFrom(box[0] + box[2] / 2, O.orkaite.y + 4, 90, ms, 0.009);
    animateNode(tin.kepta, [{ opacity: 0 }, { opacity: 1 }], ms, 'linear');
    tin.apples.classList.add('is-baked');
    animateNode(tin.apples, [{ transform: 'translate(0%, 0%) scale(1, 1)' }, { transform: BAKED }], ms, EASE.move);
    await tween(ms, (p) => {
      setDial(Q.minutes * (1 - p));
      setHeat(0.45 + 0.5 * Math.min(1, p * 2.5) + 0.05 * Math.sin(p * 40));
    }, linear);
    setDial(0);
    bell();
    const dial = spot(O.laikmatis, [0.5, 0]);
    popAt('Dzin!', dial[0], dial[1] - 2, { big: true, hold: 1500 });
    sparkle(dial[0], dial[1] + 30, 12, 30);
    const tm = O.laikmatis;
    const c = spot(tm, [0.5, 0.6]);
    const shake = [8, -8, 6, -6, 3, 0].map((d) => ({ transform: pose(tm, c, [0.5, 0.6], d) }));
    await fly(tm, shake, reduce ? 0 : 520, 'linear');
    tm.pos = homePos(tm);
    heatTo(0.6, 400);
  }

  async function takeOut() {
    const m = O.puodkele;
    const t = O.forma;
    const inside = t.pos;
    const grip = (c, s) => [c[0] + (t.w * s) / 2 + 2, c[1] + 4 * s];
    setZ(m, 12);
    await flyTo(m, { m: grip(inside.m, inside.s), p: m.grip, deg: 0, s: 0.78 }, 900, { lift: 50 });
    setZ(t, 11);
    const home = spot(t, [0.5, 0.5]);
    await Promise.all([
      flyTo(t, { m: home, p: [0.5, 0.5], deg: 0, s: 1 }, 1000, { lift: 70 }),
      flyTo(m, { m: grip(home, 1), p: m.grip, deg: 0, s: 1 }, 1000, { lift: 70 }),
    ]);
    t.pos = homePos(t);
    setNow(t, t.home);
    setZ(t, t.z);
    heatTo(0, 900);
    oven.led.classList.remove('is-on');
    oven.chip.classList.remove('is-on');
    timer.chip.classList.remove('is-on');
    const top = tinOval();
    steamFrom(top.x, top.y - 10, top.rx * 1.2, 7000, 0.014);
    popAt('Karšta!', top.x + 70, top.y - 70);
    await goHome(m, 850, { lift: 40 });
  }

  // The cake is out: tell the slice game which apples it has
  function publish() {
    const apples = state.apples.map((a) => ({ x: a.x, y: a.y, r: a.r }));
    window.pyragas = { apples, baked: true };
    document.dispatchEvent(new CustomEvent('pyragas:iskeptas', { detail: { apples } }));
  }

  // ---------------------------------------------
  // The steps
  // ---------------------------------------------
  function sliceNote(n) {
    if (n >= MAX_SLICES) return `Skiltelių: ${n} – daugiau netelpa!`;
    if (n >= 5) return `Skiltelių: ${n}. Galima dėti dar – arba toliau.`;
    return `Skiltelių: ${n}. Dar ${COUNT_F[5 - n]}!`;
  }

  const STEPS = [
    {
      id: 'pradzia', dot: 0, rec: 1, who: 'kartu', cam: 'start',
      say: () => '„Pirma – rankos ir prijuostės!“',
      note: () => `Nusiplaukite rankas, užsiriškite prijuostes ir įjunkite orkaitę – ${Q.temp} °C.`,
      go: () => 'Pradėkime!',
      tap: ['prijuoste', 'orkaite'],
      run: async () => {
        await apronOn();
        return { done: `Orkaitė kaista iki ${Q.temp} °C. Galima pradėti!` };
      },
    },
    {
      id: 'jogurtas', dot: 1, rec: 2, who: 'vaikas', cam: 'pot', item: 'jogurtas',
      say: () => '„Jogurtas – į dubenį!“',
      note: () => 'Bakstelėkite jogurto indelį arba nuneškite jį į dubenį.',
      go: () => 'Išpilti jogurtą',
      tap: ['indelis', 'dubuo'],
      drag: { from: 'indelis', to: ['dubuo'] },
      run: async () => {
        await potToBowl('yogurt');
        return { done: 'Pliumpt! Tuščią indelį pasilikite – nuo šiol jis bus matas.' };
      },
    },
    {
      id: 'cukrus', dot: 2, rec: 3, who: 'vaikas', cam: 'left', item: 'cukrus', n: Q.sugar,
      say: () => (Q.sugar === 1 ? '„Indelis cukraus!“' : `„${cap(COUNT[Q.sugar])} indeliai cukraus!“`),
      note: () => 'Bakstelėkite indelį ar cukrų – arba nuneškite indelį prie stiklainio.',
      go: () => 'Įberti cukraus',
      tap: ['indelis', 'cukrus'],
      drag: { from: 'indelis', to: ['cukrus'] },
      run: async (how, info, count) => {
        await scoop('cukrus', 'sugar');
        await potToBowl('sugar');
        if (count < Q.sugar) return { note: `„${cap(COUNT[count])}!“` };
        return { done: Q.sugar === 1 ? 'Lygiai vienas indelis cukraus!' : `„${cap(COUNT[count])}!“ Cukraus – kiek reikia.` };
      },
    },
    {
      id: 'kiausiniai', dot: 3, rec: 3, who: 'vaikas', cam: 'eggs', item: 'kiausiniai', n: Q.eggs,
      say: () => (Q.eggs === 1 ? '„Vienas kiaušinis!“' : `„${cap(COUNT[Q.eggs])} kiaušiniai!“`),
      note: () => 'Kiekvienas bakstelėjimas įmuša po kiaušinį – skaičiuokite garsiai! Tikroje virtuvėje muškite pirma į puodelį.',
      go: () => 'Įmušti kiaušinį',
      tap: ['kiausiniai', 'dubuo'],
      run: async (how, info, count) => {
        await crackEgg(count);
        if (count < Q.eggs) return { note: `„${cap(COUNT[count])}!“` };
        fade(O.kiausiniai.el, 1, 0, 400);
        return { done: `„${cap(COUNT[count])}!“ Visi kiaušiniai dubenyje.` };
      },
    },
    {
      id: 'aliejus', dot: 4, rec: 4, who: 'kartu', cam: 'left', item: 'aliejus',
      say: () => (Q.oil === 0.5 ? '„Pusė indelio aliejaus!“' : '„Indelis aliejaus!“'),
      note: () => `Pirma išplakite šluotele, tada įpilkite ${Q.oil === 0.5 ? 'pusę indelio aliejaus – ne pilną ir ne tuščią' : 'aliejaus'}.`,
      go: () => 'Išplakti ir įpilti',
      tap: ['aliejus', 'indelis', 'dubuo', 'plaktuvas'],
      drag: { from: 'aliejus', to: ['indelis', 'dubuo'] },
      run: async () => {
        if (O.aliejus.now !== O.aliejus.home) await goHome(O.aliejus, 420);
        await whiskBowl();
        await oilIntoPot();
        await potToBowl('oil');
        return { done: Q.oil === 0.5 ? 'Pusė indelio – kaip tik tiek, kiek reikia.' : 'Aliejaus – kiek reikia.' };
      },
    },
    {
      id: 'miltai', dot: 5, rec: 5, who: 'vaikas', cam: 'left', item: 'miltai', also: ['milteliai', 'druska'], n: Q.flour,
      say: () => (Q.flour === 1 ? '„Indelis miltų!“' : `„${cap(COUNT[Q.flour])} indeliai miltų!“`),
      note: () => 'Kiekvienas bakstelėjimas – vienas indelis. Kepimo milteliai ir žiupsnelis druskos keliauja kartu su miltais.',
      go: () => 'Įberti indelį miltų',
      tap: ['indelis', 'miltai', 'dubuo'],
      drag: { from: 'indelis', to: ['miltai'] },
      run: async (how, info, count) => {
        await scoop('miltai', 'flour');
        await potToBowl('flour', count === Q.flour);
        if (count < Q.flour) return { note: `„${cap(COUNT[count])}!“` };
        return { done: `„${cap(COUNT[count])}!“ Pūkšt – miltų debesėlis!` };
      },
    },
    {
      id: 'maisyti', dot: 6, rec: 5, who: 'vaikas', cam: 'bowl',
      say: () => '„Maišom, kol neliks gumulėlių!“',
      note: () => 'Sukite ratus dubenyje pele ar pirštu – arba laikykite mygtuką nuspaudę.',
      go: () => 'Maišyti',
      stir: true,
      enter: () => spoonIn(),
      run: async (how) => {
        if (how !== 'stirred') return null;
        await spoonOut();
        return { done: 'Tešla glotni – be gumulėlių!' };
      },
    },
    {
      id: 'forma', dot: 7, rec: 6, who: 'suauges', cam: 'pour',
      say: () => '„Tešla – į formą!“',
      note: () => 'Formą išklokite kepimo popieriumi. Bakstelėkite ją – arba nuneškite dubenį prie formos.',
      go: () => 'Supilti tešlą',
      tap: ['forma', 'dubuo'],
      drag: { from: 'dubuo', to: ['forma'] },
      run: async () => {
        await pourBatter();
        return { done: 'Tešla formoje – lygi kaip ežeras.' };
      },
    },
    {
      id: 'obuoliai', dot: 8, rec: 7, who: 'vaikas', cam: 'tin', item: 'obuoliai',
      say: () => '„Skiltelės ant tešlos!“',
      note: () => 'Obuolius supjausto suaugęs. Bakstelėkite tešlą – ten nusileis skiltelė. Reikia bent penkių.',
      go: () => (state.apples.length >= 5 ? 'Toliau – cinamonas' : 'Sudėlioti ratu'),
      alt: () => state.apples.length >= 5,
      tap: ['forma'],
      enter: async () => {
        fade(O.obuolysR.el, 1, 0, 300);
        fade(O.obuolysZ.el, 1, 0, 300);
      },
      run: async (how, info) => {
        if (how === 'tap') {
          if (state.apples.length >= MAX_SLICES || !info.pt) return null;
          const a = sliceAt(info.pt);
          if (!a) return null;
          state.apples.push(a);
          dropSlice(sliceEl(a));
          await wait(120);
          return { note: sliceNote(state.apples.length) };
        }
        if (how === 'go' && state.apples.length >= 5) return { done: 'Gražu! Dabar – cinamonas.' };
        await layRosette();
        return { done: 'Ratu – kaip saulės spinduliai!' };
      },
    },
    {
      id: 'cinamonas', dot: 8, rec: 7, who: 'vaikas', cam: 'spice', item: 'cinamonas',
      say: () => '„Truputis cinamono!“',
      note: () => 'Bakstelėkite pyragą arba cinamoną.',
      go: () => 'Pabarstyti cinamonu',
      tap: ['forma', 'cinamonas'],
      drag: { from: 'cinamonas', to: ['forma'] },
      run: async () => {
        await sprinkle();
        return { done: 'Mmm, kaip kvepia!' };
      },
    },
    {
      id: 'orkaite', dot: 9, rec: 8, who: 'suauges', cam: 'oven',
      say: () => '„Į orkaitę!“',
      note: () => `Į karštą orkaitę formą deda suaugęs. Tikras pyragas kepa apie ${Q.time} min, o čia – vos akimirką.`,
      go: () => 'Į orkaitę',
      tap: ['forma', 'orkaite'],
      drag: { from: 'forma', to: ['orkaite'] },
      run: async () => {
        await bake();
        return { done: 'Dzin! Medinis pagaliukas išlenda sausas – iškepė!' };
      },
    },
    {
      id: 'istraukti', dot: 10, rec: 8, who: 'suauges', cam: 'out',
      say: () => '„Atsargiai – karšta!“',
      note: () => 'Pyragą ištraukia suaugęs, su puodkele – orkaitė karšta.',
      go: () => 'Ištraukti pyragą',
      tap: ['orkaite', 'puodkele'],
      drag: { from: 'puodkele', to: ['orkaite'] },
      run: async () => {
        await takeOut();
        publish();
        const top = tinOval();
        confetti(top.x, top.y - 20);
        return { done: 'Ištraukta!', wait: 500 };
      },
    },
    {
      id: 'finish', dot: 11, rec: 9, who: 'kartu', cam: 'end',
      say: () => '„Pyragas iškepė!“',
      note: () => `Kvepia visa virtuvė! Tegul pyragas ${Q.cool} min pravėsta – o tada pjaustykime ir dalinkimės.`,
    },
  ];

  // ---------------------------------------------
  // The panel
  // ---------------------------------------------
  function setSay(text) {
    if (ui.say.textContent !== text) ui.say.textContent = text;
  }

  function setNote(text) {
    if (ui.note.textContent !== text) ui.note.textContent = text;
  }

  function refreshGo() {
    const s = STEPS[state.i];
    const label = s.go ? s.go() : '';
    if (ui.label.textContent !== label) ui.label.textContent = label;
    if (ui.count) {
      const n = s.n || 0;
      const text = n > 1 ? `${state.count}/${n}` : '';
      ui.count.hidden = !text;
      if (ui.count.textContent !== text) ui.count.textContent = text;
    }
    if (ui.alt) ui.alt.hidden = !(s.alt && s.alt());
  }

  function render(s) {
    const finished = s.id === 'finish';
    const hadFocus = document.activeElement === ui.go;
    setSay(s.say());
    setNote(s.note());
    if (ui.who) {
      ui.who.className = `pk-who pk-who--${s.who}`;
      ui.who.textContent = WHO[s.who];
    }
    if (ui.step) ui.step.textContent = `Žingsnis ${s.rec} iš ${ui.recipe.length || 9}`;
    ui.go.hidden = finished;
    if (ui.share) ui.share.hidden = !finished;
    if (ui.again) ui.again.hidden = !finished;
    if (ui.hug) ui.hug.hidden = !finished;
    refreshGo();
    ui.dots.forEach((d, j) => {
      d.classList.toggle('is-done', j + 1 < s.dot);
      d.classList.toggle('is-now', j + 1 === s.dot);
    });
    ui.recipe.forEach((li, j) => {
      li.classList.toggle('is-now', j + 1 === s.rec);
      li.classList.toggle('is-done', j + 1 < s.rec);
    });
    if (finished && hadFocus && ui.share) ui.share.focus({ preventScroll: true });
  }

  function markLive() {
    const s = STEPS[state.i];
    const names = s && !state.busy ? (s.tap || []).concat(s.drag ? [s.drag.from] : []) : [];
    Object.keys(O).forEach((n) => O[n].el.classList.toggle('is-live', names.indexOf(n) !== -1));
    const stirring = !!(s && s.stir && !state.busy);
    stage.classList.toggle('is-stirring', stirring);
    O.dubuo.els[1].classList.toggle('is-stir', stirring);
  }

  function setBusy(busy) {
    state.busy = busy;
    ui.go.setAttribute('aria-disabled', String(busy));
    if (ui.alt) ui.alt.setAttribute('aria-disabled', String(busy));
    stage.classList.toggle('is-busy', busy);
    if (state.built) markLive();
  }

  function tick(name) {
    const li = root.querySelector(`[data-pk-item="${name}"]`);
    if (li) li.classList.add('is-in');
  }

  async function goTo(i, instant) {
    state.i = i;
    state.count = 0;
    const s = STEPS[i];
    render(s);
    setBusy(true);
    const moving = camTo(s.cam, instant ? 0 : 1100);
    if (s.enter) await s.enter();
    await moving;
    setBusy(false);
  }

  async function act(how, info) {
    const s = STEPS[state.i];
    if (!state.built || !s || !s.run || state.busy) return;
    if (s.stir && how !== 'stirred') return;
    prime();
    setBusy(true);
    let res = null;
    try {
      res = await s.run(how, info || {}, state.count + 1);
    } catch (err) {
      setBusy(false);
      throw err;
    }
    if (!res) {
      setBusy(false);
      return;
    }
    if (s.n) state.count += 1;
    if (res.note) setNote(res.note);
    refreshGo();
    if (!res.done) {
      setBusy(false);
      return;
    }
    setNote(res.done);
    if (s.item) tick(s.item);
    [].concat(s.also || []).forEach(tick);
    if (s.dot) {
      const d = ui.dots[s.dot - 1];
      if (d) {
        d.classList.remove('is-now');
        d.classList.add('is-done');
      }
    }
    await pause(res.wait || 1000);
    await goTo(state.i + 1);
  }

  // Start again: the kitchen as it was
  async function reset() {
    if (state.busy || !state.built) return;
    tweens.clear();
    parts.length = 0;
    emitters.length = 0;
    fxDirty = true;
    Array.from(scene.querySelectorAll('.pk-pop, .pk-bit')).forEach((n) => n.remove());
    while (flow.firstChild) flow.removeChild(flow.firstChild);
    Object.keys(O).forEach((name) => {
      const o = O[name];
      o.pos = homePos(o);
      setNow(o, o.home);
      setZ(o, o.z);
      o.el.style.opacity = '';
    });
    mix.level = 0;
    mix.turn = 0;
    mix.film = 0;
    mix.color = COL.yogurt.slice();
    while (mix.yolks.firstChild) mix.yolks.removeChild(mix.yolks.firstChild);
    while (mix.flour.firstChild) mix.flour.removeChild(mix.flour.firstChild);
    mix.sugar.setAttribute('opacity', 0);
    mix.oil.setAttribute('opacity', 0);
    mix.swirl.setAttribute('opacity', 0);
    paintMix();
    setFill('yogurt', true);
    tin.zalia.style.opacity = '';
    tin.kepta.style.opacity = '';
    tin.poolSvg.style.opacity = '';
    tin.pool.setAttribute('rx', 0);
    tin.pool.setAttribute('ry', 0);
    clearSlices();
    while (tin.cin.firstChild) tin.cin.removeChild(tin.cin.firstChild);
    tin.apples.style.transform = '';
    tin.apples.classList.remove('is-baked');
    setHeat(0);
    oven.led.classList.remove('is-on');
    oven.chip.classList.remove('is-on');
    timer.chip.classList.remove('is-on');
    setDial(0);
    Object.assign(stir, { on: false, p: 0, pointer: null, lastA: null, holding: false, half: false, done: false });
    root.querySelectorAll('[data-pk-item]').forEach((li) => li.classList.remove('is-in'));
    const going = goTo(0);
    ui.go.focus({ preventScroll: true });
    await going;
  }

  // ---------------------------------------------
  // The bell (Web Audio, quiet, after a gesture; muting is remembered)
  // ---------------------------------------------
  const SOUND_KEY = 'laviju:pyragu-diena:garsas';
  let soundOn = true;
  let audio = null;
  try {
    soundOn = window.localStorage.getItem(SOUND_KEY) !== '0';
  } catch (err) {
    soundOn = true;
  }

  function showSound() {
    if (ui.sound) ui.sound.setAttribute('aria-pressed', String(soundOn));
  }

  // Only inside a real gesture (a touch counts once it ends), so the browser never complains
  function prime() {
    if (!soundOn) return;
    const activation = navigator.userActivation;
    if (activation && !activation.isActive) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
    } catch (err) {
      audio = null;
    }
  }

  function bell() {
    if (!soundOn || !audio || audio.state !== 'running') return;
    const t0 = audio.currentTime + 0.02;
    [0, 0.22].forEach((delay, strike) => {
      [1318.5, 2637, 3950].forEach((freq, j) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        const t = t0 + delay;
        const peak = (0.05 / (j + 1)) * (strike ? 0.75 : 1);
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(t);
        osc.stop(t + 1.7);
      });
    });
  }

  // ---------------------------------------------
  // Input: taps, drags and stirring on the stage; the buttons
  // ---------------------------------------------
  const drag = { id: null, o: null, grab: null, start: null, moved: false };

  function scenePoint(e) {
    const r = stage.getBoundingClientRect();
    return [(e.clientX - r.left - view.tx) / view.k, (e.clientY - r.top - view.ty) / view.k];
  }

  // The front-most picture under the point that this step listens to
  function targetAt(s, pt) {
    const names = (s.tap || []).concat(s.drag ? [s.drag.from] : []);
    const list = names.map((n) => O[n]).filter(Boolean);
    list.sort((a, b) => Number(b.el.style.zIndex) - Number(a.el.style.zIndex));
    return list.find((o) => hits(o, pt, o === O.indelis ? 0.18 : 0.04)) || null;
  }

  function inBowl(pt) {
    const c = batterOval();
    const x = (pt[0] - c.x) / (c.rx * 1.25);
    const y = (pt[1] - c.y) / (c.ry * 1.6);
    return x * x + y * y <= 1;
  }

  function stirPointer(e) {
    const pt = scenePoint(e);
    const c = batterOval();
    const a = Math.atan2((pt[1] - c.y) / c.ry, (pt[0] - c.x) / c.rx);
    if (stir.lastA != null) {
      let d = a - stir.lastA;
      if (d > Math.PI) d -= Math.PI * 2;
      if (d < -Math.PI) d += Math.PI * 2;
      stirBy(Math.abs(d) / (Math.PI * 2) / 3, (d * 180) / Math.PI);
    }
    stir.lastA = a;
  }

  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!state.built || state.busy || drag.id !== null || stir.pointer !== null) return;
    const s = STEPS[state.i];
    if (!s || !s.run) return;
    prime();
    const pt = scenePoint(e);
    if (s.stir) {
      if (!stir.on || !inBowl(pt)) return;
      stir.pointer = e.pointerId;
      const c = batterOval();
      stir.lastA = Math.atan2((pt[1] - c.y) / c.ry, (pt[0] - c.x) / c.rx);
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (err) {
        /* the pointer may already be gone */
      }
      e.preventDefault();
      return;
    }
    drag.id = e.pointerId;
    drag.o = targetAt(s, pt);
    drag.start = [e.clientX, e.clientY];
    drag.moved = false;
    drag.grab = null;
    if (drag.o && s.drag && s.drag.from === drag.o.name) {
      drag.grab = fractionAt(drag.o, pt);
      try {
        stage.setPointerCapture(e.pointerId);
      } catch (err) {
        /* fine without capture */
      }
    }
  });

  stage.addEventListener('pointermove', (e) => {
    if (stir.pointer !== null && e.pointerId === stir.pointer) {
      stirPointer(e);
      return;
    }
    if (drag.id === null) {
      if (e.pointerType !== 'mouse') return;
      const s = STEPS[state.i];
      let over = false;
      if (state.built && !state.busy && s && s.run) {
        const pt = scenePoint(e);
        if (s.stir) over = stir.on && inBowl(pt);
        else if (s.id === 'obuoliai') over = !!sliceAt(pt);
        else over = !!targetAt(s, pt);
      }
      stage.classList.toggle('is-pointing', over);
      return;
    }
    if (e.pointerId !== drag.id || !drag.grab) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.start[0], e.clientY - drag.start[1]) < 6) return;
    const o = drag.o;
    if (!drag.moved) {
      drag.moved = true;
      setZ(o, 11);
      stage.classList.add('is-dragging');
      Object.keys(O).forEach((n) => O[n].el.classList.remove('is-live'));
    }
    const t = { m: scenePoint(e), p: drag.grab, deg: o.rot, s: 1.04 };
    o.pos = t;
    setNow(o, pose(o, t.m, t.p, t.deg, t.s));
  });

  function endPointer(e) {
    if (stir.pointer !== null && e.pointerId === stir.pointer) {
      stir.pointer = null;
      stir.lastA = null;
      return;
    }
    if (drag.id === null || e.pointerId !== drag.id) return;
    const s = STEPS[state.i];
    const o = drag.o;
    const moved = drag.moved;
    const pt = scenePoint(e);
    drag.id = null;
    drag.o = null;
    drag.grab = null;
    stage.classList.remove('is-dragging');
    if (moved && o) {
      const target = e.type === 'pointerup' && s.drag ? s.drag.to.map((n) => O[n]).find((t) => hits(t, pt, 0.1)) : null;
      if (target) {
        act('drop', { target: target.name, pt });
      } else {
        setBusy(true);
        goHome(o, 420).then(() => setBusy(false));
      }
      return;
    }
    if (e.type !== 'pointerup') return;
    if (s.id === 'obuoliai') act('tap', { pt });
    else if (o) act('tap', { target: o.name, pt });
  }

  stage.addEventListener('pointerup', endPointer);
  stage.addEventListener('pointercancel', endPointer);
  stage.addEventListener('lostpointercapture', (e) => {
    if (drag.id === e.pointerId && drag.moved) endPointer(Object.assign({}, { pointerId: e.pointerId, type: 'pointercancel', clientX: drag.start[0], clientY: drag.start[1] }));
    if (stir.pointer === e.pointerId) {
      stir.pointer = null;
      stir.lastA = null;
    }
  });
  stage.addEventListener('dragstart', (e) => e.preventDefault());

  let keyStirAt = 0;
  ui.go.addEventListener('click', (e) => {
    if (state.busy || ui.go.getAttribute('aria-disabled') === 'true') return;
    const s = STEPS[state.i];
    if (!s) return;
    prime();
    if (s.stir) {
      // a click or a tap gives one good turn; Enter/Space stir on keydown; a screen reader's
      // click (detail 0, no keydown) gives a big turn, so a few presses finish the step
      if (e.detail !== 0) stirBy(0.07, 75);
      else if (performance.now() - keyStirAt > 600) stirBy(0.35, 75);
      return;
    }
    act('go');
  });

  ui.go.addEventListener('keydown', (e) => {
    const s = STEPS[state.i];
    if (!s || !s.stir || state.busy) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      keyStirAt = performance.now();
      prime();
      stirBy(e.repeat ? 0.035 : 0.07, e.repeat ? 38 : 75);
    }
  });

  ui.go.addEventListener('pointerdown', () => {
    const s = STEPS[state.i];
    if (s && s.stir && !state.busy && stir.on) {
      stir.holding = true;
      kick();
    }
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) =>
    ui.go.addEventListener(type, () => {
      stir.holding = false;
    })
  );

  if (ui.alt) {
    ui.alt.addEventListener('click', () => {
      if (state.busy || ui.alt.getAttribute('aria-disabled') === 'true') return;
      act('alt');
    });
  }
  if (ui.again) ui.again.addEventListener('click', () => reset());
  if (ui.sound) {
    showSound();
    ui.sound.addEventListener('click', () => {
      soundOn = !soundOn;
      try {
        window.localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0');
      } catch (err) {
        /* private mode: the choice lasts this visit */
      }
      showSound();
      prime();
    });
  }

  // ---------------------------------------------
  // Start: the card gets its pot glyphs, the kitchen is built when it comes near
  // ---------------------------------------------
  function potGlyphs() {
    const glyph = (part) =>
      `<svg viewBox="0 0 14 16" aria-hidden="true" focusable="false"><path d="M1.5 2.5h11l-1.3 11.1a1.2 1.2 0 0 1-1.2 1.1H4a1.2 1.2 0 0 1-1.2-1.1Z" fill="#FFFDF7" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>${part ? `<path d="${part}" fill="currentColor" opacity=".55"/>` : ''}</svg>`;
    const full = 'M2.4 5h9.2l-1 8.4a.9.9 0 0 1-.9.8H4.3a.9.9 0 0 1-.9-.8Z';
    const half = 'M3 9.6h8l-.4 3.8a.9.9 0 0 1-.9.8H4.3a.9.9 0 0 1-.9-.8Z';
    root.querySelectorAll('[data-pk-item]').forEach((li) => {
      const b = li.querySelector('b');
      if (!b || !/indel/i.test(b.textContent)) return;
      const n = amount(b.textContent, 0);
      if (!(n > 0) || n > 5) return;
      const span = document.createElement('span');
      span.className = 'pk-pots';
      span.setAttribute('aria-hidden', 'true');
      let html = '';
      for (let i = 0; i < Math.floor(n); i += 1) html += glyph(full);
      if (n % 1) html += glyph(half);
      span.innerHTML = html;
      li.insertBefore(span, li.firstChild);
    });
  }

  potGlyphs();
  layout();
  if ('ResizeObserver' in window) new ResizeObserver(() => layout()).observe(stage);
  else window.addEventListener('resize', layout);

  if ('IntersectionObserver' in window) {
    const near = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          near.disconnect();
          build();
        }
      },
      { rootMargin: '900px 0px' }
    );
    near.observe(stage);
    new IntersectionObserver(
      (entries) =>
        entries.forEach((e) => {
          loop.visible = e.isIntersecting;
          stage.classList.toggle('is-idle', !e.isIntersecting);
          if (e.isIntersecting) kick();
        }),
      { rootMargin: '10% 0px' }
    ).observe(stage);
  } else {
    build();
  }
})();
