import * as THREE from '../core/three.js';
import { lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized } from '../core/materials.js';
import { TREES } from './layout.js';

// The island itself: the turf on top, the soil wall around it and the rock
// that tapers away underneath.

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

export const CAUSTICS_GLSL = /* glsl */ `
float creekCaustics(vec2 uv, float t) {
  vec3 p = vec3(uv, t * 0.35);
  mat3 m = mat3(-2.0, -1.0, 2.0, 3.0, -2.0, 1.0, 1.0, 2.0, 2.0);
  vec3 a = p * m;
  vec3 b = a * m * 0.4;
  vec3 c = b * m * 0.3;
  float v = min(min(length(0.5 - fract(a)), length(0.5 - fract(b))), length(0.5 - fract(c)));
  return pow(v, 7.0) * 25.0;
}
`;

export function createTerrain(field, textures) {
  const group = new THREE.Group();
  group.name = 'terrain';
  const noise = field.noise;

  // Soft dark pools under the canopies, painted into the turf
  const shades = [
    { x: TREES.oak.x, z: TREES.oak.z, r: 4.6, k: 0.3 },
    { x: TREES.willow.x, z: TREES.willow.z, r: 3.4, k: 0.24 },
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

  // ---------- Turf ----------
  const count = (GU + 1) * (GV + 1);
  const position = new Float32Array(count * 3);
  const color = new Float32Array(count * 3);
  const terrain = new Float32Array(count * 4); // grass, pebbles, water depth, sand
  const index = new Uint32Array(GU * GV * 6);

  const cGrassDeep = col(palette.grassDeep);
  const cGrassMid = col(palette.grassMid);
  const cGrassLight = col(palette.grassLight);
  const cGrassSun = col(palette.grassSun);
  const cMoss = col(palette.moss);
  const cSand = col(palette.sand);
  const cSandWet = col(palette.sandWet);
  const cBed = col(palette.bed);
  const cBedDeep = col(palette.bedDeep);
  const cPath = col(palette.path);
  const cRock = col(palette.rock);
  const cRockLight = col(palette.rockLight);
  const cRockDark = col(palette.rockDark);
  const cSoil = col(palette.soil);

  const c = new THREE.Color();
  const n = new THREE.Vector3();
  const xz = [0, 0];

  function shadeGround(x, z, h, out, mask) {
    const shore = field.shore(x, z);
    const levelHere = field.level(x, z);
    const above = h - levelHere; // height over the local water level
    const hill = field.hillMask(x, z);
    field.normal(x, z, n);
    const slope = 1 - n.y;

    const big = noise.fbm2(x * 0.16 + 3, z * 0.16 - 8, 3);
    const mid = noise.noise2(x * 0.55 - 6, z * 0.55 + 2);
    const fine = noise.noise2(x * 2.1 + 9, z * 2.1 - 1);

    // Meadow: cool and lush by the water and under trees, sunny in the open
    c.copy(cGrassMid).lerp(cGrassLight, saturate(0.5 + big * 0.85 + mid * 0.2));
    c.lerp(cGrassSun, saturate(big * 1.3 - 0.25) * 0.55);
    const lush = (1 - smoothstep(0.3, 2.6, shore)) * 0.55;
    c.lerp(cGrassDeep, lush * (0.6 + 0.4 * saturate(0.5 - mid)));
    c.lerp(cMoss, canopyShade(x, z) * 1.4);
    let grass = 1;

    // Rock where the hill is steep, with pale strata
    const rocky = saturate(hill * smoothstep(0.1, 0.3, slope + fine * 0.03) * 1.25 + smoothstep(0.34, 0.6, slope));
    if (rocky > 0) {
      const strata = saturate(0.5 + 0.5 * Math.sin(h * 9 + mid * 2.5));
      out.copy(cRock).lerp(cRockLight, strata * 0.55 + saturate(n.y - 0.6)).lerp(cRockDark, saturate(slope * 1.4 - 0.25) * 0.5);
      c.lerp(out, rocky);
      grass *= 1 - rocky;
    }

    // Trodden path
    const path = shore > 0.25 ? field.pathMask(x, z) * (1 - rocky) : 0;
    if (path > 0) {
      c.lerp(cPath, path * 0.9);
      grass *= 1 - path;
    }

    // Sand and pebbles hug the waterline: wide where the bank is gentle
    let sand = 0;
    let pebbles = 0;
    let water = -1;
    if (shore < 3.2) {
      const wobble = mid * 0.05 + fine * 0.02;
      sand = 1 - smoothstep(0.1, 0.27, above + wobble);
      if (sand > 0) {
        out.copy(cSand).lerp(cSandWet, 1 - smoothstep(0.0, 0.07, above));
        c.lerp(out, sand);
        grass *= 1 - sand;
      }
      pebbles = (1 - smoothstep(0.02, 0.2, above + wobble)) * (0.75 + 0.25 * saturate(0.5 + mid));
      if (above < 0) {
        const d = -above;
        c.lerp(cBed, smoothstep(0, 0.22, d));
        c.lerp(cBedDeep, smoothstep(0.28, 0.85, d) * 0.62);
        pebbles = lerp(pebbles, 0.85, smoothstep(0, 0.15, d)) * (1 - smoothstep(0.5, 0.95, d) * 0.45);
      }
      water = shore < 0.8 ? -above : -1;
    }

    // Catch a little light on the turf lip
    const e = field.edge(x, z);
    c.lerp(cGrassLight, (1 - smoothstep(0, 0.7, e)) * 0.35 * grass);

    out.copy(c);
    mask[0] = grass;
    mask[1] = pebbles;
    mask[2] = water;
    mask[3] = sand;
  }

  const mask = [0, 0, 0, 0];
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
      terrain.set(mask, k * 4);
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
  topGeom.setIndex(new THREE.BufferAttribute(index, 1));
  topGeom.computeVertexNormals();

  const topMaterial = stylized({
    name: 'turf',
    rim: 0.06,
    ramp: 0.6,
    uniforms: {
      uStrokes: { value: textures.strokes },
      uPebbles: { value: textures.pebbles },
    },
    hooks: {
      vertexPars: /* glsl */ `
        attribute vec4 aTerrain;
        varying vec4 vTerrain;
      `,
      vertexLocal: /* glsl */ `vTerrain = aTerrain;`,
      fragmentPars: /* glsl */ `
        uniform sampler2D uStrokes;
        uniform sampler2D uPebbles;
        varying vec4 vTerrain;
        ${CAUSTICS_GLSL}
      `,
      fragmentAlbedo: /* glsl */ `
        {
          vec2 wuv = vWorldPos.xz;
          float strokes = texture2D( uStrokes, wuv * 0.26 ).r;
          vec3 pebbles = texture2D( uPebbles, wuv * 0.46 ).rgb;

          // Pigment pooling: broad and fine watercolour variation everywhere
          diffuseColor.rgb *= creekWash( wuv );
          // Brush strokes in the grass
          diffuseColor.rgb *= mix( 1.0, 0.62 + 0.78 * strokes, vTerrain.x * 0.62 );
          // Painted pebbles on the bed and the beach, tinted by the ground under them
          vec3 stone = pebbles * mix( vec3( 1.0 ), diffuseColor.rgb * 1.5, 0.42 );
          diffuseColor.rgb = mix( diffuseColor.rgb, stone, saturate( vTerrain.y ) * 0.92 );
        }
      `,
      fragmentFinal: /* glsl */ `
        {
          float under = smoothstep( 0.0, 0.12, vTerrain.z );
          if ( under > 0.0 ) {
            float sunny = saturate( dot( reflectedLight.directDiffuse, vec3( 0.6 ) ) / ( dot( diffuseColor.rgb, vec3( 0.3334 ) ) + 0.02 ) );
            float ca = creekCaustics( vWorldPos.xz * 0.62, uTime ) + creekCaustics( vWorldPos.xz * 0.41 + 3.7, uTime * 0.8 ) * 0.6;
            float depthFade = 1.0 - smoothstep( 0.45, 1.0, vTerrain.z ) * 0.55;
            outgoingLight += vec3( 1.0, 0.97, 0.86 ) * ca * 0.2 * under * sunny * depthFade;
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
        else if (l === 3) c.copy(cSoilDark);
        else c.copy(cSoil).lerp(cClay, saturate(0.5 + strata * 0.9)).lerp(cRockWarm, saturate((depth - 0.9) / 0.6));
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
  sideGeom.setIndex(new THREE.BufferAttribute(sIdx, 1));
  sideGeom.computeVertexNormals();

  const sideMaterial = stylized({
    name: 'rock-under',
    rim: 0.16,
    ramp: 0.5,
    cloud: false,
    hooks: {
      fragmentAlbedo: /* glsl */ `
        {
          // Wrap the wash around the island so the strata read as painted bands
          float around = atan( vWorldPos.z, vWorldPos.x ) * 2.2;
          float wash = texture2D( uWash, vec2( around, vWorldPos.y * 0.21 ) ).r;
          float fine = texture2D( uWash, vec2( around * 2.7 + 0.4, vWorldPos.y * 0.63 ) ).r;
          diffuseColor.rgb *= 0.66 + 0.44 * wash + 0.26 * fine;
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
