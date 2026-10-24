// How much the scene asks of the device. Three tiers; the picture keeps its
// look on all of them and only loses refinement.

const TIERS = {
  high: {
    name: 'high',
    dpr: 2,
    pixels: 3.9e6,
    antialias: false,
    msaa: 4,
    post: true,
    dof: true,
    dofTaps: 26,
    dofRadius: 8.5,
    bloom: 0.5,
    // Ambient occlusion: how much of its shade is laid on, and from how many readings
    ao: 1,
    aoTaps: 11,
    shadows: true,
    shadowSize: 2048,
    shadowRadius: 3.4,
    shadowTaps: 16,
    shadowEvery: 1,
    density: 1,
    foliage: 1,
    clouds: 12,
    cloudDetail: 3,
  },
  medium: {
    name: 'medium',
    dpr: 1.5,
    pixels: 2.1e6,
    antialias: false,
    msaa: 4,
    post: true,
    dof: true,
    dofTaps: 14,
    dofRadius: 7.5,
    bloom: 0.46,
    ao: 1,
    aoTaps: 7,
    shadows: true,
    shadowSize: 2048,
    shadowRadius: 3,
    shadowTaps: 10,
    shadowEvery: 2,
    density: 0.68,
    foliage: 0.85,
    clouds: 10,
    cloudDetail: 2,
  },
  low: {
    name: 'low',
    dpr: 1.25,
    pixels: 1.1e6,
    antialias: true,
    msaa: 0,
    post: false,
    dof: false,
    dofTaps: 8,
    dofRadius: 0,
    bloom: 0,
    ao: 0,
    aoTaps: 0,
    shadows: true,
    shadowSize: 1024,
    shadowRadius: 2.2,
    shadowTaps: 8,
    shadowEvery: 3,
    density: 0.4,
    foliage: 0.62,
    clouds: 7,
    cloudDetail: 2,
  },
};

export function pickQuality() {
  const forced = new URLSearchParams(window.location.search).get('quality');
  if (forced && TIERS[forced]) return { ...TIERS[forced], forced: true };

  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(window.screen?.width || 1280, window.screen?.height || 800) < 820;
  const saveData = navigator.connection?.saveData === true;

  let tier = 'high';
  if (coarse || small) tier = 'medium';
  // Only Chrome reports memory; a phone that admits to 4 GB or less has a
  // modest graphics chip to go with it
  if ((coarse || small) && navigator.deviceMemory && navigator.deviceMemory <= 4) tier = 'low';
  if (cores <= 2 || memory <= 2 || saveData) tier = 'low';
  return { ...TIERS[tier], forced: false };
}

// The renderer string tells a software rasteriser from a real GPU.
export function isSoftwareRenderer(gl) {
  try {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|basic render/i.test(name);
  } catch {
    return false;
  }
}

export function lowTier() {
  return { ...TIERS.low, forced: false };
}

// Device pixel ratio that keeps the drawn frame inside the tier's budget.
export function pixelRatioFor(quality, width, height, scale = 1) {
  const device = Math.min(window.devicePixelRatio || 1, quality.dpr);
  const budget = Math.sqrt(quality.pixels / Math.max(1, width * height));
  return Math.max(0.6, Math.min(device, budget) * scale);
}
