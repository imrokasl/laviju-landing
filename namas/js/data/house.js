// What to do at home. Seven areas of the house and its garden, each with its
// spots, and for every spot a few ideas a parent can try with a child of up
// to six: some all year round, some only in one season. The wording follows
// the rest of Laviju: short, practical, addressed to the grown-up, and every
// idea ends with a question to ask the child. The ideas themselves are in
// js/data/areas/, one file to an area.
import virtuve from './areas/virtuve.js';
import svetaine from './areas/svetaine.js';
import vonia from './areas/vonia.js';
import vaiku from './areas/vaiku.js';
import tevu from './areas/tevu.js';
import garazas from './areas/garazas.js';
import lauke from './areas/lauke.js';

// The five learning areas of the Lithuanian early-years programme, with the
// colours the app gives them (src/theme/tokens.ts).
export const SKILLS = {
  sveikata: { name: 'Sveikata ir gerovė', ink: '#72508D' },
  bendruomene: { name: 'Aš ir bendruomenė', ink: '#8A5A2B' },
  kalba: { name: 'Kalbų pasaulis', ink: '#2F5F9F' },
  aplinka: { name: 'Aplinka', ink: '#2D6F5B' },
  kuryba: { name: 'Kūryba', ink: '#8A3D62' },
};

// The year, spring first. The ids are the ones js/core/season.js walks through;
// `of` is the name as it reads in „… idėja“ and „visos … vietos“, `tone` the
// pastel family the season's switch is painted in. The stickers here are small
// copies: they are only ever shown small, in the switch and the toast. In a
// `cold` season what falls from the sky is snow.
export const SEASONS = [
  { id: 'pavasaris', name: 'Pavasaris', of: 'pavasario', sticker: 'seedling-small', tone: 'sage', hello: 'Pavasaris: obelis žydi, darže dygsta pirmieji daigai.' },
  { id: 'vasara', name: 'Vasara', of: 'vasaros', sticker: 'sun-small', tone: 'butter', hello: 'Vasara: smėlio dėžė, sūpynės ir ilgi vakarai terasoje.' },
  { id: 'ruduo', name: 'Ruduo', of: 'rudens', sticker: 'oak-leaf-small', tone: 'peach', hello: 'Ruduo: obuolių derlius, o židinyje jau traška ugnis.' },
  { id: 'ziema', name: 'Žiema', of: 'žiemos', sticker: 'snowflake-small', tone: 'sky', cold: true, hello: 'Žiema: sniegas ant stogo, eglutė prie židinio.' },
];

// The day, morning first, in the order of its switch. The page opens by day,
// and the hour changes only when the visitor changes it. The ids are the ones
// js/core/season.js walks through, `icon` is one of the line icons in
// js/ui/dom.js, `tone` the pastel the switch is painted in while the hour is
// on, and `hello` what the page says as the hour comes, beside the sticker.
// `in` holds what reads differently in one season only.
export const HOURS = [
  {
    id: 'rytas',
    name: 'Rytas',
    icon: 'dawn',
    tone: 'sky',
    sticker: 'bird',
    hello: 'Saulė teka – kieme jau čiulba paukščiai.',
    in: { ziema: { hello: 'Saulė teka – sniegas ant stogo nusidažo rausvai.' } },
  },
  {
    id: 'diena',
    name: 'Diena',
    icon: 'sun',
    tone: 'butter',
    sticker: 'sun-small',
    hello: 'Saulė vėl aukštai.',
    in: { vasara: { hello: 'Saulė vėl aukštai – baseinėlis kieme jau šiltas.', sticker: 'paddling-pool' } },
  },
  {
    id: 'vakaras',
    name: 'Vakaras',
    icon: 'dusk',
    tone: 'peach',
    sticker: 'lamp',
    hello: 'Saulė leidžiasi – languose įsižiebia šviesos.',
    in: { vasara: { hello: 'Saulė leidžiasi – sode įsižiebia jonvabaliai.', sticker: 'sun-small' } },
  },
  {
    id: 'naktis',
    name: 'Naktis',
    icon: 'moon',
    tone: 'lilac',
    sticker: 'moon-small',
    hello: 'Naktis – namuose ramu, virš stogo žvaigždės.',
    in: { ziema: { hello: 'Naktis – židinyje dar rusena žarijos.', sticker: 'fireplace' } },
  },
];

// The hour the page opens at
export const DAY = HOURS[1];

// How an hour reads in a season
export const hourIn = (hour, season) => ({ ...hour, ...hour.in?.[season?.id] });

// What the visitor can ask the sky for, in the order of its switches: three
// kinds of weather. None of it comes by itself, and each stays until it is
// switched off: with all three off the sky is clear. The ids are the ones
// js/core/season.js knows, `icon` is one of the line icons in js/ui/dom.js,
// `tone` the pastel a switch is painted in while it is on, and `on` and `off`
// are what the page says as each comes and goes, beside the sticker. What the
// first of them brings in a cold season is snow: its `cold` entry stands in
// for it there.
export const WEATHER = [
  {
    id: 'rain',
    name: 'Lietus',
    icon: 'rain',
    tone: 'sky',
    sticker: 'umbrella',
    on: 'Lyja – lietus barbena į stogą.',
    off: 'Lietus liovėsi – kiemas dar šlapias.',
    cold: { name: 'Sniegas', icon: 'flake', sticker: 'snowflake-small', on: 'Sninga – stogas ir kiemas baltuoja.', off: 'Nustojo snigti.' },
  },
  { id: 'mist', name: 'Rūkas', icon: 'mist', tone: 'lilac', sticker: 'cloud', on: 'Virš sodo pakilo rūkas.', off: 'Rūkas išsisklaidė.' },
  { id: 'wind', name: 'Vėjas', icon: 'wind', tone: 'sage', sticker: 'kite', on: 'Pakilo vėjas – skalbiniai plaikstosi ant virvės!', off: 'Vėjas nurimo.' },
];

// How a kind of weather reads in a season
export const weatherIn = (kind, season) => ({ ...kind, ...(season?.cold ? kind.cold : null) });

// The seven areas, in the order of the list. Each file holds an area's name,
// `of` (its name as it reads in „… vietos“), its `tone` (sky, peach, butter,
// sage, lilac, rose, aqua), its marker's sticker, `lede` (what the page says as
// the camera comes in) and its spots. A spot has its year-round `ideas` and
// `seasons`, the ideas only one season brings; `in` holds a name or a sticker
// that is the spot's in one season only (an area's `in`, its marker's). A
// marker keeps its sticker all year but out of doors, where a season changes
// the thing itself: in winter the apple tree stands bare. An idea's `place`
// names the spot on its card when that idea happens somewhere else. Where each
// marker floats and how the camera looks at it is in js/world/layout.js, under
// the same ids.
export const AREAS = [virtuve, svetaine, vonia, vaiku, tevu, garazas, lauke];

// The house as one season has it: every area with its spots, and every spot
// with that season's ideas first, then the ones of all year. A spot's id is
// its area's and its own: „virtuve/virykle“.
export function areasIn(seasonId) {
  const season = SEASONS.find((entry) => entry.id === seasonId);
  return AREAS.map((area) => ({
    id: area.id,
    name: area.name,
    of: area.of,
    tone: area.tone,
    sticker: area.in?.[seasonId]?.sticker ?? area.sticker,
    lede: area.lede,
    season,
    spots: area.spots.map((spot) => {
      const own = spot.in?.[seasonId] || {};
      const extra = (spot.seasons?.[seasonId] || []).map((idea) => ({ ...idea, seasonal: true }));
      return {
        id: `${area.id}/${spot.id}`,
        spot: spot.id,
        area: area.id,
        areaName: area.name,
        tone: area.tone,
        season,
        name: own.name ?? spot.name,
        sticker: own.sticker ?? spot.sticker,
        ideas: [...extra, ...spot.ideas],
      };
    }),
  }));
}

const capital = (word) => word.charAt(0).toUpperCase() + word.slice(1);

// Everything the page says outside the idea cards
export const TEXT = {
  found: (n, total) => `Atrasta ${n} iš ${total}`,
  foundWord: 'Atrasta',
  count: (n, total) => `${n} iš ${total}`,
  allPlaces: (of) => `Visos ${of} vietos`,
  ideas: (n) => `${n} idėjos`,
  spotsOf: (n, total) => `${n} / ${total}`,
  seasons: 'Metų laikas',
  hours: 'Paros metas',
  weather: 'Oras',
  why: 'Kodėl verta',
  how: 'Kaip žaisti',
  ask: 'Paklauskite vaiko',
  needs: 'Ko prireiks',
  nextIdea: 'Kita idėja',
  ideaOf: (i, n) => `${i} iš ${n}`,
  ideaIn: (i, n) => `Idėja ${i} iš ${n}`,
  seasonal: (of) => `${capital(of)} idėja`,
  prevPlace: 'Ankstesnė vieta',
  nextPlace: 'Kita vieta',
  close: 'Uždaryti',
  open: (name) => `${name} – atverti idėjas`,
  enter: (name) => `${name} – užeiti`,
  visited: 'aplankyta',
  minutes: (n) => `${n} min.`,
  hintMouse: 'Tempkite – apsidairysite. Spauskite ženkliuką – užeisite į kambarį.',
  hintTouch: 'Braukite – apsidairysite. Bakstelėkite ženkliuką – užeisite į kambarį.',
  areaDone: (of) => `Visos ${of} vietos atrastos!`,
  done: (of) => `Visos ${of} vietos namuose atrastos! Virš stogo – vaivorykštė.`,
  doneYear: 'Visi metai namuose atrasti – nuo pirmųjų daigų iki sniego!',
  soundOn: 'Įjungti namų garsus',
  soundOff: 'Išjungti namų garsus',
  home: 'Grįžti į pradinį vaizdą',
  back: 'Atgal į visus namus',
  spots: 'Vietos namuose',
};
