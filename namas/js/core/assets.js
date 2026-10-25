import * as THREE from './three.js';

// Painted textures. The grey ones are detail multipliers (linear data), the
// rest are colour.
const TEXTURES = {
  wash: { file: 'wash.webp', data: true, repeat: true },
  strokes: { file: 'strokes.webp', data: true, repeat: true },
  woodgrain: { file: 'woodgrain.webp', data: true, repeat: true },
  // Furrowed bark for the trunks, and the grain and lichen of stone
  bark: { file: 'bark.webp', data: true, repeat: true },
  rock: { file: 'rock.webp', data: true, repeat: true },
  pebbles: { file: 'pebbles.webp', repeat: true },
  // Leaves painted over the soft body of a crown: light and shade only, the
  // shader supplies the hue. The leaves themselves come modelled, in flora.bin.
  foliageOak: { file: 'foliage-oak.webp', data: true, sprite: true },
  // Sixteen fallen leaves on one sheet (colour), for the autumn's lawn and
  // the leaves the wind carries
  leaves: { file: 'leaves.webp', sprite: true },
  // Cushions of moss for the stones, and the crumbly earth of paths and bare ground
  moss: { file: 'moss.webp', data: true, repeat: true },
  earth: { file: 'earth.webp', data: true, repeat: true },
  // The house: floorboards, kitchen tiles, the seams of the metal roof and
  // the weave of cloth (light and shade only), and an atlas of sixteen
  // painted pictures for its rugs, quilts, posters and drawings (colour)
  planks: { file: 'planks.webp', data: true, repeat: true },
  tiles: { file: 'tiles.webp', data: true, repeat: true },
  roof: { file: 'roof.webp', data: true, repeat: true },
  fabric: { file: 'fabric.webp', data: true, repeat: true },
  decor: { file: 'decor.webp' },
};

const base = new URL('../../assets/textures/', import.meta.url);

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not load ${url}`));
    image.src = url;
  });
}

export async function loadTextures(renderer, onProgress = () => {}) {
  const names = Object.keys(TEXTURES);
  const anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const out = {};
  let done = 0;

  await Promise.all(
    names.map(async (name) => {
      const spec = TEXTURES[name];
      const image = await loadImage(new URL(spec.file, base).href);
      const texture = new THREE.Texture(image);
      texture.name = name;
      texture.colorSpace = spec.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.wrapS = texture.wrapT = spec.repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.anisotropy = spec.sprite ? Math.min(4, anisotropy) : anisotropy;
      texture.generateMipmaps = true;
      texture.needsUpdate = true;
      out[name] = texture;
      done += 1;
      onProgress(done / names.length);
    })
  );

  return out;
}
