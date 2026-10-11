import { h, icon, sticker, isCoarsePointer } from './dom.js';
import { TEXT } from '../data/activities.js';

// Everything around the picture that is not a marker or the card: the
// progress pill with its list of places, the two round buttons, the hint,
// the toast and the loader.

const RING = 2 * Math.PI * 9;

export function createChrome(root, places, { onPick, onHome, onSound }) {
  const $ = (id) => root.querySelector(`#${id}`);
  const progress = $('progress');
  const progressText = progress.querySelector('.progress__text');
  const progressArc = progress.querySelector('.progress__arc');
  const list = $('places');
  const hint = $('hint');
  const toast = $('toast');
  const loader = $('loader');
  const loaderBar = loader.querySelector('.loader__bar i');
  const home = $('home');
  const sound = $('sound');

  // ---------- The list of places ----------
  const rows = new Map();
  const items = places.map((place) => {
    const check = h('span', { class: 'places__check', 'aria-hidden': 'true' }, icon('check', 14));
    const button = h(
      'button',
      { class: 'places__row', type: 'button', 'data-tone': place.tone },
      h('span', { class: 'places__art' }, sticker(place.sticker, 56)),
      h('span', { class: 'places__name' }, place.name),
      h('span', { class: 'places__count' }, `${place.ideas.length} idėjos`),
      check
    );
    button.addEventListener('click', () => {
      toggleList(false);
      onPick(place.id, progress);
    });
    rows.set(place.id, button);
    return h('li', null, button);
  });
  list.append(h('p', { class: 'places__title', id: 'places-title' }, TEXT.allPlaces), h('ul', { class: 'places__list' }, items));
  list.setAttribute('aria-labelledby', 'places-title');

  let listOpen = false;
  function toggleList(open = !listOpen) {
    if (open === listOpen) return;
    listOpen = open;
    progress.setAttribute('aria-expanded', String(open));
    list.hidden = !open;
    root.classList.toggle('has-list', open);
    if (open) rows.values().next().value?.focus({ preventScroll: true });
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
    const buttons = [...rows.values()];
    const at = buttons.indexOf(document.activeElement);
    buttons[(at + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus({ preventScroll: true });
  });
  document.addEventListener('pointerdown', (e) => {
    if (listOpen && !list.contains(e.target) && !progress.contains(e.target)) toggleList(false);
  });

  function setProgress(visited) {
    const n = visited.size;
    // The word is dropped on a phone, where the row is short of room
    progressText.replaceChildren(h('span', { class: 'progress__word' }, `${TEXT.foundWord} `), TEXT.count(n, places.length));
    progress.setAttribute('aria-label', `${TEXT.found(n, places.length)}. ${TEXT.allPlaces}`);
    progressArc.style.strokeDashoffset = String(RING * (1 - n / places.length));
    progress.classList.toggle('is-done', n === places.length);
    for (const [id, row] of rows) row.classList.toggle('is-visited', visited.has(id));
  }
  progressArc.style.strokeDasharray = String(RING);
  setProgress(new Set());

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
  function say(message, art) {
    clearTimeout(toastTimer);
    toast.replaceChildren(art ? sticker(art, 44) : '', h('span', null, message));
    toast.classList.add('is-on');
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 6500);
  }

  // ---------- Loader ----------
  function setLoading(share) {
    loaderBar.style.transform = `scaleX(${Math.min(1, Math.max(0.04, share)).toFixed(3)})`;
  }

  return { setProgress, toggleList, hideHint, showHint, say, setLoading };
}
