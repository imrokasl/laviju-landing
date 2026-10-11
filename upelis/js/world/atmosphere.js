import * as THREE from '../core/three.js';
import { createRng } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { stylized } from '../core/materials.js';
import { icoSphere, place, paint, displace, merge } from '../core/geo.js';
import { ISLAND, CAMERA } from './layout.js';

// Sky, light and the clouds the island floats among.

// Direction the sunlight comes from: over the viewer's left shoulder, so forms
// read clearly and shadows fall away to the right.
export const SUN_DIRECTION = new THREE.Vector3(-0.58, 0.74, 0.34).normalize();

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
uniform sampler2D uWash;
uniform float uTime;
varying vec3 vDir;

void main() {
  vec3 d = normalize( vDir );
  float e = d.y;

  vec3 above = mix( uHorizon, uMid, smoothstep( 0.0, 0.3, e ) );
  above = mix( above, uTop, smoothstep( 0.22, 0.9, e ) );
  vec3 below = mix( uHorizon, uLow, smoothstep( 0.0, -0.4, e ) );
  below = mix( below, uDeep, smoothstep( -0.35, -1.0, e ) );
  vec3 c = e >= 0.0 ? above : below;

  // Warm glow around the sun
  float s = max( dot( d, uSunDir ), 0.0 );
  c += uSunColor * ( pow( s, 6.0 ) * 0.1 + pow( s, 64.0 ) * 0.35 );

  // Loose watercolour blooms, anchored to the world so they drift as you orbit
  vec2 uv = vec2( atan( d.x, - d.z ) * 0.55, e * 1.15 );
  float wash = texture2D( uWash, uv + vec2( uTime * 0.0016, 0.0 ) ).r;
  float bloom = texture2D( uWash, uv * 0.37 + 0.31 ).r;
  c *= 0.965 + 0.05 * wash + 0.035 * bloom;
  // Pale drifts of far cloud low in the sky
  float veil = smoothstep( 0.52, 0.86, bloom * 0.6 + wash * 0.5 ) * smoothstep( 0.2, -0.25, e ) * smoothstep( -0.9, -0.35, e );
  c = mix( c, vec3( 1.0, 0.985, 0.97 ), veil * 0.34 );

  gl_FragColor = vec4( c, 1.0 );
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

export function createAtmosphere(textures, quality) {
  const group = new THREE.Group();
  group.name = 'atmosphere';

  // ---------- Sky dome ----------
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 20),
    new THREE.ShaderMaterial({
      name: 'sky',
      vertexShader: SKY_VERTEX,
      fragmentShader: SKY_FRAGMENT,
      uniforms: {
        uTop: { value: col(palette.skyTop) },
        uMid: { value: col(palette.skyMid) },
        uHorizon: { value: col(palette.skyHorizon) },
        uLow: { value: col(palette.skyLow) },
        uDeep: { value: col(palette.skyDeep) },
        uSunColor: { value: col(palette.sun) },
        uSunDir: { value: SUN_DIRECTION },
        uWash: { value: textures.wash },
        uTime: { value: 0 },
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
  group.add(hemi);

  const sun = new THREE.DirectionalLight(col(palette.sun), 2.75);
  sun.position.copy(SUN_DIRECTION).multiplyScalar(48);
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
  const cloudMaterial = stylized({ name: 'cloud', ramp: 1.0, wrap: 0.7, rim: 0.22, cloud: false });
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

  function update(time) {
    sky.material.uniforms.uTime.value = time;
    for (const c of clouds) {
      const u = c.userData;
      const drift = Math.sin(time * u.speed + u.phase) * u.span;
      c.position.x = u.x + right.x * drift;
      c.position.z = u.z + right.z * drift;
      c.position.y = u.y + Math.sin(time * u.speed * 1.7 + u.phase * 2.1) * 0.22;
    }
  }

  return { group, sun, hemi, sky, clouds, update };
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
