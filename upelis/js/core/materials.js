import * as THREE from './three.js';
import { palette, col } from './palette.js';

// Uniforms shared by every material in the scene. Updating a value here
// reaches all of them at once.
export const shared = {
  uTime: { value: 0 },
  // xy: wind direction on the ground plane, z: strength, w: speed
  uWind: { value: new THREE.Vector4(0.86, 0.51, 1, 1) },
  uRimColor: { value: col(palette.rim).clone() },
  uHazeColor: { value: col(palette.haze).clone() },
  // World heights between which the island's underside melts into the sky
  uHaze: { value: new THREE.Vector2(-1.6, -11.5) },
  // x: pattern scale, y: drift speed, z: strength of the drifting cloud shade
  uCloud: { value: new THREE.Vector3(0.05, 0.012, 0.14) },
  // The painted watercolour wash (set once the textures have loaded)
  uWash: { value: null },
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

// The watercolour wash every painted surface shares: broad pigment pooling and
// a finer bloom, both read from world space so neighbouring objects agree.
const WASH_PARS = /* glsl */ `
uniform sampler2D uWash;
float creekWash( vec2 uv ) {
  return 0.74 + 0.36 * texture2D( uWash, uv * 0.085 ).r + 0.2 * texture2D( uWash, uv * 0.31 + 0.37 ).r;
}
`;

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

/**
 * The one material every solid thing in the scene is painted with: a Lambert
 * base with a soft two-tone light ramp, a sky-tinted rim, drifting cloud shade,
 * optional wind sway and a height haze. Hooks let a caller add its own GLSL.
 *
 * hooks.vertexPars / vertexLocal / vertexWorld / fragmentPars /
 * fragmentAlbedo / fragmentFinal are GLSL snippets:
 *   vertexLocal  — may change `transformed` (object space)
 *   vertexWorld  — may change `creekWorld` (world space)
 *   fragmentAlbedo — may change `diffuseColor` before lighting
 *   fragmentFinal  — may change `outgoingLight` after lighting
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
    float swPhase = dot( creekWorld.xz, uWind.xy ) * 0.42 - uTime * uWind.w * 1.25;
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
varying vec3 vWorldPos;
${NOISE_GLSL}
${WASH_PARS}
${hooks.fragmentPars || ''}`
      )
      .replace('#include <lights_lambert_pars_fragment>', lambertPars)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifdef CREEK_WASH
  // The shear keeps the wash from streaking down vertical faces
  diffuseColor.rgb *= mix( 1.0, creekWash( vWorldPos.xz + vWorldPos.y * vec2( 0.7, 0.45 ) ), CREEK_WASH );
#endif
${hooks.fragmentAlbedo || ''}`
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
#if defined( CREEK_KEEP_NORMALS ) && ! defined( FLAT_SHADED )
  // Foliage cards are lit by the canopy's shape, whichever way they face
  normal = normalize( vNormal );
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
  {
    float creekFresnel = pow( 1.0 - saturate( dot( normal, geometryViewDir ) ), 3.0 );
    outgoingLight += uRimColor * creekFresnel * CREEK_RIM;
  }
${hooks.fragmentFinal || ''}
#include <opaque_fragment>`
      )
      .replace(
        '#include <fog_fragment>',
        `#include <fog_fragment>
gl_FragColor.rgb = mix( gl_FragColor.rgb, uHazeColor, smoothstep( uHaze.x, uHaze.y, vWorldPos.y ) * 0.92 );`
      );
  };

  // Materials that differ only in their GLSL must not share a compiled program.
  const key = [name, ramp, wrap, rim, sway, cloud, wash, keepNormals, hashString(Object.entries(hooks).flat().join('|'))].join(':');
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



// A plain unlit material that still fades into the scene's haze: used for
// glows, sprites and other painted-on details.
export function unlit(params = {}) {
  return new THREE.MeshBasicMaterial({ vertexColors: false, ...params });
}
