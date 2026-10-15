import * as THREE from '../core/three.js';
import { SEASONS, HOURS, DAY, TEXT, hourIn, placesIn } from '../data/activities.js';
import { stickerUrl } from './dom.js';
import { createHotspots } from './hotspots.js';
import { createCard } from './card.js';
import { createChrome } from './chrome.js';

// Ties the picture to the page: which season it is and which hour of the
// day, what weather has been asked for, which place is open, what has been
// found, where the camera should look and how far the scene must move aside
// for the card. Every season keeps its own finds. Progress lives in memory
// only: nothing is stored or sent anywhere.

// From the foot of the open place's marker to the top of its badge, with a
// little air above, in CSS pixels
const MARKER_RISE = 90;
// The air kept between the island and what stands over and under it on a phone
const ROOM_GAP = 8;

export function createExperience(root, { season: opening, onCelebrate = () => {}, onSound = () => {}, onSeason = () => {}, onHour = () => {}, onWeather = () => {} } = {}) {
  // The same ten places four times over, each season with its own names, ideas and finds
  const years = SEASONS.map((season, index) => ({ ...season, index, places: placesIn(season.id), visited: new Set(), ideaAt: new Map(), done: false }));
  let year = years.find((entry) => entry.id === opening) || years[1];
  let hour = DAY;
  const indexOf = new Map(year.places.map((place, index) => [place.id, index]));
  const point = new THREE.Vector3();
  const aimed = new THREE.Vector3();
  const spot = new THREE.Vector3();
  const wide = window.matchMedia('(min-width: 761px)');
  const tools = root.querySelector('.top__tools');
  const hero = root.querySelector('.hero');
  const switches = root.querySelector('.dock__row');
  const picker = root.querySelector('#seasons');
  // Where an element begins, in CSS pixels down the page, wherever it is being moved to meanwhile
  const topOf = (el) => {
    let y = 0;
    for (let at = el; at && at !== root; at = at.offsetParent) y += at.offsetTop;
    return y;
  };

  let rig = null;
  let camera = null;
  let hotspots = null;
  let current = null;
  let opener = null;
  let inputsAtAim = 0;
  let started = false;

  // The hint has done its work once the visitor has begun on anything. On a
  // phone it lies over the foot of the island, and would lie there for as long
  // as only the switches were played with.
  const begun = () => {
    if (started) chrome.hideHint();
  };

  const chrome = createChrome(root, years, {
    onPick: (id, from) => openPlace(id, from),
    onHome: () => closePlace({ home: true }),
    onSound,
    onSeason: (id) => {
      begun();
      setSeason(id);
    },
    onHour: (id) => {
      begun();
      setHour(id);
    },
    // The visitor asked the sky for something, or called it off: the island
    // is told, and the page says what to look for
    onWeather: (kind, on) => {
      begun();
      onWeather(kind.id, on);
      chrome.say(on ? kind.on : kind.off, kind.sticker, 3.6);
    },
  });
  const card = createCard(root.querySelector('#card'), {
    total: year.places.length,
    onClose: () => closePlace(),
    onStep: (dir) => step(dir),
    onNextIdea: () => nextIdea(),
  });
  chrome.setSeason(year, year.visited);
  chrome.setHour(hour);

  // Where the picture sits in the frame: clear of the title while the whole
  // island is on show, and out from under the card while one is open.
  function layout(immediate = false) {
    if (!rig) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    // A phone held upright has the title above the picture and the switches
    // below it: the whole island is fitted into the room between the two
    const upright = !wide.matches && height >= width;
    if (upright) rig.setRoom(topOf(hero) + hero.offsetHeight + ROOM_GAP, topOf(switches) - ROOM_GAP);
    else rig.setRoom();
    if (!card.isOpen) {
      if (upright) {
        rig.setShift(0, rig.lift, immediate);
        return;
      }
      // A wide frame has room beside the title, and the island rises a little
      // to clear the seasons at its foot; a squarer one has room only below the title
      const spare = wide.matches ? THREE.MathUtils.clamp((width / height - 1.3) / 0.45, 0, 1) : 0;
      // ...and where the switches have gone into two rows, it rises by half of the upper one
      const over = switches.offsetHeight - picker.offsetHeight;
      const second = over > picker.offsetHeight / 2 ? over : 0;
      rig.setShift(-width * 0.06 * spare, height * (0.025 * spare - 0.08 * (1 - spare)) + second / 2, immediate);
      return;
    }
    if (wide.matches) rig.setShift((card.cover().width + 44) / 2, 0);
    else rig.setShift(0, height / 2 - strip().line);
  }

  // A phone leaves a strip of the picture above the sheet, and the header
  // takes the top of that. The place sits low in the rest: on the `line`.
  function strip() {
    const height = root.clientHeight;
    const free = height - Math.min(card.cover().height, height * 0.7);
    const head = Math.min(tools.getBoundingClientRect().bottom - root.getBoundingClientRect().top, free * 0.4);
    return { head, line: head + (free - head) * 0.6 };
  }

  // The point to look at for a place: where it is in this season, even if the
  // year is still on its way there.
  function sight(place, out) {
    place.focus(out, year.index);
    out.y = Math.max(0.45, out.y - 0.55);
    if (wide.matches) return out;
    // In that strip a marker floating high above the ground (the nest on its
    // pole) would end up behind the tools: look as high as it takes to keep it below
    const view = place.view || {};
    const { head, line } = strip();
    const perMetre = root.clientHeight / (2 * rig.fit * (view.zoom ?? 0.42) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const room = Math.max(0, line - head - MARKER_RISE) / (perMetre * Math.sin(view.polar ?? 1));
    out.y = Math.max(out.y, place.anchor(spot, year.index).y - room);
    return out;
  }

  function aim(place) {
    const view = place.view || {};
    rig.focus(sight(place, aimed), { azimuth: rig.home.azimuth + (view.turn || 0), polar: view.polar, zoom: view.zoom }, 1.5);
    inputsAtAim = rig.inputs;
  }

  // `again` looks at the place afresh, as when its season has just changed.
  function openPlace(id, from, { again = false } = {}) {
    const index = indexOf.get(id);
    if (index == null || !rig) return;
    const place = year.places[index];
    if (from) opener = from;
    const samePlace = current === id && !again;
    current = id;
    year.visited.add(id);
    hotspots.setVisited(id);
    hotspots.setActive(id);
    chrome.setProgress(year.visited);
    chrome.hideHint();
    chrome.toggleList(false);
    card.open(place, year.ideaAt.get(id) ?? 0, index, { swap: again });
    root.dataset.card = 'open';
    if (!samePlace) aim(place);
    layout();
    history.replaceState(null, '', `#${id}`);

    if (year.visited.size === year.places.length && !year.done) {
      year.done = true;
      const finished = year;
      setTimeout(() => {
        // The island may have moved on to another season in the meantime
        if (year !== finished) return;
        chrome.say(years.every((entry) => entry.done) ? TEXT.doneYear : TEXT.done(finished.of), 'rainbow');
        onCelebrate(true);
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
    const count = year.places.length;
    openPlace(year.places[(indexOf.get(current) + dir + count) % count].id);
  }

  function nextIdea() {
    if (!current) return;
    const index = indexOf.get(current);
    const place = year.places[index];
    const at = ((year.ideaAt.get(current) ?? 0) + 1) % place.ideas.length;
    year.ideaAt.set(current, at);
    card.open(place, at, index, { swap: true });
  }

  // Fetch a season's card art while the visitor is still looking around
  const fetched = new Set();
  function fetchArt(places, more = []) {
    const names = places.flatMap((place) => place.ideas.map((idea) => idea.sticker || place.sticker)).concat(more);
    const fresh = [...new Set(names)].filter((name) => !fetched.has(name));
    if (!fresh.length) return;
    for (const name of fresh) fetched.add(name);
    const fetchAll = () => {
      for (const name of fresh) new Image().src = stickerUrl(name);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(fetchAll);
    else setTimeout(fetchAll, 400);
  }

  // The visitor picked a season: the page changes at once, the island follows.
  function setSeason(id) {
    const next = years.find((entry) => entry.id === id);
    if (!next || next === year) return;
    year = next;
    chrome.setSeason(year, year.visited);
    hotspots?.setPlaces(year.places, year.visited);
    onSeason(year.id);
    // A season found to the end keeps its rainbow; the others have theirs to earn
    onCelebrate(year.done);
    chrome.say(year.hello, year.sticker, 4.2);
    if (started) fetchArt(year.places);
    // An open card stays with its place and turns to what the new season offers there
    if (current) openPlace(current, null, { again: true });
  }

  // The visitor picked an hour: the page says so at once, the light follows.
  function setHour(id) {
    const next = HOURS.find((entry) => entry.id === id);
    if (!next || next === hour) return;
    hour = next;
    chrome.setHour(hour);
    onHour(hour.id);
    const { hello, sticker } = hourIn(hour, year);
    chrome.say(hello, sticker, 3.6);
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && card.isOpen) closePlace();
  });
  wide.addEventListener?.('change', () => layout());
  // The title is set anew once its typeface arrives, and the room under it changes with it
  if (window.ResizeObserver) {
    const watch = new ResizeObserver(() => layout());
    watch.observe(hero);
    watch.observe(switches);
  }

  return {
    setLoading: chrome.setLoading,
    setSeason,
    setHour,

    // The world is built: pin the markers to it.
    attach(world) {
      rig = world.rig;
      camera = world.camera;
      for (const entry of years) {
        for (const place of entry.places) {
          place.anchor = world.anchors[place.id];
          // Where the camera looks may differ from where the marker floats
          place.focus = world.focus?.[place.id] || place.anchor;
        }
      }
      hotspots = createHotspots(root.querySelector('#spots'), year.places, { onOpen: openPlace });
      layout(true);
    },

    // The frame has a new size: the picture is put where it belongs in it.
    resized() {
      layout(true);
    },

    // The opening flight is over: bring in the markers and the hint.
    start() {
      if (started) return;
      started = true;
      hotspots.show();
      fetchArt(year.places, ['rainbow']);
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (indexOf.has(id)) openPlace(id);
      else chrome.showHint();
    },

    // The visitor took hold of the picture.
    interacted() {
      begun();
    },

    // The year has stopped turning. What an open card is about may have moved
    // with it (the stork to its shallows, the boats to their pool), so the
    // camera looks again, unless the visitor has taken the picture in hand.
    settled() {
      if (!current || !rig || rig.inputs !== inputsAtAim) return;
      const place = year.places[indexOf.get(current)];
      if (sight(place, point).distanceTo(aimed) > 0.4) aim(place);
    },

    update() {
      if (!hotspots) return;
      const width = root.clientWidth;
      const height = root.clientHeight;
      const pxPerMetre = height / (2 * rig.view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      hotspots.update(camera, width, height, pxPerMetre);
    },

    get visited() {
      return year.visited;
    },

    get season() {
      return year.id;
    },

    get hour() {
      return hour.id;
    },
  };
}
