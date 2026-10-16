import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { season } from '../core/season.js';
import { blob, tube, curvePoints, lathe, roundedBox, icoSphere, place, paint, displace, setSway, merge } from '../core/geo.js';
import { shadeByOpenness } from '../core/models.js';
import { mesh, part, grainUv } from './kit.js';
import { OAK, TREES } from './layout.js';

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
  const leaf = [];
  const turn = [];
  const index = [];

  // A cupped square card. `up` fixes which way the top of the sprite points.
  // For the seasons: `number` (0..1) is the card's place in the queue of
  // leaves that turn and fall, `kind` marks blossom and willow strands,
  // `autumn` is the colour it turns to and `pivot` the point it shrinks to.
  function add(
    centre,
    facing,
    size,
    tint,
    shadeNormal,
    swayAmount,
    { roll = 0, up = null, cup = 0.16, aspect = 1, tipTint = null, swayTip = null, number = 0, kind = 0, autumn = null, autumnTip = null, pivot = null } = {}
  ) {
    const hang = pivot || centre;
    const gold = autumn || tint;
    const tag = Math.min(0.999, Math.max(0, number)) + kind * 2;
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
        if (autumnTip) turn.push(lerp(autumnTip.r, gold.r, k), lerp(autumnTip.g, gold.g, k), lerp(autumnTip.b, gold.b, k));
        else turn.push(gold.r, gold.g, gold.b);
        leaf.push(hang.x, hang.y, hang.z, tag);
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
    g.setAttribute('aLeaf', new THREE.Float32BufferAttribute(leaf, 4));
    g.setAttribute('aTurn', new THREE.Float32BufferAttribute(turn, 3));
    g.setIndex(index);
    g.computeBoundingSphere();
    return g;
  }

  return { add, build, get count() { return index.length / 24; } };
}

export function createTrees(field, kit, textures, quality, models = {}) {
  const group = new THREE.Group();
  group.name = 'trees';
  const noise = field.noise;
  const rng = createRng(2024);
  // The seasons draw their own numbers, so the trees keep the shapes they had
  const yearRng = createRng(1717);

  const oakCards = cardBatch();
  const birchCards = cardBatch();
  const sprigCards = cardBatch();
  const strandCards = cardBatch();
  const twigCards = cardBatch();
  const blossomCards = cardBatch();
  const crowns = []; // soft bodies behind the cards: evergreen
  const leafBodies = []; // ...and the ones that thin away with their leaves
  const barks = [];
  const birchTrunks = [];
  const solids = [];
  // `crowns` lists the lumps of every crown that sheds its leaves, for the air to drop them from
  const anchors = { crowns: [] };

  const randomDirection = (out, upBias = 0) => {
    out.set(rng.gauss(), rng.gauss() + upBias, rng.gauss());
    if (out.lengthSq() < 1e-4) out.set(0, 1, 0);
    return out.normalize();
  };

  // ---------- Crown: lumps and the cards that dress them ----------
  // `autumn` are the colours the crown turns to, `cling` the share of leaves
  // that stay on through the winter, `blossom` 1 (white) or 2 (pink) for a
  // crown that sheds petals in spring, `twig` the colour of its bare twigs.
  function crown(
    clumps,
    centre,
    batch,
    colours,
    { cardSize = 1, density = 60, swayBase = 0.05, swayTop = 0.16, bodyScale = 0.7, upBias = 0.25, droop = 0, autumn = colours, cling = 0, blossom = 0, twig = null, fans = 3, fanSize = 2, sheds = -1 } = {}
  ) {
    // `sheds` is the column of the leaf sheet this crown drops in autumn
    if (sheds >= 0) for (const c of clumps) anchors.crowns.push({ x: c.x, y: c.y, z: c.z, r: c.r, sheds, blossom });
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
    const gold = new THREE.Color();
    const grow = new THREE.Vector3();
    const foot = new THREE.Vector3();
    const twigTint = new THREE.Color();

    const tintFor = (n, y, jitter) => {
      const height = saturate((y - lo) / (hi - lo || 1));
      const lit = saturate((n.dot(LIGHT) + 0.35) / 1.2);
      tint.copy(colours.dark).lerp(colours.mid, saturate(height * 0.7 + lit * 0.55));
      tint.lerp(colours.light, saturate(lit * lit * 0.95 + height * 0.2 - 0.12));
      tint.offsetHSL(jitter * 0.018, jitter * 0.05, jitter * 0.045);
      return tint;
    };
    // The same light and shade, in the colours of autumn
    const goldFor = (n, y, jitter) => {
      const height = saturate((y - lo) / (hi - lo || 1));
      const lit = saturate((n.dot(LIGHT) + 0.35) / 1.2);
      gold.copy(autumn.dark).lerp(autumn.mid, saturate(height * 0.7 + lit * 0.55));
      gold.lerp(autumn.light, saturate(lit * lit * 0.95 + height * 0.2 - 0.12));
      gold.offsetHSL(jitter * 0.022, jitter * 0.04, jitter * 0.04);
      return gold;
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
      {
        // What the body does in autumn: turns with its leaves, then shrinks to its middle
        const leaf = new Float32Array(bp.count * 4);
        const turn = new Float32Array(bp.count * 3);
        const number = yearRng() * 0.999;
        for (let i = 0; i < bp.count; i++) {
          _p.fromBufferAttribute(bp, i);
          shade.copy(_p).sub(centre).normalize();
          goldFor(shade, _p.y, mood * 0.5).lerp(autumn.dark, 0.5).multiplyScalar(0.84);
          turn[i * 3] = gold.r;
          turn[i * 3 + 1] = gold.g;
          turn[i * 3 + 2] = gold.b;
          leaf[i * 4] = c.x;
          leaf[i * 4 + 1] = c.y;
          leaf[i * 4 + 2] = c.z;
          leaf[i * 4 + 3] = number;
        }
        body.setAttribute('aLeaf', new THREE.BufferAttribute(leaf, 4));
        body.setAttribute('aTurn', new THREE.BufferAttribute(turn, 3));
      }
      leafBodies.push(body);

      // Bare twigs: fans that grow out of the crown and up, hidden until the leaves go
      if (twig) {
        for (let k = 0; k < fans; k++) {
          grow.set(c.x - centre.x, (c.y - centre.y) * 0.5 + c.r * 1.1, c.z - centre.z).normalize();
          grow.addScaledVector(randomDirection(_b), 0.42).normalize();
          facing.crossVectors(grow, randomDirection(_a)).normalize();
          const size = c.r * fanSize * yearRng.range(0.82, 1.18);
          foot.set(c.x, c.y, c.z).addScaledVector(grow, -size * 0.42);
          point.copy(foot).addScaledVector(grow, size * 0.5);
          shade.set(c.x - centre.x, c.y - centre.y, c.z - centre.z).normalize().lerp(UP, 0.45).normalize();
          twigTint.copy(twig).offsetHSL(yearRng.range(-0.01, 0.01), 0, yearRng.range(-0.035, 0.035));
          const height = saturate((c.y - lo) / (hi - lo || 1));
          twigCards.add(point, facing, size, twigTint, shade, lerp(swayBase, swayTop, height) * 0.7, { up: grow, cup: 0.05, pivot: foot, number: yearRng() });
        }
      }

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
        let size = cardSize * rng.range(0.74, 1.2);
        point.addScaledVector(dir, size * rng.range(-0.1, 0.14));
        if (droop && dir.y < 0.1) point.y -= rng.range(0, droop);
        // The leaves that stay on through the winter are the ones deep in
        // among the twigs, where the wind does not reach them
        const clings = yearRng.chance(cling);
        if (clings) {
          point.lerp(_a.set(c.x, c.y, c.z), yearRng.range(0.38, 0.62));
          size *= 0.8;
        }
        // A few leaves stay green a while longer than their neighbours
        goldFor(shade, point.y, jitter);
        if (yearRng.chance(0.07)) gold.lerp(tintFor(shade, point.y, jitter), 0.55);
        batch.add(point, facing, size, tintFor(shade, point.y, jitter), shade, lerp(swayBase, swayTop, height) * rng.range(0.8, 1.25), {
          roll: rng.range(0, TAU),
          autumn: gold,
          number: clings ? yearRng.range(0.972, 0.999) : yearRng.range(0, 0.9),
        });
      }
    }
  }

  // ---------- Blossom: painted clusters set all over a crown ----------
  // Each opens from in among the leaves when its turn comes in spring.
  function bloom(clumps, centre, tint) {
    const dir = new THREE.Vector3();
    const point = new THREE.Vector3();
    const shade = new THREE.Vector3();
    const facing = new THREE.Vector3();
    const foot = new THREE.Vector3();
    const hue = new THREE.Color();
    for (const c of clumps) {
      const squash = c.squash ?? 0.92;
      const count = Math.round(c.r * c.r * 60 * Math.max(0.6, quality.foliage));
      for (let k = 0; k < count; k++) {
        randomDirection(dir, 0.45);
        if (dir.y < -0.2) continue;
        point.set(c.x + dir.x * c.r * 1.03, c.y + dir.y * c.r * squash * 1.03, c.z + dir.z * c.r * 1.03);
        if (clumps.some((o) => o !== c && _a.set(point.x - o.x, point.y - o.y, point.z - o.z).length() < o.r * 0.9)) continue;
        shade.copy(point).sub(centre).normalize().lerp(dir, 0.4).lerp(UP, 0.3).normalize();
        facing.copy(dir).addScaledVector(randomDirection(_b), 0.26).normalize();
        foot.set(c.x + dir.x * c.r * 0.72, c.y + dir.y * c.r * squash * 0.72, c.z + dir.z * c.r * 0.72);
        hue.copy(tint).offsetHSL(rng.range(-0.012, 0.012), 0, rng.range(-0.03, 0.02));
        blossomCards.add(point, facing, 0.4 * rng.range(0.78, 1.2), hue, shade, 0.05, { roll: rng.range(0, TAU), cup: 0.24, pivot: foot, number: yearRng() });
      }
    }
  }

  const colours = (dark, mid, light) => ({ dark: col(dark).clone(), mid: col(mid).clone(), light: col(light).clone() });
  const oakColours = colours(palette.oakDark, palette.oakMid, palette.oakLight);
  const birchColours = colours(palette.birchLeafDark, palette.birchLeafMid, palette.birchLeafLight);
  const bushColours = colours(palette.bushDark, palette.bushMid, palette.bushLight);
  const willowColours = colours(palette.willowDark, palette.willowMid, palette.willowLight);
  // What each of them turns to in autumn
  const oakGold = colours(palette.oakAutumnDark, palette.oakAutumnMid, palette.oakAutumnLight);
  const birchGold = colours(palette.birchAutumnDark, palette.birchAutumnMid, palette.birchAutumnLight);
  const bushGold = colours(palette.bushAutumnDark, palette.bushAutumnMid, palette.bushAutumnLight);
  const willowGold = colours(palette.willowAutumnDark, palette.willowAutumnMid, palette.willowAutumnLight);

  // ---------- Limbs ----------
  function limb(points, r0, r1, { radial = 8, target = barks, dark = palette.barkDark, lightCol = palette.barkOak, flare = 0, samples = 14, cap = true } = {}) {
    const pts = curvePoints(points, samples);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += pts[i].distanceTo(pts[i - 1]);
    const g = tube(pts, (t) => lerp(r0, r1, Math.pow(t, 0.85)) + flare * Math.exp(-t * 10), { radial, capStart: false, capEnd: cap });
    // The sheet of bark goes twice round a thick trunk and once round a
    // branch, and keeps its scale along the limb
    const around = Math.max(1, Math.round((Math.PI * (r0 + r1)) / 1.25));
    const offset = rng.range(0, 1);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * around + offset, uv.getY(i) * length * 0.78 + offset * 1.3);
    barkPaint(g, dark, lightCol, rng.range(0, 40));
    target.push(g);
    return pts;
  }

  function barkPaint(g, dark, lightCol, seed) {
    const a = col(dark);
    const b = col(lightCol);
    const moss = col(palette.moss);
    const mossy = new Float32Array(g.attributes.position.count);
    paint(g, (p, n, i, out) => {
      const lit = saturate((n.dot(LIGHT) + 0.3) / 1.2);
      const blotch = noise.noise3(p.x * 1.6 + seed, p.y * 0.9, p.z * 1.6);
      out.copy(a).lerp(b, saturate(lit * 0.9 + blotch * 0.25));
      // A green cast on the weather side
      out.lerp(moss, smoothstep(0.35, 0.8, -n.x * 0.6 + n.y * 0.5 + blotch * 0.4) * 0.28);
      // ...and moss itself at the foot, furthest up the side the sun does not dry (aMoss)
      const foot = p.y - field.height(p.x, p.z);
      const shady = saturate(0.5 - (n.x * LIGHT.x + n.z * LIGHT.z) * 1.4);
      mossy[i] = saturate((1 - smoothstep(0.1, 1.5, foot)) * (0.3 + 0.7 * shady) * 1.05 + blotch * 0.16 - 0.08);
    });
    g.setAttribute('aMoss', new THREE.BufferAttribute(mossy, 1));
  }

  // Where a trunk divides, a rounded shoulder of bark gathers its limbs
  function shoulder(centre, r, seed, { dark = palette.barkDark, lightCol = palette.barkOak, squash = 0.82 } = {}) {
    const g = blob(r, 2, noise, { amp: 0.16, freq: 1.5, seed, squashY: squash });
    place(g, { x: centre.x, y: centre.y, z: centre.z });
    g.computeVertexNormals();
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) * 0.7 + pos.getZ(i) * 0.7) * 0.8 + seed;
      uv[i * 2 + 1] = pos.getY(i) * 0.78;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    barkPaint(g, dark, lightCol, seed);
    barks.push(g);
  }

  // ---------- The oak ----------
  {
    const { x, z } = TREES.oak;
    const y = field.height(x, z) - 0.08;
    const S = OAK.scale;
    const at = (lx, ly, lz) => new THREE.Vector3(x + lx * S, y + ly * S, z + lz * S);

    // Trunk with a root flare, and toes gripping the knoll
    const grown = barks.length;
    limb(OAK.trunk.map((p) => at(...p)), 0.5 * S, 0.34 * S, { radial: 14, flare: 0.34 * S, samples: 16 });
    shoulder(at(0, 2.95, 0), 0.47 * S, 11.3);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * TAU + rng.range(-0.3, 0.3);
      const reach = rng.range(0.95, 1.4);
      limb([at(Math.cos(a) * 0.2, 0.55, Math.sin(a) * 0.2), at(Math.cos(a) * 0.62, 0.2, Math.sin(a) * 0.62), at(Math.cos(a) * reach, -0.12, Math.sin(a) * reach)], 0.2 * S, 0.07 * S, { radial: 6, samples: 8 });
    }

    const swingLimb = [];
    OAK.limbs.forEach((path, i) => {
      const pts = limb(path.map((p) => at(...p)), (i === 0 ? 0.25 : 0.21) * S, 0.07 * S, { radial: 8 });
      if (i === 0) swingLimb.push(...pts);
    });
    // The wood modelled in Blender round the same lines takes the place of
    // what was just grown: buttress roots, bark in plates, limbs grown out of
    // the trunk. It is grown all the same, so every number drawn for it is
    // drawn and the rest of the island keeps its shape.
    const wood = models.oak?.bark;
    if (wood) {
      barks.splice(grown);
      wood.geometry.translate(x, y, z);
      barkPaint(wood.geometry, palette.barkDark, palette.barkOak, 11.3);
      shadeByOpenness(wood, 0.45);
      barks.push(wood.geometry);
    }

    const clumps = OAK.clumps.map(([cx, cy, cz, r]) => {
      const p = at(cx, cy, cz);
      return { x: p.x, y: p.y, z: p.z, r: r * S };
    });
    crown(clumps, at(0, 4.3, 0.2), oakCards, oakColours, {
      cardSize: 1.02 * S,
      density: 64,
      swayBase: 0.03,
      swayTop: 0.13,
      bodyScale: 0.72,
      autumn: oakGold,
      // An oak keeps a good handful of its brown leaves until spring
      cling: 0.13,
      twig: col(palette.twigOak),
      sheds: 1,
      fans: 4,
      fanSize: 1.9,
    });

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
    crown(clumps, trunkAt(0.72), birchCards, birchColours, {
      cardSize: 0.8,
      density: 82,
      swayBase: 0.06,
      swayTop: 0.22,
      bodyScale: 0.5,
      upBias: 0.1,
      droop: 0.5,
      autumn: birchGold,
      cling: 0.025,
      twig: col(palette.twigBirch),
      sheds: 0,
      fans: 3,
      fanSize: 2.3,
    });
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

      const tiers = 7;
      const turn = rng.range(0, TAU);
      // Rows of boughs on a tier: how far out, how big, how far up the tier, how steeply they hang
      const ROWS = [
        [0.8, 1.0, 0.02, 0.5],
        [0.5, 0.82, 0.36, 0.66],
        [0.23, 0.6, 0.68, 0.84],
      ];
      for (let i = 0; i < tiers; i++) {
        const k = i / (tiers - 1);
        const y0 = y + h * (0.13 + 0.116 * i);
        const r = R * Math.pow(1 - k * 0.87, 0.95);
        const th = h * 0.25 * (1 - k * 0.3);
        // The dark heart of the tier: what shows between the boughs and from underneath
        const g = lathe(
          [
            [r * 0.46, y0 - th * 0.05],
            [r * 0.84, y0 + th * 0.02],
            [r * 0.6, y0 + th * 0.28],
            [r * 0.33, y0 + th * 0.62],
            [0.03, y0 + th],
          ],
          18
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
          // Dark underneath and near the trunk, where the tier above shades it
          out.copy(dark).multiplyScalar(0.5 + 0.26 * rim).lerp(mid, saturate(lit * 0.4 + rim * 0.12) * saturate(n.y * 1.6 + 0.3) * 0.6);
        });
        setSway(g, (p) => 0.02 + 0.07 * saturate((p.y - y) / h) * saturate(Math.hypot(p.x - s.x, p.z - s.z) / r + 0.3));
        crowns.push(g);

        // Painted boughs lie over the tier like shingles, the lowest row hanging past its rim
        ROWS.forEach(([share, scale, lift, steep], ri) => {
          const rr = r * share;
          const span = (r * 0.6 + 0.3) * scale;
          const count = Math.max(ri === 2 ? 3 : 5, Math.round(((TAU * rr) / (span * 0.44)) * quality.foliage));
          for (let j = 0; j < count; j++) {
            const a = (j / count) * TAU + turn + i * 0.6 + ri * 1.1 + rng.range(-0.2, 0.2);
            const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
            const size = span * rng.range(0.84, 1.14);
            const tilt = steep + rng.range(-0.1, 0.12);
            // The sprite's stem is at its top: it hangs outwards and down
            up.copy(out).multiplyScalar(-Math.cos(tilt)).addScaledVector(UP, Math.sin(tilt));
            facing.copy(out).multiplyScalar(Math.sin(tilt)).addScaledVector(UP, Math.cos(tilt));
            const reach = rr * rng.range(0.94, 1.08);
            centre.set(s.x + out.x * reach, y0 + th * lift + size * 0.06 - size * 0.14 * Math.sin(tilt), s.z + out.z * reach);
            shade.copy(out).multiplyScalar(0.8 - ri * 0.12).addScaledVector(UP, 0.6 + ri * 0.14).normalize();
            const lit = saturate((shade.dot(LIGHT) + 0.3) / 1.2);
            tint.copy(dark).lerp(mid, saturate(lit + 0.12)).lerp(light, lit * lit * 0.55).offsetHSL(rng.range(-0.012, 0.012), 0, rng.range(-0.03, 0.03));
            // The tier above keeps the inner rows in its shade
            if (ri > 0 && i < tiers - 1) tint.multiplyScalar(1 - ri * 0.07);
            sprigCards.add(centre, facing, size, tint, shade, 0.03 + 0.05 * k, { up, cup: 0.1, tipTint: light.clone().lerp(tint, ri === 0 ? 0.4 : 0.6), swayTip: 0.1 - ri * 0.025 });
          }
        });
      }
      // Leader: a slim spike, with two whorls of young shoots reaching up around it
      const top = lathe(
        [
          [R * 0.075, y + h * 0.88],
          [0.012, y + h * 1.07],
        ],
        7
      );
      place(top, { x: s.x, z: s.z });
      paint(top, (p, n, vi, out) => out.copy(dark).lerp(mid, 0.55));
      setSway(top, () => 0.12);
      crowns.push(top);
      for (const [at, n, scale] of [
        [0.9, 5, 1],
        [0.97, 4, 0.72],
      ]) {
        for (let j = 0; j < n; j++) {
          const a = (j / n) * TAU + turn + at * 9;
          const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
          const size = (R * 0.2 + 0.2) * scale * rng.range(0.9, 1.12);
          // Stem down and in, tip up and out
          up.copy(out).multiplyScalar(-0.42).addScaledVector(UP, -0.9).normalize();
          facing.copy(out).multiplyScalar(0.9).addScaledVector(UP, -0.42).normalize();
          centre.set(s.x + out.x * size * 0.2, y + h * at + size * 0.4, s.z + out.z * size * 0.2);
          shade.copy(out).multiplyScalar(0.6).addScaledVector(UP, 0.8).normalize();
          const lit = saturate((shade.dot(LIGHT) + 0.3) / 1.2);
          tint.copy(dark).lerp(mid, saturate(lit + 0.2)).lerp(light, lit * 0.5);
          sprigCards.add(centre, facing, size, tint, shade, 0.1, { up, cup: 0.1, tipTint: light.clone().lerp(tint, 0.35), swayTip: 0.14 });
        }
      }
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

    limb([at(0, 0), at(0.25, 1.0), at(0.7, 2.0), at(1.1, 2.85)], 0.42, 0.26, { radial: 12, flare: 0.26, samples: 14, lightCol: palette.barkOak });
    shoulder(at(1.06, 2.78), 0.34, 23.7);
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
    const gold = new THREE.Color();
    const goldTip = new THREE.Color();
    const facing = new THREE.Vector3();
    const shade = new THREE.Vector3();
    const middle = new THREE.Vector3();
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
        // One strand in three stays on, bare, as the willow's winter threads.
        // Those hang from the bough itself: with the leaves gone it shows
        // what a thread is tied to.
        const stays = yearRng.chance(0.34);
        const spread = stays ? 0.07 : 0.35;
        p.x += rng.range(-1, 1) * spread;
        p.z += rng.range(-1, 1) * spread;
        // Long enough to trail near the grass and the water, never to lie on them
        const ground = Math.max(field.height(p.x, p.z), field.level(p.x, p.z));
        const length = Math.min(p.y - ground - rng.range(0.3, 1.3), rng.range(2.4, 3.8));
        if (length < 1) continue;
        const yaw = rng.range(0, TAU);
        facing.set(Math.cos(yaw), 0, Math.sin(yaw));
        shade.copy(p).sub(top).setY(0).normalize().multiplyScalar(0.6).addScaledVector(UP, 0.8).normalize();
        const lit = saturate((shade.dot(LIGHT) + 0.35) / 1.2);
        tint.copy(willowColours.dark).lerp(willowColours.mid, saturate(lit + 0.2)).lerp(willowColours.light, lit * lit * 0.6).offsetHSL(rng.range(-0.01, 0.01), 0, rng.range(-0.035, 0.035));
        tip.copy(tint).lerp(willowColours.light, 0.55);
        gold.copy(willowGold.dark).lerp(willowGold.mid, saturate(lit + 0.2)).lerp(willowGold.light, lit * lit * 0.6);
        goldTip.copy(gold).lerp(willowGold.light, 0.5);
        // Hung from its top edge, and as wide whatever its length
        middle.copy(p).setY(p.y - length * 0.5 + 0.1);
        strandCards.add(middle, facing, length, tint, shade, 0.02, {
          up: UP,
          cup: 0.03,
          aspect: (0.86 / length) * rng.range(0.85, 1.25),
          tipTint: tip,
          swayTip: 0.3 * rng.range(0.8, 1.2),
          autumn: gold,
          autumnTip: goldTip,
          // The rest shrink up to where they hang
          pivot: p,
          kind: 3,
          number: stays ? yearRng.range(0.972, 0.999) : yearRng.range(0, 0.9),
        });
      }
    }
    crown(clumps, at(1.2, 3.2), birchCards, willowColours, {
      cardSize: 0.82,
      density: 74,
      swayBase: 0.06,
      swayTop: 0.2,
      bodyScale: 0.6,
      upBias: 0.5,
      autumn: willowGold,
      twig: col(palette.twigWillow),
      sheds: 3,
      fans: 2,
      fanSize: 1.7,
    });
    anchors.willow = at(1.2, 2.6);
  }

  // ---------- Bushes ----------
  {
    const berry = [];
    const blossomWhite = new THREE.Color(1, 0.975, 0.95);
    const blossomPink = col(palette.pink).clone().lerp(new THREE.Color(1, 1, 1), 0.3);
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
      // Every third bush flowers: clusters of blossom all over it in spring, white or pink
      const flowering = bi % 3 === 0;
      const middle = new THREE.Vector3(b.x, y + b.r * 0.2, b.z);
      if (flowering) bloom(clumps, middle, bi % 2 ? blossomPink : blossomWhite);
      crown(clumps, middle, oakCards, bushColours, {
        cardSize: 0.58,
        density: 146,
        swayBase: 0.015,
        swayTop: 0.07,
        bodyScale: 0.7,
        upBias: 0.12,
        autumn: bushGold,
        cling: 0.02,
        blossom: flowering ? (bi % 2 ? 2 : 1) : 0,
        twig: col(palette.twigBush),
        sheds: 2,
        fans: 2,
        fanSize: 2.1,
      });

      // ...and every third one bears fruit, which stays on into the winter
      if (bi % 3 === 2) {
        const dir = new THREE.Vector3();
        for (let k = 0; k < 22; k++) {
          const c = clumps[k % clumps.length];
          randomDirection(dir, 0.6);
          const g = icoSphere(0.042, 1);
          const at = { x: c.x + dir.x * c.r * 1.02, y: c.y + dir.y * c.r * 0.9, z: c.z + dir.z * c.r * 1.02 };
          part(g, palette.red, at);
          // Each berry swells where it hangs, in its own time
          const turn = yearRng();
          const pop = new Float32Array(g.attributes.position.count * 4);
          for (let i = 0; i < pop.length; i += 4) pop.set([at.x, at.y, at.z, turn], i);
          g.setAttribute('aPop', new THREE.BufferAttribute(pop, 4));
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
  add(merge(barks, { keepUv: true, keep: ['aMoss'] }), kit.bark, 'bark');
  add(merge(birchTrunks, { keepUv: true }), kit.birchBark, 'birch-trunks');
  add(merge(crowns), kit.canopy, 'crowns');
  const bodies = add(merge(leafBodies, { keep: ['aLeaf', 'aTurn'] }), kit.crown, 'leaf-crowns');
  bodies.customDepthMaterial = kit.shadows.crown;
  // Berries ripen as the leaves turn, bush by bush as the autumn comes over
  const ripe = { value: season.row(0) };
  const ripening = kit.seasonal(ripe);
  const fruit = solids.length ? add(merge(solids, { keep: ['aPop'] }), ripening.solid, 'berries') : null;
  if (fruit) fruit.customDepthMaterial = ripening.shadow;
  const blossom = blossomCards.count ? add(blossomCards.build(), kit.blossom, 'blossom', { cast: false, receive: false }) : null;
  const leafy = [
    add(oakCards.build(), kit.leaves(textures.foliageOak, { seasonal: true }), 'oak-leaves', { receive: false }),
    add(birchCards.build(), kit.leaves(textures.foliageBirch, { seasonal: true }), 'birch-leaves', { receive: false }),
    // Thin strands would vanish in the distance with the usual cut-off
    add(strandCards.build(), kit.leaves(textures.willowStrand, { alphaTest: 0.16, seasonal: true }), 'willow-strands', { receive: false }),
  ];
  // One shadow material to a mesh: each is handed its own leaf sprite to cut the shadow with
  for (const m of leafy) m.customDepthMaterial = kit.shadows.leaves();
  add(sprigCards.build(), kit.leaves(textures.spruceSprig), 'spruce-sprigs', { receive: false });
  const twigs = add(twigCards.build(), kit.twigs, 'twigs', { receive: false });
  twigs.customDepthMaterial = kit.shadows.twigs;

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

  // What is not there is not drawn: leaves in midwinter, twigs in midsummer
  function dress() {
    // While the year turns one side of the island is further on than the other
    const fewest = season.least('leafDrop');
    bodies.visible = fewest < 0.82;
    twigs.visible = season.most('leafDrop') > 0.1;
    for (const m of leafy) m.visible = fewest < 0.999;
    if (blossom) blossom.visible = season.most('blossom') > 0.002;
    if (fruit) fruit.visible = season.across((v) => smoothstep(0.2, 0.8, v.leafTurn), ripe.value) > 0.004;
  }
  dress();

  function update(time) {
    if (season.changed) dress();
    // A slow pendulum, as if someone has just hopped off
    swing.rotation.x = Math.sin(time * 1.9) * 0.13 * (0.75 + 0.25 * Math.sin(time * 0.23));
  }

  return {
    group,
    anchors,
    update,
    counts: { oak: oakCards.count, birch: birchCards.count, sprigs: sprigCards.count, strands: strandCards.count, twigs: twigCards.count, blossom: blossomCards.count },
  };
}
