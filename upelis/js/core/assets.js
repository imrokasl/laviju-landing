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
  // Leaf sprites hold painted light and shade only; the shader supplies the hue
  foliageOak: { file: 'foliage-oak.webp', data: true, sprite: true },
  foliageBirch: { file: 'foliage-birch.webp', data: true, sprite: true },
  spruceSprig: { file: 'spruce-sprig.webp', data: true, sprite: true },
  willowStrand: { file: 'willow-strand.webp', data: true, sprite: true },
  // For the seasons: bare twigs (light and shade only), sixteen fallen leaves
  // on one sheet (colour) and the cracks and frost of the creek's ice
  twigs: { file: 'twigs.webp', data: true, sprite: true },
  leaves: { file: 'leaves.webp', sprite: true },
  // A cluster of blossom for the bushes that flower in spring (colour)
  blossom: { file: 'blossom.webp', sprite: true },
  ice: { file: 'ice.webp', data: true, repeat: true },
  // Cushions of moss for the stones, and the crumbly earth of paths and bare ground
  moss: { file: 'moss.webp', data: true, repeat: true },
  earth: { file: 'earth.webp', data: true, repeat: true },
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
