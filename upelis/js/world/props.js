import * as THREE from '../core/three.js';
import { TAU, createRng, ease, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, brand, col } from '../core/palette.js';
import { season } from '../core/season.js';
import { icoSphere, roundedBox, tube, curvePoints, lathe, blob, place, displace, paint, paintSolid, setSway, merge } from '../core/geo.js';
import { shadeByOpenness } from '../core/models.js';
import { mesh, part, grainUv, tubeGrain, vary } from './kit.js';
import { BRIDGE, CAMERA, PROPS } from './layout.js';

// The made things: the bridge, the fallen log, the picnic, the toys on the
// beach, the little boat, the kite, the bunting. Small, but they are what
// makes the place feel visited. Some stay all year; the rest belong to a
// season and are brought out and put away with it.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const LIGHT = new THREE.Vector3(-0.45, 0.82, 0.36).normalize();
const KINDS = ['solid', 'wood', 'double', 'flat'];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

const ball = (hex, r, placement, detail = 1) => part(icoSphere(r, detail), hex, placement);

export function createProps(field, kit, trees, water, models = {}) {
  const group = new THREE.Group();
  group.name = 'props';
  const rng = createRng(555);
  const noise = field.noise;
  const anchors = {};
  const updaters = [];

  // Static parts are gathered by material and merged at the end
  const solids = [];
  const woods = [];
  // Loose stones take the rock's own material: the same grain, nothing growing on them
  const stones = [];
  const loose = (g) => {
    const lives = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < lives.length; i += 3) lives.set([-1, 1, 0], i);
    g.setAttribute('aStone', new THREE.BufferAttribute(lives, 3));
    stones.push(g);
    return g;
  };
  // Where boards and poles are gathered: the static timber, or a seasonal set's
  let timber = woods;

  const board = (w, h, d, hex, placement, { along = 'x', across = 'z', r = 0.012 } = {}) => {
    const g = grainUv(roundedBox(w, h, d, r, 1), along, across, 0.42, rng.range(0, 1));
    part(g, typeof hex === 'string' ? vary(hex, rng, { l: 0.045, s: 0.03 }) : hex, placement);
    timber.push(g);
    return g;
  };
  const pole = (points, radius, hex, { radial = 7 } = {}) => {
    let length = 0;
    for (let i = 1; i < points.length; i++) length += points[i].distanceTo(points[i - 1]);
    const g = tubeGrain(tube(points, radius, { radial }), length, 0.42, rng.range(0, 1));
    part(g, typeof hex === 'string' ? vary(hex, rng, { l: 0.04 }) : hex);
    timber.push(g);
    return g;
  };

  // ---------- Things that come and go with the year ----------
  // A set is drawn as one mesh to a material. Every thing in it remembers the
  // spot it stands on and its turn, so a set comes up out of the ground thing
  // by thing, and is put away the same way.
  const sets = [];
  const stamp = (g, x, y, z, order = 0) => {
    const n = g.attributes.position.count;
    const pop = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) pop.set([x, y, z, order], i * 4);
    g.setAttribute('aPop', new THREE.BufferAttribute(pop, 4));
    return g;
  };
  const seasonal = (name, track) => {
    const set = { name, track, uPop: { value: season.row(1) }, solid: [], wood: [], double: [], flat: [], meshes: [] };
    sets.push(set);
    return set;
  };
  // Builds one thing in its own space, then stands it on the ground at (x, z)
  const stand = (set, { x, z, y = field.height(x, z), yaw = 0, s = 1, order = 0 }, build) => {
    const marks = KINDS.map((kind) => set[kind].length);
    timber = set.wood;
    build(set);
    timber = woods;
    KINDS.forEach((kind, k) => {
      for (let i = marks[k]; i < set[kind].length; i++) stamp(place(set[kind][i], { x, y, z, ry: yaw, s }), x, y, z, order);
    });
    return V(x, y, z);
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
    // Any point along the top of a hand rail, for whatever is stood on it
    anchors.rail = (t, side = -1) => {
      const lx = (t - 0.5) * length;
      const lz = side * (width / 2 - 0.035);
      return V(mx + lx * Math.cos(yaw) + lz * Math.sin(yaw), deckY(t) + 0.74 + 0.042, mz - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    };
    anchors.bridge = V(mx, deckY(0.5) + 0.2, mz);
    anchors.bridgeTop = V(mx, deckY(0.5) + 1.05, mz);
  }

  // ---------- The fallen log ----------
  {
    const { x, z, yaw, length } = PROPS.log;
    const radius = 0.34;
    const y = field.height(x, z) + radius * 0.78;
    // It has kept its bark, so it is drawn as the trees are and not as sawn timber
    const rind = [];
    const sStart = solids.length;
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(V((t - 0.5) * length, Math.sin(t * Math.PI) * 0.03, Math.sin(t * 5) * 0.035));
    }
    // Modelled in Blender along the same line: bark in plates, a branch
    // broken off short, one end sawn and the other snapped and hollow
    const model = models.log;
    const trunk = model ? model.rind.geometry : tube(pts, (t) => radius * (1 - t * 0.14) * (1 + Math.sin(t * 17) * 0.03), { radial: 16, capStart: false, capEnd: false });
    if (!model) {
      // The sheet of bark goes twice round it, and keeps its scale along it
      const uv = trunk.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i) * length * 0.78);
    }
    const barkA = col(palette.barkDark);
    const barkB = col(palette.barkOak);
    const mossy = new Float32Array(trunk.attributes.position.count);
    paint(trunk, (p, n, i, out) => {
      const blotch = noise.noise3(p.x * 1.7, p.y * 3, p.z * 3);
      out.copy(barkA).lerp(barkB, saturate(0.45 + n.y * 0.4 + blotch * 0.3));
      // Underneath, where it lies in the damp, it has gone dark
      out.multiplyScalar(lerp(0.66, 1, smoothstep(-0.95, -0.15, n.y)));
      // Moss has taken the top (aMoss)
      mossy[i] = saturate(smoothstep(0.1, 0.85, n.y + blotch * 0.5) * 0.95 + blotch * 0.12);
    });
    trunk.setAttribute('aMoss', new THREE.BufferAttribute(mossy, 1));
    const stubPts = [V(length * 0.12, 0.2, 0.1), V(length * 0.16, 0.5, 0.26), V(length * 0.17, 0.62, 0.42)];
    const stub = tube(stubPts, 0.07, { radial: 7 });
    paintSolid(stub, vary(palette.barkOak, rng, { l: 0.04 }));
    rind.push(trunk);
    if (model) {
      shadeByOpenness(model.rind, 0.55);
      // The sawn face, the hollow and the snapped stub come with their own colours
      shadeByOpenness(model.wood, 0.4);
      solids.push(model.wood.geometry);
    } else rind.push(stub);

    // Cut ends, with their rings (the model brings its own)
    if (!model) {
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
    toWorld(rind, x, y, z, yaw);
    group.add(mesh(merge(rind, { keepUv: true, keep: ['aMoss'] }), kit.bark, { name: 'log' }));
    toWorld(solids.slice(sStart), x, y, z, yaw);
    anchors.log = V(x, y + radius + 0.15, z);
    anchors.logTop = { point: V(x, y + radius * 0.955 + 0.028, z), yaw };
  }

  // ---------- The picnic ----------
  // Laid out from late spring until the leaves are down
  const picnic = seasonal('picnic', (v) => v.picnic);
  {
    const { x, z, yaw } = PROPS.picnic;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const world = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    const base = field.height(x, z);
    const solids = picnic.solid;
    // The blanket is spread first, then everything is set down on it in turn
    let turn = 0;

    // The blanket follows the ground and keeps the creases it was shaken out
    // with, except where something stands on it: [x, z, reach]
    const w = 2.3;
    const d = 1.7;
    const nx = 36;
    const nz = 24;
    const pressed = [
      [-0.62, -0.3, 0.38],
      [-0.12, 0.1, 0.11],
      [0.05, 0.28, 0.11],
      [0.5, -0.36, 0.24],
      [0.2, -0.05, 0.09],
      [0.42, 0.12, 0.09],
      [0.72, 0.38, 0.27],
    ];
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
        let free = 1;
        for (const [px, pz, reach] of pressed) free = Math.min(free, smoothstep(reach, reach + 0.2, Math.hypot(lx - px, lz - pz)));
        const crease = Math.pow(1 - Math.abs(noise.noise2(lx * 1.2 + 7.3, lz * 1.2 - 2.1)), 3) * 0.034 * free;
        const fold = noise.noise2(lx * 2.2, lz * 2.2) * 0.012 + Math.max(0, noise.noise2(lx * 0.9 + 4, lz * 0.9)) * 0.03 + crease;
        // One corner is turned back on itself
        const corner = saturate((lx - 0.72) / 0.43) * saturate((lz - 0.45) / 0.4);
        pos.setXYZ(i, wx, field.height(wx, wz) + 0.03 + fold + corner * corner * 0.1, wz);
      }
      sheet.setAttribute('local', new THREE.BufferAttribute(local, 2));
      sheet.computeVertexNormals();
    }
    // Gingham: coloured stripes woven both ways, deepest where two of them
    // cross. Colour goes by the square each triangle belongs to, so the checks
    // stay crisp.
    const g = sheet.toNonIndexed();
    {
      const white = col(palette.blanketB);
      const woven = col(palette.blanketA);
      const crossed = col(brand.peach.dot);
      const hem = crossed.clone().lerp(col(brand.peach.ink), 0.3);
      const local = g.attributes.local;
      const colors = new Float32Array(local.count * 3);
      for (let t = 0; t < local.count; t += 3) {
        const lx = (local.getX(t) + local.getX(t + 1) + local.getX(t + 2)) / 3;
        const lz = (local.getY(t) + local.getY(t + 1) + local.getY(t + 2)) / 3;
        const stripes = (Math.floor((lx + w / 2) / (w / 12)) % 2) + (Math.floor((lz + d / 2) / (d / 8)) % 2);
        const border = Math.abs(lx) > w / 2 - w / nx || Math.abs(lz) > d / 2 - d / nz;
        const c = border ? hem : stripes === 2 ? crossed : stripes === 1 ? woven : white;
        for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t + k) * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      g.deleteAttribute('local');
    }
    sheet.dispose();
    solids.push(stamp(g, x, base + 0.03, z, 0));

    const put = (geom, lx, lz, y = 0, ry = 0, sc = 1) => {
      const [wx, wz] = world(lx, lz);
      const ground = field.height(wx, wz) + 0.045;
      place(geom, { x: wx, y: ground + y, z: wz, ry: ry + yaw, s: sc });
      solids.push(stamp(geom, wx, ground, wz, turn));
    };

    // Basket: woven sides, a handle, a cloth tucked in
    turn = 0.3;
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
      // The shell is what shows between the strands, and inside
      paintSolid(basket, dark.clone().lerp(light, 0.2).multiplyScalar(0.9));
      put(basket, -0.62, -0.3);
      // The weave: a strand goes over one stake and under the next, and the
      // row above it does the opposite. Where it goes over it stands proud.
      {
        const stakes = 22;
        const rows = 7;
        const wall = (y) => (y < 0.05 ? lerp(0.25, 0.29, y / 0.05) : lerp(0.29, 0.33, (y - 0.05) / 0.25));
        const at = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
        const position = [];
        const colors = [];
        for (let j = 0; j < rows; j++) {
          const y0 = lerp(0.006, 0.3, j / rows);
          const y1 = lerp(0.006, 0.3, (j + 1) / rows);
          for (let i = 0; i < stakes; i++) {
            const over = (i + j) % 2 === 0;
            const a0 = (i / stakes) * TAU;
            const a1 = ((i + 1) / stakes) * TAU;
            const am = (a0 + a1) / 2;
            const proud = over ? 0.017 : 0.003;
            const b0 = at(a0, wall(y0) + 0.003, y0);
            const bm = at(am, wall(y0) + proud, y0);
            const b1 = at(a1, wall(y0) + 0.003, y0);
            const t0 = at(a0, wall(y1) + 0.003, y1);
            const tm = at(am, wall(y1) + proud, y1);
            const t1 = at(a1, wall(y1) + 0.003, y1);
            position.push(...b0, ...t0, ...bm, ...bm, ...t0, ...tm, ...bm, ...tm, ...b1, ...b1, ...tm, ...t1);
            _c.copy(over ? light : dark).multiplyScalar(rng.range(0.93, 1.07));
            for (let k = 0; k < 12; k++) colors.push(_c.r, _c.g, _c.b);
          }
        }
        const woven = new THREE.BufferGeometry();
        woven.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
        woven.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
        woven.computeVertexNormals();
        put(woven, -0.62, -0.3);
        // ...and the rim is bound round with a thicker one
        const rim = new THREE.TorusGeometry(0.336, 0.021, 6, 26).deleteAttribute('uv');
        rim.rotateX(Math.PI / 2);
        paint(rim, (p, n, i, out) => out.copy(Math.floor((Math.atan2(p.z, p.x) / TAU + 0.5) * 26) % 2 ? light : dark).lerp(light, 0.3));
        put(rim, -0.62, -0.3, 0.325);
      }
      const handle = tube(curvePoints([V(-0.32, 0.32, 0), V(-0.24, 0.56, 0), V(0, 0.66, 0), V(0.24, 0.56, 0), V(0.32, 0.32, 0)], 14), 0.022, { radial: 6 });
      paintSolid(handle, dark);
      put(handle, -0.62, -0.3, 0, 0.5);
      const cloth = blob(0.27, 2, noise, { amp: 0.16, squashY: 0.42, seed: 3 });
      part(cloth, palette.cream);
      put(cloth, -0.62, -0.3, 0.3);
    }
    // Apples
    turn = 0.5;
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
    turn = 0.7;
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
    turn = 1;
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
      loose(stone);
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
      // Mostly the warm stone of the creek's bed: under the oak a grey one goes blue
      part(pebble, vary(rng.pick([palette.rockWarm, palette.bed, palette.cream, palette.rockWarm, palette.sandWet, palette.rock]), rng, { l: 0.05 }), { x: px, y: field.height(px, pz) + r * 0.2, z: pz, ry: rng.range(0, TAU) });
      loose(pebble);
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

  // ---------- The stork's nest ----------
  // An old cartwheel on a pole, the way storks are asked to stay. It is there
  // all year: lived in from spring, empty by autumn, under a cap of snow in winter.
  {
    const { x, z, yaw } = PROPS.nest;
    const y = field.height(x, z);
    const h = 4.3;
    const start = woods.length;
    const sStart = solids.length;
    pole([V(0, -0.2, 0), V(0.035, h * 0.5, 0.02), V(0, h, 0)], (t) => lerp(0.1, 0.07, t), palette.barkDark, { radial: 8 });
    for (let k = 0; k < 4; k++) board(1.04, 0.035, 0.05, palette.wood, { y: h + 0.03, ry: (k / 4) * Math.PI }, { r: 0.012 });
    const rim = new THREE.TorusGeometry(0.52, 0.035, 6, 20).deleteAttribute('uv');
    part(rim, palette.woodDark, { rx: Math.PI / 2, y: h + 0.03 });
    solids.push(rim);

    // The nest itself: a shallow bowl, lined pale with dry grass, and round
    // it the sticks it is built of, laid crosswise layer on layer
    const bowl = lathe(
      [
        [0, 0.06],
        [0.4, 0.04],
        [0.62, 0.14],
        [0.66, 0.3],
        [0.56, 0.36],
        [0.44, 0.24],
        [0, 0.2],
      ],
      18
    );
    const twigA = col(palette.barkDark);
    const twigB = col(palette.basket);
    const twigC = col('#E6D2A8');
    displace(bowl, (p) => {
      const k = 1 + noise.noise3(p.x * 5, p.y * 7, p.z * 5) * 0.07;
      p.x *= k;
      p.z *= k;
    });
    paint(bowl, (p, n, i, out) => {
      const weave = noise.noise3(p.x * 9, p.y * 16, p.z * 9);
      const lined = saturate(1.7 - Math.hypot(p.x, p.z) / 0.3) * smoothstep(-0.2, 0.5, n.y);
      // Dark between the sticks, where the eye goes into the heap
      out.copy(twigA).lerp(twigB, saturate(0.25 + weave * 0.7)).multiplyScalar(0.82).lerp(twigC, lined * 0.85);
    });
    solids.push(place(bowl, { y: h + 0.02 }));
    {
      // How far out the wall of the bowl stands at each height
      const wall = (y) => (y < 0.14 ? lerp(0.4, 0.62, (y - 0.04) / 0.1) : y < 0.3 ? lerp(0.62, 0.66, (y - 0.14) / 0.16) : lerp(0.66, 0.57, (y - 0.3) / 0.06));
      const browns = [palette.barkDark, palette.basketDark, palette.barkDark, palette.basket, '#C9B58C'];
      const sticks = 72;
      for (let k = 0; k < sticks; k++) {
        const up = lerp(0.07, 0.37, Math.pow((k + 0.5) / sticks, 0.85));
        const a = k * 2.39996 + rng.range(-0.3, 0.3);
        const r = wall(up) + rng.range(0.0, 0.025);
        // Each lies along the rim, turned a little out of it and tipped
        const turned = a + Math.PI / 2 + rng.range(-0.6, 0.6);
        const half = rng.range(0.17, 0.33);
        const tip = rng.range(-0.05, 0.05);
        const cx = Math.cos(a) * r;
        const cz = Math.sin(a) * r;
        const stick = tube(
          [V(cx - Math.cos(turned) * half, h + 0.02 + up - tip, cz - Math.sin(turned) * half), V(cx + Math.cos(turned) * half, h + 0.02 + up + tip, cz + Math.sin(turned) * half)],
          rng.range(0.009, 0.015),
          { radial: 4, capStart: false, capEnd: false }
        );
        solids.push(part(stick, vary(browns[k % browns.length], rng, { l: 0.06 })));
      }
    }
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + rng.range(-0.15, 0.15);
      const r0 = rng.range(0.42, 0.56);
      const r1 = r0 + rng.range(0.18, 0.3);
      const y0 = h + rng.range(0.14, 0.32);
      const twig = tube([V(Math.cos(a) * r0, y0, Math.sin(a) * r0), V(Math.cos(a + 0.2) * r1, y0 + rng.range(-0.04, 0.1), Math.sin(a + 0.2) * r1)], 0.012, { radial: 4 });
      solids.push(part(twig, k % 3 ? palette.barkDark : palette.basket));
    }
    toWorld(woods.slice(start), x, y, z, yaw);
    toWorld(solids.slice(sStart), x, y, z, yaw);
    // Where the stork stands, and where the marker floats when the nest is empty
    anchors.nest = V(x, y + h + 0.24, z);
    anchors.nestTop = V(x, y + h + 0.75, z);
  }

  // ---------- Spring: seedlings to plant out, and a wreath of dandelions ----------
  const spring = seasonal('spring', (v) => v.setSpring);
  {
    const clay = col(palette.clay);
    const soil = col(palette.soilDark);
    const { x, z, yaw } = PROPS.picnic;
    // A tray of pots, each with its two seed leaves
    stand(spring, { x: x - 0.1, z, yaw, order: 0 }, (set) => {
      board(0.74, 0.03, 0.46, palette.woodLight, { y: 0.04 }, { r: 0.008 });
      for (const sz of [-1, 1]) board(0.74, 0.1, 0.028, palette.wood, { y: 0.085, z: sz * 0.23 }, { r: 0.008 });
      for (const sx of [-1, 1]) board(0.028, 0.1, 0.46, palette.wood, { x: sx * 0.37, y: 0.085 }, { along: 'z', across: 'x', r: 0.008 });
      for (let i = 0; i < 6; i++) {
        const px = ((i % 3) - 1) * 0.22;
        const pz = (i < 3 ? -1 : 1) * 0.105;
        const pot = lathe(
          [
            [0, 0],
            [0.055, 0],
            [0.075, 0.11],
            [0.082, 0.115],
            [0.082, 0.13],
            [0.066, 0.13],
            [0.06, 0.1],
            [0, 0.1],
          ],
          10
        );
        paint(pot, (p, n, k, out) => out.copy(p.y > 0.095 && Math.hypot(p.x, p.z) < 0.064 ? soil : clay));
        set.solid.push(place(pot, { x: px, y: 0.055, z: pz }));
        const h = 0.07 + ((i * 37) % 5) * 0.012;
        const stem = tube([V(px, 0.15, pz), V(px + 0.008, 0.15 + h, pz)], 0.006, { radial: 4 });
        set.solid.push(part(stem, palette.grassLight));
        for (const side of [-1, 1]) set.solid.push(ball(palette.grassSun, 1, { x: px + 0.008 + side * 0.028, y: 0.155 + h, z: pz, sx: 0.03, sy: 0.008, sz: 0.018, rz: side * 0.5 }));
      }
    });
    // The watering can
    stand(spring, { x: x + 0.78, z: z + 0.42, yaw: yaw + 2.2, order: 0.5 }, (set) => {
      const body = lathe(
        [
          [0, 0],
          [0.11, 0],
          [0.12, 0.02],
          [0.115, 0.2],
          [0.1, 0.215],
          [0.085, 0.2],
          [0, 0.2],
        ],
        14
      );
      const spout = tube(curvePoints([V(0.1, 0.05, 0), V(0.2, 0.13, 0), V(0.3, 0.23, 0)], 8), (t) => lerp(0.022, 0.014, t), { radial: 6 });
      const rose = lathe(
        [
          [0, 0],
          [0.02, 0],
          [0.04, 0.03],
          [0, 0.035],
        ],
        8
      );
      const handle = tube(curvePoints([V(-0.09, 0.19, 0), V(-0.19, 0.17, 0), V(-0.2, 0.08, 0), V(-0.11, 0.04, 0)], 12), 0.011, { radial: 5 });
      set.solid.push(part(body, brand.sky.dot), part(spout, brand.sky.dot), part(rose, brand.sky.ink, { rz: -0.82, x: 0.3, y: 0.23 }), part(handle, brand.sky.ink));
    });
    // A trowel, left where the digging stopped
    stand(spring, { x: x + 0.55, z: z - 0.5, yaw: yaw - 0.6, order: 0.8 }, (set) => {
      const grip = tube([V(0, 0.03, 0), V(0.2, 0.05, 0)], 0.016, { radial: 6 });
      const blade = roundedBox(0.17, 0.014, 0.085, 0.006, 1);
      set.solid.push(part(grip, brand.peach.dot), part(blade, palette.rockLight, { x: -0.08, y: 0.022, rz: -0.08 }));
    });

    // A dandelion wreath, plaited and left on the grass
    const w = PROPS.wreath;
    anchors.wreath = stand(spring, { x: w.x, z: w.z, y: field.height(w.x, w.z) + 0.24, order: 1 }, (set) => {
      const ring = new THREE.TorusGeometry(0.27, 0.036, 5, 20).deleteAttribute('uv');
      set.solid.push(part(ring, palette.grassMid, { rx: Math.PI / 2 + 0.16, y: 0.03 }));
      for (let k = 0; k < 13; k++) {
        const a = (k / 13) * TAU;
        const head = ball(k % 4 === 3 ? palette.white : palette.butter, 0.062, { x: Math.cos(a) * 0.27, y: 0.036, z: Math.sin(a) * 0.27, sy: 0.62 });
        set.solid.push(place(head, { rx: 0.16, y: 0.03 }));
      }
    });
  }

  // ---------- Rain and thaw: puddles on the path, an umbrella left open ----------
  // They belong to spring and autumn, and to any rain that keeps on long
  // enough to gather on the path
  const wet = seasonal('wet', (v) => Math.max(v.puddles, season.pooled));
  {
    // A puddle is a piece of the sky lying on the path: pale on its far side
    // as the island is first seen, where it shows the sky low down, and deep
    // blue on the near side, where it shows the sky overhead
    const skyLow = col('#E6F0FC');
    const skyHigh = col('#7CA2DA');
    const damp = col(palette.path).clone().multiplyScalar(0.55);
    const margin = col(palette.path).clone().multiplyScalar(0.86);
    const away = [-Math.sin(CAMERA.landscape.azimuth), -Math.cos(CAMERA.landscape.azimuth)];
    // From the middle out: sky, the bed showing through, wet earth, and a
    // damp margin that fades into the path. Each ring: its share of the
    // radius, and how much of the sky is left in it (none at all in the margin).
    const rings = [
      [0.44, 1],
      [0.78, 0.7],
      [0.92, 0],
      [1.1, -1],
    ];
    PROPS.puddles.forEach(([x, z, r], k) => {
      // A pool with a soft, uneven outline, level with the ground it lies on
      const n = 36;
      const y = field.height(x, z) + 0.02;
      const turn = k * 1.3;
      const mid = skyHigh.clone().lerp(skyLow, 0.2);
      const position = [0, 0, 0];
      const color = [mid.r, mid.g, mid.b];
      const index = [];
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU;
        const rr = r * (1 + noise.noise2(Math.cos(a) * 0.9 + k * 7, Math.sin(a) * 0.9) * 0.24);
        for (const [share, sky] of rings) {
          const lx = Math.cos(a) * rr * 1.25 * share;
          const lz = Math.sin(a) * rr * 0.85 * share;
          position.push(lx, 0, lz);
          if (sky < 0) _c.copy(margin);
          else {
            // How far across the puddle this lies, once it has been turned into place
            const across = ((lx * Math.cos(turn) + lz * Math.sin(turn)) * away[0] + (lz * Math.cos(turn) - lx * Math.sin(turn)) * away[1]) / (r * 1.5);
            const far = saturate(0.45 + across);
            _c.copy(skyHigh).lerp(skyLow, far * far).lerp(damp, 1 - sky);
          }
          color.push(_c.r, _c.g, _c.b);
        }
        const here = 1 + i * rings.length;
        const next = 1 + ((i + 1) % n) * rings.length;
        index.push(0, next, here);
        for (let ring = 0; ring < rings.length - 1; ring++) {
          index.push(here + ring, next + ring, next + ring + 1, here + ring, next + ring + 1, here + ring + 1);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(position.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
      g.setIndex(index);
      wet.flat.push(stamp(place(g, { x, y, z, ry: k * 1.3 }), x, y, z, k / PROPS.puddles.length));
    });

    const u = PROPS.umbrella;
    anchors.umbrella = stand(wet, { x: u.x, z: u.z, yaw: u.yaw, order: 0.6 }, (set) => {
      // Eight panels, butter and cream by turns
      const lathed = lathe(
        [
          [0, 0.3],
          [0.17, 0.283],
          [0.34, 0.205],
          [0.47, 0.085],
          [0.53, 0],
        ],
        8
      );
      const canopy = lathed.toNonIndexed();
      lathed.dispose();
      canopy.computeVertexNormals();
      const a = col(palette.butter);
      const b = col('#FBEAA8');
      const pos = canopy.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let t = 0; t < pos.count; t += 3) {
        const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        const cz = (pos.getZ(t) + pos.getZ(t + 1) + pos.getZ(t + 2)) / 3;
        const panel = Math.floor(((Math.atan2(cz, cx) + TAU) % TAU) / (TAU / 8)) % 2;
        const c = panel ? a : b;
        for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (t + k) * 3);
      }
      canopy.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const shaft = tube(curvePoints([V(0, 0.33, 0), V(0, -0.3, 0), V(0, -0.42, 0), V(0.035, -0.5, 0), V(0.1, -0.48, 0), V(0.11, -0.41, 0)], 18), 0.012, { radial: 5 });
      part(shaft, palette.woodDark);
      const tip = ball(palette.woodDark, 0.02, { y: 0.335 });
      // Left open on the ground, resting on its rim and the crook of its handle
      const parts = [canopy, shaft, tip];
      let low = Infinity;
      for (const g of parts) {
        place(g, { rz: 2.05 });
        g.computeBoundingBox();
        low = Math.min(low, g.boundingBox.min.y);
      }
      for (const g of parts) place(g, { y: -low });
      set.double.push(canopy);
      set.solid.push(shaft, tip);
    });
  }

  // ---------- Autumn: a heap of raked leaves ----------
  const leafHues = [palette.birchAutumnMid, palette.oakAutumnMid, palette.bushAutumnMid, palette.oakAutumnDark, palette.birchAutumnLight, palette.bushAutumnLight].map((hex) => col(hex));
  const autumn = seasonal('autumn', (v) => v.setAutumn);
  {
    const { x, z, yaw } = PROPS.leafPile;
    const top = stand(autumn, { x, z, yaw, order: 0 }, (set) => {
      const heap = blob(0.62, 3, noise, { amp: 0.16, freq: 2.2, squashY: 0.5, seed: 31, flatBottom: true });
      // A patchwork: every handful a different leaf
      paint(heap, (p, n, i, out) => {
        const a = noise.noise3(p.x * 7, p.y * 9, p.z * 7) * 0.5 + 0.5;
        const b = noise.noise3(p.x * 13 + 5, p.y * 13, p.z * 13 - 3) * 0.5 + 0.5;
        out
          .copy(leafHues[Math.min(5, Math.floor(a * 6))])
          .lerp(leafHues[Math.min(5, Math.floor(b * 6))], 0.4)
          .multiplyScalar(lerp(0.8, 1.06, saturate(n.y * 0.6 + 0.4)));
      });
      set.solid.push(place(heap, { y: 0.11 }));
      // Leaves standing out of it every which way, so it has a ragged edge
      for (let k = 0; k < 54; k++) {
        const a = rng.range(0, TAU);
        const up = rng.range(0.08, 1);
        const flat = Math.sqrt(1 - up * up);
        const out = rng.range(0.94, 1.04);
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([0.11, 0, 0, 0, 0.02, 0.06, -0.11, 0, 0, 0, 0.02, -0.06], 3));
        g.setIndex([0, 2, 1, 0, 3, 2]);
        g.computeVertexNormals();
        paintSolid(g, _c.copy(rng.pick(leafHues)).multiplyScalar(rng.range(0.92, 1.1)));
        place(g, { ry: rng.range(0, TAU), rx: rng.range(-0.9, 0.9), rz: rng.range(-0.9, 0.9), s: rng.range(0.9, 1.5) });
        set.double.push(place(g, { x: Math.cos(a) * flat * 0.6 * out, y: 0.11 + up * 0.3 * out, z: Math.sin(a) * flat * 0.6 * out }));
      }
      // Loose leaves on it and around it
      for (let k = 0; k < 26; k++) {
        const a = rng.range(0, TAU);
        const d = rng.range(0.1, 1.15);
        const on = Math.max(0, 0.36 * (1 - (d / 0.6) * (d / 0.6)));
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([0.1, 0, 0, 0, 0.012, 0.055, -0.1, 0, 0, 0, 0.012, -0.055], 3));
        g.setIndex([0, 2, 1, 0, 3, 2]);
        g.computeVertexNormals();
        paintSolid(g, _c.copy(rng.pick(leafHues)).multiplyScalar(rng.range(0.9, 1.08)));
        set.double.push(place(g, { x: Math.cos(a) * d, y: on + 0.02, z: Math.sin(a) * d, ry: rng.range(0, TAU), rx: rng.range(-0.3, 0.3), rz: rng.range(-0.3, 0.3), s: rng.range(0.8, 1.3) }));
      }
      // The rake that made it, leaning on its work
      pole([V(0.98, 0.03, 0.3), V(0.22, 0.98, 0.02)], 0.019, palette.woodLight, { radial: 6 });
      board(0.44, 0.03, 0.035, palette.woodDark, { x: 0.98, y: 0.045, z: 0.3, ry: 1.2 }, { r: 0.008 });
      for (let k = 0; k < 7; k++) {
        const t = (k / 6 - 0.5) * 0.4;
        const tine = tube([V(0.98 + Math.cos(1.2) * t, 0.04, 0.3 - Math.sin(1.2) * t), V(1.03 + Math.cos(1.2) * t, -0.02, 0.32 - Math.sin(1.2) * t)], 0.006, { radial: 4 });
        set.solid.push(part(tine, palette.woodDark));
      }
    });
    anchors.leafPile = top.clone().setY(top.y + 0.75);
  }

  // ---------- Winter: a snowman, a sled, a bird table, tea, ice and tracks ----------
  const winter = seasonal('winter', (v) => v.setWinter);
  {
    const snowLit = col('#FFFFFF');
    const snowShade = col('#D9E5F8');
    const snowball = (r, placement, detail = 2, seed = 0) => {
      const g = blob(r, detail, noise, { amp: 0.07, freq: 1.4, seed });
      paint(g, (p, n, i, out) => out.copy(snowShade).lerp(snowLit, saturate(n.y * 0.7 + 0.55)));
      return place(g, placement);
    };

    // The snowman: carrot nose, coal eyes, a knitted scarf and hat, twigs for arms
    const sm = PROPS.snowman;
    const foot = stand(winter, { x: sm.x, z: sm.z, yaw: sm.yaw, order: 0 }, (set) => {
      const S = set.solid;
      S.push(snowball(0.35, { y: 0.28, sy: 0.9 }, 2, 1), snowball(0.255, { y: 0.74 }, 2, 2), snowball(0.18, { y: 1.1 }, 2, 3));
      const nose = lathe(
        [
          [0, 0],
          [0.032, 0],
          [0.02, 0.1],
          [0, 0.2],
        ],
        8
      );
      S.push(part(nose, palette.beak, { rx: Math.PI / 2, y: 1.1, z: 0.15 }));
      for (const side of [-1, 1]) S.push(ball(palette.ink, 0.023, { x: side * 0.066, y: 1.165, z: 0.156 }));
      for (let k = -2; k <= 2; k++) S.push(ball(palette.ink, 0.013, { x: k * 0.031, y: 1.035 + Math.abs(k) * 0.013, z: 0.166 - Math.abs(k) * 0.007 }));
      for (const by of [0.66, 0.78, 0.9]) S.push(ball(palette.ink, 0.021, { y: by, z: 0.25 - Math.abs(by - 0.76) * 0.3 }));
      // Scarf
      const wrap = new THREE.TorusGeometry(0.155, 0.05, 6, 16).deleteAttribute('uv');
      S.push(part(wrap, brand.sky.dot, { rx: Math.PI / 2, y: 0.955 }));
      S.push(part(roundedBox(0.085, 0.27, 0.035, 0.014, 1), brand.sky.dot, { x: 0.1, y: 0.83, z: 0.185, rz: 0.16, rx: -0.12 }));
      // Hat with a bobble
      const cap = icoSphere(0.175, 2);
      displace(cap, (p) => {
        p.y = Math.max(p.y, -0.03) * 1.05;
      });
      S.push(part(cap, palette.red, { y: 1.215 }));
      const brim = new THREE.TorusGeometry(0.165, 0.032, 6, 16).deleteAttribute('uv');
      S.push(part(brim, palette.cream, { rx: Math.PI / 2, y: 1.205 }));
      S.push(ball(palette.cream, 0.05, { y: 1.42 }, 2));
      // Arms
      for (const side of [-1, 1]) {
        const arm = tube([V(side * 0.2, 0.8, 0), V(side * 0.44, 0.93, 0.04), V(side * 0.6, 1.08, 0.02)], 0.014, { radial: 5 });
        const finger = tube([V(side * 0.46, 0.94, 0.04), V(side * 0.56, 0.93, 0.1)], 0.009, { radial: 4 });
        S.push(part(arm, palette.barkDark), part(finger, palette.barkDark));
      }
    });
    anchors.snowman = foot.clone().setY(foot.y + 1.62);

    // The sled, waiting at the top of its run
    const sl = PROPS.sled;
    const sledAt = stand(winter, { x: sl.x, z: sl.z, yaw: sl.yaw, s: 1.4, order: 0.25 }, (set) => {
      for (const side of [-1, 1]) {
        const z = side * 0.19;
        pole(curvePoints([V(-0.46, 0.03, z), V(0.2, 0.03, z), V(0.42, 0.06, z), V(0.52, 0.17, z), V(0.5, 0.26, z)], 14), 0.022, palette.woodDark, { radial: 5 });
        for (const px of [-0.3, 0.12]) board(0.035, 0.17, 0.035, palette.woodDark, { x: px, y: 0.115, z }, { along: 'y', across: 'x', r: 0.008 });
      }
      for (const px of [-0.3, 0.12]) board(0.045, 0.03, 0.44, palette.woodDark, { x: px, y: 0.192 }, { along: 'z', across: 'x', r: 0.008 });
      for (let k = 0; k < 4; k++) board(0.74, 0.022, 0.085, k % 2 ? palette.wood : palette.woodLight, { x: -0.06, y: 0.215, z: (k - 1.5) * 0.105 }, { r: 0.008 });
      const rope = tube(curvePoints([V(0.5, 0.25, -0.19), V(0.72, 0.1, -0.1), V(0.86, 0.03, 0), V(0.72, 0.1, 0.1), V(0.5, 0.25, 0.19)], 16), 0.011, { radial: 4 });
      set.solid.push(part(rope, palette.cream));
    });
    anchors.sled = sledAt.clone().setY(sledAt.y + 0.75);

    // The bird table: a tray of seeds under a little roof
    const f = PROPS.feeder;
    const feederAt = stand(winter, { x: f.x, z: f.z, yaw: f.yaw, order: 0.4 }, (set) => {
      pole([V(0, -0.15, 0), V(0, 1.2, 0)], 0.05, palette.woodDark, { radial: 7 });
      board(0.62, 0.035, 0.46, palette.woodLight, { y: 1.22 }, { r: 0.01 });
      for (const sz of [-1, 1]) board(0.62, 0.05, 0.03, palette.wood, { y: 1.26, z: sz * 0.215 }, { r: 0.008 });
      for (const sx of [-1, 1]) board(0.03, 0.05, 0.46, palette.wood, { x: sx * 0.295, y: 1.26 }, { along: 'z', across: 'x', r: 0.008 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) board(0.03, 0.34, 0.03, palette.woodDark, { x: sx * 0.27, y: 1.4, z: sz * 0.19 }, { along: 'y', across: 'x', r: 0.006 });
      for (const side of [-1, 1]) board(0.4, 0.03, 0.56, brand.primaryLight, { x: side * 0.165, y: 1.66, rz: -side * 0.52 }, { along: 'z', across: 'x', r: 0.008 });
      const seeds = blob(0.13, 1, noise, { amp: 0.2, squashY: 0.22, seed: 5 });
      set.solid.push(part(seeds, '#D9B777', { y: 1.245 }));
    });
    anchors.feeder = { point: feederAt.clone().setY(feederAt.y + 1.285), yaw: f.yaw, top: feederAt.clone().setY(feederAt.y + 2.0) };

    // Tea from a flask, and a lantern built of snowballs with a candle inside
    const p = PROPS.picnic;
    const lanternAt = stand(winter, { x: p.x - 0.3, z: p.z + 0.1, order: 0.55 }, (set) => {
      let seed = 20;
      for (const [n, r, y, size] of [
        [8, 0.27, 0.085, 0.1],
        [7, 0.21, 0.24, 0.095],
        [5, 0.135, 0.385, 0.09],
        [1, 0, 0.52, 0.085],
      ]) {
        for (let k = 0; k < n; k++) {
          const a = (k / n) * TAU + y * 7;
          set.solid.push(snowball(size, { x: Math.cos(a) * r, y, z: Math.sin(a) * r }, 1, seed++));
        }
      }
      // The flame: brighter than anything the sun lights, so it glows
      const flame = icoSphere(0.11, 1);
      paintSolid(flame, _c.setRGB(3.4, 2.1, 0.8));
      set.solid.push(place(flame, { y: 0.18 }));
    });
    anchors.lantern = lanternAt.clone().setY(lanternAt.y + 0.75);
    // Where its candle burns: the air draws the light it gives
    anchors.candle = lanternAt.clone().setY(lanternAt.y + 0.24);
    stand(winter, { x: p.x + 0.62, z: p.z - 0.3, order: 0.7 }, (set) => {
      const S = set.solid;
      const barkA = col(palette.barkDark);
      const barkB = col(palette.barkOak);
      const pale = col(palette.woodLight);
      const ring = col(palette.wood);
      const stump = lathe(
        [
          [0, 0],
          [0.31, 0],
          [0.26, 0.08],
          [0.235, 0.36],
          [0.225, 0.4],
          [0, 0.4],
        ],
        14
      );
      paint(stump, (q, n, i, out) => {
        if (n.y > 0.7) out.copy(pale).lerp(ring, (0.5 + 0.5 * Math.sin((Math.hypot(q.x, q.z) / 0.225) * 22)) * 0.5);
        else out.copy(barkA).lerp(barkB, saturate(0.5 + noise.noise3(q.x * 4, q.y * 3, q.z * 4) * 0.6));
      });
      S.push(stump);
      const flask = lathe(
        [
          [0, 0],
          [0.055, 0],
          [0.058, 0.22],
          [0.045, 0.25],
          [0.045, 0.3],
          [0, 0.3],
        ],
        12
      );
      const blue = col(brand.primaryLight);
      const cream = col(palette.cream);
      paint(flask, (q, n, i, out) => out.copy(q.y > 0.235 ? cream : blue));
      S.push(place(flask, { x: -0.07, y: 0.4, z: -0.04 }));
      for (const [lx, lz, hex] of [
        [0.09, 0.05, brand.butter.dot],
        [0.0, 0.13, brand.peach.dot],
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
        S.push(part(cup, hex, { x: lx, y: 0.4, z: lz }));
      }
    });

    // Three small snowmen someone has stood along the bridge rail
    [
      [0.57, -1, 1],
      [0.67, -1, 0.82],
      [0.43, 1, 0.9],
    ].forEach(([t, side, size], k) => {
      const at = anchors.rail(t, side);
      stand(winter, { x: at.x, z: at.z, y: at.y, yaw: anchors.railYaw + (k - 1) * 0.5, s: size, order: 0.8 + k * 0.05 }, (set) => {
        set.solid.push(snowball(0.075, { y: 0.06, sy: 0.9 }, 1, 40 + k), snowball(0.052, { y: 0.155 }, 1, 50 + k));
        set.solid.push(ball(palette.beak, 1, { y: 0.155, z: 0.058, sx: 0.01, sy: 0.01, sz: 0.03 }));
        for (const eye of [-1, 1]) set.solid.push(ball(palette.ink, 0.008, { x: eye * 0.02, y: 0.172, z: 0.046 }));
      });
    });

    // Ice ornaments hung on a branch stuck in the bank: berries and spruce frozen into discs
    const ib = PROPS.iceBranch;
    const iceA = col('#E6F2FC');
    const iceB = col('#A6CDEE');
    const branchAt = stand(winter, { x: ib.x, z: ib.z, yaw: ib.yaw, order: 0.65 }, (set) => {
      pole(curvePoints([V(0, -0.15, 0), V(0.03, 0.5, 0), V(-0.02, 0.9, 0.02), V(0.05, 1.3, 0)], 10), (t) => lerp(0.035, 0.016, t), palette.barkDark, { radial: 6 });
      pole(curvePoints([V(-0.01, 0.85, 0.01), V(-0.25, 1.05, 0.05), V(-0.52, 1.14, 0.02)], 8), 0.014, palette.barkDark, { radial: 5 });
      pole(curvePoints([V(0.02, 0.7, 0), V(0.25, 0.9, -0.05), V(0.48, 1.0, -0.02)], 8), 0.014, palette.barkDark, { radial: 5 });
      for (const [hx, hy, hz, r, turn] of [
        [-0.44, 1.12, 0.03, 0.1, 0.3],
        [-0.2, 1.01, 0.05, 0.078, -0.5],
        [0.4, 0.97, -0.03, 0.11, 0.7],
      ]) {
        const cy = hy - 0.16 - r;
        const string = tube([V(hx, hy, hz), V(hx, cy + r * 0.9, hz)], 0.004, { radial: 4 });
        set.solid.push(part(string, palette.cream));
        const disc = lathe(
          [
            [0, -0.013],
            [r * 0.95, -0.013],
            [r, 0],
            [r * 0.95, 0.013],
            [0, 0.013],
          ],
          16
        );
        paint(disc, (q, n, i, out) => out.copy(iceA).lerp(iceB, saturate(Math.hypot(q.x, q.z) / r) ** 2));
        place(disc, { rx: Math.PI / 2 });
        const inside = [disc];
        // What was frozen in
        for (let k = 0; k < 3; k++) inside.push(ball(palette.red, r * 0.17, { x: Math.cos(k * 2.1 + r * 40) * r * 0.4, y: Math.sin(k * 2.1 + r * 40) * r * 0.4 }));
        inside.push(ball(palette.spruceMid, 1, { x: -r * 0.1, y: r * 0.05, sx: r * 0.5, sy: r * 0.14, sz: 0.016, rz: 0.7 }));
        for (const g of inside) set.solid.push(place(g, { x: hx, y: cy, z: hz, ry: turn }));
      }
    });
    anchors.iceBranch = branchAt.clone().setY(branchAt.y + 1.45);

    // A hare has been by: its tracks cross the snow in front of the log
    const trail = new THREE.CatmullRomCurve3(
      PROPS.tracks.map(([x, z]) => V(x, 0, z)),
      false,
      'centripetal'
    );
    const blue = col('#A9BEE4');
    const bounds = Math.floor(trail.getLength() / 0.92);
    const print = (x, z, r, yaw, order) => {
      const g = new THREE.CircleGeometry(r, 10).deleteAttribute('uv');
      g.rotateX(-Math.PI / 2);
      paintSolid(g, blue);
      const y = field.height(x, z) + 0.035;
      winter.flat.push(stamp(place(g, { x, y, z, ry: yaw, sx: 1.7 }), x, y, z, order));
    };
    for (let k = 0; k < bounds; k++) {
      const u = (k + 0.5) / bounds;
      trail.getPointAt(u, _p);
      const d = trail.getTangentAt(u, _s);
      const yaw = Math.atan2(-d.z, d.x);
      const order = 0.3 + 0.7 * u;
      // Hind feet land side by side ahead of the fore feet, which land one behind the other
      for (const side of [-1, 1]) print(_p.x + d.x * 0.17 - d.z * side * 0.095, _p.z + d.z * 0.17 + d.x * side * 0.095, 0.05, yaw, order);
      print(_p.x - d.x * 0.1 - d.z * 0.02, _p.z - d.z * 0.1 + d.x * 0.02, 0.034, yaw, order);
      print(_p.x - d.x * 0.3 + d.z * 0.015, _p.z - d.z * 0.3 - d.x * 0.015, 0.034, yaw, order);
    }
  }

  // ---------- Assemble the static parts ----------
  group.add(mesh(merge(woods, { keepUv: true }), kit.wood, { name: 'timber' }));
  group.add(mesh(merge(solids), kit.solid, { name: 'things' }));
  if (stones.length) group.add(mesh(merge(stones, { keep: ['aStone'] }), kit.rock, { name: 'pebbles' }));
  if (buntingParts.length) group.add(mesh(merge(buntingParts), kit.solidDouble, { name: 'bunting' }));

  // ...and each seasonal set, one mesh to a material
  for (const set of sets) {
    const materials = kit.seasonal(set.uPop);
    for (const kind of KINDS) {
      if (!set[kind].length) continue;
      const m = mesh(merge(set[kind], { keepUv: kind === 'wood', keep: ['aPop'] }), materials[kind], { name: `${set.name}-${kind}`, cast: kind !== 'flat' });
      m.customDepthMaterial = kind === 'double' ? materials.shadowDouble : materials.shadow;
      group.add(m);
      set.meshes.push(m);
    }
  }

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
    // It is a wooden toy: the grain runs from stem to stern under the paint
    {
      const uv = new Float32Array(posAttr.count * 2);
      for (let i = 0; i < posAttr.count; i++) {
        uv[i * 2] = (posAttr.getZ(i) + posAttr.getY(i) * 1.4) * 2.6 + 0.3;
        uv[i * 2 + 1] = posAttr.getX(i) * 1.1 + 0.1;
      }
      hull.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    }
    const mast = tube([V(0.03, 0.04, 0), V(0.03, 0.78, 0)], 0.013, { radial: 6 });
    part(mast, palette.woodDark);
    const boom = tube([V(0.03, 0.13, 0), V(-0.36, 0.13, 0)], 0.009, { radial: 5 });
    part(boom, palette.woodDark);
    // A rail runs round the deck
    const rail = [];
    for (let k = 0; k <= 30; k++) {
      const a = (k / 30) * TAU;
      const px = Math.cos(a) * 0.955 * 0.46;
      rail.push(V(px, 0.067 + Math.max(0, px - 0.3) * 0.25, Math.sin(a) * 0.955 * 0.19 * (1 - Math.max(0, Math.cos(a) * 0.955) * 0.35)));
    }
    const gunwale = tube(rail, 0.011, { radial: 5, capStart: false, capEnd: false });
    part(gunwale, palette.woodDark);
    boat.add(mesh(merge([hull, mast, boom, gunwale], { keepUv: true }), kit.wood, { name: 'hull' }));

    // Sails: bellied triangles. `stripe` sews every other cloth of one in that colour.
    const sail = (a, b, c, hex, belly, stripe = null) => {
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
      const smooth = new THREE.BufferGeometry();
      smooth.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
      smooth.setIndex(index);
      smooth.computeVertexNormals();
      // Coloured cloth by cloth, so that a stripe keeps a clean edge
      const g = smooth.toNonIndexed();
      smooth.dispose();
      const base = col(hex);
      const band = stripe ? col(stripe) : base;
      const pos = g.attributes.position;
      const colors = new Float32Array(pos.count * 3);
      for (let t = 0; t < pos.count; t += 3) {
        const y = (pos.getY(t) + pos.getY(t + 1) + pos.getY(t + 2)) / 3;
        const cloth = Math.floor(((y - a.y) / (b.y - a.y)) * n) % 2 ? band : base;
        for (let k = 0; k < 3; k++) {
          const lit = lerp(0.9, 1.05, saturate(pos.getY(t + k) / 0.7));
          colors.set([cloth.r * lit, cloth.g * lit, cloth.b * lit], (t + k) * 3);
        }
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      setSway(g, () => 0);
      return g;
    };
    const main = sail(V(0.02, 0.16, 0), V(0.02, 0.76, 0), V(-0.36, 0.16, 0), palette.white, 0.035, brand.peach.dot);
    const jib = sail(V(0.05, 0.14, 0), V(0.04, 0.68, 0), V(0.4, 0.12, 0), palette.sailLight, 0.028);
    const pennant = sail(V(0.03, 0.78, 0), V(0.03, 0.86, 0), V(-0.14, 0.82, 0), palette.peach, 0.01);
    boat.add(mesh(merge([main, jib, pennant]), kit.solidDouble, { name: 'sails' }));
    group.add(boat);

    // It idles round a small loop on the pool, nosing into its own wake. It is
    // launched once the paper boats have had their spring, and when the pool
    // freezes it stays where the ice caught it.
    const home = PROPS.boat;
    let wake = 0;
    let sailed = 0;
    updaters.push((time, dt) => {
      const out = season.v.sail;
      boat.visible = out > 0.004;
      if (!boat.visible) return;
      const free = 1 - smoothstep(0.25, 0.7, season.v.ice);
      // A wind fills the sails: it makes better way, and heels to it
      const blown = season.windy * free;
      sailed += dt * free * (1 + 1.1 * blown);
      const a = sailed * 0.11;
      const x = home.x + Math.cos(a) * 1.25 + Math.sin(a * 2.3) * 0.25;
      const z = home.z + Math.sin(a) * 0.62;
      const heading = Math.atan2(-(Math.cos(a) * 0.62), -Math.sin(a) * 1.25 + Math.cos(a * 2.3) * 0.25 * 2.3);
      boat.scale.setScalar(1.1 * ease.outBack(saturate(out)));
      boat.position.set(x, water.surface(x, z) + 0.035 + Math.sin(time * 1.3) * 0.012 * free, z);
      boat.rotation.set(Math.sin(time * 1.1) * 0.045 * free, heading, (Math.sin(time * 0.9 + 1) * 0.06 + 0.05) * free + (1 - free) * 0.17 + blown * 0.13, 'YXZ');
      wake -= dt;
      if (wake <= 0 && free > 0.5) {
        water.addRipple(x - Math.cos(heading) * 0.4, z + Math.sin(heading) * 0.4, 0.42);
        wake = 1.5 / (1 + 0.8 * blown);
      }
    });
    anchors.boat = boat;

    // ---------- Paper boats ----------
    // Spring belongs to the folded kind: three of them follow one another round the pool
    const fold = (() => {
      const bow = [0.21, 0.1, 0];
      const stern = [-0.21, 0.1, 0];
      const keelA = [0.1, 0, 0];
      const keelB = [-0.1, 0, 0];
      const tri = [];
      for (const side of [-1, 1]) {
        const rail = [0, 0.075, side * 0.085];
        tri.push(bow, keelA, rail, rail, keelA, keelB, rail, keelB, stern);
        // The peak in the middle
        tri.push([0.075, 0.062, 0], [0, 0.185, 0], [0, 0.07, side * 0.04], [-0.075, 0.062, 0], [0, 0.07, side * 0.04], [0, 0.185, 0]);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(tri.flat(), 3));
      g.computeVertexNormals();
      paint(g, (p, n, i, out) => out.setScalar(lerp(0.9, 1.04, saturate(p.y / 0.18))));
      return setSway(g, () => 0);
    })();
    const fleet = new THREE.InstancedMesh(fold, kit.creatureDouble, 3);
    fleet.name = 'paper-boats';
    fleet.frustumCulled = false;
    fleet.castShadow = true;
    fleet.receiveShadow = true;
    [palette.white, brand.butter.soft, brand.sky.soft].forEach((hex, i) => fleet.setColorAt(i, col(hex)));
    fleet.instanceColor.needsUpdate = true;
    group.add(fleet);
    const lead = V(home.x, 0, home.z);
    let ripple = 0.7;
    updaters.push((time, dt) => {
      const out = season.v.paperBoats;
      fleet.visible = out > 0.004;
      if (!fleet.visible) return;
      for (let i = 0; i < 3; i++) {
        const a = time * 0.13 - i * 0.62 + Math.sin(time * 0.31 + i * 2.1) * 0.08;
        const x = home.x + Math.cos(a) * (1.3 - i * 0.07) + Math.sin(a * 2.3) * 0.22;
        const z = home.z + Math.sin(a) * (0.66 - i * 0.05);
        const heading = Math.atan2(-(Math.cos(a) * 0.62), -Math.sin(a) * 1.25 + Math.cos(a * 2.3) * 0.25 * 2.3);
        _p.set(x, water.surface(x, z) + 0.004 + Math.sin(time * 1.5 + i * 1.7) * 0.01, z);
        _e.set(Math.sin(time * 1.2 + i) * 0.06, heading, Math.sin(time * 0.95 + i * 2) * 0.09, 'YXZ');
        fleet.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s.setScalar((1.3 - i * 0.13) * ease.outBack(saturate(out * 1.3 - i * 0.15)))));
        if (i === 0) lead.copy(_p);
      }
      fleet.instanceMatrix.needsUpdate = true;
      ripple -= dt;
      if (ripple <= 0) {
        water.addRipple(lead.x, lead.z, 0.3);
        ripple = 1.7;
      }
    });
    anchors.paperBoat = lead;
  }

  // ---------- Leaves on the water ----------
  // In autumn the creek carries the fallen leaves away, from the foot of the fall to the rim
  {
    const outline = [
      [0.16, 0],
      [0.09, 0.062],
      [-0.03, 0.075],
      [-0.13, 0.04],
      [-0.17, 0],
      [-0.13, -0.04],
      [-0.03, -0.075],
      [0.09, -0.062],
    ];
    const position = [0, 0, 0];
    const index = [];
    outline.forEach(([x, z], i) => {
      position.push(x, 0.014, z);
      index.push(0, 1 + ((i + 1) % outline.length), 1 + i);
    });
    const leaf = new THREE.BufferGeometry();
    leaf.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
    leaf.setIndex(index);
    leaf.computeVertexNormals();
    paint(leaf, (p, n, i, out) => out.setScalar(i === 0 ? 0.84 : 1.05));
    setSway(leaf, () => 0);

    const count = 10;
    const fract = (x) => x - Math.floor(x);
    const afloat = new THREE.InstancedMesh(leaf, kit.creatureDouble, count);
    afloat.name = 'leaves-afloat';
    afloat.frustumCulled = false;
    afloat.castShadow = false;
    for (let i = 0; i < count; i++) afloat.setColorAt(i, leafHues[i % leafHues.length]);
    afloat.instanceColor.needsUpdate = true;
    group.add(afloat);
    const from = field.creekS(4) + 0.8;
    const to = field.creek.total - 0.4;
    const frame = {};
    updaters.push(() => {
      const out = season.v.leafBoats;
      afloat.visible = out > 0.004;
      if (!afloat.visible) return;
      for (let i = 0; i < count; i++) {
        const seed = fract(i * 0.6180339);
        const u = fract(season.flow * (0.016 + seed * 0.006) + seed * 7.31);
        field.creekAt(lerp(from, to, u), frame);
        const lat = Math.sin(i * 12.9898) * 0.5 * frame.w + Math.sin(u * 23 + i) * 0.12;
        _p.set(frame.x + frame.nx * lat, 0, frame.z + frame.nz * lat);
        _p.y = water.surface(_p.x, _p.z) + 0.006;
        // Each drifts in at the top of its run and is lost over the rim
        const ends = smoothstep(0, 0.05, u) * (1 - smoothstep(0.93, 1, u));
        _e.set(0, i * 2.4 + season.flow * (0.3 + seed * 0.5) * (i % 2 ? 1 : -1), 0);
        afloat.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s.setScalar((0.9 + seed * 0.6) * ends * saturate(out * 1.4 - seed * 0.4))));
      }
      afloat.instanceMatrix.needsUpdate = true;
    });
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
    group.add(kite);

    // The line runs down to a peg in the meadow
    const [ax, az] = PROPS.kite.anchor;
    const ay = field.height(ax, az);
    const peg = tubeGrain(tube([V(ax, ay - 0.05, az), V(ax + 0.03, ay + 0.26, az)], 0.022, { radial: 6 }), 0.3);
    paintSolid(peg, col(palette.woodDark));
    const pegMesh = mesh(peg, kit.wood, { name: 'kite-peg' });
    group.add(pegMesh);

    const SEG = 18;
    const linePos = new Float32Array((SEG + 1) * 3);
    const lineGeom = new THREE.BufferGeometry();
    lineGeom.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    const line = new THREE.Line(lineGeom, new THREE.LineBasicMaterial({ color: col(palette.cream), transparent: true, opacity: 0.85 }));
    line.frustumCulled = false;
    group.add(line);

    const home = PROPS.kite;
    updaters.push((time) => {
      // Reeled in for the winter, and let out again when the grass is up
      const out = season.v.kite;
      kite.visible = line.visible = pegMesh.visible = out > 0.004;
      if (!kite.visible) return;
      const reel = ease.outCubic(out);
      // In a wind it pulls higher on a tighter line, and tugs about more
      const blown = season.windy;
      kite.scale.setScalar(1.35 * lerp(0.2, 1, reel));
      const x = lerp(ax + 0.2, home.x + Math.sin(time * 0.31) * 0.9 + Math.sin(time * 0.83) * 0.25 + Math.sin(time * 2.1) * 0.16 * blown, reel);
      const y = lerp(ay + 0.5, home.y + Math.sin(time * 0.47 + 1) * 0.4 + Math.sin(time * 1.3) * 0.1 + (0.35 + Math.sin(time * 2.7 + 2) * 0.09) * blown, reel);
      const z = lerp(az - 0.2, home.z + Math.cos(time * 0.27) * 0.7, reel);
      kite.position.set(x, y, z);
      // Nose up into the wind, face turned down the line, wagging a little
      kite.rotation.set(0.5 + Math.sin(time * 0.9) * 0.08, Math.atan2(ax - x, az - z) + 0.5 + Math.sin(time * 0.41) * 0.2, Math.sin(time * 1.2) * 0.14 + Math.sin(time * 3.3) * 0.1 * blown, 'YXZ');
      for (let i = 0; i <= SEG; i++) {
        const t = i / SEG;
        const belly = Math.sin(t * Math.PI) * (0.9 - 0.5 * blown);
        linePos[i * 3] = lerp(ax + 0.03, x, t) + belly * 0.35;
        linePos[i * 3 + 1] = lerp(ay + 0.26, y, Math.pow(t, 1.25)) - belly * 0.1;
        linePos[i * 3 + 2] = lerp(az, z, t) + belly * 0.2;
      }
      lineGeom.attributes.position.needsUpdate = true;
    });
    anchors.kite = kite;
    anchors.kitePeg = V(ax, ay + 0.3, az);
  }

  // ---------- The year ----------
  // Sets are brought out and put away; what is put away is not drawn
  function dress() {
    for (const set of sets) {
      // By every clock of the year: the set stays out while one of them has it out
      const out = season.across(set.track, set.uPop.value) > 0.004;
      for (const m of set.meshes) m.visible = out;
    }
  }
  dress();

  // The puddles of a rain come and go with the rain, whatever the year is doing
  let pooled = season.pooled;
  function update(time, dt) {
    if (season.changed || season.pooled !== pooled) {
      pooled = season.pooled;
      dress();
    }
    for (const fn of updaters) fn(time, dt);
  }
  // Fill every instance matrix before the first frame is drawn
  update(0, 0);

  return { group, anchors, update };
}
