import * as THREE from '../core/three.js';
import { createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { blob, paint, place, merge } from '../core/geo.js';
import { mesh } from './kit.js';
import { PROPS, BRIDGE } from './layout.js';

// Boulders, stepping stones and the stones scattered along the banks.

const LIGHT = new THREE.Vector3(-0.4, 0.84, 0.36).normalize();

export function createRocks(field, kit) {
  const group = new THREE.Group();
  group.name = 'rocks';
  const noise = field.noise;
  const rng = createRng(1907);
  const creek = field.creek;
  const parts = [];
  const obstacles = [];
  const frame = {};

  const cRock = col(palette.rock);
  const cLight = col(palette.rockLight);
  const cDark = col(palette.rockDark);
  const cWarm = col(palette.rockWarm);
  const cMoss = col(palette.moss);
  const cMossLight = col(palette.grassLight);
  const cWet = col(palette.bedDeep);

  // One stone. `top` is how far its crown stands above `base`.
  function stone(x, z, r, { squash = 0.72, base, warm = 0.3, moss = 0.5, detail = 3, yaw = rng.range(0, 6.28), stretch = 1, waterline = null } = {}) {
    const seed = rng.range(0, 90);
    const g = blob(r, detail, noise, { amp: 0.24, freq: 1.25, squashY: squash, seed, flatBottom: true });
    const tone = rng.range(-0.08, 0.08);
    const mossy = moss * rng.range(0.6, 1.2);
    const ground = base ?? field.height(x, z);
    const y = ground + r * squash * 0.36;
    // Placed first, so the painted light agrees with the sun whichever way the
    // stone is turned
    place(g, { x, y, z, ry: yaw, sx: stretch });
    g.computeVertexNormals();
    paint(g, (p, n, i, out) => {
      const up = n.y;
      const lit = saturate((n.dot(LIGHT) + 0.25) / 1.15);
      const grain = noise.noise3(p.x * 2.4 + seed, p.y * 3.4, p.z * 2.4 - seed);
      out.copy(cRock).lerp(cWarm, saturate(warm + grain * 0.35));
      out.lerp(cDark, saturate(0.55 - lit * 0.9 - up * 0.25) * 0.75);
      out.lerp(cLight, Math.pow(lit, 1.6) * 0.72);
      // Strata: faint horizontal bands
      out.lerp(cDark, smoothstep(0.55, 0.9, Math.sin(((p.y - y) * 9) / Math.max(r, 0.3) + grain * 3) * 0.5 + 0.5) * 0.12);
      // Moss gathers on what faces the sky
      const m = smoothstep(0.52, 0.86, up + grain * 0.25 + noise.noise3(p.x * 1.1 - seed, p.y, p.z * 1.1) * 0.3) * mossy;
      out.lerp(cMoss, m * 0.9).lerp(cMossLight, m * lit * 0.35);
      out.offsetHSL(0, 0, tone);
    });
    if (waterline !== null) {
      // Darken what the creek keeps wet
      const colors = g.attributes.color;
      const pos = g.attributes.position;
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const k = 1 - smoothstep(waterline + 0.02, waterline + 0.12, pos.getY(i));
        if (k <= 0) continue;
        c.fromBufferAttribute(colors, i).lerp(cWet, k * 0.42).multiplyScalar(1 - k * 0.14);
        colors.setXYZ(i, c.r, c.g, c.b);
      }
    }
    parts.push(g);
    return { x, z, y, top: y + r * squash * 0.98, r };
  }

  const inWater = (s, level) => {
    obstacles.push({ x: s.x, z: s.z, rx: s.r * 0.9, rz: s.r * 0.9, top: s.top - 0.02, dome: Math.max(0.06, s.top - level + 0.12) });
  };

  // ---------- The spring: a ring of stones the creek wells up between ----------
  {
    field.creekAt(0, frame);
    const level = creek.level[0];
    const ring = [
      [-0.95, 0.0, 0.78],
      [-0.6, 0.85, 0.56],
      [-0.55, -0.85, 0.6],
      [0.15, 1.0, 0.38],
      [0.2, -1.05, 0.42],
      [-1.5, 0.5, 0.5],
      [-1.35, -0.7, 0.44],
    ];
    for (const [a, l, r] of ring) {
      const x = frame.x + frame.tx * a + frame.nx * l;
      const z = frame.z + frame.tz * a + frame.nz * l;
      const s = stone(x, z, r, { squash: 0.8, moss: 0.75, warm: 0.2, waterline: level });
      if (field.shore(x, z) < 0.25) inWater(s, level);
    }
  }

  // ---------- The upper fall: boulders that shoulder the water over the lip ----------
  {
    const lipS = creek.lipIndex * creek.ds;
    const footS = (creek.footIndex + 1) * creek.ds;
    const set = [
      // along (m from the lip), across (m from the bank, + is away from the water), radius, squash
      [-0.25, 0.42, 1.0, 0.86, 1],
      [-0.2, 0.36, 0.92, 0.9, -1],
      [0.45, 0.62, 0.78, 0.8, 1],
      [0.42, 0.56, 0.74, 0.84, -1],
      [-1.05, 0.5, 0.6, 0.74, 1],
      [-1.0, 0.44, 0.52, 0.7, -1],
      [1.0, 0.5, 0.52, 0.66, 1],
      [1.05, 0.42, 0.58, 0.7, -1],
      [1.75, 0.3, 0.34, 0.6, 1],
      [1.9, 0.36, 0.4, 0.62, -1],
      [-1.9, 0.5, 0.42, 0.7, -1],
    ];
    for (const [along, out, r, squash, side] of set) {
      field.creekAt(lipS + along, frame);
      const lat = side * (frame.w + out + r * 0.25);
      const x = frame.x + frame.nx * lat;
      const z = frame.z + frame.nz * lat;
      const level = field.level(x, z);
      const s = stone(x, z, r, { squash, moss: 0.85, warm: 0.15, waterline: along > 0.6 ? level : null });
      if (field.shore(x, z) < r * 0.6) inWater(s, level);
    }
    // Two stones in the plunge pool that the falling water breaks on
    for (const [along, lat, r] of [
      [0.55, 0.42, 0.3],
      [0.8, -0.5, 0.26],
    ]) {
      field.creekAt(footS + along, frame);
      const x = frame.x + frame.nx * lat;
      const z = frame.z + frame.nz * lat;
      const s = stone(x, z, r, { squash: 0.7, base: -0.06, moss: 0.3, waterline: 0 });
      inWater(s, 0);
    }
  }

  // ---------- Stepping stones ----------
  const stepping = [];
  {
    const s0 = field.creekS(6);
    const rows = [
      [-1.5, 0.12, 0.4],
      [-0.86, -0.1, 0.44],
      [-0.2, 0.1, 0.42],
      [0.48, -0.08, 0.45],
      [1.14, 0.14, 0.41],
      [1.78, -0.04, 0.38],
    ];
    for (const [lat, along, r] of rows) {
      field.creekAt(s0 + along, frame);
      const x = frame.x + frame.nx * lat;
      const z = frame.z + frame.nz * lat;
      // Flat-topped and just clear of the water
      const top = 0.085 + rng.range(-0.012, 0.02);
      const squash = 0.34;
      const s = stone(x, z, r, { squash, base: top - r * squash * 1.3, moss: 0.22, warm: 0.5, stretch: rng.range(1.0, 1.22), waterline: 0 });
      inWater(s, 0);
      stepping.push(new THREE.Vector3(x, s.top, z));
    }
  }

  // ---------- Rapids: stones the fast water runs white around ----------
  {
    for (let i = creek.rimIndex - 62; i < creek.rimIndex - 4; i += rng.int(5, 8)) {
      field.creekAt(i * creek.ds, frame);
      const lat = rng.range(-0.72, 0.72) * frame.w;
      const r = rng.range(0.2, 0.42);
      const x = frame.x + frame.nx * lat;
      const z = frame.z + frame.nz * lat;
      const level = creek.level[i];
      const s = stone(x, z, r, { squash: 0.66, base: level - r * 0.34, moss: 0.25, warm: 0.35, waterline: level });
      inWater(s, level);
    }
  }

  // ---------- Along the banks ----------
  {
    const keepClear = [
      [PROPS.beach.x, PROPS.beach.z, 2.4],
      [BRIDGE.from[0], BRIDGE.from[1], 1.5],
      [BRIDGE.to[0], BRIDGE.to[1], 1.5],
      [stepping[0].x, stepping[0].z, 1.1],
      [stepping[stepping.length - 1].x, stepping[stepping.length - 1].z, 1.1],
      [PROPS.stork.x, PROPS.stork.z, 0.9],
    ];
    let placed = 0;
    for (let tries = 0; tries < 400 && placed < 46; tries++) {
      const i = rng.int(4, creek.rimIndex - 3);
      if (i > creek.lipIndex - 14 && i < creek.footIndex + 22) continue;
      field.creekAt(i * creek.ds, frame);
      const side = rng.sign();
      const r = Math.pow(rng(), 2.2) * 0.4 + 0.11;
      const lat = side * (frame.w + rng.range(-0.3, 0.55));
      const x = frame.x + frame.nx * lat;
      const z = frame.z + frame.nz * lat;
      if (keepClear.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr)) continue;
      if (field.edge(x, z) < 0.8 || field.pathMask(x, z) > 0.2) continue;
      const level = field.level(x, z);
      const wet = field.shore(x, z) < r * 0.5;
      const s = stone(x, z, r, { squash: rng.range(0.56, 0.74), moss: wet ? 0.25 : 0.6, warm: 0.45, detail: r > 0.24 ? 3 : 2, waterline: wet ? level : null });
      if (wet) inWater(s, level);
      placed++;
    }
  }

  // ---------- Outcrops on the hill and a few loners in the meadow ----------
  {
    const spots = [
      [-12.6, -6.0, 0.95],
      [-10.4, -7.9, 0.8],
      [-9.0, -6.9, 0.62],
      [-13.3, -8.6, 0.7],
      [-6.6, -6.2, 0.74],
      [-9.9, -3.6, 0.66],
      [-11.6, -4.3, 0.5],
      [-5.9, -5.2, 0.42],
      [-8.6, -2.5, 0.4],
      [12.9, 7.4, 0.5],
      [-12.6, 6.4, 0.46],
      [5.2, -8.4, 0.52],
      [1.4, 7.6, 0.26],
      [-14.2, -1.2, 0.44],
    ];
    for (const [x, z, r] of spots) {
      stone(x, z, r, { squash: rng.range(0.66, 0.82), moss: 0.8, warm: 0.2 });
      // A smaller companion makes it a group rather than a lump
      if (r > 0.45) stone(x + rng.range(0.5, 0.9) * rng.sign() * r * 1.6, z + rng.range(0.3, 0.8) * r * 1.5, r * rng.range(0.34, 0.5), { squash: 0.7, moss: 0.7, detail: 2 });
    }
  }

  const rocks = mesh(merge(parts), kit.rock, { name: 'rocks' });
  group.add(rocks);

  return { group, obstacles, stepping };
}
