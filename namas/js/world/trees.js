import * as THREE from '../core/three.js';
import { palette } from '../core/palette.js';
import { season } from '../core/season.js';
import { roundedBox, tube, merge } from '../core/geo.js';
import { TAU, lerp, saturate, smoothstep } from '../core/math.js';
import { mesh, part, grainUv } from './kit.js';

// The trees and bushes, modelled in Blender (landing-web/namas/blender/
// flora.py) where layout.js puts them: the old apple tree whose limb carries
// the swing, the birches, the spruces, the lilacs, the currants and the box.
// The file keeps their limbs as runs of points, the soft bodies of their
// crowns as meshes, and every sprig of leaves, bough, plume of blossom and
// fruit once, with a list of where its copies go. The bark and the copies
// are made here.

// Each leaf of a copy is lit by the crown's shape more than by its own face
const BLEND = { leaves: 0.65, needles: 0.55, petals: 0.5, fruit: 0 };

const _q = new THREE.Quaternion();
const _r = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _s = new THREE.Vector3();

const fract = (x) => x - Math.floor(x);

// A mesh from the file, its attributes under the names the shaders know
function meshGeometry(part, names) {
  const a = part.attributes;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.normalizeNormals();
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  for (const [from, [to, size]] of Object.entries(names)) if (a[from]) g.setAttribute(to, new THREE.BufferAttribute(a[from], size));
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  g.computeBoundingSphere();
  return g;
}

// ---------- Bark ----------
// Every limb is a run of points, each with its radius and how far the wind
// moves it, and the kind of bark it is dressed in (the header's `barks`). The
// tubes are made as flora.py makes them to look at (Limbs.dress): a run is
// cut where it thins enough to be drawn with fewer sides, a thick limb swells
// and sinks a little, and every point is painted lighter where the sun finds
// it, greener on the weather side and the colour of twigs at its thinnest.
const LIGHT = new THREE.Vector3(-0.45, 0.82, 0.36).normalize();
const sidesFor = (r) => (r > 0.13 ? 12 : r > 0.07 ? 9 : r > 0.035 ? 7 : r > 0.016 ? 5 : 3);
const hash1 = (x) => fract(Math.sin(x * 12.9898 + 4.1) * 43758.5453);
const corner = (x, y, z) => fract(Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453);

// Smooth value noise, 0..1: the same as flora.py's
function vnoise(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let u = x - ix;
  let v = y - iy;
  let w = z - iz;
  u = u * u * (3 - 2 * u);
  v = v * v * (3 - 2 * v);
  w = w * w * (3 - 2 * w);
  const x00 = lerp(corner(ix, iy, iz), corner(ix + 1, iy, iz), u);
  const x10 = lerp(corner(ix, iy + 1, iz), corner(ix + 1, iy + 1, iz), u);
  const x01 = lerp(corner(ix, iy, iz + 1), corner(ix + 1, iy, iz + 1), u);
  const x11 = lerp(corner(ix, iy + 1, iz + 1), corner(ix + 1, iy + 1, iz + 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

const sheet = (moss) => ({ position: [], normal: [], color: [], uv: [], moss: moss ? [] : null, sway: [], index: [], count: 0 });

function sheetGeometry(s) {
  if (!s.count) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(s.position), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(s.normal), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(s.color), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(s.uv), 2));
  if (s.moss) g.setAttribute('aMoss', new THREE.BufferAttribute(new Float32Array(s.moss), 1));
  g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(s.sway), 1));
  g.setIndex(new THREE.BufferAttribute(new (s.count > 65535 ? Uint32Array : Uint16Array)(s.index), 1));
  g.computeBoundingSphere();
  return g;
}

// One piece of a run, points a..b of the limbs, `sides` round
function dressPiece(s, limbs, a, b, sides, cap, kind, offset, moss, field) {
  const { position: pos, radius: rad, sway } = limbs;
  const m = b - a + 1;
  const P = new Float64Array(m * 3);
  const R = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    for (let i = 0; i < 3; i++) P[k * 3 + i] = pos[(a + k) * 3 + i];
    R[k] = rad[a + k];
  }
  // Along the limb, and a first way across it carried from ring to ring without twisting
  const T = new Float64Array(m * 3);
  for (let k = 0; k < m; k++) {
    const k0 = k === 0 ? 0 : k === m - 1 ? m - 2 : k - 1;
    const k1 = k === 0 ? 1 : k === m - 1 ? m - 1 : k + 1;
    const x = P[k1 * 3] - P[k0 * 3];
    const y = P[k1 * 3 + 1] - P[k0 * 3 + 1];
    const z = P[k1 * 3 + 2] - P[k0 * 3 + 2];
    const l = Math.max(Math.hypot(x, y, z), 1e-12);
    T[k * 3] = x / l;
    T[k * 3 + 1] = y / l;
    T[k * 3 + 2] = z / l;
  }
  const N = new Float64Array(m * 3);
  {
    const hx = Math.abs(T[1]) > 0.95 ? 1 : 0;
    const hy = 1 - hx;
    const cx = -T[2] * hy;
    const cy = T[2] * hx;
    const cz = T[0] * hy - T[1] * hx;
    const nx = cy * T[2] - cz * T[1];
    const ny = cz * T[0] - cx * T[2];
    const nz = cx * T[1] - cy * T[0];
    const l = Math.max(Math.hypot(nx, ny, nz), 1e-12);
    N[0] = nx / l;
    N[1] = ny / l;
    N[2] = nz / l;
  }
  for (let k = 1; k < m; k++) {
    const p = (k - 1) * 3;
    const q = k * 3;
    let vx = N[p];
    let vy = N[p + 1];
    let vz = N[p + 2];
    const bx = T[p + 1] * T[q + 2] - T[p + 2] * T[q + 1];
    const by = T[p + 2] * T[q] - T[p] * T[q + 2];
    const bz = T[p] * T[q + 1] - T[p + 1] * T[q];
    const sn = Math.hypot(bx, by, bz);
    if (sn >= 1e-8) {
      const angle = Math.atan2(sn, T[p] * T[q] + T[p + 1] * T[q + 1] + T[p + 2] * T[q + 2]);
      const kx = bx / sn;
      const ky = by / sn;
      const kz = bz / sn;
      const c = Math.cos(angle);
      const si = Math.sin(angle);
      const kv = (kx * vx + ky * vy + kz * vz) * (1 - c);
      const rx = vx * c + (ky * vz - kz * vy) * si + kx * kv;
      const ry = vy * c + (kz * vx - kx * vz) * si + ky * kv;
      const rz = vz * c + (kx * vy - ky * vx) * si + kz * kv;
      vx = rx;
      vy = ry;
      vz = rz;
    }
    const d = vx * T[q] + vy * T[q + 1] + vz * T[q + 2];
    vx -= T[q] * d;
    vy -= T[q + 1] * d;
    vz -= T[q + 2] * d;
    const l = Math.max(Math.hypot(vx, vy, vz), 1e-12);
    N[q] = vx / l;
    N[q + 1] = vy / l;
    N[q + 2] = vz / l;
  }
  const along = new Float64Array(m);
  for (let k = 1; k < m; k++) along[k] = along[k - 1] + Math.hypot(P[k * 3] - P[k * 3 - 3], P[k * 3 + 1] - P[k * 3 - 2], P[k * 3 + 2] - P[k * 3 - 1]);

  // The rings, swollen and sunk on a thick limb
  const D = new Float64Array(m * sides * 3);
  const G = new Float64Array(m * sides * 3);
  const bumped = kind.gnarl > 0 && R[0] > 0.03;
  const o = offset * 17;
  for (let k = 0; k < m; k++) {
    const t = k * 3;
    const Bx = T[t + 1] * N[t + 2] - T[t + 2] * N[t + 1];
    const By = T[t + 2] * N[t] - T[t] * N[t + 2];
    const Bz = T[t] * N[t + 1] - T[t + 1] * N[t];
    for (let j = 0; j < sides; j++) {
      const angle = (j / sides) * TAU;
      const c = Math.cos(angle);
      const si = Math.sin(angle);
      const i = (k * sides + j) * 3;
      D[i] = c * N[t] + si * Bx;
      D[i + 1] = c * N[t + 1] + si * By;
      D[i + 2] = c * N[t + 2] + si * Bz;
      let r = R[k];
      if (bumped) {
        const x = P[t] + D[i] * r;
        const y = P[t + 1] + D[i + 1] * r;
        const z = P[t + 2] + D[i + 2] * r;
        r *= 1 + (vnoise(x * 3.1 + o, y * 3.1 + o, z * 3.1 + o) - 0.5) * 2 * kind.gnarl;
      }
      G[i] = P[t] + D[i] * r;
      G[i + 1] = P[t + 1] + D[i + 1] * r;
      G[i + 2] = P[t + 2] + D[i + 2] * r;
    }
  }
  // Normals: of the bumped surface itself, round and along; or of a smooth
  // tube that leans towards its tip as it thins
  const NN = new Float64Array(m * sides * 3);
  for (let k = 0; k < m; k++) {
    let slope = 0;
    if (!bumped && m > 1) {
      const k0 = k < m - 1 ? k : m - 2;
      const l = Math.hypot(P[k0 * 3 + 3] - P[k0 * 3], P[k0 * 3 + 4] - P[k0 * 3 + 1], P[k0 * 3 + 5] - P[k0 * 3 + 2]);
      slope = Math.min(0.5, Math.max(-0.5, (R[k0] - R[k0 + 1]) / Math.max(l, 1e-6)));
    }
    for (let j = 0; j < sides; j++) {
      const i = (k * sides + j) * 3;
      let x;
      let y;
      let z;
      if (bumped) {
        const jp = (k * sides + ((j + 1) % sides)) * 3;
        const jm = (k * sides + ((j - 1 + sides) % sides)) * 3;
        const kp = (Math.min(k + 1, m - 1) * sides + j) * 3;
        const km = (Math.max(k - 1, 0) * sides + j) * 3;
        const ax = G[jp] - G[jm];
        const ay = G[jp + 1] - G[jm + 1];
        const az = G[jp + 2] - G[jm + 2];
        const ex = G[kp] - G[km];
        const ey = G[kp + 1] - G[km + 1];
        const ez = G[kp + 2] - G[km + 2];
        x = ay * ez - az * ey;
        y = az * ex - ax * ez;
        z = ax * ey - ay * ex;
      } else {
        x = D[i] + T[k * 3] * slope;
        y = D[i + 1] + T[k * 3 + 1] * slope;
        z = D[i + 2] + T[k * 3 + 2] * slope;
      }
      const l = Math.max(Math.hypot(x, y, z), 1e-12);
      NN[i] = x / l;
      NN[i + 1] = y / l;
      NN[i + 2] = z / l;
    }
  }

  const birch = kind.material === 'birchBark';
  const repeats = birch ? 0 : Math.max(1, Math.floor((Math.PI * (R[0] + R[m - 1])) / kind.around + 0.5));
  const first = s.count;
  const emit = (x, y, z, nx, ny, nz, r, w, round, length) => {
    s.position.push(x, y, z);
    s.normal.push(nx, ny, nz);
    const blotch = vnoise(x * 1.6 + offset * 40, y * 0.9 + offset * 40, z * 1.6 + offset * 40) * 2 - 1;
    const lit = saturate((nx * LIGHT.x + ny * LIGHT.y + nz * LIGHT.z + 0.3) / 1.2);
    const t = saturate(lit * 0.9 + blotch * 0.25);
    let cr = lerp(kind.dark.r, kind.light.r, t);
    let cg = lerp(kind.dark.g, kind.light.g, t);
    let cb = lerp(kind.dark.b, kind.light.b, t);
    const cast = smoothstep(0.35, 0.8, -nx * 0.6 + ny * 0.5 + blotch * 0.4) * kind.green;
    cr = lerp(cr, moss.r, cast);
    cg = lerp(cg, moss.g, cast);
    cb = lerp(cb, moss.b, cast);
    const thin = (1 - smoothstep(0.01, 0.045, r)) * 0.8;
    const twig = 0.85 + 0.3 * lit;
    s.color.push(lerp(cr, kind.twig.r * twig, thin), lerp(cg, kind.twig.g * twig, thin), lerp(cb, kind.twig.b * twig, thin));
    const foot = y - field.height(x, z);
    if (birch) {
      // Round the trunk in radians, up it in quarters of a metre from the ground
      s.uv.push(round * TAU, foot * 4);
    } else {
      s.uv.push(round * repeats + offset, length * kind.along + offset * 1.3);
      const shady = saturate(0.5 - (nx * LIGHT.x + nz * LIGHT.z) * 1.4);
      s.moss.push(saturate((1 - smoothstep(0.1, 1.5, foot)) * (0.3 + 0.7 * shady) * 1.05 + blotch * 0.16 - 0.08));
    }
    s.sway.push(w);
    s.count++;
  };
  for (let k = 0; k < m; k++) {
    for (let j = 0; j <= sides; j++) {
      const i = (k * sides + (j % sides)) * 3;
      emit(G[i], G[i + 1], G[i + 2], NN[i], NN[i + 1], NN[i + 2], R[k], sway[a + k], j / sides, along[k]);
    }
  }
  const w = sides + 1;
  // Wound with the outside facing out
  for (let k = 0; k < m - 1; k++) {
    for (let j = 0; j < sides; j++) {
      const v0 = first + k * w + j;
      s.index.push(v0, v0 + 1, v0 + w, v0 + 1, v0 + w + 1, v0 + w);
    }
  }
  if (cap) {
    const t = (m - 1) * 3;
    const r = R[m - 1];
    emit(P[t] + T[t] * r * 0.9, P[t + 1] + T[t + 1] * r * 0.9, P[t + 2] + T[t + 2] * r * 0.9, T[t], T[t + 1], T[t + 2], r, sway[b], 0.5, along[m - 1] + r * 0.9);
    const last = first + (m - 1) * w;
    const tip = s.count - 1;
    for (let j = 0; j < sides; j++) s.index.push(last + j, last + j + 1, tip);
  }
}

// The bark of every tree, in the two kinds of bark the kit draws
function barkGeometries(flora, field) {
  const limbs = flora.parts.get('limbs');
  const runs = flora.parts.get('limb-runs');
  if (!limbs || !runs) return {};
  const moss = new THREE.Color(flora.header.moss);
  const kinds = flora.header.barks.map((b) => ({ ...b, dark: new THREE.Color(b.dark), light: new THREE.Color(b.light), twig: new THREE.Color(b.twig) }));
  const sheets = { bark: sheet(true), birchBark: sheet(false) };
  const { radius } = limbs.attributes;
  const { start, length, bark } = runs.attributes;
  for (let n = 0; n < runs.count; n++) {
    const kind = kinds[bark[n]];
    const last = start[n] + length[n] - 1;
    let k = start[n];
    let piece = 0;
    while (k < last) {
      const sides = sidesFor(radius[k]);
      let j = k + 1;
      while (j < last && sidesFor(radius[j]) >= sides) j++;
      dressPiece(sheets[kind.material], limbs.attributes, k, j, sides, j === last, kind, hash1(n * 7 + piece), moss, field);
      k = j;
      piece++;
    }
  }
  return { bark: sheetGeometry(sheets.bark), birchBark: sheetGeometry(sheets.birchBark) };
}

// ---------- Copies ----------
// A template's copies made into one geometry. On a lighter tier only a share
// of the leaves is kept, each of them a little larger. What a copy carries
// for the year depends on what it is: a leaf knows where it hangs, its number
// in the queue of leaves that turn and fall, and the colour it turns to; a
// cluster of blossom where it opens from; a fruit where it swells from.
function copiesGeometry(copies, template, { blend, share = 1, year = null }) {
  const c = copies.attributes;
  const t = template.attributes;
  const tv = template.count;
  const ti = template.index;
  const kept = [];
  for (let k = 0; k < copies.count; k++) if (share >= 1 || fract(Math.sin(k * 12.9898 + 4.1) * 43758.5453) < share) kept.push(k);
  const grow = share >= 1 ? 1 : 1 + (1 - share) * 0.55;
  const n = kept.length * tv;
  const position = new Float32Array(n * 3);
  const normal = new Float32Array(n * 3);
  const color = new Float32Array(n * 3);
  const sway = new Float32Array(n);
  const leaf = year === 'leaf' || year === 'bloom' ? new Float32Array(n * 4) : null;
  const turn = year === 'leaf' ? new Float32Array(n * 3) : null;
  const pop = year === 'pop' ? new Float32Array(n * 4) : null;
  const index = new (n > 65535 ? Uint32Array : Uint16Array)(kept.length * ti.length);
  const e = _r.elements;
  kept.forEach((k, j) => {
    _q.fromArray(c.rotation, k * 4).normalize();
    _r.makeRotationFromQuaternion(_q);
    const size = c.size[k] * grow;
    const px = c.position[k * 3];
    const py = c.position[k * 3 + 1];
    const pz = c.position[k * 3 + 2];
    _s.fromArray(c.shade, k * 3).normalize();
    const number = c.number[k];
    for (let v = 0; v < tv; v++) {
      const o = j * tv + v;
      // Turned, sized and set in place
      const x = t.position[v * 3] * size;
      const y = t.position[v * 3 + 1] * size;
      const z = t.position[v * 3 + 2] * size;
      position[o * 3] = px + e[0] * x + e[4] * y + e[8] * z;
      position[o * 3 + 1] = py + e[1] * x + e[5] * y + e[9] * z;
      position[o * 3 + 2] = pz + e[2] * x + e[6] * y + e[10] * z;
      _n.fromArray(t.normal, v * 3).applyMatrix4(_r);
      if (blend > 0) {
        // Whichever face is seen, it leans to the crown's own normal
        if (_n.dot(_s) < 0) _n.negate();
        _n.multiplyScalar(1 - blend).addScaledVector(_s, blend);
      }
      _n.normalize();
      normal[o * 3] = _n.x;
      normal[o * 3 + 1] = _n.y;
      normal[o * 3 + 2] = _n.z;
      for (let i = 0; i < 3; i++) color[o * 3 + i] = c.color[k * 3 + i] * t.color[v * 3 + i];
      sway[o] = c.sway[k] * t.flex[v];
      if (leaf) {
        // The point a leaf hangs from, and its own number: the leaves of a
        // sprig go one after another, the ones that cling on together
        _v.fromArray(t.hinge, v * 3).multiplyScalar(size);
        leaf[o * 4] = px + e[0] * _v.x + e[4] * _v.y + e[8] * _v.z;
        leaf[o * 4 + 1] = py + e[1] * _v.x + e[5] * _v.y + e[9] * _v.z;
        leaf[o * 4 + 2] = pz + e[2] * _v.x + e[6] * _v.y + e[10] * _v.z;
        const own = fract(t.hinge[v * 3] * 37.1 + t.hinge[v * 3 + 1] * 91.7 + t.hinge[v * 3 + 2] * 53.3);
        leaf[o * 4 + 3] = year === 'bloom' || number >= 0.95 ? number : Math.min(0.9, number * 0.8 + own * 0.18);
      }
      if (turn) for (let i = 0; i < 3; i++) turn[o * 3 + i] = c.autumn[k * 3 + i] * t.color[v * 3 + i];
      if (pop) {
        pop[o * 4] = px;
        pop[o * 4 + 1] = py;
        pop[o * 4 + 2] = pz;
        pop[o * 4 + 3] = number;
      }
    }
    const base = j * tv;
    for (let i = 0; i < ti.length; i++) index[j * ti.length + i] = ti[i] + base;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.BufferAttribute(color, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  if (leaf) g.setAttribute('aLeaf', new THREE.BufferAttribute(leaf, 4));
  if (turn) g.setAttribute('aTurn', new THREE.BufferAttribute(turn, 3));
  if (pop) g.setAttribute('aPop', new THREE.BufferAttribute(pop, 4));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();
  return g;
}

export function createTrees(flora, field, kit, quality) {
  const group = new THREE.Group();
  group.name = 'trees';
  const parts = flora.parts;
  const { anchors: made, crowns } = flora.header;
  const anchors = {
    // The lumps of every crown that sheds its leaves, for the air to drop them from
    crowns,
    swing: { point: new THREE.Vector3().fromArray(made.swing.point), limbRadius: made.swing.limbRadius, yaw: made.swing.yaw },
    apple: new THREE.Vector3().fromArray(made.apple),
    appleTop: new THREE.Vector3().fromArray(made.appleTop),
  };

  const add = (geometry, material, name, options) => {
    const m = mesh(geometry, material, { name, ...options });
    group.add(m);
    return m;
  };

  // ---------- Bark and the bodies of the crowns ----------
  const barks = barkGeometries(flora, field);
  if (barks.bark) add(barks.bark, kit.bark, 'bark');
  if (barks.birchBark) add(barks.birchBark, kit.birchBark, 'birch-bark');
  let bodies = null;
  if (parts.get('crowns')) {
    bodies = add(meshGeometry(parts.get('crowns'), { leaf: ['aLeaf', 4], autumn: ['aTurn', 3], sway: ['sway', 1] }), kit.crown, 'crowns');
    bodies.customDepthMaterial = kit.shadows.crown;
  }
  if (parts.get('evergreen')) add(meshGeometry(parts.get('evergreen'), { sway: ['sway', 1] }), kit.canopy, 'evergreen');

  // ---------- Leaves, boughs, blossom and fruit ----------
  const sets = { leaves: [], needles: [], petals: [] };
  const crops = [];
  for (const p of parts.values()) {
    if (p.kind !== 'copies') continue;
    const template = parts.get(p.template);
    if (p.material === 'fruit') {
      // Fruit swells where it hangs, thing by thing as its season comes over
      const uPop = { value: season.row(0) };
      const kind = kit.seasonal(uPop);
      const m = add(copiesGeometry(p, template, { blend: BLEND.fruit, year: 'pop' }), kind.solid, p.name);
      m.customDepthMaterial = kind.shadow;
      crops.push({ m, uPop, track: (v) => v[p.track] });
      continue;
    }
    const year = p.material === 'leaves' ? 'leaf' : p.material === 'petals' ? 'bloom' : null;
    // The lighter tiers keep fewer leaves; blossom and boughs are thinned less
    const share = p.material === 'petals' ? Math.max(0.75, quality.foliage) : p.material === 'needles' ? Math.max(0.8, quality.foliage) : quality.foliage;
    sets[p.material].push(copiesGeometry(p, template, { blend: BLEND[p.material], share, year }));
  }
  const leafy = sets.leaves.length ? add(merge(sets.leaves, { keep: ['aLeaf', 'aTurn'] }), kit.foliage.seasonal, 'leaves', { receive: false }) : null;
  if (leafy) leafy.customDepthMaterial = kit.shadows.leaves;
  if (sets.needles.length) add(merge(sets.needles), kit.foliage.evergreen, 'needles', { receive: false });
  const blossom = sets.petals.length ? add(merge(sets.petals, { keep: ['aLeaf'] }), kit.petals, 'blossom', { cast: false, receive: false }) : null;

  // ---------- The swing ----------
  const swing = new THREE.Group();
  {
    const { point, limbRadius, yaw } = anchors.swing;
    const ground = field.height(point.x, point.z);
    const drop = point.y - limbRadius - (ground + 0.48);
    swing.position.copy(point).setY(point.y - limbRadius * 0.6);
    swing.rotation.order = 'YXZ';
    swing.rotation.y = yaw;
    const half = 0.24;
    const ropes = [];
    for (const side of [-1, 1]) {
      ropes.push(part(tube([new THREE.Vector3(side * half, 0.1, 0), new THREE.Vector3(side * half, -drop, 0)], 0.016, { radial: 5 }), palette.cream));
      // The loop over the limb
      ropes.push(part(new THREE.TorusGeometry(limbRadius * 1.25, 0.018, 5, 12).deleteAttribute('uv'), palette.cream, { x: side * half, y: limbRadius * 0.6, ry: Math.PI / 2 }));
    }
    swing.add(mesh(merge(ropes), kit.solid, { name: 'swing-ropes' }));
    const seat = grainUv(roundedBox(0.6, 0.05, 0.2, 0.02), 'x', 'z', 0.5);
    part(seat, palette.woodLight, { y: -drop });
    swing.add(mesh(merge([seat], { keepUv: true }), kit.wood, { name: 'swing-seat' }));
    swing.userData.drop = drop;
    anchors.swingSeat = new THREE.Vector3(point.x, ground + 0.56, point.z);
  }
  group.add(swing);

  // What is not there is not drawn: leaves in midwinter, blossom out of spring
  function dress() {
    // While the year turns one side of the island is further on than the other
    const fewest = season.least('leafDrop');
    if (bodies) bodies.visible = fewest < 0.82;
    if (leafy) leafy.visible = fewest < 0.999;
    if (blossom) blossom.visible = season.most('blossom') > 0.002;
    for (const c of crops) c.m.visible = season.across(c.track, c.uPop.value) > 0.004;
  }
  dress();

  function update(time) {
    if (season.changed) dress();
    // A slow pendulum, as if someone has just hopped off
    swing.rotation.x = Math.sin(time * 1.9) * 0.13 * (0.75 + 0.25 * Math.sin(time * 0.23));
  }

  return { group, anchors, update };
}
