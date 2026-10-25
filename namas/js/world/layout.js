// Where everything stands. One place to move a wall, a sofa or a tree; the
// field, the Blender model (through landing-web/namas/blender/context.mjs),
// the markers and the camera all read from here.
// Units are metres. +x is right, +z is towards the default camera, +y is up.

export const ISLAND = {
  halfX: 17,
  halfZ: 13,
  // 0 = a rectangle, 1 = an ellipse: a garden plot is squarer than a creek's island
  roundness: 0.72,
};

// The level the yard keeps round the house, and the ground's own gentle roll
export const GROUND = { pad: 0.42, padReach: [2.6, 6.5] };

// The house: two storeys under a pitched roof whose ridge runs along x.
// x0..x1 and z0..z1 are the outer faces of the walls.
export const HOUSE = {
  x0: -4.5,
  x1: 5.5,
  z0: -6.5,
  z1: 0.5,
  wall: 0.26,
  partition: 0.14,
  // Where the left rooms end and the right ones begin
  split: 1.0,
  floor0: 0.66,
  storey: 2.75,
  slab: 0.26,
  knee: 1.05,
  pitch: 40, // degrees
  eave: 0.5, // how far the roof reaches past the walls at front and back
  verge: 0.35, // ...and past the gables
  roof: 0.24, // thickness of the roof
};
HOUSE.floor1 = HOUSE.floor0 + HOUSE.storey + HOUSE.slab;
HOUSE.ridgeZ = (HOUSE.z0 + HOUSE.z1) / 2;
HOUSE.ridge = HOUSE.floor1 + HOUSE.knee + ((HOUSE.z1 - HOUSE.z0) / 2) * Math.tan((HOUSE.pitch * Math.PI) / 180);

// The garage is the house's ground floor carried on past its left gable, as
// deep as the house, its door to the front. Its flat roof is the parents'
// balcony, a step below their floor, behind a glass railing.
export const GARAGE = {
  x0: -9.0,
  x1: -4.5,
  z0: -6.5,
  z1: 0.5,
  floor: 0.44,
  slab: 0.3,
  rail: 1.0,
};
GARAGE.deck = HOUSE.floor1 - 0.04;
GARAGE.ceiling = GARAGE.deck - GARAGE.slab;

// The bathroom is a storey built on at the right gable, behind the kitchen's
// side window, its floor the kitchen's and its door (from z to z) through the
// gable into the kitchen. Its roof leans away from the house: its underside
// is `high` over the gable and `low` over the far wall, and it reaches `eave`
// past that wall and `verge` past the front and the back.
export const BATH = {
  x0: HOUSE.x1,
  x1: 8.1,
  z0: HOUSE.z0,
  z1: -3.45,
  door: [-5.35, -4.6],
  high: HOUSE.floor0 + 3.15,
  low: HOUSE.floor0 + 2.62,
  eave: 0.3,
  verge: 0.15,
  roof: 0.2,
};
BATH.ceiling = HOUSE.floor0 + 2.45;

// The stairs climb from the back of the living room towards the front,
// against the line between the living room and the kitchen
export const STAIRS = { x0: 0.08, x1: 0.9, zFoot: -5.3, zHead: -1.0, hole: -4.6 };

// The rooms as the light and the camera know them: the space inside the walls.
// `floor` is 0 downstairs, 1 upstairs; the garage and the bathroom are each a
// `zone` of their own.
const inner = HOUSE.wall;
export const ROOMS = {
  svetaine: { zone: 'house', floor: 0, box: [HOUSE.x0 + inner, HOUSE.floor0, HOUSE.z0 + inner, HOUSE.split, HOUSE.floor0 + HOUSE.storey, HOUSE.z1 - inner] },
  virtuve: { zone: 'house', floor: 0, box: [HOUSE.split, HOUSE.floor0, HOUSE.z0 + inner, HOUSE.x1 - inner, HOUSE.floor0 + HOUSE.storey, HOUSE.z1 - inner] },
  tevu: { zone: 'house', floor: 1, box: [HOUSE.x0 + inner, HOUSE.floor1, HOUSE.z0 + inner, HOUSE.split - HOUSE.partition / 2, HOUSE.ridge, HOUSE.z1 - inner] },
  vaiku: { zone: 'house', floor: 1, box: [HOUSE.split + HOUSE.partition / 2, HOUSE.floor1, HOUSE.z0 + inner, HOUSE.x1 - inner, HOUSE.ridge, HOUSE.z1 - inner] },
  garazas: { zone: 'garage', floor: 0, box: [GARAGE.x0 + inner, GARAGE.floor, GARAGE.z0 + inner, GARAGE.x1, GARAGE.ceiling, GARAGE.z1 - inner] },
  vonia: { zone: 'bath', floor: 0, box: [BATH.x0, HOUSE.floor0, BATH.z0 + inner, BATH.x1 - inner, BATH.ceiling, BATH.z1 - inner] },
};

const f0 = HOUSE.floor0;
const f1 = HOUSE.floor1;
const g0 = GARAGE.floor;
const gd = GARAGE.deck;

// Where the things stand that the ideas are about, as [x, y, z] at their foot
// and a turn (yaw, radians, 0 facing +z). Blender models round these; the
// markers float over them.
export const FURNITURE = {
  // Kitchen: a run of cupboards along the back wall, a table in the middle
  pantry: [1.47, f0, -5.93, 0],
  sink: [2.62, f0, -5.93, 0],
  stove: [3.85, f0, -5.93, 0],
  fridge: [4.9, f0, -5.92, 0],
  table: [3.05, f0, -2.65, 0],
  sill: [5.24, f0 + 1.0, -2.5, -Math.PI / 2],
  // Living room
  sofa: [-2.6, f0, -5.72, 0],
  fireplace: [-4.04, f0, -3.0, Math.PI / 2],
  bookcase: [-4.06, f0, -0.95, Math.PI / 2],
  rug: [-1.95, f0, -2.75, 0],
  piano: [-0.65, f0, -5.97, 0],
  // Parents' room
  bed: [-2.2, f1, -5.2, 0],
  wardrobe: [-3.93, f1, -4.65, Math.PI / 2],
  dresser: [-4.01, f1, -0.95, Math.PI / 2],
  armchair: [-3.0, f1, -0.35, 2.5],
  nightstand: [-0.95, f1, -6.0, 0],
  laundry: [-0.55, f1, -0.25, 0],
  // Kids' room
  kidsBed: [3.85, f1, -5.62, 0],
  teepee: [4.55, f1, -0.6, -0.5],
  toyShelf: [5.06, f1, -3.4, -Math.PI / 2],
  kidsTable: [2.6, f1, -3.0, 0],
  rockingHorse: [3.75, f1, -1.35, -0.6],
  dressUp: [1.32, f1, -4.55, Math.PI / 2],
  roofWindow: [2.45, f1, -4.55, 0],
  // Garage
  car: [-6.7, g0, -2.55, 0],
  bikes: [-8.45, g0, -0.9, Math.PI / 2],
  workbench: [-7.25, g0, -5.92, 0],
  shelves: [-4.73, g0, -3.4, -Math.PI / 2],
  gardenTools: [-4.85, g0, -0.4, -Math.PI / 2],
  sledHook: [-8.7, g0 + 1.75, -4.4, Math.PI / 2],
  // Bathroom: the bath along the back wall under the window, whose sill is
  // its shelf, a towel rail over its end on the gable, the washing machine in
  // the corner beyond it, the basin on the gable past the door, the toilet
  // and the potty on the far wall
  bathtub: [6.37, f0, -5.83, 0],
  bathShelf: [6.6, f0 + 1.4, -6.24, 0],
  towelRail: [5.52, f0 + 0.95, -5.85, Math.PI / 2],
  washer: [7.52, f0, -5.92, 0],
  basin: [5.52, f0, -4.12, Math.PI / 2],
  toilet: [7.84, f0, -4.75, -Math.PI / 2],
  // The balcony on the garage roof, out through the parents' glass door
  balconyTable: [-5.75, gd, -0.95, 0],
  balconySofa: [-7.2, gd, -5.8, 0],
  balconyBoxes: [-6.75, gd, 0.02, 0],
};

// Lamps that light the rooms (no shadows): where each hangs or stands, the room
// it may light, its colour and how far it reaches. The page holds at most nine:
// the model marks the yard's string lights as the tenth (see world/house.js).
export const LAMPS = [
  { room: 'virtuve', at: [3.05, f0 + 2.05, -2.65], color: '#FFD9A0', reach: 4.2, power: 1.0 },
  { room: 'virtuve', at: [3.85, f0 + 1.45, -5.8], color: '#FFE2B8', reach: 3.0, power: 0.55 },
  { room: 'svetaine', at: [-3.95, f0 + 1.5, -5.85], color: '#FFD49A', reach: 4.4, power: 0.85 },
  { room: 'svetaine', at: [-3.7, f0 + 0.45, -3.0], color: '#FF9A50', reach: 3.4, power: 0.9, fire: true },
  { room: 'tevu', at: [-2.2, f1 + 0.95, -5.6], color: '#FFD49A', reach: 4.8, power: 0.9 },
  { room: 'vaiku', at: [3.85, f1 + 1.2, -5.7], color: '#FFE6B0', reach: 4.2, power: 0.75 },
  { room: 'vaiku', at: [4.55, f1 + 0.8, -0.6], color: '#FFC98A', reach: 3.0, power: 0.7 },
  { room: 'garazas', at: [-6.75, g0 + 2.45, -2.6], color: '#FFF0D0', reach: 4.6, power: 0.8 },
  { room: 'vonia', at: [6.65, f0 + 2.15, -4.95], color: '#FFEBC8', reach: 3.6, power: 0.8 },
];

// The yard: deck, sandbox, beds, greenhouse, the apple tree with its swing,
// the doghouse, and the path and drive that cross the lawn.
export const YARD = {
  terrace: { x0: -4.4, x1: 0.9, z0: 0.5, z1: 3.05, top: f0 - 0.04 },
  terraceTable: [-1.75, f0 - 0.04, 1.75, 0],
  frontDoor: [3.75, f0, 0.5, 0],
  // The porch before the front door, a bench on it, and a step down to the path
  porch: { x0: 3.0, x1: 5.4, z0: 0.5, z1: 1.3, step: 0.4 },
  sandbox: { x: 2.95, z: 5.9, size: 2.1, yaw: 0.12 },
  // The beds keep a path's width from the bathroom's wall, the compost
  // beyond the last of them
  beds: [
    { x: 9.25, z: -3.6, w: 1.1, l: 2.7 },
    { x: 10.75, z: -3.6, w: 1.1, l: 2.7 },
    { x: 12.25, z: -3.6, w: 1.1, l: 2.7 },
  ],
  compost: { x: 13.5, z: -1.0, yaw: -0.3 },
  greenhouse: { x: 11.4, z: -7.9, w: 2.6, l: 3.4, yaw: 0.06 },
  doghouse: { x: -3.2, z: 6.9, yaw: 0.55 },
  apple: { x: 9.1, z: 3.6 },
  swing: { x: 7.75, z: 4.55, yaw: 0.35, hang: 2.55 },
  mailbox: { x: 3.95, z: 11.0, yaw: 0.1 },
  gate: { x: 2.65, z: 11.55, width: 1.3, yaw: 0.08 },
  clothesline: { from: [-10.5, -0.6], to: [-10.75, -5.0] },
  // Firewood stacked under a little roof beside the drive, facing the house
  woodpile: { x: -9.75, z: 2.2, yaw: Math.PI / 2, length: 2.4 },
  // A birdhouse on a pole by the beds, a children's goal on the far lawn
  birdhouse: { x: 6.2, z: -1.4 },
  goal: { x: 12.6, z: 3.4, yaw: -Math.PI / 2 },
  rainBarrel: { x: 9.75, z: -6.9 },
  // Where the year leaves its mark on the lawn: a snowman in winter, the
  // paddling pool in summer, a pile of raked leaves in autumn, Easter eggs
  // hidden in the grass in spring
  snowman: { x: 6.1, z: 7.7 },
  sled: { x: 7.2, z: 8.5, yaw: 0.6 },
  pool: { x: 6.3, z: 7.6, r: 0.9 },
  leafPile: { x: 5.9, z: 2.3 },
  eggs: [
    [8.3, 5.7],
    [9.9, 4.5],
    [6.9, 3.2],
    [10.5, 2.6],
    [5.7, 5.0],
    [7.6, 6.4],
  ],
  // Paving slabs from the gate to the front door, as [x, z]
  path: [
    [2.65, 11.8],
    [2.9, 10.2],
    [3.3, 8.6],
    [4.9, 7.0],
    [4.4, 4.2],
    [3.9, 2.0],
    [3.75, 0.7],
  ],
  // The hopscotch chalked on a paved square by the path
  hopscotch: { x: 1.2, z: 9.0, yaw: -0.15 },
  // The drive from the garage door to the rim
  drive: { x0: -8.55, x1: -4.95, z0: 0.5, z1: 13.5 },
};

export const TREES = {
  birches: [
    { x: -1.6, z: -9.6, h: 7.4, lean: 0.05 },
    { x: 3.2, z: -10.3, h: 6.8, lean: -0.06 },
    { x: 14.6, z: 3.8, h: 6.2, lean: 0.08 },
  ],
  spruces: [
    { x: -12.4, z: -7.2, h: 6.6 },
    { x: -14.6, z: -3.4, h: 5.4 },
    { x: -9.4, z: -10.2, h: 5.8 },
    { x: 7.0, z: -10.4, h: 5.0 },
    { x: -15.2, z: 0.6, h: 4.4 },
  ],
  // Lilacs by the fence, a currant row by the beds, round box bushes by the terrace
  bushes: [
    { x: 14.2, z: -3.6, r: 1.15, kind: 'lilac' },
    { x: -12.8, z: 5.6, r: 1.2, kind: 'lilac' },
    { x: 13.2, z: 8.2, r: 1.0, kind: 'lilac' },
    { x: 7.4, z: -0.4, r: 0.55, kind: 'currant' },
    { x: 9.1, z: -0.3, r: 0.5, kind: 'currant' },
    { x: 10.8, z: -0.4, r: 0.55, kind: 'currant' },
    { x: -4.9, z: 3.6, r: 0.42, kind: 'box' },
    { x: 1.4, z: 3.4, r: 0.42, kind: 'box' },
    { x: -11.2, z: 9.4, r: 0.9, kind: 'lilac' },
    { x: 6.6, z: 10.2, r: 0.8, kind: 'currant' },
  ],
};

// Gentle swells that keep the lawn from being flat, away from the house
export const KNOLLS = [
  { x: 10.5, z: 6.5, r: 5.5, h: 0.32 },
  { x: -12.0, z: -3.0, r: 5.0, h: 0.36 },
  { x: 2.0, z: 9.6, r: 4.0, h: 0.18 },
];

// Ground the lawn keeps bare, as [x, z, half-length, half-width, yaw]
export const CLEARINGS = [
  [(YARD.terrace.x0 + YARD.terrace.x1) / 2, (YARD.terrace.z0 + YARD.terrace.z1) / 2, (YARD.terrace.x1 - YARD.terrace.x0) / 2 + 0.1, (YARD.terrace.z1 - YARD.terrace.z0) / 2 + 0.1, 0],
  [YARD.sandbox.x, YARD.sandbox.z, YARD.sandbox.size / 2 + 0.05, YARD.sandbox.size / 2 + 0.05, YARD.sandbox.yaw],
  ...YARD.beds.map((b) => [b.x, b.z, b.w / 2 + 0.08, b.l / 2 + 0.08, Math.PI / 2]),
  [YARD.greenhouse.x, YARD.greenhouse.z, YARD.greenhouse.w / 2 + 0.1, YARD.greenhouse.l / 2 + 0.1, YARD.greenhouse.yaw + Math.PI / 2],
  [YARD.doghouse.x, YARD.doghouse.z, 0.55, 0.5, YARD.doghouse.yaw],
  [YARD.compost.x, YARD.compost.z, 0.55, 0.55, YARD.compost.yaw],
];

// The seven areas and their spots: where each marker floats and how the camera
// looks at it. An area's view frames the whole room (`target`, a turn from the
// home azimuth or an `azimuth` of its own, a polar angle and a zoom as a share
// of the overview); a spot is looked at from its area's angle, a little closer,
// or from a turn of its own in the area's `turns`.
export const AREAS = {
  virtuve: {
    room: 'virtuve',
    marker: [3.3, f0 + 2.3, -2.2],
    view: { target: [3.25, f0 + 0.7, -3.0], turn: -0.22, polar: 1.0, zoom: 0.3 },
    spots: {
      virykle: [3.85, f0 + 1.25, -5.95],
      kriaukle: [2.62, f0 + 1.2, -5.95],
      saldytuvas: [4.9, f0 + 2.0, -5.9],
      spintele: [1.47, f0 + 2.3, -5.95],
      stalas: [3.05, f0 + 1.05, -2.65],
      palange: [5.15, f0 + 1.45, -2.5],
    },
  },
  svetaine: {
    room: 'svetaine',
    marker: [-1.9, f0 + 2.3, -2.4],
    // From the front: the kitchen's half of the house stays shut, and seen
    // from further right it would stand in front of the stairs and the
    // piano. So it is an azimuth of its own, not a turn: a phone's home view
    // comes from further right, and stands further back. Steep enough to
    // look over the parasol.
    view: { target: [-1.9, f0 + 0.7, -3.1], azimuth: 0.1, polar: 0.85, zoom: 0.33 },
    // The fireplace and the bookshelf face into the room from its left wall,
    // so they are looked at from the right: that far from the kitchen's half,
    // it is not in the way
    turns: { zidinys: 0.15, lentyna: 0.15 },
    spots: {
      sofa: [-2.6, f0 + 1.05, -5.7],
      lentyna: [-4.05, f0 + 2.15, -0.95],
      zidinys: [-3.95, f0 + 1.3, -3.0],
      kilimas: [-1.95, f0 + 0.45, -2.6],
      laiptai: [0.5, f0 + 1.9, -3.0],
      muzika: [-0.65, f0 + 1.4, -5.95],
    },
  },
  vaiku: {
    room: 'vaiku',
    marker: [3.3, f1 + 2.5, -2.6],
    view: { target: [3.25, f1 + 0.6, -3.0], turn: -0.12, polar: 0.98, zoom: 0.3 },
    spots: {
      lova: [3.85, f1 + 0.95, -5.6],
      palapine: [4.55, f1 + 1.65, -0.6],
      zaislai: [5.0, f1 + 1.15, -3.4],
      staliukas: [2.6, f1 + 0.85, -3.0],
      arkliukas: [3.75, f1 + 1.0, -1.35],
      spinta: [1.4, f1 + 1.75, -4.55],
      langas: [2.45, f1 + 2.25, -5.05],
    },
  },
  tevu: {
    room: 'tevu',
    marker: [-1.9, f1 + 2.5, -2.6],
    view: { target: [-1.9, f1 + 0.6, -3.0], turn: -0.6, polar: 0.98, zoom: 0.31 },
    spots: {
      lova: [-2.2, f1 + 0.95, -5.0],
      spinta: [-3.95, f1 + 2.15, -4.65],
      veidrodis: [-4.1, f1 + 1.5, -0.95],
      fotelis: [-3.0, f1 + 1.15, -0.35],
      spintele: [-0.95, f1 + 1.0, -6.0],
      skalbiniai: [-0.55, f1 + 0.75, -0.25],
      balkonas: [-6.4, gd + 1.25, -2.6],
    },
  },
  garazas: {
    room: 'garazas',
    marker: [-6.75, g0 + 2.6, -2.4],
    view: { target: [-6.75, g0 + 0.7, -2.6], turn: -0.75, polar: 1.0, zoom: 0.3 },
    spots: {
      masina: [-6.7, g0 + 1.55, -2.4],
      dviraciai: [-8.5, g0 + 1.15, -0.9],
      darbastalis: [-7.25, g0 + 1.35, -5.9],
      dezes: [-4.75, g0 + 1.95, -3.4],
      irankiai: [-4.85, g0 + 1.3, -0.4],
      roges: [-8.6, g0 + 2.15, -4.4],
    },
  },
  // From the front and the right, over the walls let down on those sides:
  // the bath and the gable stand facing the camera
  vonia: {
    room: 'vonia',
    marker: [6.75, BATH.high + 0.9, -4.9],
    view: { target: [6.6, f0 + 0.8, -4.95], turn: 0.3, polar: 0.95, zoom: 0.26 },
    spots: {
      vonia: [6.5, f0 + 0.95, -5.6],
      praustuvas: [5.62, f0 + 1.5, -4.12],
      puodukas: [7.4, f0 + 0.7, -4.25],
      skalbykle: [7.52, f0 + 1.15, -5.9],
      rankslosciai: [5.62, f0 + 1.45, -5.85],
      lentynele: [6.6, f0 + 1.62, -6.12],
    },
  },
  lauke: {
    room: null,
    marker: [7.6, 4.2, 2.6],
    view: { target: [5.6, 0.8, 2.4], turn: 0.1, polar: 0.92, zoom: 0.58 },
    spots: {
      terasa: [-1.75, f0 + 1.2, 1.75],
      darzas: [10.75, 1.1, -3.6],
      siltnamis: [11.4, 2.7, -7.9],
      smelis: [2.95, 0.95, 5.9],
      obelis: [7.75, 2.1, 4.55],
      takelis: [1.2, 0.75, 9.0],
      budele: [-3.2, 1.4, 6.9],
    },
  },
};

// Camera homes for the overview. Azimuth is measured from +z towards +x.
export const CAMERA = {
  target: [0.6, 2.2, 0.2],
  landscape: { azimuth: 0.42, polar: 1.02 },
  portrait: { azimuth: 0.62, polar: 0.98 },
  fov: 27,
};
