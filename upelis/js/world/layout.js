// Where everything stands. One place to move a tree, bend the creek or shift a
// hotspot; the field, the models and the UI all read from here.
// Units are metres. +x is right, +z is towards the default camera, +y is up.

export const ISLAND = {
  halfX: 16,
  halfZ: 12,
  // 0 = a rectangle, 1 = an ellipse
  roundness: 0.82,
};

// Creek centreline from the spring to the rim. Per point:
// half-width, water level, bed depth, bank slope on the near (left of flow)
// and far (right of flow) side.
export const CREEK = [
  { x: -11.7, z: -6.9, w: 0.55, level: 1.3, bed: 0.22, near: 0.9, far: 1.1 },
  { x: -10.1, z: -6.0, w: 0.75, level: 1.3, bed: 0.26, near: 0.7, far: 0.9 },
  { x: -8.5, z: -5.0, w: 0.95, level: 1.3, bed: 0.3, near: 0.7, far: 0.9 },
  { x: -7.3, z: -4.05, w: 0.9, level: 1.28, bed: 0.2, near: 1.2, far: 1.3 }, // lip of the fall
  { x: -6.35, z: -3.2, w: 1.2, level: 0, bed: 0.5, near: 1.3, far: 1.4 }, // foot of the fall
  { x: -5.0, z: -2.25, w: 1.75, level: 0, bed: 0.62, near: 0.5, far: 0.9 },
  { x: -3.0, z: -1.6, w: 1.3, level: 0, bed: 0.3, near: 0.3, far: 0.45 }, // stepping stones
  { x: -0.8, z: -0.9, w: 1.9, level: 0, bed: 0.5, near: 0.24, far: 0.5 },
  { x: 1.6, z: 0.2, w: 2.7, level: 0, bed: 0.78, near: 0.13, far: 0.42 }, // the pool
  { x: 3.9, z: 1.6, w: 2.15, level: 0, bed: 0.6, near: 0.2, far: 0.5 },
  { x: 5.6, z: 3.4, w: 1.3, level: 0, bed: 0.42, near: 0.55, far: 0.6 }, // bridge
  { x: 6.6, z: 5.4, w: 1.25, level: -0.02, bed: 0.36, near: 0.5, far: 0.5 },
  { x: 8.0, z: 7.2, w: 1.4, level: -0.08, bed: 0.3, near: 0.42, far: 0.45 },
  { x: 9.9, z: 8.6, w: 1.55, level: -0.16, bed: 0.26, near: 0.4, far: 0.4 },
  { x: 12.6, z: 10.2, w: 1.65, level: -0.22, bed: 0.24, near: 0.4, far: 0.4 }, // past the rim
];

// Index of the control point at the lip of the upper waterfall.
export const FALL_LIP = 3;
// The falling sheet: its width as a share of the creek's, and the stone on the
// lip that parts it (how far across, -1 far bank .. 1 near bank, and the
// share of the sheet it holds back to either side).
export const FALL = { sheet: 0.84, stone: 0.36, gap: 0.2 };

// The rocky rise the spring comes out of: a plateau along this spine.
export const HILL = {
  from: [-13.6, -8.4],
  to: [-7.9, -4.6],
  height: 1.42,
  inner: 2.5,
  outer: 6.0,
};

// Gentle mounds that keep the meadow from being flat.
export const KNOLLS = [
  { x: -8.6, z: 4.8, r: 4.6, h: 0.42 }, // under the oak
  { x: 11.3, z: 3.0, r: 4.8, h: 0.3 }, // meadow
  { x: 10.6, z: -4.2, r: 4.2, h: 0.36 }, // birch grove
  { x: 2.0, z: -7.5, r: 4.5, h: 0.26 },
];

// Trodden path: picnic → bridge → beach → oak.
export const PATH = [
  [11.6, -2.6],
  [9.6, -0.7],
  [8.2, 1.3],
  [7.25, 2.2], // far bridgehead
  [3.95, 4.6], // near bridgehead
  [2.4, 5.9],
  [-0.6, 6.5],
  [-3.6, 5.6],
  [-6.4, 5.2],
];

export const BRIDGE = { from: [7.25, 2.2], to: [3.95, 4.6], width: 1.25 };

export const TREES = {
  oak: { x: -8.7, z: 4.9 },
  birches: [
    { x: 11.9, z: -4.5, h: 6.6, lean: 0.06 },
    { x: 9.3, z: -5.9, h: 5.6, lean: -0.05 },
    { x: 13.0, z: -1.9, h: 5.0, lean: 0.09 },
  ],
  spruces: [
    { x: -13.0, z: -4.4, h: 5.2 },
    { x: -11.0, z: -9.0, h: 6.4 },
    { x: -8.3, z: -8.6, h: 5.4 },
    { x: -5.6, z: -8.4, h: 4.2 },
    { x: -13.9, z: -7.0, h: 4.4 },
  ],
  willow: { x: 4.3, z: -3.9 },
  bushes: [
    { x: -2.6, z: -5.6, r: 1.0 },
    { x: -1.2, z: -6.4, r: 0.7 },
    { x: 6.4, z: -6.9, r: 1.05 },
    { x: -13.2, z: 1.2, r: 1.1 },
    { x: -12.4, z: 2.6, r: 0.7 },
    { x: 13.6, z: 6.0, r: 0.95 },
    { x: 2.6, z: 9.2, r: 0.9 },
    { x: -10.6, z: 8.2, r: 1.0 },
    { x: -4.4, z: -4.9, r: 0.6 },
    { x: 7.9, z: -2.9, r: 0.65 },
    { x: 14.2, z: -4.6, r: 0.8 },
    { x: -0.4, z: 9.9, r: 0.6 },
  ],
};

export const PROPS = {
  log: { x: -4.3, z: 7.9, yaw: 0.95, length: 3.1 },
  hedgehog: { x: -2.4, z: 6.0, yaw: 1.28 },
  picnic: { x: 10.3, z: -2.7, yaw: -0.5 },
  beach: { x: 0.2, z: 3.5 },
  cairn: { x: -0.5, z: 3.9 },
  bucket: { x: 0.9, z: 4.1 },
  boat: { x: 1.9, z: 0.3 },
  stork: { x: -0.3, z: -2.2, yaw: 1.3 },
  kite: { anchor: [11.6, 3.9], x: 12.3, y: 6.7, z: 1.4 },
  steppingStones: { s: 0.0 }, // placed along control point 6, see props
  sign: { x: 8.05, z: 1.75, yaw: -0.7 },

  // The stork has a cartwheel on a pole to come home to
  nest: { x: 0.9, z: -5.6, yaw: 0.4 },

  // ----- What each season brings out -----
  // Spring
  wreath: { x: 10.9, z: 4.6 },
  // Spring and autumn: puddles along the path as [x, z, radius], an umbrella left open
  puddles: [
    [9.1, 0.0, 0.5],
    [2.95, 5.45, 0.42],
    [0.7, 6.3, 0.55],
    [-1.5, 6.3, 0.34],
    [-4.8, 5.45, 0.48],
  ],
  umbrella: { x: 2.5, z: 4.95, yaw: 2.3 },
  // Autumn
  leafPile: { x: -7.6, z: 7.9, yaw: 0.3 },
  // Winter
  snowman: { x: 11.1, z: 4.7, yaw: 0.5 },
  sled: { x: -7.3, z: 8.3, yaw: -1.0 },
  feeder: { x: -1.6, z: -3.9, yaw: 0.5 },
  iceBranch: { x: -1.35, z: 4.45, yaw: 0.4 },
  // A hare crosses the snow in front of the log
  tracks: [
    [1.0, 8.0],
    [-1.5, 8.4],
    [-3.0, 8.9],
    [-4.6, 10.0],
    [-6.8, 9.9],
    [-8.6, 8.9],
  ],
};

// Ground the meadow keeps bare, as [x, z, half-length, half-width, yaw]:
// under the picnic blanket and along the fallen log.
export const CLEARINGS = [
  [PROPS.picnic.x, PROPS.picnic.z, 1.22, 0.92, PROPS.picnic.yaw],
  [PROPS.log.x, PROPS.log.z, 1.5, 0.2, PROPS.log.yaw],
];

// Camera homes for the overview. Azimuth is measured from +z towards +x.
export const CAMERA = {
  target: [0.2, 0.9, 0.4],
  landscape: { azimuth: 0.44, polar: 1.02, fit: 1.0 },
  portrait: { azimuth: 0.98, polar: 0.98, fit: 1.0 },
  fov: 27,
};
