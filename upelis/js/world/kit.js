import * as THREE from '../core/three.js';
import { col } from '../core/palette.js';
import { stylized, shadowOf, yearGLSL } from '../core/materials.js';
import { paint, paintSolid, place } from '../core/geo.js';

// The handful of materials every model shares, and a few small helpers for
// colouring parts. Keeping the list short is what makes the scene read as one
// hand: everything takes the same light, wash and haze.

// ---------- A crown through the year ----------
// Every leaf card, crown body and twig fan knows where it hangs (aLeaf.xyz)
// and carries a number of its own (the fraction of aLeaf.w), so leaves turn,
// fall and open one after another instead of all at once. The whole part of
// aLeaf.w, halved, is the kind: 3 is a willow strand. The year is read at
// the spot the leaf hangs over, so a change of season crosses a crown too.
const LEAF_PARS = /* glsl */ `
  ${yearGLSL}
  attribute vec4 aLeaf;
  attribute vec3 aTurn;
`;
// `bare` is what becomes of a willow strand that stays on through the winter:
// GLSL that is told how far its leaves have gone (leafBare, 0..1)
const leafMove = (bare) => /* glsl */ `
  float leafNumber = fract( aLeaf.w );
  float leafKind = floor( aLeaf.w * 0.5 );
  vec4 leafYear = creekLeafAt( aLeaf.xz );
  {
    if ( leafKind > 2.5 && leafNumber > 0.96 ) {
      float leafBare = smoothstep( 0.3, 0.8, leafYear.y );
      ${bare}
    } else {
      // Each leaf lets go at its own moment. The moments are set so that no
      // leaf is caught half-way while the year stands still: one in five is
      // down by the height of autumn, one in twenty hangs on into the winter
      // and goes with the last of it.
      float lets = leafNumber < 0.2 ? leafNumber * 0.35 : leafNumber < 0.95 ? leafNumber * 0.8 + 0.04 : 0.95;
      float gone = smoothstep( lets, lets + ( leafNumber < 0.95 ? 0.13 : 0.05 ), leafYear.y );
      transformed = mix( transformed, aLeaf.xyz, gone );
      // What still hangs once the rest is down has shrivelled
      transformed = mix( transformed, aLeaf.xyz, 0.34 * smoothstep( 0.45, 0.93, leafYear.y ) * ( 1.0 - leafYear.z ) );
      // On its way out it sags, comes away and is carried off downwind as it
      // dwindles; in spring a leaf simply opens where it grows
      float loose = gone * gone * ( 1.0 - leafYear.z );
      transformed.y -= gone * ( 1.0 - gone ) * ( 1.0 - leafYear.z ) * 1.4 + loose * ( 0.7 + 1.3 * fract( leafNumber * 13.7 ) );
      transformed.xz += uWind.xy * ( loose * ( 0.35 + 0.75 * fract( leafNumber * 29.3 ) ) );
    }
    // New leaves open small
    transformed = mix( transformed, aLeaf.xyz, leafYear.z * 0.14 );
  }
`;
// In the picture the strand keeps its place and loses its leaves (the fragment
// shader leaves only the withy); a withy casts no shadow to speak of
const LEAF_MOVE = leafMove('vBare = leafBare;');
const LEAF_MOVE_SHADOW = leafMove('transformed = mix( transformed, aLeaf.xyz, leafBare );');
const BARE_PARS = /* glsl */ `varying float vBare;`;
const BARE_ALBEDO = /* glsl */ `
  if ( vBare > 0.002 ) {
    // A willow in winter: of the strand only its withies are left, a long
    // thread and a shorter one beside it, the colour of old gold. They are
    // as fine as thread from near by, and from far off as fine as the
    // picture can draw.
    float thin = max( 0.012, fwidth( vMapUv.x ) * 0.7 );
    float hung = 1.0 - vMapUv.y;
    float withy = 0.0;
    for ( int k = 0; k < 2; k ++ ) {
      float side = float( k );
      float off = vMapUv.x - 0.5 - side * 0.17 + sin( vMapUv.y * ( 8.0 + side * 3.0 ) + side * 2.1 ) * 0.028 * hung;
      withy = max( withy, ( 1.0 - smoothstep( thin * 0.45, thin * 1.4, abs( off ) ) ) * step( side * 0.36, vMapUv.y ) );
    }
    diffuseColor.a = mix( diffuseColor.a, withy * step( vMapUv.y, 0.97 ), vBare );
    diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.62, 0.4, 0.1 ) * ( 0.75 + 0.45 * vMapUv.y ), vBare );
    creekSnowTake = 1.0 - vBare * 0.88;
  }
`;
// Blossom opens cluster by cluster as the spring comes on, and goes the same way
const BLOOM_MOVE = /* glsl */ `
  {
    float bloomNumber = fract( aLeaf.w );
    float open = smoothstep( bloomNumber * 0.5, bloomNumber * 0.5 + 0.5, creekLeafAt( aLeaf.xz ).w );
    transformed = mix( aLeaf.xyz, transformed, open );
  }
`;
const BODY_MOVE = /* glsl */ `
  float leafNumber = fract( aLeaf.w );
  float leafKind = 0.0;
  vec4 leafYear = creekLeafAt( aLeaf.xz );
  // The soft body thins away as the leaves in front of it go
  transformed = mix( transformed, aLeaf.xyz, smoothstep( 0.3 + leafNumber * 0.2, 0.62 + leafNumber * 0.2, leafYear.y ) );
`;
// The body of a crown is leaves too: the same painted clusters, laid on from
// three sides where the body stood in summer, lit where a cluster lies and
// dark in the gaps between
const BODY_PARS = /* glsl */ `varying vec3 vBody;`;
const BODY_ALBEDO = /* glsl */ `
  {
    vec3 facing = abs( inverseTransformDirection( normalize( vNormal ), viewMatrix ) );
    facing *= facing;
    facing /= facing.x + facing.y + facing.z;
    vec3 at = vBody * 1.2;
    vec4 leafy = textureGrad( uFoliage, fract( at.zy ), dFdx( at.zy ), dFdy( at.zy ) ) * facing.x
      + textureGrad( uFoliage, fract( at.xz + 0.37 ), dFdx( at.xz ), dFdy( at.xz ) ) * facing.y
      + textureGrad( uFoliage, fract( at.xy + 0.71 ), dFdx( at.xy ), dFdy( at.xy ) ) * facing.z;
    diffuseColor.rgb *= mix( 0.5, 1.14, leafy.r * leafy.a );
  }
`;
const TWIG_MOVE = /* glsl */ `
  float leafNumber = fract( aLeaf.w );
  // Bare twigs come into view as the leaves leave
  transformed = mix( aLeaf.xyz, transformed, smoothstep( 0.1 + leafNumber * 0.2, 0.48 + leafNumber * 0.3, creekLeafAt( aLeaf.xz ).y ) );
`;
const LEAF_TINT = /* glsl */ `
  {
    // Autumn: every leaf turns in its own time, towards its own colour
    float turned = smoothstep( 0.0, 1.0, ( leafYear.x - fract( leafNumber * 7.31 ) * 0.62 ) / 0.38 );
    vColor.rgb = mix( vColor.rgb, aTurn, turned );
    // The last leaves on the branch have gone brown
    float withered = smoothstep( 0.45, 0.93, leafYear.y ) * ( 1.0 - leafYear.z );
    vColor.rgb = mix( vColor.rgb, vec3( 0.27, 0.12, 0.04 ) * ( 0.75 + 0.6 * fract( leafNumber * 5.3 ) ), withered * 0.85 );
    // Spring: the new leaves come out yellow-green
    vColor.rgb *= mix( vec3( 1.0 ), vec3( 1.12, 1.1, 0.62 ), leafYear.z * ( 1.0 - turned ) );
  }
`;

// ---------- Things that belong to one season ----------
// Every thing in a set knows the spot it stands on (aPop.xyz) and its turn
// (aPop.w, 0..1): as uPop runs from 0 to 1 the set comes up out of the ground
// thing by thing, each with a little bounce, and it leaves the same way. uPop
// is told by every clock of the year, as a change of season comes over.
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

export function createKit(textures) {
  // Painted solids: toys, cloth and the like
  const solid = stylized({ name: 'solid', rim: 0.16, wash: 0.5 });
  // What is drawn from both sides is a sheet: a flag, a sail, a kite. The sun
  // comes through it, so its far side is never left dull.
  const solidDouble = stylized({ name: 'solid-double', rim: 0.1, wash: 0.4, side: THREE.DoubleSide, sway: true, thin: 0.7 });
  // Creatures are painted the same way, but snow does not settle on them, and
  // rain runs off fur and feathers
  const creature = stylized({ name: 'creature', rim: 0.16, wash: 0.5, snow: 0, wet: 0.4 });
  const creatureDouble = stylized({ name: 'creature-double', rim: 0.1, wash: 0.4, side: THREE.DoubleSide, sway: true, snow: 0, wet: 0.4, thin: 0.6 });

  // Stone takes the wash at full strength, so no two rocks are the same grey.
  // Its grain and lichen are laid on from three sides, so they never stretch,
  // and so is what grows and gathers on it. Every vertex says how much of
  // that there is (aStone: moss, how far up from the ground it is as a share
  // of the band earth reaches, whether that ground is dry), and the painted
  // cushions and crumbs decide where exactly it ends.
  // Moss is the same on stone and on bark: one sheet, one pair of greens
  const mossy = {
    uMoss: { value: textures.moss },
    uMossDeep: { value: new THREE.Color('#4E8C62') },
    uMossTip: { value: new THREE.Color('#BFDD8C') },
  };
  const rock = stylized({
    name: 'rock',
    rim: 0.2,
    ramp: 0.5,
    wash: 1,
    uniforms: {
      uStone: { value: textures.rock },
      ...mossy,
      uEarth: { value: new THREE.Color('#A87C5C') },
    },
    hooks: {
      vertexPars: /* glsl */ `
        attribute vec3 aStone;
        varying vec3 vStoneNormal;
        varying vec3 vStone;
      `,
      vertexLocal: /* glsl */ `
        vStoneNormal = normal;
        vStone = aStone;
      `,
      fragmentPars: /* glsl */ `
        uniform sampler2D uStone;
        uniform sampler2D uMoss;
        uniform vec3 uMossDeep;
        uniform vec3 uMossTip;
        uniform vec3 uEarth;
        varying vec3 vStoneNormal;
        varying vec3 vStone;
        // A painted sheet laid on from three sides
        float creekThree( sampler2D sheet, vec3 at, vec3 face ) {
          return texture2D( sheet, at.zy ).r * face.x + texture2D( sheet, at.xz ).r * face.y + texture2D( sheet, at.xy ).r * face.z;
        }
      `,
      fragmentAlbedo: /* glsl */ `
        {
          vec3 face = abs( normalize( vStoneNormal ) );
          face *= face;
          face /= face.x + face.y + face.z;
          // Its grain twice over: the blotches and cracks of the whole stone,
          // and the speckle that shows from close by
          float grain = creekThree( uStone, vWorldPos * 0.62, face );
          float speckle = creekThree( uStone, vWorldPos.zxy * 2.36 + 0.37, face.zxy );
          // The light and shade painted on the stone, which whatever lies on it keeps
          float painted = dot( diffuseColor.rgb, vec3( 0.3, 0.5, 0.2 ) ) * 1.9;
          diffuseColor.rgb *= 0.34 + 0.84 * grain + 0.48 * speckle;

          // Earth clings to the foot of a stone that stands on dry ground...
          float earth = ( 1.0 - smoothstep( 0.2, 1.0, vStone.y + ( grain - 0.5 ) * 0.8 ) ) * vStone.z * ( 1.0 - creekWinter.x * 0.7 );
          diffuseColor.rgb = mix( diffuseColor.rgb, uEarth * ( 0.5 + 0.9 * grain ) * mix( 1.0, painted, 0.5 ), earth * 0.88 );

          // ...and moss grows up out of the damp there and over what faces the
          // sky: in cushions, dark between and pale on their crowns
          float tuft = creekThree( uMoss, vWorldPos * 1.9, face );
          float moss = smoothstep( 0.4, 0.58, vStone.x + ( tuft - 0.5 ) * 0.9 ) * ( 1.0 - earth * 0.85 );
          vec3 mossHue = mix( uMossDeep, uMossTip, smoothstep( 0.22, 0.86, tuft ) );
          // It follows the year at a distance: brighter in spring, duller by late autumn
          mossHue = mix( mossHue, creekGrass( mossHue, creekGround ), 0.4 );
          diffuseColor.rgb = mix( diffuseColor.rgb, mossHue * mix( 1.0, painted, 0.62 ), moss * 0.96 );

          // Snow drifts up against the foot of a stone
          creekSnowLift = ( 1.0 - vStone.y ) * 0.42 * vStone.z;
        }
      `,
    },
  });

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
  // Bark is drawn deeper than sawn timber: dark furrows between pale ridges.
  // Moss grows on it where a vertex says so (aMoss): at the foot of a trunk,
  // furthest up the side the sun does not dry, and over a log that lies in
  // the grass. The painted cushions decide where exactly it ends.
  const bark = stylized({
    name: 'bark',
    rim: 0.14,
    wash: 0.5,
    sway: true,
    uniforms: { uGrain: { value: textures.bark }, ...mossy },
    hooks: {
      vertexPars: /* glsl */ `
        attribute float aMoss;
        varying vec2 vGrainUv;
        varying vec4 vBark; // the way the bark faces, and how mossy it is
      `,
      vertexLocal: /* glsl */ `
        vGrainUv = uv;
        vBark = vec4( normal, aMoss );
      `,
      fragmentPars: /* glsl */ `
        uniform sampler2D uGrain;
        uniform sampler2D uMoss;
        uniform vec3 uMossDeep;
        uniform vec3 uMossTip;
        varying vec2 vGrainUv;
        varying vec4 vBark;
      `,
      fragmentAlbedo: /* glsl */ `
        {
          // The light and shade painted on the bark, which the moss keeps
          float painted = min( 1.3, dot( diffuseColor.rgb, vec3( 0.3, 0.5, 0.2 ) ) * 3.2 );
          float furrow = texture2D( uGrain, vGrainUv ).r;
          diffuseColor.rgb *= 0.42 + 1.16 * furrow;
          vec3 face = abs( normalize( vBark.xyz ) );
          face *= face;
          face /= face.x + face.y + face.z;
          vec3 at = vWorldPos * 2.3;
          float tuft = texture2D( uMoss, at.zy ).r * face.x + texture2D( uMoss, at.xz ).r * face.y + texture2D( uMoss, at.xy ).r * face.z;
          // It settles in the furrows first, and only where there is any at all
          float lives = smoothstep( 0.02, 0.3, vBark.w );
          float moss = smoothstep( 0.42, 0.6, vBark.w + ( ( tuft - 0.5 ) * 0.85 + ( 0.5 - furrow ) * 0.3 ) * lives );
          vec3 mossHue = mix( uMossDeep, uMossTip, smoothstep( 0.22, 0.86, tuft ) );
          mossHue = mix( mossHue, creekGrass( mossHue, creekGround ), 0.4 );
          diffuseColor.rgb = mix( diffuseColor.rgb, mossHue * mix( 1.0, painted, 0.5 ), moss * 0.95 );
        }
      `,
    },
  });
  // Birch bark: white, with its dark marks lying across the trunk. The
  // coordinates run round the trunk in radians and up it in quarters of a metre.
  const birchBark = stylized({
    name: 'birch-bark',
    rim: 0.16,
    wash: 0.35,
    wet: 0.7,
    sway: true,
    hooks: {
      vertexPars: /* glsl */ `varying vec2 vGrainUv;`,
      vertexLocal: /* glsl */ `vGrainUv = uv;`,
      fragmentPars: /* glsl */ `varying vec2 vGrainUv;`,
      fragmentAlbedo: /* glsl */ `
        {
          vec2 bark = vGrainUv;
          // The white peels in bands and is a little warmer underneath
          float peel = creekNoise( vec2( bark.x * 0.6 + 9.0, bark.y * 2.6 ) );
          diffuseColor.rgb *= mix( vec3( 1.0 ), vec3( 1.02, 0.95, 0.86 ), smoothstep( 0.5, 0.82, peel ) * 0.55 );
          // Broad scars where a branch was shed...
          float blot = creekNoise( vec2( bark.x * 1.3, bark.y * 4.6 ) );
          float scar = smoothstep( 0.66, 0.73, blot ) * smoothstep( 0.22, 0.5, creekNoise( vec2( bark.x * 3.1 + 3.0, bark.y * 1.1 ) ) );
          // ...and between them rows of fine dashes, which show only from near by
          vec2 at = vec2( bark.x * 1.7, bark.y * 6.5 );
          float near = 1.0 - smoothstep( 0.3, 0.8, fwidth( at.y ) );
          float line = floor( at.y );
          float along = at.x + creekHash( vec2( line, 7.3 ) ) * 17.0;
          float one = creekHash( vec2( floor( along ), line ) );
          float reach = 0.1 + 0.3 * fract( one * 13.7 );
          float dash = step( 0.45, one ) * ( 1.0 - smoothstep( reach * 0.6, reach, abs( fract( along ) - 0.5 ) ) )
            * ( 1.0 - smoothstep( 0.05, 0.14, abs( fract( at.y ) - 0.5 - ( one - 0.72 ) * 0.8 ) ) );
          // Old bark at the foot is dark and cracked
          float foot = 1.0 - smoothstep( 0.6, 3.4, bark.y + ( creekNoise( vec2( bark.x * 2.0, bark.y * 0.5 ) ) - 0.5 ) * 2.2 );
          float crack = smoothstep( 0.5, 0.68, creekNoise( vec2( bark.x * 5.0, bark.y * 0.8 ) ) ) * foot;
          diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.07, 0.08, 0.12 ), max( scar * 0.84, max( dash * near * 0.62, crack * 0.8 ) ) );
        }
      `,
    },
  });

  // Leaves. The sprite carries painted light and shade; the tint comes from
  // each card's vertex colour, and the canopy's shape supplies the normal.
  // `seasonal` leaves turn, fall and come back with the year; the rest are evergreen.
  const leafHooks = { vertexPars: LEAF_PARS + BARE_PARS, vertexLocal: 'vBare = 0.0;' + LEAF_MOVE + LEAF_TINT, fragmentPars: BARE_PARS, fragmentAlbedo: BARE_ALBEDO };
  const leafMaterials = new Map();
  const leaves = (texture, { sway = true, alphaTest = 0.36, seasonal = false } = {}) => {
    const key = `${texture.name}:${sway}:${alphaTest}:${seasonal}`;
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
        glow: 0.3,
        wet: 0.3,
        sway,
        hooks: seasonal ? leafHooks : {},
      });
      leafMaterials.set(key, m);
    }
    return m;
  };
  // Blossom: painted clusters that open on the flowering bushes in spring.
  // The sprite brings its own colour; the card's tint turns it white or pink.
  const blossom = stylized({
    name: 'blossom',
    map: textures.blossom,
    alphaTest: 0.42,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    keepNormals: true,
    ramp: 0.7,
    wrap: 0.6,
    rim: 0.05,
    wash: 0.18,
    snow: 0,
    glow: 0.22,
    wet: 0.2,
    sway: true,
    hooks: { vertexPars: LEAF_PARS, vertexLocal: BLOOM_MOVE },
  });
  // The soft body of a canopy behind its leaf cards
  const canopy = stylized({ name: 'canopy', ramp: 0.75, wrap: 0.4, rim: 0.1, wash: 0.55, wet: 0.3, sway: true });
  // ...and the same body under leaves that fall
  const crown = stylized({
    name: 'crown',
    ramp: 0.75,
    wrap: 0.4,
    rim: 0.1,
    wash: 0.55,
    wet: 0.3,
    sway: true,
    uniforms: { uFoliage: { value: textures.foliageOak } },
    hooks: {
      vertexPars: LEAF_PARS + BODY_PARS,
      vertexLocal: 'vBody = position;' + BODY_MOVE + LEAF_TINT,
      fragmentPars: BODY_PARS + 'uniform sampler2D uFoliage;',
      fragmentAlbedo: BODY_ALBEDO,
    },
  });
  // Bare twigs, seen once the leaves are down. Frost takes to them readily.
  const twigs = stylized({
    name: 'twigs',
    map: textures.twigs,
    alphaTest: 0.3,
    alphaToCoverage: true,
    side: THREE.DoubleSide,
    keepNormals: true,
    ramp: 0.75,
    wrap: 0.42,
    rim: 0.08,
    wash: 0.3,
    snow: 0.85,
    sway: true,
    hooks: { vertexPars: LEAF_PARS, vertexLocal: TWIG_MOVE },
  });

  // The materials of one seasonal set, all driven by the set's own `uPop`
  const popHooks = { vertexPars: POP_PARS, vertexLocal: POP_MOVE };
  const seasonal = (uPop) => {
    const shadow = shadowOf({ name: 'pop', uniforms: { uPop }, hooks: popHooks });
    const shadowDouble = shadowOf({ name: 'pop', uniforms: { uPop }, hooks: popHooks });
    shadowDouble.side = THREE.DoubleSide;
    return {
      solid: stylized({ name: 'solid-pop', rim: 0.16, wash: 0.5, uniforms: { uPop }, hooks: popHooks }),
      double: stylized({ name: 'solid-double-pop', rim: 0.1, wash: 0.4, side: THREE.DoubleSide, thin: 0.7, uniforms: { uPop }, hooks: popHooks }),
      wood: stylized({
        name: 'wood-pop',
        rim: 0.12,
        wash: 0.4,
        uniforms: { uGrain: { value: textures.woodgrain }, uPop },
        hooks: { ...grainHooks, vertexPars: grainHooks.vertexPars + POP_PARS, vertexLocal: grainHooks.vertexLocal + POP_MOVE },
      }),
      // Painted on the ground: puddles, footprints. No snow settles on them.
      flat: stylized({ name: 'flat-pop', rim: 0.34, wash: 0.3, snow: 0, wet: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, uniforms: { uPop }, hooks: popHooks }),
      shadow,
      shadowDouble,
    };
  };

  // Shadows that follow the same year: what has fallen casts nothing
  const shadows = {
    leaves: () => shadowOf({ name: 'leaves', hooks: { vertexPars: LEAF_PARS, vertexLocal: LEAF_MOVE_SHADOW } }),
    crown: shadowOf({ name: 'crown', hooks: { vertexPars: LEAF_PARS, vertexLocal: BODY_MOVE } }),
    twigs: shadowOf({ name: 'twigs', hooks: { vertexPars: LEAF_PARS, vertexLocal: TWIG_MOVE } }),
  };

  return { solid, solidDouble, creature, creatureDouble, rock, wood, bark, birchBark, leaves, blossom, canopy, crown, twigs, shadows, seasonal };
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
