import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { blob, tube, curvePoints, lathe, roundedBox, icoSphere, place, paint, displace, setSway, merge } from '../core/geo.js';
import { mesh, part, grainUv, tubeGrain } from './kit.js';
import { TREES } from './layout.js';

// The trees and bushes. Each crown is a few soft lumps dressed in painted leaf
// cards; the cards borrow their normals from the crown's overall shape, so a
// whole tree shades like one rounded form.

const LIGHT = new THREE.Vector3(-0.45, 0.82, 0.36).normalize();
const UP = new THREE.Vector3(0, 1, 0);
const X = new THREE.Vector3(1, 0, 0);

const _f = new THREE.Vector3();
const _u = new THREE.Vector3();
const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

// Collects leaf cards into one geometry.
function cardBatch() {
  const position = [];
  const normal = [];
  const uv = [];
  const color = [];
  const sway = [];
  const index = [];

  // A cupped square card. `up` fixes which way the top of the sprite points.
  function add(centre, facing, size, tint, shadeNormal, swayAmount, { roll = 0, up = null, cup = 0.16, aspect = 1, tipTint = null, swayTip = null } = {}) {
    _f.copy(facing).normalize();
    if (up) {
      _u.crossVectors(up, _f);
      if (_u.lengthSq() < 1e-6) _u.crossVectors(X, _f);
      _u.normalize();
    } else {
      _u.crossVectors(Math.abs(_f.y) > 0.95 ? X : UP, _f).normalize();
    }
    _v.crossVectors(_f, _u);
    if (roll) {
      const c = Math.cos(roll);
      const s = Math.sin(roll);
      _a.copy(_u).multiplyScalar(c).addScaledVector(_v, s);
      _b.copy(_v).multiplyScalar(c).addScaledVector(_u, -s);
      _u.copy(_a);
      _v.copy(_b);
    }
    const base = position.length / 3;
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 3; i++) {
        const a = i - 1;
        const b = j - 1;
        const bulge = cup * size * (1 - (a * a + b * b) / 2);
        _p.copy(centre)
          .addScaledVector(_u, a * size * 0.5 * aspect)
          .addScaledVector(_v, b * size * 0.5)
          .addScaledVector(_f, bulge);
        position.push(_p.x, _p.y, _p.z);
        normal.push(shadeNormal.x, shadeNormal.y, shadeNormal.z);
        uv.push(i / 2, j / 2);
        const k = j / 2;
        if (tipTint) color.push(lerp(tipTint.r, tint.r, k), lerp(tipTint.g, tint.g, k), lerp(tipTint.b, tint.b, k));
        else color.push(tint.r, tint.g, tint.b);
        sway.push(swayTip === null ? swayAmount : lerp(swayTip, swayAmount, k));
      }
    }
    for (let j = 0; j < 2; j++) {
      for (let i = 0; i < 2; i++) {
        const a = base + j * 3 + i;
        index.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
      }
    }
  }

  function build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(sway, 1));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }

  return { add, build, get count() { return index.length / 24; } };
}

export function createTrees(field, kit, textures, quality) {
  const group = new THREE.Group();
  group.name = 'trees';
  const noise = field.noise;
  const rng = createRng(2024);

  const oakCards = cardBatch();
  const birchCards = cardBatch();
  const sprigCards = cardBatch();
  const strandCards = cardBatch();
  const crowns = []; // soft bodies behind the cards
  const barks = [];
  const birchTrunks = [];
  const solids = [];
  const anchors = {};

  const randomDirection = (out, upBias = 0) => {
    out.set(rng.gauss(), rng.gauss() + upBias, rng.gauss());
    if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
    return out.normalize();
  };

  // ---------- Crown: lumps and the cards that dress them ----------
  function crown(clumps, centre, batch, colours, { cardSize = 1, density = 60, swayBase = 0.05, swayTop = 0.16, bodyScale = 0.7, upBias = 0.25, droop = 0 } = {}) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const c of clumps) {
      lo = Math.min(lo, c.y - c.r);
      hi = Math.max(hi, c.y + c.r);
    }
    const dir = new THREE.Vector3();
    const point = new THREE.Vector3();
    const shade = new THREE.Vector3();
    const facing = new THREE.Vector3();
    const tint = new THREE.Color();

    const tintFor = (n, y, jitter) => {
      const height = saturate((y - lo) / (hi - lo || 1));
      const lit = saturate((n.dot(LIGHT) + 0.35) / 1.2);
      tint.copy(colours.dark).lerp(colours.mid, saturate(height * 0.7 + lit * 0.55));
      tint.lerp(colours.light, saturate(lit * lit * 0.95 + height * 0.2 - 0.12));
      tint.offsetHSL(jitter * 0.018, jitter * 0.05, jitter * 0.045);
      return tint;
    };

    for (const c of clumps) {
      // Each lump has its own slight shift in tone, so the masses separate
      const mood = rng.range(-1, 1);
      // The body: darker than the leaves, so gaps between cards read as depth
      const body = blob(c.r * bodyScale, 2, noise, { amp: 0.2, freq: 1.3, seed: rng.range(0, 60), squashY: c.squash ?? 0.92 });
      place(body, { x: c.x, y: c.y, z: c.z });
      body.computeVertexNormals();
      paint(body, (p, n, i, out) => {
        shade.copy(p).sub(centre).normalize();
        out.copy(tintFor(shade, p.y, mood * 0.5)).lerp(colours.dark, 0.62).multiplyScalar(0.8);
      });
      // The crown's own shape lights the body too
      const bn = body.attributes.normal;
      const bp = body.attributes.position;
      for (let i = 0; i < bp.count; i++) {
        shade.fromBufferAttribute(bp, i).sub(centre).normalize().lerp(_a.fromBufferAttribute(bn, i), 0.45).normalize();
        bn.setXYZ(i, shade.x, shade.y, shade.z);
      }
      setSway(body, (p) => lerp(swayBase, swayTop, saturate((p.y - lo) / (hi - lo || 1))) * 0.8);
      crowns.push(body);

      const count = Math.round(c.r * c.r * density * quality.foliage);
      for (let k = 0; k < count; k++) {
        randomDirection(dir, upBias);
        point.set(c.x + dir.x * c.r, c.y + dir.y * c.r * (c.squash ?? 0.92), c.z + dir.z * c.r);
        // Skip leaves buried in a neighbouring lump
        let buried = false;
        for (const o of clumps) {
          if (o === c) continue;
          if (_a.set(point.x - o.x, point.y - o.y, point.z - o.z).length() < o.r * 0.78) {
            buried = true;
            break;
          }
        }
        if (buried) continue;
        shade.copy(point).sub(centre).normalize().lerp(dir, 0.42).normalize();
        facing.copy(dir).addScaledVector(randomDirection(_b), 0.75).normalize();
        const jitter = mood * 0.55 + rng.range(-0.6, 0.6);
        const height = saturate((point.y - lo) / (hi - lo || 1));
        const size = cardSize * rng.range(0.74, 1.2);
        point.addScaledVector(dir, size * rng.range(-0.1, 0.14));
        if (droop && dir.y < 0.1) point.y -= rng.range(0, droop);
        batch.add(point, facing, size, tintFor(shade, point.y, jitter), shade, lerp(swayBase, swayTop, height) * rng.range(0.8, 1.25), { roll: rng.range(0, TAU) });
      }
    }
  }

  const colours = (dark, mid, light) => ({ dark: col(dark).clone(), mid: col(mid).clone(), light: col(light).clone() });
  const oakColours = colours(palette.oakDark, palette.oakMid, palette.oakLight);
  const birchColours = colours(palette.birchLeafDark, palette.birchLeafMid, palette.birchLeafLight);
  const bushColours = colours(palette.bushDark, palette.bushMid, palette.bushLight);
  const willowColours = colours(palette.willowDark, palette.willowMid, palette.willowLight);

  // ---------- Limbs ----------
  function limb(points, r0, r1, { radial = 8, target = barks, dark = palette.barkDark, lightCol = palette.barkOak, flare = 0, samples = 14, cap = true } = {}) {
    const pts = curvePoints(points, samples);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
    const g = tube(pts, (t) => lerp(r0, r1, Math.pow(t, 0.85)) + flare * Math.exp(-t * 10), { radial, capStart: false, capEnd: cap });
    tubeGrain(g, length, 0.42, rng.range(0, 1));
    const a = col(dark);
    const b = col(lightCol);
    const c = new THREE.Color();
    const seed = rng.range(0, 40);
    paint(g, (p, n, i, out) => {
      const lit = saturate((n.dot(LIGHT) + 0.3) / 1.2);
      const blotch = noise.noise3(p.x * 1.6 + seed, p.y * 0.9, p.z * 1.6);
      out.copy(a).lerp(b, saturate(lit * 0.9 + blotch * 0.25));
      // A little moss on the weather side
      c.copy(col(palette.moss));
      out.lerp(c, smoothstep(0.35, 0.8, -n.x * 0.6 + n.y * 0.5 + blotch * 0.4) * 0.28);
    });
    target.push(g);
    return pts;
  }

  // ---------- The oak ----------
  {
    const { x, z } = TREES.oak;
    const y = field.height(x, z) - 0.08;
    const S = 0.9;
    const at = (lx, ly, lz) => new THREE.Vector3(x + lx * S, y + ly * S, z + lz * S);

    // Trunk with a root flare, and toes gripping the knoll
    limb([at(0, 0, 0), at(0.06, 1.2, 0.02), at(-0.08, 2.3, 0.06), at(0, 3.2, 0)], 0.5 * S, 0.34 * S, { radial: 12, flare: 0.34 * S, samples: 16, cap: false });
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + rng.range(-0.3, 0.3);
      const reach = rng.range(0.95, 1.4);
      limb([at(Math.cos(a) * 0.2, 0.55, Math.sin(a) * 0.2), at(Math.cos(a) * 0.62, 0.2, Math.sin(a) * 0.62), at(Math.cos(a) * reach, -0.12, Math.sin(a) * reach)], 0.2 * S, 0.07 * S, { radial: 6, samples: 8 });
    }

    const limbs = [
      [[0, 2.45, 0], [1.25, 3.05, 0.5], [2.6, 3.42, 1.05], [3.7, 4.0, 1.5]], // carries the swing
      [[0, 2.7, 0], [-1.2, 3.6, 0.2], [-2.4, 4.3, 0.5], [-3.3, 4.7, 0.7]],
      [[0, 2.9, 0], [0.3, 3.9, -1.1], [0.6, 4.7, -2.3]],
      [[0, 3.1, 0], [-0.2, 4.3, 0.3], [0.1, 5.5, 0.4]],
      [[0, 2.6, 0], [-0.9, 3.3, 1.2], [-1.7, 3.9, 2.3]],
      [[0, 2.8, 0], [1.3, 3.9, -0.6], [2.5, 4.4, -1.5]],
    ];
    const swingLimb = [];
    limbs.forEach((path, i) => {
      const pts = limb(path.map((p) => at(...p)), (i === 0 ? 0.25 : 0.21) * S, 0.07 * S, { radial: 8 });
      if (i === 0) swingLimb.push(...pts);
    });

    const clumps = [
      [3.3, 4.7, 1.5, 1.75],
      [-3.0, 5.1, 0.8, 1.85],
      [0.6, 5.4, -2.2, 1.8],
      [0.0, 6.4, 0.3, 2.0],
      [-1.6, 4.6, 2.3, 1.6],
      [1.7, 5.7, -0.4, 1.7],
      [-1.5, 5.9, -1.2, 1.7],
      [1.3, 4.8, 2.3, 1.45],
      [-3.7, 4.1, -0.9, 1.3],
      [2.7, 4.2, -1.5, 1.35],
      [-0.3, 5.0, 1.2, 1.5],
    ].map(([cx, cy, cz, r]) => {
      const p = at(cx, cy, cz);
      return { x: p.x, y: p.y, z: p.z, r: r * S };
    });
    crown(clumps, at(0, 4.3, 0.2), oakCards, oakColours, { cardSize: 1.02 * S, density: 64, swayBase: 0.03, swayTop: 0.13, bodyScale: 0.72 });

    anchors.oak = at(0, 3.0, 0);
    anchors.oakTop = at(0, 8.5, 0.3);
    // Where the swing hangs: a point two thirds of the way along its limb
    const hang = swingLimb[Math.round(swingLimb.length * 0.6)];
    anchors.swing = { point: hang.clone(), limbRadius: 0.16 * S, yaw: Math.atan2(-(swingLimb[10].z - swingLimb[6].z), swingLimb[10].x - swingLimb[6].x) };
  }

  // ---------- Birches ----------
  anchors.birches = [];
  TREES.birches.forEach((b, bi) => {
    const y = field.height(b.x, b.z) - 0.06;
    const h = b.h;
    const lean = b.lean * h;
    const bend = rng.range(-0.25, 0.25);
    const path = [
      new THREE.Vector3(b.x, y, b.z),
      new THREE.Vector3(b.x + lean * 0.22, y + h * 0.3, b.z + bend * 0.3),
      new THREE.Vector3(b.x + lean * 0.62, y + h * 0.64, b.z + bend * 0.8),
      new THREE.Vector3(b.x + lean, y + h * 0.97, b.z + bend),
    ];
    const pts = curvePoints(path, 18);
    const g = tube(pts, (t) => lerp(0.165, 0.03, Math.pow(t, 0.8)) + 0.07 * Math.exp(-t * 14), { radial: 9, capStart: false });
    const uvs = g.attributes.uv;
    for (let i = 0; i < uvs.count; i++) uvs.setXY(i, uvs.getX(i) * 6.2832 + bi * 3.1, uvs.getY(i) * h * 4.2);
    const white = col(palette.birch);
    const grey = col(palette.birchShade);
    const foot = col(palette.barkDark);
    paint(g, (p, n, i, out) => {
      const lit = saturate((n.dot(LIGHT) + 0.4) / 1.3);
      out.copy(grey).lerp(white, lit);
      out.lerp(foot, (1 - smoothstep(0.0, 0.55, p.y - y)) * 0.6);
    });
    birchTrunks.push(g);
    anchors.birches.push({ base: path[0].clone(), points: pts, height: h });

    const trunkAt = (t) => {
      const f = saturate(t) * (pts.length - 1);
      const i = Math.min(Math.floor(f), pts.length - 2);
      return pts[i].clone().lerp(pts[i + 1], f - i);
    };

    // Fine dark branches reaching into the crown
    const clumps = [];
    const n = 8 + bi;
    for (let k = 0; k < n; k++) {
      const t = lerp(0.42, 1.02, k / (n - 1));
      const origin = trunkAt(Math.min(t, 0.98));
      const a = k * 2.4 + bi + rng.range(-0.4, 0.4);
      const spread = (1 - Math.pow((t - 0.42) / 0.6, 1.6)) * 1.25 + 0.2;
      const r = lerp(0.95, 0.55, (t - 0.42) / 0.6) * rng.range(0.85, 1.1);
      const cx = origin.x + Math.cos(a) * spread;
      const cz = origin.z + Math.sin(a) * spread;
      const cy = origin.y + rng.range(-0.1, 0.35);
      clumps.push({ x: cx, y: cy, z: cz, r, squash: 1.05 });
      if (k < n - 1) {
        limb([trunkAt(t - 0.08), new THREE.Vector3(lerp(origin.x, cx, 0.5), origin.y - 0.05, lerp(origin.z, cz, 0.5)), new THREE.Vector3(cx, cy - r * 0.3, cz)], 0.04, 0.012, {
          radial: 5,
          samples: 6,
          dark: palette.birchMark,
          lightCol: palette.barkDark,
        });
      }
    }
    crown(clumps, trunkAt(0.72), birchCards, birchColours, { cardSize: 0.8, density: 82, swayBase: 0.06, swayTop: 0.22, bodyScale: 0.5, upBias: 0.1, droop: 0.5 });
  });

  // ---------- Spruces ----------
  anchors.spruces = [];
  {
    const dark = col(palette.spruceDark);
    const mid = col(palette.spruceMid);
    const light = col(palette.spruceLight);
    const tint = new THREE.Color();
    const centre = new THREE.Vector3();
    const facing = new THREE.Vector3();
    const up = new THREE.Vector3();
    const shade = new THREE.Vector3();

    for (const s of TREES.spruces) {
      const y = field.height(s.x, s.z) - 0.05;
      const h = s.h;
      const R = h * 0.29;
      limb([new THREE.Vector3(s.x, y, s.z), new THREE.Vector3(s.x, y + h * 0.4, s.z)], 0.17, 0.1, { radial: 7, samples: 4, dark: palette.barkDark, lightCol: palette.barkOak, flare: 0.08 });

      const tiers = 6;
      const turn = rng.range(0, TAU);
      for (let i = 0; i < tiers; i++) {
        const k = i / (tiers - 1);
        const y0 = y + h * (0.13 + 0.135 * i);
        const r = R * Math.pow(1 - k * 0.86, 0.95);
        const th = h * 0.27 * (1 - k * 0.32);
        const g = lathe(
          [
            [r * 0.55, y0 - th * 0.06],
            [r, y0],
            [r * 0.72, y0 + th * 0.26],
            [r * 0.4, y0 + th * 0.62],
            [0.03, y0 + th],
          ],
          16
        );
        // Scalloped, slightly drooping skirts
        displace(g, (p) => {
          const a = Math.atan2(p.z, p.x);
          const edge = saturate(Math.hypot(p.x, p.z) / r);
          const scallop = Math.sin(a * 7 + i * 1.7 + turn) * 0.5 + 0.5;
          const rr = 1 + (scallop * 0.16 - 0.05) * edge + noise.noise3(p.x * 2 + i, p.y, p.z * 2) * 0.05;
          p.x *= rr;
          p.z *= rr;
          p.y -= edge * edge * (0.07 + scallop * 0.07) * r;
        });
        place(g, { x: s.x, z: s.z });
        paint(g, (p, n, vi, out) => {
          const lit = saturate((n.dot(LIGHT) + 0.3) / 1.2);
          const rim = saturate(Math.hypot(p.x - s.x, p.z - s.z) / r);
          out.copy(dark).lerp(mid, saturate(lit * 0.8 + rim * 0.3)).lerp(light, lit * lit * rim * 0.75);
        });
        setSway(g, (p) => 0.02 + 0.07 * saturate((p.y - y) / h) * saturate(Math.hypot(p.x - s.x, p.z - s.z) / r + 0.3));
        crowns.push(g);

        // Painted sprigs fringe each skirt
        const sprigs = Math.max(5, Math.round((7 + r * 5) * quality.foliage));
        for (let j = 0; j < sprigs; j++) {
          const a = (j / sprigs) * TAU + turn + i * 0.6 + rng.range(-0.18, 0.18);
          const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const size = r * rng.range(0.82, 1.08) + 0.25;
          const tilt = rng.range(0.42, 0.7);
          // The sprite's stem is at its top: it hangs outwards and down
          up.copy(out).multiplyScalar(-Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt));
          facing.copy(out).multiplyScalar(Math.sin(tilt)).addScaledVector(UP, Math.cos(tilt));
          centre.set(s.x + out.x * (r * 0.66), y0 + th * 0.2 - size * 0.12, s.z + out.z * (r * 0.66));
          shade.copy(out).multiplyScalar(0.8).addScaledVector(UP, 0.6).normalize();
          const lit = saturate((shade.dot(LIGHT) + 0.3) / 1.2);
          tint.copy(dark).lerp(mid, saturate(lit + 0.15)).lerp(light, lit * lit * 0.6).offsetHSL(rng.range(-0.012, 0.012), 0, rng.range(-0.03, 0.03));
          sprigCards.add(centre, facing, size, tint, shade, 0.03 + 0.05 * k, { up, cup: 0.08, tipTint: light.clone().lerp(tint, 0.45), swayTip: 0.1 });
        }
      }
      // Leader
      const top = lathe(
        [
          [R * 0.13, y + h * 0.9],
          [0.02, y + h * 1.06],
        ],
        8
      );
      place(top, { x: s.x, z: s.z });
      paint(top, (p, n, vi, out) => out.copy(mid).lerp(light, 0.4));
      setSway(top, () => 0.12);
      crowns.push(top);
      anchors.spruces.push(new THREE.Vector3(s.x, y + h * 1.06, s.z));
    }
  }

  // ---------- The willow ----------
  {
    const { x, z } = TREES.willow;
    const y = field.height(x, z) - 0.08;
    // It leans out over the pool
    const lx = -0.55;
    const lz = 0.84;
    const at = (a, h, side = 0) => new THREE.Vector3(x + lx * a - lz * side, y + h, z + lz * a + lx * side);

    limb([at(0, 0), at(0.25, 1.0), at(0.7, 2.0), at(1.1, 2.85)], 0.42, 0.26, { radial: 11, flare: 0.26, samples: 14, cap: false, lightCol: palette.barkOak });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * TAU + 0.4;
      limb([at(Math.cos(a) * 0.15, 0.4, Math.sin(a) * 0.15), at(Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55), at(Math.cos(a) * 1.0, -0.1, Math.sin(a) * 1.0)], 0.15, 0.05, { radial: 6, samples: 7 });
    }

    const arches = [
      [[1.1, 2.85, 0], [1.7, 4.2, 0.2], [2.6, 4.5, 0.4], [3.35, 3.6, 0.5]],
      [[1.1, 2.85, 0], [1.2, 4.3, 1.1], [1.4, 4.6, 2.4], [1.5, 3.6, 3.4]],
      [[1.1, 2.85, 0], [1.0, 4.4, -1.0], [0.9, 4.7, -2.3], [0.8, 3.7, -3.3]],
      [[1.1, 2.85, 0], [0.4, 4.3, 0.3], [-0.9, 4.5, 0.5], [-2.0, 3.6, 0.6]],
      [[1.1, 2.85, 0], [2.0, 4.5, -0.9], [3.0, 4.7, -1.9], [3.7, 3.8, -2.6]],
      [[1.1, 2.85, 0], [2.0, 4.4, 1.2], [2.9, 4.5, 2.3], [3.4, 3.7, 3.0]],
    ];
    const tint = new THREE.Color();
    const tip = new THREE.Color();
    const facing = new THREE.Vector3();
    const shade = new THREE.Vector3();
    const top = at(1.2, 4.3);
    const clumps = [];

    for (const arch of arches) {
      const pts = limb(arch.map(([a, h, side]) => at(a, h, side)), 0.17, 0.035, { radial: 7, samples: 18 });
      // Leafy tufts ride on top of each arch
      for (const t of [0.42, 0.68, 0.92]) {
        const p = pts[Math.round(t * (pts.length - 1))];
        clumps.push({ x: p.x, y: p.y + 0.18, z: p.z, r: lerp(0.95, 0.7, t), squash: 0.62 });
      }
      // ...and the hanging curtain falls from it
      const strands = Math.round(64 * quality.foliage);
      for (let k = 0; k < strands; k++) {
        const t = lerp(0.3, 1.0, (k + rng()) / strands);
        const f = t * (pts.length - 1);
        const i = Math.min(Math.floor(f), pts.length - 2);
        const p = pts[i].clone().lerp(pts[i + 1], f - i);
        p.x += rng.range(-0.35, 0.35);
        p.z += rng.range(-0.35, 0.35);
        const ground = Math.max(field.height(p.x, p.z), field.level(p.x, p.z));
        const length = Math.min(p.y - ground - rng.range(0.95, 1.7), rng.range(1.4, 2.5));
        if (length < 0.7) continue;
        const yaw = rng.range(0, TAU);
        facing.set(Math.cos(yaw), 0, Math.sin(yaw));
        shade.copy(p).sub(top).setY(0).normalize().multiplyScalar(0.6).addScaledVector(UP, 0.8).normalize();
        const lit = saturate((shade.dot(LIGHT) + 0.35) / 1.2);
        tint.copy(willowColours.dark).lerp(willowColours.mid, saturate(lit + 0.2)).lerp(willowColours.light, lit * lit * 0.6).offsetHSL(rng.range(-0.01, 0.01), 0, rng.range(-0.035, 0.035));
        tip.copy(tint).lerp(willowColours.light, 0.55);
        // Hung from its top edge
        _p.copy(p).setY(p.y - length * 0.5 + 0.1);
        strandCards.add(_p, facing, length, tint, shade, 0.02, { up: UP, cup: 0.03, aspect: 0.4 * rng.range(0.85, 1.25), tipTint: tip, swayTip: 0.3 * rng.range(0.8, 1.2) });
      }
    }
    crown(clumps, at(1.2, 3.2), birchCards, willowColours, { cardSize: 0.82, density: 74, swayBase: 0.06, swayTop: 0.2, bodyScale: 0.6, upBias: 0.5 });
    anchors.willow = at(1.2, 2.6);
  }

  // ---------- Bushes ----------
  {
    const berry = [];
    TREES.bushes.forEach((b, bi) => {
      const y = field.height(b.x, b.z);
      const clumps = [];
      const n = b.r > 0.85 ? 4 : 3;
      for (let k = 0; k < n; k++) {
        const a = (k / n) * TAU + bi;
        const d = k === 0 ? 0 : b.r * 0.55;
        const r = b.r * (k === 0 ? 0.74 : rng.range(0.46, 0.6));
        const cx = b.x + Math.cos(a) * d;
        const cz = b.z + Math.sin(a) * d;
        clumps.push({ x: cx, y: field.height(cx, cz) + r * 0.62, z: cz, r, squash: 0.86 });
      }
      crown(clumps, new THREE.Vector3(b.x, y + b.r * 0.2, b.z), oakCards, bushColours, { cardSize: 0.56, density: 104, swayBase: 0.015, swayTop: 0.07, bodyScale: 0.7, upBias: 0.12 });

      // Every third bush is in blossom or in fruit
      if (bi % 3 !== 1) {
        const hex = bi % 3 === 0 ? (bi % 2 ? palette.pink : palette.white) : palette.red;
        const dir = new THREE.Vector3();
        for (let k = 0; k < 16; k++) {
          const c = clumps[k % clumps.length];
          randomDirection(dir, 0.6);
          const g = icoSphere(bi % 3 === 0 ? 0.05 : 0.036, 1);
          part(g, hex, { x: c.x + dir.x * c.r * 1.02, y: c.y + dir.y * c.r * 0.9, z: c.z + dir.z * c.r * 1.02 });
          berry.push(g);
        }
      }
    });
    if (berry.length) solids.push(...berry);
  }

  // ---------- Assemble ----------
  const add = (geometry, material, name, options) => {
    const m = mesh(geometry, material, { name, ...options });
    group.add(m);
    return m;
  };
  add(merge(barks, { keepUv: true }), kit.bark, 'bark');
  add(merge(birchTrunks, { keepUv: true }), kit.birchBark, 'birch-trunks');
  add(merge(crowns), kit.canopy, 'crowns');
  if (solids.length) add(merge(solids), kit.solid, 'blossom');
  add(oakCards.build(), kit.leaves(textures.foliageOak), 'oak-leaves', { receive: false });
  add(birchCards.build(), kit.leaves(textures.foliageBirch), 'birch-leaves', { receive: false });
  add(sprigCards.build(), kit.leaves(textures.spruceSprig), 'spruce-sprigs', { receive: false });
  // Thin strands would vanish in the distance with the usual cut-off
  add(strandCards.build(), kit.leaves(textures.willowStrand, { alphaTest: 0.16 }), 'willow-strands', { receive: false });

  // ---------- The swing ----------
  const swing = new THREE.Group();
  {
    const { point, limbRadius, yaw } = anchors.swing;
    const ground = field.height(point.x, point.z);
    const drop = point.y - limbRadius - (ground + 0.62);
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
    anchors.swingSeat = new THREE.Vector3(point.x, ground + 0.7, point.z);
  }
  group.add(swing);

  function update(time) {
    // A slow pendulum, as if someone has just hopped off
    swing.rotation.x = Math.sin(time * 1.9) * 0.13 * (0.75 + 0.25 * Math.sin(time * 0.23));
  }

  return { group, anchors, update, counts: { oak: oakCards.count, birch: birchCards.count, sprigs: sprigCards.count, strands: strandCards.count } };
}
