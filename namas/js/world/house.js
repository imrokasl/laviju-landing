import * as THREE from '../core/three.js';
import { stylized, yearGLSL } from '../core/materials.js';
import { season } from '../core/season.js';
import { popByThing } from '../core/models.js';
import { clamp, smoothstep } from '../core/math.js';
import { HOUSE, GARAGE, BATH, ROOMS, LAMPS, YARD } from './layout.js';

// The house, as it was modelled in Blender: walls and floors, every room's
// furniture, the terrace and the yard's made things. Seen from outside it is
// a whole house; as the camera comes to a room, the walls between the two
// sink to a low stub and whatever is above the room is lifted off, like the
// front of a doll's house swung open. Where a wall or a floor is cut, its
// inside shows as a clean section the colour of paper.
//
// The cut is told per zone (outside, the house, the garage, the bathroom) and
// per wall or roof slope (front, back, right, left, the two slopes, the partitions): each
// pair has a height above which nothing of it is drawn, and each zone a height
// above which nothing at all is. Every height is kept twice, once for either
// side of the line between the rooms, so a room opens alone and the one
// beside it stays shut. They sink and rise over a moment, so a room opens
// instead of blinking open.
//
// The lamps of the rooms come on at dusk, light the room they stand in and
// nothing beyond its walls, and their windows glow from outside. Things that
// belong to a season come up out of the floor or the ground when it comes.

const ZONES = { outside: 0, house: 1, garage: 2, bath: 3 };
const N_ZONES = 4;
const GROUP = { front: 1, back: 2, right: 3, left: 4, roofFront: 5, roofBack: 6, partition: 7 };
// What a wall of an open room keeps standing, over the floor of the storey looked into
const STUB = 0.5;
// Nothing is drawn above this; a wall that is not cut stands well under it
const TOP = 40;
const SLOTS = N_ZONES * 8;
// The line between the rooms on the left (the living room, the parents' room
// and, past them, the garage) and the rooms on the right (the kitchen, the
// children's room and, past them, the bathroom). Each side is cut on its own.
const SPLIT = HOUSE.split;

const f0 = HOUSE.floor0;
const f1 = HOUSE.floor1;
const ceil0 = f0 + HOUSE.storey;
const tan = Math.tan((HOUSE.pitch * Math.PI) / 180);
const knee = f1 + HOUSE.knee;
const W = HOUSE.wall;

// The lamps that light: one to each lamp of the rooms, then the yard's string
// lights over the terrace, on the balcony and by the front door. Each lights
// what lies in its box and nothing else, so no lamp shines through a wall.
// What glows with a lamp is marked in the model with 1 + its index, and the
// yard's string lights with YARD_GLOW (blender/rooms.py's L_YARD).
const YARD_GLOW = 10;
const pad = 0.03;
const roomBox = (id) => {
  const b = ROOMS[id].box;
  return [b[0] - pad, b[1] - 0.05, b[2] - pad, b[3] + pad, b[4] + 0.6, b[5] + pad];
};
const { terrace, porch } = YARD;
const LIGHTS = [
  ...LAMPS.map((l, i) => ({ ...l, glow: i + 1, box: roomBox(l.room) })),
  { at: [(terrace.x0 + terrace.x1) / 2, terrace.top + 2.0, (terrace.z0 + terrace.z1) / 2], color: '#FFD9A0', reach: 4.2, power: 0.75, glow: YARD_GLOW, box: [terrace.x0 - 0.6, terrace.top - 0.8, terrace.z0 - 0.1, terrace.x1 + 0.6, terrace.top + 2.8, terrace.z1 + 0.8] },
  { at: [(GARAGE.x0 + GARAGE.x1) / 2, GARAGE.deck + 1.6, (GARAGE.z0 + GARAGE.z1) / 2], color: '#FFD9A0', reach: 4.6, power: 0.7, glow: YARD_GLOW, box: [GARAGE.x0 - 0.3, GARAGE.deck - 0.1, GARAGE.z0 - 0.3, GARAGE.x1 + 0.05, GARAGE.deck + 2.6, GARAGE.z1 + 0.3] },
  { at: [YARD.frontDoor[0] + 0.8, f0 + 1.9, HOUSE.z1 + 0.3], color: '#FFD9A0', reach: 2.6, power: 0.7, glow: YARD_GLOW, box: [porch.x0 - 0.8, f0 - 1.2, HOUSE.z1 - 0.02, porch.x1 + 0.8, f0 + 2.6, porch.z1 + porch.step + 1.2] },
];
const N_LIGHTS = LIGHTS.length;
const N_GLOWS = YARD_GLOW + 1;

// What each of the house's materials does over the common paint
const KINDS = {
  solid: { rim: 0.16, wash: 0.5 },
  wood: { rim: 0.12, wash: 0.4 },
  fabric: { rim: 0.1, wash: 0.35, wet: 0.8 },
  plaster: { rim: 0.12, wash: 0.75 },
  roof: { rim: 0.2, wash: 0.5, wet: 0.7 },
  tile: { rim: 0.16, wash: 0.35 },
  decor: { rim: 0.08, wash: 0.25 },
  glass: { rim: 0.6, wash: 0, snow: 0, cloud: false },
  glow: { rim: 0, wash: 0, snow: 0, cloud: false, wet: 0 },
};

// Painted grey sheets, the way each kind of surface lays them on: texture
// coordinates are metres along the piece, its grain running along u
const SURFACE = {
  // Sawn timber: the grain of the wood, and boards on a floor
  wood: /* glsl */ `
    {
      float grain = texture2D( uGrain, vHouseUv * vec2( 0.42, 1.6 ) ).r;
      diffuseColor.rgb *= 0.74 + 0.52 * grain;
      // A floor: something wide and flat, facing up at the level of a storey
      vec3 houseFace = normalize( cross( dFdx( vWorldPos ), dFdy( vWorldPos ) ) );
      float houseFloor = step( 0.95, abs( houseFace.y ) ) * ( step( abs( vWorldPos.y - ${f0.toFixed(3)} ), 0.012 ) + step( abs( vWorldPos.y - ${f1.toFixed(3)} ), 0.012 ) );
      if ( houseFloor > 0.5 ) {
        float boards = texture2D( uPlanks, vHouseUv.yx * 0.8 ).r;
        diffuseColor.rgb *= 0.62 + 0.76 * boards;
      }
    }
  `,
  roof: /* glsl */ `diffuseColor.rgb *= 0.6 + 0.8 * texture2D( uRoof, vHouseUv * 0.17 ).r;`,
  tile: /* glsl */ `diffuseColor.rgb *= 0.66 + 0.68 * texture2D( uTiles, vHouseUv * 0.42 ).r;`,
  fabric: /* glsl */ `diffuseColor.rgb *= 0.84 + 0.32 * texture2D( uWeave, vHouseUv * 2.0 ).r;`,
  // The atlas of painted pictures brings its own colour
  decor: /* glsl */ `diffuseColor.rgb *= texture2D( uDecor, vHouseUv ).rgb * 1.04;`,
};

// Every part of the house knows its zone and its wall (aCut), and the cut
// says how high each zone and wall is drawn: left of the line between the
// rooms (x) and right of it (y). A thing of thin sheets (leaves,
// petals) is marked with 8 over its wall: its backs are its own, never the
// inside of something cut open. Over the zone, 64 for each third of the snow
// a thing out of doors is kept from: all of it under a roof or glass (the
// firewood, the greenhouse's beds), most of it on the balcony's boughs.
const CUT_PARS = /* glsl */ `
  attribute float aCut;
  uniform vec2 uCutY[ ${SLOTS} ];
  uniform vec2 uClip[ ${N_ZONES} ];
  varying vec2 vCutY;
  varying float vZone;
  varying float vSheet;
  varying float vShelter;
`;
const CUT_MOVE = /* glsl */ `
  {
    float shelter = floor( aCut / 64.0 + 0.01 );
    vShelter = shelter / 3.0;
    float cut = aCut - 64.0 * shelter;
    float zone = floor( cut / 16.0 + 0.01 );
    float wall = cut - zone * 16.0;
    vSheet = step( 7.5, wall );
    wall -= 8.0 * vSheet;
    vZone = zone;
    vCutY = min( uCutY[ int( zone * 8.0 + wall + 0.5 ) ], uClip[ int( zone + 0.5 ) ] );
  }
`;

// Things of a season come up out of the floor one by one (see world/kit.js)
const POP_PARS = /* glsl */ `
  ${yearGLSL}
  uniform float uPop[ CREEK_CLOCKS ];
  attribute vec4 aPop;
`;
const POP_MOVE = /* glsl */ `
  {
    vec2 popClock = creekClock( aPop.xz );
    float popNow = creekOf( uPop, popClock );
    float popT = clamp( ( popNow - aPop.w * 0.45 ) / 0.55, 0.0, 1.0 ) - 1.0;
    transformed = mix( aPop.xyz, transformed, 1.0 + 2.70158 * popT * popT * popT + 1.70158 * popT * popT );
  }
`;

const LIGHT_PARS = /* glsl */ `
  uniform vec4 uLightAt[ ${N_LIGHTS} ];
  uniform vec3 uLightColor[ ${N_LIGHTS} ];
  uniform vec3 uLightLo[ ${N_LIGHTS} ];
  uniform vec3 uLightHi[ ${N_LIGHTS} ];
  uniform float uGlow[ ${N_GLOWS} ];
  uniform vec3 uCap;
  // The inside of the house, the garage and the bathroom, where no snow falls
  // and no rain wets: the rooms under the roof's slopes, the garage under its
  // deck and the bathroom under its ceiling
  uniform vec4 uRooms; // x0, z0, x1, z1 inside the walls
  uniform vec4 uRoofIn; // the floor, the knee of the roof, the middle of its ridge, its slope
  uniform vec4 uGarageIn; // x0, z0, x1, z1
  uniform vec2 uGarageY; // its floor and its ceiling
  uniform vec4 uBathIn; // x0, z0, x1, z1
  uniform vec2 uBathY; // its floor and its ceiling
  // How far the sun reaches into the bathroom past the house's shadow, 0..1
  uniform float uSunIn;
  // The bathroom, its walls taken \`grow\` further out
  float houseBath( vec3 p, float grow ) {
    vec4 b = uBathIn + vec4( - grow, - grow, grow, grow );
    float bath = step( b.x, p.x ) * step( p.x, b.z ) * step( b.y, p.z ) * step( p.z, b.w );
    return bath * step( uBathY.x - 0.15, p.y ) * step( p.y, uBathY.y );
  }
  float houseInside( vec3 p ) {
    float rooms = step( uRooms.x, p.x ) * step( p.x, uRooms.z ) * step( uRooms.y, p.z ) * step( p.z, uRooms.w );
    float under = uRoofIn.y + ( ( uRooms.w - uRooms.y ) * 0.5 - abs( p.z - uRoofIn.z ) ) * uRoofIn.w + 0.06;
    rooms *= step( uRoofIn.x - 0.15, p.y ) * step( p.y, under );
    float garage = step( uGarageIn.x, p.x ) * step( p.x, uGarageIn.z ) * step( uGarageIn.y, p.z ) * step( p.z, uGarageIn.w );
    garage *= step( uGarageY.x - 0.15, p.y ) * step( p.y, uGarageY.y );
    return max( max( rooms, garage ), houseBath( p, 0.0 ) );
  }
  // The light of the first \`count\` lamps that reach this spot. \`grow\` widens
  // their boxes: glass stands in the middle of a wall, outside the room
  vec3 houseLamps( vec3 p, vec3 n, int count, float grow ) {
    vec3 sum = vec3( 0.0 );
    for ( int i = 0; i < ${N_LIGHTS}; i ++ ) {
      if ( i >= count ) break;
      vec3 c = uLightColor[ i ];
      if ( c.r + c.g + c.b < 0.002 ) continue;
      vec3 lo = uLightLo[ i ] - grow;
      vec3 hi = uLightHi[ i ] + grow;
      if ( p.x < lo.x || p.x > hi.x || p.y < lo.y || p.y > hi.y || p.z < lo.z || p.z > hi.z ) continue;
      vec3 d = uLightAt[ i ].xyz - p;
      float dist = length( d );
      float fall = 1.0 - smoothstep( 0.0, uLightAt[ i ].w, dist );
      // Lamplight wraps round what it lights: the side away from it is not left black
      float facing = 0.38 + 0.62 * clamp( dot( n, d / max( dist, 0.001 ) ), 0.0, 1.0 );
      // ...and fills the room: bright by the lamp, still warm across the floor
      sum += c * fall * ( 0.3 + 0.7 * fall ) * facing;
    }
    return sum;
  }
  // How lit the room is that this spot stands in, however far from its lamps:
  // a window glows all over with the room behind it
  vec3 houseRoomLight( vec3 p, int count, float grow ) {
    vec3 sum = vec3( 0.0 );
    for ( int i = 0; i < ${N_LIGHTS}; i ++ ) {
      if ( i >= count ) break;
      vec3 lo = uLightLo[ i ] - grow;
      vec3 hi = uLightHi[ i ] + grow;
      if ( p.x < lo.x || p.x > hi.x || p.y < lo.y || p.y > hi.y || p.z < lo.z || p.z > hi.z ) continue;
      sum = max( sum, uLightColor[ i ] );
    }
    return sum;
  }
`;

// The bathroom is built on in the lee of the house, which shades it from noon
// on. Opened, it takes the sun the way a room of the house does once its walls
// are down: inside it the house's shadow lifts as its own walls sink.
const SUN_SHADOW = /(\? )(getShadow\( directionalShadowMap\[ i \][^;]*?\))( : 1\.0;)/;
const SUN_IN = SUN_SHADOW.test(THREE.ShaderChunk.lights_fragment_begin) ? THREE.ShaderChunk.lights_fragment_begin.replace(SUN_SHADOW, '$1mix( $2, 1.0, houseSun )$3') : null;
if (!SUN_IN) console.warn('[house] bathroom sun patch skipped: three.js shader chunk changed');

export function createHouse(model, textures) {
  const group = new THREE.Group();
  group.name = 'house';

  // ---------- The cut ----------
  // Each slot's height and each zone's, left of the line between the rooms and right of it
  const cutY = { value: Array.from({ length: SLOTS }, () => new THREE.Vector2(TOP, TOP)) };
  const clip = { value: Array.from({ length: N_ZONES }, () => new THREE.Vector2(TOP, TOP)) };
  // How open each slot is on each side (left, then right), 0..1, where it is
  // headed, and how high it stands open: the stub over the floor of the
  // storey looked into
  const open = new Float32Array(SLOTS * 2);
  const openTo = new Float32Array(SLOTS * 2);
  const openAt = new Float32Array(SLOTS * 2).fill(f1 + STUB);
  const openAtTo = new Float32Array(SLOTS * 2).fill(f1 + STUB);
  // ...and the same for the lid of each zone: everything over the storey
  // looked into is lifted off, the underside of the ceiling with it (left
  // in, it would show from above as one big section over the whole room).
  // The garage's goes under the balcony's fascia too, which reaches down
  // over the tops of its walls, and the bathroom's under its ceiling.
  const lid = new Float32Array(N_ZONES * 2);
  const lidTo = new Float32Array(N_ZONES * 2);
  const lidAt = [TOP, ceil0 - 0.03, GARAGE.ceiling - 0.12, BATH.ceiling - 0.12];
  // The sun in the bathroom comes with its lid
  const sunIn = { value: 0 };
  // A slot's walls reach this high: it sinks from there, not from the sky
  const tops = [YARD.terrace.top + 3, HOUSE.ridge + 0.5, GARAGE.deck + GARAGE.rail + 0.3, BATH.high + BATH.roof + 0.5];

  // ---------- The lamps ----------
  const lightAt = { value: LIGHTS.map((l) => new THREE.Vector4(l.at[0], l.at[1], l.at[2], l.reach)) };
  const lightColor = { value: LIGHTS.map(() => new THREE.Color(0, 0, 0)) };
  const lightLo = { value: LIGHTS.map((l) => new THREE.Vector3(l.box[0], l.box[1], l.box[2])) };
  const lightHi = { value: LIGHTS.map((l) => new THREE.Vector3(l.box[3], l.box[4], l.box[5])) };
  const glow = { value: new Array(N_GLOWS).fill(0) };
  const hues = LIGHTS.map((l) => new THREE.Color(l.color).multiplyScalar(l.power));

  const common = {
    uCutY: cutY,
    uClip: clip,
    uLightAt: lightAt,
    uLightColor: lightColor,
    uLightLo: lightLo,
    uLightHi: lightHi,
    uGlow: glow,
    uCap: { value: new THREE.Color('#F2E8D8') },
    uRooms: { value: new THREE.Vector4(HOUSE.x0 + W, HOUSE.z0 + W, HOUSE.x1 - W, HOUSE.z1 - W) },
    uRoofIn: { value: new THREE.Vector4(f0, knee, HOUSE.ridgeZ, tan) },
    uGarageIn: { value: new THREE.Vector4(GARAGE.x0 + W, GARAGE.z0 + W, GARAGE.x1, GARAGE.z1 - W) },
    uGarageY: { value: new THREE.Vector2(GARAGE.floor, GARAGE.ceiling) },
    uBathIn: { value: new THREE.Vector4(BATH.x0, BATH.z0 + W, BATH.x1 - W, BATH.z1 - W) },
    uBathY: { value: new THREE.Vector2(f0, BATH.ceiling) },
    uSunIn: sunIn,
    uGrain: { value: textures.woodgrain },
    uPlanks: { value: textures.planks },
    uRoof: { value: textures.roof },
    uTiles: { value: textures.tiles },
    uWeave: { value: textures.fabric },
    uDecor: { value: textures.decor },
  };

  // ---------- Materials ----------
  // One to a kind of surface, a way of lighting (by its faces or smooth) and
  // a season; those of one kind share a program.
  const materials = new Map();
  function material(kind, flat, uPop) {
    const key = `${kind}:${flat}:${uPop ? 'pop' : ''}`;
    if (!uPop && materials.has(key)) return materials.get(key);
    const k = KINDS[kind] || KINDS.solid;
    const glass = kind === 'glass';
    const glowing = kind === 'glow';
    const textured = kind in SURFACE;
    // three declares \`uv\` for every program; a part without it reads zeros
    const vertexPars = [CUT_PARS, uPop ? POP_PARS : '', 'attribute float aLamp; varying float vLamp; varying vec2 vHouseUv;'].join('\n');
    const vertexLocal = [CUT_MOVE, uPop ? POP_MOVE : '', 'vLamp = aLamp;', 'vHouseUv = uv;'].join('\n');
    const fragmentPars = /* glsl */ `
      varying vec2 vCutY;
      varying float vZone;
      varying float vSheet;
      varying float vShelter;
      varying float vLamp;
      varying vec2 vHouseUv;
      uniform sampler2D uGrain;
      uniform sampler2D uPlanks;
      uniform sampler2D uRoof;
      uniform sampler2D uTiles;
      uniform sampler2D uWeave;
      uniform sampler2D uDecor;
      ${LIGHT_PARS}
      float houseIn;
      float houseCap;
      float houseSun;
    `;
    const fragmentAlbedo = /* glsl */ `
      if ( vWorldPos.y > ( vWorldPos.x < ${SPLIT.toFixed(3)} ? vCutY.x : vCutY.y ) ) discard;
      // The inside of a wall or a floor that has been cut: a clean section.
      // The ends left standing beside an open room show through it the same way.
      houseCap = ( ! gl_FrontFacing && min( vCutY.x, vCutY.y ) < ${(TOP - 1).toFixed(1)} && vSheet < 0.5 ) ? 1.0 : 0.0;
      houseIn = houseInside( vWorldPos );
      // Its walls' inner faces stand on the bathroom's edge: a hair more takes them in
      houseSun = uSunIn * houseBath( vWorldPos, 0.01 );
      ${textured ? SURFACE[kind] : ''}
      if ( houseCap > 0.5 ) diffuseColor.rgb = uCap;
      // Indoors no snow settles and no rain wets; out of doors, a sheltered
      // thing takes less of it, or none
      creekSnowTake = ( 1.0 - houseIn ) * ( 1.0 - vShelter );
      creekWet *= 1.0 - houseIn;
    `;
    const fragmentFinal = /* glsl */ `
      {
        vec3 houseN = houseCap > 0.5 ? vec3( 0.0, 1.0, 0.0 ) : inverseTransformDirection( normal, viewMatrix );
        outgoingLight += diffuseColor.rgb * houseLamps( vWorldPos, houseN, ${N_LIGHTS}, 0.0 );
        ${
          glowing
            ? `{
          // A bulb, a candle, a flame: pale by day, and its own light once lit
          float on = uGlow[ int( vLamp + 0.5 ) ];
          outgoingLight = mix( outgoingLight, diffuseColor.rgb * 1.55, on );
        }`
            : ''
        }
        ${
          glass
            ? `{
          // A window glows with the room behind it
          vec3 lit = houseRoomLight( vWorldPos, ${LAMPS.length}, ${(W + 0.08).toFixed(2)} );
          float warm = clamp( dot( lit, vec3( 0.36 ) ), 0.0, 1.0 );
          outgoingLight = mix( outgoingLight, vec3( 1.0, 0.82, 0.55 ) * ( 0.8 + 0.6 * warm ), warm * 0.9 );
          diffuseColor.a = mix( diffuseColor.a, 0.82, warm );
        }`
            : ''
        }
      }
    `;
    const m = stylized({
      name: `house-${kind}`,
      vertexColors: true,
      side: THREE.DoubleSide,
      flatShading: flat,
      rim: k.rim,
      wash: k.wash,
      snow: k.snow ?? 1,
      cloud: k.cloud ?? true,
      wet: k.wet ?? 1,
      ramp: 0.58,
      transparent: glass,
      opacity: glass ? 0.32 : 1,
      depthWrite: !glass,
      uniforms: { ...common, ...(uPop ? { uPop } : {}) },
      hooks: { vertexPars, vertexLocal, fragmentPars, fragmentAlbedo, fragmentFinal },
    });
    const compile = m.onBeforeCompile;
    m.onBeforeCompile = (shader, renderer) => {
      compile(shader, renderer);
      shader.fragmentShader = shader.fragmentShader
        // A section is lit as the top of the wall it cuts through
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n  if ( houseCap > 0.5 ) normal = normalize( viewMatrix[ 1 ].xyz );')
        // Indoors no mist hangs
        .replace('gl_FragColor.rgb = creekMisted( gl_FragColor.rgb, uHazeColor, vWorldPos );', 'if ( houseIn < 0.5 ) gl_FragColor.rgb = creekMisted( gl_FragColor.rgb, uHazeColor, vWorldPos );')
        // The open bathroom takes the sun
        .replace('#include <lights_fragment_begin>', SUN_IN ?? '#include <lights_fragment_begin>');
    };
    if (!uPop) materials.set(key, m);
    return m;
  }

  // What casts a shadow is cut the same way: a wall that has sunk throws none
  const depths = new Map();
  function depth(uPop) {
    const key = uPop ? uPop : 'all';
    if (depths.has(key)) return depths.get(key);
    const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, side: THREE.DoubleSide });
    m.name = 'house-shadow';
    m.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uCutY: cutY, uClip: clip }, uPop ? { uPop } : {});
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          ${CUT_PARS}
          ${uPop ? POP_PARS : ''}
          varying vec2 vHouseAt;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          ${CUT_MOVE}
          ${uPop ? POP_MOVE : ''}
          vHouseAt = ( modelMatrix * vec4( transformed, 1.0 ) ).xy;`
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec2 vCutY;
          varying float vZone;
          varying vec2 vHouseAt;`
        )
        .replace('void main() {', `void main() {\n  if ( vHouseAt.y > ( vHouseAt.x < ${SPLIT.toFixed(3)} ? vCutY.x : vCutY.y ) ) discard;`);
    };
    m.customProgramCacheKey = () => `house-shadow:${uPop ? 'pop' : ''}`;
    depths.set(key, m);
    return m;
  }

  // ---------- The parts ----------
  const TRACKS = {
    spring: (v) => v.setSpring,
    summer: (v) => v.setSummer,
    autumn: (v) => v.setAutumn,
    winter: (v) => v.setWinter,
    // All year but the winter: the washing on the line, the sandbox's toys
    warm: (v) => 1 - v.setWinter,
  };
  const sets = new Map();
  const meshes = [];
  for (const part of model.parts) {
    let uPop = null;
    if (part.season) {
      if (!sets.has(part.season)) sets.set(part.season, { uPop: { value: season.row(0) }, track: TRACKS[part.season] || TRACKS.warm, meshes: [] });
      uPop = sets.get(part.season).uPop;
      popByThing(part.geometry);
    }
    const m = new THREE.Mesh(part.geometry, material(part.material, part.flat, uPop));
    m.name = part.name;
    const see = part.material === 'glass' || part.material === 'glow';
    m.castShadow = !see;
    m.receiveShadow = part.material !== 'glow';
    m.customDepthMaterial = depth(uPop);
    // Glass is drawn after everything it lets through
    if (part.material === 'glass') m.renderOrder = 2;
    // The cut and the seasons move points about, so nothing is passed over for its bounds
    m.frustumCulled = false;
    group.add(m);
    meshes.push(m);
    if (uPop) sets.get(part.season).meshes.push(m);
  }

  // ---------- The year ----------
  function dress() {
    for (const set of sets.values()) {
      const shown = season.across(set.track, set.uPop.value) > 0.004;
      for (const m of set.meshes) m.visible = shown;
    }
  }
  dress();

  // ---------- Which walls the camera looks through ----------
  // The view asks for a room. Walls of its zone that face the camera sink on
  // its side of the line between the rooms, and so does whatever is above.
  // Anything else, `null` among it, is the house from outside, whole: so it
  // stands in the overview, and nothing inside is seen until a room is entered.
  const STATES = { closed: {} };
  for (const [id, room] of Object.entries(ROOMS)) {
    const [x0, floor, , x1] = room.box;
    STATES[id] = {
      [room.zone]: {
        floor,
        // A room downstairs has the storey over it lifted off; upstairs the roof is the lid
        lid: room.floor === 0,
        sides: [...(x0 < SPLIT ? [0] : []), ...(x1 > SPLIT ? [1] : [])],
      },
    };
  }
  let state = STATES.closed;
  const centres = {
    house: new THREE.Vector2((HOUSE.x0 + HOUSE.x1) / 2, (HOUSE.z0 + HOUSE.z1) / 2),
    garage: new THREE.Vector2((GARAGE.x0 + GARAGE.x1) / 2, (GARAGE.z0 + GARAGE.z1) / 2),
    bath: new THREE.Vector2((BATH.x0 + BATH.x1) / 2, (BATH.z0 + BATH.z1) / 2),
  };
  const _d = new THREE.Vector2();

  // `room` is one of ROOMS (see world/layout.js)
  function view(room) {
    state = STATES[room] || STATES.closed;
  }

  function aim(camera) {
    openTo.fill(0);
    lidTo.fill(0);
    for (const zoneName of ['house', 'garage', 'bath']) {
      const want = state[zoneName];
      if (!want) continue;
      const zone = ZONES[zoneName];
      _d.set(camera.position.x, camera.position.z).sub(centres[zoneName]).normalize();
      // Where a wing meets the house it has no wall of its own: the house's
      // gable stands there, and stays
      const facing = [
        [GROUP.front, _d.y > 0.3],
        [GROUP.back, _d.y < -0.3],
        [GROUP.right, _d.x > 0.3 && zoneName !== 'garage'],
        [GROUP.left, _d.x < -0.3 && zoneName !== 'bath'],
        [GROUP.roofFront, _d.y > 0.05],
        [GROUP.roofBack, _d.y < -0.05],
      ];
      for (const side of want.sides) {
        for (const [g, on] of facing) {
          if (!on) continue;
          const i = (zone * 8 + g) * 2 + side;
          openAtTo[i] = want.floor + STUB;
          // A wall that opens from shut opens straight to its height
          if (open[i] < 0.02) openAt[i] = openAtTo[i];
          openTo[i] = 1;
        }
        if (want.lid) lidTo[zone * 2 + side] = 1;
      }
    }
  }

  // ---------- Each frame ----------
  let flicker = 0;
  // How brightly the fire burns, for the sound of it
  let fireNow = 0;
  // Whether a wall is on its way up or down, for the shadows to follow
  let moving = false;
  function update(time, dt, camera) {
    if (season.changed) dress();
    aim(camera);
    moving = false;
    // Walls sink in a little under a second, and rise a touch slower
    for (let i = 0; i < SLOTS * 2; i++) {
      const to = openTo[i];
      if (open[i] !== to) {
        open[i] = to > open[i] ? Math.min(to, open[i] + dt / 0.85) : Math.max(to, open[i] - dt / 1.1);
        moving = true;
      }
      // ...and one already open sinks further, or rises, to the storey now looked into
      if (Math.abs(openAtTo[i] - openAt[i]) > 0.002) {
        openAt[i] += (openAtTo[i] - openAt[i]) * (1 - Math.exp(-dt / 0.3));
        moving = true;
      } else openAt[i] = openAtTo[i];
      const k = smoothstep(0, 1, open[i]);
      const top = tops[Math.floor(i / 16)];
      cutY.value[i >> 1].setComponent(i & 1, k > 0 ? top + (openAt[i] - top) * k : TOP);
    }
    for (let i = 0; i < N_ZONES * 2; i++) {
      const to = lidTo[i];
      if (lid[i] !== to) {
        lid[i] = to > lid[i] ? Math.min(to, lid[i] + dt / 0.85) : Math.max(to, lid[i] - dt / 1.1);
        moving = true;
      }
      const z = i >> 1;
      const k = smoothstep(0, 1, lid[i]);
      clip.value[z].setComponent(i & 1, k > 0 ? tops[z] + (lidAt[z] - tops[z]) * k : TOP);
    }
    sunIn.value = smoothstep(0, 1, Math.max(lid[ZONES.bath * 2], lid[ZONES.bath * 2 + 1]));

    // The lamps: lit from dusk, and on a dark day of rain or mist
    const dark = clamp(season.dusk * 0.9 + season.night + season.dawn * 0.3, 0, 1);
    const rooms = Math.max(dark, season.rain * 0.55, season.mist * 0.35);
    // The fire is lit on winter and autumn days too, and by every evening
    const v = season.v;
    flicker = 0.86 + 0.08 * Math.sin(time * 7.3) + 0.06 * Math.sin(time * 13.1 + 1.3) + 0.04 * Math.sin(time * 23.7);
    fireNow = Math.max(dark, v.setWinter * 0.85, v.setAutumn * 0.5);
    const fire = fireNow * flicker;
    // By night the rooms are the warmest thing there is: their lamps are
    // turned up against the blue of the moonlight
    const indoors = 0.9 + 0.6 * season.night;
    for (let i = 0; i < N_LIGHTS; i++) {
      const l = LIGHTS[i];
      const on = l.fire ? fire : l.glow === YARD_GLOW ? dark : rooms;
      lightColor.value[i].copy(hues[i]).multiplyScalar(on * (l.glow === YARD_GLOW ? 0.9 : indoors));
      glow.value[l.glow] = on;
    }
  }

  // Where the things of the house stand, for the markers and the camera
  return {
    group,
    meshes,
    update,
    view,
    lights: LIGHTS,
    get state() {
      return state;
    },
    get fire() {
      return fireNow;
    },
    get moving() {
      return moving;
    },
  };
}
