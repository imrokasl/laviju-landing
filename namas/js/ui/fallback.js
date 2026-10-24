import { h, icon, sticker } from './dom.js';
import { AREAS, SEASONS, SKILLS, TEXT } from '../data/house.js';

// When the picture cannot be drawn the ideas are still worth having: the six
// areas of the house, each spot with its ideas of all year and then those of
// the seasons, the season at hand first.

function ideaCard(idea, season) {
  const skill = SKILLS[idea.area];
  return h(
    'article',
    { class: 'fallback__idea' },
    h('h4', { class: 'card__title' }, idea.title),
    h(
      'ul',
      { class: 'chips' },
      season && h('li', { class: 'chip chip--season', 'data-tone': season.tone }, sticker(season.sticker, 32), h('span', null, TEXT.seasonal(season.of))),
      h('li', { class: 'chip' }, icon('child', 16), h('span', null, idea.age)),
      h('li', { class: 'chip' }, icon('clock', 16), h('span', null, TEXT.minutes(idea.minutes))),
      h('li', { class: 'chip chip--area', style: `--ink:${skill.ink}` }, skill.name)
    ),
    h('p', { class: 'card__why' }, idea.why),
    h(
      'ol',
      { class: 'steps' },
      idea.steps.map((text, i) => h('li', { class: 'steps__item' }, h('span', { class: 'steps__n', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'steps__text' }, text)))
    ),
    h('p', { class: 'ask__bubble' }, `„${idea.ask}“`),
    idea.note && h('p', { class: 'card__note' }, icon('heart', 18), h('span', null, idea.note))
  );
}

function areaSection(area, year) {
  return h(
    'section',
    { class: 'fallback__season', id: `vieta-${area.id}`, 'data-tone': area.tone },
    h('h2', { class: 'fallback__year' }, h('span', { class: 'places__art' }, sticker(area.sticker, 56)), area.name),
    area.spots.map((spot) =>
      h(
        'section',
        { class: 'fallback__place', 'data-tone': area.tone },
        h('h3', { class: 'fallback__head' }, h('span', { class: 'places__art' }, sticker(spot.sticker, 56)), spot.name),
        h(
          'div',
          { class: 'fallback__grid' },
          spot.ideas.map((idea) => ideaCard(idea)),
          year.flatMap((season) => (spot.seasons?.[season.id] || []).map((idea) => ideaCard(idea, season)))
        )
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
    const sections = AREAS.map((area) => areaSection(area, year));
    const jumps = AREAS.map((area, i) =>
      h(
        'button',
        { class: 'fallback__jump', type: 'button', 'data-tone': area.tone, onclick: () => sections[i].scrollIntoView({ block: 'start' }) },
        sticker(area.sticker, 48),
        area.name
      )
    );
    container.append(
      h('span', { class: 'pill pill--sky' }, 'Slaptas kampelis'),
      h('h1', { class: 'fallback__title' }, 'Jaukus ', h('em', { class: 'serif-accent' }, 'namas')),
      h(
        'p',
        { class: 'fallback__lede' },
        'Šis įrenginys trimačio namo neparodys, bet idėjos niekur nedingo. Štai virtuvė, svetainė, abu kambariai, garažas ir kiemas, o juose – ką veikti kartu su vaiku ištisus metus.'
      ),
      h('nav', { class: 'fallback__jumps', 'aria-label': TEXT.spots }, jumps),
      ...sections
    );
  }
  container.hidden = false;
}
