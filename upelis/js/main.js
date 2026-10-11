import * as THREE from './core/three.js';
import { pickQuality, isSoftwareRenderer, lowTier, pixelRatioFor } from './core/quality.js';
import { loadTextures } from './core/assets.js';
import { shared, installSoftShadows } from './core/materials.js';
import { createRig } from './core/rig.js';
import { palette, col } from './core/palette.js';
import { clamp, ease } from './core/math.js';
import { CAMERA, CREEK, PROPS } from './world/layout.js';
import { createField } from './world/field.js';
import { createTerrain } from './world/terrain.js';
import { createAtmosphere } from './world/atmosphere.js';
import { createWater } from './world/water.js';
import { createKit } from './world/kit.js';
import { createRocks } from './world/rocks.js';
import { createTrees } from './world/trees.js';
import { createMeadow } from './world/meadow.js';
import { createProps } from './world/props.js';
import { createCritters } from './world/critters.js';
import { createPost } from './fx/post.js';
import { createAmbient } from './fx/ambient.js';
import { createExperience } from './ui/experience.js';
import { renderFallback } from './ui/fallback.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('scene');
const root = document.getElementById('creek');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const debug = new URLSearchParams(window.location.search).has('debug');

// Yield to the browser between build steps. The timer keeps the build moving
// when the tab is in the background and frames are not being painted.
const nextFrame = () =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, 80);
    requestAnimationFrame(() => {
      clearTimeout(timer);
      resolve();
    });
  });

// Without the picture the page still has its ideas to give.
function fallBack(state) {
  root.dataset.state = state;
  renderFallback(document.getElementById('fallback'));
}

function createRenderer(quality) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: quality.antialias,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setClearColor(0xf4f7fc, 1);
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.info.autoReset = true;
  return renderer;
}

async function boot() {
  let quality = pickQuality();
  let renderer;
  try {
    renderer = createRenderer(quality);
  } catch (error) {
    fallBack('unsupported');
    return;
  }
  if (!quality.forced && isSoftwareRenderer(renderer.getContext())) quality = { ...lowTier(), antialias: quality.antialias };
  // Nothing that casts a shadow moves fast, so the lighter tiers redraw the
  // shadow map every second or third frame
  renderer.shadowMap.autoUpdate = quality.shadowEvery === 1;
  renderer.shadowMap.needsUpdate = true;

  const audio = createAudio();
  let ambient = null;
  const ui = createExperience(root, {
    onCelebrate: () => ambient?.celebrate(),
    onSound: (on) => audio.toggle(on),
  });
  if (!audio.supported) document.getElementById('sound').hidden = true;

  // Each finished step moves the loader along and lets the page breathe
  const built = (share) => {
    ui.setLoading(share);
    return nextFrame();
  };

  installSoftShadows(quality.shadowTaps);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(col(palette.haze), 70, 190);
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 400);

  ui.setLoading(0.06);
  const textures = await loadTextures(renderer, (share) => ui.setLoading(0.06 + share * 0.3));
  shared.uWash.value = textures.wash;
  await nextFrame();

  const field = createField(7);
  await built(0.42);

  const atmosphere = createAtmosphere(textures, quality);
  scene.add(atmosphere.group);

  const terrain = createTerrain(field, textures);
  scene.add(terrain.group);
  await built(0.52);

  const kit = createKit(textures);
  const rocks = createRocks(field, kit);
  scene.add(rocks.group);
  await built(0.58);

  const water = createWater(field, textures, { obstacles: rocks.obstacles });
  scene.add(water.group);
  await built(0.66);

  const trees = createTrees(field, kit, textures, quality);
  scene.add(trees.group);
  await built(0.76);

  const meadow = createMeadow(field, terrain, kit, quality);
  scene.add(meadow.group);
  await built(0.85);

  const props = createProps(field, kit, trees, water);
  scene.add(props.group);
  await built(0.9);

  const critters = createCritters(field, kit, { meadow, water, props }, quality);
  scene.add(critters.group);
  await built(0.94);

  ambient = createAmbient(renderer, { water, field, quality, reducedMotion });
  scene.add(ambient.group);

  // Points the overview has to keep in frame: the rim, the treetops, the keel
  const fitPoints = [];
  for (let i = 0; i < terrain.ring.length; i += 8) fitPoints.push(terrain.ring[i]);
  fitPoints.push(new THREE.Vector3(-8.7, 7.4, 4.9), new THREE.Vector3(11.9, 7.2, -4.5), new THREE.Vector3(-11, 7.9, -9), new THREE.Vector3(-3, -7.6, -1.2));
  fitPoints.push(new THREE.Vector3(PROPS.kite.x + 0.6, PROPS.kite.y + 1.1, PROPS.kite.z));

  const rig = createRig(camera, canvas, {
    target: CAMERA.target,
    homes: CAMERA,
    fitPoints,
    reducedMotion,
    onInteract: () => ui.interacted(),
  });

  // ---------- Where the markers float ----------
  const fixed = (p, lift = 0) => {
    const at = new THREE.Vector3(p.x, p.y + lift, p.z);
    return (out) => out.copy(at);
  };
  const fall = water.falls[0];
  const stones = rocks.stepping.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(rocks.stepping.length || 1);
  const pool = CREEK[8];
  const anchors = {
    krioklys: fixed(new THREE.Vector3().lerpVectors(fall.bottom, fall.top, 0.55), 0.1),
    akmenukai: fixed(stones, 0.3),
    laivelis: (out) => out.copy(props.anchors.boat.position).setY(props.anchors.boat.position.y + 0.85),
    gandras: fixed(critters.anchors.storkTop, 0.1),
    tiltelis: fixed(props.anchors.bridgeTop),
    azuolas: fixed(trees.anchors.swingSeat, 1.05),
    rastas: fixed(props.anchors.log, 0.15),
    krantas: fixed(props.anchors.cairn, 0.55),
    iskyla: fixed(props.anchors.picnic, 0.2),
    pieva: fixed(props.anchors.kitePeg, 0.75),
  };
  // The boat keeps sailing, so the camera looks at its pool instead; the
  // meadow is framed with its kite in the sky
  const focus = {
    laivelis: fixed(new THREE.Vector3(pool.x, 0.9, pool.z)),
    pieva: fixed(new THREE.Vector3(props.anchors.kitePeg.x - 0.2, 3.3, props.anchors.kitePeg.z - 0.9)),
  };
  ui.attach({ rig, camera, anchors, focus });

  const post = createPost(renderer, quality, textures.wash);

  let dprScale = 1;
  function resize() {
    const width = root.clientWidth || window.innerWidth;
    const height = root.clientHeight || window.innerHeight;
    const dpr = pixelRatioFor(quality, width, height, dprScale);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    post.setSize(width * dpr, height * dpr);
    rig.resize(width, height);
    scene.fog.near = rig.fit * 1.08;
    scene.fog.far = rig.fit * 2.9;
  }
  resize();
  new ResizeObserver(resize).observe(root);

  // Frames that run long cost the picture some sharpness; smooth ones earn it
  // back, once. A device that cannot hold the higher setting stays lower.
  const governor = { slow: 0, fast: 0, settled: false, quiet: 3 };
  function govern(dt) {
    if (governor.quiet > 0) {
      governor.quiet -= dt;
      return;
    }
    if (dt > 1 / 38) {
      governor.slow += dt;
      governor.fast = 0;
    } else {
      governor.slow = Math.max(0, governor.slow - dt * 0.5);
      if (dt < 1 / 52) governor.fast += dt;
    }
    if (governor.slow > 1.2 && dprScale > 0.62) {
      if (dprScale < 1) governor.settled = true;
      dprScale = Math.max(0.6, dprScale * 0.85);
    } else if (governor.slow > 1.2 && post.state.dof > 0) {
      // Still slow at the lowest resolution: the soft focus is the next to go
      post.state.dof = 0;
      governor.slow = 0;
      return;
    } else if (governor.fast > 10 && dprScale < 1 && !governor.settled) {
      dprScale = Math.min(1, dprScale / 0.85);
    } else {
      return;
    }
    governor.slow = 0;
    governor.fast = 0;
    governor.quiet = 1.5;
    resize();
  }

  if (debug || reducedMotion) rig.goHome(0);
  else rig.intro();

  // Draw once behind the loader, so every shader is ready before the flight
  post.state.reveal = 0;
  rig.update(0, 0);
  post.render(scene, camera, { focus: rig.view.dist, time: 0 });
  await built(1);
  await nextFrame();

  let last = performance.now();
  let time = 0;
  let reveal = 0;
  let started = false;
  let frames = 0;
  let pending = 0;

  // One step of the world and one drawing of it.
  function tick(dt) {
    time += dt;
    shared.uTime.value = time;

    if (reveal < 1) {
      // The picture soaks into the page like paint into wet paper
      reveal = Math.min(1, reveal + dt / (debug || reducedMotion ? 0.2 : 1.5));
      post.state.reveal = ease.outCubic(reveal);
    }
    // The markers arrive as the opening flight settles
    if (!started && time > 0.5 && (time > 2.7 || !rig.flying)) {
      started = true;
      ui.start();
    }

    rig.update(dt, time);
    atmosphere.update(time);
    trees.update(time);
    props.update(time, dt);
    critters.update(time, dt);
    ambient.update(time, dt);
    ui.update();
    if (quality.shadowEvery > 1 && frames++ % quality.shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    audio.near((1 - clamp(Math.hypot(rig.view.x - fall.bottom.x, rig.view.z - fall.bottom.z) / 13, 0, 1)) * (1 - clamp((rig.zoom - 0.3) / 0.7, 0, 1)));
    post.render(scene, camera, { focus: rig.view.dist, time });
  }

  function frame(stamp = performance.now()) {
    pending = requestAnimationFrame(frame);
    const elapsed = Math.max((stamp - last) / 1000, 0);
    last = stamp;
    tick(Math.min(elapsed, 0.05));
    if (elapsed < 0.25) govern(elapsed);
  }

  // Nothing is drawn while the tab is out of sight. The frame left waiting is
  // dropped first, or it would wake up beside the new one and draw twice.
  document.addEventListener('visibilitychange', () => {
    cancelAnimationFrame(pending);
    if (document.hidden) return;
    last = performance.now();
    governor.quiet = 1.5;
    frame();
  });

  // A lost context comes back by itself if the page lets it
  canvas.addEventListener('webglcontextlost', (event) => event.preventDefault());

  root.dataset.state = 'ready';
  frame();

  if (debug) {
    window.__creek = { THREE, renderer, scene, camera, rig, field, quality, post, shared, textures, water, trees, rocks, kit, meadow, terrain, props, critters, ambient, ui, audio };
    // Runs the world forward by hand, for looking at it where frames are not being painted
    window.__creek.advance = (seconds, step = 1 / 30) => {
      for (let t = 0; t < seconds; t += step) tick(step);
    };
  }
}

boot().catch((error) => {
  console.error('[creek]', error);
  fallBack('error');
});
