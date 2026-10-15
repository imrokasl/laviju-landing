import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized, yearGLSL, GRASS_SHADE, GRASS_WET } from '../core/materials.js';
import { season } from '../core/season.js';
import { icoSphere, tube, lathe, place, paint, merge } from '../core/geo.js';
import { part } from './kit.js';
import { PROPS, BRIDGE, TREES, CLEARINGS } from './layout.js';

// Everything that grows low: grass tufts, wildflowers, reeds and lily pads.
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

  const blade = stylized({
    name: 'grass',
    side: THREE.DoubleSide,
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
  // Reeds stand all year: green in summer, straw from the first frosts
  const reedDry = { value: 0 };
  const reedBlade = stylized({
    name: 'reeds',
    side: THREE.DoubleSide,
    sway: true,
    rim: 0,
    ramp: 0.6,
    snow: 0.35,
    glow: 0.22,
    wet: GRASS_WET,
    shade: 0.5,
    uniforms: { uReedDry: reedDry },
    hooks: {
      fragmentPars: /* glsl */ `uniform float uReedDry;`,
      fragmentAlbedo: /* glsl */ `
        {
          float l = dot( diffuseColor.rgb, vec3( 0.26, 0.6, 0.14 ) );
          // What is brown already, the head of a cattail, stays as it is
          float green = 1.0 - smoothstep( 1.3, 1.8, diffuseColor.r / max( diffuseColor.g, 0.001 ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.86, 0.68, 0.36 ) * ( l * 1.7 + 0.1 ), uReedDry * green );
          diffuseColor.rgb *= creekWash( vWorldPos.xz );
        }
      `,
    },
  });
  // One material to a kind of flower, all from one program: each has its own season
  const growers = [];
  const flowerMaterial = (track) => {
    const uGrow = { value: season.row(1) };
    const material = stylized({ name: 'flower', side: THREE.DoubleSide, sway: true, rim: 0.05, ramp: 0.7, wrap: 0.3, cloud: true, snow: 0, wet: 0.2, shade: GRASS_SHADE, uniforms: { uGrow }, hooks: GROW_HOOKS });
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
        // Daisies are out from spring; the rest of the summer flowers follow
        season: (v) => Math.max(v.springFlowers * 0.55, v.summerFlowers),
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
        // By the water they are the marsh marigolds of spring
        season: (v) => Math.max(v.springFlowers, v.summerFlowers),
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
      { x: TREES.oak.x, z: TREES.oak.z, r: 5.2 },
      { x: TREES.willow.x, z: TREES.willow.z, r: 3.6 },
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
        where: (x, z) => smoothstep(0.15, 0.7, Math.max(near(spruces, x, z), near(trees.slice(2), x, z) * 0.8)),
      },
      {
        name: 'bolete',
        season: (v) => v.mushrooms,
        geometry: mushroom('#B07A4E', '#EAD9B0', '#E9DCC2', { r: 0.075, h: 0.1 }),
        count: 34,
        cast: true,
        where: (x, z) => smoothstep(0.2, 0.75, near(trees.slice(0, 1), x, z)),
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
    // Tall enough to throw a shade of their own on the bank and the water
    const reeds = instanced(reed, reedBlade, reedItems, { cast: true });
    reeds.name = 'reeds';
    group.add(reeds);

    // Cattails: a stalk bowing a little under its brown velvet head. They are
    // drawn with the reeds, so they sway with them and dry to straw as they do.
    if (tails.length) {
      const tall = 1.2;
      const top = new THREE.Vector3(0.07, tall, 0);
      const stalk = tube([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.028, tall * 0.5, 0), top], 0.011, { radial: 4, capStart: false });
      part(stalk, palette.reedDark);
      const pos = stalk.attributes.position;
      const sw = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) sw[i] = Math.pow(saturate(pos.getY(i) / tall), 2) * 0.16;
      stalk.setAttribute('sway', new THREE.BufferAttribute(sw, 1));
      const head = icoSphere(1, 1);
      part(head, palette.cattail, { x: top.x - 0.008, y: top.y - 0.11, z: 0, sx: 0.03, sy: 0.1, sz: 0.03 });
      head.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(head.attributes.position.count).fill(0.15), 1));
      const tailItems = tails.map((t) => {
        // The taller, the stouter
        const s = Math.sqrt(t.h / tall);
        return { x: t.x, y: t.y, z: t.z, yaw: rng.range(0, TAU), rz: rng.range(-0.07, 0.07), s, sy: s, color: _c.setScalar(0.94 + 0.12 * ((t.h * 7.31) % 1)).clone() };
      });
      const cattails = instanced(merge([stalk, head]), reedBlade, tailItems);
      cattails.name = 'cattails';
      group.add(cattails);
    }
  }

  // ---------- Lily pads ----------
  // Pads and lilies float: they ride the creek as it rises and falls, and
  // come and go with their own seasons
  const FLOAT_HOOKS = {
    vertexPars: /* glsl */ `
      ${yearGLSL}
      uniform float uGrow[ CREEK_CLOCKS ];
      uniform float uLevel;
      attribute float aOrder; // its turn among the others: 0 comes up first and goes last
    `,
    vertexLocal: /* glsl */ `
      vec2 floatClock = creekClock( instanceMatrix[ 3 ].xz );
      transformed *= smoothstep( aOrder * 0.7, aOrder * 0.7 + 0.3, creekOf( uGrow, floatClock ) );
    `,
    vertexWorld: /* glsl */ `creekWorld.y += uLevel;`,
  };
  const inTurn = (im, orders) => {
    im.geometry.setAttribute('aOrder', new THREE.InstancedBufferAttribute(new Float32Array(orders), 1));
    return im;
  };
  const floating = (track) => {
    const uGrow = { value: season.row(1) };
    const material = stylized({ name: 'floating', rim: 0.24, wash: 0.5, snow: 0, wet: 0.2, uniforms: { uGrow }, hooks: FLOAT_HOOKS });
    growers.push({ uGrow, track, meshes: [] });
    return material;
  };
  const pads = [];
  {
    const padGeometry = (r) => {
      // Drawn a metre across and four times too thick: it is set down at a quarter of that.
      // A pad is a shallow dish: its veins run out from where the stalk holds it
      // (every other spoke is one, pale, with the leaf darker between), and
      // its rim is turned up a little and gone the colour of old wine.
      const n = 28;
      const gap = 0.34; // the notch every lily pad has
      const rings = [
        [0.3, 0.02, 0.1],
        [0.68, 0.034, 0.55],
        [1, 0.056, 1],
      ];
      const position = [0, 0.014, 0];
      const color = [];
      const index = [];
      const pale = col(palette.lilyPad);
      const deep = col(palette.lilyPadDark);
      const edge = col('#8E6A5C');
      _c.copy(pale).lerp(col(palette.cream), 0.45);
      color.push(_c.r, _c.g, _c.b);
      rings.forEach(([share, lift, out], k) => {
        for (let i = 0; i <= n; i++) {
          const a = gap / 2 + (i / n) * (TAU - gap);
          const wob = 1 + Math.sin(a * 5) * 0.035 * out;
          position.push(Math.cos(a) * r * share * wob, lift + Math.sin(a * 3) * 0.016 * out, Math.sin(a) * r * share * wob);
          const vein = i % 2 === 0;
          _c.copy(pale).lerp(deep, share * 0.8);
          _c.multiplyScalar(vein ? 1.16 - 0.06 * out : 0.9 - 0.05 * out);
          if (k === 2) _c.lerp(edge, vein ? 0.16 : 0.34);
          color.push(_c.r, _c.g, _c.b);
          if (i === n) continue;
          const at = 1 + k * (n + 1) + i;
          if (k === 0) index.push(0, at + 1, at);
          else index.push(at - (n + 1), at + 1, at, at - (n + 1), at - n, at + 1);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      return g;
    };

    const padItems = [];
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
      // One pad of a metre across, set down at each spot in its own size
      padItems.push({ x, y, z, yaw: rng.range(0, TAU), s: r, color: _c.setScalar(1).clone() });
      pads.push({ x, y: y + 0.014, z, r, lily: i % 4 === 1 });
      if (i % 4 === 1) lilies.push({ x: x + r * 0.2, y: y + 0.02, z: z - r * 0.15, s: r * 0.85, yaw: (i * 2.4) % TAU, color: _c.setScalar(1).clone() });
    });
    // The frog's pad is the roomiest free one out in the open, on the side of
    // the pool the view faces. It is the first up in spring and the last to go.
    const free = pads.filter((p) => !p.lily && p.r >= 0.22);
    const frogPad = (free.length ? free : pads).slice().sort((a, b) => b.x * 0.43 + b.z * 0.9 - (a.x * 0.43 + a.z * 0.9))[0];
    if (frogPad) frogPad.frog = true;
    if (padItems.length) {
      const im = instanced(padGeometry(1), floating((v) => v.pads), padItems, { colors: false });
      inTurn(
        im,
        pads.map((p, i) => (p.frog ? 0 : 0.14 + 0.86 * ((i * 0.618) % 1)))
      );
      im.name = 'lily-pads';
      group.add(grown(im));
    }

    // Water lilies: two rings of pointed petals around a golden heart
    if (lilies.length) {
      const petals = [];
      const white = col(palette.white);
      const blush = col(palette.pink);
      for (let ringIndex = 0; ringIndex < 2; ringIndex++) {
        const n = ringIndex === 0 ? 8 : 6;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + ringIndex * 0.4;
          const tilt = ringIndex === 0 ? 0.5 : 1.0;
          const g = icoSphere(1, 1);
          paint(g, (p, nn, i, out) => out.copy(blush).lerp(white, saturate(0.65 + p.x * 0.7)));
          place(g, { sx: 0.5, sy: 0.07, sz: 0.2 });
          place(g, { x: 0.36 });
          place(g, { rz: tilt, ry: a });
          place(g, { y: ringIndex * 0.02, s: 0.6 });
          petals.push(g);
        }
      }
      const heart = icoSphere(0.11, 1);
      part(heart, palette.butter, { y: 0.05 });
      petals.push(heart);
      const im = instanced(merge(petals), floating((v) => v.lilies), lilies, { colors: false });
      inTurn(
        im,
        lilies.map((l, i) => (i * 0.618 + 0.2) % 1)
      );
      im.name = 'water-lilies';
      group.add(grown(im));
    }
  }

  // ---------- The year ----------
  function dress() {
    for (const g of growers) {
      const shown = season.across(g.track, g.uGrow.value) > 0.004;
      for (const m of g.meshes) m.visible = shown;
    }
    reedDry.value = season.v.reedDry;
  }
  dress();

  function update() {
    if (season.changed) dress();
  }

  return { group, pads, flowerSpots, reedSpots, update };
}
