import { h, icon, sticker } from './dom.js';
import { AREAS, PLACES, TEXT } from '../data/activities.js';

// When the picture cannot be drawn the ideas are still worth having: the same
// ten places, laid out as plain cards.

function ideaCard(idea) {
  const area = AREAS[idea.area];
  return h(
    'article',
    { class: 'fallback__idea' },
    h('h3', { class: 'card__title' }, idea.title),
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
    h('p', { class: 'ask__bubble' }, `„${idea.ask}“`)
  );
}

export function renderFallback(container) {
  if (!container.childElementCount) {
    container.append(
      h('span', { class: 'pill pill--sky' }, 'Slaptas kampelis'),
      h('h1', { class: 'fallback__title' }, 'Jaukus ', h('em', { class: 'serif-accent' }, 'upelis')),
      h(
        'p',
        { class: 'fallback__lede' },
        'Šis įrenginys trimačio upelio neparodys, bet idėjos niekur nedingo. Štai dešimt vietų prie vandens ir tai, ką prie jų veikti lauke kartu su vaiku.'
      ),
      ...PLACES.map((place) =>
        h(
          'section',
          { class: 'fallback__place', 'data-tone': place.tone },
          h('h2', { class: 'fallback__head' }, h('span', { class: 'places__art' }, sticker(place.sticker, 56)), place.name),
          h('div', { class: 'fallback__grid' }, place.ideas.map(ideaCard))
        )
      )
    );
  }
  container.hidden = false;
}
