import { h, icon, sticker } from './dom.js';
import { AREAS, ICE_NOTE, SEASONS, TEXT, WATER_NOTE, placesIn } from '../data/activities.js';

// When the picture cannot be drawn the ideas are still worth having: the same
// ten places in each of the four seasons, laid out as plain cards.

function ideaCard(idea) {
  const area = AREAS[idea.area];
  return h(
    'article',
    { class: 'fallback__idea' },
    h('h4', { class: 'card__title' }, idea.title),
    h(
      'ul',
      { class: 'chips' },
      h('li', { class: 'chip' }, icon('child', 16), h('span', null, idea.age)),
      h('li', { class: 'chip' }, icon('clock', 16), h('span', null, TEXT.minutes(idea.minutes))),
      h('li', { class: 'chip chip--area', style: `--ink:${area.ink}` }, area.name)
    ),
    h('p', { class: 'card__why' }, idea.why),
    h(
      'ol',
      { class: 'steps' },
      idea.steps.map((text, i) => h('li', { class: 'steps__item' }, h('span', { class: 'steps__n', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'steps__text' }, text)))
    ),
    h('p', { class: 'ask__bubble' }, `„${idea.ask}“`),
    idea.water && h('p', { class: 'card__water' }, icon('drop', 18), h('span', null, WATER_NOTE)),
    idea.ice && h('p', { class: 'card__water' }, icon('flake', 18), h('span', null, ICE_NOTE))
  );
}

function seasonSection(season) {
  return h(
    'section',
    { class: 'fallback__season', id: `metai-${season.id}`, 'data-tone': season.tone },
    h('h2', { class: 'fallback__year' }, h('span', { class: 'places__art' }, sticker(season.sticker, 56)), season.name),
    placesIn(season.id).map((place) =>
      h(
        'section',
        { class: 'fallback__place', 'data-tone': place.tone },
        h('h3', { class: 'fallback__head' }, h('span', { class: 'places__art' }, sticker(place.sticker, 56)), place.name),
        h('div', { class: 'fallback__grid' }, place.ideas.map(ideaCard))
      )
    )
  );
}

// `opening` is the season to begin with: the one it is outside.
export function renderFallback(container, opening) {
  if (!container.childElementCount) {
    // The year starts from the season at hand and runs round from there
    const first = Math.max(0, SEASONS.findIndex((season) => season.id === opening));
    const year = SEASONS.map((_, i) => SEASONS[(first + i) % SEASONS.length]);
    const sections = year.map(seasonSection);
    const jumps = year.map((season, i) =>
      h(
        'button',
        { class: 'fallback__jump', type: 'button', 'data-tone': season.tone, onclick: () => sections[i].scrollIntoView({ block: 'start' }) },
        sticker(season.sticker, 48),
        season.name
      )
    );
    container.append(
      h('span', { class: 'pill pill--sky' }, 'Slaptas kampelis'),
      h('h1', { class: 'fallback__title' }, 'Jaukus ', h('em', { class: 'serif-accent' }, 'upelis')),
      h(
        'p',
        { class: 'fallback__lede' },
        'Šis įrenginys trimačio upelio neparodys, bet idėjos niekur nedingo. Štai dešimt vietų prie vandens ir tai, ką prie jų veikti lauke kartu su vaiku – pavasarį, vasarą, rudenį ir žiemą.'
      ),
      h('nav', { class: 'fallback__jumps', 'aria-label': TEXT.seasons }, jumps),
      ...sections
    );
  }
  container.hidden = false;
}
