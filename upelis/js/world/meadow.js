import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized } from '../core/materials.js';
import { icoSphere, tube, place, paint, merge } from '../core/geo.js';
import { mesh, part } from './kit.js';
import { PROPS, BRIDGE, TREES, CLEARINGS } from './layout.js';

// Everything that grows low: grass tufts, wildflowers, reeds and lily pads.

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

// A clump of tapering blades fanning out from one root.
function tuftGeometry(rng, { blades = 6, height = 0.28, width = 0.04, spread = 0.05, lean = 0.38, rows = 4, root = 0.76, tip = 1.22, swayScale = 0.55 }) {
  const position = [];
  const normal = [];
  const color = [];
  const sway = [];
  const index = [];
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * TAU + rng.range(-0.5, 0.5);
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const bx = dx * spread * rng.range(0.2, 1);
    const bz = dz * spread * rng.range(0.2, 1);
    const h = height * rng.range(0.62, 1.18);
    const l = lean * h * rng.range(0.35, 1.25);
    const w = width * rng.range(0.8, 1.2);
    // Blades are turned a little, so the tuft has body from every side
    const turn = a + Math.PI / 2 + rng.range(-0.6, 0.6);
    const sx = Math.cos(turn);
    const sz = Math.sin(turn);
    const base = position.length / 3;
    for (let k = 0; k < rows; k++) {
      const t = k / (rows - 1);
      const cx = bx + dx * l * t * t;
      const cz = bz + dz * l * t * t;
      const cy = h * (t - 0.1 * t * t);
      const hw = (w / 2) * (1 - Math.pow(t, 1.4) * 0.94);
      position.push(cx - sx * hw, cy, cz - sz * hw, cx + sx * hw, cy, cz + sz * hw);
      for (let v = 0; v < 2; v++) {
        // Lit like the ground it grows from
        const n = _p.set(dx * 0.22, 1, dz * 0.22).normalize();
        normal.push(n.x, n.y, n.z);
        const shade = lerp(root, tip, Math.pow(t, 0.8));
        color.push(shade * (1 + t * 0.05), shade, shade * (1 - t * 0.16));
        sway.push(t * t * h * swayScale);
      }
    }
    for (let k = 0; k < rows - 1; k++) {
      const i = base + k * 2;
      index.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
  g.setIndex(index);
  return g;
}

// A flower head seen from above: a ring of petals around a domed heart.
function flowerGeometry({ petals = 8, radius = 0.08, notch = 0.5, cup = 0.1, height = 0.34, petal, heart, heartSize = 0.34, stem, double = false }) {
  const parts = [];
  const cPetal = col(petal);
  const cHeart = col(heart);
  const cStem = col(stem);

  const ring = (r, y, lift, tintMix) => {
    const position = [0, y, 0];
    const color = [cPetal.r * 0.9, cPetal.g * 0.9, cPetal.b * 0.9];
    const index = [];
    const n = petals * 4;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      // Scalloped outline: full at the middle of each petal, pinched between
      const k = 0.5 + 0.5 * Math.cos(a * petals);
      const rr = r * lerp(notch, 1, Math.pow(k, 0.6));
      position.push(Math.cos(a) * rr, y + lift * (rr / r) * (rr / r), Math.sin(a) * rr);
      const shade = lerp(0.9, 1.08, k) * tintMix;
      color.push(cPetal.r * shade, cPetal.g * shade, cPetal.b * shade);
      index.push(0, 1 + ((i + 1) % n), 1 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  };

  parts.push(ring(radius, height, cup * radius * 2, 1));
  if (double) parts.push(place(ring(radius * 0.66, height + radius * 0.12, cup * radius * 3.2, 1.06), { ry: Math.PI / petals }));
  const centre = icoSphere(radius * heartSize, 1);
  part(centre, cHeart, { y: height + radius * 0.08, sy: 0.6 });
  parts.push(centre);

  const stalk = tube(
    [new THREE.Vector3(0, 0, 0), new THREE.Vector3(radius * 0.25, height * 0.5, 0), new THREE.Vector3(0, height, 0)],
    radius * 0.09,
    { radial: 4, capStart: false, capEnd: false }
  );
  part(stalk, cStem);
  parts.push(stalk);

  const g = merge(parts);
  // The whole flower nods together
  const pos = g.attributes.position;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) sway[i] = Math.pow(saturate(pos.getY(i) / height), 1.6) * 0.085;
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  // Petals are lit like the meadow, so they stay bright from every angle
  const nor = g.attributes.normal;
  for (let i = 0; i < nor.count; i++) {
    _p.fromBufferAttribute(nor, i);
    _p.set(_p.x * 0.35, Math.abs(_p.y) * 0.4 + 0.75, _p.z * 0.35).normalize();
    nor.setXYZ(i, _p.x, _p.y, _p.z);
  }
  return g;
}

// True where something made lies on the ground and nothing should grow.
function cleared(x, z) {
  for (const [cx, cz, hl, hw, yaw] of CLEARINGS) {
    const dx = x - cx;
    const dz = z - cz;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    if (Math.abs(dx * c - dz * s) < hl && Math.abs(dx * s + dz * c) < hw) return true;
  }
  return false;
}

function instanced(geometry, material, items, { colors = true, cast = false } = {}) {
  const im = new THREE.InstancedMesh(geometry, material, items.length);
  items.forEach((it, i) => {
    _e.set(it.rx || 0, it.yaw || 0, it.rz || 0, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(it.s * (it.sxz || 1), it.s * (it.sy || 1), it.s * (it.sxz || 1));
    _p.set(it.x, it.y, it.z);
    im.setMatrixAt(i, _m.compose(_p, _q, _s));
    if (colors) im.setColorAt(i, it.color);
  });
  im.instanceMatrix.needsUpdate = true;
  if (colors && im.instanceColor) im.instanceColor.needsUpdate = true;
  im.castShadow = cast;
  im.receiveShadow = true;
  im.computeBoundingSphere();
  return im;
}

export function createMeadow(field, terrain, kit, quality) {
  const group = new THREE.Group();
  group.name = 'meadow';
  const noise = field.noise;
  const rng = createRng(77);
  const mask = [0, 0, 0, 0];
  const ground = new THREE.Color();

  const blade = stylized({
    name: 'grass',
    side: THREE.DoubleSide,
    sway: true,
    rim: 0,
    ramp: 0.6,
    hooks: {
      // Exactly the turf's wash, so a tuft is the colour of the ground under it
      fragmentAlbedo: /* glsl */ `diffuseColor.rgb *= creekWash( vWorldPos.xz );`,
    },
  });
  const petal = stylized({ name: 'flower', side: THREE.DoubleSide, sway: true, rim: 0.05, ramp: 0.7, wrap: 0.3, cloud: true });

  // ---------- Grass ----------
  {
    const cell = lerp(0.3, 0.165, quality.density);
    const variants = [0, 1, 2].map((v) => tuftGeometry(createRng(300 + v), { blades: 6 + v, height: 0.27 + v * 0.03, lean: 0.34 + v * 0.07 }));
    const lists = variants.map(() => []);
    const { minX, minZ, maxX, maxZ } = field.bounds;
    for (let z = minZ; z < maxZ; z += cell) {
      for (let x = minX; x < maxX; x += cell) {
        const px = x + rng.range(0, cell);
        const pz = z + rng.range(0, cell);
        if (field.edge(px, pz) < 0.12 || cleared(px, pz)) continue;
        const h = field.height(px, pz);
        terrain.sample(px, pz, h, ground, mask);
        const grass = mask[0];
        if (grass < 0.5 || rng() > grass * 1.15) continue;
        // Longer where nobody walks: by the water, at the rim, among stones
        const shore = field.shore(px, pz);
        const wild = Math.max(1 - smoothstep(0.3, 1.6, shore), 1 - smoothstep(0.3, 1.5, field.edge(px, pz))) * 0.55;
        const patch = noise.fbm2(px * 0.5 + 31, pz * 0.5 - 7, 2);
        const s = (0.72 + rng() * 0.5 + wild * 0.7 + saturate(patch) * 0.42) * lerp(0.55, 1, smoothstep(0.5, 0.9, grass));
        _c.copy(ground).multiplyScalar(1.03 + rng.range(-0.05, 0.07));
        _c.offsetHSL(rng.range(-0.008, 0.012), 0, 0);
        lists[rng.int(0, variants.length - 1)].push({ x: px, y: h - 0.015, z: pz, yaw: rng.range(0, TAU), s, sxz: rng.range(0.9, 1.25), color: _c.clone() });
      }
    }
    lists.forEach((items, i) => {
      const im = instanced(variants[i], blade, items);
      im.name = `grass-${i}`;
      group.add(im);
    });
  }

  // ---------- Wildflowers ----------
  const flowerSpots = [];
  {
    const kinds = [
      {
        name: 'daisy',
        geometry: flowerGeometry({ petals: 9, radius: 0.085, notch: 0.38, cup: 0.06, height: 0.33, petal: palette.white, heart: palette.butter, stem: palette.grassDeep }),
        count: 520,
        where: (x, z) => smoothstep(-0.15, 0.35, noise.fbm2(x * 0.22 + 4, z * 0.22 + 9, 2)),
      },
      {
        name: 'cornflower',
        geometry: flowerGeometry({ petals: 7, radius: 0.08, notch: 0.3, cup: 0.22, height: 0.42, petal: palette.cornflower, heart: palette.lilac, stem: palette.grassDeep, double: true }),
        count: 300,
        where: (x, z) => smoothstep(0.05, 0.4, noise.fbm2(x * 0.2 - 12, z * 0.2 + 3, 2)) * (0.35 + 0.65 * smoothstep(2, 9, x)),
      },
      {
        name: 'buttercup',
        geometry: flowerGeometry({ petals: 5, radius: 0.066, notch: 0.62, cup: 0.3, height: 0.27, petal: palette.butter, heart: '#EFB23A', stem: palette.grassMid, heartSize: 0.3 }),
        count: 380,
        where: (x, z) => smoothstep(0.0, 0.4, noise.fbm2(x * 0.3 + 20, z * 0.3 - 14, 2)) * (0.4 + 0.6 * (1 - smoothstep(1, 4.5, field.shore(x, z)))),
      },
      {
        name: 'clover',
        geometry: flowerGeometry({ petals: 6, radius: 0.062, notch: 0.7, cup: 0.5, height: 0.22, petal: palette.pink, heart: '#F7D3DC', stem: palette.grassMid, heartSize: 0.72, double: true }),
        count: 300,
        where: (x, z) => smoothstep(0.0, 0.35, noise.fbm2(x * 0.28 - 3, z * 0.28 + 25, 2)) * (0.3 + 0.7 * smoothstep(1, -6, x)),
      },
      {
        name: 'poppy',
        geometry: flowerGeometry({ petals: 4, radius: 0.1, notch: 0.74, cup: 0.36, height: 0.46, petal: palette.red, heart: palette.ink, stem: palette.grassDeep, heartSize: 0.26 }),
        count: 110,
        where: (x, z) => smoothstep(0.22, 0.5, noise.fbm2(x * 0.24 + 40, z * 0.24 + 40, 2)) * smoothstep(3, 8, x) * smoothstep(-3, 2, z),
      },
    ];
    for (const kind of kinds) {
      const items = [];
      const want = Math.round(kind.count * lerp(0.5, 1, quality.density));
      for (let tries = 0; tries < want * 30 && items.length < want; tries++) {
        const x = rng.range(-15.5, 15.5);
        const z = rng.range(-11.5, 11.5);
        if (field.edge(x, z) < 0.35 || cleared(x, z)) continue;
        if (rng() > kind.where(x, z)) continue;
        const h = field.height(x, z);
        terrain.sample(x, z, h, ground, mask);
        if (mask[0] < 0.82) continue;
        items.push({ x, y: h - 0.01, z, yaw: rng.range(0, TAU), rx: rng.range(-0.22, 0.22), rz: rng.range(-0.22, 0.22), s: rng.range(0.82, 1.3), color: _c.setScalar(rng.range(0.93, 1.06)).clone() });
        if (kind.name === 'daisy' && items.length % 40 === 0) flowerSpots.push(new THREE.Vector3(x, h + 0.4, z));
      }
      const im = instanced(kind.geometry, petal, items);
      im.name = kind.name;
      group.add(im);
    }
  }

  // ---------- Reeds and cattails along the quiet banks ----------
  const reedSpots = [];
  {
    const reed = tuftGeometry(createRng(51), { blades: 7, height: 0.95, width: 0.055, spread: 0.1, lean: 0.2, rows: 5, root: 0.7, tip: 1.2, swayScale: 0.3 });
    const reedItems = [];
    const tails = [];
    const creek = field.creek;
    const frame = {};
    const keepClear = [
      [PROPS.beach.x, PROPS.beach.z, 3.1],
      [BRIDGE.from[0], BRIDGE.from[1], 1.7],
      [BRIDGE.to[0], BRIDGE.to[1], 1.7],
      [-3.0, -1.6, 2.0],
      [TREES.willow.x, TREES.willow.z, 0.9],
      [PROPS.stork.x, PROPS.stork.z, 0.75],
    ];
    const dark = col(palette.reedDark);
    const light = col(palette.reed);
    const beds = [
      // creek control point, side (+ near bank / - far bank), spread along, how many
      [8.0, -1, 2.6, 30],
      [8.9, -1, 1.5, 20],
      [7.0, -1, 1.4, 12],
      [9.4, 1, 0.9, 7],
      [5.2, -1, 1.1, 10],
      [1.2, 1, 1.0, 8],
      [2.1, -1, 0.8, 8],
      [11.2, -1, 1.2, 10],
      [11.8, 1, 0.9, 7],
      [12.6, -1, 0.8, 6],
    ];
    for (const [cu, side, spread, count] of beds) {
      const s0 = field.creekS(Math.floor(cu)) + (cu % 1) * (field.creekS(Math.floor(cu) + 1) - field.creekS(Math.floor(cu)));
      for (let k = 0; k < Math.round(count * lerp(0.6, 1, quality.density)); k++) {
        field.creekAt(s0 + rng.gauss() * spread * 0.5, frame);
        const lat = side * (frame.w + rng.range(-0.55, 0.42));
        const x = frame.x + frame.nx * lat;
        const z = frame.z + frame.nz * lat;
        if (keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)) continue;
        if (field.edge(x, z) < 0.6) continue;
        const depth = field.level(x, z) - field.height(x, z);
        if (depth > 0.2) continue;
        const y = Math.min(field.height(x, z), field.level(x, z)) - 0.03;
        _c.copy(dark).lerp(light, rng()).multiplyScalar(rng.range(0.92, 1.08));
        const s = rng.range(0.75, 1.3);
        reedItems.push({ x, y, z, yaw: rng.range(0, TAU), s, sxz: 1.1, color: _c.clone() });
        if (rng.chance(0.3)) tails.push({ x: x + rng.range(-0.1, 0.1), y, z: z + rng.range(-0.1, 0.1), h: rng.range(0.95, 1.4) * s });
        if (k === 0) reedSpots.push(new THREE.Vector3(x, y + 1.1, z));
      }
    }
    const reeds = instanced(reed, blade, reedItems);
    reeds.name = 'reeds';
    group.add(reeds);

    // Cattails: a stalk and its brown velvet head
    const parts = [];
    const stalk = col(palette.reedDark);
    const head = col(palette.cattail);
    for (const t of tails) {
      const leanX = rng.range(-0.08, 0.08);
      const leanZ = rng.range(-0.08, 0.08);
      const top = new THREE.Vector3(t.x + leanX, t.y + t.h, t.z + leanZ);
      const g = tube([new THREE.Vector3(t.x, t.y, t.z), new THREE.Vector3(t.x + leanX * 0.4, t.y + t.h * 0.5, t.z + leanZ * 0.4), top], 0.011, { radial: 4, capStart: false });
      part(g, stalk);
      const pos = g.attributes.position;
      const sw = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) sw[i] = Math.pow(saturate((pos.getY(i) - t.y) / t.h), 2) * 0.16;
      g.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
      parts.push(g);
      const cap = icoSphere(1, 1);
      part(cap, head, { x: top.x - leanX * 0.12, y: top.y - 0.11, z: top.z - leanZ * 0.12, sx: 0.03, sy: 0.1, sz: 0.03 });
      cap.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(cap.attributes.position.count).fill(0.15), 1));
      parts.push(cap);
    }
    if (parts.length) {
      const m = mesh(merge(parts), kit.solidDouble, { name: 'cattails', cast: false });
      group.add(m);
    }
  }

  // ---------- Lily pads ----------
  const pads = [];
  {
    const padGeometry = (r) => {
      const position = [0, 0.004, 0];
      const index = [];
      const n = 26;
      const gap = 0.34; // the notch every lily pad has
      for (let i = 0; i <= n; i++) {
        const a = gap / 2 + (i / n) * (TAU - gap);
        const wob = 1 + Math.sin(a * 5) * 0.035;
        position.push(Math.cos(a) * r * wob, 0.012 + Math.sin(a * 3) * 0.004, Math.sin(a) * r * wob);
        if (i < n) index.push(0, 2 + i, 1 + i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      const inner = col(palette.lilyPad);
      const outer = col(palette.lilyPadDark);
      paint(g, (p, nn, i, out) => {
        const d = Math.hypot(p.x, p.z) / r;
        const vein = 0.5 + 0.5 * Math.cos(Math.atan2(p.z, p.x) * 9);
        out.copy(inner).lerp(outer, d * 0.75).multiplyScalar(1 + vein * 0.06 * d);
      });
      return g;
    };

    const parts = [];
    const lilies = [];
    const spots = [
      // across the pool (lateral from the centreline, - is the far bank), along (m), radius
      [-1.75, -1.6, 0.3],
      [-2.0, -0.9, 0.24],
      [-1.5, -0.6, 0.2],
      [-2.05, 0.1, 0.33],
      [-1.55, 0.6, 0.23],
      [-1.9, 1.2, 0.27],
      [-1.4, 1.7, 0.2],
      [-1.2, -2.3, 0.22],
      [-0.9, 2.3, 0.26],
      [1.5, -2.1, 0.24],
      [1.85, -1.5, 0.19],
      [-1.15, 0.2, 0.18],
    ];
    const s0 = field.creekS(8);
    const frame = {};
    spots.forEach(([lat, along, r], i) => {
      field.creekAt(s0 + along, frame);
      const x = frame.x + frame.nx * lat;
      const z = frame.z + frame.nz * lat;
      if (field.level(x, z) - field.height(x, z) < 0.06) return;
      const y = field.level(x, z) + 0.004;
      const g = padGeometry(r);
      place(g, { x, y, z, ry: rng.range(0, TAU) });
      parts.push(g);
      pads.push({ x, y: y + 0.014, z, r, lily: i % 4 === 1 });
      if (i % 4 === 1) lilies.push({ x: x + r * 0.2, y: y + 0.02, z: z - r * 0.15, s: r * 0.85 });
    });
    if (parts.length) {
      const m = mesh(merge(parts), kit.solid, { name: 'lily-pads', cast: false });
      group.add(m);
    }

    // Water lilies: two rings of pointed petals around a golden heart
    const petals = [];
    const white = col(palette.white);
    const blush = col(palette.pink);
    lilies.forEach((l, li) => {
      for (let ringIndex = 0; ringIndex < 2; ringIndex++) {
        const n = ringIndex === 0 ? 8 : 6;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + ringIndex * 0.4;
          const tilt = ringIndex === 0 ? 0.5 : 1.0;
          const g = icoSphere(1, 1);
          paint(g, (p, nn, i, out) => out.copy(blush).lerp(white, saturate(0.45 + p.x * 0.7 + (li % 2) * 0.4)));
          place(g, { sx: 0.5, sy: 0.07, sz: 0.2 });
          place(g, { x: 0.36 });
          place(g, { rz: tilt, ry: a });
          place(g, { x: l.x, y: l.y + ringIndex * 0.02 * l.s, z: l.z, s: l.s * 0.6 });
          petals.push(g);
        }
      }
      const heart = icoSphere(0.11 * l.s, 1);
      part(heart, palette.butter, { x: l.x, y: l.y + 0.05 * l.s, z: l.z });
      petals.push(heart);
    });
    if (petals.length) {
      const m = mesh(merge(petals), kit.solid, { name: 'water-lilies', cast: false });
      group.add(m);
    }
  }

  return { group, pads, flowerSpots, reedSpots };
}
