import * as THREE from '../core/three.js';
import { lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized, GRASS_SHADE, GRASS_WET } from '../core/materials.js';
import { TREES, YARD } from './layout.js';

// The plot itself: the lawn on top, with the gravel of the drive and the
// strip under the eaves, the soil wall around it and the rock that tapers
// away underneath.

const GU = 264; // top grid resolution along x
const GV = 198; // ... and along z
const WALL = [
  // depth below the rim, push outwards (metres)
  [0.0, 0.0],
  [0.05, 0.07],
  [0.14, 0.06],
  [0.24, -0.05],
  [0.45, -0.02],
  [0.8, 0.04],
  [1.15, -0.02],
  [1.5, -0.1],
];
const UNDER_RINGS = 34;

// A row of footprints end to end, for what stands along the ground: a bed's
// boards, the edge of the deck, the woodpile
function along(x0, z0, x1, z1, r, reach, k) {
  const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / (r * 1.4)));
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ x: x0 + ((x1 - x0) * i) / n, z: z0 + ((z1 - z0) * i) / n, r, reach, k });
  return out;
}
// ...and round the edge of a rectangle turned by `yaw`
function around(x, z, hx, hz, yaw, r, reach, k) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const at = (u, v) => [x + u * c + v * s, z - u * s + v * c];
  const corners = [at(-hx, -hz), at(hx, -hz), at(hx, hz), at(-hx, hz)];
  return corners.flatMap((p, i) => along(...p, ...corners[(i + 1) % 4], r, reach, k));
}

export function createTerrain(field, textures) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const noise = field.noise;

  // ---------- Contact shade ----------
  // The seam of dark where a trunk, a post or a wall meets the ground. It is
  // painted into the turf (and so into the grass that grows there), which
  // costs nothing to draw and holds on every device.
  const { terrace, porch, sandbox, greenhouse, doghouse, compost, woodpile, clothesline, gate, goal } = YARD;
  const contacts = [
    { x: YARD.apple.x, z: YARD.apple.z, r: 0.3, reach: 1.2, k: 0.36 },
    ...TREES.birches.map((t) => ({ x: t.x, z: t.z, r: 0.2, reach: 0.7, k: 0.3 })),
    ...TREES.spruces.map((t) => ({ x: t.x, z: t.z, r: 0.5, reach: 1.3, k: 0.34 })),
    ...TREES.bushes.map((t) => ({ x: t.x, z: t.z, r: t.r * 0.6, reach: t.r * 0.9, k: 0.3 })),
    ...around((terrace.x0 + terrace.x1) / 2, (terrace.z0 + terrace.z1) / 2, (terrace.x1 - terrace.x0) / 2, (terrace.z1 - terrace.z0) / 2, 0, 0.12, 0.45, 0.3),
    ...around((porch.x0 + porch.x1) / 2, (porch.z0 + porch.z1 + porch.step) / 2, (porch.x1 - porch.x0) / 2, (porch.z1 + porch.step - porch.z0) / 2, 0, 0.12, 0.4, 0.28),
    ...around(sandbox.x, sandbox.z, sandbox.size / 2, sandbox.size / 2, sandbox.yaw, 0.1, 0.4, 0.3),
    ...YARD.beds.flatMap((b) => around(b.x, b.z, b.w / 2, b.l / 2, 0, 0.1, 0.4, 0.3)),
    ...around(greenhouse.x, greenhouse.z, greenhouse.w / 2, greenhouse.l / 2, greenhouse.yaw, 0.1, 0.45, 0.3),
    ...around(doghouse.x, doghouse.z, 0.45, 0.4, doghouse.yaw, 0.12, 0.4, 0.32),
    ...around(compost.x, compost.z, 0.45, 0.45, compost.yaw, 0.12, 0.4, 0.3),
    ...along(woodpile.x, woodpile.z - woodpile.length / 2, woodpile.x, woodpile.z + woodpile.length / 2, 0.3, 0.5, 0.34),
    { x: clothesline.from[0], z: clothesline.from[1], r: 0.05, reach: 0.35, k: 0.28 },
    { x: clothesline.to[0], z: clothesline.to[1], r: 0.05, reach: 0.35, k: 0.28 },
    { x: gate.x - gate.width / 2, z: gate.z, r: 0.07, reach: 0.35, k: 0.28 },
    { x: gate.x + gate.width / 2, z: gate.z, r: 0.07, reach: 0.35, k: 0.28 },
    { x: YARD.mailbox.x, z: YARD.mailbox.z, r: 0.05, reach: 0.3, k: 0.26 },
    { x: YARD.birdhouse.x, z: YARD.birdhouse.z, r: 0.05, reach: 0.3, k: 0.26 },
    { x: YARD.rainBarrel.x, z: YARD.rainBarrel.z, r: 0.3, reach: 0.35, k: 0.3 },
    ...[-1, 1].map((s) => ({ x: goal.x + s * Math.cos(goal.yaw) * 0.75, z: goal.z - s * Math.sin(goal.yaw) * 0.75, r: 0.04, reach: 0.3, k: 0.24 })),
  ];
  const BIN = 2;
  const bins = new Map();
  for (const c of contacts) {
    const span = c.r + c.reach;
    for (let i = Math.floor((c.x - span) / BIN); i <= Math.floor((c.x + span) / BIN); i++) {
      for (let j = Math.floor((c.z - span) / BIN); j <= Math.floor((c.z + span) / BIN); j++) {
        const key = i * 1024 + j;
        if (!bins.has(key)) bins.set(key, []);
        bins.get(key).push(c);
      }
    }
  }
  const contactShade = (x, z) => {
    const list = bins.get(Math.floor(x / BIN) * 1024 + Math.floor(z / BIN));
    if (!list) return 0;
    let lit = 1;
    for (const c of list) {
      const t = saturate((Math.hypot(x - c.x, z - c.z) - c.r) / c.reach);
      if (t < 1) lit *= 1 - c.k * (1 - t) * (1 - t);
    }
    return 1 - lit;
  };
  // ...and along the foot of the house's walls
  const wallShade = (x, z) => {
    const d = field.buildingDistance(x, z);
    return d < 0.9 ? 0.34 * Math.pow(1 - saturate(d / 0.9), 2) : 0;
  };

  // Soft dark pools under the canopies, painted into the turf
  const shades = [
    { x: YARD.apple.x, z: YARD.apple.z, r: 3.8, k: 0.28 },
    ...TREES.birches.map((t) => ({ x: t.x, z: t.z, r: 2.4, k: 0.16 })),
    ...TREES.spruces.map((t) => ({ x: t.x, z: t.z, r: 1.9, k: 0.26 })),
    ...TREES.bushes.map((t) => ({ x: t.x, z: t.z, r: t.r * 1.5, k: 0.26 })),
  ];

  const canopyShade = (x, z) => {
    let s = 0;
    for (const t of shades) {
      const d = Math.hypot(x - t.x, z - t.z) / t.r;
      if (d < 1) s = Math.max(s, t.k * (1 - d * d) * (1 - d * d));
    }
    return s;
  };

  // Where the leaves come down in autumn: thick under the trees that shed
  // them, thinning out a few steps away
  const shedders = [
    { x: YARD.apple.x, z: YARD.apple.z, r: 6.2 },
    ...TREES.birches.map((t) => ({ x: t.x, z: t.z, r: 4.4 })),
    ...TREES.bushes.map((t) => ({ x: t.x, z: t.z, r: t.r * 2.6 })),
  ];
  const leafFall = (x, z) => {
    let k = 0;
    for (const t of shedders) {
      const d = Math.hypot(x - t.x, z - t.z) / t.r;
      if (d < 1) k = Math.max(k, Math.pow(1 - d, 1.25));
    }
    return k;
  };

  // ---------- Turf ----------
  const count = (GU + 1) * (GV + 1);
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const terrain = new Float32Array(count * 4); // grass, pebbles, water depth, sand
  const litter = new Float32Array(count); // how many leaves land here in autumn
  const bare = new Float32Array(count * 2); // how much of the ground is bare rock, and how much bare earth
  const index = new Uint32Array(GU * GV * 6);

  const cGrassDeep = col(palette.grassDeep);
  const cGrassMid = col(palette.grassMid);
  const cGrassLight = col(palette.grassLight);
  const cGrassSun = col(palette.grassSun);
  const cMoss = col(palette.moss);
  const cSand = col(palette.sand);
  const cPath = col(palette.path);
  const cRock = col(palette.rock);
  const cRockLight = col(palette.rockLight);
  const cRockDark = col(palette.rockDark);
  const cSoil = col(palette.soil);
  const cContact = new THREE.Color('#3E4A6E');
  // The worn edge of a path
  const cPathEdge = col(palette.soil).clone().lerp(col(palette.path), 0.55);

  const c = new THREE.Color();
  const xz = [0, 0];

  function shadeGround(x, z, h, out, mask) {
    const big = noise.fbm2(x * 0.16 + 3, z * 0.16 - 8, 3);
    const mid = noise.noise2(x * 0.55 - 6, z * 0.55 + 2);
    const fine = noise.noise2(x * 2.1 + 9, z * 2.1 - 1);

    // Lawn: sunny in the open, deeper where the house and the trees keep it cool
    c.copy(cGrassMid).lerp(cGrassLight, saturate(0.5 + big * 0.85 + mid * 0.2));
    c.lerp(cGrassSun, saturate(big * 1.3 - 0.25) * 0.55);
    const near = 1 - smoothstep(0.4, 3.0, field.buildingDistance(x, z));
    c.lerp(cGrassDeep, near * 0.3 * (0.6 + 0.4 * saturate(0.5 - mid)));
    const canopy = canopyShade(x, z);
    c.lerp(cMoss, canopy * 1.4).multiplyScalar(1 - canopy * 0.3);
    // Mown in broad stripes, there and back, softer towards the rim
    const stripe = Math.sin((x * 0.94 + z * 0.34) * 1.35 + mid * 0.6);
    c.multiplyScalar(1 + 0.045 * Math.sign(stripe) * smoothstep(0.0, 0.35, Math.abs(stripe)) * smoothstep(0.6, 2.4, field.edge(x, z)));
    let grass = 1;

    // Trodden path under the stepping stones: worn pale down the middle,
    // darker under the grass that leans over its edge
    const path = field.pathMask(x, z) * 0.75;
    let earth = 0;
    if (path > 0) {
      c.lerp(cPath, path * 0.9).lerp(cPathEdge, path * (1 - path) * 1.9);
      grass *= 1 - path;
      earth = path;
    }

    // Gravel: the drive, and the strip that keeps the rain off the walls
    const gravel = Math.max(field.driveMask(x, z), field.apronMask(x, z) * 0.95);
    let pebbles = 0;
    if (gravel > 0) {
      out.copy(cSand).lerp(cPath, 0.35 + 0.2 * saturate(0.5 + mid));
      c.lerp(out, gravel);
      grass *= 1 - gravel;
      pebbles = gravel * (0.8 + 0.2 * saturate(0.5 + fine));
    }

    // Catch a little light on the turf lip
    const e = field.edge(x, z);
    c.lerp(cGrassLight, (1 - smoothstep(0, 0.7, e)) * 0.35 * grass);

    // ...and lose a little wherever something stands on the ground
    const contact = 1 - (1 - contactShade(x, z)) * (1 - wallShade(x, z));
    if (contact > 0) c.multiplyScalar(1 - contact).lerp(cContact, contact * 0.34);

    out.copy(c);
    mask[0] = grass;
    mask[1] = pebbles;
    mask[2] = -1;
    mask[3] = 0;
    mask[4] = 0;
    mask[5] = earth;
  }

  const mask = [0, 0, 0, 0, 0, 0];
  const tmpColor = new THREE.Color();
  for (let j = 0; j <= GV; j++) {
    const v = (j / GV) * 2 - 1;
    for (let i = 0; i <= GU; i++) {
      const u = (i / GU) * 2 - 1;
      const k = j * (GU + 1) + i;
      field.mapUV(u, v, xz);
      const h = field.height(xz[0], xz[1]);
      position[k * 3] = xz[0];
      position[k * 3 + 1] = h;
      position[k * 3 + 2] = xz[1];
      shadeGround(xz[0], xz[1], h, tmpColor, mask);
      color[k * 3] = tmpColor.r;
      color[k * 3 + 1] = tmpColor.g;
      color[k * 3 + 2] = tmpColor.b;
      for (let m = 0; m < 4; m++) terrain[k * 4 + m] = mask[m];
      bare[k * 2] = mask[4];
      bare[k * 2 + 1] = mask[5];
      litter[k] = leafFall(xz[0], xz[1]);
    }
  }

  let t = 0;
  for (let j = 0; j < GV; j++) {
    for (let i = 0; i < GU; i++) {
      const a = j * (GU + 1) + i;
      const b = a + 1;
      const d = a + GU + 1;
      const e = d + 1;
      index[t++] = a;
      index[t++] = d;
      index[t++] = b;
      index[t++] = b;
      index[t++] = d;
      index[t++] = e;
    }
  }

  const topGeom = new THREE.BufferGeometry();
  topGeom.setAttribute('position', new THREE.BufferAttribute(position, 3));
  topGeom.setAttribute('color', new THREE.BufferAttribute(color, 3));
  topGeom.setAttribute('aTerrain', new THREE.BufferAttribute(terrain, 4));
  topGeom.setAttribute('aLitter', new THREE.BufferAttribute(litter, 1));
  topGeom.setAttribute('aBare', new THREE.BufferAttribute(bare, 2));
  topGeom.setIndex(new THREE.BufferAttribute(index, 1));
  topGeom.computeVertexNormals();

  const topMaterial = stylized({
    name: 'turf',
    rim: 0.06,
    ramp: 0.6,
    // The turf lays its own snow: in drifts, and never under the water
    snow: 0,
    uniforms: {
      uStrokes: { value: textures.strokes },
      uPebbles: { value: textures.pebbles },
      uLeaves: { value: textures.leaves },
      uStone: { value: textures.rock },
      uEarth: { value: textures.earth },
    },
    hooks: {
      vertexPars: /* glsl */ `
        attribute vec4 aTerrain;
        attribute float aLitter;
        attribute vec2 aBare;
        varying vec4 vTerrain;
        varying float vLitter;
        varying vec2 vBare;
        varying vec3 vGroundNormal;
      `,
      vertexLocal: /* glsl */ `
        vTerrain = aTerrain;
        vLitter = aLitter;
        vBare = aBare;
        vGroundNormal = normal;
      `,
      fragmentPars: /* glsl */ `
        uniform sampler2D uStrokes;
        uniform sampler2D uPebbles;
        uniform sampler2D uLeaves;
        uniform sampler2D uStone;
        uniform sampler2D uEarth;
        uniform vec4 uWind;
        varying vec4 vTerrain;
        varying float vLitter;
        varying vec2 vBare;
        varying vec3 vGroundNormal;

        // One fallen leaf to a cell of the ground: which of the sixteen painted
        // leaves it is, where it lies and how it is turned is up to the cell.
        vec4 creekLeaf( vec2 p, float share ) {
          vec2 cell = floor( p );
          float h = creekHash( cell + 17.3 );
          if ( h > share ) return vec4( 0.0 );
          float turn = fract( h * 37.7 + 0.31 ) * 6.2832;
          vec2 nudge = vec2( fract( h * 91.3 + 0.7 ), fract( h * 173.9 + 0.2 ) ) - 0.5;
          vec2 c = fract( p ) - 0.5 - nudge * 0.34;
          float cs = cos( turn );
          float sn = sin( turn );
          vec2 q = vec2( c.x * cs - c.y * sn, c.x * sn + c.y * cs ) * 1.5 + 0.5;
          if ( q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 ) return vec4( 0.0 );
          float which = floor( fract( h * 53.1 + 0.13 ) * 16.0 );
          vec2 uv = ( vec2( mod( which, 4.0 ), floor( which / 4.0 ) ) + q ) * 0.25;
          // The cells break the coordinates up, so the slopes come from the ground itself
          return textureGrad( uLeaves, uv, dFdx( p ) * 0.375, dFdy( p ) * 0.375 );
        }
      `,
      fragmentAlbedo: /* glsl */ `
        {
          vec2 wuv = vWorldPos.xz;
          float strokes = texture2D( uStrokes, wuv * 0.26 ).r;
          vec3 pebbles = texture2D( uPebbles, wuv * 0.46 ).rgb;
          float grass = vTerrain.x;

          // Grass follows the year: yellow-green in spring, straw by late autumn
          diffuseColor.rgb = mix( diffuseColor.rgb, creekGrass( diffuseColor.rgb, creekGround ), grass );
          // ...and takes as little of the frame's contact shade as its blades do,
          // and of the rain: it is bare earth, sand and stone that a shower darkens
          creekShade = mix( 1.0, ${GRASS_SHADE.toFixed(2)}, saturate( grass ) );
          creekWet = mix( 1.0, ${GRASS_WET.toFixed(2)}, saturate( grass ) );
          // The wind is seen crossing the meadow, in step with the blades it bends
          float gustPhase = dot( wuv, uWind.xy ) * 0.42 - uWind.w * 1.25;
          float gust = sin( gustPhase ) * 0.55 + sin( gustPhase * 2.17 + 1.3 ) * 0.3;
          diffuseColor.rgb *= 1.0 + gust * 0.05 * grass * uWind.z * creekGround.w;

          // Pigment pooling: broad and fine watercolour variation everywhere
          diffuseColor.rgb *= creekWash( wuv );
          // Brush strokes in the grass
          diffuseColor.rgb *= mix( 1.0, 0.62 + 0.78 * strokes, grass * 0.62 );
          // Bare rock keeps its grain whichever way it faces: the step under the
          // fall is as much stone as the top of the hill
          vec3 stoneAt = vWorldPos * 0.5;
          vec3 stoneDx = dFdx( stoneAt );
          vec3 stoneDy = dFdy( stoneAt );
          if ( vBare.x > 0.01 ) {
            vec3 face = abs( vGroundNormal );
            face *= face;
            face /= max( face.x + face.y + face.z, 0.001 );
            float grain = textureGrad( uStone, stoneAt.zy, stoneDx.zy, stoneDy.zy ).r * face.x
              + textureGrad( uStone, stoneAt.xz, stoneDx.xz, stoneDy.xz ).r * face.y
              + textureGrad( uStone, stoneAt.xy, stoneDx.xy, stoneDy.xy ).r * face.z;
            diffuseColor.rgb *= mix( 1.0, 0.54 + 0.92 * grain, saturate( vBare.x ) );
          }
          // Trodden paths and the bare earth around stones: crumbs, grit and small stones
          float crumbs = texture2D( uEarth, wuv * 0.58 ).r;
          diffuseColor.rgb *= mix( 1.0, 0.52 + 0.98 * crumbs, saturate( vBare.y ) * 0.9 );
          // Painted gravel on the drive and under the eaves, tinted by the ground under it
          vec3 stone = texture2D( uPebbles, wuv * 1.1 ).rgb * mix( vec3( 1.0 ), diffuseColor.rgb * 1.5, 0.5 );
          diffuseColor.rgb = mix( diffuseColor.rgb, stone, saturate( vTerrain.y ) * 0.85 );

          float dry = 1.0;

          // Fallen leaves: two loose layers, thick under the trees that shed them
          if ( creekGround.z > 0.002 && dry > 0.0 ) {
            float share = saturate( vLitter * 1.3 + 0.05 ) * creekGround.z * dry;
            vec4 leafA = creekLeaf( wuv * 3.1, share );
            vec4 leafB = creekLeaf( vec2( wuv.x * 0.83 + wuv.y * 0.56, wuv.y * 0.83 - wuv.x * 0.56 ) * 2.3 + 11.7, share * 0.85 );
            vec4 leaf = mix( leafA, leafB, leafB.a );
            float lies = max( leafA.a, leafB.a );
            // What has lain under the snow comes out of it brown: last year's
            // leaves, the few the spring finds still lying
            float old = max( creekGround.y, creekWinter.x );
            leaf.rgb = mix( leaf.rgb, vec3( 0.62, 0.44, 0.28 ) * ( 0.25 + 1.5 * dot( leaf.rgb, vec3( 0.3, 0.5, 0.2 ) ) ), old * 0.86 );
            diffuseColor.rgb = mix( diffuseColor.rgb, leaf.rgb * ( 0.8 + 0.3 * strokes ), lies * 0.96 );
          }

          // Snow: it settles in patches that follow the wash, and melts the same way
          if ( creekWinter.x > 0.002 && dry > 0.0 ) {
            float drift = texture2D( uWash, wuv * 0.043 + 0.21 ).r;
            float hold = ( drift * 0.5 + texture2D( uWash, wuv * 0.31 + 0.6 ).r * 0.3 + strokes * 0.2 ) * 0.72;
            creekSnow = smoothstep( hold, hold + 0.28, creekWinter.x ) * dry;
            vec3 snow = uSnowColor * ( 0.9 + 0.14 * drift + 0.05 * strokes );
            diffuseColor.rgb = mix( diffuseColor.rgb, snow, creekSnow );
          }
        }
      `,
      fragmentFinal: /* glsl */ `
        {
          if ( creekSnow > 0.01 ) {
            // Glints: grains that catch the sun, a different handful from every side
            vec2 grain = vWorldPos.xz * 15.0;
            float g = creekHash( floor( grain ) );
            vec2 at = fract( grain ) - 0.5 - ( vec2( fract( g * 41.3 ), fract( g * 87.1 ) ) - 0.5 ) * 0.5;
            float facet = fract( g * 57.3 + dot( geometryViewDir.xy, vec2( 5.1, 3.7 ) ) );
            float glint = step( 0.9, g ) * smoothstep( 0.55, 0.95, facet ) * ( 1.0 - smoothstep( 0.04, 0.2, length( at ) ) );
            float sunny = saturate( dot( reflectedLight.directDiffuse, vec3( 0.6 ) ) / ( dot( diffuseColor.rgb, vec3( 0.3334 ) ) + 0.02 ) );
            outgoingLight += vec3( 1.0, 0.98, 0.93 ) * glint * sunny * creekSnow * 0.9;
          }
        }
      `,
    },
  });

  // The turf is a single open sheet, so it has to cast from its lit side
  topMaterial.shadowSide = THREE.DoubleSide;
  const top = new THREE.Mesh(topGeom, topMaterial);
  top.receiveShadow = true;
  top.castShadow = true;
  top.name = 'turf';
  group.add(top);

  // ---------- Rim, soil wall and the rock underneath ----------
  // The border of the top grid, walked once around
  const ring = [];
  for (let i = 0; i < GU; i++) ring.push(i);
  for (let j = 0; j < GV; j++) ring.push(j * (GU + 1) + GU);
  for (let i = GU; i > 0; i--) ring.push(GV * (GU + 1) + i);
  for (let j = GV; j > 0; j--) ring.push(j * (GU + 1));
  const R = ring.length;

  const layers = WALL.length + UNDER_RINGS;
  const sPos = new Float32Array(R * layers * 3 + 3);
  const sCol = new Float32Array(R * layers * 3 + 3);
  const sTurf = new Float32Array((R * layers + 1) * 3); // x: 1 where the wall is still turf, y: 1 where it is soil, z: metres below the rim
  const sIdx = new Uint32Array(R * (layers - 1) * 6 + R * 3);

  const cTurfEdge = col(palette.grassLight);
  const cTurfUnder = col(palette.grassDeep);
  const cSoilDark = col(palette.soilDark);
  const cClay = col(palette.clay);
  const cRockWarm = col(palette.rockWarm);

  // Lobes that make the underside hang lower in places
  const lobes = [
    { x: -3.5, z: -1.5, r: 7.5, d: 4.2 },
    { x: 6.5, z: 2.0, r: 5.5, d: 2.6 },
    { x: -9.5, z: 3.5, r: 4.5, d: 1.8 },
  ];
  const wallDepth = WALL[WALL.length - 1][0];

  const underY = (x, z, rho, rimY) => {
    let depth = 5.2 + noise.fbm2(x * 0.16 + 2, z * 0.16 + 7, 3) * 1.5;
    for (const l of lobes) {
      const d = Math.hypot(x - l.x, z - l.z) / l.r;
      depth += l.d * Math.exp(-d * d * 2.2);
    }
    const profile = Math.pow(1 - rho, 0.58);
    return rimY - wallDepth - depth * profile;
  };

  for (let r = 0; r < R; r++) {
    const k = ring[r];
    const bx = position[k * 3];
    const by = position[k * 3 + 1];
    const bz = position[k * 3 + 2];
    const len = Math.hypot(bx, bz) || 1;
    const ox = bx / len;
    const oz = bz / len;
    // The wall hangs from the general rim height, not from the creek's notch
    const rimY = Math.max(by, 0.05);
    const th = Math.atan2(bz, bx);

    for (let l = 0; l < layers; l++) {
      const v = l * R + r;
      let x;
      let y;
      let z;

      if (l < WALL.length) {
        const [depth, push] = WALL[l];
        const bulge = l > 2 ? noise.noise3(Math.cos(th) * 6, depth * 2.2, Math.sin(th) * 6) * 0.09 : 0;
        x = bx + ox * (push + bulge);
        z = bz + oz * (push + bulge);
        y = by - depth;

        const strata = noise.noise3(Math.cos(th) * 3.2, y * 3.4, Math.sin(th) * 3.2);
        if (l === 0) c.copy(cTurfEdge);
        else if (l === 1) c.copy(cTurfEdge).lerp(cTurfUnder, 0.35);
        else if (l === 2) c.copy(cTurfUnder);
        else if (l === 3) c.copy(cSoilDark).multiplyScalar(0.78);
        else c.copy(cSoil).lerp(cClay, saturate(0.5 + strata * 0.9)).lerp(cRockWarm, saturate((depth - 0.9) / 0.6)).multiplyScalar(l === 4 ? 0.9 : 1);
      } else {
        const ringT = (l - WALL.length + 1) / UNDER_RINGS;
        // Rings crowd towards the rim, where the rock turns under fastest
        const rho = 1 - Math.pow(ringT, 1.55);
        const crag = 1 + noise.ridge3(Math.cos(th) * 2.4 * rho + 4, ringT * 3.1, Math.sin(th) * 2.4 * rho - 2) * 0.07 * ringT * (1 - ringT) * 4;
        x = bx * rho * crag;
        z = bz * rho * crag;
        y = underY(x, z, rho, rimY);
        y += Math.sin(y * 1.9 + noise.noise2(x * 0.5, z * 0.5) * 2.2) * 0.14;

        const depth = rimY - y;
        const strata = saturate(0.5 + 0.5 * Math.sin(y * 3.1 + noise.noise3(x * 0.4, y * 0.3, z * 0.4) * 3));
        c.copy(cRockWarm)
          .lerp(cRock, smoothstep(1.6, 3.4, depth))
          .lerp(cRockLight, strata * 0.4)
          .lerp(cRockDark, smoothstep(4.5, 9.5, depth) * 0.55);
      }

      sPos[v * 3] = x;
      sPos[v * 3 + 1] = y;
      sPos[v * 3 + 2] = z;
      sCol[v * 3] = c.r;
      sCol[v * 3 + 1] = c.g;
      sCol[v * 3 + 2] = c.b;
      sTurf[v * 3] = l < 2 ? 1 : l === 2 ? 0.6 : 0;
      sTurf[v * 3 + 1] = l < 3 ? 0 : l < WALL.length ? 1 : Math.max(0, 1 - (l - WALL.length + 1) / 3);
      sTurf[v * 3 + 2] = l < WALL.length ? WALL[l][0] : Math.max(wallDepth, rimY - y);
    }
  }

  // The lowest point closes the shape
  const tip = R * layers;
  {
    let lowest = Infinity;
    let sx = 0;
    let sz = 0;
    const last = (layers - 1) * R;
    for (let r = 0; r < R; r++) {
      sx += sPos[(last + r) * 3];
      sz += sPos[(last + r) * 3 + 2];
      lowest = Math.min(lowest, sPos[(last + r) * 3 + 1]);
    }
    sPos[tip * 3] = sx / R;
    sPos[tip * 3 + 1] = lowest - 0.35;
    sPos[tip * 3 + 2] = sz / R;
    sCol[tip * 3] = cRockDark.r;
    sCol[tip * 3 + 1] = cRockDark.g;
    sCol[tip * 3 + 2] = cRockDark.b;
  }

  t = 0;
  for (let l = 0; l < layers - 1; l++) {
    for (let r = 0; r < R; r++) {
      const a = l * R + r;
      const b = l * R + ((r + 1) % R);
      const d = a + R;
      const e = b + R;
      sIdx[t++] = a;
      sIdx[t++] = b;
      sIdx[t++] = d;
      sIdx[t++] = b;
      sIdx[t++] = e;
      sIdx[t++] = d;
    }
  }
  for (let r = 0; r < R; r++) {
    const a = (layers - 1) * R + r;
    const b = (layers - 1) * R + ((r + 1) % R);
    sIdx[t++] = a;
    sIdx[t++] = b;
    sIdx[t++] = tip;
  }

  const sideGeom = new THREE.BufferGeometry();
  sideGeom.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  sideGeom.setAttribute('color', new THREE.BufferAttribute(sCol, 3));
  sideGeom.setAttribute('aTurf', new THREE.BufferAttribute(sTurf, 3));
  sideGeom.setIndex(new THREE.BufferAttribute(sIdx, 1));
  sideGeom.computeVertexNormals();

  const sideMaterial = stylized({
    name: 'rock-under',
    rim: 0.16,
    ramp: 0.5,
    cloud: false,
    // The overhang keeps most of the rain off it
    wet: 0.5,
    uniforms: { uStone: { value: textures.rock }, uEarth: { value: textures.earth } },
    hooks: {
      vertexPars: /* glsl */ `
        attribute vec3 aTurf;
        varying vec3 vTurf;
      `,
      vertexLocal: /* glsl */ `vTurf = aTurf;`,
      fragmentPars: /* glsl */ `
        uniform sampler2D uStone;
        uniform sampler2D uEarth;
        varying vec3 vTurf;
        // A painted sheet wrapped round the island: so many tiles to a full
        // turn, so many to a metre of height. Its slopes are worked out from
        // the place itself: read off the angle they would jump where the angle
        // wraps, and draw a seam down the island.
        #define CREEK_ROUND( sheet, turns, rise, shift ) textureGrad( sheet, vec2( angle * turns * 0.1591549 + shift, vWorldPos.y * rise ), vec2( dAngle.x * turns * 0.1591549, dHeight.x * rise ), vec2( dAngle.y * turns * 0.1591549, dHeight.y * rise ) ).r
      `,
      fragmentAlbedo: /* glsl */ `
        diffuseColor.rgb = mix( diffuseColor.rgb, creekGrass( diffuseColor.rgb, creekGround ), vTurf.x );
        {
          float angle = atan( vWorldPos.z, vWorldPos.x );
          float reach = max( dot( vWorldPos.xz, vWorldPos.xz ), 0.01 );
          vec2 dAngle = vec2( vWorldPos.x * dFdx( vWorldPos.z ) - vWorldPos.z * dFdx( vWorldPos.x ), vWorldPos.x * dFdy( vWorldPos.z ) - vWorldPos.z * dFdy( vWorldPos.x ) ) / reach;
          vec2 dHeight = vec2( dFdx( vWorldPos.y ), dFdy( vWorldPos.y ) );
          // The wash, wrapped so the strata read as painted bands
          float wash = CREEK_ROUND( uWash, 14.0, 0.21, 0.0 );
          float fine = CREEK_ROUND( uWash, 37.0, 0.63, 0.4 );
          diffuseColor.rgb *= 0.66 + 0.44 * wash + 0.26 * fine;
          // ...and under the turf the island is stone, with a grain of its own
          float grain = CREEK_ROUND( uStone, 28.0, 0.42, 0.0 );
          diffuseColor.rgb *= mix( 1.0, 0.7 + 0.6 * grain, ( 1.0 - vTurf.x ) * ( 1.0 - vTurf.y * 0.5 ) );

          // Between the two it is soil: crumbly, with small stones in it,
          float soil = vTurf.y;
          float depth = vTurf.z;
          float crumbs = CREEK_ROUND( uEarth, 80.0, 0.86, 0.0 );
          // laid down in beds that dip and rise as they go round,
          float bed = depth * 3.1 + sin( angle * 5.0 ) * 0.22 + sin( angle * 13.0 + 1.7 ) * 0.1 + wash * 0.9;
          float bedTone = fract( sin( floor( bed + 0.5 ) * 12.9898 ) * 43758.5453 );
          float bedWide = fwidth( bed );
          float seam = ( 1.0 - smoothstep( bedWide, 0.09 + bedWide * 1.5, abs( fract( bed ) - 0.5 ) ) ) * ( 1.0 - smoothstep( 0.12, 0.4, bedWide ) );
          // and dark with leaf mould at the top, where the roots are
          float mould = 1.0 - smoothstep( 0.18, 0.7, depth + ( crumbs - 0.5 ) * 0.25 );
          diffuseColor.rgb *= mix( 1.0, ( 0.46 + 1.08 * crumbs ) * ( 0.86 + 0.26 * bedTone ) * ( 1.0 - 0.22 * seam ) * ( 1.0 - 0.3 * mould ), soil );
          // The bigger stones in it show pale
          float cobble = CREEK_ROUND( uEarth, 26.0, 0.28, 0.37 );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.56, 0.54, 0.55 ) * ( 0.7 + 0.6 * crumbs ), smoothstep( 0.66, 0.78, cobble ) * soil * smoothstep( 0.2, 0.5, depth ) * 0.7 );
          // Roots hang out of the turf, each to its own length (290 places for one in a turn)
          float rootAt = angle * 46.1549;
          float rootId = floor( rootAt );
          float rootDraw = fract( sin( rootId * 78.233 ) * 43758.5453 );
          float rootRun = depth / ( 0.3 + 0.75 * rootDraw );
          float rootWide = ( abs( dAngle.x ) + abs( dAngle.y ) ) * 46.1549;
          float strand = abs( fract( rootAt ) - 0.5 + sin( depth * 8.0 + rootId * 2.4 ) * 0.2 * rootRun );
          float root = ( 1.0 - smoothstep( 0.0, 0.15 * ( 1.0 - rootRun * 0.8 ) + rootWide, strand ) ) * step( rootRun, 1.0 ) * step( 0.45, fract( rootDraw * 7.31 ) ) * ( 1.0 - smoothstep( 0.25, 0.6, rootWide ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.7, 0.54, 0.38 ) * ( 0.8 + 0.4 * crumbs ), root * 0.8 * soil );
        }
      `,
    },
  });

  const side = new THREE.Mesh(sideGeom, sideMaterial);
  side.castShadow = false;
  side.receiveShadow = true;
  side.name = 'island-side';
  group.add(side);

  // sample(x, z, height, outColor, outMask): the painted ground at a point
  return { group, top, side, sample: shadeGround, ring: ring.map((k) => new THREE.Vector3(position[k * 3], position[k * 3 + 1], position[k * 3 + 2])) };
}
