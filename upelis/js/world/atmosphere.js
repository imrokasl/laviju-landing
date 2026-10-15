import * as THREE from '../core/three.js';
import { createRng } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized } from '../core/materials.js';
import { season } from '../core/season.js';
import { icoSphere, place, paint, displace, merge } from '../core/geo.js';
import { OVER_LAYER } from '../fx/post.js';
import { ISLAND, CAMERA } from './layout.js';

// Sky, light and the clouds the island floats among, and by night the stars
// and the moon. Where the light comes from and how strong it is are the
// hour's to say: see the lamp in core/season.js.

// Half the width of the moon's card, as the tangent of the angle it is seen
// under: a storybook moon, several times the size of the real one
const MOON_SIZE = 0.024;

const SKY_VERTEX = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  // Rotate with the camera but never move: the dome sits at infinity
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
}
`;

const SKY_FRAGMENT = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uMid;
uniform vec3 uHorizon;
uniform vec3 uLow;
uniform vec3 uDeep;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uMoonDir;
uniform vec3 uPale;
uniform vec3 uOut; // how far the sun is out, how much of its side of the sky it lights, how far the moon is out
uniform sampler2D uWash;
uniform float uTime;
uniform float uRain;
uniform float uMist;
varying vec3 vDir;

void main() {
  vec3 d = normalize( vDir );
  float e = d.y;

  vec3 above = mix( uHorizon, uMid, smoothstep( 0.0, 0.3, e ) );
  above = mix( above, uTop, smoothstep( 0.22, 0.9, e ) );
  vec3 below = mix( uHorizon, uLow, smoothstep( 0.0, -0.4, e ) );
  below = mix( below, uDeep, smoothstep( -0.35, -1.0, e ) );
  vec3 c = e >= 0.0 ? above : below;

  // Warm glow around the sun, which a shower all but puts out
  float s = max( dot( d, uSunDir ), 0.0 );
  float clear = 1.0 - 0.85 * uRain;
  c += uSunColor * ( pow( s, 6.0 ) * 0.1 + pow( s, 64.0 ) * 0.35 ) * uOut.x * clear;
  // Low in the morning and in the evening, it lights the whole of its side of the sky
  c += uSunColor * pow( s, 2.5 ) * uOut.y * clear;
  // The moon hangs in a glow of its own
  float m = max( dot( d, uMoonDir ), 0.0 );
  c += uSunColor * ( pow( m, 36.0 ) * 0.1 + pow( m, 420.0 ) * 0.26 ) * uOut.z * clear;

  // Loose watercolour blooms, anchored to the world so they drift as you orbit
  vec2 uv = vec2( atan( d.x, - d.z ) * 0.55, e * 1.15 );
  float wash = texture2D( uWash, uv + vec2( uTime * 0.0016, 0.0 ) ).r;
  float bloom = texture2D( uWash, uv * 0.37 + 0.31 ).r;
  c *= 0.965 + 0.05 * wash + 0.035 * bloom;
  // Pale drifts of far cloud low in the sky
  float veil = smoothstep( 0.52, 0.86, bloom * 0.6 + wash * 0.5 ) * smoothstep( 0.2, -0.25, e ) * smoothstep( -0.9, -0.35, e );
  c = mix( c, uPale * vec3( 1.0, 0.985, 0.97 ), veil * 0.34 );
  // Rain comes under a sky gone grey, darkest overhead
  float grey = dot( c, vec3( 0.3, 0.5, 0.2 ) );
  c = mix( c, vec3( 0.8, 0.84, 0.9 ) * grey * mix( 1.0, 0.86, smoothstep( -0.1, 0.7, e ) ), uRain * 0.66 );
  // Mist whitens the air the island floats in, most of all level with it and below
  c = mix( c, uPale * vec3( 0.975, 0.98, 0.99 ), uMist * 0.4 * smoothstep( 0.55, -0.15, e ) );

  gl_FragColor = vec4( c, 1.0 );
  #include <colorspace_fragment>
}
`;

// Whatever is drawn over the finished frame finds nothing left there to hide
// it: it asks the depth of that frame what stands in front of it. Where the
// frame is drawn straight to the screen, the screen's own depth does it.
const BEHIND_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform float uBehind;
bool hidden() {
  return uBehind > 0.5 && textureLod( tDepth, gl_FragCoord.xy / vec2( textureSize( tDepth, 0 ) ), 0.0 ).x < 0.99995;
}
`;

const STAR_VERTEX = /* glsl */ `
attribute vec4 aStar; // size in pixels of a frame 720 high, phase, how deep it twinkles, whether it has rays
uniform float uTime;
uniform float uScale;
uniform vec3 uMoonDir;
varying vec3 vStar; // how bright, whether it has rays, how cool its white is
void main() {
  // On the dome of the sky: it turns with the camera and never comes nearer
  vec4 p = projectionMatrix * vec4( mat3( viewMatrix ) * position, 1.0 );
  gl_Position = p.xyww;
  float twinkle = 1.0 - aStar.z * ( 0.5 + 0.5 * sin( uTime * ( 0.6 + aStar.y * 1.1 ) + aStar.y * 61.0 ) );
  // None shows through the dark of the moon
  float clear = 1.0 - smoothstep( 0.9986, 0.9995, dot( position, uMoonDir ) );
  // The small ones are the faint ones
  vStar = vec3( twinkle * clear * mix( 0.62, 1.0, smoothstep( 2.6, 5.0, aStar.x ) ), aStar.w, fract( aStar.y * 7.0 ) );
  gl_PointSize = aStar.x * uScale * mix( 1.0, STAR_RAYS, aStar.w );
}
`;

const STAR_FRAGMENT = /* glsl */ `
uniform vec3 uWarm;
uniform vec3 uCool;
uniform float uOpacity;
varying vec3 vStar;
${BEHIND_GLSL}
void main() {
  if ( hidden() ) discard;
  vec2 q = ( gl_PointCoord * 2.0 - 1.0 ) * mix( 1.0, STAR_RAYS, vStar.y );
  float a = 1.0 - smoothstep( 0.3, 1.0, length( q ) );
  // Four fine rays on the big ones
  vec2 w = abs( q );
  float rays = max(
    ( 1.0 - smoothstep( 0.0, 0.2, w.x ) ) * ( 1.0 - smoothstep( 0.2, STAR_RAYS, w.y ) ),
    ( 1.0 - smoothstep( 0.0, 0.2, w.y ) ) * ( 1.0 - smoothstep( 0.2, STAR_RAYS, w.x ) )
  );
  a = max( a, rays * 0.7 * vStar.y );
  gl_FragColor = vec4( mix( uWarm, uCool, vStar.z ), a * vStar.x * uOpacity );
  #include <colorspace_fragment>
}
`;

const MOON_VERTEX = /* glsl */ `
uniform vec3 uMoonDir;
uniform vec2 uSize; // half the width of its card, and how far it has still to rise, both as tangents
varying vec2 vAt;
void main() {
  vAt = position.xy;
  // A card on the dome of the sky that faces whoever looks at it. The camera
  // never rolls, so up on the screen is up for the moon.
  vec3 centre = mat3( viewMatrix ) * uMoonDir;
  centre.y -= uSize.y;
  vec3 across = normalize( cross( centre, vec3( 0.0, 1.0, 0.0 ) ) );
  vec3 up = normalize( cross( across, centre ) );
  vec4 p = projectionMatrix * vec4( centre + ( across * position.x + up * position.y ) * uSize.x, 1.0 );
  gl_Position = p.xyww;
}
`;

const MOON_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uDark;
uniform float uOpacity;
varying vec2 vAt;
${BEHIND_GLSL}
void main() {
  if ( hidden() ) discard;
  // A crescent: a disc with a bite out of the side the sun did not set on
  vec2 q = vAt * 1.1;
  float r = length( q );
  float aa = fwidth( q.x ) * 1.25;
  float disc = 1.0 - smoothstep( 1.0 - aa, 1.0 + aa, r );
  float bite = smoothstep( 0.86 - aa, 0.86 + aa, length( q - vec2( 0.42, 0.2 ) ) );
  float lit = disc * bite;
  // The wash has pooled a shade deeper along its edge
  vec3 c = uColor * mix( 0.9, 1.0, smoothstep( 1.0, 0.7, r ) );
  // The rest of the disc can just be made out
  float a = lit + ( disc - lit ) * 0.1;
  gl_FragColor = vec4( mix( uDark, c, lit / max( a, 0.001 ) ), a * uOpacity );
  #include <colorspace_fragment>
}
`;

// A cloud: a row of puffs, fattest in the middle, with flat shaded bellies.
function buildCloud(rng, puffs, length, detail) {
  const parts = [];
  const puff = (r, x, y, z) => {
    const g = icoSphere(r, detail);
    displace(
      g,
      (p) => {
        if (p.y < 0) p.y *= 0.3;
      },
      true
    );
    place(g, { x, y, z, ry: rng.range(0, 6.28) });
    parts.push(g);
  };

  for (let i = 0; i < puffs; i++) {
    const t = (i + 0.5) / puffs;
    const arch = Math.sin(t * Math.PI);
    const r = (0.4 + 0.72 * arch) * rng.range(0.82, 1.14);
    const x = (t - 0.5) * length + rng.range(-0.2, 0.2);
    const z = rng.range(-0.5, 0.5) * (0.35 + arch * 0.7);
    puff(r, x, r * 0.1 + arch * rng.range(0.0, 0.28), z);
    // Smaller puffs crowd the big ones: one on top, one in front
    if (arch > 0.45 && rng.chance(0.7)) puff(r * rng.range(0.5, 0.68), x + rng.range(-0.4, 0.4), r * rng.range(0.55, 0.8), z + rng.range(-0.3, 0.3));
    if (rng.chance(0.55)) puff(r * rng.range(0.42, 0.6), x + rng.range(-0.5, 0.5), r * 0.06, z + rng.sign() * r * rng.range(0.6, 0.9));
  }

  const lit = col(palette.cloud);
  const shade = col(palette.cloudShade);
  const g = merge(parts);
  g.computeBoundingBox();
  const lo = g.boundingBox.min.y;
  const hi = g.boundingBox.max.y;
  paint(g, (p, n, i, out) => {
    // Bright tops, cool flat undersides
    const k = THREE.MathUtils.smoothstep(n.y * 0.55 + ((p.y - lo) / (hi - lo)) * 0.75, 0.05, 0.85);
    out.copy(shade).lerp(lit, k);
  });
  return g;
}

export function createAtmosphere(textures, quality, { reducedMotion = false } = {}) {
  const group = new THREE.Group();
  group.name = 'atmosphere';
  // The sun, and by night the moon
  const lamp = season.lamp;
  // Where in the sky the moon is seen. Its light comes from higher up: the
  // island is looked down on, and a moon as high as its light would never be
  // in the picture.
  const uMoonDir = { value: new THREE.Vector3(0.36, -0.38, -0.85).normalize() };

  // ---------- Sky dome ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.ShaderMaterial({
      name: 'sky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        // The season repaints these colours in place
        uTop: { value: season.hues.skyTop },
        uMid: { value: season.hues.skyMid },
        uHorizon: { value: season.hues.skyHorizon },
        uLow: { value: season.hues.skyLow },
        uDeep: { value: season.hues.skyDeep },
        uSunColor: { value: season.hues.sun },
        uSunDir: { value: lamp.direction },
        uMoonDir,
        uPale: { value: season.hues.pale },
        uOut: { value: new THREE.Vector3(1, 0, 0) },
        uWash: { value: textures.wash },
        uTime: { value: 0 },
        uRain: { value: 0 },
        uMist: { value: 0 },
      },
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
    })
  );
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.matrixAutoUpdate = false;
  group.add(sky);

  // ---------- Light ----------
  const hemi = new THREE.HemisphereLight(col(palette.skyLight), col(palette.bounceLight), 2.05);
  hemi.color = season.hues.skyLight;
  hemi.groundColor = season.hues.bounce;
  group.add(hemi);

  const sun = new THREE.DirectionalLight(col(palette.sun), 2.75);
  sun.color = season.hues.sun;
  sun.position.copy(lamp.direction).multiplyScalar(48);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.045;
  sun.shadow.radius = quality.shadowRadius;
  fitShadowCamera(sun);
  group.add(sun, sun.target);

  // ---------- Clouds ----------
  // Laid out for the opening view: across the frame, up the frame, and away
  // from the viewer, so they sit around the island and never in front of it.
  // Clouds are too airy to hold much shade between their puffs
  const cloudMaterial = stylized({ name: 'cloud', ramp: 1.0, wrap: 0.7, rim: 0.22, cloud: false, snow: 0, wet: 0, shade: 0.45 });
  const rng = createRng(41);
  const clouds = [];
  const az = CAMERA.landscape.azimuth;
  const right = new THREE.Vector3(Math.cos(az), 0, -Math.sin(az));
  const away = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
  const spots = [
    // across, height, away, scale, puffs, length
    [-25, -8.5, -4, 2.3, 7, 6.2],
    [26, -6.5, 12, 2.6, 8, 7],
    [5, -15, -12, 2.2, 6, 5.4],
    [-33, 2.5, 30, 2.9, 8, 7.4],
    [19, 7.5, 48, 3.1, 9, 8],
    [-9, 10.5, 58, 2.7, 7, 6.6],
    [39, -11, 34, 2.6, 7, 6.4],
    [-42, -13, 14, 2.8, 7, 6.6],
    [-2, -23, 24, 3.3, 9, 8.2],
    [-15, -19, -10, 1.9, 5, 4.6],
    [34, 5, 66, 2.6, 6, 6],
    [-44, 9, 64, 3.0, 8, 7.2],
  ];
  for (const [across, height, depth, scale, puffs, length] of spots.slice(0, quality.clouds)) {
    const mesh = new THREE.Mesh(buildCloud(rng, puffs, length, quality.cloudDetail), cloudMaterial);
    const x = right.x * across + away.x * depth;
    const z = right.z * across + away.z * depth;
    mesh.position.set(x, height, z);
    mesh.scale.setScalar(scale);
    // Long side across the view
    mesh.rotation.y = az + rng.range(-0.35, 0.35);
    mesh.userData = { x, y: height, z, phase: rng.range(0, 6.28), speed: rng.range(0.03, 0.07), span: rng.range(1.0, 2.2) };
    clouds.push(mesh);
    group.add(mesh);
  }

  // ---------- The night sky ----------
  // Stars and a moon are small and bright, and the soft focus would smear
  // them into the sky they hang in: like the snow and the rain they are drawn
  // over the finished frame.
  const behind = { tDepth: { value: null }, uBehind: { value: 0 } };
  const over = (name, parameters) => {
    const material = new THREE.ShaderMaterial({ name, transparent: true, depthWrite: false, depthTest: true, fog: false, ...parameters });
    Object.assign(material.uniforms, behind, { uMoonDir, uOpacity: { value: 0 } });
    return material;
  };
  const hung = (object, name, order) => {
    object.name = name;
    object.layers.set(OVER_LAYER);
    object.frustumCulled = false;
    object.renderOrder = order;
    object.visible = false;
    group.add(object);
    return object;
  };

  const stars = (() => {
    // Their own lot of numbers, so that the clouds stay as they were drawn
    const rng = createRng(19);
    const count = Math.round(700 + 700 * quality.density);
    const position = new Float32Array(count * 3);
    const star = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      // All round the island, from a little over its horizon to the deep under it
      const y = rng.range(-0.96, 0.3);
      const a = rng.range(0, Math.PI * 2);
      const flat = Math.sqrt(1 - y * y);
      position.set([Math.sin(a) * flat, y, Math.cos(a) * flat], i * 3);
      // Most are small; a few are big enough to have rays
      const big = Math.pow(rng(), 6);
      star.set([2.6 + big * 5.4, rng(), rng.range(0.15, 0.6), big > 0.5 ? 1 : 0], i * 4);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
    geometry.setAttribute('aStar', new THREE.BufferAttribute(star, 4));
    const material = over('stars', {
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: { uTime: { value: 0 }, uScale: { value: 1 }, uWarm: { value: col('#FFF3D6') }, uCool: { value: col('#E3ECFF') } },
      defines: { STAR_RAYS: '2.6' },
    });
    return hung(new THREE.Points(geometry, material), 'stars', -3);
  })();

  const moon = hung(
    new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      over('moon', {
        vertexShader: MOON_VERTEX,
        fragmentShader: MOON_FRAGMENT,
        uniforms: { uSize: { value: new THREE.Vector2(MOON_SIZE, 0) }, uColor: { value: col('#FFF1C2') }, uDark: { value: col('#8AA0E0') } },
      })
    ),
    'moon',
    -2
  );

  // The light of the hour comes from where its lamp stands
  function relight() {
    sun.position.copy(lamp.direction).multiplyScalar(48);
    fitShadowCamera(sun);
  }
  relight();

  function update(time) {
    sky.material.uniforms.uTime.value = time;
    if (season.changed) relight();
    // Rain takes the edge off the sun, greys the sky over and fills the clouds.
    // Mist takes less of the sun and gives it back as light from all round.
    sun.intensity = lamp.power * (1 - 0.3 * season.rain) * (1 - 0.14 * season.mist);
    hemi.intensity = season.v.skyPower * (1 - 0.05 * season.rain) * (1 + 0.12 * season.mist);
    sky.material.uniforms.uRain.value = season.rain;
    sky.material.uniforms.uMist.value = season.mist;
    // A sun that stands low lights its side of the sky, the morning's more
    // than the evening's: it is the morning's that the opening view looks into
    const sunOut = lamp.lit - lamp.moon;
    sky.material.uniforms.uOut.value.set(sunOut, (0.5 * season.dawn + 0.3 * season.dusk) * sunOut, lamp.moon);
    // The stars come out once the light has gone. Whatever falls or lies in
    // the air hides them, and takes the edge off the moon.
    const air = (1 - 0.85 * season.rain) * (1 - 0.7 * season.snowing) * (1 - 0.5 * season.mist);
    const starlight = THREE.MathUtils.smoothstep(season.night, 0.3, 0.95) * air;
    stars.material.uniforms.uOpacity.value = 0.95 * starlight;
    stars.material.uniforms.uTime.value = reducedMotion ? 0 : time;
    stars.visible = starlight > 0.003;
    const moonlight = lamp.moon * (0.35 + 0.65 * air);
    moon.material.uniforms.uOpacity.value = moonlight;
    // It comes up into its place, and sinks out of it
    moon.material.uniforms.uSize.value.y = 0.05 * (1 - lamp.moon) * (1 - lamp.moon);
    moon.visible = moonlight > 0.003;
    cloudMaterial.color.setRGB(1 - 0.24 * season.rain, 1 - 0.2 * season.rain, 1 - 0.13 * season.rain);
    // The clouds go by the wind's clock, so a wind hurries them along
    const blown = season.gusts;
    for (const c of clouds) {
      const u = c.userData;
      const drift = Math.sin(blown * u.speed + u.phase) * u.span;
      c.position.x = u.x + right.x * drift;
      c.position.z = u.z + right.z * drift;
      c.position.y = u.y + Math.sin(blown * u.speed * 1.7 + u.phase * 2.1) * 0.22;
    }
  }

  return {
    group,
    sun,
    hemi,
    sky,
    clouds,
    stars,
    moon,
    update,

    // The frame has a new size: `high` is its height in the pixels it is
    // drawn in, `moon` the way into the sky where the moon is to hang, and
    // `size` how big it is there beside what it is in a wide frame.
    frame({ high, moon: at, size = 1 }) {
      stars.material.uniforms.uScale.value = high / 720;
      moon.material.uniforms.uSize.value.x = MOON_SIZE * size;
      if (at) uMoonDir.value.copy(at).normalize();
    },

    // The finished frame is drawn through a pass of its own, and the screen is
    // left with no depth to test against: `depth` is that of the picture, by
    // which whatever is drawn over it knows what stands in front.
    behind(depth) {
      behind.tDepth.value = depth;
      behind.uBehind.value = 1;
      stars.material.depthTest = moon.material.depthTest = false;
    },
  };
}

// Wrap the shadow camera tightly around everything that can cast or catch a
// shadow, so no texel is spent on empty sky.
function fitShadowCamera(light) {
  const cam = light.shadow.camera;
  light.updateMatrixWorld();
  light.target.updateMatrixWorld();
  cam.position.copy(light.position);
  cam.lookAt(light.target.position);
  cam.updateMatrixWorld();
  const inverse = cam.matrixWorld.clone().invert();

  const hx = ISLAND.halfX + 1.2;
  const hz = ISLAND.halfZ + 1.2;
  const box = new THREE.Box3();
  const p = new THREE.Vector3();
  for (const x of [-hx, hx]) {
    for (const y of [-0.9, 9.5]) {
      for (const z of [-hz, hz]) {
        box.expandByPoint(p.set(x, y, z).applyMatrix4(inverse));
      }
    }
  }
  cam.left = box.min.x;
  cam.right = box.max.x;
  cam.bottom = box.min.y;
  cam.top = box.max.y;
  cam.near = Math.max(0.5, -box.max.z - 2);
  cam.far = -box.min.z + 2;
  cam.updateProjectionMatrix();
}
