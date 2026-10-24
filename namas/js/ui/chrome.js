import { h, icon, sticker, stickerUrl, isCoarsePointer } from './dom.js';
import { TEXT, HOURS, WEATHER, weatherIn } from '../data/house.js';

// Everything around the picture that is not a marker or the card: the
// progress pill with its list of areas and spots, the two round buttons, the
// heading of the room looked into with its way back, the switch between the
// seasons, the one between the hours of the day, the switches of the
// weather, the hint, the toast and the loader.

const RING = 2 * Math.PI * 9;

export function createChrome(root, seasons, { onPick, onArea, onHome, onSound, onSeason, onHour, onWeather }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const progress = $('progress');
  const progressText = progress.querySelector('.progress__text');
  const progressArc = progress.querySelector('.progress__arc');
  const list = $('places');
  const picker = $('seasons');
  const day = $('hours');
  const sky = $('weather');
  const hint = $('hint');
  const toast = $('toast');
  const loader = $('loader');
  const loaderBar = loader.querySelector('.loader__bar i');
  const home = $('home');
  const sound = $('sound');
  const room = $('room');
  const roomTitle = room.querySelector('.room__title');
  const roomLede = room.querySelector('.room__lede');
  const back = $('back');

  // ---------- The list of areas and spots ----------
  // Written out again for every season: the names and the finds are its own
  const rows = new Map();
  const heads = new Map();
  const listTitle = h('p', { class: 'places__title', id: 'places-title' });
  const listRows = h('ul', { class: 'places__list' });
  list.append(listTitle, listRows);
  list.setAttribute('aria-labelledby', 'places-title');
  let areas = [];
  let total = 0;

  function setPlaces(next, season, visited) {
    areas = next;
    total = areas.reduce((n, area) => n + area.spots.length, 0);
    rows.clear();
    heads.clear();
    listTitle.textContent = TEXT.allPlaces(season.of);
    const row = (place, { head = false } = {}) => {
      const button = h(
        'button',
        { class: `places__row${head ? ' places__row--area' : ''}`, type: 'button', 'data-tone': place.tone },
        h('span', { class: 'places__art' }, sticker(place.sticker, 56)),
        h('span', { class: 'places__name' }, place.name),
        h('span', { class: 'places__count' }, head ? '' : TEXT.ideas(place.ideas.length)),
        h('span', { class: 'places__check', 'aria-hidden': 'true' }, icon('check', 14))
      );
      button.addEventListener('click', () => {
        toggleList(false);
        if (head) onArea(place.id, progress);
        else onPick(place.id, progress);
      });
      return button;
    };
    listRows.replaceChildren(
      ...areas.map((area) => {
        const head = row(area, { head: true });
        heads.set(area.id, head);
        const spots = area.spots.map((spot) => {
          const button = row(spot);
          rows.set(spot.id, button);
          return h('li', null, button);
        });
        return h('li', { class: 'places__group' }, head, h('ul', { class: 'places__spots' }, spots));
      })
    );
    setProgress(visited);
  }

  let listOpen = false;
  function toggleList(open = !listOpen) {
    if (open === listOpen) return;
    listOpen = open;
    progress.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    root.classList.toggle('has-list', open);
    if (open) heads.values().next().value?.focus({ preventScroll: true });
  }
  progress.addEventListener('click', () => toggleList());
  list.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      toggleList(false);
      progress.focus({ preventScroll: true });
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const buttons = [...list.querySelectorAll('.places__row')];
    const at = buttons.indexOf(document.activeElement);
    buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (e) => {
    if (listOpen && !list.contains(e.target) && !progress.contains(e.target)) toggleList(false);
  });

  function setProgress(visited) {
    const n = visited.size;
    // The word is dropped on a phone, where the row is short of room
    progressText.replaceChildren(h('span', { class: 'progress__word' }, `${TEXT.foundWord} `), TEXT.count(n, total));
    progress.setAttribute('aria-label', `${TEXT.found(n, total)}. ${listTitle.textContent}`);
    progressArc.style.strokeDashoffset = String(RING * (1 - n / Math.max(1, total)));
    progress.classList.toggle('is-done', n === total);
    for (const [id, button] of rows) button.classList.toggle('is-visited', visited.has(id));
    for (const area of areas) {
      const found = area.spots.filter((spot) => visited.has(spot.id)).length;
      const head = heads.get(area.id);
      head.querySelector('.places__count').textContent = TEXT.count(found, area.spots.length);
      head.classList.toggle('is-visited', found === area.spots.length);
    }
  }
  progressArc.style.strokeDasharray = String(RING);

  // ---------- The room looked into ----------
  // Its name and a word about it stand where the title stood, with the way
  // back to the whole house above them
  back.append(icon('left', 18), h('span', null, TEXT.back));
  back.addEventListener('click', () => onHome());
  let roomTimer = 0;
  function setArea(area) {
    clearTimeout(roomTimer);
    if (area) {
      roomTitle.textContent = area.name;
      roomLede.textContent = area.lede;
      room.dataset.tone = area.tone;
      // Laid out hidden first, so the entrance has a starting point
      if (room.hidden) {
        room.hidden = false;
        void room.offsetWidth;
      }
      root.dataset.area = area.id;
    } else {
      delete root.dataset.area;
      roomTimer = setTimeout(() => (room.hidden = true), 400);
    }
  }

  // ---------- The seasons and the hours ----------
  // Each is four radio buttons in a row: the arrow keys walk the year or the
  // day, as they would any group of radios, and a patch of the colour of the
  // one that is on slides under it. `art` draws what stands before a name;
  // a row that may have to go by its pictures alone gives each button its
  // name to keep (`named`), for a screen reader and as a tooltip.
  function radios(group, block, label, entries, art, onChoose, { named = false } = {}) {
    group.setAttribute('aria-label', label);
    let at = 0;
    const options = entries.map((entry) => {
      const button = h(
        'button',
        { class: `${block}__opt`, type: 'button', role: 'radio', 'aria-checked': 'false', tabindex: '-1', 'aria-label': named && entry.name, title: named && entry.name },
        art(entry),
        h('span', { class: `${block}__name` }, entry.name)
      );
      button.addEventListener('click', () => onChoose(entry.id));
      return button;
    });
    group.append(h('span', { class: `${block}__thumb`, 'aria-hidden': 'true' }), ...options);
    group.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const next = (at + step + entries.length) % entries.length;
      options[next].focus({ preventScroll: true });
      onChoose(entries[next].id);
    });
    // Marks `entry` as the one that is on, and says where in the row it stands
    return (entry) => {
      at = entries.indexOf(entry);
      options.forEach((button, index) => {
        const on = index === at;
        button.setAttribute('aria-checked', String(on));
        button.tabIndex = on ? 0 : -1;
      });
      group.style.setProperty('--at', String(at));
      group.dataset.tone = entry.tone;
      return at;
    };
  }

  let seasonAt = 0;
  const checkSeason = radios(picker, 'seasons', TEXT.seasons, seasons, (season) => sticker(season.sticker, 48), (id) => onSeason(id));
  // The other seasons' marker and card art is fetched when the visitor reaches for the switch
  const fetchMarkers = () => {
    const names = new Set(seasons.flatMap((season) => season.areas.flatMap((area) => area.spots.flatMap((spot) => [spot.sticker, spot.ideas[0].sticker]))));
    for (const name of names) new Image().src = stickerUrl(name);
  };
  for (const type of ['pointerenter', 'focusin']) picker.addEventListener(type, fetchMarkers, { once: true });

  // The hours go by line icons, as the weather does: both are asked of the sky
  const checkHour = radios(day, 'hours', TEXT.hours, HOURS, (hour) => icon(hour.icon, 20), (id) => onHour(id), { named: true });
  function setHour(hour) {
    checkHour(hour);
    root.dataset.hour = hour.id;
  }

  // ---------- The weather ----------
  // A switch for each kind, on until it is switched off again: the sky does
  // nothing by itself, and is clear while all of them are off. What each is
  // called and drawn as follows the season, since the same switch that brings
  // rain brings snow in winter.
  sky.setAttribute('aria-label', TEXT.weather);
  const isOn = (button) => button.getAttribute('aria-pressed') === 'true';
  const switches = WEATHER.map((kind) => {
    const button = h('button', { class: 'weather__opt', type: 'button', 'aria-pressed': 'false', 'data-tone': kind.tone });
    button.addEventListener('click', () => {
      const on = !isOn(button);
      button.setAttribute('aria-pressed', String(on));
      onWeather(weatherIn(kind, seasons[seasonAt]), on);
    });
    return button;
  });
  sky.append(...switches);
  function paintWeather(season) {
    WEATHER.forEach((kind, index) => {
      const { name, icon: art } = weatherIn(kind, season);
      const button = switches[index];
      if (button.dataset.art === art) return;
      button.dataset.art = art;
      button.replaceChildren(icon(art, 20), h('span', { class: 'weather__name' }, name));
      button.setAttribute('aria-label', name);
      button.title = name;
    });
  }
  // What the page says as each comes and goes is fetched when the visitor reaches for a switch
  const fetchSkyArt = () => {
    const names = [...HOURS, ...WEATHER].flatMap((entry) => [entry.sticker, entry.cold?.sticker, ...Object.values(entry.in || {}).map((own) => own.sticker)]);
    for (const name of new Set(names)) if (name) new Image().src = stickerUrl(name);
  };
  for (const type of ['pointerenter', 'focusin']) day.parentElement.addEventListener(type, fetchSkyArt, { once: true });

  function setSeason(season, visited) {
    seasonAt = checkSeason(season);
    root.dataset.season = season.id;
    paintWeather(season);
    setPlaces(season.areas, season, visited);
  }

  // ---------- Buttons ----------
  home.addEventListener('click', () => onHome());
  home.replaceChildren(icon('home', 20));
  home.setAttribute('aria-label', TEXT.home);
  home.title = TEXT.home;
  let soundOn = false;
  const paintSound = () => {
    sound.replaceChildren(icon(soundOn ? 'sound' : 'mute', 20));
    sound.setAttribute('aria-pressed', String(soundOn));
    sound.setAttribute('aria-label', soundOn ? TEXT.soundOff : TEXT.soundOn);
    sound.title = soundOn ? TEXT.soundOff : TEXT.soundOn;
  };
  sound.addEventListener('click', () => {
    soundOn = !soundOn;
    paintSound();
    onSound(soundOn);
  });
  paintSound();

  // ---------- Hint and toast ----------
  hint.querySelector('.hint__text').textContent = isCoarsePointer() ? TEXT.hintTouch : TEXT.hintMouse;
  let hintGone = false;
  function hideHint() {
    if (hintGone) return;
    hintGone = true;
    hint.classList.remove('is-on');
  }
  function showHint() {
    if (!hintGone) hint.classList.add('is-on');
  }

  let toastTimer = 0;
  function say(message, art, seconds = 6.5) {
    clearTimeout(toastTimer);
    toast.replaceChildren(art ? sticker(art, 44) : '', h('span', null, message));
    toast.classList.add('is-on');
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), seconds * 1000);
  }

  // ---------- Loader ----------
  function setLoading(share) {
    loaderBar.style.transform = `scaleX(${Math.min(1, Math.max(0.04, share)).toFixed(3)})`;
  }

  return { setSeason, setHour, setProgress, setArea, toggleList, hideHint, showHint, say, setLoading };
}
