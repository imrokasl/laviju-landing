import * as THREE from '../core/three.js';
import { clamp, createRng, ease } from '../core/math.js';
import { shared } from '../core/materials.js';
import { brand, col } from '../core/palette.js';
import { ISLAND } from '../world/layout.js';

// The air above the creek: spray where the water falls, pollen drifting in the
// sun, and the rainbow that draws itself across the sky once every place has
// been found.

const PUFF_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, lifetime in seconds, size in metres, opacity
attribute vec3 aDrift; // metres travelled over one lifetime
uniform float uTime;
uniform float uPixels; // half the height of the drawing buffer
varying float vAlpha;
void main() {
  float age = fract( uTime / aSeed.y + aSeed.x );
  vec3 p = position + aDrift * age;
  // Spray billows sideways as it thins
  p.x += sin( uTime * 0.55 + aSeed.x * 41.0 ) * 0.16 * age;
  p.z += cos( uTime * 0.47 + aSeed.x * 23.0 ) * 0.16 * age;
  vec4 mv = modelViewMatrix * vec4( p, 1.0 );
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSeed.z * ( 0.4 + age ) * projectionMatrix[ 1 ][ 1 ] * uPixels / - mv.z;
  vAlpha = smoothstep( 0.0, 0.2, age ) * ( 1.0 - smoothstep( 0.4, 1.0, age ) ) * aSeed.w;
}
`;

const MOTE_VERTEX = /* glsl */ `
attribute vec4 aSeed; // phase, pace, size in metres, twinkle rate
uniform float uTime;
uniform float uPixels;
uniform float uMinSize;
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
  vAlpha = ( 0.25 + 0.75 * twinkle * twinkle ) * min( 1.0, size / uMinSize );
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
uniform float uTime;
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
  // spray: one in the waterfall, one in the haze under the island
  float across = smoothstep( 0.0, 0.22, t ) * smoothstep( 1.0, 0.78, t );
  float wash = texture2D( uWash, vec2( vArc.x * 5.0 + 0.13, t * 0.5 + uTime * 0.004 ) ).r;
  float ends = smoothstep( 0.0, 0.07, vArc.x ) * smoothstep( 1.0, 0.8, vArc.x );
  // It is painted in from the waterfall, like the line under the title
  float drawn = 1.0 - smoothstep( uShow * 1.2 - 0.2, uShow * 1.2, vArc.x );
  float low = smoothstep( -3.4, -0.6, vWorldPos.y );
  float alpha = across * ends * drawn * low * ( 0.62 + 0.38 * wash ) * 0.84;

  gl_FragColor = vec4( c * ( 0.96 + 0.1 * wash ), alpha );
  #include <colorspace_fragment>
}
`;

function points(count, fill) {
  const position = new Float32Array(count * 3);
  const seed = new Float32Array(count * 4);
  const drift = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) fill(i, position, seed, drift);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(position, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  g.setAttribute('aDrift', new THREE.BufferAttribute(drift, 3));
  return g;
}

export function createAmbient(renderer, { water, field, quality, reducedMotion = false }) {
  const group = new THREE.Group();
  group.name = 'ambient';
  const rng = createRng(77);
  const uPixels = { value: 400 };
  const uMinSize = { value: 2 };

  const soft = (vertexShader, color, falloff, extra = {}) =>
    new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader: SOFT_FRAGMENT,
      uniforms: { uTime: shared.uTime, uPixels, uColor: { value: col(color) }, uOpacity: { value: 1 }, ...extra },
      defines: { FALLOFF: falloff.toFixed(2) },
      transparent: true,
      depthWrite: false,
    });

  // ---------- Spray ----------
  const [upper, rim] = water.falls;
  const emitters = [];
  if (upper) {
    // Where the fall lands: short-lived puffs that rise and drift downstream
    const dx = upper.bottom.x - upper.top.x;
    const dz = upper.bottom.z - upper.top.z;
    const d = Math.hypot(dx, dz) || 1;
    emitters.push({
      count: Math.round(22 * quality.density + 8),
      make(i, position, seed, drift) {
        const [ox, oz] = rng.disc(upper.width * 0.75);
        position.set([upper.bottom.x + ox - (dx / d) * 0.35, upper.bottom.y + rng.range(0.02, 0.3), upper.bottom.z + oz - (dz / d) * 0.35], i * 3);
        seed.set([rng(), rng.range(2.2, 4.4), rng.range(0.7, 1.5), rng.range(0.1, 0.2)], i * 4);
        drift.set([(dx / d) * rng.range(0.2, 0.9) + rng.range(-0.3, 0.3), rng.range(0.5, 1.5), (dz / d) * rng.range(0.2, 0.9) + rng.range(-0.3, 0.3)], i * 3);
      },
    });
  }
  if (rim) {
    // Where the creek leaves the island: wide, faint veils sinking into the haze
    const dx = rim.bottom.x - rim.top.x;
    const dz = rim.bottom.z - rim.top.z;
    emitters.push({
      count: Math.round(14 * quality.density + 6),
      make(i, position, seed, drift) {
        const k = rng.range(0.12, 0.8);
        position.set([rim.top.x + dx * k + rng.range(-0.6, 0.6), rim.top.y - rim.height * k * k, rim.top.z + dz * k + rng.range(-0.6, 0.6)], i * 3);
        seed.set([rng(), rng.range(3.4, 6.2), rng.range(1.6, 3.2), rng.range(0.08, 0.16)], i * 4);
        drift.set([dx * rng.range(0.15, 0.5), -rng.range(1.2, 2.6), dz * rng.range(0.15, 0.5)], i * 3);
      },
    });
  }
  const total = emitters.reduce((n, e) => n + e.count, 0);
  if (total) {
    let emitter = 0;
    let used = 0;
    const geometry = points(total, (i, position, seed, drift) => {
      while (i - used >= emitters[emitter].count) used += emitters[emitter++].count;
      emitters[emitter].make(i, position, seed, drift);
    });
    const mist = new THREE.Points(geometry, soft(PUFF_VERTEX, '#FFFFFF', 2.6));
    mist.name = 'spray';
    mist.frustumCulled = false;
    mist.renderOrder = 6;
    group.add(mist);
  }

  // ---------- Pollen in the sun ----------
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
    const motes = new THREE.Points(geometry, soft(MOTE_VERTEX, '#FFF4D2', 3.4, { uMinSize }));
    motes.material.uniforms.uOpacity.value = 0.85;
    motes.name = 'pollen';
    motes.frustumCulled = false;
    motes.renderOrder = 6;
    group.add(motes);
  }

  // ---------- The rainbow ----------
  // One foot stands in the spray of the waterfall, the other is lost below the
  // far rim. The band lies in the vertical plane through both.
  const bow = (() => {
    const from = upper ? new THREE.Vector3(upper.bottom.x - 0.5, 0.15, upper.bottom.z - 0.2) : new THREE.Vector3(-6.8, 0.15, -3.4);
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
        uTime: shared.uTime,
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

  function update(time, dt) {
    uPixels.value = renderer.domElement.height / 2;
    uMinSize.value = 1.6 * renderer.getPixelRatio();
    if (showing && shown < 1) {
      shown = clamp(shown + dt / (reducedMotion ? 0.01 : 3.4), 0, 1);
      bow.material.uniforms.uShow.value = ease.inOutSine(shown);
    }
  }

  return {
    group,
    update,
    rainbowTop: bow.apex,
    // Every place has been found
    celebrate() {
      if (showing) return;
      showing = true;
      bow.mesh.visible = true;
    },
  };
}
