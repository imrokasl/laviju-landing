import * as THREE from './core/three.js';
import { pickQuality, isSoftwareRenderer, lowTier, pixelRatioFor } from './core/quality.js';
import { loadTextures } from './core/assets.js';
import { loadModels } from './core/models.js';
import { shared, installSoftShadows } from './core/materials.js';
import { createCalendar, season, seasonIndex, SEASON_IDS } from './core/season.js';
import { createRig } from './core/rig.js';
import { palette, col } from './core/palette.js';
import { clamp, ease, lerp, smoothstep } from './core/math.js';
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
const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
// The island opens in summer, unless the address asks for another season. From
// there on the year turns only when the visitor turns it.
const SUMMER = 1;
const asked = seasonIndex(params.get('season') ?? params.get('sezonas'));
const opening = asked >= 0 ? asked : SUMMER;

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
  renderFallback(document.getElementById('fallback'), SEASON_IDS[opening]);
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

  const calendar = createCalendar({ start: opening, reducedMotion });

  const audio = createAudio();
  let ambient = null;
  const ui = createExperience(root, {
    season: SEASON_IDS[season.index],
    // The rainbow belongs to a season whose ten places have all been found
    onCelebrate: (on) => ambient?.celebrate(on),
    onSound: (on) => audio.toggle(on),
    onSeason: (id) => {
      if (!calendar.go(id)) return;
      // The address remembers the season, so a link can be passed on as it is
      const url = new URL(window.location.href);
      url.searchParams.set('season', id);
      window.history.replaceState(null, '', url);
    },
    // The hour is the visitor's to set as well: the page opens by day
    onHour: (id) => calendar.hour(id),
    // Rain, mist and wind come and go at the visitor's word alone
    onWeather: (kind, on) => calendar.weather(kind, on),
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
  // The haze takes the colour of the season's air
  scene.fog.color = season.hues.haze;
  const camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, 1, 400);

  ui.setLoading(0.06);
  // The models made in Blender are fetched alongside the textures
  const modelsArriving = loadModels();
  const textures = await loadTextures(renderer, (share) => ui.setLoading(0.06 + share * 0.3));
  const models = await modelsArriving;
  shared.uWash.value = textures.wash;
  await nextFrame();

  const field = createField(7);
  await built(0.42);

  const atmosphere = createAtmosphere(textures, quality, { reducedMotion });
  scene.add(atmosphere.group);

  // The stones come first: the ground is shaded where they stand
  const kit = createKit(textures);
  const rocks = createRocks(field, kit);
  scene.add(rocks.group);
  await built(0.48);

  const terrain = createTerrain(field, textures, { footprints: rocks.footprints });
  scene.add(terrain.group);
  await built(0.58);

  const water = createWater(field, textures, { obstacles: rocks.obstacles });
  scene.add(water.group);
  await built(0.66);

  const trees = createTrees(field, kit, textures, quality, models);
  scene.add(trees.group);
  await built(0.76);

  const meadow = createMeadow(field, terrain, kit, quality);
  scene.add(meadow.group);
  await built(0.85);

  const props = createProps(field, kit, trees, water, models);
  scene.add(props.group);
  await built(0.9);

  const critters = createCritters(field, kit, { meadow, water, props }, quality);
  scene.add(critters.group);
  await built(0.94);

  ambient = createAmbient(renderer, { water, field, quality, textures, crowns: trees.anchors.crowns, candle: props.anchors.candle, reducedMotion });
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
  // A marker that follows something on the move
  const live = (p, lift = 0) => (out) => out.copy(p).setY(p.y + lift);
  // One spot for each season, spring first. While the year turns the marker
  // drifts from the old spot to the new one; asked about a season by number,
  // it answers with that season's spot wherever the year is now.
  const yearly = (...spots) => {
    const next = new THREE.Vector3();
    return (out, p = season.p) => {
      const at = Math.floor(p) % 4;
      const turn = smoothstep(0.3, 0.7, p - Math.floor(p));
      spots[at](out, p);
      if (turn > 0) out.lerp(spots[(at + 1) % 4](next, p), turn);
      return out;
    };
  };

  const fall = water.falls[0];
  const stones = rocks.stepping.reduce((sum, p) => sum.add(p), new THREE.Vector3()).divideScalar(rocks.stepping.length || 1);
  const pool = CREEK[8];
  const at = props.anchors;
  // The stork is followed while it is here; with it gone, the marker waits on the nest
  const nestTop = fixed(at.nestTop);
  const storkTop = live(critters.anchors.storkTop, 0.1);
  const _stork = new THREE.Vector3();
  const stork = (out) => {
    const here = smoothstep(0.9, 1, season.v.stork);
    nestTop(out);
    return here > 0 ? out.lerp(storkTop(_stork), here) : out;
  };
  const sailboat = live(at.boat.position, 0.85);
  const swing = fixed(trees.anchors.swingSeat, 1.05);
  const cairn = fixed(at.cairn, 0.55);
  const umbrella = fixed(at.umbrella, 0.8);
  const picnic = fixed(at.picnic, 0.2);
  const kitePeg = fixed(at.kitePeg, 0.75);
  const anchors = {
    krioklys: fixed(new THREE.Vector3().lerpVectors(fall.bottom, fall.top, 0.55), 0.1),
    akmenukai: fixed(stones, 0.3),
    laivelis: yearly(live(at.paperBoat, 0.6), sailboat, sailboat, sailboat),
    gandras: yearly(stork, stork, nestTop, fixed(at.feeder.top)),
    tiltelis: fixed(at.bridgeTop),
    azuolas: yearly(swing, swing, fixed(at.leafPile), fixed(at.sled)),
    rastas: fixed(at.log, 0.15),
    krantas: yearly(umbrella, cairn, cairn, fixed(at.iceBranch)),
    iskyla: yearly(picnic, picnic, picnic, fixed(at.lantern)),
    pieva: yearly(fixed(at.wreath, 0.6), kitePeg, kitePeg, fixed(at.snowman)),
  };
  // The boats keep moving, so the camera looks at their pool instead; the
  // meadow is framed with its kite in the sky while there is one, and the
  // stork's pole is too tall to be looked at from its top
  const kiteSky = fixed(new THREE.Vector3(at.kitePeg.x - 0.2, 3.3, at.kitePeg.z - 0.9));
  const poleMiddle = fixed(new THREE.Vector3(at.nestTop.x, at.nestTop.y - 1.7, at.nestTop.z));
  const focus = {
    laivelis: fixed(new THREE.Vector3(pool.x, 0.9, pool.z)),
    gandras: yearly(poleMiddle, anchors.gandras, poleMiddle, anchors.gandras),
    pieva: yearly(anchors.pieva, kiteSky, kiteSky, anchors.pieva),
  };
  ui.attach({ rig, camera, anchors, focus });

  const post = createPost(renderer, quality, textures.wash);
  // The stars and the moon are drawn over the finished frame, and are told
  // what of it stands in front of them
  if (post.active) atmosphere.behind(post.sceneTarget.depthTexture);

  // Where the moon hangs in the overview, across and up from the middle of
  // the frame, and how big: in the open sky to the right of the treetops, and
  // on an upright screen in what sky the title leaves over the island, where
  // it is a little smaller for the narrower frame
  const MOON = { wide: [0.5, 0.6, 1], upright: [0.56, 0.34, 0.78] };
  const moonAt = new THREE.Vector3();

  let dprScale = 1;
  function resize() {
    const width = root.clientWidth || window.innerWidth;
    const height = root.clientHeight || window.innerHeight;
    const dpr = pixelRatioFor(quality, width, height, dprScale);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    post.setSize(width * dpr, height * dpr);
    rig.resize(width, height);
    ui.resized();
    const upright = clamp((1.25 - width / height) / 0.6, 0, 1);
    rig.skyAt(lerp(MOON.wide[0], MOON.upright[0], upright), lerp(MOON.wide[1], MOON.upright[1], upright), moonAt);
    atmosphere.frame({ high: height * dpr, moon: moonAt, size: lerp(MOON.wide[2], MOON.upright[2], upright) });
    scene.fog.near = rig.overview * 1.08;
    scene.fog.far = rig.overview * 2.9;
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
    } else if (governor.slow > 1.2 && post.state.ao > 0) {
      // Still slow at the lowest resolution: the contact shade is the next to go,
      post.state.ao = 0;
      governor.slow = 0;
      return;
    } else if (governor.slow > 1.2 && post.state.dof > 0) {
      // ...and the soft focus after it
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

  // Draw behind the loader, so every shader is ready before the flight. The
  // things of the other seasons are brought out for this drawing and nothing
  // is passed over for being out of the frame: a season must not stop
  // half-way through its change to build a shader. It is drawn twice, first
  // with nothing casting a shadow: the shadow pass builds its shaders for the
  // lights of the frame before, and before the first frame there are none.
  // The shadow map itself is still drawn that first time, empty, so that the
  // lit shaders have one to read.
  post.state.reveal = 0;
  rig.update(0, 0);
  const away = [];
  const culled = [];
  const casting = [];
  scene.traverse((object) => {
    if (!object.visible) {
      away.push(object);
      object.visible = true;
    }
    if (object.frustumCulled) {
      culled.push(object);
      object.frustumCulled = false;
    }
    if (object.castShadow && !object.isLight) {
      casting.push(object);
      object.castShadow = false;
    }
  });
  for (const withShadows of [false, true]) {
    if (withShadows) for (const object of casting) object.castShadow = true;
    renderer.shadowMap.needsUpdate = true;
    post.render(scene, camera, { focus: rig.view.dist, time: 0 });
  }
  renderer.shadowMap.needsUpdate = true;
  for (const object of away) object.visible = false;
  for (const object of culled) object.frustumCulled = true;
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

    const turning = season.moving;
    calendar.update(dt);
    // The finish of the frame follows the year and the hour, and so does the
    // mix of the sound, in which rain is heard and the birds wait it out, and
    // the wind is heard too: the one asked for, and the gust a change of
    // season comes on. The birds are at their loudest in the morning, fewer
    // are still singing in the evening, and at night only one or two are.
    if (season.changed) post.grade(season.v.saturation, season.hues.gradeShadow, season.hues.gradeLight);
    // What is written on the sky is told once the sky has gone dark behind it
    const dark = season.night > 0.55;
    if (dark !== (root.dataset.sky === 'dark')) root.dataset.sky = dark ? 'dark' : 'light';
    const awake = 1 + 0.25 * season.dawn - 0.35 * season.dusk - 0.92 * season.night;
    audio.season(season.v.birdsong * (1 - 0.6 * season.rain) * (1 - 0.25 * season.windy) * awake, season.v.creekSound, season.v.muffle);
    audio.rain(season.rain);
    audio.wind(Math.max(season.windy, 0.6 * season.turning));
    if (turning && !season.moving) ui.settled();
    rig.update(dt, time);
    atmosphere.update(time);
    trees.update(time);
    meadow.update(time);
    props.update(time, dt);
    critters.update(time, dt);
    ambient.update(time, dt, post.state.reveal);
    ui.update();
    // While the season turns, the shadows turn with it on every frame
    if (season.changed || (quality.shadowEvery > 1 && frames++ % quality.shadowEvery === 0)) renderer.shadowMap.needsUpdate = true;
    audio.near((1 - clamp(Math.hypot(rig.view.x - fall.bottom.x, rig.view.z - fall.bottom.z) / 13, 0, 1)) * (1 - clamp((rig.zoom - 0.3) / 0.7, 0, 1)));
    // The paper margin is the overview's: it draws back as the view leans in,
    // and by night, when paper white would lie over the dark like fog
    post.render(scene, camera, { focus: rig.view.dist, time, margin: (0.25 + 0.75 * clamp((rig.zoom - 0.4) / 0.5, 0, 1)) * (1 - 0.85 * season.night) });
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
    window.__creek = { THREE, renderer, scene, camera, rig, field, quality, post, shared, textures, water, trees, rocks, kit, meadow, terrain, props, critters, ambient, ui, audio, atmosphere, calendar, season };
    // Runs the world forward by hand, for looking at it where frames are not being painted
    window.__creek.advance = (seconds, step = 1 / 30) => {
      for (let t = 0; t < seconds; t += step) tick(step);
    };
    // ...and keeps it at full sharpness there: frames that come now and then
    // look like slow ones to the governor, which would go on to blur the picture
    window.__creek.steady = () => {
      governor.quiet = Infinity;
      dprScale = 1;
      resize();
    };
  }
}

boot().catch((error) => {
  console.error('[creek]', error);
  fallBack('error');
});
