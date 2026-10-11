import * as THREE from '../core/three.js';
import { TAU, createRng, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, brand, col } from '../core/palette.js';
import { icoSphere, roundedBox, tube, curvePoints, lathe, blob, place, paint, paintSolid, setSway, merge } from '../core/geo.js';
import { mesh, part, grainUv, tubeGrain, vary } from './kit.js';
import { BRIDGE, PROPS } from './layout.js';

// The made things: the bridge, the fallen log, the picnic, the toys on the
// beach, the little boat, the kite, the bunting. Small, but they are what
// makes the place feel visited.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const LIGHT = new THREE.Vector3(-0.45, 0.82, 0.36).normalize();

export function createProps(field, kit, trees, water) {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = createRng(555);
  const noise = field.noise;
  const anchors = {};
  const updaters = [];

  // Static parts are gathered by material and merged at the end
  const solids = [];
  const woods = [];
  const cloths = [];

  const board = (w, h, d, hex, placement, { along = 'x', across = 'z', r = 0.012 } = {}) => {
    const g = grainUv(roundedBox(w, h, d, r, 1), along, across, 0.42, rng.range(0, 1));
    part(g, typeof hex === 'string' ? vary(hex, rng, { l: 0.045, s: 0.03 }) : hex, placement);
    woods.push(g);
    return g;
  };
  const pole = (points, radius, hex, { radial = 7 } = {}) => {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    const g = tubeGrain(tube(points, radius, { radial }), length, 0.42, rng.range(0, 1));
    part(g, typeof hex === 'string' ? vary(hex, rng, { l: 0.04 }) : hex);
    woods.push(g);
    return g;
  };

  // Move a list of geometries from a prop's own space into the world.
  const toWorld = (list, x, y, z, yaw = 0, s = 1) => {
    for (const g of list) place(g, { x, y, z, ry: yaw, s });
    return list;
  };

  // ---------- The bridge ----------
  {
    const [fx, fz] = BRIDGE.from;
    const [tx, tz] = BRIDGE.to;
    const length = Math.hypot(tx - fx, tz - fz);
    const yaw = Math.atan2(-(tz - fz), tx - fx);
    const y0 = field.height(fx, fz) + 0.02;
    const y1 = field.height(tx, tz) + 0.02;
    const arch = 0.52;
    const width = BRIDGE.width;
    const deckY = (t) => lerp(y0, y1, t) + arch * Math.sin(saturate(t) * Math.PI);
    const slope = (t) => Math.atan2((deckY(t + 0.01) - deckY(t - 0.01)) / 0.02, length);

    const local = { woods: woods.length };
    const planks = 21;
    for (let i = 0; i < planks; i++) {
      const t = (i + 0.5) / planks;
      const x = (t - 0.5) * (length + 0.3);
      board((length + 0.3) / planks - 0.022, 0.05, width + rng.range(-0.03, 0.03), i % 5 === 2 ? palette.woodLight : palette.wood, { x, y: deckY(t) + 0.02, rz: slope(t) }, { along: 'z', across: 'x' });
    }
    // Two bearers carry the deck
    for (const side of [-1, 1]) {
      const pts = [];
      for (let i = 0; i <= 16; i++) {
        const t = i / 16;
        pts.push(V((t - 0.5) * (length + 0.36), deckY(t) - 0.07, side * (width / 2 - 0.13)));
      }
      pole(pts, 0.075, palette.woodDark, { radial: 6 });
    }
    // Railings: posts, a top rail to hold and a lower one for small hands
    for (const side of [-1, 1]) {
      const z = side * (width / 2 - 0.035);
      for (const t of [0.03, 0.265, 0.5, 0.735, 0.97]) {
        const x = (t - 0.5) * length;
        board(0.085, 0.86, 0.085, palette.woodDark, { x, y: deckY(t) + 0.4, z }, { along: 'y', across: 'x', r: 0.02 });
        const cap = icoSphere(0.058, 1);
        part(cap, palette.woodLight, { x, y: deckY(t) + 0.85, z, sy: 0.7 });
        solids.push(cap);
      }
      for (const [h, r] of [
        [0.74, 0.042],
        [0.4, 0.028],
      ]) {
        const pts = [];
        for (let i = 0; i <= 18; i++) {
          const t = lerp(0.02, 0.98, i / 18);
          pts.push(V((t - 0.5) * length, deckY(t) + h, z));
        }
        pole(pts, r, palette.woodLight, { radial: 6 });
      }
    }
    const mx = (fx + tx) / 2;
    const mz = (fz + tz) / 2;
    const bridgeParts = woods.slice(local.woods);
    toWorld(bridgeParts, mx, 0, mz, yaw);
    // the post caps were added to solids in bridge space too
    for (let i = solids.length - 10; i < solids.length; i++) place(solids[i], { x: mx, z: mz, ry: yaw });
    // A perch on the rail that faces the opening view
    {
      const t = 0.3;
      const lx = (t - 0.5) * length;
      const lz = -(width / 2 - 0.035);
      anchors.railPerch = V(mx + lx * Math.cos(yaw) + lz * Math.sin(yaw), deckY(t) + 0.74 + 0.044, mz - lx * Math.sin(yaw) + lz * Math.cos(yaw));
      anchors.railYaw = yaw + Math.PI;
    }
    anchors.bridge = V(mx, deckY(0.5) + 0.2, mz);
    anchors.bridgeTop = V(mx, deckY(0.5) + 1.05, mz);
  }

  // ---------- The fallen log ----------
  {
    const { x, z, yaw, length } = PROPS.log;
    const radius = 0.34;
    const y = field.height(x, z) + radius * 0.78;
    const start = woods.length;
    const sStart = solids.length;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(V((t - 0.5) * length, Math.sin(t * Math.PI) * 0.03, Math.sin(t * 5) * 0.035));
    }
    const trunk = tubeGrain(
      tube(pts, (t) => radius * (1 - t * 0.14) * (1 + Math.sin(t * 17) * 0.03), { radial: 14, capStart: false, capEnd: false }),
      length,
      0.42
    );
    const barkA = col(palette.barkDark);
    const barkB = col(palette.barkOak);
    const moss = col(palette.moss);
    const mossLight = col(palette.grassLight);
    paint(trunk, (p, n, i, out) => {
      const blotch = noise.noise3(p.x * 1.7, p.y * 3, p.z * 3);
      out.copy(barkA).lerp(barkB, saturate(0.45 + n.y * 0.4 + blotch * 0.3));
      // Moss has taken the top
      const m = smoothstep(0.35, 0.85, n.y + blotch * 0.45);
      out.lerp(moss, m * 0.85).lerp(mossLight, m * saturate(blotch) * 0.4);
    });
    woods.push(trunk);
    pole([V(length * 0.12, 0.2, 0.1), V(length * 0.16, 0.5, 0.26), V(length * 0.17, 0.62, 0.42)], 0.07, palette.barkOak, { radial: 6 });

    // Cut ends, with their rings
    for (const [end, r] of [
      [-1, radius],
      [1, radius * 0.835],
    ]) {
      const disc = new THREE.CircleGeometry(r * 0.97, 22).deleteAttribute('uv');
      const pale = col(palette.woodLight);
      const ring = col(palette.wood);
      paint(disc, (p, n, i, out) => {
        const d = Math.hypot(p.x, p.y) / r;
        out.copy(pale).lerp(ring, (0.5 + 0.5 * Math.sin(d * 26)) * 0.5 + (d > 0.86 ? 0.5 : 0));
      });
      const tip = end < 0 ? pts[0] : pts[pts.length - 1];
      place(disc, { x: tip.x, y: tip.y, z: tip.z, ry: (end * Math.PI) / 2 });
      solids.push(disc);
    }

    // Mushrooms keep company on the shady side
    const cap = col(palette.red);
    const capLight = col(palette.peach);
    const stem = col(palette.cream);
    for (const [mx, mz, s] of [
      [-0.55, 0.36, 1],
      [-0.34, 0.44, 0.66],
      [-0.72, 0.42, 0.5],
      [0.86, -0.4, 0.8],
    ]) {
      const my = -radius * 0.82;
      const st = lathe(
        [
          [0, 0],
          [0.05, 0],
          [0.036, 0.1],
          [0.03, 0.2],
          [0, 0.2],
        ],
        8
      );
      part(st, stem, { x: mx, y: my, z: mz, s });
      const top = lathe(
        [
          [0, 0.17],
          [0.13, 0.165],
          [0.135, 0.19],
          [0.1, 0.25],
          [0.05, 0.285],
          [0, 0.295],
        ],
        12
      );
      paint(top, (p, n, i, out) => out.copy(cap).lerp(capLight, saturate(n.y * 0.5 + (p.y - 0.2) * 3)));
      place(top, { x: mx, y: my, z: mz, s });
      solids.push(st, top);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * TAU + mx * 7;
        const rr = k % 2 ? 0.045 : 0.088;
        const dot = icoSphere(0.017, 1);
        part(dot, palette.white, { x: mx + Math.cos(a) * rr * s, y: my + (k % 2 ? 0.287 : 0.26) * s, z: mz + Math.sin(a) * rr * s, sx: s, sy: 0.55 * s, sz: s });
        solids.push(dot);
      }
    }
    toWorld(woods.slice(start), x, y, z, yaw);
    toWorld(solids.slice(sStart), x, y, z, yaw);
    anchors.log = V(x, y + radius + 0.15, z);
    anchors.logTop = { point: V(x, y + radius * 0.955 + 0.028, z), yaw };
  }

  // ---------- The picnic ----------
  {
    const { x, z, yaw } = PROPS.picnic;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const world = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const base = field.height(x, z);

    // The blanket follows the ground and keeps a few soft folds
    const w = 2.3;
    const d = 1.7;
    const nx = 24;
    const nz = 16;
    const sheet = new THREE.PlaneGeometry(w, d, nx, nz).deleteAttribute('uv');
    sheet.rotateX(-Math.PI / 2);
    {
      const pos = sheet.attributes.position;
      const local = new Float32Array(pos.count * 2);
      for (let i = 0; i < pos.count; i++) {
        const lx = pos.getX(i);
        const lz = pos.getZ(i);
        local[i * 2] = lx;
        local[i * 2 + 1] = lz;
        const [wx, wz] = world(lx, lz);
        const fold = noise.noise2(lx * 2.2, lz * 2.2) * 0.012 + Math.max(0, noise.noise2(lx * 0.9 + 4, lz * 0.9)) * 0.03;
        // One corner is turned back on itself
        const corner = saturate((lx - 0.72) / 0.43) * saturate((lz - 0.45) / 0.4);
        pos.setXYZ(i, wx, field.height(wx, wz) + 0.03 + fold + corner * corner * 0.1, wz);
      }
      sheet.setAttribute('local', new THREE.BufferAttribute(local, 2));
      sheet.computeVertexNormals();
    }
    // Colour by the square each triangle belongs to, so the checks stay crisp
    const g = sheet.toNonIndexed();
    {
      const a = col(palette.blanketA);
      const b = col(palette.blanketB);
      const edge = col(brand.peach.dot);
      const local = g.attributes.local;
      const colors = new Float32Array(local.count * 3);
      for (let t = 0; t < local.count; t += 3) {
        const lx = (local.getX(t) + local.getX(t + 1) + local.getX(t + 2)) / 3;
        const lz = (local.getY(t) + local.getY(t + 1) + local.getY(t + 2)) / 3;
        const check = (Math.floor((lx + w / 2) / (w / 6)) + Math.floor((lz + d / 2) / (d / 4))) % 2;
        const border = Math.abs(lx) > w / 2 - w / nx || Math.abs(lz) > d / 2 - d / nz;
        const c = border ? edge : check ? a : b;
        for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t + k) * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute('local');
    }
    sheet.dispose();
    solids.push(g);

    const put = (geom, lx, lz, y = 0, ry = 0, sc = 1) => {
      const [wx, wz] = world(lx, lz);
      place(geom, { x: wx, y: field.height(wx, wz) + 0.045 + y, z: wz, ry: ry + yaw, s: sc });
      solids.push(geom);
    };

    // Basket: woven sides, a handle, a cloth tucked in
    {
      const basket = lathe(
        [
          [0, 0],
          [0.25, 0],
          [0.29, 0.05],
          [0.33, 0.3],
          [0.345, 0.34],
          [0.31, 0.34],
          [0.29, 0.1],
          [0, 0.08],
        ],
        18
      );
      const light = col(palette.basket);
      const dark = col(palette.basketDark);
      paint(basket, (p, n, i, out) => {
        const ang = Math.atan2(p.z, p.x);
        const weave = (Math.floor(ang * 5.1) + Math.floor(p.y * 26)) % 2;
        out.copy(weave ? light : dark).lerp(light, 0.35);
      });
      put(basket, -0.62, -0.3);
      const handle = tube(curvePoints([V(-0.32, 0.32, 0), V(-0.24, 0.56, 0), V(0, 0.66, 0), V(0.24, 0.56, 0), V(0.32, 0.32, 0)], 14), 0.022, { radial: 6 });
      paintSolid(handle, dark);
      put(handle, -0.62, -0.3, 0, 0.5);
      const cloth = blob(0.27, 2, noise, { amp: 0.16, squashY: 0.42, seed: 3 });
      part(cloth, palette.cream);
      put(cloth, -0.62, -0.3, 0.3);
    }
    // Apples
    for (const [lx, lz, y, tone] of [
      [-0.5, -0.26, 0.42, 0],
      [-0.72, -0.34, 0.4, 0.3],
      [-0.12, 0.1, 0.06, 0.1],
      [0.05, 0.28, 0.06, 0.5],
    ]) {
      const apple = icoSphere(0.07, 2);
      const red = col(palette.apple);
      const gold = col(palette.butter);
      paint(apple, (p, n, i, out) => out.copy(red).lerp(gold, saturate(tone + p.x * 5 + n.y * 0.2 - 0.25)));
      place(apple, { sy: 0.9 });
      put(apple, lx, lz, y);
      const stalk = tube([V(0, 0.05, 0), V(0.012, 0.095, 0)], 0.006, { radial: 4 });
      part(stalk, palette.barkDark);
      put(stalk, lx, lz, y);
    }
    // A book left open face-down, two cups
    {
      const cover = roundedBox(0.3, 0.035, 0.22, 0.01, 1);
      part(cover, brand.primaryLight);
      put(cover, 0.5, -0.36, 0.01, 0.4);
      const pages = roundedBox(0.28, 0.03, 0.2, 0.006, 1);
      part(pages, palette.cream);
      put(pages, 0.5, -0.36, -0.012, 0.4);
      for (const [lx, lz, hex] of [
        [0.2, -0.05, brand.butter.dot],
        [0.42, 0.12, brand.lilac.mid],
      ]) {
        const cup = lathe(
          [
            [0, 0],
            [0.04, 0],
            [0.052, 0.09],
            [0.045, 0.09],
            [0.036, 0.012],
            [0, 0.012],
          ],
          12
        );
        part(cup, hex);
        put(cup, lx, lz);
      }
    }
    // The bear who came along
    {
      const fur = col('#D2A679');
      const pale = col('#F0D9B8');
      const bits = [];
      const ball = (r, lx, ly, lz, color = fur, sx = 1, sy = 1, sz = 1) => {
        const sph = icoSphere(r, 2);
        part(sph, color, { x: lx, y: ly, z: lz, sx, sy, sz });
        bits.push(sph);
      };
      ball(0.15, 0, 0.15, 0, fur, 1, 1.08, 0.95); // body
      ball(0.075, 0, 0.14, 0.11, pale, 1, 1.05, 0.5); // tummy
      ball(0.115, 0, 0.36, 0.02); // head
      ball(0.05, 0, 0.335, 0.115, pale, 1.1, 0.85, 0.9); // muzzle
      ball(0.016, 0, 0.352, 0.16, col(palette.ink)); // nose
      for (const side of [-1, 1]) {
        ball(0.042, side * 0.085, 0.455, 0, fur, 1, 1, 0.6); // ears
        ball(0.022, side * 0.085, 0.455, 0.018, pale, 1, 1, 0.5);
        ball(0.013, side * 0.045, 0.385, 0.108, col(palette.ink)); // eyes
        ball(0.055, side * 0.16, 0.2, 0.05, fur, 0.85, 1.5, 0.85); // arms
        ball(0.062, side * 0.1, 0.05, 0.14, fur, 0.9, 0.85, 1.45); // legs
        ball(0.036, side * 0.1, 0.055, 0.225, pale, 1, 1, 0.4); // paw pads
      }
      for (const bit of bits) put(bit, 0.72, 0.38, 0, -0.9);
    }
    anchors.picnic = V(x, base + 0.5, z);
  }

  // ---------- The beach: a cairn, a bucket and spade, small boots ----------
  {
    // Stacked pebbles, as on the sticker
    const { x, z } = PROPS.cairn;
    let y = field.height(x, z) - 0.03;
    const tones = [palette.rock, palette.sand, '#B9CDE8', palette.cream, '#B5DCC2'];
    [0.2, 0.165, 0.135, 0.105, 0.078].forEach((r, i) => {
      const stone = blob(r, 2, noise, { amp: 0.12, freq: 1.6, squashY: 0.46, seed: i * 9 + 2 });
      const base = col(tones[i]);
      paint(stone, (p, n, vi, out) => {
        const lit = saturate((n.dot(LIGHT) + 0.3) / 1.2);
        out.copy(base).multiplyScalar(lerp(0.8, 1.06, lit));
      });
      y += r * 0.44;
      place(stone, { x: x + rng.range(-0.02, 0.02), y, z: z + rng.range(-0.02, 0.02), ry: rng.range(0, TAU) });
      y += r * 0.4;
      solids.push(stone);
    });
    anchors.cairn = V(x, y + 0.1, z);

    // Scattered pebbles on the sand
    const beach = PROPS.beach;
    for (let i = 0; i < 26; i++) {
      const px = beach.x + rng.gauss() * 1.0;
      const pz = beach.z + rng.gauss() * 0.55;
      if (field.shore(px, pz) < 0.05 || field.shore(px, pz) > 1.5) continue;
      const r = rng.range(0.035, 0.085);
      const pebble = blob(r, 1, noise, { amp: 0.1, squashY: 0.5, seed: i });
      part(pebble, vary(rng.pick([palette.rock, palette.rockWarm, palette.cream, palette.rockLight, '#C7D3E6']), rng, { l: 0.05 }), { x: px, y: field.height(px, pz) + r * 0.2, z: pz, ry: rng.range(0, TAU) });
      solids.push(pebble);
    }

    // Bucket and spade
    const b = PROPS.bucket;
    const by = field.height(b.x, b.z);
    const bucket = lathe(
      [
        [0, 0],
        [0.105, 0],
        [0.145, 0.2],
        [0.158, 0.205],
        [0.158, 0.222],
        [0.13, 0.222],
        [0.095, 0.02],
        [0, 0.02],
      ],
      16
    );
    paint(bucket, (p, n, i, out) => out.copy(col(palette.bucket)).lerp(col(brand.butter.dot), p.y > 0.198 ? 1 : 0));
    place(bucket, { x: b.x, y: by + 0.005, z: b.z, rz: 0.06 });
    solids.push(bucket);
    const handle = tube(curvePoints([V(-0.15, 0.2, 0), V(-0.12, 0.34, 0.03), V(0, 0.39, 0.05), V(0.12, 0.34, 0.03), V(0.15, 0.2, 0)], 12), 0.009, { radial: 5 });
    part(handle, brand.butter.dot, { x: b.x, y: by, z: b.z, ry: 0.7 });
    solids.push(handle);
    const sand = blob(0.12, 2, noise, { amp: 0.1, squashY: 0.3, seed: 8 });
    part(sand, palette.sandWet, { x: b.x, y: by + 0.2, z: b.z });
    solids.push(sand);
    const spadeHandle = tube([V(0, 0.02, 0), V(0.34, 0.06, 0)], 0.014, { radial: 6 });
    part(spadeHandle, brand.peach.dot, { x: b.x - 0.42, y: by + 0.01, z: b.z + 0.26, ry: 0.5 });
    const blade = roundedBox(0.16, 0.014, 0.12, 0.006, 1);
    part(blade, brand.peach.dot, { x: -0.07, y: 0.02 });
    place(blade, { x: b.x - 0.42, y: by + 0.01, z: b.z + 0.26, ry: 0.5 });
    solids.push(spadeHandle, blade);

    // A small pair of yellow boots, left where the paddling began
    for (const [dx, dz, turn] of [
      [0.62, -0.42, 0.3],
      [0.78, -0.3, 0.55],
    ]) {
      const bx = b.x + dx;
      const bz = b.z + dz;
      const y0 = field.height(bx, bz);
      const shaft = lathe(
        [
          [0, 0],
          [0.052, 0],
          [0.05, 0.1],
          [0.058, 0.2],
          [0.064, 0.21],
          [0.05, 0.21],
          [0, 0.04],
        ],
        10
      );
      const foot = icoSphere(1, 2);
      place(foot, { sx: 0.056, sy: 0.042, sz: 0.1, z: 0.055, y: 0.04 });
      const boot = merge([shaft, foot]);
      paint(boot, (p, n, i, out) => out.copy(col(palette.butter)).lerp(col('#F7E7A6'), saturate(n.y * 0.6 + 0.1)));
      place(boot, { x: bx, y: y0, z: bz, ry: turn });
      solids.push(boot);
    }
    anchors.beach = V(beach.x, field.height(beach.x, beach.z) + 0.45, beach.z);
  }

  // ---------- A signpost by the bridge ----------
  {
    const { x, z, yaw } = PROPS.sign;
    const y = field.height(x, z);
    const start = woods.length;
    pole([V(0, -0.1, 0), V(0, 1.18, 0)], 0.045, palette.woodDark, { radial: 7 });
    board(0.62, 0.17, 0.035, palette.woodLight, { x: 0.2, y: 1.0, z: 0.04, rz: 0.04 }, { across: 'y' });
    board(0.5, 0.15, 0.035, palette.wood, { x: -0.16, y: 0.76, z: 0.04, rz: -0.05 }, { across: 'y' });
    toWorld(woods.slice(start), x, y, z, yaw);
  }

  // ---------- Bunting between the birches ----------
  const buntingParts = [];
  if (trees.anchors.birches?.length >= 3) {
    const tints = [brand.sky.dot, brand.peach.dot, brand.butter.dot, brand.sage.dot, brand.lilac.dot];
    const at = (i, h) => {
      const b = trees.anchors.birches[i];
      const t = saturate(h / b.height);
      const f = t * (b.points.length - 1);
      const k = Math.min(Math.floor(f), b.points.length - 2);
      return b.points[k].clone().lerp(b.points[k + 1], f - k);
    };
    let flag = 0;
    for (const [a, b] of [
      [at(1, 2.0), at(0, 2.35)],
      [at(0, 2.35), at(2, 1.9)],
    ]) {
      const span = a.distanceTo(b);
      const sag = span * 0.11;
      const line = [];
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        line.push(a.clone().lerp(b, t).setY(lerp(a.y, b.y, t) - Math.sin(t * Math.PI) * sag));
      }
      const cord = tube(line, 0.008, { radial: 4 });
      paintSolid(cord, col(palette.cream));
      setSway(cord, () => 0);
      buntingParts.push(cord);
      const dir = b.clone().sub(a).setY(0).normalize();
      const count = Math.floor(span / 0.34);
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        const f = t * 20;
        const i = Math.min(Math.floor(f), 19);
        const p = line[i].clone().lerp(line[i + 1], f - i);
        const hw = 0.115;
        const drop = 0.27;
        const g = new THREE.BufferGeometry();
        g.setAttribute(
          'position',
          new THREE.Float32BufferAttribute([p.x - dir.x * hw, p.y, p.z - dir.z * hw, p.x + dir.x * hw, p.y, p.z + dir.z * hw, p.x, p.y - drop, p.z], 3)
        );
        g.setIndex([0, 1, 2]);
        const nx = -dir.z;
        const nz = dir.x;
        g.setAttribute('normal', new THREE.Float32BufferAttribute([nx, 0.5, nz, nx, 0.5, nz, nx, 0.5, nz], 3));
        paintSolid(g, col(tints[flag++ % tints.length]));
        g.setAttribute('sway', new THREE.Float32BufferAttribute([0, 0, 0.09], 1));
        buntingParts.push(g);
      }
    }
    anchors.bunting = at(0, 2.35);

    // A birdhouse on the tallest birch
    const p = at(0, 2.95);
    const hx = p.x + 0.02;
    const hz = p.z + 0.2;
    board(0.26, 0.28, 0.2, palette.cream, { x: hx, y: p.y, z: hz }, { along: 'y', across: 'x', r: 0.015 });
    for (const side of [-1, 1]) board(0.22, 0.03, 0.26, brand.primaryLight, { x: hx + side * 0.075, y: p.y + 0.19, z: hz, rz: -side * 0.7 }, { along: 'z', across: 'x', r: 0.008 });
    const hole = new THREE.CircleGeometry(0.045, 14).deleteAttribute('uv');
    part(hole, palette.ink, { x: hx, y: p.y + 0.03, z: hz + 0.102 });
    solids.push(hole);
    pole([V(hx, p.y - 0.06, hz + 0.1), V(hx, p.y - 0.06, hz + 0.19)], 0.012, palette.woodDark, { radial: 5 });
    anchors.birdhouse = V(hx, p.y - 0.04, hz + 0.19);
  }

  // ---------- Assemble the static parts ----------
  group.add(mesh(merge(woods, { keepUv: true }), kit.wood, { name: 'timber' }));
  group.add(mesh(merge(solids), kit.solid, { name: 'things' }));
  if (buntingParts.length) group.add(mesh(merge(buntingParts), kit.solidDouble, { name: 'bunting', cast: false }));

  // ---------- The toy sailboat ----------
  {
    const boat = new THREE.Group();
    boat.name = 'boat';
    const hull = icoSphere(1, 3);
    const hullDark = col(brand.primaryLight);
    const hullLight = col(palette.cream);
    const deck = col(palette.woodLight);
    const posAttr = hull.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      let px = posAttr.getX(i) * 0.46;
      let py = posAttr.getY(i) * 0.2;
      const pz = posAttr.getZ(i) * 0.19 * (1 - Math.max(0, posAttr.getX(i)) * 0.35);
      if (py > 0.055) py = 0.055 + (py - 0.055) * 0.08; // flat deck
      if (px > 0.3) py += (px - 0.3) * 0.25; // lifted bow
      posAttr.setXYZ(i, px, py, pz);
    }
    hull.computeVertexNormals();
    paint(hull, (p, n, i, out) => {
      if (n.y > 0.75 && p.y > 0.04) out.copy(deck);
      else out.copy(p.y < -0.03 ? hullDark : hullLight);
    });
    const mast = tube([V(0.03, 0.04, 0), V(0.03, 0.78, 0)], 0.013, { radial: 6 });
    part(mast, palette.woodDark);
    const boom = tube([V(0.03, 0.13, 0), V(-0.36, 0.13, 0)], 0.009, { radial: 5 });
    part(boom, palette.woodDark);
    boat.add(mesh(merge([hull, mast, boom]), kit.solid, { name: 'hull' }));

    // Sails: bellied triangles
    const sail = (a, b, c, hex, belly) => {
      const n = 6;
      const position = [];
      const index = [];
      const idx = [];
      for (let i = 0; i <= n; i++) {
        idx.push([]);
        for (let j = 0; j <= n - i; j++) {
          const u = i / n;
          const v = j / n;
          const w = 1 - u - v;
          const p = V(0, 0, 0).addScaledVector(a, w).addScaledVector(b, u).addScaledVector(c, v);
          p.z += belly * 27 * u * v * w;
          idx[i].push(position.length / 3);
          position.push(p.x, p.y, p.z);
        }
      }
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n - i; j++) {
          index.push(idx[i][j], idx[i + 1][j], idx[i][j + 1]);
          if (j < n - i - 1) index.push(idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      g.setIndex(index);
      g.computeVertexNormals();
      const base = col(hex);
      paint(g, (p, nn, i, out) => out.copy(base).multiplyScalar(lerp(0.9, 1.05, saturate(p.y / 0.7))));
      setSway(g, () => 0);
      return g;
    };
    const main = sail(V(0.02, 0.16, 0), V(0.02, 0.76, 0), V(-0.36, 0.16, 0), palette.white, 0.035);
    const jib = sail(V(0.05, 0.14, 0), V(0.04, 0.68, 0), V(0.4, 0.12, 0), palette.sailLight, 0.028);
    const pennant = sail(V(0.03, 0.78, 0), V(0.03, 0.86, 0), V(-0.14, 0.82, 0), palette.peach, 0.01);
    boat.add(mesh(merge([main, jib, pennant]), kit.solidDouble, { name: 'sails' }));
    boat.scale.setScalar(1.1);
    group.add(boat);

    // It idles round a small loop on the pool, nosing into its own wake
    const home = PROPS.boat;
    let wake = 0;
    updaters.push((time, dt) => {
      const a = time * 0.11;
      const x = home.x + Math.cos(a) * 1.25 + Math.sin(a * 2.3) * 0.25;
      const z = home.z + Math.sin(a) * 0.62;
      const heading = Math.atan2(-(Math.cos(a) * 0.62), -Math.sin(a) * 1.25 + Math.cos(a * 2.3) * 0.25 * 2.3);
      boat.position.set(x, water.level(x, z) + 0.035 + Math.sin(time * 1.3) * 0.012, z);
      boat.rotation.set(Math.sin(time * 1.1) * 0.045, heading, Math.sin(time * 0.9 + 1) * 0.06 + 0.05, 'YXZ');
      wake -= dt;
      if (wake <= 0) {
        water.addRipple(x - Math.cos(heading) * 0.4, z + Math.sin(heading) * 0.4, 0.42);
        wake = 1.5;
      }
    });
    anchors.boat = boat;
  }

  // ---------- The kite ----------
  {
    const kite = new THREE.Group();
    kite.name = 'kite';
    const quads = [brand.peach.dot, brand.butter.dot, brand.sky.dot, brand.lilac.dot];
    const top = V(0, 0.62, 0);
    const right = V(0.42, 0.12, -0.05);
    const bottom = V(0, -0.62, 0);
    const left = V(-0.42, 0.12, -0.05);
    const centre = V(0, 0.12, 0.09);
    const parts = [];
    [
      [top, right],
      [right, bottom],
      [bottom, left],
      [left, top],
    ].forEach(([a, b], i) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([centre.x, centre.y, centre.z, a.x, a.y, a.z, b.x, b.y, b.z], 3));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      paintSolid(g, col(quads[i]));
      setSway(g, () => 0);
      parts.push(g);
    });
    for (const [a, b] of [
      [top, bottom],
      [left, right],
    ]) {
      const spar = tube([a.clone().setZ(a.z + 0.012), centre.clone().setZ(centre.z + 0.012), b.clone().setZ(b.z + 0.012)], 0.008, { radial: 4 });
      paintSolid(spar, col(palette.woodDark));
      setSway(spar, () => 0);
      parts.push(spar);
    }
    // The tail: bows on a ribbon, each swinging a little more than the last
    const bows = [brand.butter.dot, brand.peach.dot, brand.sky.dot, brand.sage.dot, brand.lilac.dot];
    const ribbon = [];
    for (let k = 0; k <= 12; k++) ribbon.push(V(Math.sin(k * 0.9) * 0.04, -0.62 - k * 0.14, -0.02 * k));
    const tail = tube(ribbon, 0.011, { radial: 4 });
    paintSolid(tail, col(palette.cream));
    setSway(tail, (p) => Math.pow(saturate((-0.62 - p.y) / 1.7), 1.3) * 0.5);
    parts.push(tail);
    bows.forEach((hex, k) => {
      const y = -0.86 - k * 0.3;
      const g = new THREE.BufferGeometry();
      const z = -0.02 * ((y + 0.62) / -0.14);
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, y, z, -0.1, y + 0.05, z, -0.1, y - 0.05, z, 0.1, y + 0.05, z, 0.1, y - 0.05, z], 3));
      g.setIndex([0, 1, 2, 0, 4, 3]);
      g.computeVertexNormals();
      paintSolid(g, col(hex));
      const sw = Math.pow(saturate((-0.62 - y) / 1.7), 1.3) * 0.5;
      setSway(g, () => sw);
      parts.push(g);
    });
    const body = mesh(merge(parts), kit.solidDouble, { name: 'kite-body', cast: true });
    kite.add(body);
    kite.scale.setScalar(1.35);
    group.add(kite);

    // The line runs down to a peg in the meadow
    const [ax, az] = PROPS.kite.anchor;
    const ay = field.height(ax, az);
    const peg = tubeGrain(tube([V(ax, ay - 0.05, az), V(ax + 0.03, ay + 0.26, az)], 0.022, { radial: 6 }), 0.3);
    paintSolid(peg, col(palette.woodDark));
    group.add(mesh(peg, kit.wood, { name: 'kite-peg' }));

    const SEG = 18;
    const linePos = new Float32Array((SEG + 1) * 3);
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: col(palette.cream), transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    group.add(line);

    const home = PROPS.kite;
    updaters.push((time) => {
      const x = home.x + Math.sin(time * 0.31) * 0.9 + Math.sin(time * 0.83) * 0.25;
      const y = home.y + Math.sin(time * 0.47 + 1) * 0.4 + Math.sin(time * 1.3) * 0.1;
      const z = home.z + Math.cos(time * 0.27) * 0.7;
      kite.position.set(x, y, z);
      // Nose up into the wind, face turned down the line, wagging a little
      kite.rotation.set(0.5 + Math.sin(time * 0.9) * 0.08, Math.atan2(ax - x, az - z) + 0.5 + Math.sin(time * 0.41) * 0.2, Math.sin(time * 1.2) * 0.14, 'YXZ');
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const belly = Math.sin(t * Math.PI) * 0.9;
        linePos[i * 3] = lerp(ax + 0.03, x, t) + belly * 0.35;
        linePos[i * 3 + 1] = lerp(ay + 0.26, y, Math.pow(t, 1.25)) - belly * 0.1;
        linePos[i * 3 + 2] = lerp(az, z, t) + belly * 0.2;
      }
      lineGeom.attributes.position.needsUpdate = true;
    });
    anchors.kite = kite;
    anchors.kitePeg = V(ax, ay + 0.3, az);
  }

  function update(time, dt) {
    for (const fn of updaters) fn(time, dt);
  }

  return { group, anchors, update };
}
