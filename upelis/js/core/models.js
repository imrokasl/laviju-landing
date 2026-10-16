import * as THREE from './three.js';

// The few shapes modelled in Blender rather than grown in code: the oak's
// trunk, roots and limbs, and the fallen log. landing-web/upelis/blender
// makes them from this island's own layout, so they stand exactly where the
// code would have put its own. Each file holds named parts, packed small:
// positions and bark coordinates as 16-bit shares of their bounds, normals as
// signed bytes, colours as sRGB bytes, and how open each point lies to the
// sky as a byte. They are fetched while the textures load, and a file that
// cannot be read leaves that thing grown in code, as it always was.

const FILES = { oak: 'oak.bin', log: 'log.bin' };
const base = new URL('../../assets/models/', import.meta.url);

function parse(buffer) {
  const view = new DataView(buffer);
  const magic = String.fromCharCode(view.getUint8(0), view.getUint8(1), view.getUint8(2), view.getUint8(3));
  if (magic !== 'CRKM' || view.getUint32(4, true) !== 1) throw new Error('not a creek model');
  const length = view.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length)));
  const start = 12 + length;
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
    if (p.color !== undefined) {
      const packed = new Uint8Array(buffer, start + p.color, n * 3);
      const color = new Float32Array(n * 3);
      const c = new THREE.Color();
      for (let i = 0; i < n; i++) {
        c.setRGB(packed[i * 3] / 255, packed[i * 3 + 1] / 255, packed[i * 3 + 2] / 255, THREE.SRGBColorSpace);
        color[i * 3] = c.r;
        color[i * 3 + 1] = c.g;
        color[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(color, 3));
    }
    const Index = p.indexBits === 32 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new Index(buffer, start + p.index, p.indexCount).slice(), 1));
    g.computeBoundingSphere();
    const open = p.ao === undefined ? null : Float32Array.from(new Uint8Array(buffer, start + p.ao, n), (v) => v / 255);
    parts[p.name] = { geometry: g, open };
  }
  return parts;
}

// Fetched alongside the textures. Resolves to { oak, log }, each a set of
// named parts, with whatever could not be read left out.
export async function loadModels() {
  const out = {};
  await Promise.all(
    Object.entries(FILES).map(async ([name, file]) => {
      try {
        const response = await fetch(new URL(file, base));
        if (!response.ok) throw new Error(`${response.status}`);
        out[name] = parse(await response.arrayBuffer());
      } catch (error) {
        console.warn(`[creek] ${file} could not be read, so it is grown in code`, error);
      }
    })
  );
  return out;
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
