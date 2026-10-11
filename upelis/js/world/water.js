import * as THREE from '../core/three.js';
import { clamp, lerp, saturate, smoothstep } from '../core/math.js';
import { palette, col } from '../core/palette.js';
import { noiseGLSL, shared } from '../core/materials.js';

// The creek's water: one surface that follows the stream bed, two waterfalls,
// and the height map that tells the shader how deep the water is at any point.

const GRID = 0.16;
const MAX_RIPPLES = 8;

const WATER_VERTEX = /* glsl */ `
#include <common>
#include <shadowmap_pars_vertex>
attribute vec4 aFlow; // distance from the centreline, travel time, speed, turbulence
uniform float uTime;
varying vec4 vFlow;
varying vec3 vWorldPos;

void main() {
  #include <beginnormal_vertex>
  #include <defaultnormal_vertex>
  #include <begin_vertex>
  // A slow swell keeps the still water alive
  float calm = 1.0 - saturate( aFlow.w * 1.6 );
  transformed.y += ( sin( position.x * 1.7 + uTime * 1.05 ) * cos( position.z * 1.4 - uTime * 0.8 ) ) * 0.011 * calm;
  #include <project_vertex>
  #include <worldpos_vertex>
  #include <shadowmap_vertex>
  vWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  vFlow = aFlow;
}
`;

const WATER_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeightMap;
uniform vec4 uMap;
uniform sampler2D uWash;
uniform vec3 uShallow;
uniform vec3 uMid;
uniform vec3 uDeep;
uniform vec3 uFoam;
uniform vec3 uSky;
uniform vec3 uShade;
uniform vec4 uRipples[ ${MAX_RIPPLES} ];
varying vec4 vFlow;
varying vec3 vWorldPos;

#include <common>
#include <bsdfs>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>
${noiseGLSL}

void main() {
  float ground = texture2D( uHeightMap, vWorldPos.xz * uMap.zw + uMap.xy ).r;
  float depth = vWorldPos.y - ground;
  if ( depth < -0.035 ) discard;
  float d = max( depth, 0.0 );

  float lat = vFlow.x;
  float tau = vFlow.y;
  float speed = vFlow.z;
  float turb = vFlow.w;
  float t = uTime;
  float quick = smoothstep( 0.45, 1.5, speed );

  // Painted light bands carried by the current (travel-time space, so they
  // never shear however the speed changes along the stream)
  float bandA = texture2D( uWash, vec2( lat * 0.21, ( tau - t ) * 0.115 ) ).r;
  float bandB = texture2D( uWash, vec2( lat * 0.38 + 0.37, ( tau - t * 1.3 ) * 0.2 + 0.11 ) ).r;
  float bands = bandA * 0.62 + bandB * 0.38;
  float streak = smoothstep( 0.53, 0.72, bands );

  // Wind ripples on the still parts
  vec2 rp = vWorldPos.xz * 2.6;
  float rippleA = creekNoise( rp + vec2( t * 0.32, t * 0.21 ) );
  float rippleB = creekNoise( rp * 1.9 - vec2( t * 0.27, t * 0.36 ) + 4.7 );
  float ripple = rippleA * 0.6 + rippleB * 0.4;

  // Body colour by depth
  vec3 c = mix( uShallow, uMid, smoothstep( 0.02, 0.36, d ) );
  c = mix( c, uDeep, smoothstep( 0.28, 0.95, d ) * 0.86 );
  float alpha = mix( 0.26, 0.93, smoothstep( 0.0, 0.6, d ) );

  // Sheen: the sky lies on the water, more at a glancing view
  vec3 viewDir = normalize( cameraPosition - vWorldPos );
  float fresnel = pow( 1.0 - saturate( viewDir.y + ( ripple - 0.5 ) * 0.16 ), 2.6 );
  c = mix( c, uSky, saturate( fresnel * 0.62 + streak * ( 0.1 + 0.2 * quick ) + ( ripple - 0.5 ) * 0.1 ) );
  alpha = max( alpha, fresnel * 0.7 );

  float lit = getShadowMask();
  c *= mix( uShade, vec3( 1.06, 1.05, 1.03 ), lit );

  // Foam where the water meets the bank, with a slow lapping line beyond it
  float edgeNoise = texture2D( uWash, vWorldPos.xz * 0.23 + vec2( t * 0.011, - t * 0.008 ) ).r;
  float fine = creekNoise( vWorldPos.xz * 11.0 + vec2( t * 0.4, - t * 0.3 ) );
  float foamEdge = 1.0 - smoothstep( 0.012, 0.04 + 0.06 * edgeNoise, d + ( fine - 0.5 ) * 0.016 );
  float lapPhase = d * 10.0 - t * 0.65 + edgeNoise * 6.0;
  float lap = smoothstep( 0.78, 0.97, sin( lapPhase ) ) * ( 1.0 - smoothstep( 0.1, 0.3, d ) ) * smoothstep( 0.03, 0.08, d );

  // Churned water below the falls and through the rapids
  float churnNoise = texture2D( uWash, vec2( lat * 0.5 + 0.2, ( tau - t * 1.15 ) * 0.34 ) ).r * 0.65 + fine * 0.35;
  float churnAmount = saturate( turb * 1.25 + quick * 0.22 );
  float churn = smoothstep( 0.78 - churnAmount * 0.42, 0.9 - churnAmount * 0.3, churnNoise ) * saturate( churnAmount * 1.4 );

  // Rings spreading from whatever touched the surface
  float rings = 0.0;
  for ( int i = 0; i < ${MAX_RIPPLES}; i ++ ) {
    vec4 r = uRipples[ i ];
    float age = t - r.z;
    if ( r.w > 0.0 && age > 0.0 && age < 5.0 ) {
      float x = distance( vWorldPos.xz, r.xy ) - age * 0.5;
      float fade = r.w * exp( - age * 0.75 ) * smoothstep( 5.0, 3.4, age );
      rings += fade * ( exp( - x * x * 420.0 ) + 0.55 * exp( - ( x + 0.2 ) * ( x + 0.2 ) * 300.0 ) * step( 0.2, age * 0.5 ) );
    }
  }

  float foam = saturate( foamEdge + lap * 0.62 + churn * 0.9 + rings * 0.85 );
  c = mix( c, uFoam * mix( 0.86, 1.08, lit ), foam * 0.94 );
  alpha = max( alpha, foam * 0.96 );

  // Glitter in the sun
  float sparkle = creekNoise( vWorldPos.xz * 17.0 + vec2( t * 0.7, t * 0.2 ) ) * creekNoise( vWorldPos.xz * 11.0 - vec2( t * 0.5, t * 0.6 ) + 9.0 );
  c += vec3( 1.0, 0.98, 0.92 ) * smoothstep( 0.56, 0.74, sparkle ) * lit * ( 0.55 + quick * 0.5 ) * smoothstep( 0.03, 0.2, d );

  alpha *= smoothstep( -0.035, 0.012, depth );
  gl_FragColor = vec4( c, alpha );
  #include <colorspace_fragment>
}
`;

const FALL_VERTEX = /* glsl */ `
attribute vec3 aFall; // across (-1..1), metres fallen, opacity
varying vec3 vFall;
varying vec3 vWorldPos;
void main() {
  vFall = aFall;
  vec4 world = modelMatrix * vec4( position, 1.0 );
  vWorldPos = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FALL_FRAGMENT = /* glsl */ `
uniform float uTime;
uniform sampler2D uWash;
uniform vec3 uWater;
uniform vec3 uFoam;
uniform vec3 uHazeColor;
uniform vec4 uShape; // length, speed, top fade, bottom fade (metres)
varying vec3 vFall;
varying vec3 vWorldPos;
${noiseGLSL}

void main() {
  float u = vFall.x;
  float y = vFall.y;
  float t = uTime;

  // Falling water stretches into long ribbons that speed up as they drop
  float fallen = sqrt( y + 0.05 ) * 1.9 - t * uShape.y;
  float a = texture2D( uWash, vec2( u * 0.23, fallen * 0.085 ) ).r;
  float b = texture2D( uWash, vec2( u * 0.46 + 0.31, fallen * 0.15 + 0.2 ) ).r;
  float c = creekNoise( vec2( u * 9.0, fallen * 2.4 ) );
  float ribbons = a * 0.5 + b * 0.32 + c * 0.18;

  vec3 colour = mix( uWater, uFoam, smoothstep( 0.4, 0.66, ribbons ) );
  // White water at the lip and where it lands
  float lip = 1.0 - smoothstep( 0.0, 0.28, y );
  float foot = uShape.w > 0.0 ? 0.0 : smoothstep( uShape.x - 0.42, uShape.x - 0.05, y );
  colour = mix( colour, uFoam, clamp( lip * 0.55 + foot * 0.85, 0.0, 1.0 ) );

  // Frayed sides
  float side = 1.0 - smoothstep( 0.62 + 0.3 * b, 1.0, abs( u ) );
  float alpha = side * mix( 0.72, 1.0, smoothstep( 0.38, 0.7, ribbons ) ) * vFall.z;
  alpha *= smoothstep( 0.0, uShape.z, y );
  if ( uShape.w > 0.0 ) {
    // The long fall thins into spray and is lost in the haze
    float gone = smoothstep( uShape.x - uShape.w, uShape.x, y );
    alpha *= 1.0 - gone;
    alpha *= mix( 1.0, smoothstep( 0.3, 0.75, ribbons ), smoothstep( 0.15, 0.8, y / uShape.x ) );
    colour = mix( colour, uHazeColor, gone * 0.6 );
  }

  gl_FragColor = vec4( colour, alpha );
  #include <colorspace_fragment>
}
`;

export function createWater(field, textures, { obstacles = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'water';
  const creek = field.creek;
  const { minX, minZ, maxX, maxZ } = field.bounds;

  // ---------- Height map: the ground as the water sees it ----------
  const cell = field.cell;
  const nx = Math.round((maxX - minX) / cell) + 1;
  const nz = Math.round((maxZ - minZ) / cell) + 1;
  const heights = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    const z = minZ + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = minX + i * cell;
      const e = field.edge(x, z);
      // Past the rim the map climbs steeply, so the surface ends exactly at
      // the edge of the island with a lip of white water.
      heights[j * nx + i] = e >= 0 ? field.height(x, z) : field.level(x, z) + 0.02 - e * 5;
    }
  }
  // Stones and other things standing in the water push the map up, so the
  // shader rings them with foam without knowing they exist.
  for (const o of obstacles) {
    const reach = Math.max(o.rx, o.rz) + cell;
    const i0 = Math.max(0, Math.floor((o.x - reach - minX) / cell));
    const i1 = Math.min(nx - 1, Math.ceil((o.x + reach - minX) / cell));
    const j0 = Math.max(0, Math.floor((o.z - reach - minZ) / cell));
    const j1 = Math.min(nz - 1, Math.ceil((o.z + reach - minZ) / cell));
    const cs = Math.cos(o.yaw || 0);
    const sn = Math.sin(o.yaw || 0);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const dx = minX + i * cell - o.x;
        const dz = minZ + j * cell - o.z;
        const lx = (dx * cs - dz * sn) / o.rx;
        const lz = (dx * sn + dz * cs) / o.rz;
        const rho = lx * lx + lz * lz;
        if (rho >= 1) continue;
        const h = o.top - (1 - Math.sqrt(1 - rho)) * (o.dome ?? 0.3);
        const k = j * nx + i;
        if (h > heights[k]) heights[k] = h;
      }
    }
  }
  const half = new Uint16Array(nx * nz);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]);
  const heightMap = new THREE.DataTexture(half, nx, nz, THREE.RedFormat, THREE.HalfFloatType);
  heightMap.minFilter = heightMap.magFilter = THREE.LinearFilter;
  heightMap.wrapS = heightMap.wrapT = THREE.ClampToEdgeWrapping;
  heightMap.needsUpdate = true;
  // world xz -> texture uv (texel centres sit on the grid points)
  const mapTransform = new THREE.Vector4(
    (0.5 - minX / cell) / nx,
    (0.5 - minZ / cell) / nz,
    1 / (cell * nx),
    1 / (cell * nz)
  );

  // ---------- Travel time along the stream ----------
  const tau = new Float32Array(creek.n);
  for (let i = 1; i < creek.n; i++) tau[i] = tau[i - 1] + creek.ds / ((creek.speed[i] + creek.speed[i - 1]) * 0.5);
  const sampleArr = (arr, fi) => {
    const f = clamp(fi, 0, creek.n - 1.001);
    const i = Math.floor(f);
    return lerp(arr[i], arr[i + 1], f - i);
  };

  // ---------- Surface ----------
  const gx = Math.ceil((maxX - minX) / GRID) + 1;
  const gz = Math.ceil((maxZ - minZ) / GRID) + 1;
  const fallStart = creek.lipIndex - 1.5;
  const fallEnd = creek.footIndex + 1.5;
  const vertexIndex = new Int32Array(gx * gz).fill(-1);
  const info = new Float32Array(gx * gz * 2); // shore, stream index
  for (let j = 0; j < gz; j++) {
    for (let i = 0; i < gx; i++) {
      const x = minX + i * GRID;
      const z = minZ + j * GRID;
      const k = j * gx + i;
      info[k * 2] = field.edge(x, z) > -0.45 ? field.shore(x, z) : 99;
      info[k * 2 + 1] = field.streamIndex(x, z);
    }
  }

  const positions = [];
  const flows = [];
  const indices = [];
  const q = {};
  const vertexAt = (i, j) => {
    const k = j * gx + i;
    if (vertexIndex[k] >= 0) return vertexIndex[k];
    const x = minX + i * GRID;
    const z = minZ + j * GRID;
    field.query(x, z, q);
    // Hold the level flat right up to the fall
    let fi = q.fi;
    if (fi > fallStart && fi < fallEnd) fi = fi < (fallStart + fallEnd) / 2 ? fallStart : fallEnd;
    const level = sampleArr(creek.level, fi);
    vertexIndex[k] = positions.length / 3;
    positions.push(x, level, z);
    flows.push(q.lat, sampleArr(tau, fi), q.speed, q.turb);
    return vertexIndex[k];
  };

  for (let j = 0; j < gz - 1; j++) {
    for (let i = 0; i < gx - 1; i++) {
      const a = j * gx + i;
      const corners = [a, a + 1, a + gx, a + gx + 1];
      let wet = false;
      let ok = true;
      let fiMin = Infinity;
      let fiMax = -Infinity;
      for (const c of corners) {
        const s = info[c * 2];
        if (s > 50) ok = false;
        if (s < 0.5) wet = true;
        fiMin = Math.min(fiMin, info[c * 2 + 1]);
        fiMax = Math.max(fiMax, info[c * 2 + 1]);
      }
      if (!ok || !wet) continue;
      // Leave the drop itself to the waterfall sheet
      if (fiMax > fallStart && fiMin < fallEnd) continue;
      const v00 = vertexAt(i, j);
      const v10 = vertexAt(i + 1, j);
      const v01 = vertexAt(i, j + 1);
      const v11 = vertexAt(i + 1, j + 1);
      indices.push(v00, v01, v10, v10, v01, v11);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aFlow', new THREE.Float32BufferAttribute(flows, 4));
  geometry.setIndex(indices);
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));

  const ripples = [];
  for (let i = 0; i < MAX_RIPPLES; i++) ripples.push(new THREE.Vector4(0, 0, -100, 0));
  let rippleCursor = 0;

  const material = new THREE.ShaderMaterial({
    name: 'water',
    vertexShader: WATER_VERTEX,
    fragmentShader: WATER_FRAGMENT,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.lights,
      {
        uShallow: { value: col(palette.waterShallow) },
        uMid: { value: col(palette.waterMid) },
        uDeep: { value: col(palette.waterDeep) },
        uFoam: { value: col(palette.foam) },
        uSky: { value: col(palette.waterSky) },
        uShade: { value: col(palette.waterShade) },
        uMap: { value: mapTransform },
      },
    ]),
    lights: true,
    transparent: true,
    depthWrite: false,
  });
  // Shared and texture uniforms are assigned after the merge, which would clone them
  material.uniforms.uTime = shared.uTime;
  material.uniforms.uHeightMap = { value: heightMap };
  material.uniforms.uWash = { value: textures.wash };
  material.uniforms.uRipples = { value: ripples };

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'creek-water';
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  group.add(mesh);

  // ---------- Waterfalls ----------
  const fallMaterial = (length, speed, topFade, bottomFade) => {
    const m = new THREE.ShaderMaterial({
      name: 'waterfall',
      vertexShader: FALL_VERTEX,
      fragmentShader: FALL_FRAGMENT,
      uniforms: {
        uTime: shared.uTime,
        uWash: { value: textures.wash },
        uWater: { value: col(palette.waterFall) },
        uFoam: { value: col(palette.foam) },
        uHazeColor: shared.uHazeColor,
        uShape: { value: new THREE.Vector4(length, speed, topFade, bottomFade) },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    return m;
  };

  function sheet(rows, columns, pointAt) {
    // pointAt(row 0..1, column -1..1, out) -> fills position, returns opacity
    const pos = new Float32Array((rows + 1) * (columns + 1) * 3);
    const fall = new Float32Array((rows + 1) * (columns + 1) * 3);
    const idx = [];
    const p = new THREE.Vector3();
    const prev = new THREE.Vector3();
    const lengths = new Float32Array(columns + 1);
    for (let r = 0; r <= rows; r++) {
      for (let c = 0; c <= columns; c++) {
        const u = (c / columns) * 2 - 1;
        const opacity = pointAt(r / rows, u, p);
        const k = r * (columns + 1) + c;
        if (r > 0) {
          prev.fromArray(pos, (k - columns - 1) * 3);
          lengths[c] += prev.distanceTo(p);
        }
        p.toArray(pos, k * 3);
        fall[k * 3] = u;
        fall[k * 3 + 1] = lengths[c];
        fall[k * 3 + 2] = opacity;
      }
    }
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < columns; c++) {
        const a = r * (columns + 1) + c;
        const b = a + columns + 1;
        idx.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aFall', new THREE.BufferAttribute(fall, 3));
    g.setIndex(idx);
    let longest = 0;
    for (const l of lengths) longest = Math.max(longest, l);
    return { geometry: g, length: longest };
  }

  const falls = [];
  const frame = {};

  // The upper fall: a tongue of water that leaves the lip, arcs clear of the
  // rock and lands in the plunge pool.
  {
    const sLip = (creek.lipIndex - 2.5) * creek.ds;
    const sFoot = (creek.footIndex + 2.5) * creek.ds;
    const top = creek.level[creek.lipIndex - 3];
    const bottom = creek.level[creek.footIndex + 3];
    const built = sheet(26, 10, (v, u, out) => {
      const s = lerp(sLip, sFoot, v);
      field.creekAt(s, frame);
      const width = lerp(0.74, 1.02, v) * frame.w;
      // Flat over the lip, then a ballistic drop
      const run = saturate((v - 0.2) / 0.8);
      const y = lerp(top, bottom, Math.pow(run, 1.75)) + Math.sin(v * Math.PI) * 0.07;
      const crown = (1 - u * u) * 0.05; // thicker in the middle
      out.set(frame.x + frame.nx * u * width, y + crown + 0.012, frame.z + frame.nz * u * width);
      return 1;
    });
    const fallMesh = new THREE.Mesh(built.geometry, fallMaterial(built.length, 1.5, 0.3, 0));
    fallMesh.renderOrder = 3;
    fallMesh.name = 'upper-fall';
    group.add(fallMesh);

    field.creekAt(creek.lipIndex * creek.ds, frame);
    const lipPoint = new THREE.Vector3(frame.x, top, frame.z);
    field.creekAt((creek.footIndex + 1) * creek.ds, frame);
    falls.push({ name: 'upper', top: lipPoint, bottom: new THREE.Vector3(frame.x, bottom, frame.z), width: frame.w, height: top - bottom });
  }

  // The last fall: the creek slips over the rim of the island and is lost in
  // the clouds below.
  {
    const rimS = creek.rimIndex * creek.ds;
    field.creekAt(rimS, frame);
    const origin = { ...frame };
    const level = creek.level[creek.rimIndex];
    const half = origin.w + 0.25;
    const columns = 14;
    const starts = [];
    for (let c = 0; c <= columns; c++) {
      const u = (c / columns) * 2 - 1;
      // Walk along the flow to find where this strand meets the rim
      let lo = -3;
      let hi = 3;
      for (let k = 0; k < 18; k++) {
        const mid = (lo + hi) / 2;
        const e = field.edge(origin.x + origin.nx * u * half + origin.tx * mid, origin.z + origin.nz * u * half + origin.tz * mid);
        if (e > 0.02) lo = mid;
        else hi = mid;
      }
      const x = origin.x + origin.nx * u * half + origin.tx * lo;
      const z = origin.z + origin.nz * u * half + origin.tz * lo;
      const depth = level - field.height(x - origin.tx * 0.25, z - origin.tz * 0.25);
      starts.push({ x, z, wet: smoothstep(0.0, 0.1, depth) });
    }
    const drop = 8.6;
    const middle = starts[columns >> 1];
    const built = sheet(34, columns, (v, u, out) => {
      const c = Math.round(((u + 1) / 2) * columns);
      const start = starts[c];
      const time = v * 1.62;
      const push = 1.25 + (1 - u * u) * 0.25; // the middle of the stream runs faster
      // Strands draw together as they fall
      const narrowing = 1 - 0.24 * v;
      const x = middle.x + (start.x - middle.x) * narrowing + origin.tx * push * time;
      const z = middle.z + (start.z - middle.z) * narrowing + origin.tz * push * time;
      const y = level - 0.5 * 6.4 * time * time - 0.02;
      out.set(x, Math.max(y, level - drop), z);
      return start.wet;
    });
    const fallMesh = new THREE.Mesh(built.geometry, fallMaterial(built.length, 1.25, 0.12, built.length * 0.42));
    fallMesh.renderOrder = 3;
    fallMesh.name = 'rim-fall';
    group.add(fallMesh);
    falls.push({
      name: 'rim',
      top: new THREE.Vector3(origin.x, level, origin.z),
      bottom: new THREE.Vector3(origin.x + origin.tx * 1.9, level - 6.2, origin.z + origin.tz * 1.9),
      width: origin.w,
      height: 6.2,
    });
  }

  function addRipple(x, z, strength = 1) {
    ripples[rippleCursor].set(x, z, shared.uTime.value, strength);
    rippleCursor = (rippleCursor + 1) % MAX_RIPPLES;
  }

  return { group, mesh, falls, addRipple, heightMap, level: field.level };
}
