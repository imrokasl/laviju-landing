import { h, icon, stickerUrl, prefersReducedMotion } from './dom.js';
import { AREAS, TEXT, WATER_NOTE } from '../data/activities.js';

// The idea card: a side panel on wide screens, a bottom sheet on phones.
// Its frame is built once; opening a place only swaps the words inside.

export function createCard(el, { total, onClose, onStep, onNextIdea }) {
  const blob = h('span', { class: 'card__blob', 'aria-hidden': 'true' });
  const art = h('img', { class: 'card__sticker', alt: '', width: 148, height: 148, decoding: 'async', draggable: 'false' });
  const banner = h('div', { class: 'card__banner' }, blob, art);
  const close = h('button', { class: 'icon-btn card__close', type: 'button', 'aria-label': TEXT.close, title: TEXT.close }, icon('close', 20));

  const placePill = h('span', { class: 'pill card__place' });
  const ideaCount = h('span', { class: 'card__count' });
  const title = h('h2', { class: 'card__title', id: 'card-title', tabindex: '-1' });
  const chips = h('ul', { class: 'chips' });
  const why = h('p', { class: 'card__why' });
  const steps = h('ol', { class: 'steps' });
  const askBubble = h('p', { class: 'ask__bubble' });
  const needs = h('ul', { class: 'needs' });
  const water = h('p', { class: 'card__water' }, icon('drop', 18), h('span', null, WATER_NOTE));

  const body = h(
    'div',
    { class: 'card__body' },
    h('div', { class: 'card__meta' }, placePill, ideaCount),
    title,
    chips,
    why,
    h('h3', { class: 'card__label' }, TEXT.how),
    steps,
    h('div', { class: 'ask' }, h('h3', { class: 'card__label' }, TEXT.ask), askBubble),
    h('h3', { class: 'card__label' }, TEXT.needs),
    needs,
    water
  );

  const pips = h('span', { class: 'card__pips', 'aria-hidden': 'true' });
  const again = h('button', { class: 'btn btn--primary card__again', type: 'button' }, icon('again', 18), h('span', null, TEXT.nextIdea), pips);
  const where = h('span', { class: 'card__where', 'aria-hidden': 'true' });
  const prev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': TEXT.prevPlace, title: TEXT.prevPlace }, icon('left', 20));
  const next = h('button', { class: 'icon-btn', type: 'button', 'aria-label': TEXT.nextPlace, title: TEXT.nextPlace }, icon('right', 20));
  const foot = h('div', { class: 'card__foot' }, again, h('div', { class: 'card__nav' }, prev, where, next));

  const grab = h('span', { class: 'card__grab', 'aria-hidden': 'true' });
  const scroll = h('div', { class: 'card__scroll' }, banner, body);
  const panel = h('div', { class: 'card__panel' }, grab, close, scroll, foot);
  el.append(panel);
  el.setAttribute('aria-labelledby', 'card-title');

  art.addEventListener('load', () => art.classList.remove('is-loading'));
  art.addEventListener('error', () => art.classList.remove('is-loading'));

  let isOpen = false;
  let hideTimer = 0;
  let swapTimer = 0;

  close.addEventListener('click', () => onClose());
  again.addEventListener('click', () => onNextIdea());
  prev.addEventListener('click', () => onStep(-1));
  next.addEventListener('click', () => onStep(1));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'ArrowLeft') onStep(-1);
    else if (e.key === 'ArrowRight') onStep(1);
  });

  // On a phone the sheet can be flicked down to close it.
  {
    let startY = 0;
    let pull = 0;
    let id = null;
    const begin = (e) => {
      if (e.target.closest('button')) return;
      if (!window.matchMedia('(max-width: 760px)').matches) return;
      id = e.pointerId;
      startY = e.clientY;
      pull = 0;
      panel.classList.add('is-pulled');
    };
    const move = (e) => {
      if (e.pointerId !== id) return;
      pull = Math.max(0, e.clientY - startY);
      panel.style.transform = `translate3d(0, ${pull}px, 0)`;
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      panel.classList.remove('is-pulled');
      panel.style.transform = '';
      if (pull > 90) onClose();
    };
    for (const node of [grab, banner]) node.addEventListener('pointerdown', begin);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function fill(place, ideaIndex, placeIndex) {
    const idea = place.ideas[ideaIndex];
    const area = AREAS[idea.area];
    el.dataset.tone = place.tone;
    const src = stickerUrl(idea.sticker || place.sticker);
    if (art.src !== src) {
      art.classList.add('is-loading');
      art.src = src;
    }
    placePill.textContent = place.name;
    ideaCount.textContent = place.ideas.length > 1 ? `Idėja ${TEXT.ideaOf(ideaIndex + 1, place.ideas.length)}` : '';
    title.textContent = idea.title;

    chips.replaceChildren(
      h('li', { class: 'chip' }, icon('child', 16), h('span', null, idea.age)),
      h('li', { class: 'chip' }, icon('clock', 16), h('span', null, TEXT.minutes(idea.minutes))),
      h('li', { class: 'chip chip--area', style: `--ink:${area.ink}` }, h('span', null, area.name))
    );
    why.textContent = idea.why;
    steps.replaceChildren(...idea.steps.map((text, i) => h('li', { class: 'steps__item' }, h('span', { class: 'steps__n', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'steps__text' }, text))));
    askBubble.textContent = `„${idea.ask}“`;
    needs.replaceChildren(...idea.needs.map((text) => h('li', { class: 'needs__item' }, text)));
    water.hidden = !idea.water;

    pips.replaceChildren(...place.ideas.map((_, i) => h('i', { class: i === ideaIndex ? 'is-on' : '' })));
    again.hidden = place.ideas.length < 2;
    again.setAttribute('aria-label', `${TEXT.nextIdea} (${TEXT.ideaOf(((ideaIndex + 1) % place.ideas.length) + 1, place.ideas.length)})`);
    where.textContent = `${placeIndex + 1} / ${total}`;
  }

  // `swap` replays the little entrance when only the idea changes.
  function open(place, ideaIndex, placeIndex, { swap = false, focus = true } = {}) {
    clearTimeout(hideTimer);
    clearTimeout(swapTimer);
    const still = prefersReducedMotion();
    if (isOpen && !still) {
      scroll.classList.add('is-swapping');
      swapTimer = setTimeout(() => {
        fill(place, ideaIndex, placeIndex);
        scroll.scrollTop = 0;
        scroll.classList.remove('is-swapping');
      }, 150);
    } else {
      fill(place, ideaIndex, placeIndex);
      scroll.scrollTop = 0;
    }
    if (!isOpen) {
      isOpen = true;
      el.hidden = false;
      // Next frame, so the entrance transition has a starting point
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-open')));
    }
    if (focus && !swap) title.focus({ preventScroll: true });
  }

  function closeCard() {
    if (!isOpen) return;
    isOpen = false;
    el.classList.remove('is-open');
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      el.hidden = true;
    }, 360);
  }

  return {
    open,
    close: closeCard,
    get isOpen() {
      return isOpen;
    },
    // How much of the frame the card covers, so the scene can move aside
    cover() {
      return { width: panel.offsetWidth, height: panel.offsetHeight };
    },
  };
}
