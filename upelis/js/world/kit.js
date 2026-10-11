import * as THREE from '../core/three.js';
import { col } from '../core/palette.js';
import { stylized } from '../core/materials.js';
import { paint, paintSolid, place } from '../core/geo.js';

// The handful of materials every model shares, and a few small helpers for
// colouring parts. Keeping the list short is what makes the scene read as one
// hand: everything takes the same light, wash and haze.

export function createKit(textures) {
  // Painted solids: toys, cloth, creatures
  const solid = stylized({ name: 'solid', rim: 0.16, wash: 0.5 });
  const solidDouble = stylized({ name: 'solid-double', rim: 0.1, wash: 0.4, side: THREE.DoubleSide, sway: true });

  // Stone takes the wash at full strength, so no two rocks are the same grey
  const rock = stylized({ name: 'rock', rim: 0.2, ramp: 0.5, wash: 1 });

  // Timber and bark: the painted grain runs along each piece's own length
  const grainHooks = {
    vertexPars: /* glsl */ `varying vec2 vGrainUv;`,
    vertexLocal: /* glsl */ `vGrainUv = uv;`,
    fragmentPars: /* glsl */ `
      uniform sampler2D uGrain;
      varying vec2 vGrainUv;
    `,
    fragmentAlbedo: /* glsl */ `diffuseColor.rgb *= 0.66 + 0.68 * texture2D( uGrain, vGrainUv ).r;`,
  };
  const wood = stylized({
    name: 'wood',
    rim: 0.12,
    wash: 0.4,
    uniforms: { uGrain: { value: textures.woodgrain } },
    hooks: grainHooks,
  });
  const bark = stylized({
    name: 'bark',
    rim: 0.14,
    wash: 0.5,
    sway: true,
    uniforms: { uGrain: { value: textures.woodgrain } },
    hooks: grainHooks,
  });
  // Birch bark: white, with the dark lens-shaped marks painted across it
  const birchBark = stylized({
    name: 'birch-bark',
    rim: 0.16,
    wash: 0.35,
    sway: true,
    hooks: {
      vertexPars: /* glsl */ `varying vec2 vGrainUv;`,
      vertexLocal: /* glsl */ `vGrainUv = uv;`,
      fragmentPars: /* glsl */ `varying vec2 vGrainUv;`,
      fragmentAlbedo: /* glsl */ `
        {
          float marks = creekNoise( vec2( vGrainUv.x * 3.0, vGrainUv.y * 2.4 ) );
          float dash = smoothstep( 0.64, 0.72, marks ) * smoothstep( 0.2, 0.5, creekNoise( vec2( vGrainUv.x * 9.0 + 3.0, vGrainUv.y * 0.6 ) ) );
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.08, 0.12 ), dash * 0.82 );
        }
      `,
    },
  });

  // Leaves. The sprite carries painted light and shade; the tint comes from
  // each card's vertex colour, and the canopy's shape supplies the normal.
  const leafMaterials = new Map();
  const leaves = (texture, { sway = true, alphaTest = 0.36 } = {}) => {
    const key = `${texture.name}:${sway}:${alphaTest}`;
    let m = leafMaterials.get(key);
    if (!m) {
      m = stylized({
        name: `leaves-${texture.name}`,
        map: texture,
        alphaTest,
        alphaToCoverage: true,
        side: THREE.DoubleSide,
        keepNormals: true,
        ramp: 0.75,
        wrap: 0.42,
        rim: 0.1,
        wash: 0.42,
        sway,
      });
      leafMaterials.set(key, m);
    }
    return m;
  };
  // The soft body of a canopy behind its leaf cards
  const canopy = stylized({ name: 'canopy', ramp: 0.75, wrap: 0.4, rim: 0.1, wash: 0.55, sway: true });

  return { solid, solidDouble, rock, wood, bark, birchBark, leaves, canopy };
}

const _c = new THREE.Color();
const _hsl = { h: 0, s: 0, l: 0 };

// A colour near `hex`: hue, saturation and lightness nudged at random.
export function vary(hex, rng, { h = 0.012, s = 0.05, l = 0.05 } = {}) {
  const c = col(hex).clone();
  c.getHSL(_hsl, THREE.LinearSRGBColorSpace);
  c.setHSL(_hsl.h + rng.range(-h, h), THREE.MathUtils.clamp(_hsl.s + rng.range(-s, s), 0, 1), THREE.MathUtils.clamp(_hsl.l + rng.range(-l, l), 0, 1), THREE.LinearSRGBColorSpace);
  return c;
}

// Paint a part one colour and put it in place, in a single call.
export function part(geom, color, placement) {
  paintSolid(geom, typeof color === 'string' ? col(color) : color);
  return placement ? place(geom, placement) : geom;
}

// Bottom-to-top gradient along the part's own height, then placed.
export function partGradient(geom, bottom, top, placement, power = 1) {
  geom.computeBoundingBox();
  const lo = geom.boundingBox.min.y;
  const hi = geom.boundingBox.max.y;
  const a = typeof bottom === 'string' ? col(bottom) : bottom;
  const b = typeof top === 'string' ? col(top) : top;
  paint(geom, (p, n, i, out) => {
    const t = Math.pow(THREE.MathUtils.clamp((p.y - lo) / (hi - lo || 1), 0, 1), power);
    out.copy(a).lerp(b, t);
  });
  return placement ? place(geom, placement) : geom;
}

// Grain coordinates for a box-like part: `along` is the axis the grain runs on.
export function grainUv(geom, along = 'x', across = 'z', scale = 0.32, offset = 0) {
  const pos = geom.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  const get = { x: (i) => pos.getX(i), y: (i) => pos.getY(i), z: (i) => pos.getZ(i) };
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = get[across](i) * scale * 2.2 + offset;
    uv[i * 2 + 1] = get[along](i) * scale + offset * 1.7;
  }
  geom.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geom;
}

// Stretch a tube's built-in coordinates so the grain keeps its scale.
export function tubeGrain(geom, length, scale = 0.32, offset = 0) {
  const uv = geom.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + offset, uv.getY(i) * length * scale + offset * 1.3);
  return geom;
}

export function mesh(geometry, material, { cast = true, receive = true, name = '' } = {}) {
  const m = new THREE.Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  m.name = name;
  return m;
}
