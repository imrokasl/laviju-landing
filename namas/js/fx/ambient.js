import * as THREE from '../core/three.js';
import { clamp, createRng, ease } from '../core/math.js';
import { shared } from '../core/materials.js';
import { season } from '../core/season.js';
import { brand, col } from '../core/palette.js';
import { ISLAND } from '../world/layout.js';
import { OVER_LAYER } from './post.js';

// The air over the garden: smoke from the chimney while the fire is lit,
// pollen drifting in the sun, whatever the season sends down (petals,
// leaves), whatever the visitor asks the sky for (rain, snow, mist, the
// strokes of the wind, the fireflies of a summer evening), and the rainbow
// that draws itself across the sky once every place has been found.

const PUFF_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, lifetime in seconds, size in metres, opacity
attribute vec3 aDrift; // metres travelled over one lifetime
uniform float uTime;
uniform float uPixels; // half the height of the drawing buffer
varying float vAlpha;
void main() {
  float age = fract( uTime / aSeed.y + aSeed.x );
  vec3 p = position + aDrift * age;
  // A puff billows sideways as it thins
  p.x += sin( uTime * 0.55 + aSeed.x * 41.0 ) * 0.16 * age;
  p.z += cos( uTime * 0.47 + aSeed.x * 23.0 ) * 0.16 * age;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSeed.z * ( 0.4 + age ) * projectionMatrix[ 1 ][ 1 ] * uPixels / - mv.z;
  vAlpha = smoothstep( 0.0, 0.2, age ) * ( 1.0 - smoothstep( 0.4, 1.0, age ) ) * aSeed.w;
}
`;

// Pollen, and with `uBlink` at 1 fireflies: the same wandering, but a light
// that is out most of the time and comes on slowly.
const MOTE_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, pace, size in metres, twinkle rate
uniform float uTime;
uniform float uPixels;
uniform float uMinSize;
uniform float uBlink;
varying float vAlpha;
void main() {
  float t = uTime * aSeed.y + aSeed.x * 97.0;
  vec3 p = position;
  p.x += sin( t * 0.31 ) * 0.9 + sin( t * 0.13 + 1.7 ) * 0.6;
  p.y += sin( t * 0.23 + 2.1 ) * 0.4;
  p.z += cos( t * 0.27 ) * 0.8 + sin( t * 0.11 + 0.4 ) * 0.5;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  float size = aSeed.z * projectionMatrix[ 1 ][ 1 ] * uPixels / - mv.z;
  gl_PointSize = max( size, uMinSize );
  // A mote smaller than a pixel keeps its light by fading instead of flickering
  float twinkle = 0.5 + 0.5 * sin( uTime * aSeed.w + aSeed.x * 61.0 );
  float lit = mix( 0.25 + 0.75 * twinkle * twinkle, pow( twinkle, 5.0 ), uBlink );
  vAlpha = lit * min( 1.0, size / uMinSize );
}
`;

// Snow: every flake falls through the same tall box of air, over and over,
// wandering as it goes and leaning with the wind.
const SNOW_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, seconds from top to bottom, size in metres, rank
uniform float uTime;
uniform float uPixels;
uniform float uMinSize;
uniform float uAmount;
uniform vec4 uWind;
varying float vAlpha;
varying float vRim;
void main() {
  // The first flakes come alone; the rest join as the snowfall thickens
  float shown = smoothstep( aSeed.w, aSeed.w + 0.12, uAmount );
  float age = fract( uTime / aSeed.y + aSeed.x );
  vec3 p = position;
  p.y -= age * SNOW_FALL;
  float t = uTime * 0.7 + aSeed.x * 53.0;
  p.x += sin( t ) * 0.3 + sin( t * 0.37 + 1.3 ) * 0.5 + uWind.x * uWind.z * age * 3.2;
  p.z += cos( t * 0.81 ) * 0.3 + cos( t * 0.29 ) * 0.5 + uWind.y * uWind.z * age * 3.2;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = shown > 0.0 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
  float size = aSeed.z * projectionMatrix[ 1 ][ 1 ] * uPixels / - mv.z;
  gl_PointSize = max( size, uMinSize );
  // A flake is never let get too small to see: snow that cannot be seen falling is no snowfall
  vAlpha = shown * smoothstep( 0.0, 0.06, age ) * smoothstep( -3.6, -0.8, p.y ) * min( 1.0, 0.6 + 0.4 * size / uMinSize );
  // The nearer and bigger the flake, the less of a rim it needs to be seen
  vRim = clamp( uMinSize * 1.5 / gl_PointSize, 0.0, 1.0 );
}
`;

// A flake has a white heart and a cool rim, so that it shows against the snow
// already lying as well as against the trees. A big one close by is a soft
// tuft with hardly a rim at all: with one it would look like a bubble.
const FLAKE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRim;
uniform float uOpacity;
varying float vAlpha;
varying float vRim;
void main() {
  float d = length( gl_PointCoord - 0.5 ) * 2.0;
  if ( d > 1.0 ) discard;
  float heart = 1.0 - smoothstep( 0.42, 0.9, d );
  float a = 1.0 - smoothstep( mix( 0.2, 0.66, vRim ), 1.0, d );
  gl_FragColor = vec4( mix( mix( uColor, uRim, 0.25 + 0.75 * vRim ), uColor, heart ), a * mix( mix( 0.9, 0.55, vRim ), 1.0, heart ) * vAlpha * uOpacity );
  #include <colorspace_fragment>
}
`;

// Rain: every drop falls through the same tall box of air, over and over, on
// a slant with the wind. A drop is drawn as the streak the eye makes of it: a
// sliver that faces the viewer, a set number of pixels wide.
const RAIN_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, seconds from top to bottom, length in metres, rank
attribute vec2 aCorner; // across the streak (-1 or 1), along it (0 at the head, 1 at the tail)
uniform float uTime;
uniform float uAmount;
uniform vec2 uHalf; // half the drawing buffer, in pixels
uniform float uWidth; // half the width of a streak, in pixels
uniform vec4 uWind;
varying vec2 vStreak;
varying float vAlpha;
void main() {
  // The first drops come alone; the rest join as the shower thickens
  float shown = step( aSeed.w, uAmount );
  float age = fract( uTime / aSeed.y + aSeed.x );
  vec3 way = vec3( uWind.x * uWind.z * RAIN_LEAN, -1.0, uWind.y * uWind.z * RAIN_LEAN );
  vec3 head = position + way * ( age * RAIN_FALL );
  vec4 a = projectionMatrix * viewMatrix * vec4( head, 1.0 );
  vec4 b = projectionMatrix * viewMatrix * vec4( head - way * aSeed.z, 1.0 );
  vec2 along = ( b.xy / b.w - a.xy / a.w ) * uHalf;
  vec2 side = normalize( vec2( - along.y, along.x ) + 1e-5 );
  vec4 p = mix( a, b, aCorner.y );
  p.xy += side * aCorner.x * uWidth / uHalf * p.w;
  gl_Position = shown > 0.0 ? p : vec4( 2.0, 2.0, 2.0, 1.0 );
  vStreak = aCorner;
  vAlpha = shown * smoothstep( 0.0, 0.04, age ) * smoothstep( -3.6, -0.6, head.y );
}
`;

const RAIN_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vStreak;
varying float vAlpha;
void main() {
  // Bright at the head, thinning out behind it
  float a = ( 1.0 - vStreak.x * vStreak.x ) * ( 1.0 - vStreak.y ) * ( 1.3 - vStreak.y );
  gl_FragColor = vec4( uColor, a * vAlpha * uOpacity );
  #include <colorspace_fragment>
}
`;

// Wind is drawn the way a brush would draw it: a pale stroke that runs
// downwind, turns a loop on its way and is gone. Each stroke is a ribbon that
// faces the viewer; where it runs is a curve worked out here, and the ribbon
// is the stretch of that curve the stroke has reached.
const GUST_VERTEX = /* glsl */ `
attribute vec2 aArc; // along the stroke (0 at its head, 1 at its tail), across it (-1 or 1)
attribute vec4 aSeed; // phase, seconds for one pass, metres it runs, metres across its loop
attribute vec3 aOrigin; // where it sets out
uniform float uTime; // seconds of wind
uniform float uAmount;
uniform vec2 uHalf; // half the drawing buffer, in pixels
uniform float uWidth; // the least a stroke is wide, in pixels
uniform vec4 uWind;
varying float vAlpha;
varying float vAcross;

vec3 gustAt( float s, vec3 from ) {
  vec3 down = vec3( uWind.x, 0.0, uWind.y );
  vec3 p = from + down * ( s * aSeed.z );
  p.y += sin( s * 5.1 + from.x * 1.7 ) * 0.24;
  // The loop: once round a circle that stands on the stroke's own line
  float a = smoothstep( 0.4, 0.72, s ) * 6.28318;
  return p + down * ( sin( a ) * aSeed.w ) + vec3( 0.0, ( 1.0 - cos( a ) ) * aSeed.w, 0.0 );
}

void main() {
  // Every pass sets out from a little way off the last, so no two are alike
  float turn = uTime / aSeed.y + aSeed.x;
  float lap = floor( turn );
  vec3 from = aOrigin;
  from.x += ( fract( sin( lap * 12.9898 + aSeed.x * 78.233 ) * 43758.5453 ) - 0.5 ) * 7.0;
  from.z += ( fract( sin( lap * 39.3468 + aSeed.x * 11.135 ) * 24634.6345 ) - 0.5 ) * 7.0;
  from.y += ( fract( sin( lap * 73.1563 + aSeed.x * 27.619 ) * 13758.1147 ) - 0.5 ) * 1.4;
  // The head runs the whole way and the tail follows it out; then a pause.
  // What of the ribbon is not on the curve yet, or has left it, waits at
  // the curve's end with nothing to show.
  float s = fract( turn ) * GUST_RUN - aArc.x * GUST_TAIL;
  float on = clamp( s, 0.0, 1.0 );
  vec4 a = projectionMatrix * viewMatrix * vec4( gustAt( on, from ), 1.0 );
  vec4 b = projectionMatrix * viewMatrix * vec4( gustAt( on + 0.012, from ), 1.0 );
  vec2 along = ( b.xy / b.w - a.xy / a.w ) * uHalf;
  vec2 side = normalize( vec2( - along.y, along.x ) + 1e-5 );
  // Widest in the middle of the stroke, a point at either end
  float body = sin( aArc.x * 3.14159 );
  float wide = max( GUST_WIDE * projectionMatrix[ 1 ][ 1 ] * uHalf.y / a.w, uWidth ) * ( 0.25 + 0.75 * body );
  a.xy += side * aArc.y * wide / uHalf * a.w;
  // The first strokes come alone; the rest join as the wind gets up
  float shown = smoothstep( aSeed.x * 0.7, aSeed.x * 0.7 + 0.25, uAmount );
  gl_Position = shown > 0.0 ? a : vec4( 2.0, 2.0, 2.0, 1.0 );
  vAcross = aArc.y;
  vAlpha = shown * body * smoothstep( 0.0, 0.1, s ) * smoothstep( 1.0, 0.82, s );
}
`;

const GUST_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
varying float vAcross;
void main() {
  gl_FragColor = vec4( uColor, ( 1.0 - vAcross * vAcross ) * vAlpha * uOpacity );
  #include <colorspace_fragment>
}
`;

// Mist: wide, faint veils lying low, that the wind moves along
const VEIL_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, seconds for one drift, size in metres, opacity
attribute vec3 aDrift; // metres travelled over one drift
uniform float uTime;
uniform float uPixels;
uniform float uAmount;
varying float vAlpha;
void main() {
  float age = fract( uTime / aSeed.y + aSeed.x );
  float there = sin( age * 3.14159 );
  vec3 p = position + aDrift * ( age - 0.5 );
  p.y += sin( uTime * 0.21 + aSeed.x * 37.0 ) * 0.1;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSeed.z * ( 0.8 + 0.3 * there ) * projectionMatrix[ 1 ][ 1 ] * uPixels / - mv.z;
  vAlpha = there * aSeed.w * uAmount;
}
`;

// Leaves and petals: each lets go of its crown, flutters down on the wind,
// lies where it lands for a moment and is gone.
const FALL_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, seconds for one round, size in metres, rank
attribute vec3 aDrift; // metres travelled on the way down
attribute float aKind; // which leaf of the sheet (or which colour of petal)
uniform float uTime;
uniform float uPixels;
uniform float uMinSize;
uniform float uAmount;
varying float vAlpha;
varying vec3 vSprite; // kind, spin, how flat it is seen
void main() {
  float shown = smoothstep( aSeed.w, aSeed.w + 0.1, uAmount );
  float age = fract( uTime / aSeed.y + aSeed.x );
  float fall = min( age / FALL_SHARE, 1.0 );
  // In the air until it lands
  float air = 1.0 - smoothstep( 0.9, 1.0, fall );
  float t = fall * aSeed.y * FALL_SHARE;
  float ph = aSeed.x * 61.0;
  vec3 p = position + aDrift * vec3( fall, fall * ( 0.55 + 0.45 * fall ), fall );
  // The side-to-side rocking of anything flat that falls
  float rock = sin( t * 2.2 + ph );
  p.x += rock * 0.3 * air * FALL_ROCK;
  p.z += cos( t * 1.7 + ph * 1.3 ) * 0.26 * air * FALL_ROCK;
  p.y += ( 1.0 - rock * rock ) * 0.07 * air * FALL_ROCK;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = shown > 0.0 ? projectionMatrix * mv : vec4( 2.0, 2.0, 2.0, 1.0 );
  float size = aSeed.z * projectionMatrix[ 1 ][ 1 ] * uPixels / - mv.z;
  gl_PointSize = max( size, uMinSize );
  // It turns as it falls and comes to rest lying flat, seen at a slant
  float turns = t * ( 1.1 + fract( ph ) * 1.4 );
  vSprite = vec3( aKind, ph + turns, mix( 0.5, 0.3 + 0.7 * abs( cos( turns * 1.7 + ph ) ), air ) );
  vAlpha = shown * smoothstep( 0.0, 0.05, age ) * ( 1.0 - smoothstep( FALL_SHARE + 0.14, FALL_SHARE + 0.3, age ) ) * min( 1.0, size / uMinSize );
}
`;

const LEAF_FRAGMENT = /* glsl */ `
uniform sampler2D uSheet;
uniform vec3 uPale;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vSprite;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  q.y /= vSprite.z;
  float cs = cos( vSprite.y );
  float sn = sin( vSprite.y );
  q = vec2( q.x * cs - q.y * sn, q.x * sn + q.y * cs ) * 1.42 + 0.5;
  if ( q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0 ) discard;
  vec2 cell = vec2( mod( vSprite.x, 4.0 ), floor( vSprite.x * 0.25 ) );
  vec4 leaf = texture2D( uSheet, ( cell + q ) * 0.25 );
  if ( leaf.a < 0.3 ) discard;
  // Unlit, like all that falls: the hour dims it instead
  gl_FragColor = vec4( leaf.rgb * 0.97 * uPale, leaf.a * vAlpha * uOpacity );
  #include <colorspace_fragment>
}
`;

const PETAL_FRAGMENT = /* glsl */ `
uniform vec3 uWhite;
uniform vec3 uPink;
uniform float uOpacity;
varying float vAlpha;
varying vec3 vSprite;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  q.y /= vSprite.z;
  float cs = cos( vSprite.y );
  float sn = sin( vSprite.y );
  q = vec2( q.x * cs - q.y * sn, q.x * sn + q.y * cs );
  // A petal: an oval with one end drawn to a point
  float d = length( q * vec2( 1.0, 1.7 + q.x * 1.6 ) ) * 2.0;
  float a = 1.0 - smoothstep( 0.72, 1.0, d );
  if ( a < 0.02 ) discard;
  vec3 c = mix( uWhite, uPink, step( 0.5, vSprite.x ) ) * ( 0.94 + 0.12 * q.x );
  gl_FragColor = vec4( c, a * vAlpha * uOpacity );
  #include <colorspace_fragment>
}
`;

const SOFT_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float d = dot( q, q ) * 4.0;
  float a = exp( - d * FALLOFF ) * ( 1.0 - smoothstep( 0.6, 1.0, d ) );
  gl_FragColor = vec4( uColor, a * vAlpha * uOpacity );
  #include <colorspace_fragment>
}
`;

const BOW_VERTEX = /* glsl */ `
attribute vec2 aArc; // along the bow 0..1, across it 0 (inside) .. 1 (outside)
varying vec2 vArc;
varying vec3 vWorldPos;
void main() {
  vArc = aArc;
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const BOW_FRAGMENT = /* glsl */ `
uniform vec3 uBands[ 6 ];
uniform sampler2D uWash;
uniform float uShow;
uniform float uFade;
uniform float uTime;
uniform vec3 uPale;
varying vec2 vArc;
varying vec3 vWorldPos;
void main() {
  float t = vArc.y;
  vec3 c = mix( uBands[ 0 ], uBands[ 1 ], smoothstep( 0.1, 0.28, t ) );
  c = mix( c, uBands[ 2 ], smoothstep( 0.28, 0.45, t ) );
  c = mix( c, uBands[ 3 ], smoothstep( 0.45, 0.62, t ) );
  c = mix( c, uBands[ 4 ], smoothstep( 0.62, 0.78, t ) );
  c = mix( c, uBands[ 5 ], smoothstep( 0.78, 0.94, t ) );

  // Soft edges, a brush that runs dry here and there, and both ends lost in
  // haze: one at the back of the garden, one under the island
  float across = smoothstep( 0.0, 0.22, t ) * smoothstep( 1.0, 0.78, t );
  float wash = texture2D( uWash, vec2( vArc.x * 5.0 + 0.13, t * 0.5 + uTime * 0.004 ) ).r;
  float ends = smoothstep( 0.0, 0.07, vArc.x ) * smoothstep( 1.0, 0.8, vArc.x );
  // It is painted in from the garden, like the line under the title
  float drawn = 1.0 - smoothstep( uShow * 1.2 - 0.2, uShow * 1.2, vArc.x );
  float low = smoothstep( -3.4, -0.6, vWorldPos.y );
  float alpha = across * ends * drawn * low * ( 0.62 + 0.38 * wash ) * 0.84 * uFade;

  // By night it is a moonbow, as pale as the hour
  gl_FragColor = vec4( c * uPale * ( 0.96 + 0.1 * wash ), alpha );
  #include <colorspace_fragment>
}
`;

function points(count, fill, { kinds = false } = {}) {
  const position = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  const drift = new Float32Array(count * 3);
  const kind = kinds ? new Float32Array(count) : null;
  for (let i = 0; i < count; i++) fill(i, position, seed, drift, kind);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aDrift', new THREE.BufferAttribute(drift, 3));
  if (kind) g.setAttribute('aKind', new THREE.BufferAttribute(kind, 1));
  return g;
}

export function createAmbient(renderer, { field, quality, textures, crowns = [], chimney = null, reducedMotion = false }) {
  const group = new THREE.Group();
  group.name = 'ambient';
  const rng = createRng(77);
  const uPixels = { value: 400 };
  const uMinSize = { value: 2 };

  // What falls and drifts is not lit by anything: it is as white as the hour
  // lets white be. Each such colour is its own to repaint (the ones `col`
  // hands out are shared), and keeps what it is by day beside it.
  const hourly = [];
  const white = (hex) => {
    const colour = col(hex).clone();
    hourly.push([colour, col(hex)]);
    return colour;
  };

  const soft = (vertexShader, color, falloff, extra = {}) =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: SOFT_FRAGMENT,
      uniforms: { uTime: shared.uTime, uPixels, uColor: { value: col(color).clone() }, uOpacity: { value: 1 }, ...extra },
      defines: { FALLOFF: falloff.toFixed(2) },
      transparent: true,
      depthWrite: false,
    });

  // ---------- Smoke from the chimney ----------
  // Whenever the fire in the living room is lit: soft puffs that rise, swell
  // and lean away on the wind
  let smoke = null;
  if (chimney) {
    const wind = shared.uWind.value;
    const count = Math.round(24 * quality.density + 10);
    const geometry = points(count, (i, position, seed, drift) => {
      position.set([chimney.x + rng.range(-0.08, 0.08), chimney.y + rng.range(0, 0.08), chimney.z + rng.range(-0.08, 0.08)], i * 3);
      // Their turns spread evenly round the cycle, so the column never breaks
      seed.set([(i + rng.range(0, 0.6)) / count, rng.range(5.5, 7.5), rng.range(0.45, 0.85), rng.range(0.32, 0.55)], i * 4);
      const far = rng.range(1.4, 3.0);
      drift.set([wind.x * far + rng.range(-0.3, 0.3), rng.range(2.4, 3.6), wind.y * far + rng.range(-0.3, 0.3)], i * 3);
    });
    smoke = new THREE.Points(geometry, soft(PUFF_VERTEX, '#FFFFFF', 2.2));
    smoke.material.uniforms.uColor.value = white('#E9EDF5');
    smoke.name = 'chimney-smoke';
    smoke.frustumCulled = false;
    smoke.renderOrder = 6;
    smoke.visible = false;
    group.add(smoke);
  }

  // ---------- Pollen in the sun ----------
  let motes = null;
  {
    const count = Math.round(90 * quality.density);
    const geometry = points(count, (i, position, seed) => {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = rng.range(-ISLAND.halfX, ISLAND.halfX) * 0.92;
        z = rng.range(-ISLAND.halfZ, ISLAND.halfZ) * 0.92;
        if (field.edge(x, z) > 0.12) break;
      }
      position.set([x, Math.max(field.height(x, z), 0) + rng.range(0.5, 4.2), z], i * 3);
      seed.set([rng(), rng.range(0.5, 1.1), rng.range(0.05, 0.1), rng.range(0.7, 2.2)], i * 4);
    });
    motes = new THREE.Points(geometry, soft(MOTE_VERTEX, '#FFF4D2', 3.4, { uMinSize, uBlink: { value: 0 } }));
    motes.material.uniforms.uOpacity.value = 0.85;
    motes.name = 'pollen';
    motes.frustumCulled = false;
    motes.renderOrder = 6;
    group.add(motes);
  }

  // ---------- Fireflies ----------
  // Low over the grass on a summer evening, and through the
  // night after it. Each is a light
  // brighter than anything the sun still lights, so that it glows, and it is
  // added to the picture rather than laid over it, as light is.
  const uGlowMin = { value: 4 };
  const fireflies = (() => {
    // Their own lot of numbers, so that nothing else in the air is moved by them
    const rng = createRng(53);
    const count = Math.round(34 * quality.density + 10);
    const geometry = points(count, (i, position, seed) => {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = rng.range(-ISLAND.halfX, ISLAND.halfX) * 0.86;
        z = rng.range(-ISLAND.halfZ, ISLAND.halfZ) * 0.86;
        if (field.edge(x, z) > 0.2) break;
      }
      position.set([x, Math.max(field.height(x, z), field.level(x, z)) + rng.range(0.6, 1.9), z], i * 3);
      seed.set([rng(), rng.range(0.45, 0.9), rng.range(0.24, 0.36), rng.range(0.8, 1.5)], i * 4);
    });
    const material = soft(MOTE_VERTEX, '#FFFFFF', 3.4, { uMinSize: uGlowMin, uBlink: { value: 1 } });
    material.uniforms.uColor.value.setRGB(2.5, 2.9, 0.85);
    material.blending = THREE.AdditiveBlending;
    const mesh = new THREE.Points(geometry, material);
    mesh.name = 'fireflies';
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  })();

  // ---------- Snow ----------
  // The box of air reaches out past the rim, so that flakes also pass between
  // the island and whoever is looking at it
  const SNOW = { top: 13.5, fall: 17, out: 7 };
  const uFlakeMin = { value: 3 };
  const snow = (() => {
    const count = Math.round(1500 * quality.density + 260);
    const geometry = points(count, (i, position, seed) => {
      position.set([rng.range(-ISLAND.halfX - SNOW.out, ISLAND.halfX + SNOW.out), SNOW.top + rng.range(0, 1.5), rng.range(-ISLAND.halfZ - SNOW.out, ISLAND.halfZ + SNOW.out)], i * 3);
      // Big flakes are few and fall slowly
      const big = Math.pow(rng(), 2.4);
      seed.set([rng(), rng.range(8.5, 12.5) + big * 4, 0.08 + big * 0.16, rng()], i * 4);
    });
    const material = new THREE.ShaderMaterial({
      vertexShader: SNOW_VERTEX,
      fragmentShader: FLAKE_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uPixels,
        uMinSize: uFlakeMin,
        uAmount: { value: 0 },
        uWind: shared.uWind,
        uColor: { value: white('#FFFFFF') },
        uRim: { value: white('#8CA6DC') },
        uOpacity: { value: 0.95 },
      },
      defines: { SNOW_FALL: SNOW.fall.toFixed(1) },
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const flakes = new THREE.Points(geometry, material);
    flakes.layers.set(OVER_LAYER);
    flakes.name = 'snowfall';
    flakes.frustumCulled = false;
    flakes.renderOrder = 7;
    flakes.visible = false;
    group.add(flakes);
    return flakes;
  })();

  // ---------- Rain ----------
  const RAIN = { top: 13.5, fall: 17, out: 4, lean: 0.24 };
  const uHalf = { value: new THREE.Vector2(400, 300) };
  const uStreak = { value: 1 };
  const rain = (() => {
    const count = Math.round(900 * quality.density + 200);
    const position = new Float32Array(count * 4 * 3);
    const seed = new Float32Array(count * 4 * 4);
    const corner = new Float32Array(count * 4 * 2);
    const index = new Uint16Array(count * 6);
    for (let i = 0; i < count; i++) {
      const x = rng.range(-ISLAND.halfX - RAIN.out, ISLAND.halfX + RAIN.out);
      const y = RAIN.top + rng.range(0, 1.5);
      const z = rng.range(-ISLAND.halfZ - RAIN.out, ISLAND.halfZ + RAIN.out);
      const drop = [rng(), rng.range(1.25, 1.8), rng.range(0.5, 1.0), rng()];
      for (let k = 0; k < 4; k++) {
        position.set([x, y, z], (i * 4 + k) * 3);
        seed.set(drop, (i * 4 + k) * 4);
        corner.set([k % 2 ? 1 : -1, k < 2 ? 0 : 1], (i * 4 + k) * 2);
      }
      index.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geometry.setAttribute('aCorner', new THREE.BufferAttribute(corner, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    const material = new THREE.ShaderMaterial({
      name: 'rain',
      vertexShader: RAIN_VERTEX,
      fragmentShader: RAIN_FRAGMENT,
      uniforms: { uTime: shared.uTime, uAmount: { value: 0 }, uHalf, uWidth: uStreak, uWind: shared.uWind, uColor: { value: white('#EEF4FF') }, uOpacity: { value: 0.6 } },
      defines: { RAIN_FALL: RAIN.fall.toFixed(1), RAIN_LEAN: RAIN.lean.toFixed(2) },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.layers.set(OVER_LAYER);
    mesh.name = 'rain';
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  })();

  // ---------- Wind ----------
  // A handful of strokes over the island, each setting out upwind of where it ends
  const gusts = (() => {
    const GUST = { run: 1.75, tail: 0.5, wide: 0.09, segments: 48 };
    const count = Math.round(6 * quality.density + 3);
    const wind = shared.uWind.value;
    // Their own lot of numbers, so that nothing else in the air is moved by them
    const rng = createRng(91);
    const per = (GUST.segments + 1) * 2;
    const arc = new Float32Array(count * per * 2);
    const seed = new Float32Array(count * per * 4);
    const origin = new Float32Array(count * per * 3);
    const index = [];
    for (let i = 0; i < count; i++) {
      const length = rng.range(9, 14);
      // Two in three turn a loop on the way; the rest only rise and dip
      const stroke = [(i + rng()) / count, rng.range(3.4, 5.4), length, rng.chance(0.67) ? rng.range(0.5, 0.95) : 0];
      // Spread over the island, set back so that the middle of the stroke crosses the spot
      const x = rng.range(-ISLAND.halfX, ISLAND.halfX) * 0.72 - wind.x * length * 0.5;
      const z = rng.range(-ISLAND.halfZ, ISLAND.halfZ) * 0.72 - wind.y * length * 0.5;
      const from = [x, rng.range(1.8, 5.2), z];
      for (let k = 0; k <= GUST.segments; k++) {
        for (let side = 0; side < 2; side++) {
          const v = i * per + k * 2 + side;
          arc.set([k / GUST.segments, side ? 1 : -1], v * 2);
          seed.set(stroke, v * 4);
          origin.set(from, v * 3);
        }
        if (k < GUST.segments) {
          const v = i * per + k * 2;
          index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    // Where a stroke is drawn is worked out from its curve: the positions only stand in
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * per * 3), 3));
    geometry.setAttribute('aArc', new THREE.BufferAttribute(arc, 2));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geometry.setAttribute('aOrigin', new THREE.BufferAttribute(origin, 3));
    geometry.setIndex(index);
    const material = new THREE.ShaderMaterial({
      name: 'gusts',
      vertexShader: GUST_VERTEX,
      fragmentShader: GUST_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uHalf, uWidth: { value: 1 }, uWind: shared.uWind, uColor: { value: col('#FFFFFF').clone() }, uOpacity: { value: 0.9 } },
      defines: { GUST_RUN: GUST.run.toFixed(2), GUST_TAIL: GUST.tail.toFixed(2), GUST_WIDE: GUST.wide.toFixed(3) },
      transparent: true,
      depthWrite: false,
      depthTest: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.layers.set(OVER_LAYER);
    mesh.name = 'gusts';
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  })();
  // On snow a white stroke would not show: there it is drawn in the blue of snow in the shade
  const gustWarm = col('#FFFFFF');
  const gustCold = col('#9DB4E4');

  // ---------- Mist ----------
  // Low over the lawn and round the house. A veil is far wider than
  // anything it lies among, so it is laid over the picture rather than
  // sorted into it: cut off by the ground, it would show an edge.
  const veils = (() => {
    const wind = shared.uWind.value;
    const count = Math.round(30 * quality.density + 10);
    const geometry = points(count, (i, position, seed, drift) => {
      let x = 0;
      let z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = rng.range(-ISLAND.halfX, ISLAND.halfX) * 0.85;
        z = rng.range(-ISLAND.halfZ, ISLAND.halfZ) * 0.85;
        if (field.edge(x, z) > 1) break;
      }
      position.set([x, field.height(x, z) + rng.range(0.25, 0.9), z], i * 3);
      seed.set([rng(), rng.range(26, 46), rng.range(3.2, 6.4), rng.range(0.09, 0.18)], i * 4);
      const far = rng.range(3, 7);
      drift.set([wind.x * far + rng.range(-1, 1), rng.range(-0.1, 0.25), wind.y * far + rng.range(-1, 1)], i * 3);
    });
    const material = soft(VEIL_VERTEX, '#F6F9FF', 1.5, { uAmount: { value: 0 } });
    material.uniforms.uColor.value = white('#F6F9FF');
    material.depthTest = false;
    const mesh = new THREE.Points(geometry, material);
    mesh.name = 'mist';
    mesh.frustumCulled = false;
    mesh.renderOrder = 8;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  })();

  // ---------- What the crowns let go of ----------
  // A drawn lot: a crown is picked by its size, a point on its underside is
  // where the leaf lets go, and the wind decides where it comes down.
  const falling = (name, sources, count, { size, seconds, reach, share, rock, fragmentShader, uniforms, kindOf }) => {
    if (!sources.length || count <= 0) return null;
    const weights = sources.map((c) => c.r * c.r);
    const total = weights.reduce((a, b) => a + b, 0);
    const wind = shared.uWind.value;
    const geometry = points(
      count,
      (i, position, seed, drift, kind) => {
        let pick = rng() * total;
        let c = sources[0];
        for (let k = 0; k < sources.length; k++) {
          pick -= weights[k];
          if (pick <= 0) {
            c = sources[k];
            break;
          }
        }
        // Out at the skirt of the lump, where a leaf can be seen all the way down
        const a = rng.range(0, Math.PI * 2);
        const d = c.r * rng.range(0.72, 1.04);
        const x = c.x + Math.cos(a) * d;
        const z = c.z + Math.sin(a) * d;
        const y = c.y - rng.range(-0.15, 0.6) * c.r;
        // Carried downwind, further the longer the fall
        const far = rng.range(reach[0], reach[1]) * Math.max(0.4, y / 4);
        const dx = wind.x * far + rng.range(-0.5, 0.5);
        const dz = wind.y * far + rng.range(-0.5, 0.5);
        const ground = Math.max(field.height(x + dx, z + dz), field.level(x + dx, z + dz)) + 0.04;
        position.set([x, y, z], i * 3);
        drift.set([dx, Math.min(-0.2, ground - y), dz], i * 3);
        seed.set([rng(), rng.range(seconds[0], seconds[1]), rng.range(size[0], size[1]), rng()], i * 4);
        kind[i] = kindOf(c);
      },
      { kinds: true }
    );
    const material = new THREE.ShaderMaterial({
      vertexShader: FALL_VERTEX,
      fragmentShader,
      uniforms: { uTime: shared.uTime, uPixels, uMinSize, uAmount: { value: 0 }, uOpacity: { value: 1 }, ...uniforms },
      defines: { FALL_SHARE: share.toFixed(2), FALL_ROCK: rock.toFixed(2) },
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Points(geometry, material);
    mesh.name = name;
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    mesh.visible = false;
    group.add(mesh);
    return mesh;
  };
  const leaves = textures?.leaves
    ? falling('falling-leaves', crowns, Math.round(120 * quality.density + 28), {
        size: [0.22, 0.36],
        seconds: [7, 12],
        reach: [0.5, 1.9],
        share: 0.56,
        rock: 1,
        fragmentShader: LEAF_FRAGMENT,
        uniforms: { uSheet: { value: textures.leaves }, uPale: shared.uPale },
        // A leaf from the column of the sheet that belongs to this kind of tree
        kindOf: (c) => c.sheds + 4 * Math.floor(rng() * 4),
      })
    : null;
  const petals = falling(
    'falling-petals',
    crowns.filter((c) => c.blossom),
    Math.round(44 * quality.density + 12),
    {
      size: [0.07, 0.11],
      seconds: [6, 10],
      reach: [1.6, 4.2],
      share: 0.66,
      rock: 0.7,
      fragmentShader: PETAL_FRAGMENT,
      uniforms: { uWhite: { value: white('#FFFDF8') }, uPink: { value: white('#F9C3D2') } },
      kindOf: (c) => (c.blossom > 1 ? 1 : 0),
    }
  );

  // ---------- The rainbow ----------
  // One foot stands at the back of the garden, the other is lost below the
  // far rim. The band lies in the vertical plane through both, over the roof.
  const bow = (() => {
    const from = new THREE.Vector3(-13.2, 0.3, -6.8);
    const to = new THREE.Vector3(16.6, -3.2, -8.9);
    const length = Math.hypot(to.x - from.x, to.z - from.z);
    const rise = to.y - from.y;
    const sink = 1.4; // how far below the near foot the circle's centre lies
    const cu = (length * length + rise * rise + 2 * rise * sink) / (2 * length);
    const radius = Math.hypot(cu, sink);
    const width = radius * 0.135;
    const a0 = Math.atan2(sink, -cu);
    const a1 = Math.atan2(rise + sink, length - cu);

    const segments = 120;
    const position = new Float32Array((segments + 1) * 2 * 3);
    const arc = new Float32Array((segments + 1) * 2 * 2);
    const index = [];
    for (let i = 0; i <= segments; i++) {
      const k = i / segments;
      const a = a0 + (a1 - a0) * k;
      for (let side = 0; side < 2; side++) {
        const r = radius + (side - 0.5) * width;
        position.set([Math.cos(a) * r, Math.sin(a) * r, 0], (i * 2 + side) * 3);
        arc.set([k, side], (i * 2 + side) * 2);
      }
      if (i < segments) index.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aArc', new THREE.BufferAttribute(arc, 2));
    geometry.setIndex(index);

    const material = new THREE.ShaderMaterial({
      name: 'rainbow',
      vertexShader: BOW_VERTEX,
      fragmentShader: BOW_FRAGMENT,
      uniforms: {
        // Inside to outside, in the site's own pastels
        uBands: { value: [brand.lilac.dot, brand.sky.dot, brand.sage.dot, brand.butter.dot, brand.peach.dot, '#EE8F7C'].map((hex) => col(hex)) },
        uWash: shared.uWash,
        uShow: { value: 0 },
        uFade: { value: 0 },
        uTime: shared.uTime,
        uPale: shared.uPale,
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'rainbow';
    const ux = (to.x - from.x) / length;
    const uz = (to.z - from.z) / length;
    mesh.position.set(from.x + ux * cu, from.y - sink, from.z + uz * cu);
    mesh.rotation.y = Math.atan2(-uz, ux);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, apex: new THREE.Vector3(mesh.position.x, mesh.position.y + radius + width / 2, mesh.position.z) };
  })();

  let showing = false;
  let shown = 0;
  let fade = 0;

  // What is in the air follows the year and the hour; what is not there is not drawn
  function dress() {
    const v = season.v;
    for (const [colour, byDay] of hourly) colour.copy(byDay).multiply(season.hues.pale);
    if (motes) {
      motes.material.uniforms.uOpacity.value = 0.85 * v.pollen;
      motes.visible = v.pollen > 0.01;
    }
  }
  dress();

  // `revealed`: how far the picture itself has come up on the page, 0..1
  function update(time, dt, revealed = 1) {
    snow.material.uniforms.uOpacity.value = 0.95 * revealed;
    rain.material.uniforms.uOpacity.value = 0.6 * revealed;
    uPixels.value = renderer.domElement.height / 2;
    uMinSize.value = 1.6 * renderer.getPixelRatio();
    uFlakeMin.value = 3.5 * renderer.getPixelRatio();
    uGlowMin.value = 4 * renderer.getPixelRatio();
    uHalf.value.set(renderer.domElement.width / 2, renderer.domElement.height / 2);
    uStreak.value = 0.65 * renderer.getPixelRatio();
    if (season.changed) dress();
    // The weather of the moment
    snow.material.uniforms.uAmount.value = season.snowing;
    snow.visible = season.snowing > 0.002;
    rain.material.uniforms.uAmount.value = season.rain;
    rain.visible = season.rain > 0.004;
    veils.material.uniforms.uAmount.value = season.mist;
    veils.visible = season.mist > 0.004;
    // The strokes of the wind: of the one asked for, and of the gust a change of season comes on
    const blowing = Math.max(season.windy, 0.75 * season.turning);
    gusts.material.uniforms.uAmount.value = blowing;
    gusts.material.uniforms.uTime.value = season.gusts;
    gusts.material.uniforms.uWidth.value = 1.5 * renderer.getPixelRatio();
    gusts.material.uniforms.uOpacity.value = 0.9 * revealed;
    gusts.material.uniforms.uColor.value.copy(gustWarm).lerp(gustCold, season.v.snow).multiply(season.hues.pale);
    gusts.visible = blowing > 0.004;
    // The fireflies come out as the light goes, are out all night, and sit out the rain
    const dark = Math.min(1, season.dusk + season.night);
    const alight = clamp((dark - 0.55) / 0.4, 0, 1) * season.v.fireflies * (1 - 0.9 * season.rain);
    fireflies.material.uniforms.uOpacity.value = alight * revealed;
    fireflies.visible = alight > 0.004;
    if (smoke) {
      // The fire is lit on winter and autumn days, and every evening
      const fire = Math.max(dark, season.v.setWinter * 0.85, season.v.setAutumn * 0.5);
      smoke.material.uniforms.uOpacity.value = fire * revealed;
      smoke.visible = fire > 0.01;
    }
    // A wind shakes more loose from the crowns than falls by itself
    const shaken = 1 + 0.9 * season.windy;
    if (leaves) {
      leaves.material.uniforms.uAmount.value = season.v.leavesFalling * shaken;
      leaves.visible = season.v.leavesFalling > 0.002;
    }
    if (petals) {
      petals.material.uniforms.uAmount.value = season.v.petalsFalling * shaken;
      petals.visible = season.v.petalsFalling > 0.002;
    }
    if (showing && shown < 1) {
      shown = clamp(shown + dt / (reducedMotion ? 0.01 : 3.4), 0, 1);
      bow.material.uniforms.uShow.value = ease.inOutSine(shown);
    }
    // The bow of a finished season fades when the island moves on to another
    const want = showing ? 1 : 0;
    if (fade !== want) {
      fade = clamp(fade + (want > fade ? 1 : -1) * (dt / (reducedMotion ? 0.01 : 1.2)), 0, 1);
      bow.material.uniforms.uFade.value = fade;
      if (fade === 0) {
        bow.mesh.visible = false;
        shown = 0;
        bow.material.uniforms.uShow.value = 0;
      }
    }
  }

  return {
    group,
    update,
    rainbowTop: bow.apex,
    // Every place of the season has been found; `false` when the island moves
    // on to a season that still has places to find
    celebrate(on = true) {
      if (on === showing) return;
      showing = on;
      if (on) bow.mesh.visible = true;
    },
  };
}
