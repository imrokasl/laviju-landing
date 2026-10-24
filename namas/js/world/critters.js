import * as THREE from '../core/three.js';
import { TAU, createRng, ease, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, brand, col } from '../core/palette.js';
import { season } from '../core/season.js';
import { icoSphere, tube, place, displace, paint, paintSolid, merge } from '../core/geo.js';
import { mesh, part } from './kit.js';
import { YARD, FURNITURE } from './layout.js';

// Who lives here: the dog and the cat, the birds of the garden, a snail and
// a hedgehog, and the small things that fly. Each keeps its own calendar:
// the dog and the cat come indoors for the winter, the snail and the
// hedgehog sleep it away, and the seed under the birdhouse has its guests
// only while there is snow.
// Every animal faces +z in its own space.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Matrix4();
const _w2 = new THREE.Matrix4();

const ball = (color, r, placement, detail = 2) => part(icoSphere(r, detail), color, placement);

// Soft top-light baked into the paint, so small round bodies keep their form.
const shaded = (geom, hex, lo = 0.88, hi = 1.05) => {
  const base = col(hex);
  return paint(geom, (p, n, i, out) => out.copy(base).multiplyScalar(lerp(lo, hi, saturate(n.y * 0.5 + 0.5))));
};

// ---------- Models ----------
// The family's dog, lying down with its head up: golden, with a pale muzzle
// and soft brown ears. Its head and tail are apart from its body, so that
// they can move: each is drawn about the point it turns on.
function dogGeometry() {
  const coat = '#E2BE8C';
  const pale = '#F3E2C6';
  const ear = '#B5865B';
  const body = [];
  const torso = icoSphere(1, 3);
  displace(torso, (p) => {
    p.set(p.x * 0.17, p.y * 0.13, p.z * 0.31);
    p.y = Math.max(p.y, -0.1) + 0.14;
    p.z -= 0.06;
  });
  shaded(torso, coat);
  body.push(torso);
  for (const side of [-1, 1]) {
    // A haunch, a hind paw tucked along it, a foreleg reaching forward
    body.push(shaded(place(icoSphere(1, 2), { sx: 0.1, sy: 0.11, sz: 0.14, x: side * 0.1, y: 0.12, z: -0.24 }), coat));
    body.push(shaded(place(icoSphere(1, 1), { sx: 0.045, sy: 0.03, sz: 0.08, x: side * 0.15, y: 0.03, z: -0.12 }), pale));
    body.push(paintSolid(tube([V(side * 0.085, 0.07, 0.1), V(side * 0.085, 0.045, 0.3)], 0.042, { radial: 7 }), col(coat)));
    body.push(shaded(place(icoSphere(1, 2), { sx: 0.05, sy: 0.032, sz: 0.065, x: side * 0.085, y: 0.032, z: 0.33 }), pale));
  }
  // A pale chest
  body.push(shaded(place(icoSphere(1, 2), { sx: 0.1, sy: 0.1, sz: 0.06, y: 0.17, z: 0.2 }), pale));

  const neck = V(0, 0.24, 0.2);
  const head = [];
  head.push(shaded(place(icoSphere(1, 2), { sx: 0.11, sy: 0.105, sz: 0.115, y: 0.34, z: 0.28 }), coat));
  head.push(shaded(place(icoSphere(1, 2), { sx: 0.065, sy: 0.055, sz: 0.095, y: 0.305, z: 0.38 }), pale));
  head.push(ball(palette.ink, 1, { y: 0.325, z: 0.47, sx: 0.028, sy: 0.022, sz: 0.02 }, 1));
  head.push(ball(palette.ink, 1, { y: 0.27, z: 0.43, sx: 0.03, sy: 0.006, sz: 0.012 }, 1));
  for (const side of [-1, 1]) {
    head.push(ball(palette.ink, 0.017, { x: side * 0.05, y: 0.37, z: 0.37 }, 1));
    // Soft ears hanging beside the head
    head.push(shaded(place(icoSphere(1, 2), { sx: 0.028, sy: 0.085, sz: 0.06, rz: side * 0.3, x: side * 0.1, y: 0.31, z: 0.25 }), ear, 0.84, 1.0));
  }
  for (const g of head) place(g, { x: -neck.x, y: -neck.y, z: -neck.z });

  const tailRoot = V(0, 0.18, -0.36);
  const tail = shaded(tube([V(0, 0, 0), V(0.04, -0.07, -0.13), V(0.15, -0.14, -0.22)], (t) => lerp(0.035, 0.016, t), { radial: 6 }), coat);
  return { body: merge(body), head: merge(head), tail: merge([tail]), neck, tailRoot };
}

// A ginger cat asleep, curled up with its tail round its paws
function catGeometry() {
  const ginger = col('#E6A660');
  const stripe = col('#C47E3E');
  const pale = '#F6E3C9';
  const tabby = (g, k = 18) =>
    paint(g, (p, n, i, out) => {
      const band = 0.5 + 0.5 * Math.sin(Math.atan2(p.x, p.z) * k * 0.5 + p.y * 14);
      out.copy(ginger).lerp(stripe, smoothstep(0.55, 0.85, band) * 0.75).multiplyScalar(lerp(0.88, 1.05, saturate(n.y * 0.5 + 0.5)));
    });
  const parts = [];
  const body = icoSphere(1, 3);
  displace(body, (p) => {
    p.set(p.x * 0.13, p.y * 0.085, p.z * 0.17);
    p.y = Math.max(p.y, -0.06) + 0.075;
  });
  parts.push(tabby(body));
  const head = icoSphere(1, 2);
  place(head, { sx: 0.075, sy: 0.065, sz: 0.07, x: 0.035, y: 0.09, z: 0.16 });
  parts.push(tabby(head, 10));
  parts.push(shaded(place(icoSphere(1, 1), { sx: 0.035, sy: 0.025, sz: 0.025, x: 0.04, y: 0.07, z: 0.225 }), pale));
  for (const side of [-1, 1]) {
    parts.push(paintSolid(tube([V(0.035 + side * 0.04, 0.135, 0.15), V(0.035 + side * 0.052, 0.185, 0.155)], (t) => lerp(0.024, 0.003, t), { radial: 4 }), ginger));
    // Eyes shut
    parts.push(ball(palette.ink, 1, { x: 0.035 + side * 0.03, y: 0.105, z: 0.222, sx: 0.016, sy: 0.003, sz: 0.004 }, 1));
  }
  parts.push(tabby(tube([V(-0.1, 0.03, -0.12), V(-0.15, 0.03, 0.04), V(-0.08, 0.03, 0.18), V(0.06, 0.028, 0.22)], (t) => lerp(0.027, 0.02, t), { radial: 6 }), 30));
  return merge(parts);
}

// A small perching bird. As it stands, a blue tit: blue cap and back, white
// cheeks, yellow breast. Other colours make a great tit or a bullfinch of it.
function titGeometry({ cap = brand.sky.dot, back = brand.sky.dot, belly = palette.butter, cheek = palette.white, wing = brand.sky.ink } = {}) {
  const blue = col(back);
  const crown = col(cap);
  const yellow = col(belly);
  const white = col(cheek);
  const parts = [];
  const body = icoSphere(1, 2);
  displace(body, (p) => {
    p.set(p.x * 0.062, p.y * 0.06, p.z * 0.08);
    p.y += 0.07 + p.z * 0.25;
  });
  paint(body, (p, n, i, out) => out.copy(yellow).lerp(blue, smoothstep(0.0, 0.5, n.y - n.z * 0.4)));
  parts.push(body);
  const head = icoSphere(0.05, 2);
  place(head, { y: 0.135, z: 0.06 });
  paint(head, (p, n, i, out) => {
    out.copy(white);
    if (p.y > 0.155) out.copy(crown);
    else if (p.y < 0.115 && p.z > 0.07) out.copy(yellow);
  });
  parts.push(head);
  parts.push(ball(palette.ink, 1, { y: 0.135, z: 0.116, sx: 0.012, sy: 0.01, sz: 0.022 }, 1));
  for (const side of [-1, 1]) {
    parts.push(ball(palette.ink, 0.009, { x: side * 0.034, y: 0.146, z: 0.095 }, 1));
    parts.push(ball(wing, 1, { x: side * 0.056, y: 0.076, z: -0.012, sx: 0.016, sy: 0.04, sz: 0.066, rx: -0.3 }, 1));
    parts.push(part(tube([V(side * 0.02, 0.03, 0.01), V(side * 0.02, -0.005, 0.02)], 0.005, { radial: 4 }), palette.ink));
  }
  // Tail
  parts.push(ball(wing, 1, { y: 0.058, z: -0.11, sx: 0.022, sy: 0.008, sz: 0.06, rx: 0.25 }, 1));
  return merge(parts);
}

function snailGeometry() {
  const parts = [];
  const skin = '#F3D9B8';
  parts.push(part(tube([V(0, 0.014, -0.085), V(0, 0.016, 0.03), V(0, 0.03, 0.082), V(0, 0.055, 0.105)], (t) => lerp(0.012, 0.019, Math.sin(t * Math.PI)) + 0.004, { radial: 7 }), skin));
  for (const side of [-1, 1]) {
    parts.push(part(tube([V(side * 0.008, 0.06, 0.105), V(side * 0.02, 0.1, 0.125)], 0.004, { radial: 4 }), skin));
    parts.push(ball(palette.ink, 0.007, { x: side * 0.02, y: 0.103, z: 0.126 }, 1));
  }
  // The shell, with its spiral painted on
  const shell = icoSphere(1, 3);
  const a = col(brand.peach.dot);
  const b = col(brand.butter.soft);
  paint(shell, (p, n, i, out) => {
    const r = Math.hypot(p.y, p.z);
    const ang = Math.atan2(p.y, p.z);
    const spiral = 0.5 + 0.5 * Math.sin(r * 15 - ang + (p.x < 0 ? Math.PI : 0));
    out.copy(a).lerp(b, smoothstep(0.35, 0.65, spiral));
  });
  parts.push(place(shell, { sx: 0.036, sy: 0.058, sz: 0.058, y: 0.066, z: -0.015 }));
  return merge(parts);
}

function hedgehogGeometry(rng) {
  const parts = [];
  const quill = col('#8C6E57');
  const tip = col('#E9D5B5');
  // Quills: every other point of a fine sphere pulled out into a spike
  const coat = icoSphere(1, 3);
  displace(coat, (p, n, i) => {
    const front = saturate((p.z - 0.25) * 2.2);
    const spike = (i % 3 === 0 ? 0.3 : 0) * saturate(p.y * 1.4 + 0.75) * (1 - front);
    p.multiplyScalar(1 + spike + rng.range(-0.02, 0.02));
    p.set(p.x * 0.15, p.y * 0.125, p.z * 0.2);
    p.y = Math.max(p.y, -0.07) + 0.09;
  });
  paint(coat, (p, n, i, out) => {
    const r = Math.hypot(p.x / 0.15, (p.y - 0.09) / 0.125, p.z / 0.2);
    out.copy(quill).lerp(tip, smoothstep(1.05, 1.28, r));
  });
  parts.push(coat);
  const face = '#F2DEC0';
  const snout = icoSphere(1, 2);
  displace(snout, (p) => {
    const taper = 1 - saturate(p.z) * 0.55;
    p.set(p.x * 0.085 * taper, p.y * 0.07 * taper, p.z * 0.11);
  });
  shaded(snout, face, 0.9, 1.04);
  parts.push(place(snout, { y: 0.07, z: 0.185 }));
  parts.push(ball(palette.ink, 0.019, { y: 0.074, z: 0.295 }, 1));
  for (const side of [-1, 1]) {
    parts.push(ball(palette.ink, 0.012, { x: side * 0.04, y: 0.1, z: 0.245 }, 1));
    parts.push(ball(face, 1, { x: side * 0.074, y: 0.128, z: 0.16, sx: 0.022, sy: 0.026, sz: 0.012 }, 1));
    parts.push(ball(face, 1, { x: side * 0.07, y: 0.014, z: 0.12, sx: 0.022, sy: 0.014, sz: 0.032 }, 1));
    parts.push(ball(face, 1, { x: side * 0.075, y: 0.014, z: -0.09, sx: 0.022, sy: 0.014, sz: 0.032 }, 1));
  }
  return merge(parts);
}

// One wing, lying flat and reaching out along +x, hinged on the z axis.
function wingGeometry(outline, { root = 0.55 } = {}) {
  const position = [0, 0, 0];
  const color = [root, root, root];
  const index = [];
  outline.forEach(([x, z], i) => {
    position.push(x, 0, z);
    const reach = saturate(Math.hypot(x, z) / 0.16);
    const shade = lerp(root, 1.06, Math.pow(reach, 0.7));
    color.push(shade, shade, shade);
    if (i > 0) index.push(0, i + 1, i);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(position, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(position.length).fill(0).map((v, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(new Array(position.length / 3).fill(0), 1));
  g.setIndex(index);
  return g;
}

const withSway = (g) => g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));

export function createCritters(field, kit, { meadow, trees }, quality) {
  const group = new THREE.Group();
  group.name = 'critters';
  const rng = createRng(909);
  const anchors = {};
  const updaters = [];

  // A step from a spot on the plot, in the frame of that spot's turn
  const near = (x, z, yaw, lx, lz) => [x + lx * Math.cos(yaw) + lz * Math.sin(yaw), z - lx * Math.sin(yaw) + lz * Math.cos(yaw)];
  // Two homes: one for the warm months, one indoors for the winter. The
  // animal comes up in one as it goes from the other.
  const homes = (build, out, inside, size) => {
    const pair = [out, inside].map((home) => {
      const g = build();
      g.position.set(...home.at);
      g.rotation.y = home.yaw;
      group.add(g);
      return g;
    });
    updaters.push(() => {
      const winter = season.v.setWinter;
      pair.forEach((g, i) => {
        const here = i ? winter : 1 - winter;
        g.visible = here > 0.004;
        if (g.visible) g.scale.setScalar(size * ease.outBack(saturate(here * 1.3 - 0.15)));
      });
    });
    return pair;
  };

  // ---------- The dog ----------
  // Lies before its house, head up, watching the garden, its tail going now
  // and then. In winter it has the rug before the fire.
  {
    const geometry = dogGeometry();
    const { doghouse } = YARD;
    const [ox, oz] = near(doghouse.x, doghouse.z, doghouse.yaw, 0.15, 1.05);
    const [fx, fy, fz] = FURNITURE.rug;
    const dogs = homes(
      () => {
        const dog = new THREE.Group();
        dog.name = 'dog';
        dog.add(mesh(geometry.body, kit.creature, { name: 'dog-body' }));
        const head = new THREE.Group();
        head.position.copy(geometry.neck);
        head.add(mesh(geometry.head, kit.creature, { name: 'dog-head' }));
        const tail = new THREE.Group();
        tail.position.copy(geometry.tailRoot);
        tail.add(mesh(geometry.tail, kit.creature, { name: 'dog-tail' }));
        dog.add(head, tail);
        dog.userData = { head, tail };
        return dog;
      },
      { at: [ox, field.height(ox, oz) - 0.01, oz], yaw: doghouse.yaw + 0.35 },
      // On the rug, its nose to the fire
      { at: [fx - 1.05, fy + 0.014, fz + 0.2], yaw: -Math.PI / 2 - 0.25 },
      1.05
    );
    updaters.push((time) => {
      dogs.forEach((dog, i) => {
        if (!dog.visible) return;
        const { head, tail } = dog.userData;
        // Looks about the garden in turns; by the fire it dozes, head low
        const look = Math.floor(time * 0.22 + i * 0.5);
        const turn = Math.abs(Math.sin(look * 12.9898 + i) * 43758.5453) % 1;
        head.rotation.y += ((i ? 0.2 : (turn - 0.5) * 1.4) - head.rotation.y) * 0.04;
        head.rotation.x = i ? 0.42 + Math.sin(time * 0.9) * 0.02 : Math.sin(time * 0.7) * 0.04;
        // A wag in bursts
        const wag = Math.sqrt(saturate(Math.sin(time * 0.31 + i * 2) * 1.6 - 0.6));
        tail.rotation.y = Math.sin(time * 11) * 0.45 * wag;
        dog.children[0].scale.y = 1 + Math.sin(time * (i ? 1.4 : 2.2)) * 0.015;
      });
    });
    anchors.dog = dogs[0];
  }

  // ---------- The cat ----------
  // Asleep on the porch bench from spring to autumn, on the sofa in winter
  {
    const geometry = catGeometry();
    const [sx, sy, sz, syaw] = FURNITURE.sofa;
    const [cx, cz] = near(sx, sz, syaw, 0.05, 0.12);
    const cats = homes(
      () => mesh(geometry, kit.creature, { name: 'cat' }),
      { at: [4.7, YARD.terrace.top + 0.49, 0.86], yaw: 0.5 },
      { at: [cx, sy + 0.55, cz], yaw: syaw + 2.4 },
      1
    );
    updaters.push((time) => {
      for (const cat of cats) if (cat.visible) cat.scale.y *= 1 + Math.sin(time * 1.7) * 0.025;
    });
    anchors.cat = cats[0];
  }

  // ---------- Small birds ----------
  {
    const geometry = titGeometry();
    const { birdhouse } = YARD;
    const perches = [
      // On the ridge of the birdhouse's roof
      { p: V(birdhouse.x, field.height(birdhouse.x, birdhouse.z) + 2.05, birdhouse.z), yaw: 0.4 + Math.PI / 2, s: 1.35 },
    ];
    const swing = trees.anchors.swing;
    if (swing) perches.push({ p: swing.point.clone().add(V(Math.cos(swing.yaw) * 0.45, swing.limbRadius * 0.9, -Math.sin(swing.yaw) * 0.45)), yaw: swing.yaw + Math.PI / 2, s: 1.5 });
    perches.forEach((perch, i) => {
      const bird = mesh(geometry, kit.creature, { name: 'tit' });
      bird.position.copy(perch.p);
      bird.scale.setScalar(perch.s);
      bird.rotation.order = 'YXZ';
      group.add(bird);
      updaters.push((time) => {
        // Birds move in jumps: hold a pose, then flick to the next
        const beat = Math.floor(time * 0.6 + i * 0.37);
        const pose = (n) => {
          const v = Math.sin(n * 12.9898 + i * 4.1) * 43758.5453;
          return (v - Math.floor(v) - 0.5) * 1.5;
        };
        const snap = smoothstep(0, 0.12, (time * 0.6 + i * 0.37) % 1);
        bird.rotation.y = perch.yaw + lerp(pose(beat - 1), pose(beat), snap);
        bird.rotation.x = Math.sin(time * 2.2 + i) * 0.05;
        bird.position.y = perch.p.y + Math.abs(Math.sin(time * 4.4 + i)) * 0.004;
      });
      if (i === 0) anchors.bird = bird;
    });

    // In winter seed is scattered under the birdhouse, and a great tit and a
    // bullfinch come down for it
    {
      const ground = field.height(birdhouse.x, birdhouse.z);
      [
        { colours: { cap: palette.ink, back: '#A9B97A', belly: palette.butter, wing: '#5E6A7E' }, at: [0.32, 0.22], turn: 0.7, s: 1.5 },
        { colours: { cap: palette.ink, back: '#A7B1C6', belly: '#EE8A78', cheek: '#EE8A78', wing: '#3A3F4F' }, at: [0.05, 0.42], turn: -1.0, s: 1.7 },
      ].forEach((guest, i) => {
        const bird = mesh(titGeometry(guest.colours), kit.creature, { name: 'winter-guest' });
        const [lx, lz] = guest.at;
        bird.position.set(birdhouse.x + lx, ground + 0.03, birdhouse.z + lz);
        bird.rotation.order = 'YXZ';
        group.add(bird);
        updaters.push((time) => {
          const here = season.v.setWinter;
          bird.visible = here > 0.004;
          if (!bird.visible) return;
          bird.scale.setScalar(guest.s * ease.outBack(saturate(here * 1.5 - 0.4 - i * 0.1)));
          // Pecks at the seeds, looks up, pecks again
          const peck = Math.pow(saturate(Math.sin(time * 5.2 + i * 2.6) * Math.sin(time * 0.47 + i * 1.7) * 1.6), 2);
          bird.rotation.set(peck * 0.8, guest.turn + Math.sin(Math.floor(time * 0.4 + i * 0.6) * 12.9898) * 0.5, 0);
        });
      });
    }
  }

  // ---------- The snail and the hedgehog ----------
  // The snail climbs the board of the first raised bed; the hedgehog
  // snuffles along the foot of the compost box. Both sleep the winter away.
  {
    const bed = YARD.beds[0];
    const top = field.height(bed.x, bed.z) + 0.34;
    const snail = mesh(snailGeometry(), kit.creature, { name: 'snail' });
    group.add(snail);
    updaters.push((time) => {
      const here = season.v.crawlers;
      snail.visible = here > 0.004;
      if (!snail.visible) return;
      snail.scale.setScalar(1.7 * ease.outBack(saturate(here)));
      // A snail's pace along the board, there and back
      const crawl = Math.sin(time * 0.05) * 0.6;
      snail.position.set(bed.x + bed.w / 2 - 0.03, top - 0.006, bed.z + crawl);
      snail.rotation.y = (1 - smoothstep(-0.15, 0.15, Math.cos(time * 0.05))) * Math.PI;
      snail.scale.z *= 1 + Math.sin(time * 1.4) * 0.04;
    });
    anchors.snail = snail;
  }
  {
    const { compost } = YARD;
    const [hx, hz] = near(compost.x, compost.z, compost.yaw, -0.3, 0.8);
    const heading = compost.yaw + 1.2;
    const hog = mesh(hedgehogGeometry(createRng(12)), kit.creature, { name: 'hedgehog' });
    hog.position.set(hx, field.height(hx, hz) - 0.005, hz);
    hog.rotation.order = 'YXZ';
    hog.rotation.y = heading;
    group.add(hog);
    updaters.push((time) => {
      const here = season.v.crawlers;
      hog.visible = here > 0.004;
      if (!hog.visible) return;
      hog.scale.setScalar(1.15 * ease.outBack(saturate(here)));
      // Snuffling about
      hog.rotation.x = Math.sin(time * 2.6) * 0.035 + 0.03;
      hog.rotation.y = heading + Math.sin(time * 0.4) * 0.25;
      hog.scale.y *= 1 + Math.sin(time * 2.6) * 0.02;
    });
    anchors.hedgehog = hog;
  }

  // ---------- Flyers ----------
  // Wings are instanced: two (or four) per animal, their matrices rebuilt
  // every frame from the animal's position, heading and wingbeat.
  const flock = (name, wing, bodyGeometry, animals, wingsEach) => {
    const wings = new THREE.InstancedMesh(wing, kit.creatureDouble, animals.length * wingsEach);
    wings.name = `${name}-wings`;
    wings.frustumCulled = false;
    wings.castShadow = false;
    const bodies = new THREE.InstancedMesh(bodyGeometry, kit.creatureDouble, animals.length);
    bodies.name = `${name}-bodies`;
    bodies.frustumCulled = false;
    bodies.castShadow = false;
    animals.forEach((a, i) => {
      for (let w = 0; w < wingsEach; w++) wings.setColorAt(i * wingsEach + w, a.color);
      bodies.setColorAt(i, a.bodyColor);
    });
    wings.instanceColor.needsUpdate = true;
    bodies.instanceColor.needsUpdate = true;
    group.add(wings, bodies);
    return { wings, bodies };
  };
  const setWing = (im, index, pos, yaw, pitch, roll, flap, side, scale, sweep = 0) => {
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(pos, _q, _s.setScalar(scale));
    // In the animal's own space: mirror for the left wing, sweep, then lift
    _w.makeRotationZ(side * flap);
    if (sweep) _w.multiply(_w2.makeRotationY(-side * sweep));
    if (side < 0) _w.multiply(_w2.makeScale(-1, 1, 1));
    im.setMatrixAt(index, _m.multiply(_w));
  };
  const setBody = (im, index, pos, yaw, pitch, roll, scale) => {
    _e.set(pitch, yaw, roll, 'YXZ');
    _q.setFromEuler(_e);
    im.setMatrixAt(index, _m.compose(pos, _q, _s.setScalar(scale)));
  };

  // Butterflies over the daisies
  if (meadow.flowerSpots.length) {
    const wing = wingGeometry(
      [
        [0.012, 0.02],
        [0.05, 0.115],
        [0.125, 0.135],
        [0.172, 0.075],
        [0.15, 0.012],
        [0.118, -0.018],
        [0.125, -0.085],
        [0.075, -0.13],
        [0.022, -0.075],
        [0.008, -0.02],
      ],
      { root: 0.5 }
    );
    const body = withSway(part(tube([V(0, 0, -0.07), V(0, 0.004, 0), V(0, 0, 0.065)], 0.011, { radial: 5 }), palette.white));
    const tints = [brand.peach.dot, brand.lilac.dot, brand.butter.dot, brand.sky.dot, palette.white, palette.pink, brand.peach.mid];
    const count = Math.min(meadow.flowerSpots.length, quality.density > 0.5 ? 9 : 5);
    const animals = [];
    for (let i = 0; i < count; i++) {
      const home = meadow.flowerSpots[Math.floor((i / count) * meadow.flowerSpots.length)];
      animals.push({
        home,
        color: col(tints[i % tints.length]).clone(),
        bodyColor: col(palette.ink).clone().lerp(col(palette.white), 0.25),
        speed: rng.range(0.32, 0.55) * rng.sign(),
        phase: rng.range(0, TAU),
        rx: rng.range(0.7, 1.5),
        rz: rng.range(0.6, 1.3),
        beat: rng.range(11, 15),
        size: rng.range(0.62, 0.86),
      });
    }
    const { wings, bodies } = flock('butterfly', wing, body, animals, 2);
    const at = (a, time, out) => {
      const t = time * a.speed + a.phase;
      return out.set(
        a.home.x + Math.sin(t) * a.rx + Math.sin(t * 2.7 + a.phase) * 0.22,
        a.home.y + 0.18 + Math.sin(t * 1.9) * 0.2 + Math.sin(time * a.beat) * 0.022,
        a.home.z + Math.cos(t * 0.8 + 1) * a.rz + Math.cos(t * 3.1) * 0.18
      );
    };
    updaters.push((time) => {
      // The first few are out in spring, all of them by summer, none after the leaves turn
      const out = season.v.flyers * animals.length;
      wings.visible = bodies.visible = out > 0.004;
      if (!wings.visible) return;
      animals.forEach((a, i) => {
        at(a, time, _p);
        at(a, time + 0.08, _t);
        const yaw = Math.atan2(_t.x - _p.x, _t.z - _p.z);
        // Wings clap above the back and open flat, never below
        const flap = 0.62 + Math.sin(time * a.beat) * 0.6;
        const size = a.size * saturate(out - i);
        setWing(wings, i * 2, _p, yaw, -0.3, 0, flap, 1, size);
        setWing(wings, i * 2 + 1, _p, yaw, -0.3, 0, flap, -1, size);
        setBody(bodies, i, _p, yaw, -0.3, 0, size);
      });
      wings.instanceMatrix.needsUpdate = true;
      bodies.instanceMatrix.needsUpdate = true;
    });
    anchors.butterflies = animals.map((a) => a.home);
  }

  // Birds wheeling far off, behind the island
  {
    const wing = wingGeometry(
      [
        [0.0, 0.1],
        [0.3, 0.13],
        [0.62, 0.02],
        [0.7, -0.08],
        [0.36, -0.03],
        [0.0, -0.1],
      ],
      { root: 0.8 }
    );
    const body = withSway(ball(palette.white, 1, { sx: 0.07, sy: 0.06, sz: 0.24 }, 1));
    const count = quality.density > 0.5 ? 5 : 3;
    const animals = [];
    for (let i = 0; i < count; i++) {
      animals.push({
        color: col('#8FA6CF').clone(),
        bodyColor: col('#8FA6CF').clone(),
        angle: i * 0.21 + rng.range(-0.05, 0.05),
        radius: 19 + rng.range(-2.5, 2.5),
        height: 12.5 + rng.range(-1.6, 1.6),
        beat: rng.range(2.6, 3.4),
        phase: rng.range(0, TAU),
        size: rng.range(0.62, 0.86),
      });
    }
    const { wings, bodies } = flock('bird', wing, body, animals, 2);
    const centre = V(-6, 0, -15);
    // In autumn they stop wheeling and draw up into a wedge that crosses over
    // the island, now and then, on its way south. In winter the sky is empty.
    const crossing = 34;
    const pause = 22;
    const from = V(-37, 9.2, 3.5);
    const to = V(27, 12.8, -12);
    const heading = Math.atan2(to.x - from.x, to.z - from.z);
    const ahead = V(to.x - from.x, 0, to.z - from.z).normalize();
    const lead = V();
    updaters.push((time) => {
      const v = season.v;
      wings.visible = bodies.visible = v.farBirds > 0.004;
      if (!wings.visible) return;
      const wedge = v.flock;
      const lap = Math.min(1, ((time + 12) % (crossing + pause)) / crossing);
      lead.lerpVectors(from, to, lap);
      const ends = smoothstep(0, 0.06, lap) * (1 - smoothstep(0.94, 1, lap));
      animals.forEach((a, i) => {
        const ang = time * 0.055 + a.angle;
        _p.set(centre.x + Math.cos(ang) * a.radius, a.height + Math.sin(time * 0.3 + a.phase) * 0.7, centre.z + Math.sin(ang) * a.radius * 0.8);
        let yaw = Math.atan2(-Math.sin(ang), Math.cos(ang) * 0.8);
        // A few slow beats, then a glide
        const glide = smoothstep(0.2, 0.6, Math.sin(time * 0.37 + a.phase));
        let flap = 0.16 + Math.sin(time * a.beat + a.phase) * 0.5 * (1 - glide * 0.85);
        let size = a.size * v.farBirds;
        if (wedge > 0) {
          // One leads, the rest fall in behind on either side
          const rank = Math.ceil(i / 2);
          const arm = i % 2 ? 1 : -1;
          _t.copy(lead).addScaledVector(ahead, -rank * 1.3);
          _t.x += ahead.z * arm * rank * 1.0;
          _t.z -= ahead.x * arm * rank * 1.0;
          _t.y += rank * 0.14 + Math.sin(time * 0.5 + i) * 0.12;
          _p.lerp(_t, wedge);
          if (wedge > 0.5) yaw = heading;
          flap = lerp(flap, 0.1 + Math.sin(time * 3.4 + i * 0.9) * 0.5, wedge);
          size *= lerp(1, ends, wedge);
        }
        setWing(wings, i * 2, _p, yaw, 0, 0.2, flap, 1, size);
        setWing(wings, i * 2 + 1, _p, yaw, 0, 0.2, flap, -1, size);
        setBody(bodies, i, _p, yaw, 0, 0.2, size);
      });
      wings.instanceMatrix.needsUpdate = true;
      bodies.instanceMatrix.needsUpdate = true;
    });
  }

  function update(time, dt) {
    for (const fn of updaters) fn(time, dt);
  }
  // Fill every instance matrix before the first frame is drawn
  update(0, 0);

  return { group, anchors, update };
}
