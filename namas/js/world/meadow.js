import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized, yearGLSL, GRASS_SHADE, GRASS_WET } from '../core/materials.js';
import { season } from '../core/season.js';
import { icoSphere, tube, lathe, place, paint, merge } from '../core/geo.js';
import { part } from './kit.js';
import { TREES, YARD, CLEARINGS } from './layout.js';

// Everything that grows low: the lawn's tufts and the flowers in it, and
// what comes up only in spring or autumn.
// Each kind keeps its own season: it comes up plant by plant when its time
// arrives and goes the same way.

// The spot a plant stands on, a number of its own from it, and where the spot
// stands among the clocks of the year
const PLANT_NUMBER = /* glsl */ `
  #ifdef USE_INSTANCING
    vec2 plantAt = instanceMatrix[ 3 ].xz;
    float plantNumber = fract( sin( dot( plantAt, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 );
  #else
    vec2 plantAt = position.xz;
    float plantNumber = 0.5;
  #endif
  vec2 plantClock = creekClock( plantAt );
`;
// Plants of one kind come up one after another as `uGrow` runs from 0 to 1:
// it is told by every clock of the year
const GROW_HOOKS = {
  vertexPars: /* glsl */ `
    ${yearGLSL}
    uniform float uGrow[ CREEK_CLOCKS ];
  `,
  vertexLocal: /* glsl */ `
    ${PLANT_NUMBER}
    transformed *= smoothstep( plantNumber * 0.7, plantNumber * 0.7 + 0.3, creekOf( uGrow, plantClock ) );
  `,
};

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
  // The wild strip along the rim, where the mower does not reach and the
  // meadow flowers keep to
  const rim = (x, z) => 1 - smoothstep(1.2, 3.6, field.edge(x, z));
  // ...and the long grass round a trunk
  const stems = [{ x: YARD.apple.x, z: YARD.apple.z, r: 1.1 }, ...TREES.birches.map((t) => ({ x: t.x, z: t.z, r: 0.9 })), ...TREES.spruces.map((t) => ({ x: t.x, z: t.z, r: 1.4 }))];
  const trunks = (x, z) => {
    let k = 0;
    for (const t of stems) k = Math.max(k, 1 - Math.hypot(x - t.x, z - t.z) / t.r);
    return saturate(k * 1.6);
  };

  const blade = stylized({
    name: 'grass',
    side: THREE.DoubleSide,
    // Both faces of a blade are lit like the turf under it
    keepNormals: true,
    sway: true,
    rim: 0,
    ramp: 0.6,
    // Snow does not sit on a blade: it buries most tufts and leaves the rest as straw
    snow: 0,
    glow: 0.22,
    wet: GRASS_WET,
    shade: GRASS_SHADE,
    hooks: {
      vertexPars: yearGLSL,
      vertexLocal: /* glsl */ `
        ${PLANT_NUMBER}
        {
          // Shorter out of season; under snow nine tufts in ten lie flat and out of sight
          float buried = smoothstep( plantNumber * 0.6, plantNumber * 0.6 + 0.4, creekOf( uWinter, plantClock ).x ) * step( 0.1, plantNumber );
          transformed.y *= creekOf( uGround, plantClock ).w;
          transformed *= 1.0 - buried;
        }
      `,
      fragmentPars: /* glsl */ `uniform vec4 uWind;`,
      // Exactly the turf's year, wind and wash, so a tuft is the colour of the ground under it
      fragmentAlbedo: /* glsl */ `
        {
          diffuseColor.rgb = creekGrass( diffuseColor.rgb, creekGround );
          float gustPhase = dot( vWorldPos.xz, uWind.xy ) * 0.42 - uWind.w * 1.25;
          diffuseColor.rgb *= 1.0 + ( sin( gustPhase ) * 0.55 + sin( gustPhase * 2.17 + 1.3 ) * 0.3 ) * 0.05 * uWind.z * creekGround.w;
          diffuseColor.rgb *= creekWash( vWorldPos.xz );
        }
      `,
    },
  });
  // One material to a kind of flower, all from one program: each has its own season
  const growers = [];
  const flowerMaterial = (track) => {
    const uGrow = { value: season.row(1) };
    const material = stylized({ name: 'flower', side: THREE.DoubleSide, keepNormals: true, sway: true, rim: 0.05, ramp: 0.7, wrap: 0.3, cloud: true, snow: 0, wet: 0.2, shade: GRASS_SHADE, uniforms: { uGrow }, hooks: GROW_HOOKS });
    growers.push({ uGrow, track, meshes: [] });
    return material;
  };
  const grown = (im) => {
    growers[growers.length - 1].meshes.push(im);
    return im;
  };

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
        // Mown short; longer where the mower does not go: along the rim and round the trunks
        const wild = Math.max(1 - smoothstep(0.3, 1.8, field.edge(px, pz)), trunks(px, pz)) * 0.7 - 0.12;
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
        // Daisies are out from spring; the rest of the summer flowers follow
        season: (v) => Math.max(v.springFlowers * 0.55, v.summerFlowers),
        geometry: flowerGeometry({ petals: 9, radius: 0.085, notch: 0.38, cup: 0.06, height: 0.33, petal: palette.white, heart: palette.butter, stem: palette.grassDeep }),
        count: 420,
        where: (x, z) => smoothstep(-0.15, 0.35, noise.fbm2(x * 0.22 + 4, z * 0.22 + 9, 2)),
      },
      {
        name: 'cornflower',
        geometry: flowerGeometry({ petals: 7, radius: 0.08, notch: 0.3, cup: 0.22, height: 0.42, petal: palette.cornflower, heart: palette.lilac, stem: palette.grassDeep, double: true }),
        count: 220,
        where: (x, z) => smoothstep(0.05, 0.4, noise.fbm2(x * 0.2 - 12, z * 0.2 + 3, 2) + rim(x, z) * 0.3) * rim(x, z),
      },
      {
        name: 'buttercup',
        // By the water they are the marsh marigolds of spring
        season: (v) => Math.max(v.springFlowers, v.summerFlowers),
        geometry: flowerGeometry({ petals: 5, radius: 0.066, notch: 0.62, cup: 0.3, height: 0.27, petal: palette.butter, heart: '#EFB23A', stem: palette.grassMid, heartSize: 0.3 }),
        count: 300,
        where: (x, z) => smoothstep(0.0, 0.4, noise.fbm2(x * 0.3 + 20, z * 0.3 - 14, 2)) * (0.4 + 0.6 * rim(x, z)),
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
        count: 90,
        where: (x, z) => smoothstep(0.1, 0.45, noise.fbm2(x * 0.24 + 40, z * 0.24 + 40, 2) + 0.15) * rim(x, z),
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
      const im = instanced(kind.geometry, flowerMaterial(kind.season || ((v) => v.summerFlowers)), items);
      im.name = kind.name;
      group.add(grown(im));
    }
  }

  // ---------- What only spring and autumn bring ----------
  {
    // Their own numbers, so the summer meadow stays exactly as it was
    const rng2 = createRng(505);
    const trees = [
      { x: YARD.apple.x, z: YARD.apple.z, r: 4.2 },
      ...TREES.birches.map((t) => ({ x: t.x, z: t.z, r: 3.0 })),
    ];
    const spruces = TREES.spruces.map((t) => ({ x: t.x, z: t.z, r: 2.6 }));
    const near = (list, x, z) => {
      let k = 0;
      for (const t of list) k = Math.max(k, 1 - Math.hypot(x - t.x, z - t.z) / t.r);
      return saturate(k);
    };

    // A mushroom: a domed cap on a stout stem
    const mushroom = (cap, under, stem, { r = 0.07, h = 0.11, dots = false } = {}) => {
      const parts = [];
      const stalk = lathe(
        [
          [r * 0.34, 0],
          [r * 0.26, h * 0.5],
          [r * 0.22, h],
        ],
        7
      );
      part(stalk, stem);
      parts.push(stalk);
      const dome = lathe(
        [
          [r * 0.2, h * 0.92],
          [r, h * 0.98],
          [r * 0.9, h + r * 0.34],
          [r * 0.52, h + r * 0.62],
          [0.002, h + r * 0.7],
        ],
        10
      );
      const top = col(cap);
      const below = col(under);
      paint(dome, (p, n, i, out) => out.copy(n.y < -0.2 ? below : top).multiplyScalar(0.92 + 0.14 * saturate(n.y)));
      parts.push(dome);
      if (dots) {
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * TAU + 0.4;
          const d = k === 0 ? 0 : r * (k % 2 ? 0.52 : 0.3);
          const spot = icoSphere(r * 0.11, 0);
          part(spot, palette.cream, { x: Math.cos(a) * d, y: h + r * (0.7 - (d / r) * (d / r) * 0.5), z: Math.sin(a) * d, sy: 0.5 });
          parts.push(spot);
        }
      }
      return merge(parts);
    };

    const kinds = [
      {
        name: 'dandelion',
        season: (v) => v.springFlowers,
        geometry: flowerGeometry({ petals: 13, radius: 0.07, notch: 0.72, cup: 0.14, height: 0.2, petal: '#F6C93E', heart: '#EDAE2E', stem: palette.grassMid, heartSize: 0.5, double: true }),
        count: 640,
        where: (x, z) => smoothstep(-0.25, 0.3, noise.fbm2(x * 0.24 + 61, z * 0.24 - 17, 2)),
      },
      {
        name: 'hepatica',
        season: (v) => v.springFlowers,
        geometry: flowerGeometry({ petals: 6, radius: 0.056, notch: 0.5, cup: 0.14, height: 0.12, petal: '#8292E6', heart: palette.cream, stem: palette.grassDeep, heartSize: 0.3 }),
        count: 300,
        where: (x, z) => smoothstep(0.1, 0.75, near(trees, x, z)) * (0.55 + 0.45 * saturate(0.5 + noise.fbm2(x * 0.5 + 9, z * 0.5 + 9, 2))),
      },
      {
        name: 'crocus',
        // The first to flower: up through the last of the snow, gone by full spring
        season: (v) => v.snowdrops,
        geometry: flowerGeometry({ petals: 6, radius: 0.05, notch: 0.82, cup: 1.1, height: 0.12, petal: palette.lilac, heart: palette.butter, stem: palette.grassLight, heartSize: 0.34 }),
        count: 200,
        where: (x, z) => smoothstep(0.1, 0.5, noise.fbm2(x * 0.33 - 40, z * 0.33 + 12, 2)),
      },
      {
        name: 'snowdrop',
        season: (v) => v.snowdrops,
        geometry: flowerGeometry({ petals: 3, radius: 0.045, notch: 0.86, cup: 1.3, height: 0.14, petal: palette.white, heart: '#BFE0A6', stem: palette.grassMid, heartSize: 0.4, double: true }),
        count: 260,
        where: (x, z) => smoothstep(0.0, 0.6, near(trees, x, z) * 0.7 + smoothstep(0.1, 0.5, noise.fbm2(x * 0.3 + 80, z * 0.3 - 33, 2)) * 0.5),
      },
      {
        name: 'fly-agaric',
        season: (v) => v.mushrooms,
        geometry: mushroom('#E2604E', palette.cream, palette.cream, { r: 0.085, h: 0.12, dots: true }),
        count: 44,
        cast: true,
        where: (x, z) => smoothstep(0.15, 0.7, Math.max(near(spruces, x, z), near(trees.slice(1), x, z) * 0.8)),
      },
      {
        name: 'bolete',
        season: (v) => v.mushrooms,
        geometry: mushroom('#B07A4E', '#EAD9B0', '#E9DCC2', { r: 0.075, h: 0.1 }),
        count: 34,
        cast: true,
        where: (x, z) => smoothstep(0.2, 0.75, near(trees.slice(1), x, z)),
      },
    ];
    for (const kind of kinds) {
      const items = [];
      const want = Math.round(kind.count * lerp(0.5, 1, quality.density));
      for (let tries = 0; tries < want * 40 && items.length < want; tries++) {
        const x = rng2.range(-15.5, 15.5);
        const z = rng2.range(-11.5, 11.5);
        if (field.edge(x, z) < 0.35 || cleared(x, z)) continue;
        if (rng2() > kind.where(x, z)) continue;
        const h = field.height(x, z);
        terrain.sample(x, z, h, ground, mask);
        if (mask[0] < 0.82) continue;
        const tilt = kind.cast ? 0.12 : 0.22;
        items.push({ x, y: h - 0.01, z, yaw: rng2.range(0, TAU), rx: rng2.range(-tilt, tilt), rz: rng2.range(-tilt, tilt), s: rng2.range(0.8, 1.35), color: _c.setScalar(rng2.range(0.93, 1.06)).clone() });
      }
      const im = instanced(kind.geometry, flowerMaterial(kind.season), items, { cast: !!kind.cast });
      im.name = kind.name;
      group.add(grown(im));
    }
  }

  // ---------- The year ----------
  function dress() {
    for (const g of growers) {
      const shown = season.across(g.track, g.uGrow.value) > 0.004;
      for (const m of g.meshes) m.visible = shown;
    }
  }
  dress();

  function update() {
    if (season.changed) dress();
  }

  return { group, flowerSpots, update };
}
