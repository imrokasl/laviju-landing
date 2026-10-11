import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, brand, col } from '../core/palette.js';
import { icoSphere, tube, place, displace, paint, paintSolid, merge } from '../core/geo.js';
import { mesh, part } from './kit.js';
import { PROPS } from './layout.js';

// Who lives here: ducks on the water, a frog on its lily pad, fish under the
// surface, the stork in the shallows, and the small things that fly.
// Every animal faces +z in its own space.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Matrix4();
const _w2 = new THREE.Matrix4();

const ball = (color, r, placement, detail = 2) => part(icoSphere(r, detail), color, placement);

// Soft top-light baked into the paint, so small round bodies keep their form.
const shaded = (geom, hex, lo = 0.88, hi = 1.05) => {
  const base = col(hex);
  return paint(geom, (p, n, i, out) => out.copy(base).multiplyScalar(lerp(lo, hi, saturate(n.y * 0.5 + 0.5))));
};

// ---------- Models ----------
function duckGeometry({ body, wing, beak }) {
  const parts = [];
  // A plump teardrop riding low in the water, tail tipped up
  const hull = icoSphere(1, 3);
  displace(hull, (p) => {
    p.set(p.x * 0.27, p.y * 0.22, p.z * 0.44);
    if (p.z < -0.18) p.y += (-0.18 - p.z) * 0.8;
    if (p.z < -0.28) p.x *= Math.max(0.15, 1 - (-0.28 - p.z) * 3.2);
    p.y += 0.1;
  });
  shaded(hull, body);
  parts.push(hull);
  for (const side of [-1, 1]) {
    const w = icoSphere(1, 2);
    place(w, { sx: 0.06, sy: 0.125, sz: 0.29 });
    shaded(w, wing, 0.92, 1.04);
    parts.push(place(w, { x: side * 0.225, y: 0.16, z: -0.07, rx: -0.14, ry: side * 0.08 }));
  }
  const neck = tube([V(0, 0.14, 0.22), V(0, 0.3, 0.29), V(0, 0.43, 0.29)], 0.105, { radial: 9 });
  shaded(neck, body);
  const head = icoSphere(0.155, 2);
  shaded(head, body);
  parts.push(neck, place(head, { y: 0.475, z: 0.305, sz: 1.08 }));
  parts.push(ball(beak, 1, { y: 0.445, z: 0.49, sx: 0.074, sy: 0.034, sz: 0.11 }, 1));
  for (const side of [-1, 1]) parts.push(ball(palette.ink, 0.023, { x: side * 0.108, y: 0.515, z: 0.395 }, 1));
  return merge(parts);
}

function frogGeometry() {
  const parts = [];
  const green = col(palette.frog);
  const belly = col(palette.frogBelly);
  const skin = (g) => paint(g, (p, n, i, out) => out.copy(belly).lerp(green, smoothstep(-0.45, 0.25, n.y)));
  const body = icoSphere(1, 2);
  displace(body, (p) => {
    p.set(p.x * 0.09, p.y * 0.062, p.z * 0.105);
    p.y += 0.058 + p.z * 0.26; // sitting up on its hands
  });
  parts.push(skin(body));
  const head = icoSphere(1, 2);
  place(head, { sx: 0.078, sy: 0.05, sz: 0.07 });
  parts.push(place(skin(head), { y: 0.098, z: 0.092 }));
  for (const side of [-1, 1]) {
    parts.push(ball(palette.frog, 0.03, { x: side * 0.046, y: 0.142, z: 0.092 }));
    parts.push(ball(palette.ink, 0.016, { x: side * 0.056, y: 0.148, z: 0.108 }, 1));
    // Folded hind legs and wide feet
    const thigh = icoSphere(1, 2);
    place(thigh, { sx: 0.036, sy: 0.034, sz: 0.075 });
    parts.push(place(skin(thigh), { x: side * 0.092, y: 0.036, z: -0.035, ry: side * 0.55 }));
    parts.push(ball(palette.frog, 1, { x: side * 0.122, y: 0.01, z: 0.03, sx: 0.03, sy: 0.009, sz: 0.052, ry: side * 0.5 }, 1));
    const arm = tube([V(side * 0.06, 0.07, 0.07), V(side * 0.078, 0.008, 0.118)], 0.014, { radial: 5 });
    parts.push(paintSolid(arm, green));
  }
  return merge(parts);
}

function fishGeometry() {
  const base = col(palette.fish);
  const body = icoSphere(1, 2);
  displace(body, (p) => {
    const taper = p.z < 0 ? 1 + p.z * 0.62 : 1 - p.z * p.z * 0.25;
    p.set(p.x * 0.036 * taper, p.y * 0.05 * taper, p.z * 0.16);
  });
  paint(body, (p, n, i, out) => out.copy(base).multiplyScalar(lerp(0.8, 1.25, saturate(n.y * 0.5 + 0.5))));
  // Tail fin, drawn from both sides
  const fin = new THREE.BufferGeometry();
  fin.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, -0.13, 0, 0.065, -0.24, 0, 0, -0.2, 0, -0.065, -0.24], 3));
  fin.setIndex([0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2]);
  fin.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  paintSolid(fin, base);
  return merge([body, fin]);
}

function storkGeometry() {
  const white = palette.storkWhite;
  const black = palette.storkBlack;
  const red = palette.storkRed;
  const body = [];
  // It rests on one leg, the other tucked up
  body.push(part(tube([V(0.045, 0, 0.02), V(0.045, 0.27, -0.015), V(0.05, 0.56, 0.02)], 0.015, { radial: 5 }), red));
  for (const a of [-0.55, 0, 0.55]) body.push(part(tube([V(0.045, 0.012, 0.02), V(0.045 + Math.sin(a) * 0.095, 0.008, 0.02 + Math.cos(a) * 0.095)], 0.009, { radial: 4 }), red));
  body.push(part(tube([V(-0.05, 0.58, 0), V(-0.05, 0.43, 0.085), V(-0.05, 0.5, -0.02)], 0.015, { radial: 5 }), red));

  const torso = icoSphere(1, 3);
  displace(torso, (p) => {
    p.set(p.x * 0.155, p.y * 0.17, p.z * 0.3);
    p.y += 0.7 + p.z * 0.3; // breast up, tail down
  });
  shaded(torso, white, 0.86, 1.04);
  body.push(torso);
  // The black flight feathers folded over the tail
  const feathers = icoSphere(1, 2);
  place(feathers, { sx: 0.135, sy: 0.085, sz: 0.21 });
  shaded(feathers, black, 0.8, 1.25);
  body.push(place(feathers, { y: 0.655, z: -0.2, rx: -0.42 }));

  // Neck and head turn together, about the base of the neck
  const pivot = V(0, 0.79, 0.2);
  const head = [];
  const neck = tube([V(0, 0.76, 0.18), V(0, 0.92, 0.29), V(0, 1.06, 0.26), V(0, 1.17, 0.3)], (t) => lerp(0.058, 0.036, t), { radial: 8 });
  shaded(neck, white, 0.88, 1.04);
  head.push(neck);
  const skull = icoSphere(0.072, 2);
  shaded(skull, white, 0.9, 1.04);
  head.push(place(skull, { y: 1.2, z: 0.325, sz: 1.12 }));
  head.push(part(tube([V(0, 1.19, 0.37), V(0, 1.165, 0.52), V(0, 1.13, 0.69)], (t) => lerp(0.025, 0.004, t), { radial: 6 }), red));
  for (const side of [-1, 1]) head.push(ball(palette.ink, 0.013, { x: side * 0.052, y: 1.22, z: 0.365 }, 1));
  for (const g of head) place(g, { x: -pivot.x, y: -pivot.y, z: -pivot.z });
  return { body: merge(body), head: merge(head), pivot };
}

// A blue tit: blue cap and back, white cheeks, yellow breast.
function titGeometry() {
  const blue = col(brand.sky.dot);
  const yellow = col(palette.butter);
  const white = col(palette.white);
  const parts = [];
  const body = icoSphere(1, 2);
  displace(body, (p) => {
    p.set(p.x * 0.062, p.y * 0.06, p.z * 0.08);
    p.y += 0.07 + p.z * 0.25;
  });
  paint(body, (p, n, i, out) => out.copy(yellow).lerp(blue, smoothstep(0.0, 0.5, n.y - n.z * 0.4)));
  parts.push(body);
  const head = icoSphere(0.05, 2);
  place(head, { y: 0.135, z: 0.06 });
  paint(head, (p, n, i, out) => {
    out.copy(white);
    if (p.y > 0.155) out.copy(blue);
    else if (p.y < 0.115 && p.z > 0.07) out.copy(yellow);
  });
  parts.push(head);
  parts.push(ball(palette.ink, 1, { y: 0.135, z: 0.116, sx: 0.012, sy: 0.01, sz: 0.022 }, 1));
  for (const side of [-1, 1]) {
    parts.push(ball(palette.ink, 0.009, { x: side * 0.034, y: 0.146, z: 0.095 }, 1));
    parts.push(ball(brand.sky.ink, 1, { x: side * 0.056, y: 0.076, z: -0.012, sx: 0.016, sy: 0.04, sz: 0.066, rx: -0.3 }, 1));
    parts.push(part(tube([V(side * 0.02, 0.03, 0.01), V(side * 0.02, -0.005, 0.02)], 0.005, { radial: 4 }), palette.ink));
  }
  // Tail
  parts.push(ball(brand.sky.ink, 1, { y: 0.058, z: -0.11, sx: 0.022, sy: 0.008, sz: 0.06, rx: 0.25 }, 1));
  return merge(parts);
}

function snailGeometry() {
  const parts = [];
  const skin = '#F3D9B8';
  parts.push(part(tube([V(0, 0.014, -0.085), V(0, 0.016, 0.03), V(0, 0.03, 0.082), V(0, 0.055, 0.105)], (t) => lerp(0.012, 0.019, Math.sin(t * Math.PI)) + 0.004, { radial: 7 }), skin));
  for (const side of [-1, 1]) {
    parts.push(part(tube([V(side * 0.008, 0.06, 0.105), V(side * 0.02, 0.1, 0.125)], 0.004, { radial: 4 }), skin));
    parts.push(ball(palette.ink, 0.007, { x: side * 0.02, y: 0.103, z: 0.126 }, 1));
  }
  // The shell, with its spiral painted on
  const shell = icoSphere(1, 3);
  const a = col(brand.peach.dot);
  const b = col(brand.butter.soft);
  paint(shell, (p, n, i, out) => {
    const r = Math.hypot(p.y, p.z);
    const ang = Math.atan2(p.y, p.z);
    const spiral = 0.5 + 0.5 * Math.sin(r * 15 - ang + (p.x < 0 ? Math.PI : 0));
    out.copy(a).lerp(b, smoothstep(0.35, 0.65, spiral));
  });
  parts.push(place(shell, { sx: 0.036, sy: 0.058, sz: 0.058, y: 0.066, z: -0.015 }));
  return merge(parts);
}

function hedgehogGeometry(rng) {
  const parts = [];
  const quill = col('#8C6E57');
  const tip = col('#E9D5B5');
  // Quills: every other point of a fine sphere pulled out into a spike
  const coat = icoSphere(1, 3);
  displace(coat, (p, n, i) => {
    const front = saturate((p.z - 0.25) * 2.2);
    const spike = (i % 3 === 0 ? 0.3 : 0) * saturate(p.y * 1.4 + 0.75) * (1 - front);
    p.multiplyScalar(1 + spike + rng.range(-0.02, 0.02));
    p.set(p.x * 0.15, p.y * 0.125, p.z * 0.2);
    p.y = Math.max(p.y, -0.07) + 0.09;
  });
  paint(coat, (p, n, i, out) => {
    const r = Math.hypot(p.x / 0.15, (p.y - 0.09) / 0.125, p.z / 0.2);
    out.copy(quill).lerp(tip, smoothstep(1.05, 1.28, r));
  });
  parts.push(coat);
  const face = '#F2DEC0';
  const snout = icoSphere(1, 2);
  displace(snout, (p) => {
    const taper = 1 - saturate(p.z) * 0.55;
    p.set(p.x * 0.085 * taper, p.y * 0.07 * taper, p.z * 0.11);
  });
  shaded(snout, face, 0.9, 1.04);
  parts.push(place(snout, { y: 0.07, z: 0.185 }));
  parts.push(ball(palette.ink, 0.019, { y: 0.074, z: 0.295 }, 1));
  for (const side of [-1, 1]) {
    parts.push(ball(palette.ink, 0.012, { x: side * 0.04, y: 0.1, z: 0.245 }, 1));
    parts.push(ball(face, 1, { x: side * 0.074, y: 0.128, z: 0.16, sx: 0.022, sy: 0.026, sz: 0.012 }, 1));
    parts.push(ball(face, 1, { x: side * 0.07, y: 0.014, z: 0.12, sx: 0.022, sy: 0.014, sz: 0.032 }, 1));
    parts.push(ball(face, 1, { x: side * 0.075, y: 0.014, z: -0.09, sx: 0.022, sy: 0.014, sz: 0.032 }, 1));
  }
  return merge(parts);
}

// One wing, lying flat and reaching out along +x, hinged on the z axis.
function wingGeometry(outline, { root = 0.55 } = {}) {
  const position = [0, 0, 0];
  const color = [root, root, root];
  const index = [];
  outline.forEach(([x, z], i) => {
    position.push(x, 0, z);
    const reach = saturate(Math.hypot(x, z) / 0.16);
    const shade = lerp(root, 1.06, Math.pow(reach, 0.7));
    color.push(shade, shade, shade);
    if (i > 0) index.push(0, i + 1, i);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(position.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array(position.length / 3).fill(0), 1));
  g.setIndex(index);
  return g;
}

const withSway = (g) => g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));

export function createCritters(field, kit, { meadow, water, props }, quality) {
  const group = new THREE.Group();
  group.name = 'critters';
  const rng = createRng(909);
  const anchors = {};
  const updaters = [];
  const frame = {};

  // A point given along the creek (by control point) and across it (in metres)
  const creekPoint = (cu, lat, out = new THREE.Vector3()) => {
    const i = Math.floor(cu);
    const s = field.creekS(i) + (cu - i) * (field.creekS(i + 1) - field.creekS(i));
    field.creekAt(s, frame);
    return out.set(frame.x + frame.nx * lat, 0, frame.z + frame.nz * lat);
  };

  // ---------- Ducks ----------
  {
    // A lap between the pool and the far side of the bridge
    const lap = new THREE.CatmullRomCurve3(
      [
        [9.0, 0.5],
        [9.45, 0.55],
        [9.9, 0.36],
        [10.25, 0.18],
        [10.3, -0.3],
        [9.9, -0.46],
        [9.4, -0.62],
        [9.0, -0.5],
        [8.82, 0.0],
      ].map(([cu, lat]) => creekPoint(cu, lat)),
      true,
      'catmullrom',
      0.5
    );
    const length = lap.getLength();
    const mother = duckGeometry({ body: palette.storkWhite, wing: '#EFE4D2', beak: palette.beak });
    const young = duckGeometry({ body: palette.duck, wing: palette.duckDark, beak: palette.beak });
    const ducks = [0, 1, 2, 3].map((k) => {
      const m = mesh(k === 0 ? mother : young, kit.solid, { name: k === 0 ? 'duck' : 'duckling' });
      m.scale.setScalar(k === 0 ? 0.6 : 0.33 + (k % 2) * 0.03);
      m.rotation.order = 'YXZ';
      group.add(m);
      return m;
    });
    const speed = 0.3;
    let wake = 0.6;
    updaters.push((time, dt) => {
      ducks.forEach((duck, k) => {
        // The little ones keep in line behind, never quite evenly
        const lag = k === 0 ? 0 : 0.3 + k * 0.36 + Math.sin(time * 0.7 + k * 2) * 0.05;
        const u = ((((time * speed - lag) / length) % 1) + 1) % 1;
        lap.getPointAt(u, _p);
        lap.getTangentAt(u, _t);
        const paddle = Math.sin(time * (k === 0 ? 4.2 : 6.5) + k * 1.9);
        duck.position.set(_p.x, water.level(_p.x, _p.z) - 0.012 + Math.sin(time * 1.6 + k) * 0.008, _p.z);
        duck.rotation.set(Math.sin(time * 1.3 + k) * 0.03, Math.atan2(_t.x, _t.z), paddle * (k === 0 ? 0.035 : 0.07));
      });
      wake -= dt;
      if (wake <= 0) {
        water.addRipple(ducks[0].position.x, ducks[0].position.z, 0.5);
        wake = 1.9;
      }
    });
    anchors.ducks = ducks[0];
  }

  // ---------- The frog ----------
  if (meadow.pads.length) {
    // The roomiest free pad out in the open, on the side of the pool the view faces
    const free = meadow.pads.filter((p) => !p.lily && p.r >= 0.22);
    const pad = (free.length ? free : meadow.pads).sort((a, b) => b.x * 0.43 + b.z * 0.9 - (a.x * 0.43 + a.z * 0.9))[0];
    const frog = mesh(frogGeometry(), kit.solid, { name: 'frog' });
    const size = Math.min(1.5, (pad.r / 0.3) * 1.45);
    frog.scale.setScalar(size);
    frog.rotation.order = 'YXZ';
    const yaw0 = 2.4;
    frog.position.set(pad.x, pad.y, pad.z);
    frog.rotation.y = yaw0;
    group.add(frog);
    // Mostly it sits and breathes; now and then it hops on the spot
    const every = 6.5;
    let lastHop = -1;
    updaters.push((time) => {
      const k = Math.floor(time / every);
      const f = (time - k * every) / 0.62;
      let y = 0;
      let turn = 0;
      if (f < 1 && k > 0) {
        y = Math.sin(f * Math.PI) * 0.26;
        turn = smoothstep(0, 1, f);
        if (k !== lastHop && f > 0.9) {
          lastHop = k;
          water.addRipple(pad.x, pad.z, 0.9);
        }
      } else if (k > 0) turn = 1;
      const facing = yaw0 + (k > 0 ? (k - 1 + turn) * 0.9 : 0);
      frog.position.y = pad.y + y;
      frog.rotation.set(-y * 1.1, facing, 0);
      const breath = 1 + Math.sin(time * 3.1) * 0.035;
      frog.scale.set(size * breath, size * (1 + (1 - breath) * 0.8), size);
    });
    anchors.frog = frog;
  }

  // ---------- Fish ----------
  {
    const geometry = fishGeometry();
    const fish = [];
    const count = quality.density > 0.5 ? 6 : 4;
    for (let i = 0; i < count; i++) {
      const m = mesh(geometry, kit.solid, { name: 'fish', cast: false, receive: false });
      m.rotation.order = 'YXZ';
      m.scale.setScalar(rng.range(0.85, 1.25));
      group.add(m);
      fish.push({
        m,
        centre: creekPoint(8 + rng.range(-0.4, 0.4), rng.range(-0.75, 0.5)),
        rx: rng.range(0.45, 0.9),
        rz: rng.range(0.25, 0.5),
        speed: rng.range(0.22, 0.4) * rng.sign(),
        phase: rng.range(0, TAU),
        tilt: rng.range(0.2, 0.8),
        depth: rng.range(0.07, 0.13),
      });
    }
    let rise = 3;
    updaters.push((time, dt) => {
      for (const f of fish) {
        const a = time * f.speed + f.phase;
        const c = Math.cos(f.tilt);
        const s = Math.sin(f.tilt);
        const lx = Math.cos(a) * f.rx;
        const lz = Math.sin(a * 2) * f.rz; // a lazy figure of eight
        const vx = -Math.sin(a) * f.rx * f.speed;
        const vz = Math.cos(a * 2) * 2 * f.rz * f.speed;
        const x = f.centre.x + lx * c + lz * s;
        const z = f.centre.z - lx * s + lz * c;
        const level = water.level(x, z);
        f.m.position.set(x, Math.min(level - 0.04, Math.max(level - f.depth, field.height(x, z) + 0.05)), z);
        f.m.rotation.y = Math.atan2(vx * c + vz * s, -vx * s + vz * c) + Math.sin(time * 7 + f.phase) * 0.2;
      }
      // Now and then one of them touches the surface
      rise -= dt;
      if (rise <= 0) {
        const f = fish[Math.floor(rng() * fish.length)];
        water.addRipple(f.m.position.x, f.m.position.z, 0.45);
        rise = rng.range(3.5, 7);
      }
    });
  }

  // ---------- The stork ----------
  {
    const { x, z, yaw } = PROPS.stork;
    const parts = storkGeometry();
    const stork = new THREE.Group();
    stork.name = 'stork';
    stork.add(mesh(parts.body, kit.solid, { name: 'stork-body' }));
    const head = mesh(parts.head, kit.solid, { name: 'stork-head' });
    head.position.copy(parts.pivot);
    head.rotation.order = 'YXZ';
    stork.add(head);
    stork.position.set(x, field.height(x, z) - 0.01, z);
    stork.rotation.y = yaw;
    stork.scale.setScalar(1.08);
    group.add(stork);
    updaters.push((time) => {
      // Looks about, then now and then dips its bill as if it had seen a frog
      const dip = Math.pow(saturate(Math.sin(time * 0.23 + 1.2) * 4 - 3), 2);
      head.rotation.set(dip * 0.75 + Math.sin(time * 0.7) * 0.03, Math.sin(time * 0.31) * 0.55 + Math.sin(time * 0.83) * 0.12, 0);
      stork.rotation.z = Math.sin(time * 0.6) * 0.012;
    });
    anchors.stork = stork;
    anchors.storkTop = V(x, stork.position.y + 1.4, z);
  }

  // ---------- Small birds ----------
  {
    const geometry = titGeometry();
    const perches = [];
    if (props.anchors.railPerch) perches.push({ p: props.anchors.railPerch, yaw: props.anchors.railYaw, s: 1.6 });
    if (props.anchors.birdhouse) perches.push({ p: props.anchors.birdhouse, yaw: 0.3, s: 1.35 });
    perches.forEach((perch, i) => {
      const bird = mesh(geometry, kit.solid, { name: 'tit' });
      bird.position.copy(perch.p);
      bird.scale.setScalar(perch.s);
      bird.rotation.order = 'YXZ';
      group.add(bird);
      updaters.push((time) => {
        // Birds move in jumps: hold a pose, then flick to the next
        const beat = Math.floor(time * 0.6 + i * 0.37);
        const pose = (n) => {
          const v = Math.sin(n * 12.9898 + i * 4.1) * 43758.5453;
          return (v - Math.floor(v) - 0.5) * 1.5;
        };
        const snap = smoothstep(0, 0.12, (time * 0.6 + i * 0.37) % 1);
        bird.rotation.y = perch.yaw + lerp(pose(beat - 1), pose(beat), snap);
        bird.rotation.x = Math.sin(time * 2.2 + i) * 0.05;
        bird.position.y = perch.p.y + Math.abs(Math.sin(time * 4.4 + i)) * 0.004;
      });
      if (i === 0) anchors.bird = bird;
    });
  }

  // ---------- The snail and the hedgehog by the log ----------
  if (props.anchors.logTop) {
    const { point, yaw } = props.anchors.logTop;
    const snail = mesh(snailGeometry(), kit.solid, { name: 'snail' });
    snail.scale.setScalar(1.7);
    snail.rotation.y = yaw + Math.PI / 2;
    group.add(snail);
    const dx = Math.cos(yaw);
    const dz = -Math.sin(yaw);
    updaters.push((time) => {
      // A snail's pace along the log, there and back
      const crawl = -0.42 + Math.sin(time * 0.05) * 0.3;
      snail.position.set(point.x + dx * crawl, point.y - 0.012, point.z + dz * crawl);
      snail.rotation.y = yaw + Math.PI / 2 + (1 - smoothstep(-0.15, 0.15, Math.cos(time * 0.05))) * Math.PI;
      snail.scale.z = 1.7 * (1 + Math.sin(time * 1.4) * 0.04);
    });
    anchors.snail = snail;
  }
  {
    // Out on the path, where it can be seen
    const { x: hx, z: hz, yaw: heading } = PROPS.hedgehog;
    const hog = mesh(hedgehogGeometry(createRng(12)), kit.solid, { name: 'hedgehog' });
    hog.position.set(hx, field.height(hx, hz) - 0.005, hz);
    hog.rotation.order = 'YXZ';
    hog.rotation.y = heading;
    hog.scale.setScalar(1.15);
    group.add(hog);
    updaters.push((time) => {
      // Snuffling about
      hog.rotation.x = Math.sin(time * 2.6) * 0.035 + 0.03;
      hog.rotation.y = heading + Math.sin(time * 0.4) * 0.25;
      hog.scale.y = 1.15 * (1 + Math.sin(time * 2.6) * 0.02);
    });
    anchors.hedgehog = hog;
  }

  // ---------- Flyers ----------
  // Wings are instanced: two (or four) per animal, their matrices rebuilt
  // every frame from the animal's position, heading and wingbeat.
  const flock = (name, wing, bodyGeometry, animals, wingsEach) => {
    const wings = new THREE.InstancedMesh(wing, kit.solidDouble, animals.length * wingsEach);
    wings.name = `${name}-wings`;
    wings.frustumCulled = false;
    wings.castShadow = false;
    const bodies = new THREE.InstancedMesh(bodyGeometry, kit.solidDouble, animals.length);
    bodies.name = `${name}-bodies`;
    bodies.frustumCulled = false;
    bodies.castShadow = false;
    animals.forEach((a, i) => {
      for (let w = 0; w < wingsEach; w++) wings.setColorAt(i * wingsEach + w, a.color);
      bodies.setColorAt(i, a.bodyColor);
    });
    wings.instanceColor.needsUpdate = true;
    bodies.instanceColor.needsUpdate = true;
    group.add(wings, bodies);
    return { wings, bodies };
  };
  const setWing = (im, index, pos, yaw, pitch, roll, flap, side, scale, sweep = 0) => {
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(pos, _q, _s.setScalar(scale));
    // In the animal's own space: mirror for the left wing, sweep, then lift
    _w.makeRotationZ(side * flap);
    if (sweep) _w.multiply(_w2.makeRotationY(-side * sweep));
    if (side < 0) _w.multiply(_w2.makeScale(-1, 1, 1));
    im.setMatrixAt(index, _m.multiply(_w));
  };
  const setBody = (im, index, pos, yaw, pitch, roll, scale) => {
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    im.setMatrixAt(index, _m.compose(pos, _q, _s.setScalar(scale)));
  };

  // Butterflies over the daisies
  if (meadow.flowerSpots.length) {
    const wing = wingGeometry(
      [
        [0.012, 0.02],
        [0.05, 0.115],
        [0.125, 0.135],
        [0.172, 0.075],
        [0.15, 0.012],
        [0.118, -0.018],
        [0.125, -0.085],
        [0.075, -0.13],
        [0.022, -0.075],
        [0.008, -0.02],
      ],
      { root: 0.5 }
    );
    const body = withSway(part(tube([V(0, 0, -0.07), V(0, 0.004, 0), V(0, 0, 0.065)], 0.011, { radial: 5 }), palette.white));
    const tints = [brand.peach.dot, brand.lilac.dot, brand.butter.dot, brand.sky.dot, palette.white, palette.pink, brand.peach.mid];
    const count = Math.min(meadow.flowerSpots.length, quality.density > 0.5 ? 9 : 5);
    const animals = [];
    for (let i = 0; i < count; i++) {
      const home = meadow.flowerSpots[Math.floor((i / count) * meadow.flowerSpots.length)];
      animals.push({
        home,
        color: col(tints[i % tints.length]).clone(),
        bodyColor: col(palette.ink).clone().lerp(col(palette.white), 0.25),
        speed: rng.range(0.32, 0.55) * rng.sign(),
        phase: rng.range(0, TAU),
        rx: rng.range(0.7, 1.5),
        rz: rng.range(0.6, 1.3),
        beat: rng.range(11, 15),
        size: rng.range(0.62, 0.86),
      });
    }
    const { wings, bodies } = flock('butterfly', wing, body, animals, 2);
    const at = (a, time, out) => {
      const t = time * a.speed + a.phase;
      return out.set(
        a.home.x + Math.sin(t) * a.rx + Math.sin(t * 2.7 + a.phase) * 0.22,
        a.home.y + 0.18 + Math.sin(t * 1.9) * 0.2 + Math.sin(time * a.beat) * 0.022,
        a.home.z + Math.cos(t * 0.8 + 1) * a.rz + Math.cos(t * 3.1) * 0.18
      );
    };
    updaters.push((time) => {
      animals.forEach((a, i) => {
        at(a, time, _p);
        at(a, time + 0.08, _t);
        const yaw = Math.atan2(_t.x - _p.x, _t.z - _p.z);
        // Wings clap above the back and open flat, never below
        const flap = 0.62 + Math.sin(time * a.beat) * 0.6;
        setWing(wings, i * 2, _p, yaw, -0.3, 0, flap, 1, a.size);
        setWing(wings, i * 2 + 1, _p, yaw, -0.3, 0, flap, -1, a.size);
        setBody(bodies, i, _p, yaw, -0.3, 0, a.size);
      });
      wings.instanceMatrix.needsUpdate = true;
      bodies.instanceMatrix.needsUpdate = true;
    });
    anchors.butterflies = animals.map((a) => a.home);
  }

  // Dragonflies over the reeds: hover, dart, hover
  if (meadow.reedSpots.length) {
    const wing = wingGeometry(
      [
        [0.01, 0.012],
        [0.07, 0.03],
        [0.15, 0.026],
        [0.19, 0.008],
        [0.15, -0.014],
        [0.07, -0.016],
        [0.01, -0.01],
      ],
      { root: 0.85 }
    );
    const body = withSway(
      merge([
        part(tube([V(0, 0, -0.17), V(0, 0.004, -0.04), V(0, 0.006, 0.05)], (t) => lerp(0.006, 0.014, t), { radial: 5 }), palette.white),
        ball(palette.white, 0.021, { y: 0.008, z: 0.066 }, 1),
      ])
    );
    const count = Math.min(meadow.reedSpots.length, quality.density > 0.5 ? 4 : 2);
    const animals = [];
    for (let i = 0; i < count; i++) {
      const home = meadow.reedSpots[Math.floor((i / count) * meadow.reedSpots.length)];
      animals.push({ home, color: col('#EAF5FF').clone(), bodyColor: col(i % 2 ? brand.teal : brand.sky.dot).clone(), phase: rng.range(0, 9), period: rng.range(2.1, 3.2), size: rng.range(0.75, 0.95), yaw: 0 });
    }
    const { wings, bodies } = flock('dragonfly', wing, body, animals, 4);
    const hash = (n) => {
      const v = Math.sin(n * 12.9898) * 43758.5453;
      return v - Math.floor(v);
    };
    const spot = (a, k, out) => out.set(a.home.x + (hash(k + a.phase) - 0.5) * 2.2, a.home.y - 0.25 + hash(k * 1.7 + a.phase) * 0.5, a.home.z + (hash(k * 2.3 + a.phase) - 0.5) * 2.2);
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();
    updaters.push((time) => {
      animals.forEach((a, i) => {
        const beat = time / a.period + a.phase;
        const k = Math.floor(beat);
        spot(a, k, from);
        spot(a, k + 1, to);
        const dart = smoothstep(0, 0.22, beat - k);
        _p.copy(from).lerp(to, dart);
        _p.y += Math.sin(time * 5 + i) * 0.012;
        if (dart < 1) a.yaw = Math.atan2(to.x - from.x, to.z - from.z);
        const blur = Math.sin(time * 58 + i);
        for (let w = 0; w < 4; w++) {
          const side = w % 2 ? -1 : 1;
          const rear = w > 1;
          setWing(wings, i * 4 + w, _p, a.yaw, 0, 0, 0.12 + blur * (rear ? -0.3 : 0.3), side, a.size, rear ? -0.22 : 0.18);
        }
        setBody(bodies, i, _p, a.yaw, 0, 0, a.size);
      });
      wings.instanceMatrix.needsUpdate = true;
      bodies.instanceMatrix.needsUpdate = true;
    });
    anchors.dragonflies = animals.map((a) => a.home);
  }

  // Birds wheeling far off, behind the island
  {
    const wing = wingGeometry(
      [
        [0.0, 0.1],
        [0.3, 0.13],
        [0.62, 0.02],
        [0.7, -0.08],
        [0.36, -0.03],
        [0.0, -0.1],
      ],
      { root: 0.8 }
    );
    const body = withSway(ball(palette.white, 1, { sx: 0.07, sy: 0.06, sz: 0.24 }, 1));
    const count = quality.density > 0.5 ? 5 : 3;
    const animals = [];
    for (let i = 0; i < count; i++) {
      animals.push({
        color: col('#8FA6CF').clone(),
        bodyColor: col('#8FA6CF').clone(),
        angle: i * 0.21 + rng.range(-0.05, 0.05),
        radius: 19 + rng.range(-2.5, 2.5),
        height: 12.5 + rng.range(-1.6, 1.6),
        beat: rng.range(2.6, 3.4),
        phase: rng.range(0, TAU),
        size: rng.range(0.62, 0.86),
      });
    }
    const { wings, bodies } = flock('bird', wing, body, animals, 2);
    const centre = V(-6, 0, -15);
    updaters.push((time) => {
      animals.forEach((a, i) => {
        const ang = time * 0.055 + a.angle;
        _p.set(centre.x + Math.cos(ang) * a.radius, a.height + Math.sin(time * 0.3 + a.phase) * 0.7, centre.z + Math.sin(ang) * a.radius * 0.8);
        const yaw = Math.atan2(-Math.sin(ang), Math.cos(ang) * 0.8);
        // A few slow beats, then a glide
        const glide = smoothstep(0.2, 0.6, Math.sin(time * 0.37 + a.phase));
        const flap = 0.16 + Math.sin(time * a.beat + a.phase) * 0.5 * (1 - glide * 0.85);
        setWing(wings, i * 2, _p, yaw, 0, 0.2, flap, 1, a.size);
        setWing(wings, i * 2 + 1, _p, yaw, 0, 0.2, flap, -1, a.size);
        setBody(bodies, i, _p, yaw, 0, 0.2, a.size);
      });
      wings.instanceMatrix.needsUpdate = true;
      bodies.instanceMatrix.needsUpdate = true;
    });
  }

  function update(time, dt) {
    for (const fn of updaters) fn(time, dt);
  }
  // Fill every instance matrix before the first frame is drawn
  update(0, 0);

  return { group, anchors, update };
}
