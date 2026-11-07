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
  // Leaf sprites hold painted light and shade only; the shader supplies the
  // hue. The oak's paints the soft bodies of the crowns.
  foliageOak: { file: 'foliage-oak.webp', data: true, sprite: true },
  // The willow's leaves and strands and the bare twigs the oak and the willow
  // show in winter are on `standby`: only the trees drawn in code wear them,
  // when the garden grown in Blender (flora.bin) has not come
  foliageBirch: { file: 'foliage-birch.webp', data: true, sprite: true, standby: true },
  willowStrand: { file: 'willow-strand.webp', data: true, sprite: true, standby: true },
  twigs: { file: 'twigs.webp', data: true, sprite: true, standby: true },
  // For the seasons: sixteen fallen leaves on one sheet (colour) and the
  // cracks and frost of the creek's ice
  leaves: { file: 'leaves.webp', sprite: true },
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

// The textures the page always wears, or with `standby` the ones kept for the
// trees drawn in code
export async function loadTextures(renderer, onProgress = () => {}, { standby = false } = {}) {
  const names = Object.keys(TEXTURES).filter((name) => !!TEXTURES[name].standby === standby);
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
