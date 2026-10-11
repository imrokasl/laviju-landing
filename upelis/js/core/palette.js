import * as THREE from './three.js';

// Brand tokens, mirrored from src/theme/tokens.ts, src/theme/editorial.ts and
// landing-web/public/styles.css. The scene palette below is mixed from these,
// so the creek sits in the same blue-led pastel world as the app and the site.
export const brand = {
  primary: '#3565B0',
  primaryLight: '#5F87BF',
  primaryDark: '#244B87',
  teal: '#5BA3B5',
  tealLight: '#A8D4E0',
  background: '#F4F7FC',
  text: '#1E2A3A',
  sky: { wash: '#F3F8FE', soft: '#DCEBFA', mid: '#B9D5F2', dot: '#6FA0DE', ink: '#2A5599' },
  peach: { wash: '#FFF7F3', soft: '#FCE3D8', mid: '#F6C4AE', dot: '#F0A487', ink: '#9C4A2F' },
  butter: { wash: '#FFFBEF', soft: '#FDF0C8', mid: '#F7DD8C', dot: '#F2C94C', ink: '#775800' },
  sage: { wash: '#F5FAF6', soft: '#DCEFE2', mid: '#B5DCC2', dot: '#7CC196', ink: '#2F6B47' },
  lilac: { wash: '#F8F6FE', soft: '#E6E0FA', mid: '#C9BEF2', dot: '#A596E6', ink: '#54479E' },
};

export const palette = {
  // Sky and air
  skyTop: '#BFD8F4',
  skyMid: '#DCEAFA',
  skyHorizon: '#FBF1E6',
  skyLow: '#E6F0FB',
  skyDeep: '#C9DCF5',
  haze: '#E3EEFB',
  cloud: '#FFFFFF',
  cloudShade: '#C9DAF2',

  // Light
  sun: '#FFF0D8',
  skyLight: '#CFE0FA',
  bounceLight: '#F6E2CF',
  rim: '#EAF3FF',

  // Meadow
  grassDeep: '#5DA37C',
  grassMid: '#86C489',
  grassLight: '#B4DC98',
  grassSun: '#DCEBA4',
  moss: '#6CAE88',

  // Earth
  sand: '#F2E1CC',
  sandWet: '#D8C0A6',
  bed: '#CDBFAE',
  bedDeep: '#7FA6B8',
  path: '#EAD7BE',
  soil: '#B98660',
  soilDark: '#946648',
  clay: '#D4A985',
  rock: '#B7BBD3',
  rockLight: '#DEE1EE',
  rockDark: '#8B8FB1',
  rockWarm: '#D8CEC9',

  // Water
  waterShallow: '#BFE6EE',
  waterMid: '#7FBBE8',
  waterDeep: '#3D72C2',
  waterSky: '#E6F2FD',
  waterShade: '#C6D4EC',
  waterFall: '#A6D2F1',
  foam: '#FFFFFF',

  // Wood
  woodLight: '#E4BC8B',
  wood: '#CB9665',
  woodDark: '#9B6B45',
  barkOak: '#C6A882',
  barkDark: '#967C60',
  birch: '#F5F2EC',
  birchShade: '#C9CBD9',
  birchMark: '#414659',

  // Foliage
  oakDark: '#4C9872',
  oakMid: '#79BE87',
  oakLight: '#B3DB93',
  birchLeafDark: '#7FBF86',
  birchLeafMid: '#A9D391',
  birchLeafLight: '#D2E79E',
  spruceDark: '#3C8072',
  spruceMid: '#59A088',
  spruceLight: '#8DC7A4',
  bushDark: '#559F79',
  bushMid: '#7DBE88',
  bushLight: '#A3D592',
  willowDark: '#78B983',
  willowMid: '#9FCE8C',
  willowLight: '#C3E19A',
  reed: '#8FBF7C',
  reedDark: '#5F9E72',
  cattail: '#8A5A3A',
  lilyPad: '#8FC58B',
  lilyPadDark: '#62A679',

  // Flowers and small accents
  white: '#FFFFFF',
  cream: '#FFF6EC',
  butter: '#F7D25C',
  peach: '#F6A98C',
  pink: '#F5B9C8',
  lilac: '#A99BEA',
  cornflower: '#5C86DA',
  red: '#E8705A',

  // Creatures
  duck: '#F8DD84',
  duckDark: '#EBC460',
  beak: '#F2A458',
  frog: '#A4CE86',
  frogBelly: '#E4EFC0',
  storkWhite: '#FBFAF5',
  storkBlack: '#30364A',
  storkRed: '#EE7A52',
  fish: '#2F5E9E',
  ink: '#1E2A3A',

  // Cloth and toys
  blanketA: '#F6C4AE',
  blanketB: '#FFF6EC',
  sailBlue: '#5F87BF',
  sailLight: '#CFE2F7',
  basket: '#DDAE74',
  basketDark: '#B98550',
  apple: '#E8685A',
  bucket: '#6FA0DE',
};

const cache = new Map();

// Linear-space colour for a hex string (cached; clone before mutating).
export function col(hex) {
  let c = cache.get(hex);
  if (!c) {
    c = new THREE.Color(hex);
    cache.set(hex, c);
  }
  return c;
}

const tmpA = new THREE.Color();

// Mix two hex colours in linear space, returning a new THREE.Color.
export function mixCol(a, b, t) {
  return tmpA.copy(col(a)).lerp(col(b), t).clone();
}
