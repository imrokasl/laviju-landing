import * as THREE from './three.js';
import { palette, col } from './palette.js';

// A change of season is told by this many clocks, set in a row across the
// island (an odd number: one of them stands in the middle)
export const CLOCKS = 7;
const row = (make) => Array.from({ length: CLOCKS }, make);

// Uniforms shared by every material in the scene. Updating a value here
// reaches all of them at once.
export const shared = {
  uTime: { value: 0 },
  // xy: wind direction on the ground plane, z: strength, w: seconds of wind (they run fast in a gust)
  uWind: { value: new THREE.Vector4(0.86, 0.51, 1, 1) },
  uRimColor: { value: col(palette.rim).clone() },
  uHazeColor: { value: col(palette.haze).clone() },
  // World heights between which the island's underside melts into the sky
  uHaze: { value: new THREE.Vector2(-1.6, -11.5) },
  // x: pattern scale, y: drift speed, z: strength of the drifting cloud shade
  uCloud: { value: new THREE.Vector3(0.05, 0.012, 0.14) },
  // The painted watercolour wash (set once the textures have loaded)
  uWash: { value: null },

  // ----- The seasons (kept up to date by core/season.js) -----
  // A change of season comes over the island with the wind, so what changes
  // is told once for every clock, from the one that stands where the change
  // arrives last to the one where it arrives first. With the year at rest
  // they all agree.
  // x: leaves turned to their autumn colour, y: leaves fallen, z: spring freshness, w: blossom
  uLeaf: { value: row(() => new THREE.Vector4(0, 0, 0, 0)) },
  // x: grass gone dry, y: grass freshly green, z: fallen leaves on the ground, w: how tall the grass stands
  uGround: { value: row(() => new THREE.Vector4(0, 0, 0, 1)) },
  // x: how much snow lies on whatever faces the sky, y: how far the water has frozen
  uWinter: { value: row(() => new THREE.Vector2(0, 0)) },
  // Where a spot stands in that crossing: upwind is ahead (xy scale the ground plane, z is the middle)
  uSweep: { value: new THREE.Vector3(-0.86 / 34, -0.51 / 34, 0.5) },
  uGrassDry: { value: new THREE.Color('#D2C27C') },
  uGrassFresh: { value: new THREE.Color('#F2F7A6') },
  // The colour of snow in the sun and in the shade
  uSnowColor: { value: new THREE.Color('#F4F8FF') },
  uSnowShade: { value: new THREE.Color('#B9CBEE') },
  // Seconds of current, and how far the creek stands above its usual level (metres)
  uFlow: { value: 0 },
  uLevel: { value: 0 },
  // How wet the rain has left things, 0..1: it dries more slowly than it falls
  uWet: { value: 0 },
  // Mist lying on the low ground. x: how thick it lies, y: the height by which
  // it has thinned to nothing (metres), zw: how far the wind has carried its drifts
  uMist: { value: new THREE.Vector4(0, 3.4, 0, 0) },

  // ----- The hours (kept up to date by core/season.js) -----
  // What is white by day, mist among it, and no brighter than the rest by night
  uPale: { value: new THREE.Color('#FFFFFF') },
  // How far the sun, or by night the moon, is out, 0..1: nothing lies in a
  // shadow while the one has set and the other is still to come
  uLamp: { value: 1 },
};

const NOISE_GLSL = /* glsl */ `
float creekHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float creekNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(creekHash(i), creekHash(i + vec2(1.0, 0.0)), u.x),
    mix(creekHash(i + vec2(0.0, 1.0)), creekHash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float creekFbm(vec2 p) {
  return creekNoise(p) * 0.6 + creekNoise(p * 2.13 + 7.1) * 0.28 + creekNoise(p * 4.31 - 3.7) * 0.12;
}
`;

export const noiseGLSL = NOISE_GLSL;

// Mist lies on the ground in drifts, thickest by the water and thinning
// upwards, so that the crowns of the trees stand clear of it. It belongs to
// the top of the island: the rock below hangs in the open air. Whatever is
// drawn takes its share of it by its own height. Needs the noise above.
export const mistGLSL = /* glsl */ `
uniform vec4 uMist;
uniform vec3 uPale;
vec3 creekMisted( vec3 colour, vec3 air, vec3 world ) {
  if ( uMist.x < 0.002 ) return colour;
  float low = ( 1.0 - smoothstep( 0.2, uMist.y, world.y ) ) * smoothstep( -2.6, -0.5, world.y );
  float drift = creekNoise( world.xz * 0.13 + uMist.zw ) * 0.7 + creekNoise( world.xz * 0.37 - uMist.zw * 1.7 + 3.1 ) * 0.3;
  return mix( colour, mix( air, uPale, 0.5 ), uMist.x * low * ( 0.3 + 1.1 * smoothstep( 0.22, 0.8, drift ) ) );
}
`;

// The watercolour wash every painted surface shares: broad pigment pooling and
// a finer bloom, both read from world space so neighbouring objects agree.
const WASH_PARS = /* glsl */ `
uniform sampler2D uWash;
float creekWash( vec2 uv ) {
  return 0.74 + 0.36 * texture2D( uWash, uv * 0.085 ).r + 0.2 * texture2D( uWash, uv * 0.31 + 0.37 ).r;
}
`;

// The year as it stands at a spot on the island. A change of season comes
// over with the wind: every value is told by a row of clocks, from where the
// change arrives last to where it arrives first, and a spot reads it between
// the two clocks it stands between. For either stage of a shader; a vertex
// shader asks at the spot a thing stands on, so that the thing changes whole.
const YEAR_GLSL = /* glsl */ `
#ifndef CREEK_YEAR
#define CREEK_YEAR
#define CREEK_CLOCKS ${CLOCKS}
uniform vec3 uSweep;
uniform vec4 uLeaf[ CREEK_CLOCKS ];
uniform vec4 uGround[ CREEK_CLOCKS ];
uniform vec2 uWinter[ CREEK_CLOCKS ];
// How far ahead a spot is, 0..1. The front is ragged, never a ruled line.
float creekAhead( vec2 xz ) {
  float ragged = sin( xz.x * 0.31 + xz.y * 0.17 ) * sin( xz.y * 0.27 - xz.x * 0.13 + 1.7 )
    + 0.5 * sin( xz.x * 0.83 - xz.y * 0.59 + 0.6 ) * sin( xz.y * 0.71 + xz.x * 0.43 );
  return clamp( dot( xz, uSweep.xy ) + uSweep.z + ragged * 0.09, 0.0, 1.0 );
}
// Where a spot stands among the clocks. x: the clock behind it, y: its share of the one ahead
vec2 creekClock( vec2 xz ) {
  float along = creekAhead( xz ) * float( CREEK_CLOCKS - 1 );
  float behind = min( floor( along ), float( CREEK_CLOCKS - 2 ) );
  return vec2( behind, along - behind );
}
// What a row of clocks says there
#define creekOf( clocks, at ) mix( clocks[ int( at.x ) ], clocks[ int( at.x ) + 1 ], at.y )
// x: turned, y: fallen, z: fresh, w: blossom
vec4 creekLeafAt( vec2 xz ) {
  vec2 at = creekClock( xz );
  return creekOf( uLeaf, at );
}
// x: dry, y: fresh, z: fallen leaves, w: height of the grass
vec4 creekGroundAt( vec2 xz ) {
  vec2 at = creekClock( xz );
  return creekOf( uGround, at );
}
// x: snow, y: ice
vec2 creekWinterAt( vec2 xz ) {
  vec2 at = creekClock( xz );
  return creekOf( uWinter, at );
}
#endif
`;

export const yearGLSL = YEAR_GLSL;

// What the seasons do to any painted surface: grass that dries to straw or
// comes up yellow-green, and snow that settles on whatever faces the sky.
const SEASON_PARS = /* glsl */ `
${YEAR_GLSL}
uniform vec3 uGrassDry;
uniform vec3 uGrassFresh;
uniform vec3 uSnowColor;
uniform vec3 uSnowShade;
// ground: the year of the spot, which a fragment shader has as creekGround
vec3 creekGrass( vec3 c, vec4 ground ) {
  float l = dot( c, vec3( 0.26, 0.6, 0.14 ) );
  c = mix( c, uGrassDry * ( l * 1.9 + 0.08 ), ground.x );
  return c * mix( vec3( 1.0 ), uGrassFresh * 1.12, ground.y );
}
`;

export const seasonGLSL = SEASON_PARS;

let softShadowsInstalled = false;

// three's PCF filter takes 5 taps, which shows as grain once the penumbra is
// wide. The creek wants long, soft storybook shadows, so the filter is widened
// to a Vogel disc with more taps.
export function installSoftShadows(taps = 16) {
  if (softShadowsInstalled) return;
  softShadowsInstalled = true;

  const chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  const fiveTaps = /shadow = \(\s*texture\( shadowMap, vec3\( shadowCoord\.xy \+ vogelDiskSample\( 0, 5, phi \)[\s\S]*?\) \* 0\.2;/;

  if (!fiveTaps.test(chunk)) {
    console.warn('[creek] shadow filter patch skipped: three.js shader chunk changed');
    return;
  }

  THREE.ShaderChunk.shadowmap_pars_fragment = chunk.replace(
    fiveTaps,
    `shadow = 0.0;
				for ( int i = 0; i < ${taps}; i ++ ) {
					shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, ${taps}, phi ) * radius, shadowCoord.z ) );
				}
				shadow /= ${taps}.0;`
  );
}

const glslFloat = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);

// How much of the frame's contact shade grass takes, blade and turf alike: a
// meadow shaded blade by blade would only go dull
export const GRASS_SHADE = 0.4;
// ...and how little of the rain shows on it: a wet meadow is hardly darker than a dry one
export const GRASS_WET = 0.3;

/**
 * The one material every solid thing in the scene is painted with: a Lambert
 * base with a soft two-tone light ramp, a sky-tinted rim, drifting cloud shade,
 * optional wind sway and a height haze. Hooks let a caller add its own GLSL.
 *
 * hooks.vertexPars / vertexLocal / vertexWorld / fragmentPars /
 * fragmentAlbedo / fragmentFinal are GLSL snippets:
 *   vertexLocal  — may change `transformed` (object space)
 *   vertexWorld  — may change `creekWorld` (world space)
 *   fragmentAlbedo — may change `diffuseColor` before lighting, and may read the
 *     year of the spot: `creekGround` (dry, fresh, fallen leaves, height of the
 *     grass) and `creekWinter` (snow, ice); and may say how snow takes to the
 *     spot: `creekSnowTake` (0 keeps it off) and `creekSnowLift` (above 0 lets
 *     it lie on steeper ground, as where it drifts up against something); and
 *     how readily rain soaks into it: `creekWet`
 *   fragmentFinal  — may change `outgoingLight` after lighting
 *
 * `shade` is how much of the finishing pass's contact shade (its ambient
 * occlusion) the surface takes. It travels in the alpha of the frame, which
 * nothing solid has another use for; a hook may change it as `creekShade`.
 *
 * `wet` is how readily rain soaks in: what it wets goes darker and deeper in
 * colour, and takes a sheen. `thin` is for cloth, paper and wings: the share
 * of the sun that comes through a sheet lit from behind.
 */
export function stylized({
  color = 0xffffff,
  vertexColors = true,
  side = THREE.FrontSide,
  flatShading = false,
  ramp = 0.55,
  wrap = 0,
  rim = 0.2,
  sway = false,
  cloud = true,
  wash = 0,
  snow = 1,
  glow = 0,
  thin = 0,
  wet = 1,
  shade = 1,
  keepNormals = false,
  hooks = {},
  uniforms = {},
  name = '',
  ...rest
} = {}) {
  const material = new THREE.MeshLambertMaterial({ color, vertexColors, side, flatShading, ...rest });
  material.name = name;

  const defines = [
    `#define CREEK_RAMP ${glslFloat(ramp)}`,
    `#define CREEK_WRAP ${glslFloat(wrap)}`,
    `#define CREEK_RIM ${glslFloat(rim)}`,
    sway ? '#define CREEK_SWAY' : '',
    cloud ? '#define CREEK_CLOUD' : '',
    wash > 0 ? `#define CREEK_WASH ${glslFloat(wash)}` : '',
    snow > 0 ? `#define CREEK_SNOW ${glslFloat(snow)}` : '',
    glow > 0 ? `#define CREEK_GLOW ${glslFloat(glow)}` : '',
    thin > 0 ? `#define CREEK_THIN ${glslFloat(thin)}` : '',
    `#define CREEK_WET ${glslFloat(wet)}`,
    `#define CREEK_SHADE ${glslFloat(shade)}`,
    keepNormals ? '#define CREEK_KEEP_NORMALS' : '',
  ].join('\n');

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
${defines}
uniform float uTime;
uniform vec4 uWind;
varying vec3 vWorldPos;
#ifdef CREEK_SWAY
  attribute float sway;
#endif
${hooks.vertexPars || ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${hooks.vertexLocal || ''}`
      )
      .replace(
        '#include <project_vertex>',
        `vec4 creekWorld = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
  creekWorld = instanceMatrix * creekWorld;
#endif
creekWorld = modelMatrix * creekWorld;
#ifdef CREEK_SWAY
  {
    float swPhase = dot( creekWorld.xz, uWind.xy ) * 0.42 - uWind.w * 1.25;
    float swGust = sin( swPhase ) * 0.55 + sin( swPhase * 2.17 + 1.3 ) * 0.3 + sin( swPhase * 4.3 + creekWorld.z * 0.8 ) * 0.15;
    float swAmount = sway * uWind.z;
    creekWorld.xz += uWind.xy * ( swGust * 0.5 + 0.35 ) * swAmount;
    creekWorld.y += sin( swPhase * 1.7 + creekWorld.x ) * 0.22 * swAmount;
  }
#endif
${hooks.vertexWorld || ''}
vWorldPos = creekWorld.xyz;
vec4 mvPosition = viewMatrix * creekWorld;
gl_Position = projectionMatrix * mvPosition;`
      )
      .replace('#include <worldpos_vertex>', 'vec4 worldPosition = creekWorld;');

    const lambertPars = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
      /float dotNL = saturate\( dot\( geometryNormal, directLight\.direction \) \);\s*vec3 irradiance = dotNL \* directLight\.color;/,
      `float dotNL = dot( geometryNormal, directLight.direction );
	float creekLit = smoothstep( - CREEK_WRAP, CREEK_RAMP, dotNL ) * ( 0.84 + 0.16 * saturate( dotNL ) );
	#ifdef CREEK_THIN
		// Cloth and paper let the light through when it falls on their far side
		creekLit = max( creekLit, CREEK_THIN * smoothstep( - CREEK_WRAP, CREEK_RAMP, - dotNL ) * ( 0.84 + 0.16 * saturate( - dotNL ) ) );
	#endif
	vec3 irradiance = creekLit * directLight.color;`
    );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${defines}
uniform float uTime;
uniform vec3 uRimColor;
uniform vec3 uHazeColor;
uniform vec2 uHaze;
uniform vec3 uCloud;
uniform float uWet;
varying vec3 vWorldPos;
${NOISE_GLSL}
${mistGLSL}
${WASH_PARS}
${SEASON_PARS}
${hooks.fragmentPars || ''}`
      )
      .replace('#include <lights_lambert_pars_fragment>', lambertPars)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
// How much of this fragment lies under snow (a hook may set it too), and how
// readily snow settles on it (a hook may lower that)
float creekSnow = 0.0;
float creekSnowTake = 1.0;
// ...and how much steeper than usual it may lie, where it drifts up against something
float creekSnowLift = 0.0;
float creekShade = CREEK_SHADE;
// How readily rain soaks into the spot
float creekWet = CREEK_WET;
// The year as it stands on this spot
vec2 creekHere = creekClock( vWorldPos.xz );
vec4 creekGround = creekOf( uGround, creekHere );
vec2 creekWinter = creekOf( uWinter, creekHere );
#ifdef CREEK_WASH
  // The shear keeps the wash from streaking down vertical faces
  diffuseColor.rgb *= mix( 1.0, creekWash( vWorldPos.xz + vWorldPos.y * vec2( 0.7, 0.45 ) ), CREEK_WASH );
#endif
${hooks.fragmentAlbedo || ''}
{
  // Rain darkens what soaks it up, and deepens its colour
  float creekTone = max( dot( diffuseColor.rgb, vec3( 0.3, 0.5, 0.2 ) ), 0.04 );
  diffuseColor.rgb *= mix( vec3( 1.0 ), min( vec3( 1.0 ), 0.56 + 0.26 * diffuseColor.rgb / creekTone ), uWet * creekWet * ( 1.0 - creekSnow ) );
}`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
#if defined( CREEK_KEEP_NORMALS ) && ! defined( FLAT_SHADED )
  // Foliage cards are lit by the canopy's shape, whichever way they face
  normal = normalize( vNormal );
#endif
#ifdef CREEK_SNOW
  if ( creekWinter.x > 0.002 ) {
    // Snow lies on what faces the sky, and creeps over the edge as it deepens
    float snowUp = dot( normal, viewMatrix[ 1 ].xyz );
    float snowGrain = texture2D( uWash, vWorldPos.xz * 0.23 + vWorldPos.y * 0.13 ).r;
    creekSnow = smoothstep( 0.0, 0.2, snowUp - 0.4 + creekSnowLift + ( creekWinter.x - 1.0 ) * 1.3 + ( snowGrain - 0.5 ) * 0.5 ) * min( 1.0, CREEK_SNOW ) * creekSnowTake;
    diffuseColor.rgb = mix( diffuseColor.rgb, uSnowColor, creekSnow );
  }
#endif`
      )
      .replace(
        '#include <opaque_fragment>',
        `#ifdef CREEK_CLOUD
  {
    float cloudShade = creekFbm( vWorldPos.xz * uCloud.x + vec2( uTime * uCloud.y, uTime * uCloud.y * 0.55 ) );
    outgoingLight *= 1.0 - uCloud.z * smoothstep( 0.42, 0.72, cloudShade );
  }
#endif
  // Snow in the shade keeps the blue of the sky instead of going grey
  outgoingLight = mix( outgoingLight, max( outgoingLight, uSnowShade ), creekSnow * 0.85 );
  {
    float creekFresnel = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 3.0 );
    // What is wet throws back more of the sky
    outgoingLight += uRimColor * creekFresnel * CREEK_RIM * ( 1.0 + 1.6 * uWet * creekWet );
  }
#if defined( CREEK_GLOW ) && NUM_DIR_LIGHTS > 0
  {
    // Leaves and blades seen against the sun let some of its light through
    float creekBack = pow( saturate( dot( geometryViewDir, - directionalLights[ 0 ].direction ) ), 3.0 );
    outgoingLight += diffuseColor.rgb * directionalLights[ 0 ].color * ( creekBack * CREEK_GLOW * ( 1.0 - creekSnow ) );
  }
#endif
${hooks.fragmentFinal || ''}
#include <opaque_fragment>
#ifdef OPAQUE
  // Snow lies smooth over whatever is under it, and takes the shade in full
  gl_FragColor.a = mix( creekShade, 1.0, creekSnow );
#endif`
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
gl_FragColor.rgb = creekMisted( gl_FragColor.rgb, uHazeColor, vWorldPos );
gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, smoothstep( uHaze.x, uHaze.y, vWorldPos.y ) * 0.92 );`
      );
  };

  // Materials that differ only in their GLSL must not share a compiled program.
  const key = [name, ramp, wrap, rim, sway, cloud, wash, snow, glow, thin, wet, shade, keepNormals, hashString(Object.entries(hooks).flat().join('|'))].join(':');
  material.customProgramCacheKey = () => key;

  return material;
}

function hashString(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/**
 * The shadow of a mesh whose vertex hooks move it: a depth material that
 * repeats the same `vertexPars` and `vertexLocal`, so leaves that have fallen
 * and flowers that have not come up cast nothing. Assign the result to
 * `mesh.customDepthMaterial`.
 */
export function shadowOf({ hooks = {}, uniforms = {}, map = null, alphaTest = 0, name = '' } = {}) {
  const material = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking, map, alphaTest });
  material.name = `shadow-${name}`;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec4 uWind;
${hooks.vertexPars || ''}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
${hooks.vertexLocal || ''}`
      );
  };
  const key = `shadow:${name}:${alphaTest}:${hashString(Object.entries(hooks).flat().join('|'))}`;
  material.customProgramCacheKey = () => key;
  return material;
}


// A plain unlit material that still fades into the scene's haze: used for
// glows, sprites and other painted-on details.
export function unlit(params = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: false, ...params });
}
