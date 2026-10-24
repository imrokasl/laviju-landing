import * as THREE from './core/three.js';
import { pickQuality, isSoftwareRenderer, lowTier, pixelRatioFor } from './core/quality.js';
import { loadTextures } from './core/assets.js';
import { loadHouse, loadFlora } from './core/models.js';
import { shared, installSoftShadows } from './core/materials.js';
import { createCalendar, season, seasonIndex, SEASON_IDS } from './core/season.js';
import { createRig } from './core/rig.js';
import { palette, col } from './core/palette.js';
import { clamp, ease, lerp } from './core/math.js';
import { AREAS, CAMERA, GARAGE, HOUSE, TREES } from './world/layout.js';
import { createField } from './world/field.js';
import { createTerrain } from './world/terrain.js';
import { createAtmosphere } from './world/atmosphere.js';
import { createKit } from './world/kit.js';
import { createHouse } from './world/house.js';
import { createTrees } from './world/trees.js';
import { createMeadow } from './world/meadow.js';
import { createCritters } from './world/critters.js';
import { createPost } from './fx/post.js';
import { createAmbient } from './fx/ambient.js';
import { createExperience } from './ui/experience.js';
import { renderFallback } from './ui/fallback.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('scene');
const root = document.getElementById('namas');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const params = new URLSearchParams(window.location.search);
const debug = params.has('debug');
// The house opens in summer, unless the address asks for another season. From
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
    // The rainbow belongs to a season whose every spot has been found
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
  // The house and the garden made in Blender are fetched alongside the textures
  const modelArriving = loadHouse();
  const floraArriving = loadFlora();
  const textures = await loadTextures(renderer, (share) => ui.setLoading(0.06 + share * 0.3));
  const model = await modelArriving;
  const flora = await floraArriving;
  shared.uWash.value = textures.wash;
  await nextFrame();

  const field = createField(7);
  await built(0.42);

  const atmosphere = createAtmosphere(textures, quality, { reducedMotion });
  scene.add(atmosphere.group);

  const kit = createKit(textures);
  const house = createHouse(model, textures);
  scene.add(house.group);
  await built(0.5);

  const terrain = createTerrain(field, textures);
  scene.add(terrain.group);
  await built(0.6);

  const trees = createTrees(flora, field, kit, quality);
  scene.add(trees.group);
  await built(0.74);

  const meadow = createMeadow(field, terrain, kit, quality);
  scene.add(meadow.group);
  await built(0.86);

  const critters = createCritters(field, kit, { meadow, trees }, quality);
  scene.add(critters.group);
  await built(0.93);

  // The smoke leaves the chimney a little above its cap
  const chimney = { x: HOUSE.x0 + HOUSE.wall + 0.275, y: HOUSE.ridge + 1.13, z: -3.0 };
  ambient = createAmbient(renderer, { field, quality, textures, crowns: trees.anchors.crowns, chimney, reducedMotion });
  scene.add(ambient.group);

  // Points the overview has to keep in frame: the rim, the roof and its
  // chimney, the balcony's railing, the treetops, the foot of the plot
  const fitPoints = [];
  for (let i = 0; i < terrain.ring.length; i += 8) fitPoints.push(terrain.ring[i]);
  const roofTop = HOUSE.ridge + HOUSE.roof;
  fitPoints.push(
    new THREE.Vector3(HOUSE.x0 - HOUSE.verge, roofTop, HOUSE.ridgeZ),
    new THREE.Vector3(HOUSE.x1 + HOUSE.verge, roofTop, HOUSE.ridgeZ),
    new THREE.Vector3(chimney.x, chimney.y + 0.6, chimney.z),
    new THREE.Vector3(GARAGE.x0, GARAGE.deck + GARAGE.rail, GARAGE.z1),
    new THREE.Vector3(0, -6.5, 0)
  );
  for (const tree of [...TREES.birches, ...TREES.spruces]) fitPoints.push(new THREE.Vector3(tree.x, field.height(tree.x, tree.z) + tree.h, tree.z));

  const rig = createRig(camera, canvas, {
    target: CAMERA.target,
    homes: CAMERA,
    fitPoints,
    reducedMotion,
    onInteract: () => ui.interacted(),
  });
  ui.attach({ rig, camera, house });

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
    audio.season(season.v.birdsong * (1 - 0.6 * season.rain) * (1 - 0.25 * season.windy) * awake);
    audio.rain(season.rain);
    audio.wind(Math.max(season.windy, 0.6 * season.turning));
    if (turning && !season.moving) ui.settled();
    rig.update(dt, time);
    house.update(time, dt, camera);
    atmosphere.update(time);
    trees.update(time);
    meadow.update(time);
    critters.update(time, dt);
    ambient.update(time, dt, post.state.reveal);
    ui.update();
    // While the season turns, and while walls sink or rise, the shadows follow on every frame
    if (season.changed || house.moving || (quality.shadowEvery > 1 && frames++ % quality.shadowEvery === 0)) renderer.shadowMap.needsUpdate = true;
    // Looking into a room the garden is heard as through a window, and in the
    // living room the fire is close by
    const area = AREAS[ui.area];
    const inside = area?.room ? 1 - clamp((rig.zoom - 0.34) / 0.3, 0, 1) : 0;
    audio.indoors(inside);
    audio.fire(house.fire * (ui.area === 'svetaine' ? 0.4 + 0.6 * inside : 0.12 * inside));
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
    window.__house = { THREE, renderer, scene, camera, rig, field, quality, post, shared, textures, house, trees, kit, meadow, terrain, critters, ambient, ui, audio, atmosphere, calendar, season };
    // Runs the world forward by hand, for looking at it where frames are not being painted
    window.__house.advance = (seconds, step = 1 / 30) => {
      for (let t = 0; t < seconds; t += step) tick(step);
    };
    // ...and keeps it at full sharpness there: frames that come now and then
    // look like slow ones to the governor, which would go on to blur the picture
    window.__house.steady = () => {
      governor.quiet = Infinity;
      dprScale = 1;
      resize();
    };
  }
}

boot().catch((error) => {
  console.error('[house]', error);
  fallBack('error');
});
