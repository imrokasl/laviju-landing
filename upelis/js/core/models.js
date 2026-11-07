import * as THREE from './three.js';

// The shapes modelled in Blender rather than grown in code: the oak's trunk,
// roots and limbs, the fallen log, and the garden (the birches, the spruces
// and the bushes). landing-web/upelis/blender makes them from this island's
// own layout, so they stand exactly where the code expects them. The oak and
// the log are files of named parts, packed small: positions and bark
// coordinates as 16-bit shares of their bounds, normals as signed bytes,
// colours as sRGB bytes, and how open each point lies to the sky as a byte;
// a file of these that cannot be read leaves that thing grown in code, as it
// always was. The garden is a file of the house's kind (version 3), whose
// parts name their own attributes. All are fetched while the textures load.

const FILES = { oak: 'oak.bin', log: 'log.bin' };
const base = new URL('../../assets/models/', import.meta.url);

// sRGB bytes to linear light, as the shaders want them
const LINEAR = Float32Array.from({ length: 256 }, (_, b) => {
  const c = b / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
});

function readHead(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'CRKM') throw new Error('not a model');
  const length = view.getUint32(8, true);
  return { version: view.getUint32(4, true), head: JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length))), start: 12 + length };
}

// How long a model is, from its head alone: the end of the last of its arrays
function lengthOf(version, head, start) {
  const sizes = { u16: 2, u8: 1, i8: 1, srgb: 1 };
  let end = start;
  for (const p of head.parts) {
    const n = p.count;
    if (version === 1) {
      const arrays = { position: n * 6, normal: n * 3, uv: n * 4, color: n * 3, ao: n, index: (p.indexCount * p.indexBits) / 8 };
      for (const [name, size] of Object.entries(arrays)) if (p[name] !== undefined) end = Math.max(end, start + p[name] + size);
    } else {
      for (const a of Object.values(p.attributes)) end = Math.max(end, start + a.offset + n * a.size * sizes[a.type]);
      if (p.index) end = Math.max(end, start + p.index.offset + (p.index.count * p.index.bits) / 8);
    }
  }
  return end;
}

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

// Fetches a model, telling as it comes in how much of it has: the length is
// read from its head, since what comes over the wire is packed smaller
async function fetchModel(file, onProgress) {
  const response = await fetch(new URL(file, base));
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  if (!response.body?.getReader) return response.arrayBuffer();
  const reader = response.body.getReader();
  let bytes = new Uint8Array(1 << 18);
  let received = 0;
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > bytes.length) {
      const more = new Uint8Array(Math.max(bytes.length * 2, received + value.length, total));
      more.set(bytes.subarray(0, received));
      bytes = more;
    }
    bytes.set(value, received);
    received += value.length;
    if (!total && received >= 12) {
      const length = new DataView(bytes.buffer).getUint32(8, true);
      if (received >= 12 + length) {
        try {
          const { version, head, start } = readHead(bytes.buffer);
          total = lengthOf(version, head, start);
        } catch {
          total = -1;
        }
      }
    }
    if (total > 0) onProgress(Math.min(1, received / total));
  }
  onProgress(1);
  return bytes.buffer.slice(0, received);
}

function parse(buffer) {
  const { version, head: header, start } = readHead(buffer);
  if (version !== 1) throw new Error('not a creek model');
  const parts = {};
  for (const p of header.parts) {
    const n = p.count;
    // 16-bit shares back to metres (or sheet units) within the part's bounds
    const spread = (offset, size, lo, hi) => {
      const packed = new Uint16Array(buffer, start + offset, n * size);
      const out = new Float32Array(n * size);
      for (let i = 0; i < out.length; i++) out[i] = lo[i % size] + (packed[i] / 65535) * (hi[i % size] - lo[i % size]);
      return out;
    };
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(spread(p.position, 3, p.min, p.max), 3));
    const normal = Float32Array.from(new Int8Array(buffer, start + p.normal, n * 3), (v) => v / 127);
    g.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    g.normalizeNormals();
    if (p.uv !== undefined) g.setAttribute('uv', new THREE.BufferAttribute(spread(p.uv, 2, p.uvMin, p.uvMax), 2));
    if (p.color !== undefined) g.setAttribute('color', new THREE.BufferAttribute(Float32Array.from(new Uint8Array(buffer, start + p.color, n * 3), (v) => LINEAR[v]), 3));
    const Index = p.indexBits === 32 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new Index(buffer, start + p.index, p.indexCount).slice(), 1));
    g.computeBoundingSphere();
    const open = p.ao === undefined ? null : Float32Array.from(new Uint8Array(buffer, start + p.ao, n), (v) => v / 255);
    parts[p.name] = { geometry: g, open };
  }
  return parts;
}

// Fetched alongside the textures. Resolves to { oak, log }, each a set of
// named parts, with whatever could not be read left out. `onProgress(name,
// share)` tells how much of each file has come in.
export async function loadModels(onProgress = () => {}) {
  const out = {};
  await Promise.all(
    Object.entries(FILES).map(async ([name, file]) => {
      try {
        out[name] = parse(await fetchModel(file, (share) => onProgress(name, share)));
      } catch (error) {
        onProgress(name, 1);
        console.warn(`[creek] ${file} could not be read, so it is grown in code`, error);
      }
    })
  );
  return out;
}

// The garden: the birches, the spruces and the bushes. Resolves to its
// parts, or to null when the file cannot be read: the island is then drawn
// without them rather than not at all.
export async function loadFlora(onProgress = () => {}) {
  try {
    return parseParts(await fetchModel('flora.bin', onProgress));
  } catch (error) {
    onProgress(1);
    console.warn('[creek] flora.bin could not be read, so the garden is left out', error);
    return null;
  }
}

// Darkens a painted part where the sky was shut out when it was modelled:
// between the roots, down the furrows, inside the hollow end of the log.
// `least` is what the most shut-in point keeps of its colour.
export function shadeByOpenness(part, least = 0.5) {
  const color = part.geometry.attributes.color;
  if (!part.open || !color) return;
  for (let i = 0; i < color.count; i++) {
    const keep = least + (1 - least) * part.open[i];
    color.setXYZ(i, color.getX(i) * keep, color.getY(i) * keep, color.getZ(i) * keep);
  }
}
