import * as THREE from '../core/three.js';
import { TAU, clamp, lerp, saturate, smoothstep, smin, createNoise } from '../core/math.js';
import { ISLAND, CREEK, FALL_LIP, HILL, KNOLLS, PATH } from './layout.js';

// The field is the island as numbers: where the rim is, how high the ground
// stands, where the creek runs and how deep it is. Meshes, plants, animals and
// hotspots all ask the field instead of guessing.

const CELL = 0.1; // grid spacing for the baked height / shore maps
const DS = 0.1; // spacing of creek samples along the stream
const COARSE = 8;
const MARGIN = 1.2;

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
    const wobble =
      1 +
      (noise.noise2(c * 1.15 + 5.2, s * 1.15 - 3.1) * 0.055 + noise.noise2(c * 2.7 - 1.7, s * 2.7 + 8.4) * 0.022) *
        rho * rho * rho;
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

  // ---------- Creek ----------
  const creek = buildCreek();

  function buildCreek() {
    const pts = CREEK.map((c) => new THREE.Vector3(c.x, 0, c.z));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const segments = pts.length - 1;
    const DENSE = 4000;
    const dense = new Float32Array((DENSE + 1) * 4);
    const p = new THREE.Vector3();
    let len = 0;
    let px = 0;
    let pz = 0;

    for (let i = 0; i <= DENSE; i++) {
      const t = i / DENSE;
      curve.getPoint(t, p);
      if (i > 0) len += Math.hypot(p.x - px, p.z - pz);
      dense.set([p.x, p.z, len, t * segments], i * 4);
      px = p.x;
      pz = p.z;
    }

    const total = len;
    const n = Math.floor(total / DS) + 1;
    const c = {
      n,
      total,
      ds: DS,
      x: new Float32Array(n),
      z: new Float32Array(n),
      tx: new Float32Array(n),
      tz: new Float32Array(n),
      cu: new Float32Array(n),
      w: new Float32Array(n),
      level: new Float32Array(n),
      bed: new Float32Array(n),
      near: new Float32Array(n),
      far: new Float32Array(n),
      fall: new Float32Array(n),
      turb: new Float32Array(n),
      speed: new Float32Array(n),
      rimIndex: n - 1,
      lipIndex: 0,
      footIndex: 0,
    };

    const attr = (key, cu) => {
      const i = Math.min(Math.floor(cu), segments - 1);
      const f = cu - i;
      return lerp(CREEK[i][key], CREEK[i + 1][key], f * f * (3 - 2 * f));
    };

    let j = 0;
    for (let i = 0; i < n; i++) {
      const target = i * DS;
      while (j < DENSE - 1 && dense[(j + 1) * 4 + 2] < target) j++;
      const l0 = dense[j * 4 + 2];
      const l1 = dense[(j + 1) * 4 + 2];
      const f = l1 > l0 ? saturate((target - l0) / (l1 - l0)) : 0;
      c.x[i] = lerp(dense[j * 4], dense[(j + 1) * 4], f);
      c.z[i] = lerp(dense[j * 4 + 1], dense[(j + 1) * 4 + 1], f);
      const cu = lerp(dense[j * 4 + 3], dense[(j + 1) * 4 + 3], f);
      c.cu[i] = cu;
      c.w[i] = attr('w', cu);
      c.bed[i] = attr('bed', cu);
      c.near[i] = attr('near', cu);
      c.far[i] = attr('far', cu);

      // The water holds its level up to the lip, then drops in a short curtain.
      const seg = Math.min(Math.floor(cu), segments - 1);
      if (seg === FALL_LIP) {
        const drop = Math.pow(saturate((cu - seg - 0.1) / 0.52), 1.7);
        c.level[i] = lerp(CREEK[seg].level, CREEK[seg + 1].level, drop);
      } else {
        c.level[i] = attr('level', cu);
      }
    }

    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const dx = c.x[b] - c.x[a];
      const dz = c.z[b] - c.z[a];
      const l = Math.hypot(dx, dz) || 1;
      c.tx[i] = dx / l;
      c.tz[i] = dz / l;
      const slope = (c.level[b] - c.level[a]) / ((b - a) * DS);
      c.fall[i] = saturate(-slope / 1.1);
    }

    let turb = 0;
    for (let i = 0; i < n; i++) {
      turb = Math.max(c.fall[i], turb * Math.exp(-DS / 1.5));
      c.turb[i] = turb;
      c.speed[i] = clamp(0.95 / (c.w[i] * (0.4 + c.bed[i])), 0.42, 2.1) + c.fall[i] * 1.6;
      if (c.cu[i] <= FALL_LIP + 0.1) c.lipIndex = i;
      if (c.cu[i] <= FALL_LIP + 0.62) c.footIndex = i;
    }

    for (let i = 0; i < n; i++) {
      if (edge(c.x[i], c.z[i]) < 0) {
        c.rimIndex = i;
        break;
      }
    }

    return c;
  }

  const _q = { dist: 0, lat: 0, side: 1, fi: 0, w: 0, level: 0, bed: 0, slope: 0, fall: 0, turb: 0, speed: 0 };

  // Nearest point on the centreline, with everything known about the stream there.
  function query(x, z, out = _q) {
    const c = creek;
    let best = Infinity;
    let bi = 0;

    for (let i = 0; i < c.n; i += COARSE) {
      const dx = x - c.x[i];
      const dz = z - c.z[i];
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    const lo = Math.max(0, bi - COARSE);
    const hi = Math.min(c.n - 1, bi + COARSE);
    for (let i = lo; i <= hi; i++) {
      const dx = x - c.x[i];
      const dz = z - c.z[i];
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bi = i;
      }
    }

    // Slide along the two neighbouring segments for a continuous answer
    let fi = bi;
    let bestD = best;
    let cx = c.x[bi];
    let cz = c.z[bi];
    for (let k = -1; k <= 0; k++) {
      const a = bi + k;
      const b = a + 1;
      if (a < 0 || b >= c.n) continue;
      const ex = c.x[b] - c.x[a];
      const ez = c.z[b] - c.z[a];
      const t = saturate(((x - c.x[a]) * ex + (z - c.z[a]) * ez) / (ex * ex + ez * ez || 1));
      const qx = c.x[a] + ex * t;
      const qz = c.z[a] + ez * t;
      const d = (x - qx) * (x - qx) + (z - qz) * (z - qz);
      if (d <= bestD) {
        bestD = d;
        fi = a + t;
        cx = qx;
        cz = qz;
      }
    }

    const i0 = Math.min(Math.floor(fi), c.n - 2);
    const f = fi - i0;
    const tx = lerp(c.tx[i0], c.tx[i0 + 1], f);
    const tz = lerp(c.tz[i0], c.tz[i0 + 1], f);
    // Left-hand normal: positive on the near bank (towards the default camera)
    const lat = (x - cx) * -tz + (z - cz) * tx;

    out.dist = Math.sqrt(bestD);
    out.lat = lat;
    out.side = lat >= 0 ? 1 : -1;
    out.fi = fi;
    out.w = lerp(c.w[i0], c.w[i0 + 1], f);
    out.level = lerp(c.level[i0], c.level[i0 + 1], f);
    out.bed = lerp(c.bed[i0], c.bed[i0 + 1], f);
    out.slope = lat >= 0 ? lerp(c.near[i0], c.near[i0 + 1], f) : lerp(c.far[i0], c.far[i0 + 1], f);
    out.fall = lerp(c.fall[i0], c.fall[i0 + 1], f);
    out.turb = lerp(c.turb[i0], c.turb[i0 + 1], f);
    out.speed = lerp(c.speed[i0], c.speed[i0 + 1], f);
    return out;
  }

  // Frame of the stream at arc length s (metres from the spring).
  function creekAt(s, out = {}) {
    const c = creek;
    const fi = clamp(s / DS, 0, c.n - 1.001);
    const i0 = Math.floor(fi);
    const f = fi - i0;
    out.x = lerp(c.x[i0], c.x[i0 + 1], f);
    out.z = lerp(c.z[i0], c.z[i0 + 1], f);
    out.tx = lerp(c.tx[i0], c.tx[i0 + 1], f);
    out.tz = lerp(c.tz[i0], c.tz[i0 + 1], f);
    out.nx = -out.tz;
    out.nz = out.tx;
    out.w = lerp(c.w[i0], c.w[i0 + 1], f);
    out.level = lerp(c.level[i0], c.level[i0 + 1], f);
    out.speed = lerp(c.speed[i0], c.speed[i0 + 1], f);
    return out;
  }

  // Arc length of the creek sample nearest to a control point.
  function creekS(controlIndex) {
    const c = creek;
    for (let i = 0; i < c.n; i++) if (c.cu[i] >= controlIndex) return i * DS;
    return c.total;
  }

  // ---------- Path ----------
  const pathPts = new THREE.CatmullRomCurve3(PATH.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal').getPoints(90);

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

  // ---------- Ground ----------
  function hillMask(x, z) {
    const [ax, az] = HILL.from;
    const [bx, bz] = HILL.to;
    const ex = bx - ax;
    const ez = bz - az;
    const t = saturate(((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez));
    const d = Math.hypot(x - (ax + ex * t), z - (az + ez * t)) + noise.noise2(x * 0.33 + 3.1, z * 0.33 - 7.7) * 0.6;
    return smoothstep(HILL.outer, HILL.inner, d);
  }

  function baseHeight(x, z) {
    let h = 0.36 + noise.fbm2(x * 0.1 + 11, z * 0.1 - 5, 3) * 0.2 + noise.noise2(x * 0.42 - 3, z * 0.42 + 9) * 0.035;
    const hill = hillMask(x, z);
    h += hill * HILL.height * (0.9 + 0.1 * noise.noise2(x * 0.5 + 1.7, z * 0.5 + 4.2));
    h += hill * noise.fbm2(x * 0.6 - 2, z * 0.6 + 6, 2) * 0.16;
    for (const k of KNOLLS) {
      const d = Math.hypot(x - k.x, z - k.z) / k.r;
      if (d < 1.6) h += k.h * Math.exp(-d * d * 2.6);
    }
    return h;
  }

  function computeCell(x, z, out) {
    const q = query(x, z);
    const base = baseHeight(x, z);
    let channel;

    if (q.dist < q.w) {
      // Under water: a flat bed that eases up to the shoreline. Gentle banks
      // (beaches) keep a wider shallow shelf.
      const t = q.dist / q.w;
      const softness = lerp(1.9, 0.95, saturate((q.slope - 0.13) / 0.5));
      channel = q.level - q.bed * Math.pow(1 - smoothstep(0.18, 1, t), softness);
    } else {
      const r = q.dist - q.w;
      channel = q.level + q.slope * r * (0.5 + 0.5 * smoothstep(0, 1.0, r));
    }

    let h = smin(base, channel, 0.28);
    const shore = q.dist - q.w;

    // A trodden path sits a touch lower than the grass around it
    if (shore > 0.3) {
      const pd = pathDistance(x, z);
      if (pd < 1) h -= 0.04 * (1 - smoothstep(0.2, 0.8, pd));
    }

    // Pebbly bed and bank
    if (shore < 0.6) h += noise.noise2(x * 2.6 + 1.3, z * 2.6 - 4.4) * 0.022 * (1 - smoothstep(0.1, 0.6, shore));

    // The turf rolls off at the rim
    const e = edge(x, z);
    const lip = 1 - smoothstep(0, 1.25, e);
    h -= 0.3 * lip * lip;

    out.h = h;
    out.shore = shore;
    out.level = q.level;
    out.fi = q.fi;
  }

  // Bake the maps once; everything else reads them with bilinear filtering.
  const minX = -ISLAND.halfX - MARGIN;
  const minZ = -ISLAND.halfZ - MARGIN;
  const nx = Math.ceil((ISLAND.halfX * 2 + MARGIN * 2) / CELL) + 1;
  const nz = Math.ceil((ISLAND.halfZ * 2 + MARGIN * 2) / CELL) + 1;
  const gH = new Float32Array(nx * nz);
  const gShore = new Float32Array(nx * nz);
  const gLevel = new Float32Array(nx * nz);
  const gFi = new Float32Array(nx * nz);
  {
    const cell = { h: 0, shore: 0, level: 0, fi: 0 };
    for (let j = 0; j < nz; j++) {
      const z = minZ + j * CELL;
      for (let i = 0; i < nx; i++) {
        computeCell(minX + i * CELL, z, cell);
        const k = j * nx + i;
        gH[k] = cell.h;
        gShore[k] = cell.shore;
        gLevel[k] = cell.level;
        gFi[k] = cell.fi;
      }
    }
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
  // Metres from the waterline: negative in the water, positive on land.
  const shore = (x, z) => bilinear(gShore, x, z);
  const level = (x, z) => bilinear(gLevel, x, z);
  // Depth of water over the bed (positive where there is water to stand in).
  const depth = (x, z) => {
    const s = bilinear(gShore, x, z);
    return s < 0.6 ? bilinear(gLevel, x, z) - bilinear(gH, x, z) : -1;
  };
  const streamIndex = (x, z) => bilinear(gFi, x, z);

  function normal(x, z, out = new THREE.Vector3()) {
    const d = CELL * 1.5;
    const hx = height(x + d, z) - height(x - d, z);
    const hz = height(x, z + d) - height(x, z - d);
    return out.set(-hx, 2 * d, -hz).normalize();
  }

  function pathMask(x, z) {
    const pd = pathDistance(x, z) + noise.noise2(x * 1.3 + 4, z * 1.3 - 2) * 0.12;
    return 1 - smoothstep(0.26, 0.62, pd);
  }

  return {
    noise,
    cell: CELL,
    bounds: { minX, minZ, maxX: minX + (nx - 1) * CELL, maxZ: minZ + (nz - 1) * CELL },
    mapUV,
    radiusAt,
    edge,
    creek,
    creekAt,
    creekS,
    query,
    height,
    shore,
    level,
    depth,
    streamIndex,
    normal,
    hillMask,
    pathMask,
    pathDistance,
  };
}
