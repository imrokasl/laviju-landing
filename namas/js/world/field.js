import * as THREE from '../core/three.js';
import { TAU, clamp, lerp, saturate, smoothstep, createNoise } from '../core/math.js';
import { ISLAND, GROUND, HOUSE, GARAGE, YARD, KNOLLS } from './layout.js';

// The field is the plot as numbers: where the rim is, how high the ground
// stands, where the path, the drive and the yard's paving run. Meshes, plants,
// animals and markers all ask the field instead of guessing. It answers the
// creek's questions too (shore, level, depth), as ground far from any water,
// so the lawn, the trees and the weather can be grown the creek's way.

const CELL = 0.1; // grid spacing of the baked height map
const MARGIN = 1.2;

// The ground the house, the garage and the terrace stand on, with the yard
// paved or gravelled round them, as [x0, z0, x1, z1]
const FOOTPRINTS = [
  [Math.min(HOUSE.x0, GARAGE.x0), Math.min(HOUSE.z0, GARAGE.z0), HOUSE.x1, HOUSE.z1],
  [YARD.terrace.x0, YARD.terrace.z0, YARD.terrace.x1, YARD.terrace.z1],
];

export function createField(seed = 7) {
  const noise = createNoise(seed);

  // ---------- Island outline ----------
  // A square grid is bent into a rounded slab; the grid's border becomes the rim.
  function mapUV(u, v, out) {
    const k = ISLAND.roundness;
    const dx = u * Math.sqrt(1 - (v * v) / 2);
    const dz = v * Math.sqrt(1 - (u * u) / 2);
    const x = lerp(u, dx, k) * ISLAND.halfX;
    const z = lerp(v, dz, k) * ISLAND.halfZ;
    const rho = Math.max(Math.abs(u), Math.abs(v));
    const th = Math.atan2(z, x);
    const c = Math.cos(th);
    const s = Math.sin(th);
    const wobble = 1 + (noise.noise2(c * 1.15 + 5.2, s * 1.15 - 3.1) * 0.04 + noise.noise2(c * 2.7 - 1.7, s * 2.7 + 8.4) * 0.016) * rho * rho * rho;
    out[0] = x * wobble;
    out[1] = z * wobble;
    return out;
  }

  const BORDER_N = 2048;
  const borderR = new Float32Array(BORDER_N).fill(-1);
  {
    const tmp = [0, 0];
    const steps = 16384;
    for (let i = 0; i < steps; i++) {
      const p = (i / steps) * 4;
      const side = Math.floor(p);
      const f = (p - side) * 2 - 1;
      const u = side === 0 ? f : side === 1 ? 1 : side === 2 ? -f : -1;
      const v = side === 0 ? -1 : side === 1 ? f : side === 2 ? 1 : -f;
      mapUV(u, v, tmp);
      const th = Math.atan2(tmp[1], tmp[0]);
      const idx = Math.floor(((th + Math.PI) / TAU) * BORDER_N) % BORDER_N;
      borderR[idx] = Math.max(borderR[idx], Math.hypot(tmp[0], tmp[1]));
    }
    for (let i = 0; i < BORDER_N; i++) {
      if (borderR[i] < 0) {
        let j = i;
        while (borderR[j % BORDER_N] < 0) j++;
        borderR[i] = lerp(borderR[(i - 1 + BORDER_N) % BORDER_N], borderR[j % BORDER_N], 1 / (j - i + 1));
      }
    }
  }

  function radiusAt(th) {
    const f = ((th + Math.PI) / TAU) * BORDER_N;
    const i = Math.floor(f);
    const a = borderR[((i % BORDER_N) + BORDER_N) % BORDER_N];
    const b = borderR[(((i + 1) % BORDER_N) + BORDER_N) % BORDER_N];
    return lerp(a, b, f - i);
  }

  // Metres from the rim, measured along the ray from the island's centre
  // (positive inside).
  function edge(x, z) {
    return radiusAt(Math.atan2(z, x)) - Math.hypot(x, z);
  }

  // ---------- Lines across the lawn ----------
  const pathPts = new THREE.CatmullRomCurve3(YARD.path.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal').getPoints(80);

  function pathDistance(x, z) {
    let best = Infinity;
    for (let i = 0; i < pathPts.length - 1; i++) {
      const a = pathPts[i];
      const b = pathPts[i + 1];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const t = saturate(((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez || 1));
      const dx = x - (a.x + ex * t);
      const dz = z - (a.z + ez * t);
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  // Distance outside a rectangle (negative inside)
  const boxDistance = (x, z, [x0, z0, x1, z1]) => {
    const dx = Math.max(x0 - x, 0, x - x1);
    const dz = Math.max(z0 - z, 0, z - z1);
    const outside = Math.hypot(dx, dz);
    return outside > 0 ? outside : Math.max(x0 - x, x - x1, z0 - z, z - z1);
  };
  // How far from the house, the garage and the terrace
  const buildingDistance = (x, z) => Math.min(...FOOTPRINTS.map((f) => boxDistance(x, z, f)));
  const { drive } = YARD;
  // The drive widens a little as it nears the rim
  const driveDistance = (x, z) => boxDistance(x, z, [drive.x0, drive.z0, drive.x1, drive.z1]);

  // ---------- Ground ----------
  function baseHeight(x, z) {
    let h = GROUND.pad + noise.fbm2(x * 0.09 + 11, z * 0.09 - 5, 3) * 0.12 + noise.noise2(x * 0.42 - 3, z * 0.42 + 9) * 0.02;
    for (const k of KNOLLS) {
      const d = Math.hypot(x - k.x, z - k.z) / k.r;
      if (d < 1.6) h += k.h * Math.exp(-d * d * 2.6);
    }
    // The yard round the house is levelled
    const level = 1 - smoothstep(GROUND.padReach[0], GROUND.padReach[1], buildingDistance(x, z));
    return lerp(h, GROUND.pad, level);
  }

  function computeHeight(x, z) {
    let h = baseHeight(x, z);
    // A path and a drive sit a touch lower than the grass around them
    const pd = pathDistance(x, z);
    if (pd < 1) h -= 0.035 * (1 - smoothstep(0.25, 0.75, pd));
    const dd = driveDistance(x, z);
    if (dd < 0.6) h = lerp(h, GROUND.pad - 0.02, 1 - smoothstep(0, 0.6, dd));
    // The turf rolls off at the rim
    const e = edge(x, z);
    const lip = 1 - smoothstep(0, 1.25, e);
    h -= 0.3 * lip * lip;
    return h;
  }

  // Bake the map once; everything else reads it with bilinear filtering.
  const minX = -ISLAND.halfX - MARGIN;
  const minZ = -ISLAND.halfZ - MARGIN;
  const nx = Math.ceil((ISLAND.halfX * 2 + MARGIN * 2) / CELL) + 1;
  const nz = Math.ceil((ISLAND.halfZ * 2 + MARGIN * 2) / CELL) + 1;
  const gH = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * CELL;
    for (let i = 0; i < nx; i++) gH[j * nx + i] = computeHeight(minX + i * CELL, z);
  }

  function bilinear(grid, x, z) {
    const fx = clamp((x - minX) / CELL, 0, nx - 1.001);
    const fz = clamp((z - minZ) / CELL, 0, nz - 1.001);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const k = j * nx + i;
    return lerp(lerp(grid[k], grid[k + 1], u), lerp(grid[k + nx], grid[k + nx + 1], u), v);
  }

  const height = (x, z) => bilinear(gH, x, z);

  function normal(x, z, out = new THREE.Vector3()) {
    const d = CELL * 1.5;
    const hx = height(x + d, z) - height(x - d, z);
    const hz = height(x, z + d) - height(x, z - d);
    return out.set(-hx, 2 * d, -hz).normalize();
  }

  function pathMask(x, z) {
    const pd = pathDistance(x, z) + noise.noise2(x * 1.3 + 4, z * 1.3 - 2) * 0.1;
    return 1 - smoothstep(0.32, 0.6, pd);
  }

  // Gravel of the drive, with a ragged edge where the lawn creeps onto it
  function driveMask(x, z) {
    const dd = driveDistance(x, z) + noise.noise2(x * 1.6 - 2, z * 1.6 + 7) * 0.12;
    return 1 - smoothstep(-0.05, 0.22, dd);
  }

  // The worn ring round the house where nothing grows tall: a strip of gravel
  // under the eaves
  function apronMask(x, z) {
    const d = buildingDistance(x, z);
    return 1 - smoothstep(0.35, 0.6, d + noise.noise2(x * 2.1, z * 2.1) * 0.05);
  }

  return {
    noise,
    cell: CELL,
    bounds: { minX, minZ, maxX: minX + (nx - 1) * CELL, maxZ: minZ + (nz - 1) * CELL },
    mapUV,
    radiusAt,
    edge,
    height,
    normal,
    pathMask,
    pathDistance,
    driveMask,
    apronMask,
    buildingDistance,
    // No water on this plot: everywhere is far from a shore, under no level
    shore: () => 99,
    level: () => -10,
    depth: () => -1,
    hillMask: () => 0,
  };
}
