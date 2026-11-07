import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { season } from '../core/season.js';
import { blob, tube, curvePoints, roundedBox, place, paint, setSway, merge } from '../core/geo.js';
import { shadeByOpenness } from '../core/models.js';
import { mesh, part, grainUv } from './kit.js';
import { growFlora } from './flora.js';
import { OAK, TREES, WILLOW } from './layout.js';

// The trees and bushes. The birches, the spruces, the bushes, the oak's crown
// and the willow are grown in Blender (world/flora.js); the oak's wood too
// (models.oak). Without their files the oak and the willow are grown here:
// each crown is a few soft lumps dressed in painted leaf cards, which borrow
// their normals from the crown's overall shape, so a whole tree shades like
// one rounded form.

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
  const willowCards = cardBatch();
  const strandCards = cardBatch();
  const twigCards = cardBatch();
  const crowns = []; // soft bodies behind the cards: evergreen
  const leafBodies = []; // ...and the ones that thin away with their leaves
  const barks = [];
  // `crowns` lists the lumps of every crown that sheds its leaves, for the air to drop them from
  const anchors = { crowns: [] };
  // What of the oak and the willow came grown from Blender
  const grown = models.flora?.parts;
  const oakGrown = !!grown?.has('oak-leaves');
  const willowGrown = !!grown?.has('willow-strands');

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

  const colours = (dark, mid, light) => ({ dark: col(dark).clone(), mid: col(mid).clone(), light: col(light).clone() });
  const oakColours = colours(palette.oakDark, palette.oakMid, palette.oakLight);
  const willowColours = colours(palette.willowDark, palette.willowMid, palette.willowLight);
  // What each of them turns to in autumn
  const oakGold = colours(palette.oakAutumnDark, palette.oakAutumnMid, palette.oakAutumnLight);
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
    if (!oakGrown) {
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
    }

    anchors.oak = at(0, 3.0, 0);
    anchors.oakTop = at(0, 8.5, 0.3);
    // Where the swing hangs: a point two thirds of the way along its limb
    const hang = swingLimb[Math.round(swingLimb.length * 0.6)];
    anchors.swing = { point: hang.clone(), limbRadius: 0.16 * S, yaw: Math.atan2(-(swingLimb[10].z - swingLimb[6].z), swingLimb[10].x - swingLimb[6].x) };
  }

  // ---------- The willow ----------
  {
    const { x, z } = TREES.willow;
    const y = field.height(x, z) - 0.08;
    // It leans out over the pool
    const [lx, lz] = WILLOW.lean;
    const at = (a, h, side = 0) => new THREE.Vector3(x + lx * a - lz * side, y + h, z + lz * a + lx * side);

    if (!willowGrown) {
      limb(WILLOW.trunk.map((p) => at(...p)), 0.42, 0.26, { radial: 12, flare: 0.26, samples: 14, lightCol: palette.barkOak });
      shoulder(at(1.06, 2.78), 0.34, 23.7);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * TAU + 0.4;
        limb([at(Math.cos(a) * 0.15, 0.4, Math.sin(a) * 0.15), at(Math.cos(a) * 0.55, 0.12, Math.sin(a) * 0.55), at(Math.cos(a) * 1.0, -0.1, Math.sin(a) * 1.0)], 0.15, 0.05, { radial: 6, samples: 7 });
      }

      const tint = new THREE.Color();
      const tip = new THREE.Color();
      const gold = new THREE.Color();
      const goldTip = new THREE.Color();
      const facing = new THREE.Vector3();
      const shade = new THREE.Vector3();
      const middle = new THREE.Vector3();
      const top = at(1.2, 4.3);
      const clumps = [];

      for (const arch of WILLOW.arches) {
        const pts = limb(arch.map((p) => at(...p)), 0.17, 0.035, { radial: 7, samples: 18 });
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
      crown(clumps, at(1.2, 3.2), willowCards, willowColours, {
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
    }
    anchors.willow = at(1.2, 2.6);
  }

  // ---------- Assemble ----------
  const add = (geometry, material, name, options) => {
    const m = mesh(geometry, material, { name, ...options });
    group.add(m);
    return m;
  };
  add(merge(barks, { keepUv: true, keep: ['aMoss'] }), kit.bark, 'bark');
  if (crowns.length) add(merge(crowns), kit.canopy, 'crowns');
  // What Blender grew is drawn with the rest of its garden: here only what was grown here
  const bodies = leafBodies.length ? add(merge(leafBodies, { keep: ['aLeaf', 'aTurn'] }), kit.crown, 'leaf-crowns') : null;
  if (bodies) bodies.customDepthMaterial = kit.shadows.crown;
  const leafy = [];
  if (oakCards.count) leafy.push(add(oakCards.build(), kit.leaves(textures.foliageOak, { seasonal: true }), 'oak-leaves', { receive: false }));
  if (willowCards.count) leafy.push(add(willowCards.build(), kit.leaves(textures.foliageBirch, { seasonal: true }), 'willow-leaves', { receive: false }));
  // Thin strands would vanish in the distance with the usual cut-off
  if (strandCards.count) leafy.push(add(strandCards.build(), kit.leaves(textures.willowStrand, { alphaTest: 0.16, seasonal: true }), 'willow-strands', { receive: false }));
  // One shadow material to a mesh: each is handed its own leaf sprite to cut the shadow with
  for (const m of leafy) m.customDepthMaterial = kit.shadows.leaves();
  const twigs = twigCards.count ? add(twigCards.build(), kit.twigs, 'twigs', { receive: false }) : null;
  if (twigs) twigs.customDepthMaterial = kit.shadows.twigs;

  // ---------- The birches, the spruces and the bushes ----------
  // Grown in Blender; without their file the island is drawn without them
  const garden = models.flora ? growFlora(models.flora, field, kit, quality, group) : null;
  if (garden) {
    anchors.crowns.push(...garden.anchors.crowns);
    anchors.birches = garden.anchors.birches;
  }

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
    if (bodies) bodies.visible = fewest < 0.82;
    if (twigs) twigs.visible = season.most('leafDrop') > 0.1;
    for (const m of leafy) m.visible = fewest < 0.999;
    garden?.dress();
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
    counts: { oak: oakCards.count, willow: willowCards.count, strands: strandCards.count, twigs: twigCards.count },
  };
}
