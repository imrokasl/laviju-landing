import * as THREE from '../core/three.js';
import { PLACES, TEXT } from '../data/activities.js';
import { stickerUrl } from './dom.js';
import { createHotspots } from './hotspots.js';
import { createCard } from './card.js';
import { createChrome } from './chrome.js';

// Ties the picture to the page: which place is open, what has been found,
// where the camera should look and how far the scene must move aside for the
// card. Progress lives in memory only: nothing is stored or sent anywhere.

export function createExperience(root, { onCelebrate = () => {}, onSound = () => {} } = {}) {
  const places = PLACES.map((place) => ({ ...place, anchor: null }));
  const byId = new Map(places.map((place, index) => [place.id, { place, index }]));
  const visited = new Set();
  const ideaAt = new Map();
  const point = new THREE.Vector3();
  const wide = window.matchMedia('(min-width: 761px)');

  let rig = null;
  let camera = null;
  let hotspots = null;
  let current = null;
  let opener = null;
  let celebrated = false;
  let inputsAtAim = 0;
  let started = false;

  const chrome = createChrome(root, places, {
    onPick: (id, from) => openPlace(id, from),
    onHome: () => closePlace({ home: true }),
    onSound,
  });
  const card = createCard(root.querySelector('#card'), {
    total: places.length,
    onClose: () => closePlace(),
    onStep: (dir) => step(dir),
    onNextIdea: () => nextIdea(),
  });

  // Where the picture sits in the frame: clear of the title while the whole
  // island is on show, and out from under the card while one is open.
  function layout(immediate = false) {
    if (!rig) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (!card.isOpen) {
      // A wide frame has room beside the title; a squarer one only below it
      const spare = wide.matches ? THREE.MathUtils.clamp((width / height - 1.3) / 0.45, 0, 1) : 0;
      rig.setShift(-width * 0.06 * spare, -height * (0.03 + 0.05 * (1 - spare)), immediate);
      return;
    }
    const cover = card.cover();
    if (wide.matches) rig.setShift((cover.width + 44) / 2, 0);
    else rig.setShift(0, Math.min(cover.height, height * 0.7) / 2);
  }

  function aim(place) {
    place.focus(point);
    const view = place.view || {};
    rig.focus({ x: point.x, y: Math.max(0.45, point.y - 0.55), z: point.z }, { azimuth: rig.home.azimuth + (view.turn || 0), polar: view.polar, zoom: view.zoom }, 1.5);
    inputsAtAim = rig.inputs;
  }

  function openPlace(id, from) {
    const entry = byId.get(id);
    if (!entry || !rig) return;
    if (from) opener = from;
    const samePlace = current === id;
    current = id;
    visited.add(id);
    hotspots.setVisited(id);
    hotspots.setActive(id);
    chrome.setProgress(visited);
    chrome.hideHint();
    chrome.toggleList(false);
    card.open(entry.place, ideaAt.get(id) ?? 0, entry.index);
    root.dataset.card = 'open';
    if (!samePlace) aim(entry.place);
    layout();
    history.replaceState(null, '', `#${id}`);

    if (visited.size === places.length && !celebrated) {
      celebrated = true;
      setTimeout(() => {
        chrome.say(TEXT.done, 'rainbow');
        onCelebrate();
      }, 1100);
    }
  }

  function closePlace({ home = false } = {}) {
    const wasOpen = card.isOpen;
    card.close();
    current = null;
    hotspots?.setActive(null);
    root.dataset.card = 'closed';
    layout();
    if (wasOpen) history.replaceState(null, '', window.location.pathname + window.location.search);
    // Back to the whole island, unless the visitor has been looking around
    if (home || (wasOpen && rig.inputs === inputsAtAim)) rig?.goHome(1.5);
    if (wasOpen && opener?.isConnected) opener.focus({ preventScroll: true });
    opener = null;
  }

  function step(dir) {
    if (!current) return;
    const { index } = byId.get(current);
    openPlace(places[(index + dir + places.length) % places.length].id);
  }

  function nextIdea() {
    if (!current) return;
    const { place, index } = byId.get(current);
    const at = ((ideaAt.get(current) ?? 0) + 1) % place.ideas.length;
    ideaAt.set(current, at);
    card.open(place, at, index, { swap: true });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card.isOpen) closePlace();
  });
  window.addEventListener('resize', () => layout());
  wide.addEventListener?.('change', () => layout());

  return {
    setLoading: chrome.setLoading,

    // The world is built: pin the markers to it.
    attach(world) {
      rig = world.rig;
      camera = world.camera;
      for (const place of places) {
        place.anchor = world.anchors[place.id];
        // Where the camera looks may differ from where the marker floats
        place.focus = world.focus?.[place.id] || place.anchor;
      }
      hotspots = createHotspots(root.querySelector('#spots'), places, { onOpen: openPlace });
      layout(true);
    },

    // The opening flight is over: bring in the markers and the hint.
    start() {
      if (started) return;
      started = true;
      hotspots.show();
      // Fetch the card art while the visitor is still looking around
      const names = new Set(places.flatMap((place) => place.ideas.map((idea) => idea.sticker || place.sticker)).concat('rainbow'));
      const fetchArt = () => {
        for (const name of names) new Image().src = stickerUrl(name);
      };
      if (window.requestIdleCallback) window.requestIdleCallback(fetchArt);
      else setTimeout(fetchArt, 400);
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (byId.has(id)) openPlace(id);
      else chrome.showHint();
    },

    // The visitor took hold of the picture.
    interacted() {
      if (started) chrome.hideHint();
    },

    update() {
      if (!hotspots) return;
      const width = root.clientWidth;
      const height = root.clientHeight;
      const pxPerMetre = height / (2 * rig.view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      hotspots.update(camera, width, height, pxPerMetre);
    },

    get visited() {
      return visited;
    },
  };
}
