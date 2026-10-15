import * as THREE from './three.js';
import { shared, CLOCKS } from './materials.js';
import { clamp } from './math.js';

// The year at the creek. One number, `p`, says where in the year the island
// is: 0 spring, 1 summer, 2 autumn, 3 winter, and round again. Everything that
// changes with the seasons reads its value from a track laid along that year,
// so walking `p` from one season to the next plays the whole change in order:
// leaves turn before they fall, snow settles after the first flakes, ice
// follows the snow.
//
// A change does not happen everywhere at once: it comes over the island with
// the wind. A row of clocks walks the same stretch of the year, the one on
// the side the wind comes from setting out first and the one on the far side
// last; `p` is the clock in the middle. Whatever is drawn reads the year
// between the two clocks it stands between, so every spot goes through the
// whole change in order, only at its own time.
//
// The day goes round the same way. A second number, `hour`, says where in it
// the island is: 0 morning, 1 day, 2 evening, 3 night, and round again. The
// tracks along the year are the island by day; each of the other hours lays
// its own light over them, and walking `hour` from one to the next plays what
// lies between: the sun crosses the sky from the morning's side to the
// evening's, sets before the moon comes up, and rises once the moon has paled.
//
// Neither the year nor the day moves by itself, and nor does the weather. The
// island stays in the season and at the hour it was last sent to, and the sky
// stays clear until the visitor asks for rain, mist or wind, and is clear
// again when they call it off.

export const SEASON_IDS = ['pavasaris', 'vasara', 'ruduo', 'ziema'];
const ALIASES = { spring: 0, summer: 1, autumn: 2, fall: 2, winter: 3, ruduo: 2, ziema: 3, žiema: 3, pavasaris: 0, vasara: 1 };

const YEAR = SEASON_IDS.length;

// The hours of the day, morning first. The island opens by day.
export const HOUR_IDS = ['rytas', 'diena', 'vakaras', 'naktis'];
const HOUR_ALIASES = { morning: 0, dawn: 0, day: 1, evening: 2, dusk: 2, night: 3, rytas: 0, diena: 1, vakaras: 2, naktis: 3 };

const HOURS = HOUR_IDS.length;
const DAY = 1;

// What the sky can be asked for: three kinds of weather. Rain falls as snow
// while it is cold.
export const WEATHER_IDS = ['rain', 'mist', 'wind'];

export function seasonIndex(name) {
  if (typeof name === 'number') return ((Math.round(name) % YEAR) + YEAR) % YEAR;
  const key = String(name || '').toLowerCase();
  return key in ALIASES ? ALIASES[key] : -1;
}

export function hourIndex(name) {
  if (typeof name === 'number') return ((Math.round(name) % HOURS) + HOURS) % HOURS;
  const key = String(name || '').toLowerCase();
  return key in HOUR_ALIASES ? HOUR_ALIASES[key] : -1;
}

// ---------- Tracks ----------
// A track is a list of [p, value] keys around the year, eased between
// neighbours and wrapping from the last key to the first.
function locate(ps, p, out) {
  const n = ps.length;
  let i = n - 1;
  for (let k = 0; k < n && ps[k] <= p; k++) i = k;
  const j = (i + 1) % n;
  let p0 = ps[i];
  let p1 = ps[j];
  if (p < ps[0]) p0 -= YEAR;
  else if (j === 0) p1 += YEAR;
  const t = p1 > p0 ? clamp((p - p0) / (p1 - p0), 0, 1) : 0;
  out.i = i;
  out.j = j;
  out.t = t * t * (3 - 2 * t);
}

const _at = { i: 0, j: 0, t: 0 };

const byTime = (keys) => [...keys].sort((a, b) => a[0] - b[0]);

function num(...unsorted) {
  const keys = byTime(unsorted);
  const ps = keys.map((k) => k[0]);
  const vs = keys.map((k) => k[1]);
  return (p) => {
    locate(ps, p, _at);
    return vs[_at.i] + (vs[_at.j] - vs[_at.i]) * _at.t;
  };
}

function hue(...unsorted) {
  const keys = byTime(unsorted);
  const ps = keys.map((k) => k[0]);
  const cs = keys.map((k) => new THREE.Color(k[1]));
  return (p, out) => {
    locate(ps, p, _at);
    return out.copy(cs[_at.i]).lerp(cs[_at.j], _at.t);
  };
}

// One value per season, held around each season and changed in between.
const hold = (from, to) => (values) => values.flatMap((v, s) => [[s + to - 1, v], [s + from, v]]).map(([p, v]) => [(p + YEAR) % YEAR, v]);
const SOFT = hold(0.16, 0.86);
const four = (...values) => num(...SOFT(values));
const fourHues = (...values) => hue(...SOFT(values));

// A set of things that belongs to one season: grows in as the season arrives,
// leaves as the next one starts.
const during = (s, { lead = 0.42, tail = 0.4, edge = 0.2 } = {}) =>
  num(...[[s - lead, 0], [s - lead + edge, 1], [s + tail - edge, 1], [s + tail, 0]].map(([p, v]) => [(p + YEAR) % YEAR, v]));

const NUMBERS = {
  // ----- Foliage -----
  // Green turns to gold through early autumn; the colour is reset in late
  // winter, while the branches are bare
  leafTurn: num([1.1, 0], [1.82, 1], [3.32, 1], [3.44, 0]),
  // Share of the leaves that have fallen. A few cling on through the winter.
  leafDrop: num([1.5, 0], [2, 0.2], [2.1, 0.24], [2.6, 0.93], [3.1, 0.93], [3.3, 1], [3.5, 1], [3.96, 0]),
  leafFresh: num([0.3, 1], [0.92, 0], [3.4, 0], [3.5, 1]),
  blossom: num([0.2, 1], [0.62, 0], [3.5, 0], [3.92, 1]),

  // ----- Ground -----
  grassDry: num([0, 0.1], [0.5, 0], [1.25, 0], [1.9, 0.5], [2.5, 0.85], [3.5, 0.85], [3.95, 0.12]),
  grassFresh: num([0, 1], [0.86, 0], [3.45, 0], [3.9, 1]),
  grassGrow: num([0, 0.84], [0.6, 1], [1.9, 0.92], [2.4, 0.6], [2.8, 0.36], [3.45, 0.36], [3.95, 0.8]),
  litter: num([0.35, 0], [1.4, 0], [2, 0.82], [2.5, 1], [3.5, 1], [3.92, 0.12]),

  // ----- Winter -----
  snow: num([2.42, 0], [2.92, 1], [3.1, 1], [3.62, 0]),
  ice: num([2.5, 0], [2.95, 1], [3.06, 1], [3.42, 0]),
  // How cold the air is: what comes down as rain at 0 comes down as snow at 1.
  // The first frost is ahead of the snow that lies, and the thaw ahead of its going.
  frost: num([2.3, 0], [2.55, 1], [3.1, 1], [3.3, 0]),
  // Winter arrives in a flurry, which is over by the time it is here: the
  // snow that falls after that is the visitor's to ask for
  flurry: num([2.3, 0], [2.6, 1], [2.86, 0.85], [3, 0]),

  // ----- Water -----
  // How fast the painted current runs, and how high the creek stands
  flowRate: num([0, 1.3], [1, 1], [2, 0.92], [2.9, 0.55], [3.1, 0.55], [3.6, 1.65]),
  level: num([0, 0.04], [0.8, 0], [2.6, 0], [3, -0.015], [3.2, -0.015], [3.6, 0.06]),
  spray: four(1.15, 1, 0.9, 0.45),

  // ----- Air -----
  leavesFalling: num([1.35, 0], [2, 0.55], [2.3, 1], [2.64, 0]),
  petalsFalling: num([0, 0.5], [0.3, 1], [0.66, 0], [3.88, 0]),
  pollen: num([0, 0.5], [1, 1], [2, 0.3], [2.5, 0], [3.6, 0]),
  wind: four(1.12, 1, 1.32, 0.72),

  // ----- Light -----
  // Height of the sun by day: the sine of its elevation
  sunHeight: four(0.66, 0.7, 0.6, 0.5),
  sunPower: four(3.55, 3.6, 3.66, 2.88),
  // The sky fills the shadows, and is kept from filling them in: without
  // shade nothing stands on the ground, and what stands in the shade of a
  // tree looks as if it stood in fog. What the sky gives up the sun takes
  // over, so that open ground stays as light as it was. Winter keeps more of
  // its sky: the sun is low then, and too much of it turns the snow to cream.
  skyPower: four(1.2, 1.16, 1.14, 1.36),
  cloudShade: four(0.14, 0.14, 0.17, 0.13),

  // ----- Meadow -----
  springFlowers: num([0, 1], [0.3, 1], [0.7, 0], [3.5, 0], [3.9, 1]),
  snowdrops: num([0, 0.7], [0.3, 0], [3.3, 0], [3.62, 1]),
  summerFlowers: num([0.4, 0], [0.95, 1], [1.2, 1], [1.72, 0.14], [2.3, 0], [3.9, 0]),
  mushrooms: num([1.55, 0], [1.95, 1], [2.3, 1], [2.55, 0]),
  lilies: num([0.45, 0], [0.9, 1], [1.3, 1], [1.8, 0]),
  pads: num([0.8, 1], [1.5, 1], [2.2, 0.35], [2.5, 0], [3.6, 0], [3.95, 0.7]),
  reedDry: num([0.5, 0], [1.3, 0], [2, 0.7], [2.6, 1], [3.5, 1], [3.95, 0.25]),

  // ----- Things and animals: each set belongs to its season -----
  setSpring: during(0),
  setSummer: during(1),
  setAutumn: during(2),
  setWinter: during(3, { lead: 0.36 }),
  kite: num([0.55, 0], [0.75, 1], [2.3, 1], [2.45, 0]),
  picnic: num([0.5, 0], [0.72, 1], [2.36, 1], [2.56, 0]),
  // Rain and thaw: puddles on the path in spring and again in autumn
  puddles: num([3.52, 0], [3.74, 1], [0.34, 1], [0.58, 0], [1.72, 0], [1.94, 1], [2.36, 1], [2.54, 0]),
  // The toy sailboat spends the winter frozen into the pool; paper boats have the spring
  sail: num([0.44, 0], [0.64, 1], [3.5, 1], [3.66, 0]),
  paperBoats: num([3.72, 0], [3.92, 1], [0.28, 1], [0.46, 0]),
  leafBoats: num([1.7, 0], [1.94, 1], [2.4, 1], [2.56, 0]),
  stork: num([1.66, 1], [1.86, 0], [3.72, 0], [3.9, 1]),
  // 1: at home on the nest, 0: fishing in the shallows
  storkNest: num([0.3, 1], [0.7, 0], [3.5, 0], [3.6, 1]),
  ducks: num([2.42, 1], [2.6, 0], [3.4, 0], [3.6, 1]),
  swimmers: num([2, 1], [2.35, 0], [3.7, 0], [3.95, 1]),
  flyers: num([0, 0.6], [0.8, 1], [1.45, 1], [1.85, 0], [3.8, 0]),
  crawlers: num([2.2, 1], [2.5, 0], [3.75, 0], [3.95, 1]),
  flock: num([1.6, 0], [1.85, 1], [2.3, 1], [2.5, 0]),
  farBirds: num([2.5, 1], [2.75, 0], [3.5, 0], [3.75, 1]),
  // Fireflies belong to the evenings of early summer; the last are gone by autumn
  fireflies: num([0.45, 0], [0.9, 1], [1.4, 1], [1.85, 0], [3.9, 0]),

  // ----- Sound -----
  birdsong: four(1.25, 1, 0.45, 0.1),
  creekSound: four(1.15, 1, 0.95, 0.45),
  muffle: num([2.5, 0], [2.95, 1], [3.06, 1], [3.42, 0]),

  // ----- Finish -----
  saturation: four(1.09, 1.07, 1.1, 1.0),
};

const HUES = {
  // The winter sky is the deepest of the four: white ground needs something
  // darker than itself to be seen against
  skyTop: fourHues('#B4D6F6', '#BFD8F4', '#C3D0EC', '#AFC3E4'),
  skyMid: fourHues('#DCEEFB', '#DCEAFA', '#E6E3F1', '#D2DEF2'),
  skyHorizon: fourHues('#FDF6E2', '#FBF1E6', '#FCE5CD', '#F6E6E2'),
  skyLow: fourHues('#E8F3FB', '#E6F0FB', '#F0E6EC', '#D3DEF1'),
  skyDeep: fourHues('#C6DEF6', '#C9DCF5', '#D4D2EA', '#B9C9E6'),
  haze: fourHues('#E4F1FA', '#E3EEFB', '#EEE7EE', '#D8E2F3'),
  sun: fourHues('#FFF4DE', '#FFF0D8', '#FFE1B6', '#FFE6CC'),
  skyLight: fourHues('#D2E6FA', '#CFE0FA', '#D8DAF2', '#D3E1FA'),
  // What the ground throws back up is far weaker than the sky: it is the
  // difference between the two that gives a thing in the shade its shape.
  // Snow throws back the most.
  bounce: fourHues('#A7A890', '#AC9E91', '#AC977E', '#B8C0CF'),
  rim: fourHues('#EEF6FF', '#EAF3FF', '#FFEEDC', '#F2F7FF'),
  // Lifted shadows and lowered lights of the finished frame
  gradeShadow: fourHues('#EEF3FF', '#F0EEFF', '#F6EDF4', '#E9F0FF'),
  gradeLight: fourHues('#FFFDF2', '#FFFAF0', '#FFF4E2', '#FCFBFF'),

  grassDry: hue([0, '#D9CC8C'], [1.5, '#D2C27C'], [2, '#CDB872'], [3, '#DDD3A6']),
  grassFresh: hue([0, '#F2F7A6'], [2, '#F2F7A6']),
  snow: hue([0, '#F4F8FF'], [2.4, '#F4F8FF'], [3, '#EEF3FD']),
  snowShade: hue([0, '#A6BCE8'], [2.4, '#A6BCE8'], [3, '#93ACE2']),

  waterShallow: fourHues('#C2E8E2', '#BFE6EE', '#BCDCE0', '#A9CFE4'),
  waterMid: fourHues('#7CBEDD', '#7FBBE8', '#77ADD8', '#6298CE'),
  waterDeep: fourHues('#3A76BC', '#3D72C2', '#3A67B0', '#305CA4'),
  waterSky: fourHues('#E8F4FC', '#E6F2FD', '#F4EEEE', '#EAF1FB'),
  waterShade: fourHues('#C4D6EA', '#C6D4EC', '#CBD0E6', '#C2D2EE'),
  waterFall: fourHues('#A9D6EE', '#A6D2F1', '#A4CCEA', '#C3E0F4'),
  // White water is white all year, by day
  foam: hue([0, '#FFFFFF'], [2, '#FFFFFF']),
  // What the sun adds to water it reaches: a touch over white, and warm
  waterLit: hue([0, new THREE.Color(1.06, 1.05, 1.03)], [2, new THREE.Color(1.06, 1.05, 1.03)]),
  // What is white by day whatever the light: far cloud, mist, and all that
  // falls or drifts through the air. By night it is as dim as everything else.
  pale: hue([0, '#FFFFFF'], [2, '#FFFFFF']),
};

// ---------- The hours ----------
// The tracks above are the island by day. Each of the other hours is laid
// over them, value by value and each by its share: 1 gives the hour's value
// in full, less leaves some of the day's in it. Between two hours the island
// has some of each.
const allYear = (value) => hue([0, value], [2, value]);

// The hour after sunrise. The sun is low behind the far end of the island,
// across from where it will set: the light is pale and comes through the
// leaves, the shade is long and still blue, and the sky is rose at its foot.
const MORNING = {
  numbers: {
    skyPower: [1.12, 1],
    cloudShade: [0.16, 1],
    saturation: [1.08, 0.6],
  },
  hues: {
    skyTop: [fourHues('#9DBAEC', '#A0BBEC', '#A6B4E4', '#9AB0E6'), 1],
    skyMid: [fourHues('#EBD3E2', '#EED3DE', '#EECDD6', '#E2D0E6'), 1],
    skyHorizon: [fourHues('#FFE7C6', '#FFE4C0', '#FFDDB4', '#FFE4CC'), 1],
    skyLow: [fourHues('#F6DDDC', '#F7DCD8', '#F6D6CE', '#EDDBE2'), 1],
    skyDeep: [fourHues('#C6C8EC', '#C8C8EA', '#CCC4E2', '#BEC6EC'), 1],
    haze: [fourHues('#F3E2E2', '#F4E1DE', '#F4DCD4', '#EBDFE6'), 1],
    sun: [fourHues('#FFDDB2', '#FFDAAC', '#FFD29C', '#FFDCBC'), 1],
    skyLight: [fourHues('#C3D2F8', '#C1CFF8', '#C6CAF0', '#C2D2FA'), 1],
    bounce: [fourHues('#AEA596', '#B2A193', '#B29A84', '#B8BACC'), 0.8],
    rim: [fourHues('#FFF0DA', '#FFEED4', '#FFE8C8', '#FFEEE0'), 1],
    gradeShadow: [fourHues('#E6ECFF', '#E7EBFF', '#ECE8F8', '#E2ECFF'), 1],
    gradeLight: [fourHues('#FFF7E6', '#FFF5E2', '#FFF0D8', '#FFF6EC'), 1],
    snow: [allYear('#FFF5EE'), 0.7],
    snowShade: [allYear('#A3B2E6'), 0.9],
    waterShallow: [fourHues('#D6DDE0', '#D8DCE0', '#D8D6D6', '#C6D2E4'), 0.75],
    waterMid: [fourHues('#8FB2DA', '#92B0DE', '#8EA6D2', '#7C9CD2'), 0.75],
    waterDeep: [fourHues('#456CAA', '#486AAE', '#4762A2', '#3C5CA0'), 0.75],
    waterSky: [fourHues('#FFECDC', '#FFEAD8', '#FFE4CE', '#FCEAE4'), 0.9],
    waterShade: [fourHues('#BEC2E6', '#C0C2E6', '#C4BEDE', '#B8C2EA'), 0.85],
    waterFall: [fourHues('#C8D0EC', '#CAD0EA', '#CACAE2', '#C6D4F0'), 0.7],
    foam: [fourHues('#FFEFE4', '#FFEDE0', '#FEE8D8', '#FBEEE8'), 1],
    waterLit: [allYear(new THREE.Color(1.06, 0.98, 0.9)), 1],
  },
};

// The hour before sunset: the sun low and gold, the sky gone to peach at its
// foot and to violet overhead, and the shade filled with what is left of the
// blue.
const EVENING = {
  numbers: {
    skyPower: [1.02, 1],
    cloudShade: [0.2, 1],
    saturation: [1.12, 0.6],
  },
  hues: {
    skyTop: [fourHues('#93A6DE', '#8FA2DC', '#9A9AD4', '#8E9FD8'), 1],
    skyMid: [fourHues('#DCC6E4', '#E2C4DE', '#E6BFD2', '#D2C4E6'), 1],
    skyHorizon: [fourHues('#FFDDB0', '#FFD8A6', '#FFCE98', '#FFD9BC'), 1],
    skyLow: [fourHues('#F2CFCB', '#F4CDC4', '#F4C6B8', '#E9CDD6'), 1],
    skyDeep: [fourHues('#B4A9DC', '#B6A8D8', '#BCA4CE', '#A9A8DC'), 1],
    haze: [fourHues('#EFD6D8', '#F1D5D2', '#F2CFC6', '#E6D3E0'), 1],
    sun: [fourHues('#FFC98C', '#FFC284', '#FFB672', '#FFC79A'), 1],
    skyLight: [fourHues('#B9BCF0', '#B7B8EE', '#BDB2E4', '#B4BCF2'), 1],
    bounce: [fourHues('#B49C88', '#B89684', '#B88C72', '#B9B2C8'), 0.8],
    rim: [fourHues('#FFE6C6', '#FFE2BE', '#FFD9AE', '#FFE4D0'), 1],
    gradeShadow: [fourHues('#E9E6FF', '#EAE4FF', '#EFE2F6', '#E4E6FF'), 1],
    gradeLight: [fourHues('#FFF3DC', '#FFF0D6', '#FFEACC', '#FFF2E4'), 1],
    snow: [allYear('#FFF2E6'), 0.75],
    snowShade: [allYear('#98A0DE'), 0.9],
    waterShallow: [fourHues('#D9D2D6', '#DCD0D2', '#DCC9C6', '#C4C6DE'), 0.75],
    waterMid: [fourHues('#8FA4D2', '#92A2D4', '#8E98C8', '#7C8FCC'), 0.75],
    waterDeep: [fourHues('#45609E', '#4860A2', '#475896', '#3C5296'), 0.75],
    waterSky: [fourHues('#FFE4CC', '#FFE0C4', '#FFD8B8', '#FBE2DA'), 0.9],
    waterShade: [fourHues('#BDB9E2', '#BFB8E0', '#C2B4D8', '#B6B8E6'), 0.85],
    waterFall: [fourHues('#C9C6E6', '#CCC4E2', '#CCBEDA', '#C6CCEC'), 0.7],
    foam: [fourHues('#FBE3D4', '#FBE0CE', '#FADAC4', '#F6E2DC'), 1],
    waterLit: [allYear(new THREE.Color(1.07, 0.93, 0.82)), 1],
  },
};

// The night is the moon's: a cool light from behind the island, a deep sky
// and long soft shadows. It is a night out of a picture book, blue and not
// black, in which everything can still be made out. What is white by day is
// dim, nobody is on the wing and no pollen hangs in the air.
const NIGHT = {
  numbers: {
    skyPower: [1.35, 1],
    cloudShade: [0.08, 1],
    saturation: [0.96, 1],
    pollen: [0, 1],
    flyers: [0, 1],
    farBirds: [0, 1],
    flock: [0, 1],
  },
  hues: {
    skyTop: [fourHues('#1C2A68', '#1B2A68', '#202864', '#1A2A6C'), 1],
    skyMid: [fourHues('#2D4088', '#2C4088', '#323C82', '#2A408C'), 1],
    skyHorizon: [fourHues('#5C74C4', '#5A74C4', '#6270BC', '#5876C8'), 1],
    skyLow: [fourHues('#34488E', '#33488E', '#394488', '#314892'), 1],
    skyDeep: [fourHues('#1E2B62', '#1D2B62', '#22295E', '#1C2B66'), 1],
    haze: [fourHues('#2C3D80', '#2B3D80', '#30397A', '#293D84'), 1],
    sun: [allYear('#B9CCFF'), 1],
    skyLight: [fourHues('#7088E2', '#6F86E2', '#7480DA', '#6E8AE6'), 1],
    bounce: [fourHues('#4A5A90', '#4A5A90', '#4E5688', '#56679E'), 1],
    rim: [allYear('#7C92DC'), 1],
    gradeShadow: [allYear('#DCE2FF'), 1],
    gradeLight: [allYear('#F2F4FF'), 1],
    snowShade: [allYear('#3A4C92'), 1],
    waterShallow: [fourHues('#A9CBE2', '#A8CAE6', '#A6C2DC', '#98BCE0'), 0.8],
    waterMid: [fourHues('#6E9EDA', '#709CE0', '#6A94D4', '#5C8AD0'), 0.8],
    waterDeep: [fourHues('#3460B4', '#365EB8', '#3458AA', '#2C52A4'), 0.8],
    waterSky: [allYear('#DCE8FF'), 1],
    waterShade: [allYear(new THREE.Color(0.2, 0.26, 0.52)), 1],
    waterFall: [allYear('#8098D8'), 0.9],
    foam: [allYear('#8EA2DA'), 1],
    waterLit: [allYear(new THREE.Color(0.36, 0.44, 0.78)), 1],
    pale: [allYear('#7F92C8'), 1],
  },
};

const HOUR_LIGHT = [MORNING, null, EVENING, NIGHT];

// The lamp of each hour: the sun, and by night the moon. `from` is the side
// it shines from, as an angle round the island (the opening view looks from
// 0.44), `height` the sine of its elevation and `power` its strength; the
// day's height and power are the season's own. By day the sun stands over
// the viewer's left shoulder, so forms read clearly and shadows fall away to
// the right, and in the evening it has sunk on that same side. In the
// morning it comes up behind the right-hand end of the island, and the moon
// hangs behind the island, where the sky of the opening view shows it.
const LAMPS = [
  { from: 2.61, height: 0.3, power: 3.0 },
  { from: -1.0405 },
  { from: -1.0405, height: 0.34, power: 3.05 },
  { from: 3.13, height: 0.56, power: 1.9, moon: true },
];
// The height at which a sun that is setting, or has yet to rise, gives no light
const SET = 0.1;

const _hue = new THREE.Color();
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
// How much of every hour there is, and what the hours add between them to
// each number and to each colour of the moment
const shares = new Array(HOURS).fill(0);
const added = {};
const tints = {};
for (const hour of HOUR_LIGHT) {
  for (const key in hour?.numbers) added[key] = 0;
  for (const key in hour?.hues) tints[key] = new THREE.Color(0, 0, 0);
}

// The values of the moment, for anything that wants to read them: one set
// for every clock, from where a change arrives last to where it arrives
// first, and `v` for the one in the middle. With the year at rest they are
// all the same.
const MIDDLE = (CLOCKS - 1) / 2;
const clocks = Array.from({ length: CLOCKS }, () => {
  const values = {};
  for (const key of Object.keys(NUMBERS)) values[key] = 0;
  return values;
});
const v = clocks[MIDDLE];
const hues = {};
for (const key of Object.keys(HUES)) hues[key] = new THREE.Color();

export const season = {
  p: 1,
  // The season the island is in, or is on its way to
  index: 1,
  moving: false,
  // Where in the day the island is, the hour it is at or on its way to, and
  // whether it is on its way
  hour: DAY,
  hourIndex: DAY,
  passing: false,
  // How much of the morning, the evening and the night there is, each 0..1;
  // what is left of 1 is the day
  dawn: 0,
  dusk: 0,
  night: 0,
  // The lamp of the moment: where it shines from and how strongly. `lit` is
  // how far it is out, 0..1 (a sun that has set and a moon that has paled
  // give nothing), and `moon` how far out the moon is.
  lamp: { direction: new THREE.Vector3(0, 1, 0), power: 0, lit: 1, moon: 0 },
  // True on the frames in which the year or the day moved (and once after every jump)
  changed: true,
  v,
  hues,
  // The least and the most of a value over the island: nothing is put away
  // while one side of it still has the thing out
  least: (key) => clocks.reduce((least, values) => Math.min(least, values[key]), Infinity),
  most: (key) => clocks.reduce((most, values) => Math.max(most, values[key]), -Infinity),
  // One value for every clock, for a uniform that is told the way the year is
  row: (value = 0) => new Array(CLOCKS).fill(value),
  // What `track(values)` comes to by every clock, written to such a row;
  // returns the most of them
  across(track, out) {
    let most = -Infinity;
    for (let k = 0; k < CLOCKS; k++) {
      out[k] = track(clocks[k]);
      if (out[k] > most) most = out[k];
    }
    return most;
  },
  // How hard a change is blowing through, 0..1
  turning: 0,
  // What the visitor has asked the sky for
  asked: Object.fromEntries(WEATHER_IDS.map((kind) => [kind, false])),
  // The weather of the moment, each 0..1: how hard it rains, how thick the
  // snow comes down, how much mist lies and how far the wind has got up.
  // `sky` is the seconds of weather so far.
  rain: 0,
  snowing: 0,
  mist: 0,
  windy: 0,
  sky: 0,
  // How wet the rain has left things, and how much of it stands in puddles, 0..1
  wet: 0,
  pooled: 0,
  // Seconds of current: runs faster in the thaw and slower under ice
  flow: 0,
  // Seconds of wind: a gust runs them on faster
  gusts: 0,
};

// The far side of the island trails the near one by this share of a change
const SWEEP = 0.36;
// How late each clock sets out: the last by the whole of that, the first not at all
const LATE = clocks.map((_, k) => 1 - k / (CLOCKS - 1));
// The wind gets up while a change blows through, and gusts come quicker
const GUST = 0.55;
const GUST_PACE = 0.7;

const wrap = (p) => ((p % YEAR) + YEAR) % YEAR;
const wrapDay = (hour) => ((hour % HOURS) + HOURS) % HOURS;

// With the wind asked for it blows this much harder, and its gusts run this much quicker
const BLOW = 0.95;
const BLOW_PACE = 0.75;
// How much of the ground the thickest mist hides, and how fast its drifts travel
const MIST = 0.58;
const MIST_PACE = 0.045;

// Weather that is asked for comes on over a few seconds and goes the same
// way: seconds to arrive, seconds to leave
const ONSET = { rain: [2.6, 2.2], mist: [4.5, 3.5], wind: [2.8, 3.6] };
// How far each has come, 0..1
const come = Object.fromEntries(WEATHER_IDS.map((kind) => [kind, 0]));
const soft = (k) => k * k * (3 - 2 * k);
// Moves `from` towards `to` so as to cover a share `1 - 1/e` of the way in `seconds`
const towards = (from, to, dt, seconds) => from + (to - from) * (1 - Math.exp(-dt / seconds));

// While it lasts, weather is never quite even: snow comes in flurries, mist
// thickens and thins, wind comes in gusts. A number that wanders between 0
// and 1, making for a new one every beat, gives each its unevenness. It only
// shapes what is already there: it starts and stops nothing.
const skyKnot = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};
const wander = (t) => {
  const i = Math.floor(t);
  const f = t - i;
  return skyKnot(i) + (skyKnot(i + 1) - skyKnot(i)) * f * f * (3 - 2 * f);
};

// Where the lamp of an hour stands when it is `out` of the way up (the moon
// hangs where it is), and how strong it is in full
function aim(index, to, out = 1) {
  const lamp = LAMPS[index];
  const full = lamp.height ?? v.sunHeight;
  const height = lamp.moon ? full : SET + (full - SET) * out;
  const flat = Math.sqrt(1 - height * height);
  to.set(Math.sin(lamp.from) * flat, height, Math.cos(lamp.from) * flat);
  return lamp.power ?? v.sunPower;
}

// The lamp between hour `i` and the next, `j`, a share `f` of the way over
function shine(i, j, f) {
  const lamp = season.lamp;
  if (!LAMPS[i].moon && !LAMPS[j].moon) {
    // The sun crosses the sky, over the top when it has far to go
    const s = soft(f);
    const power = aim(i, _from);
    lamp.power = power + (aim(j, _to) - power) * s;
    const angle = _from.angleTo(_to);
    if (angle < 1e-4) lamp.direction.copy(_to);
    else {
      lamp.direction
        .copy(_from)
        .multiplyScalar(Math.sin((1 - s) * angle))
        .addScaledVector(_to, Math.sin(s * angle))
        .normalize();
    }
    lamp.lit = 1;
    lamp.moon = 0;
  } else {
    // One lamp is gone before the other comes: the sun sets, or the moon
    // pales, in the first half, and the other is out by the end of the second
    const coming = f >= 0.5;
    const index = coming ? j : i;
    const out = soft(coming ? f * 2 - 1 : 1 - f * 2);
    lamp.power = aim(index, lamp.direction, out) * out;
    lamp.lit = out;
    lamp.moon = LAMPS[index].moon ? out : 0;
  }
  shared.uLamp.value = lamp.lit;
}

// `at`: where in the year every clock stands. The hour is read from `season.hour`.
function evaluate(at) {
  // How much of each hour there is: the one that is going and the one that is coming
  const going = Math.floor(season.hour) % HOURS;
  const coming = (going + 1) % HOURS;
  const over = season.hour - Math.floor(season.hour);
  shares.fill(0);
  shares[coming] = soft(over);
  shares[going] = 1 - shares[coming];
  season.dawn = shares[0];
  season.dusk = shares[2];
  season.night = shares[3];

  for (let k = 0; k < CLOCKS; k++) {
    const values = clocks[k];
    if (k > 0 && at[k] === at[k - 1]) {
      // Clocks that agree are read once
      Object.assign(values, clocks[k - 1]);
    } else {
      const p = wrap(at[k]);
      for (const key in NUMBERS) values[key] = NUMBERS[key](p);
      if (shares[DAY] < 1) {
        // Every hour is laid over the day's own value, so two of them agree
        // on what lies between whichever is laid first
        for (const key in added) added[key] = 0;
        for (let h = 0; h < HOURS; h++) {
          const numbers = shares[h] > 0 && HOUR_LIGHT[h]?.numbers;
          for (const key in numbers) added[key] += (numbers[key][0] - values[key]) * numbers[key][1] * shares[h];
        }
        for (const key in added) values[key] += added[key];
      }
    }
    shared.uLeaf.value[k].set(values.leafTurn, values.leafDrop, values.leafFresh, values.blossom);
    shared.uGround.value[k].set(values.grassDry, values.grassFresh, values.litter, values.grassGrow);
    shared.uWinter.value[k].set(values.snow, values.ice);
  }
  // The light, the sky and the water keep to the middle of the island
  for (const key in HUES) HUES[key](season.p, hues[key]);
  if (shares[DAY] < 1) {
    for (const key in tints) tints[key].setRGB(0, 0, 0);
    for (let h = 0; h < HOURS; h++) {
      const colours = shares[h] > 0 && HOUR_LIGHT[h]?.hues;
      for (const key in colours) {
        const [track, share] = colours[key];
        const k = share * shares[h];
        const day = hues[key];
        const tint = tints[key];
        track(season.p, _hue);
        tint.r += (_hue.r - day.r) * k;
        tint.g += (_hue.g - day.g) * k;
        tint.b += (_hue.b - day.b) * k;
      }
    }
    for (const key in tints) {
      hues[key].r += tints[key].r;
      hues[key].g += tints[key].g;
      hues[key].b += tints[key].b;
    }
  }
  shine(going, coming, over);
  shared.uLevel.value = v.level;
}

// The air of the moment. The season sets the wind and the cloud shadows, and a
// change passing through stirs both up; everything else is what the visitor
// has asked for, and nothing here begins or ends without being told to.
function weather(dt) {
  season.sky += dt;
  const sky = season.sky;
  for (const kind of WEATHER_IDS) {
    const [arrive, leave] = ONSET[kind];
    come[kind] = clamp(come[kind] + (season.asked[kind] ? dt / arrive : -dt / leave), 0, 1);
  }

  // What comes down is rain in the warm and snow in the cold, so a rain that
  // is left on turns to snow as winter comes, and back in the thaw
  const falling = soft(come.rain);
  season.rain = falling * (1 - v.frost);
  // What the rain wets is soaked in a few seconds and takes half a minute to dry
  season.wet = towards(season.wet, season.rain, dt, season.rain > season.wet ? 3.5 : 12);
  if (season.rain === 0 && season.wet < 0.004) season.wet = 0;
  shared.uWet.value = season.wet;
  // Rain that keeps on gathers in puddles. They outlast the wet a little, and
  // are gone with the first frost.
  const pooling = soft(clamp((season.wet - 0.5) / 0.4, 0, 1));
  season.pooled = Math.min(towards(season.pooled, pooling, dt, pooling > season.pooled ? 2.4 : 9), 1 - v.frost);
  if (pooling === 0 && season.pooled < 0.004) season.pooled = 0;

  // Snow comes in flurries. The one winter arrives in thins out by itself.
  const snowing = Math.max(falling * v.frost * (0.72 + 0.28 * wander(sky / 13 + 40.5)), v.flurry);
  season.snowing = towards(season.snowing, snowing, dt, snowing > season.snowing ? 0.5 : 1.5);
  if (snowing === 0 && season.snowing < 0.002) season.snowing = 0;
  // Mist thickens and thins, and rain beats it down. It lies on the ground,
  // and its drifts go the way the wind does.
  season.mist = soft(come.mist) * (0.78 + 0.22 * wander(sky / 27 + 90.5)) * (1 - 0.4 * season.rain);
  const wind = shared.uWind.value;
  shared.uMist.value.x = MIST * season.mist;
  shared.uMist.value.z = -wind.x * wind.w * MIST_PACE;
  shared.uMist.value.w = -wind.y * wind.w * MIST_PACE;
  // Wind comes in gusts
  season.windy = soft(come.wind);
  const blow = season.windy * (0.78 + 0.44 * wander(sky / 3.1 + 7.5));

  shared.uWind.value.z = v.wind * (1 + GUST * season.turning + 0.18 * season.rain + BLOW * blow);
  shared.uWind.value.w += dt * (1 + GUST_PACE * season.turning + BLOW_PACE * season.windy);
  season.gusts = shared.uWind.value.w;
  // Rain comes under a darker sky
  shared.uCloud.value.z = v.cloudShade * (1 + 0.5 * season.turning) + 0.1 * season.rain;
}

// Shared colours are handed out once and then repainted in place
shared.uHazeColor.value = hues.haze;
shared.uRimColor.value = hues.rim;
shared.uSnowColor.value = hues.snow;
shared.uSnowShade.value = hues.snowShade;
shared.uGrassDry.value = hues.grassDry;
shared.uGrassFresh.value = hues.grassFresh;
shared.uPale.value = hues.pale;

/**
 * The calendar: holds the place in the year and in the day and walks each to
 * wherever it is sent, and takes the visitor's orders for the weather.
 * `onChange(index, from)` is told as soon as a new season is chosen.
 */
export function createCalendar({ start = 1, reducedMotion = false, onChange = () => {} } = {}) {
  // Where the clocks stand, where each set out from and how far it has to
  // go. They are not wrapped round the year, so a change that is called off
  // half-way turns each clock back from wherever it has got to.
  const at = season.row();
  const from = season.row();
  const travel = season.row();
  let span = 0;
  let clock = 0;
  // The same for the day, which has one clock
  let day = DAY;
  let dayFrom = DAY;
  let dayTravel = 0;
  let daySpan = 0;
  let dayClock = 0;
  // A jump is reported as `changed` on the one frame that follows it
  let fresh = true;

  season.index = Math.max(0, seasonIndex(start));
  season.p = season.index;
  season.moving = false;
  season.hour = season.hourIndex = DAY;
  season.passing = false;
  season.changed = true;
  season.turning = 0;
  at.fill(season.index);
  evaluate(at);
  weather(0);

  function go(next, { instant = false } = {}) {
    const index = seasonIndex(next);
    if (index < 0 || (index === season.index && !season.moving)) return false;
    const previous = season.index;
    season.index = index;
    // The short way round the year; straight ahead when it is the same either way
    let step = wrap(index - season.p);
    if (step > YEAR / 2 + 1e-6) step -= YEAR;
    if (instant || reducedMotion || Math.abs(step) < 1e-4) {
      season.p = index;
      season.moving = false;
      season.turning = 0;
      at.fill(index);
      fresh = true;
      evaluate(at);
      weather(0);
    } else {
      const target = at[MIDDLE] + step;
      for (let k = 0; k < CLOCKS; k++) {
        from[k] = at[k];
        travel[k] = target - at[k];
      }
      span = 3.5 + 2.8 * Math.abs(step);
      clock = 0;
      season.moving = true;
    }
    if (index !== previous) onChange(index, previous);
    return true;
  }

  // Sends the island to another hour: `next` is one of HOUR_IDS. The light
  // goes there by the short way round the day, and straight ahead when it is
  // the same either way: from the day into the night through the evening,
  // and out of the night into the day through the morning. It is a change of
  // light and takes its few seconds whatever the visitor's taste for motion.
  function hour(next, { instant = false } = {}) {
    const index = hourIndex(next);
    if (index < 0 || (index === season.hourIndex && !season.passing)) return false;
    season.hourIndex = index;
    let step = wrapDay(index - season.hour);
    if (step > HOURS / 2 + 1e-6) step -= HOURS;
    if (instant || Math.abs(step) < 1e-4) {
      day = season.hour = index;
      season.passing = false;
      fresh = true;
      evaluate(at);
    } else {
      dayFrom = day;
      dayTravel = step;
      daySpan = 3.2 + 2.6 * Math.abs(step);
      dayClock = 0;
      season.passing = true;
    }
    return true;
  }

  // Moves the hour on. Says whether it moved.
  function pass(dt) {
    if (!season.passing) return false;
    dayClock = Math.min(daySpan, dayClock + dt);
    const u = dayClock / daySpan;
    day = dayFrom + dayTravel * (u + (soft(u) - u) * 0.55);
    if (dayClock >= daySpan) {
      day = season.hourIndex;
      season.passing = false;
    }
    season.hour = wrapDay(day);
    return true;
  }

  function update(dt) {
    season.flow += dt * v.flowRate;
    shared.uFlow.value = season.flow;
    // The gust gets up as a change sets out and has died down by the time it is over
    const blowing = season.moving ? Math.sqrt(Math.sin((Math.PI * clock) / span)) : 0;
    season.turning += (blowing - season.turning) * (1 - Math.exp(-dt / 0.35));
    const passed = pass(dt);
    if (!season.moving) {
      if (season.turning < 0.001) season.turning = 0;
      // The hour repaints the light as it goes by
      if (passed) {
        evaluate(at);
        fresh = true;
      }
      weather(dt);
      season.changed = fresh;
      fresh = false;
      return;
    }
    clock = Math.min(span, clock + dt);
    const t = clock / span;
    for (let k = 0; k < CLOCKS; k++) {
      const u = clamp((t - SWEEP * LATE[k]) / (1 - SWEEP), 0, 1);
      // A touch of ease at both ends; the year itself keeps an even pace
      at[k] = from[k] + travel[k] * (u + (u * u * (3 - 2 * u) - u) * 0.55);
    }
    season.changed = true;
    if (clock >= span) {
      at.fill(season.index);
      season.moving = false;
    }
    season.p = wrap(at[MIDDLE]);
    evaluate(at);
    weather(dt);
  }

  // The visitor's weather: `kind` is one of WEATHER_IDS, and it lasts until it
  // is called off. Answers whether that kind is asked for now.
  function ask(kind, on = !season.asked[kind]) {
    if (!(kind in season.asked)) return false;
    season.asked[kind] = !!on;
    return season.asked[kind];
  }

  return { go, hour, update, weather: ask, season };
}
