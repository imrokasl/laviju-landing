import * as THREE from '../core/three.js';
import { SEASONS, HOURS, DAY, TEXT, hourIn, areasIn } from '../data/house.js';
import { AREAS as PLAN } from '../world/layout.js';
import { stickerUrl } from './dom.js';
import { createHotspots } from './hotspots.js';
import { createCard } from './card.js';
import { createChrome } from './chrome.js';

// Ties the picture to the page: which season it is and which hour of the
// day, what weather has been asked for, which area of the house is looked
// into and which spot's card is open, what has been found, where the camera
// should look and how far the scene must move aside for the card. Every
// season keeps its own finds. Progress lives in memory only: nothing is
// stored or sent anywhere.
//
// It goes two levels deep. The whole house, shut, shows a marker for each of
// its six areas; an area, once entered, has the camera fly in and its room
// alone opened (the garden needs nothing opened), and its spots come out,
// each opening a card of ideas.

// From the foot of the open spot's marker to the top of its badge, with a
// little air above, in CSS pixels
const MARKER_RISE = 90;
// The air kept between the house and what stands over and under it on a phone
const ROOM_GAP = 8;
// A spot is looked at from its area's angle, this much closer
const SPOT_ZOOM = 0.78;

export function createExperience(root, { season: opening, onCelebrate = () => {}, onSound = () => {}, onSeason = () => {}, onHour = () => {}, onWeather = () => {} } = {}) {
  // The same areas and spots four times over, each season with its own ideas and finds
  const years = SEASONS.map((season, index) => ({ ...season, index, areas: areasIn(season.id), visited: new Set(), ideaAt: new Map(), told: new Set(), done: false }));
  let year = years.find((entry) => entry.id === opening) || years[1];
  let hour = DAY;
  // Where every area and every spot stands in a season's lists
  const areaIndex = new Map(year.areas.map((area, i) => [area.id, i]));
  const spotIndex = new Map(year.areas.flatMap((area, i) => area.spots.map((spot, j) => [spot.id, [i, j]])));
  const point = new THREE.Vector3();
  const aimed = new THREE.Vector3();
  const mark = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const wide = window.matchMedia('(min-width: 761px)');
  const tools = root.querySelector('.top__tools');
  const hero = root.querySelector('.hero');
  const roomHead = root.querySelector('#room');
  const switches = root.querySelector('.dock__row');
  const picker = root.querySelector('#seasons');
  const container = root.querySelector('#spots');
  // Where an element begins, in CSS pixels down the page, wherever it is being moved to meanwhile
  const topOf = (el) => {
    let y = 0;
    for (let at = el; at && at !== root; at = at.offsetParent) y += at.offsetTop;
    return y;
  };

  let rig = null;
  let camera = null;
  let house = null;
  let areaMarks = null;
  const spotMarks = new Map();
  // The area looked into, and the spot whose card is open
  let areaId = null;
  let current = null;
  // What was pressed to get there, to give the keyboard back to on the way out
  let areaOpener = null;
  let spotOpener = null;
  let inputsAtAim = 0;
  let started = false;

  // The hint has done its work once the visitor has begun on anything. On a
  // phone it lies over the foot of the house, and would lie there for as long
  // as only the switches were played with.
  const begun = () => {
    if (started) chrome.hideHint();
  };

  const chrome = createChrome(root, years, {
    onPick: (id, from) => openSpot(id, from),
    onArea: (id, from) => enterArea(id, from),
    onHome: () => leaveArea(),
    onSound,
    onSeason: (id) => {
      begun();
      setSeason(id);
    },
    onHour: (id) => {
      begun();
      setHour(id);
    },
    // The visitor asked the sky for something, or called it off: the house
    // is told, and the page says what to look for
    onWeather: (kind, on) => {
      begun();
      onWeather(kind.id, on);
      chrome.say(on ? kind.on : kind.off, kind.sticker, 3.6);
    },
  });
  const card = createCard(root.querySelector('#card'), {
    onClose: () => closeSpot(),
    onStep: (dir) => step(dir),
    onNextIdea: () => nextIdea(),
  });
  chrome.setSeason(year, year.visited);
  chrome.setHour(hour);

  const areaOf = (id) => year.areas[areaIndex.get(id)];
  const spotOf = (id) => {
    const at = spotIndex.get(id);
    return at && year.areas[at[0]].spots[at[1]];
  };

  // Where the picture sits in the frame: clear of the title while the whole
  // house is on show, and out from under the card while one is open.
  function layout(immediate = false) {
    if (!rig) return;
    const width = root.clientWidth;
    const height = root.clientHeight;
    // A phone held upright has the title above the picture and the switches
    // below it: the whole house is fitted into the room between the two
    const upright = !wide.matches && height >= width;
    if (upright) rig.setRoom(topOf(hero) + hero.offsetHeight + ROOM_GAP, topOf(switches) - ROOM_GAP);
    else rig.setRoom();
    if (!card.isOpen) {
      if (upright && areaId && !roomHead.hidden) {
        // In an area its name stands where the title was: the room is shown
        // in the middle of what is left between that name and the switches
        const middle = (topOf(roomHead) + roomHead.offsetHeight + topOf(switches)) / 2;
        rig.setShift(0, height / 2 - middle, immediate);
        return;
      }
      if (upright) {
        rig.setShift(0, rig.lift, immediate);
        return;
      }
      // A wide frame has room beside the title, and the house rises a little
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
  // takes the top of that. The spot sits low in the rest: on the `line`.
  function strip() {
    const height = root.clientHeight;
    const free = height - Math.min(card.cover().height, height * 0.7);
    const head = Math.min(tools.getBoundingClientRect().bottom - root.getBoundingClientRect().top, free * 0.4);
    return { head, line: head + (free - head) * 0.6 };
  }

  // The point to look at for a spot: a little under its marker
  function sight(spot, view, out) {
    spot.anchor(out);
    out.y = Math.max(0.45, out.y - 0.55);
    if (wide.matches) return out;
    // In that strip a marker floating high above the floor would end up
    // behind the tools: look as high as it takes to keep it below
    const { head, line } = strip();
    const zoom = view.zoom * SPOT_ZOOM;
    const perMetre = root.clientHeight / (2 * rig.fit * zoom * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const room = Math.max(0, line - head - MARKER_RISE) / (perMetre * Math.sin(view.polar));
    out.y = Math.max(out.y, spot.anchor(mark).y - room);
    return out;
  }

  // A phone held upright shows an area in the band between its name and the
  // switches. The camera stands back from the area's own view as far as it
  // takes for all of its markers, badges and all, to fit in that band, and
  // looks at their middle. Returns the zoom; `aimed` is moved in place.
  function frameBand(area, view) {
    const width = root.clientWidth;
    const height = root.clientHeight;
    if (wide.matches || height < width || roomHead.hidden) return view.zoom;
    const band = topOf(switches) - topOf(roomHead) - roomHead.offsetHeight - 2 * ROOM_GAP;
    const az = azimuthOf(area.id);
    forward.set(-Math.sin(view.polar) * Math.sin(az), -Math.cos(view.polar), -Math.sin(view.polar) * Math.cos(az));
    right.set(Math.cos(az), 0, -Math.sin(az));
    up.crossVectors(right, forward);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    let zoom = view.zoom;
    for (let pass = 0; pass < 6; pass++) {
      const dist = rig.fit * zoom;
      // The markers' own scale at that distance (see hotspots.js), and how
      // far their badges reach up and out from the points they mark
      const scale = THREE.MathUtils.clamp(height / (2 * dist * tanV) / 60, 0.7, 1);
      const rise = MARKER_RISE * scale;
      const reach = 32 * scale;
      let top = Infinity;
      let bottom = -Infinity;
      let left = Infinity;
      let rightmost = -Infinity;
      for (const spot of area.spots) {
        spot.anchor(mark).sub(aimed);
        const depth = (dist + mark.dot(forward)) * tanV;
        const x = ((mark.dot(right) / depth) * height) / 2;
        const y = ((-mark.dot(up) / depth) * height) / 2;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        rightmost = Math.max(rightmost, x);
      }
      // Look at the middle of the markers as they stand
      const metre = (2 * dist * tanV) / height;
      aimed.addScaledVector(up, ((top - rise + bottom) / 2) * -metre).addScaledVector(right, ((left + rightmost) / 2) * metre);
      const worst = Math.max((bottom - top) / Math.max(1, band - rise), (rightmost - left) / Math.max(1, width - 2 * (ROOM_GAP + reach)));
      if (worst <= 1.01) break;
      zoom = Math.min(view.zoom * 1.8, zoom * worst);
    }
    return zoom;
  }

  // Which way the camera faces an area, or a spot in it: the area's own
  // azimuth where it has one, else its turn from the home view, unless the
  // spot has a turn of its own (see world/layout.js)
  function azimuthOf(id, spot) {
    const plan = PLAN[id];
    const turn = spot ? plan.turns?.[spot] : undefined;
    if (turn !== undefined) return rig.home.azimuth + turn;
    return plan.view.azimuth ?? rig.home.azimuth + plan.view.turn;
  }

  function aimArea(area) {
    const { view } = PLAN[area.id];
    aimed.set(...view.target);
    const zoom = frameBand(area, view);
    rig.focus(aimed, { azimuth: azimuthOf(area.id), polar: view.polar, zoom }, 1.6);
    inputsAtAim = rig.inputs;
  }

  function aimSpot(spot) {
    const { view } = PLAN[spot.area];
    rig.focus(sight(spot, view, aimed), { azimuth: azimuthOf(spot.area, spot.spot), polar: view.polar, zoom: view.zoom * SPOT_ZOOM }, 1.4);
    inputsAtAim = rig.inputs;
  }

  // How many of each area's spots have been found this season, on its marker
  function count() {
    for (const area of year.areas) areaMarks.setCount(area.id, area.spots.filter((spot) => year.visited.has(spot.id)).length, area.spots.length);
  }

  // The visitor stepped into an area: the camera flies to it, its room opens
  // (see world/house.js), and its spots come out in place of the six areas.
  function enterArea(id, from, { aim = true } = {}) {
    const area = areaOf(id);
    if (!area || !rig) return;
    if (card.isOpen) closeSpot({ fly: false });
    if (from) areaOpener = from;
    areaId = id;
    house.view(PLAN[id].room);
    areaMarks.setShown(false);
    for (const [key, marks] of spotMarks) marks.setShown(key === id);
    chrome.setArea(area);
    chrome.hideHint();
    chrome.toggleList(false);
    if (aim) aimArea(area);
    layout();
    history.replaceState(null, '', `#${id}`);
  }

  // Back to the whole house, shut again, and its areas' markers out
  function leaveArea() {
    closeSpot({ fly: false });
    if (!rig) return;
    const was = areaId;
    areaId = null;
    house.view(null);
    for (const marks of spotMarks.values()) marks.setShown(false);
    areaMarks.setShown(true);
    chrome.setArea(null);
    rig.goHome(1.5);
    layout();
    history.replaceState(null, '', window.location.pathname + window.location.search);
    if (was && areaOpener?.isConnected) areaOpener.focus({ preventScroll: true });
    else if (was) areaMarks.button(was)?.focus({ preventScroll: true });
    areaOpener = null;
  }

  // `again` looks at the spot afresh, as when its season has just changed.
  function openSpot(id, from, { again = false } = {}) {
    const spot = spotOf(id);
    if (!spot || !rig) return;
    const area = areaOf(spot.area);
    if (areaId !== area.id) enterArea(area.id, from, { aim: false });
    if (from) spotOpener = from;
    const sameSpot = current === id && !again;
    current = id;
    year.visited.add(id);
    const marks = spotMarks.get(area.id);
    marks.setVisited(id);
    marks.setActive(id);
    count();
    chrome.setProgress(year.visited);
    chrome.hideHint();
    chrome.toggleList(false);
    card.open(spot, year.ideaAt.get(id) ?? 0, area.spots.indexOf(spot), { total: area.spots.length, swap: again });
    root.dataset.card = 'open';
    if (!sameSpot) aimSpot(spot);
    layout();
    history.replaceState(null, '', `#${id}`);

    const finished = year;
    if (year.visited.size === spotIndex.size && !year.done) {
      year.done = true;
      setTimeout(() => {
        // The house may have moved on to another season in the meantime
        if (year !== finished) return;
        chrome.say(years.every((entry) => entry.done) ? TEXT.doneYear : TEXT.done(finished.of), 'rainbow');
        onCelebrate(true);
      }, 1100);
    } else if (area.spots.every((each) => year.visited.has(each.id)) && !year.told.has(area.id)) {
      // Every spot of one area found is worth a word too
      year.told.add(area.id);
      setTimeout(() => {
        if (year === finished) chrome.say(TEXT.areaDone(area.of), area.sticker, 4);
      }, 900);
    }
  }

  function closeSpot({ fly = true } = {}) {
    const wasOpen = card.isOpen;
    card.close();
    current = null;
    if (areaId) spotMarks.get(areaId)?.setActive(null);
    root.dataset.card = 'closed';
    layout();
    if (!wasOpen) return;
    history.replaceState(null, '', areaId ? `#${areaId}` : window.location.pathname + window.location.search);
    // Back to the whole room, unless the visitor has been looking around
    if (fly && areaId && rig.inputs === inputsAtAim) aimArea(areaOf(areaId));
    if (spotOpener?.isConnected) spotOpener.focus({ preventScroll: true });
    spotOpener = null;
  }

  // The card's arrows walk through the spots of the area
  function step(dir) {
    if (!current) return;
    const spots = areaOf(areaId).spots;
    const at = spots.findIndex((spot) => spot.id === current);
    openSpot(spots[(at + dir + spots.length) % spots.length].id);
  }

  function nextIdea() {
    if (!current) return;
    const spot = spotOf(current);
    const spots = areaOf(spot.area).spots;
    const at = ((year.ideaAt.get(current) ?? 0) + 1) % spot.ideas.length;
    year.ideaAt.set(current, at);
    card.open(spot, at, spots.indexOf(spot), { total: spots.length, swap: true });
  }

  // Fetch a season's card art while the visitor is still looking around
  const fetched = new Set();
  function fetchArt(areas, more = []) {
    const names = areas.flatMap((area) => [area.sticker, ...area.spots.flatMap((spot) => [spot.sticker, ...spot.ideas.map((idea) => idea.sticker)])]).concat(more);
    const fresh = [...new Set(names)].filter((name) => !fetched.has(name));
    if (!fresh.length) return;
    for (const name of fresh) fetched.add(name);
    const fetchAll = () => {
      for (const name of fresh) new Image().src = stickerUrl(name);
    };
    if (window.requestIdleCallback) window.requestIdleCallback(fetchAll);
    else setTimeout(fetchAll, 400);
  }

  // The visitor picked a season: the page changes at once, the house follows.
  function setSeason(id) {
    const next = years.find((entry) => entry.id === id);
    if (!next || next === year) return;
    year = next;
    chrome.setSeason(year, year.visited);
    areaMarks?.setPlaces(year.areas, year.visited);
    for (const area of year.areas) spotMarks.get(area.id)?.setPlaces(area.spots, year.visited);
    if (areaMarks) count();
    if (areaId) chrome.setArea(areaOf(areaId));
    onSeason(year.id);
    // A season found to the end keeps its rainbow; the others have theirs to earn
    onCelebrate(year.done);
    chrome.say(year.hello, year.sticker, 4.2);
    if (started) fetchArt(year.areas);
    // An open card stays with its spot and turns to what the new season offers there
    if (current) openSpot(current, null, { again: true });
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

  // The address names an area („#virtuve“) or a spot in one („#virtuve/virykle“)
  function follow(hash) {
    const id = decodeURIComponent(hash.replace(/^#/, ''));
    if (spotIndex.has(id)) openSpot(id);
    else if (areaIndex.has(id)) enterArea(id);
    else return false;
    return true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (card.isOpen) closeSpot();
    else if (areaId) leaveArea();
  });
  wide.addEventListener?.('change', () => layout());
  // The title is set anew once its typeface arrives, and the room under it changes with it
  if (window.ResizeObserver) {
    const watch = new ResizeObserver(() => layout());
    watch.observe(hero);
    watch.observe(roomHead);
    watch.observe(switches);
  }

  return {
    setLoading: chrome.setLoading,
    setSeason,
    setHour,

    // The world is built: pin the markers to it.
    attach(world) {
      ({ rig, camera, house } = world);
      // Every season's areas and spots float where the layout has them
      const at = (p) => {
        const v = new THREE.Vector3(...p);
        return (out) => out.copy(v);
      };
      for (const entry of years) {
        for (const area of entry.areas) {
          area.anchor = at(PLAN[area.id].marker);
          for (const spot of area.spots) spot.anchor = at(PLAN[area.id].spots[spot.spot]);
        }
      }
      areaMarks = createHotspots(container, year.areas, { onOpen: enterArea, label: TEXT.spots, kind: 'area' });
      for (const area of year.areas) spotMarks.set(area.id, createHotspots(container, area.spots, { onOpen: openSpot, label: area.name }));
      for (const area of year.areas) spotMarks.get(area.id).setPlaces(area.spots, year.visited);
      count();
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
      container.classList.add('is-ready');
      areaMarks.setShown(true);
      fetchArt(year.areas, ['rainbow']);
      if (!follow(window.location.hash)) chrome.showHint();
    },

    // The visitor took hold of the picture.
    interacted() {
      begun();
    },

    // The year has stopped turning. The spots stay where they are, so the
    // camera has nothing to look at again.
    settled() {},

    update() {
      if (!areaMarks) return;
      const width = root.clientWidth;
      const height = root.clientHeight;
      const pxPerMetre = height / (2 * rig.view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
      areaMarks.update(camera, width, height, pxPerMetre);
      if (areaId) spotMarks.get(areaId).update(camera, width, height, pxPerMetre);
    },

    // The area looked into, or null for the whole house
    get area() {
      return areaId;
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
