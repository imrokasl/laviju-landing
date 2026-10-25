import * as THREE from './three.js';

// The house, modelled in Blender. landing-web/namas/blender builds it from
// this page's own layout (world/layout.js), so every wall, sofa and sandbox
// stands exactly where the markers and the camera expect it, and writes it as
// one file of parts. A part is everything drawn with one material that comes
// out in one season (or all year), packed small: positions and texture
// coordinates as 16-bit shares of their bounds, normals as signed bytes (none
// for a part lit by its faces), colours as sRGB bytes, and two bytes of
// bookkeeping per point: `cut`, where it belongs (in its top two bits how much
// of the snow it is kept from, 0 to 3; in the two below its zone: 0 outside,
// 1 the house, 2 the garage; 8 for a thin sheet; and in the low three the
// wall or roof it is part of), and `lamp`, the light that makes it glow.

const FILE = 'house.bin';
const base = new URL('../../assets/models/', import.meta.url);

// sRGB bytes to linear light, as the shaders want them
const LINEAR = Float32Array.from({ length: 256 }, (_, b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

// One attribute of a version 3 part, unpacked as its header says
function unpack(buffer, start, count, a) {
  const n = count * a.size;
  const at = start + a.offset;
  if (a.type === 'i8') return Float32Array.from(new Int8Array(buffer, at, n), (v) => Math.max(-1, v / 127));
  if (a.type === 'srgb') return Float32Array.from(new Uint8Array(buffer, at, n), (v) => LINEAR[v]);
  const packed = a.type === 'u16' ? new Uint16Array(buffer, at, n) : new Uint8Array(buffer, at, n);
  // Without bounds they are whole numbers, read as they are
  if (!a.min) return packed.slice();
  const top = a.type === 'u16' ? 65535 : 255;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i % a.size;
    out[i] = a.min[k] + (packed[i] / top) * (a.max[k] - a.min[k]);
  }
  return out;
}

function readHead(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'CRKM') throw new Error('not a model');
  const length = view.getUint32(8, true);
  return { version: view.getUint32(4, true), head: JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length))), start: 12 + length };
}

// Version 3: every part names its attributes and how each is packed (see
// landing-web/namas/blender/crkm.py). A part with triangles is a mesh; one
// without is a list of points, such as where a template's copies go.
function parseParts(buffer) {
  const { version, head, start } = readHead(buffer);
  if (version !== 3) throw new Error(`model version ${version}`);
  const parts = new Map();
  for (const p of head.parts) {
    const attributes = {};
    for (const [name, a] of Object.entries(p.attributes)) attributes[name] = unpack(buffer, start, p.count, a);
    const Index = p.index?.bits === 32 ? Uint32Array : Uint16Array;
    const index = p.index ? new Index(buffer, start + p.index.offset, p.index.count).slice() : null;
    parts.set(p.name, { ...p, attributes, index });
  }
  return { header: head, parts };
}

// The garden: trees, bushes, the templates of the lawn's tufts and flowers,
// and the animals
export async function loadFlora() {
  const response = await fetch(new URL('flora.bin', base));
  if (!response.ok) throw new Error(`flora.bin: ${response.status}`);
  return parseParts(await response.arrayBuffer());
}

function parse(buffer) {
  const { version, head: header, start } = readHead(buffer);
  if (version !== 2) throw new Error('not a house model');
  const parts = [];
  const c = new THREE.Color();
  for (const p of header.parts) {
    const n = p.count;
    // 16-bit shares back to metres (or texture units) within the part's bounds
    const spread = (offset, size, lo, hi) => {
      const packed = new Uint16Array(buffer, start + offset, n * size);
      const out = new Float32Array(n * size);
      for (let i = 0; i < out.length; i++) out[i] = lo[i % size] + (packed[i] / 65535) * (hi[i % size] - lo[i % size]);
      return out;
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(spread(p.position, 3, p.min, p.max), 3));
    if (p.normal !== undefined) {
      g.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(new Int8Array(buffer, start + p.normal, n * 3), (v) => v / 127), 3));
      g.normalizeNormals();
    }
    if (p.uv !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(spread(p.uv, 2, p.uvMin, p.uvMax), 2));
    const packed = new Uint8Array(buffer, start + p.color, n * 3);
    const color = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      c.setRGB(packed[i * 3] / 255, packed[i * 3 + 1] / 255, packed[i * 3 + 2] / 255, THREE.SRGBColorSpace);
      color[i * 3] = c.r;
      color[i * 3 + 1] = c.g;
      color[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    // Bookkeeping bytes are read as they are: whole numbers in the shader
    const bytes = (offset) => new THREE.BufferAttribute(offset === undefined ? new Uint8Array(n) : new Uint8Array(buffer, start + offset, n).slice(), 1);
    g.setAttribute('aCut', bytes(p.cut));
    g.setAttribute('aLamp', bytes(p.lamp));
    const Index = p.indexBits === 32 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new Index(buffer, start + p.index, p.indexCount).slice(), 1));
    g.computeBoundingSphere();
    parts.push({ name: p.name, material: p.material, season: p.season || '', flat: !!p.flat, geometry: g });
  }
  return { context: header.context, parts };
}

// Fetched alongside the textures. Resolves to the house's parts, or to null
// when the file cannot be read: the page then shows its ideas without a picture.
export async function loadHouse() {
  const response = await fetch(new URL(FILE, base));
  if (!response.ok) throw new Error(`${FILE}: ${response.status}`);
  return parse(await response.arrayBuffer());
}

// Every thing a seasonal part brings out is told apart from the others: the
// points that touch (they share a place) belong together, and each of those
// things rises from the middle of its foot, in its own turn. Written as aPop
// (x, y, z: the foot; w: the turn, 0..1), which world/kit.js knows how to move.
export function popByThing(geometry) {
  const pos = geometry.attributes.position;
  const n = pos.count;
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const join = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  // Corners of one face belong together...
  const index = geometry.index.array;
  for (let t = 0; t < index.length; t += 3) {
    join(index[t], index[t + 1]);
    join(index[t], index[t + 2]);
  }
  // ...and so do points that share a place, where a hard edge split them
  const seen = new Map();
  for (let i = 0; i < n; i++) {
    const key = `${Math.round(pos.getX(i) * 2000)},${Math.round(pos.getY(i) * 2000)},${Math.round(pos.getZ(i) * 2000)}`;
    const other = seen.get(key);
    if (other === undefined) seen.set(key, i);
    else join(other, i);
  }
  const box = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let b = box.get(r);
    if (!b) box.set(r, (b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    if (x < b[0]) b[0] = x;
    if (y < b[1]) b[1] = y;
    if (z < b[2]) b[2] = z;
    if (x > b[3]) b[3] = x;
    if (y > b[4]) b[4] = y;
    if (z > b[5]) b[5] = z;
  }
  const pop = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const b = box.get(find(i));
    const x = (b[0] + b[3]) / 2;
    const z = (b[2] + b[5]) / 2;
    pop[i * 4] = x;
    pop[i * 4 + 1] = b[1];
    pop[i * 4 + 2] = z;
    // Its turn is its own and the same from load to load
    pop[i * 4 + 3] = Math.abs(Math.sin(x * 12.9898 + z * 78.233 + b[1] * 37.719) * 43758.5453) % 1;
  }
  geometry.setAttribute('aPop', new THREE.BufferAttribute(pop, 4));
  return geometry;
}
