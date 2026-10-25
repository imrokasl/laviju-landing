import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { stylized, yearGLSL, GRASS_SHADE, GRASS_WET } from '../core/materials.js';
import { season } from '../core/season.js';
import { TREES, YARD, CLEARINGS } from './layout.js';

// Everything that grows low: the lawn's tufts and the flowers in it, and
// what comes up only in spring or autumn. Every kind is modelled once in
// Blender (landing-web/namas/blender/meadow.py) and comes in flora.bin.
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
// The paddling pool stands on the lawn in summer (`uPool`, told by every
// clock of the year): what grows where it stands, out to the outside of its
// ring, goes down as it comes out and is up again once it is put away
const POOL_MOVE = /* glsl */ `
  transformed *= 1.0 - smoothstep( 0.0, 0.3, creekOf( uPool, plantClock ) ) * step( distance( plantAt, vec2( ${YARD.pool.x.toFixed(2)}, ${YARD.pool.z.toFixed(2)} ) ), ${(YARD.pool.r + 0.15).toFixed(2)} );
`;
// Plants of one kind come up one after another as `uGrow` runs from 0 to 1:
// it is told by every clock of the year
const GROW_HOOKS = {
  vertexPars: /* glsl */ `
    ${yearGLSL}
    uniform float uGrow[ CREEK_CLOCKS ];
    uniform float uPool[ CREEK_CLOCKS ];
  `,
  vertexLocal: /* glsl */ `
    ${PLANT_NUMBER}
    transformed *= smoothstep( plantNumber * 0.7, plantNumber * 0.7 + 0.3, creekOf( uGrow, plantClock ) );
    ${POOL_MOVE}
  `,
};

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

// One kind as meadow.py modelled it, standing on its root: a tuft's colours
// are shades of the turf's, a flower's are its own, and `sway` is how far the
// wind moves each point.
function plantGeometry(flora, name) {
  const part = flora.parts.get(name);
  const a = part.attributes;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.normalizeNormals();
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setAttribute('sway', new THREE.BufferAttribute(a.sway, 1));
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  g.computeBoundingSphere();
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

export function createMeadow(field, terrain, quality, flora) {
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

  // Where the pool stands, told for every clock of the year
  const uPool = { value: season.row(0) };
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
    uniforms: { uPool },
    hooks: {
      vertexPars: /* glsl */ `
        ${yearGLSL}
        uniform float uPool[ CREEK_CLOCKS ];
      `,
      vertexLocal: /* glsl */ `
        ${PLANT_NUMBER}
        {
          // Shorter out of season; under snow nine tufts in ten lie flat and out of sight
          float buried = smoothstep( plantNumber * 0.6, plantNumber * 0.6 + 0.4, creekOf( uWinter, plantClock ).x ) * step( 0.1, plantNumber );
          transformed.y *= creekOf( uGround, plantClock ).w;
          transformed *= 1.0 - buried;
        }
        ${POOL_MOVE}
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
    const material = stylized({ name: 'flower', side: THREE.DoubleSide, keepNormals: true, sway: true, rim: 0.05, ramp: 0.7, wrap: 0.3, cloud: true, snow: 0, wet: 0.2, shade: GRASS_SHADE, uniforms: { uGrow, uPool }, hooks: GROW_HOOKS });
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
    // Three tufts of mown grass, and one gone to seed for where the mower does not go
    const variants = ['tuft-a', 'tuft-b', 'tuft-c', 'tuft-seed'].map((name) => plantGeometry(flora, name));
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
        const v = rng.int(0, 2);
        lists[v === 2 && wild > 0.25 ? 3 : v].push({ x: px, y: h - 0.015, z: pz, yaw: rng.range(0, TAU), s, sxz: rng.range(0.9, 1.25), color: _c.clone() });
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
        count: 420,
        where: (x, z) => smoothstep(-0.15, 0.35, noise.fbm2(x * 0.22 + 4, z * 0.22 + 9, 2)),
      },
      {
        name: 'cornflower',
        count: 220,
        where: (x, z) => smoothstep(0.05, 0.4, noise.fbm2(x * 0.2 - 12, z * 0.2 + 3, 2) + rim(x, z) * 0.3) * rim(x, z),
      },
      {
        name: 'buttercup',
        // By the water they are the marsh marigolds of spring
        season: (v) => Math.max(v.springFlowers, v.summerFlowers),
        count: 300,
        where: (x, z) => smoothstep(0.0, 0.4, noise.fbm2(x * 0.3 + 20, z * 0.3 - 14, 2)) * (0.4 + 0.6 * rim(x, z)),
      },
      {
        name: 'clover',
        count: 300,
        where: (x, z) => smoothstep(0.0, 0.35, noise.fbm2(x * 0.28 - 3, z * 0.28 + 25, 2)) * (0.3 + 0.7 * smoothstep(1, -6, x)),
      },
      {
        name: 'poppy',
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
      const im = instanced(plantGeometry(flora, kind.name), flowerMaterial(kind.season || ((v) => v.summerFlowers)), items);
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

    const kinds = [
      {
        name: 'dandelion',
        season: (v) => v.springFlowers,
        count: 640,
        where: (x, z) => smoothstep(-0.25, 0.3, noise.fbm2(x * 0.24 + 61, z * 0.24 - 17, 2)),
      },
      {
        name: 'hepatica',
        season: (v) => v.springFlowers,
        count: 300,
        where: (x, z) => smoothstep(0.1, 0.75, near(trees, x, z)) * (0.55 + 0.45 * saturate(0.5 + noise.fbm2(x * 0.5 + 9, z * 0.5 + 9, 2))),
      },
      {
        name: 'crocus',
        // The first to flower: up through the last of the snow, gone by full spring
        season: (v) => v.snowdrops,
        count: 200,
        where: (x, z) => smoothstep(0.1, 0.5, noise.fbm2(x * 0.33 - 40, z * 0.33 + 12, 2)),
      },
      {
        name: 'snowdrop',
        season: (v) => v.snowdrops,
        count: 260,
        where: (x, z) => smoothstep(0.0, 0.6, near(trees, x, z) * 0.7 + smoothstep(0.1, 0.5, noise.fbm2(x * 0.3 + 80, z * 0.3 - 33, 2)) * 0.5),
      },
      {
        name: 'fly-agaric',
        season: (v) => v.mushrooms,
        count: 44,
        cast: true,
        where: (x, z) => smoothstep(0.15, 0.7, Math.max(near(spruces, x, z), near(trees.slice(1), x, z) * 0.8)),
      },
      {
        name: 'bolete',
        season: (v) => v.mushrooms,
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
      const im = instanced(plantGeometry(flora, kind.name), flowerMaterial(kind.season), items, { cast: !!kind.cast });
      im.name = kind.name;
      group.add(grown(im));
    }
  }

  // ---------- The year ----------
  function dress() {
    // The pool comes out with the summer's things (see world/house.js)
    season.across((v) => v.setSummer, uPool.value);
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
