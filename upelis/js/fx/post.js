import * as THREE from '../core/three.js';

// The finishing pass: the scene is drawn into a floating-point buffer, then
// given a soft tilt-shift focus, a little bloom, a gentle grade and a
// watercolour-paper grain before it reaches the screen.

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const DEPTH_GLSL = /* glsl */ `
uniform sampler2D tDepth;
uniform vec2 uNearFar;
float viewDepth( vec2 uv ) {
  float d = texture2D( tDepth, uv ).x;
  float n = uNearFar.x;
  float f = uNearFar.y;
  return ( n * f ) / ( f - d * ( f - n ) );
}
`;

// Half-resolution copy of the picture with the blur amount in alpha
const DOWN_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform vec4 uFocus; // distance, sharp range, far falloff, near falloff
varying vec2 vUv;
${DEPTH_GLSL}
void main() {
  vec3 c = vec3( 0.0 );
  float coc = 0.0;
  for ( int i = 0; i < 4; i ++ ) {
    vec2 o = vec2( i == 0 || i == 2 ? -0.5 : 0.5, i < 2 ? -0.5 : 0.5 ) * uTexel;
    vec3 s = min( texture2D( tColor, vUv + o ).rgb, vec3( 6.0 ) );
    float z = viewDepth( vUv + o );
    float far = clamp( ( z - uFocus.x - uFocus.y ) / uFocus.z, 0.0, 1.0 );
    float near = clamp( ( uFocus.x - uFocus.y - z ) / uFocus.w, 0.0, 1.0 );
    c += s;
    coc += max( far, near );
  }
  gl_FragColor = vec4( c * 0.25, coc * 0.25 );
}
`;

const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uRadius;
varying vec2 vUv;
float ign( vec2 p ) {
  return fract( 52.9829189 * fract( dot( p, vec2( 0.06711056, 0.00583715 ) ) ) );
}
void main() {
  vec4 centre = texture2D( tColor, vUv );
  float radius = centre.a * uRadius;
  if ( radius < 0.35 ) {
    gl_FragColor = centre;
    return;
  }
  float rot = ign( gl_FragCoord.xy ) * 6.2831853;
  vec3 sum = centre.rgb;
  float total = 1.0;
  for ( int i = 0; i < DOF_TAPS; i ++ ) {
    float r = sqrt( ( float( i ) + 0.5 ) / float( DOF_TAPS ) );
    float a = float( i ) * 2.39996323 + rot;
    vec4 s = textureLod( tColor, vUv + vec2( cos( a ), sin( a ) ) * r * radius * uTexel, 0.0 );
    // What is in focus must not smear into what is not
    float w = clamp( s.a / max( centre.a, 0.001 ), 0.0, 1.0 );
    sum += s.rgb * w;
    total += w;
  }
  gl_FragColor = vec4( sum / total, centre.a );
}
`;

const TENT_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 o = uTexel.xyxy * vec4( -1.0, -1.0, 1.0, 1.0 );
  vec4 s = texture2D( tColor, vUv ) * 4.0;
  s += texture2D( tColor, vUv + vec2( o.x, 0.0 ) ) * 2.0;
  s += texture2D( tColor, vUv + vec2( o.z, 0.0 ) ) * 2.0;
  s += texture2D( tColor, vUv + vec2( 0.0, o.y ) ) * 2.0;
  s += texture2D( tColor, vUv + vec2( 0.0, o.w ) ) * 2.0;
  s += texture2D( tColor, vUv + o.xy );
  s += texture2D( tColor, vUv + o.zy );
  s += texture2D( tColor, vUv + o.xw );
  s += texture2D( tColor, vUv + o.zw );
  gl_FragColor = s / 16.0;
}
`;

const BRIGHT_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform vec2 uThreshold; // threshold, knee
varying vec2 vUv;
void main() {
  vec4 o = uTexel.xyxy * vec4( -1.0, -1.0, 1.0, 1.0 );
  vec3 c = texture2D( tColor, vUv + o.xy ).rgb + texture2D( tColor, vUv + o.zy ).rgb + texture2D( tColor, vUv + o.xw ).rgb + texture2D( tColor, vUv + o.zw ).rgb;
  c *= 0.25;
  float l = max( c.r, max( c.g, c.b ) );
  float soft = clamp( l - uThreshold.x + uThreshold.y, 0.0, 2.0 * uThreshold.y );
  soft = soft * soft / ( 4.0 * uThreshold.y + 0.0001 );
  float k = max( soft, l - uThreshold.x ) / max( l, 0.0001 );
  gl_FragColor = vec4( c * k, 1.0 );
}
`;

const DOWNSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
varying vec2 vUv;
void main() {
  vec4 o = uTexel.xyxy * vec4( -1.0, -1.0, 1.0, 1.0 );
  vec3 c = texture2D( tColor, vUv ).rgb * 4.0;
  c += texture2D( tColor, vUv + o.xy ).rgb + texture2D( tColor, vUv + o.zy ).rgb + texture2D( tColor, vUv + o.xw ).rgb + texture2D( tColor, vUv + o.zw ).rgb;
  gl_FragColor = vec4( c / 8.0, 1.0 );
}
`;

const UPSAMPLE_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform vec2 uTexel;
uniform float uGain;
varying vec2 vUv;
void main() {
  vec4 o = uTexel.xyxy * vec4( -1.0, -1.0, 1.0, 1.0 );
  vec3 c = texture2D( tColor, vUv ).rgb * 4.0;
  c += ( texture2D( tColor, vUv + vec2( o.x, 0.0 ) ).rgb + texture2D( tColor, vUv + vec2( o.z, 0.0 ) ).rgb + texture2D( tColor, vUv + vec2( 0.0, o.y ) ).rgb + texture2D( tColor, vUv + vec2( 0.0, o.w ) ).rgb ) * 2.0;
  c += texture2D( tColor, vUv + o.xy ).rgb + texture2D( tColor, vUv + o.zy ).rgb + texture2D( tColor, vUv + o.xw ).rgb + texture2D( tColor, vUv + o.zw ).rgb;
  gl_FragColor = vec4( c / 16.0 * uGain, 1.0 );
}
`;

const FINAL_FRAGMENT = /* glsl */ `
uniform sampler2D tColor;
uniform sampler2D tBlur;
uniform sampler2D tBloom;
uniform sampler2D tPaper;
uniform vec2 uResolution;
uniform float uBloom;
uniform float uDof;
uniform float uTime;
uniform float uReveal;
varying vec2 vUv;

float hash( vec2 p ) {
  vec3 q = fract( vec3( p.xyx ) * 0.1031 );
  q += dot( q, q.yzx + 33.33 );
  return fract( ( q.x + q.y ) * q.z );
}

// Keeps the authored pastel values and only rolls the highlights off
vec3 softClip( vec3 c ) {
  const float knee = 0.78;
  vec3 over = max( c - knee, 0.0 ) / ( 1.0 - knee );
  return min( c, vec3( knee ) ) + ( 1.0 - knee ) * ( 1.0 - exp( - over ) );
}

vec3 toSRGB( vec3 c ) {
  return mix( c * 12.92, 1.055 * pow( max( c, vec3( 0.0 ) ), vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
}

void main() {
  vec3 c = texture2D( tColor, vUv ).rgb;

  #ifdef USE_DOF
    vec4 blur = texture2D( tBlur, vUv );
    c = mix( c, blur.rgb, smoothstep( 0.04, 0.42, blur.a ) * uDof );
  #endif

  #ifdef USE_BLOOM
    c += texture2D( tBloom, vUv ).rgb * uBloom;
  #endif

  c = softClip( max( c, vec3( 0.0 ) ) );

  // Grade: a touch more colour, cool lilac shadows, warm lights
  float luma = dot( c, vec3( 0.2126, 0.7152, 0.0722 ) );
  c = mix( vec3( luma ), c, 1.07 );
  c += vec3( 0.006, 0.01, 0.026 ) * ( 1.0 - smoothstep( 0.0, 0.45, luma ) );
  c *= mix( vec3( 1.0 ), vec3( 1.018, 1.004, 0.972 ), smoothstep( 0.45, 1.0, luma ) );

  // The corners lift towards paper white, like an unpainted margin
  vec2 q = vUv - 0.5;
  float edge = smoothstep( 0.32, 0.86, dot( q, q ) * 2.1 );
  c = mix( c, vec3( 0.93, 0.955, 0.985 ), edge * 0.2 );

  c = toSRGB( c );

  // Cold-press paper: a broad wash and a fine tooth
  vec2 paperUv = gl_FragCoord.xy / uResolution.y;
  float paper = texture2D( tPaper, paperUv * 1.35 ).r - 0.5;
  float tooth = texture2D( tPaper, paperUv * 5.3 + 0.21 ).r - 0.5;
  c *= 1.0 + paper * 0.03 + tooth * 0.022;

  // Dither away banding in the sky
  float n = hash( gl_FragCoord.xy + fract( uTime ) * 61.0 ) + hash( gl_FragCoord.yx + 17.0 + fract( uTime ) * 37.0 ) - 1.0;
  c += n / 255.0;

  gl_FragColor = vec4( mix( vec3( 0.957, 0.969, 0.988 ), c, uReveal ), 1.0 );
}
`;

export function createPost(renderer, quality, paperTexture) {
  const gl = renderer.getContext();
  const floatTargets = renderer.capabilities.isWebGL2 !== false && (renderer.extensions.has('EXT_color_buffer_half_float') || renderer.extensions.has('EXT_color_buffer_float'));
  const active = quality.post && floatTargets;

  const state = { reveal: 1, bloom: quality.bloom, dof: quality.dof ? 1 : 0 };

  if (!active) {
    // Plain path: draw straight to the canvas and let three encode the colour
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    return {
      active: false,
      state,
      setSize() {},
      render(scene, camera) {
        renderer.setRenderTarget(null);
        renderer.render(scene, camera);
      },
    };
  }

  const type = THREE.HalfFloatType;
  const targetOptions = { type, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false };

  const maxSamples = gl.getParameter(gl.MAX_SAMPLES) || 0;
  const sceneTarget = new THREE.WebGLRenderTarget(4, 4, {
    type,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    samples: Math.min(quality.msaa, maxSamples),
    depthBuffer: true,
    stencilBuffer: false,
  });
  sceneTarget.depthTexture = new THREE.DepthTexture(4, 4);
  sceneTarget.depthTexture.minFilter = sceneTarget.depthTexture.magFilter = THREE.NearestFilter;

  const half = [0, 1, 2].map(() => new THREE.WebGLRenderTarget(2, 2, targetOptions));
  const BLOOM_LEVELS = 5;
  const bloomDown = [];
  const bloomUp = [];
  for (let i = 0; i < BLOOM_LEVELS; i++) {
    bloomDown.push(new THREE.WebGLRenderTarget(2, 2, targetOptions));
    if (i < BLOOM_LEVELS - 1) bloomUp.push(new THREE.WebGLRenderTarget(2, 2, targetOptions));
  }

  const quadScene = new THREE.Scene();
  const quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const triangle = new THREE.BufferGeometry();
  triangle.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
  const quad = new THREE.Mesh(triangle);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const pass = (fragmentShader, uniforms, defines = {}) =>
    new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader,
      uniforms,
      defines,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });

  const texel = () => ({ value: new THREE.Vector2() });

  const downMaterial = pass(DOWN_FRAGMENT, {
    tColor: { value: sceneTarget.texture },
    tDepth: { value: sceneTarget.depthTexture },
    uTexel: texel(),
    uNearFar: { value: new THREE.Vector2(1, 100) },
    uFocus: { value: new THREE.Vector4(60, 10, 30, 20) },
  });
  const blurMaterial = pass(BLUR_FRAGMENT, { tColor: { value: null }, uTexel: texel(), uRadius: { value: 8 } }, { DOF_TAPS: quality.dofTaps });
  const tentMaterial = pass(TENT_FRAGMENT, { tColor: { value: null }, uTexel: texel() });
  const brightMaterial = pass(BRIGHT_FRAGMENT, { tColor: { value: null }, uTexel: texel(), uThreshold: { value: new THREE.Vector2(0.9, 0.35) } });
  const downsampleMaterial = pass(DOWNSAMPLE_FRAGMENT, { tColor: { value: null }, uTexel: texel() });
  const upsampleMaterial = pass(UPSAMPLE_FRAGMENT, { tColor: { value: null }, uTexel: texel(), uGain: { value: 1 } });
  const addMaterial = pass(UPSAMPLE_FRAGMENT, { tColor: { value: null }, uTexel: texel(), uGain: { value: 1 } });
  addMaterial.blending = THREE.CustomBlending;
  addMaterial.blendEquation = THREE.AddEquation;
  addMaterial.blendSrc = THREE.OneFactor;
  addMaterial.blendDst = THREE.OneFactor;
  addMaterial.transparent = true;

  const finalDefines = {};
  if (quality.dof) finalDefines.USE_DOF = '';
  if (quality.bloom > 0) finalDefines.USE_BLOOM = '';
  const finalMaterial = pass(
    FINAL_FRAGMENT,
    {
      tColor: { value: sceneTarget.texture },
      tBlur: { value: half[2].texture },
      tBloom: { value: bloomUp[0].texture },
      tPaper: { value: paperTexture },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBloom: { value: quality.bloom },
      uDof: { value: 1 },
      uTime: { value: 0 },
      uReveal: { value: 1 },
    },
    finalDefines
  );

  const size = { w: 4, h: 4 };

  function setSize(width, height) {
    size.w = Math.max(4, Math.floor(width));
    size.h = Math.max(4, Math.floor(height));
    sceneTarget.setSize(size.w, size.h);
    const hw = Math.max(2, size.w >> 1);
    const hh = Math.max(2, size.h >> 1);
    for (const t of half) t.setSize(hw, hh);
    for (let i = 0; i < BLOOM_LEVELS; i++) {
      const w = Math.max(2, size.w >> (i + 2));
      const h = Math.max(2, size.h >> (i + 2));
      bloomDown[i].setSize(w, h);
      if (bloomUp[i]) bloomUp[i].setSize(w, h);
    }
    finalMaterial.uniforms.uResolution.value.set(size.w, size.h);
  }

  function draw(material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCamera);
  }

  function render(scene, camera, { focus = 60, time = 0 } = {}) {
    renderer.setRenderTarget(sceneTarget);
    renderer.render(scene, camera);

    const wasAutoClear = renderer.autoClear;
    renderer.autoClear = false;

    if (quality.dof || quality.bloom > 0) {
      // Half-resolution copy with the blur amount
      downMaterial.uniforms.uTexel.value.set(1 / size.w, 1 / size.h);
      downMaterial.uniforms.uNearFar.value.set(camera.near, camera.far);
      downMaterial.uniforms.uFocus.value.set(focus, focus * 0.19, focus * 0.62, focus * 0.3);
      draw(downMaterial, half[0]);
    }

    if (quality.dof && state.dof > 0) {
      const ht = half[0];
      blurMaterial.uniforms.tColor.value = half[0].texture;
      blurMaterial.uniforms.uTexel.value.set(1 / ht.width, 1 / ht.height);
      blurMaterial.uniforms.uRadius.value = (quality.dofRadius * ht.height) / 540;
      draw(blurMaterial, half[1]);
      tentMaterial.uniforms.tColor.value = half[1].texture;
      tentMaterial.uniforms.uTexel.value.set(1 / ht.width, 1 / ht.height);
      draw(tentMaterial, half[2]);
    }

    if (quality.bloom > 0) {
      brightMaterial.uniforms.tColor.value = half[0].texture;
      brightMaterial.uniforms.uTexel.value.set(1 / half[0].width, 1 / half[0].height);
      draw(brightMaterial, bloomDown[0]);
      for (let i = 1; i < BLOOM_LEVELS; i++) {
        downsampleMaterial.uniforms.tColor.value = bloomDown[i - 1].texture;
        downsampleMaterial.uniforms.uTexel.value.set(1 / bloomDown[i - 1].width, 1 / bloomDown[i - 1].height);
        draw(downsampleMaterial, bloomDown[i]);
      }
      // Walk back up, adding each wider glow to the finer one below it
      let wide = bloomDown[BLOOM_LEVELS - 1];
      for (let i = BLOOM_LEVELS - 2; i >= 0; i--) {
        const out = bloomUp[i];
        upsampleMaterial.uniforms.tColor.value = bloomDown[i].texture;
        upsampleMaterial.uniforms.uTexel.value.set(0, 0);
        upsampleMaterial.uniforms.uGain.value = 1;
        draw(upsampleMaterial, out);
        addMaterial.uniforms.tColor.value = wide.texture;
        addMaterial.uniforms.uTexel.value.set(1 / wide.width, 1 / wide.height);
        addMaterial.uniforms.uGain.value = 1;
        draw(addMaterial, out);
        wide = out;
      }
    }

    finalMaterial.uniforms.uTime.value = time;
    finalMaterial.uniforms.uReveal.value = state.reveal;
    finalMaterial.uniforms.uBloom.value = state.bloom / (BLOOM_LEVELS - 1) * 1.6;
    finalMaterial.uniforms.uDof.value = state.dof;
    draw(finalMaterial, null);

    renderer.autoClear = wasAutoClear;
  }

  return { active: true, state, setSize, render, sceneTarget };
}
