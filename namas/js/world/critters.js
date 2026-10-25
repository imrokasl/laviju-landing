import * as THREE from '../core/three.js';
import { TAU, createRng, ease, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, brand, col } from '../core/palette.js';
import { season } from '../core/season.js';
import { mesh } from './kit.js';
import { YARD, FURNITURE } from './layout.js';

// Who lives here: the dog and the cat, the birds of the garden, a snail and
// a hedgehog, and the small things that fly. Each keeps its own calendar:
// the dog and the cat come indoors for the winter, the snail and the
// hedgehog sleep it away, and the seed under the birdhouse has its guests
// only while there is snow.
// Every animal is modelled in Blender (landing-web/namas/blender/critters.py)
// and comes in flora.bin, on its own feet and facing +z in its own space.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _t = new THREE.Vector3();
const _w = new THREE.Matrix4();
const _w2 = new THREE.Matrix4();

// ---------- Models ----------
// One animal, or a part of one, as critters.py modelled it: its own colours
// with the shade of its folds baked in, or, for a flyer, shades of the
// colour each copy is given.
function creature(flora, name) {
  const part = flora.parts.get(name);
  const a = part.attributes;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(a.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(a.normal, 3));
  g.normalizeNormals();
  g.setAttribute('color', new THREE.BufferAttribute(a.color, 3));
  g.setIndex(new THREE.BufferAttribute(part.index, 1));
  g.computeBoundingSphere();
  return g;
}

// A part that moves (the dog's head, its tail) is kept about the point it
// turns on, and says where on the body that is
const pivot = (flora, name) => new THREE.Vector3().fromArray(flora.parts.get(name).pivot);

// Wings and bodies that are copied are drawn by a material that sways
const withSway = (g) => g.setAttribute('sway', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count), 1));

export function createCritters(field, kit, { meadow, trees, flora }, quality) {
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
    const body = creature(flora, 'dog');
    const headGeometry = creature(flora, 'dog-head');
    const tailGeometry = creature(flora, 'dog-tail');
    const { doghouse } = YARD;
    const [ox, oz] = near(doghouse.x, doghouse.z, doghouse.yaw, 0.15, 1.05);
    const [fx, fy, fz] = FURNITURE.rug;
    const dogs = homes(
      () => {
        const dog = new THREE.Group();
        dog.name = 'dog';
        dog.add(mesh(body, kit.creature, { name: 'dog-body' }));
        const head = new THREE.Group();
        head.position.copy(pivot(flora, 'dog-head'));
        head.add(mesh(headGeometry, kit.creature, { name: 'dog-head' }));
        const tail = new THREE.Group();
        tail.position.copy(pivot(flora, 'dog-tail'));
        tail.add(mesh(tailGeometry, kit.creature, { name: 'dog-tail' }));
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
    const geometry = creature(flora, 'cat');
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
    const geometry = creature(flora, 'blue-tit');
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
        { kind: 'great-tit', at: [0.32, 0.22], turn: 0.7, s: 1.5 },
        { kind: 'bullfinch', at: [0.05, 0.42], turn: -1.0, s: 1.6 },
      ].forEach((guest, i) => {
        const bird = mesh(creature(flora, guest.kind), kit.creature, { name: guest.kind });
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
    const snail = mesh(creature(flora, 'snail'), kit.creature, { name: 'snail' });
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
    const hog = mesh(creature(flora, 'hedgehog'), kit.creature, { name: 'hedgehog' });
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
    const wing = withSway(creature(flora, 'butterfly-wing'));
    const body = withSway(creature(flora, 'butterfly'));
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
    const wing = withSway(creature(flora, 'bird-wing'));
    const body = withSway(creature(flora, 'bird'));
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
