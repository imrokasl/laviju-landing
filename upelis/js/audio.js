// The sound of the creek: three field recordings, each cut to a loop and mixed
// here. It stays silent, and nothing is fetched, until the visitor asks. The
// mix follows the year: the birds thin out towards winter, and under ice the
// water is heard as through a wall. Rain and wind have no recordings: they
// are made here, out of noise.

const base = new URL('../assets/audio/', import.meta.url);

// Each file holds its loop with half a second of the neighbouring turns on
// either side, so the loop points sit clear of whatever padding a decoder
// leaves around an MP3. `from` and `length` are in seconds; `level` is the
// layer's share of the mix.
const LOOPS = {
  creek: { file: 'creek.mp3', from: 0.5, length: 24, level: 0.8 },
  birds: { file: 'forest.mp3', from: 0.5, length: 43.2, level: 0.5 },
  fall: { file: 'waterfall.mp3', from: 0.5, length: 10.8, level: 0.55 },
};

// From the far side of the island the waterfall is only a murmur
const FALL_FAR = 0.2;

// Rain: the hiss of the rain itself, and its patter on leaves and water
const RAIN = { hiss: 0.085, patter: 0.06 };

// Wind: noise through a narrow pass that slides up and down as it gusts.
// `swell` is how far the level rises and falls with it, `sweep` how far the
// pass slides, in hertz; the two slow waves that do it never fall into step.
const WIND = { level: 0.42, hz: 420, q: 1.1, swell: 0.5, sweep: 210, waves: [0.13, 0.31] };

// Where the water's low-pass sits: wide open, and shut down under the ice
const OPEN_HZ = 18000;
const ICE_HZ = 620;
const cutoff = (muffle) => OPEN_HZ * (ICE_HZ / OPEN_HZ) ** muffle;

export function createAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  let scape = null;
  let on = false;
  let closeness = 0;
  // The season's share of the birds and of the water, and how much ice lies on the water
  const mix = { birds: 1, water: 1, muffle: 0 };
  let raining = 0;
  let blowing = 0;

  function build() {
    const ctx = new Context();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // Both water recordings pass through one filter; the birds go straight out
    const underIce = ctx.createBiquadFilter();
    underIce.type = 'lowpass';
    underIce.Q.value = 0.5;
    underIce.frequency.value = cutoff(mix.muffle);
    underIce.connect(master);

    const layers = {};
    for (const [name, loop] of Object.entries(LOOPS)) {
      const level = ctx.createGain();
      level.gain.value = 0;
      level.connect(name === 'birds' ? master : underIce);
      layers[name] = { loop, level, loading: null, playing: false };
    }
    // Rain: a few seconds of noise, played round and round through two filters
    const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const shower = ctx.createBufferSource();
    shower.buffer = noise;
    shower.loop = true;
    const rain = ctx.createGain();
    rain.gain.value = raining;
    rain.connect(master);
    const hiss = ctx.createBiquadFilter();
    hiss.type = 'highpass';
    hiss.frequency.value = 2600;
    const hissLevel = ctx.createGain();
    hissLevel.gain.value = RAIN.hiss;
    shower.connect(hiss).connect(hissLevel).connect(rain);
    const patter = ctx.createBiquadFilter();
    patter.type = 'bandpass';
    patter.frequency.value = 780;
    patter.Q.value = 0.6;
    const patterLevel = ctx.createGain();
    patterLevel.gain.value = RAIN.patter;
    shower.connect(patter).connect(patterLevel).connect(rain);

    // Wind: the same noise through its own pass. Two slow waves lean on the
    // pass and on the level, so it rises and dies away as gusts do.
    const wind = ctx.createGain();
    wind.gain.value = blowing;
    wind.connect(master);
    const pass = ctx.createBiquadFilter();
    pass.type = 'bandpass';
    pass.frequency.value = WIND.hz;
    pass.Q.value = WIND.q;
    const gust = ctx.createGain();
    gust.gain.value = WIND.level;
    shower.connect(pass).connect(gust).connect(wind);
    for (const hz of WIND.waves) {
      const wave = ctx.createOscillator();
      wave.frequency.value = hz;
      const swell = ctx.createGain();
      swell.gain.value = (WIND.level * WIND.swell) / WIND.waves.length;
      wave.connect(swell).connect(gust.gain);
      const sweep = ctx.createGain();
      sweep.gain.value = WIND.sweep / WIND.waves.length;
      wave.connect(sweep).connect(pass.frequency);
      wave.start();
    }
    shower.start();

    return { ctx, master, underIce, layers, rain, wind };
  }

  function levelOf(name) {
    const { level } = LOOPS[name];
    if (name === 'birds') return level * mix.birds;
    // A frozen waterfall hardly falls
    if (name === 'fall') return level * mix.water * (1 - 0.7 * mix.muffle) * (FALL_FAR + (1 - FALL_FAR) * closeness);
    return level * mix.water;
  }

  // Fetches one recording and sets it going. It fades in when it arrives.
  async function start(name) {
    const { ctx, layers } = scape;
    const layer = layers[name];
    const { loop, level } = layer;
    const response = await fetch(new URL(loop.file, base));
    if (!response.ok) throw new Error(`Could not load ${loop.file}`);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = loop.from;
    source.loopEnd = loop.from + loop.length;
    source.connect(level);
    // Each visit joins the loop somewhere else
    source.start(0, loop.from + Math.random() * loop.length);
    layer.playing = true;
    level.gain.setTargetAtTime(levelOf(name), ctx.currentTime, 0.7);
  }

  function load() {
    for (const [name, layer] of Object.entries(scape.layers)) {
      if (layer.loading) continue;
      // A recording that did not arrive is asked for again at the next switch-on
      layer.loading = start(name).catch(() => {
        layer.loading = null;
      });
    }
  }

  function resume() {
    const { ctx, master } = scape;
    ctx.resume();
    load();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.5);
  }

  function pause() {
    const { ctx, master } = scape;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0, ctx.currentTime, 0.18);
    setTimeout(() => {
      if (!on || document.hidden) ctx.suspend();
    }, 900);
  }

  document.addEventListener('visibilitychange', () => {
    if (!scape || !on) return;
    if (document.hidden) pause();
    else resume();
  });

  return {
    supported: !!Context,

    // Called from the visitor's own click, which is what lets a browser play
    toggle(next) {
      if (!Context) return false;
      on = next;
      if (on && !scape) scape = build();
      if (!scape) return false;
      if (on) resume();
      else pause();
      return on;
    },

    // 0..1: how close the view is to the waterfall
    near(k) {
      if (Math.abs(k - closeness) < 0.03) return;
      closeness = k;
      const fall = scape?.layers.fall;
      if (fall?.playing) fall.level.gain.setTargetAtTime(levelOf('fall'), scape.ctx.currentTime, 0.5);
    },

    // 0..1: how hard it is raining
    rain(k) {
      if (Math.abs(k - raining) < 0.01 && (k > 0 || raining === 0)) return;
      raining = k;
      if (scape) scape.rain.gain.setTargetAtTime(k, scape.ctx.currentTime, 0.3);
    },

    // 0..1: how hard it is blowing
    wind(k) {
      if (Math.abs(k - blowing) < 0.01 && (k > 0 || blowing === 0)) return;
      blowing = k;
      if (scape) scape.wind.gain.setTargetAtTime(k, scape.ctx.currentTime, 0.4);
    },

    // What the season makes of the mix; called as the year turns
    season(birds, water, muffle) {
      if (Math.abs(birds - mix.birds) < 0.01 && Math.abs(water - mix.water) < 0.01 && Math.abs(muffle - mix.muffle) < 0.01) return;
      mix.birds = birds;
      mix.water = water;
      mix.muffle = muffle;
      if (!scape) return;
      const { ctx, layers, underIce } = scape;
      for (const [name, layer] of Object.entries(layers)) {
        if (layer.playing) layer.level.gain.setTargetAtTime(levelOf(name), ctx.currentTime, 0.4);
      }
      underIce.frequency.setTargetAtTime(cutoff(muffle), ctx.currentTime, 0.4);
    },
  };
}
