import * as THREE from './three.js';
import { TAU, lerp, saturate } from './math.js';

// Geometry toolkit. Every model in the scene is built from these few shapes,
// then painted per vertex (there are no image textures on the models).

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// ---------- Icosphere with shared vertices (smooth after displacement) ----------
const icoCache = new Map();

function buildIco(detail) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [
    -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t, 0,
    0, -1, t, 0, 1, t, 0, -1, -t, 0, 1, -t,
    t, 0, -1, t, 0, 1, -t, 0, -1, -t, 0, 1,
  ];
  let faces = [
    0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11,
    1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
    3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9,
    4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1,
  ];

  for (let i = 0; i < verts.length; i += 3) {
    const l = Math.hypot(verts[i], verts[i + 1], verts[i + 2]);
    verts[i] /= l;
    verts[i + 1] /= l;
    verts[i + 2] /= l;
  }

  for (let d = 0; d < detail; d++) {
    const mid = new Map();
    const next = [];
    const midpoint = (a, b) => {
      const key = a < b ? a * 65536 + b : b * 65536 + a;
      let idx = mid.get(key);
      if (idx === undefined) {
        const x = verts[a * 3] + verts[b * 3];
        const y = verts[a * 3 + 1] + verts[b * 3 + 1];
        const z = verts[a * 3 + 2] + verts[b * 3 + 2];
        const l = Math.hypot(x, y, z);
        idx = verts.length / 3;
        verts.push(x / l, y / l, z / l);
        mid.set(key, idx);
      }
      return idx;
    };
    for (let i = 0; i < faces.length; i += 3) {
      const a = faces[i];
      const b = faces[i + 1];
      const c = faces[i + 2];
      const ab = midpoint(a, b);
      const bc = midpoint(b, c);
      const ca = midpoint(c, a);
      next.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    faces = next;
  }

  return { positions: new Float32Array(verts), indices: faces };
}

export function icoSphere(radius = 1, detail = 2) {
  let base = icoCache.get(detail);
  if (!base) {
    base = buildIco(detail);
    icoCache.set(detail, base);
  }
  const positions = new Float32Array(base.positions.length);
  for (let i = 0; i < positions.length; i++) positions[i] = base.positions[i] * radius;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.BufferAttribute(base.positions.slice(), 3));
  geom.setIndex(base.indices.slice());
  return geom;
}

// ---------- Rounded box ----------
// A box whose edges are true quarter-rounds, with `m` segments in each round.
export function roundedBox(w, h, d, r = 0.05, m = 2) {
  const n = m * 2 + 1;
  const geom = new THREE.BoxGeometry(w, h, d, n, n, n);
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const half = [w / 2, h / 2, d / 2];
  const radius = Math.min(r, half[0], half[1], half[2]);

  // The m segments next to each edge are spread evenly over the first 45° of
  // the round (the neighbouring face supplies the other 45°); the single
  // segment in the middle stays flat.
  const remapAxis = (c, hh) => {
    const idx = Math.round(((c + hh) / (2 * hh)) * n);
    const k = idx <= m ? idx : n - idx;
    const offset = hh - radius + radius * Math.tan((1 - k / m) * (Math.PI / 4));
    return idx <= m ? -offset : offset;
  };

  for (let i = 0; i < pos.count; i++) {
    const p = [remapAxis(pos.getX(i), half[0]), remapAxis(pos.getY(i), half[1]), remapAxis(pos.getZ(i), half[2])];
    const inner = [0, 0, 0];
    const dir = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const lim = half[a] - radius;
      inner[a] = Math.max(-lim, Math.min(lim, p[a]));
      dir[a] = p[a] - inner[a];
    }
    const len = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    pos.setXYZ(i, inner[0] + (dir[0] / len) * radius, inner[1] + (dir[1] / len) * radius, inner[2] + (dir[2] / len) * radius);
    nor.setXYZ(i, dir[0] / len, dir[1] / len, dir[2] / len);
  }
  geom.deleteAttribute('uv');
  return geom;
}

// ---------- Tube swept along a path, with a radius that can change ----------
export function tube(points, radius, { radial = 8, capStart = true, capEnd = true, twist = 0 } = {}) {
  const count = points.length;
  const radiusAt = typeof radius === 'function' ? radius : () => radius;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  const tangent = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const binormal = new THREE.Vector3();
  const prevTangent = new THREE.Vector3();
  const axis = new THREE.Vector3();

  // Total length for a normalised v coordinate
  const lengths = [0];
  for (let i = 1; i < count; i++) lengths.push(lengths[i - 1] + points[i].distanceTo(points[i - 1]));
  const total = lengths[count - 1] || 1;

  const frames = [];
  for (let i = 0; i < count; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(count - 1, i + 1)];
    tangent.subVectors(b, a).normalize();

    if (i === 0) {
      const up = Math.abs(tangent.y) > 0.92 ? _v.set(1, 0, 0) : _v.set(0, 1, 0);
      normal.crossVectors(tangent, up).normalize();
    } else {
      axis.crossVectors(prevTangent, tangent);
      const sin = axis.length();
      if (sin > 1e-6) {
        axis.divideScalar(sin);
        normal.applyAxisAngle(axis, Math.asin(Math.min(1, sin)));
      }
      normal.addScaledVector(tangent, -normal.dot(tangent)).normalize();
    }
    binormal.crossVectors(tangent, normal).normalize();
    prevTangent.copy(tangent);
    frames.push({ t: tangent.clone(), n: normal.clone(), b: binormal.clone() });
  }

  for (let i = 0; i < count; i++) {
    const { n, b } = frames[i];
    const t = lengths[i] / total;
    const r = radiusAt(t, i);
    const spin = twist * t;
    for (let j = 0; j <= radial; j++) {
      const ang = (j / radial) * TAU + spin;
      const cx = Math.cos(ang);
      const sy = Math.sin(ang);
      _n.set(0, 0, 0).addScaledVector(n, cx).addScaledVector(b, sy);
      positions.push(points[i].x + _n.x * r, points[i].y + _n.y * r, points[i].z + _n.z * r);
      normals.push(_n.x, _n.y, _n.z);
      uvs.push(j / radial, t);
    }
  }

  const ring = radial + 1;
  for (let i = 0; i < count - 1; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * ring + j;
      const b = a + ring;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }

  // Dome caps: two shrinking rings and a pole
  const addCap = (index, sign) => {
    const { t: tan, n, b } = frames[index];
    const r = radiusAt(index === 0 ? 0 : 1, index);
    const baseRing = index * ring;
    const v = index === 0 ? 0 : 1;
    let prevStart = baseRing;
    const steps = 3;
    for (let k = 1; k <= steps; k++) {
      const phi = (k / steps) * (Math.PI / 2);
      const rr = Math.cos(phi) * r;
      const off = Math.sin(phi) * r * 0.7 * sign;
      const start = positions.length / 3;
      const rings = k === steps ? 1 : ring;
      for (let j = 0; j < rings; j++) {
        const ang = (j / radial) * TAU + twist * v;
        _n.set(0, 0, 0).addScaledVector(n, Math.cos(ang)).addScaledVector(b, Math.sin(ang));
        positions.push(
          points[index].x + _n.x * rr + tan.x * off,
          points[index].y + _n.y * rr + tan.y * off,
          points[index].z + _n.z * rr + tan.z * off
        );
        _v.copy(_n).multiplyScalar(Math.cos(phi)).addScaledVector(tan, Math.sin(phi) * sign).normalize();
        normals.push(_v.x, _v.y, _v.z);
        uvs.push(j / radial, v);
      }
      for (let j = 0; j < radial; j++) {
        const a = prevStart + j;
        const a1 = prevStart + j + 1;
        if (k === steps) {
          if (sign > 0) indices.push(a, a1, start);
          else indices.push(a, start, a1);
        } else {
          const c = start + j;
          const c1 = start + j + 1;
          if (sign > 0) indices.push(a, a1, c, a1, c1, c);
          else indices.push(a, c, a1, a1, c, c1);
        }
      }
      prevStart = start;
    }
  };

  if (capStart) addCap(0, -1);
  if (capEnd) addCap(count - 1, 1);

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geom.setIndex(indices);
  return geom;
}

// Smooth curve through a few control points, sampled densely.
export function curvePoints(control, samples = 24, tension = 0.5) {
  const curve = new THREE.CatmullRomCurve3(
    control.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))),
    false,
    'catmullrom',
    tension
  );
  return curve.getPoints(samples);
}

// Surface of revolution from [radius, height] pairs.
export function lathe(profile, segments = 16) {
  const geom = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
  geom.deleteAttribute('uv');
  return geom;
}

// ---------- Editing helpers ----------
export function place(geom, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1, sx, sy, sz } = {}) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  _s.set(sx ?? s, sy ?? s, sz ?? s);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
  geom.applyMatrix4(_m);
  return geom;
}

// Move every vertex with fn(position, normal, index); normals are rebuilt.
export function displace(geom, fn, recompute = true) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (nor) _n.fromBufferAttribute(nor, i);
    fn(_v, _n, i);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  pos.needsUpdate = true;
  if (recompute) geom.computeVertexNormals();
  return geom;
}

// Paint vertex colours with fn(position, normal, index, outColor).
export function paint(geom, fn) {
  const pos = geom.attributes.position;
  const nor = geom.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    if (nor) _n.fromBufferAttribute(nor, i);
    _c.setRGB(1, 1, 1);
    fn(_v, _n, i, _c);
    colors[i * 3] = _c.r;
    colors[i * 3 + 1] = _c.g;
    colors[i * 3 + 2] = _c.b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geom;
}

export function paintSolid(geom, color) {
  return paint(geom, (p, n, i, out) => out.copy(color));
}

// Bottom-to-top gradient, measured on the geometry's own bounding box unless
// y0 / y1 are given.
export function paintGradient(geom, bottom, top, y0, y1, power = 1) {
  geom.computeBoundingBox();
  const lo = y0 ?? geom.boundingBox.min.y;
  const hi = y1 ?? geom.boundingBox.max.y;
  return paint(geom, (p, n, i, out) => {
    const t = Math.pow(saturate((p.y - lo) / (hi - lo || 1)), power);
    out.copy(bottom).lerp(top, t);
  });
}

// Light-facing gradient: surfaces turned towards `dir` take the `lit` colour.
// This is the "painted highlight" that keeps round shapes readable in shade.
const LIGHT_DIR = new THREE.Vector3(-0.35, 0.86, 0.36).normalize();

export function paintLit(geom, shade, lit, { dir = LIGHT_DIR, lo = -0.2, hi = 0.9, power = 1 } = {}) {
  return paint(geom, (p, n, i, out) => {
    const t = Math.pow(saturate((n.dot(dir) - lo) / (hi - lo)), power);
    out.copy(shade).lerp(lit, t);
  });
}

// Per-vertex wind weight (metres of travel at full gust).
export function setSway(geom, fn) {
  const pos = geom.attributes.position;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    sway[i] = fn(_v, i);
  }
  geom.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  return geom;
}

// ---------- Merge ----------
// Joins geometries into one indexed mesh. Missing colours become white and a
// missing sway weight becomes zero, so mixed parts can share one draw call.
export function merge(list, { keepUv = false } = {}) {
  const geoms = list.filter(Boolean);
  let vertexCount = 0;
  let indexCount = 0;
  let hasSway = false;

  for (const g of geoms) {
    vertexCount += g.attributes.position.count;
    indexCount += g.index ? g.index.count : g.attributes.position.count;
    if (g.attributes.sway) hasSway = true;
  }

  const position = new Float32Array(vertexCount * 3);
  const normal = new Float32Array(vertexCount * 3);
  const color = new Float32Array(vertexCount * 3).fill(1);
  const sway = hasSway ? new Float32Array(vertexCount) : null;
  const uv = keepUv ? new Float32Array(vertexCount * 2) : null;
  const index = vertexCount > 65535 ? new Uint32Array(indexCount) : new Uint16Array(indexCount);

  let vOff = 0;
  let iOff = 0;
  for (const g of geoms) {
    const count = g.attributes.position.count;
    position.set(g.attributes.position.array.subarray(0, count * 3), vOff * 3);
    if (g.attributes.normal) normal.set(g.attributes.normal.array.subarray(0, count * 3), vOff * 3);
    if (g.attributes.color) color.set(g.attributes.color.array.subarray(0, count * 3), vOff * 3);
    if (sway && g.attributes.sway) sway.set(g.attributes.sway.array.subarray(0, count), vOff);
    if (uv && g.attributes.uv) uv.set(g.attributes.uv.array.subarray(0, count * 2), vOff * 2);

    if (g.index) {
      const src = g.index.array;
      for (let i = 0; i < g.index.count; i++) index[iOff + i] = src[i] + vOff;
      iOff += g.index.count;
    } else {
      for (let i = 0; i < count; i++) index[iOff + i] = vOff + i;
      iOff += count;
    }
    vOff += count;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(position, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  out.setAttribute('color', new THREE.BufferAttribute(color, 3));
  if (sway) out.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  if (uv) out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// A soft organic lump: an icosphere pushed around by noise.
export function blob(radius, detail, noise, { amp = 0.22, freq = 1.1, squashY = 1, seed = 0, flatBottom = false } = {}) {
  const geom = icoSphere(1, detail);
  displace(geom, (p) => {
    const n = noise.fbm3(p.x * freq + seed, p.y * freq + seed * 1.7, p.z * freq - seed * 0.6, 3);
    const k = 1 + n * amp;
    p.multiplyScalar(radius * k);
    p.y *= squashY;
    if (flatBottom && p.y < -radius * 0.35 * squashY) p.y = lerp(p.y, -radius * 0.35 * squashY, 0.75);
  });
  return geom;
}
