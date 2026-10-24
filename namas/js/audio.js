// The sound of the house and its garden: one field recording of birds, cut to
// a loop, and what is made here out of noise: rain on the roof, the wind and
// the fire crackling in the living room. It stays silent, and nothing is
// fetched, until the visitor asks. The mix follows the year and the view:
// the birds thin out towards winter, and looking into a room the garden is
// heard as through a window, while the fire comes closer.

const base = new URL('../assets/audio/', import.meta.url);

// The file holds its loop with half a second of the neighbouring turns on
// either side, so the loop points sit clear of whatever padding a decoder
// leaves around an MP3. `from` and `length` are in seconds; `level` is the
// layer's share of the mix.
const BIRDS = { file: 'forest.mp3', from: 0.5, length: 43.2, level: 0.5 };

// Rain: the hiss of the rain itself, its patter on the leaves, and its drumming
// on the roof, which is what is heard of it from inside
const RAIN = { hiss: 0.075, patter: 0.05, roof: 0.11 };

// Wind: noise through a narrow pass that slides up and down as it gusts.
// `swell` is how far the level rises and falls with it, `sweep` how far the
// pass slides, in hertz; the two slow waves that do it never fall into step.
const WIND = { level: 0.42, hz: 420, q: 1.1, swell: 0.5, sweep: 210, waves: [0.13, 0.31] };

// The fire: a low breath of flame and the snaps of the logs, `snaps` to a
// second on average, some of them loud
const FIRE = { level: 0.55, breath: 0.12, snaps: 9, seconds: 7 };

// Where the window's low-pass sits: wide open outside, shut down to the dull
// sound of a garden heard from a room
const OPEN_HZ = 18000;
const GLASS_HZ = 700;
const cutoff = (inside) => OPEN_HZ * (GLASS_HZ / OPEN_HZ) ** inside;

export function createAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  let scape = null;
  let on = false;
  // The season's share of the birds, how far in the view is, how high the fire burns
  let birdsShare = 1;
  let inside = 0;
  let burning = 0;
  let raining = 0;
  let blowing = 0;

  function build() {
    const ctx = new Context();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    // The garden goes out through the window; the fire is in the room
    const glass = ctx.createBiquadFilter();
    glass.type = 'lowpass';
    glass.Q.value = 0.5;
    glass.frequency.value = cutoff(inside);
    const garden = ctx.createGain();
    garden.gain.value = 1 - 0.45 * inside;
    glass.connect(garden).connect(master);

    const birds = ctx.createGain();
    birds.gain.value = 0;
    birds.connect(glass);

    // A few seconds of noise, played round and round under rain and wind
    const noise = ctx.createBuffer(1, Math.round(ctx.sampleRate * 3), ctx.sampleRate);
    const samples = noise.getChannelData(0);
    for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
    const shower = ctx.createBufferSource();
    shower.buffer = noise;
    shower.loop = true;

    const rain = ctx.createGain();
    rain.gain.value = raining;
    rain.connect(glass);
    const band = (type, hz, q, level, to) => {
      const filter = ctx.createBiquadFilter();
      filter.type = type;
      filter.frequency.value = hz;
      filter.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = level;
      shower.connect(filter).connect(gain).connect(to);
      return gain;
    };
    band('highpass', 2600, 0.7, RAIN.hiss, rain);
    band('bandpass', 780, 0.6, RAIN.patter, rain);
    // The roof drums: lower, and heard from inside past the window's filter
    const roof = ctx.createGain();
    roof.gain.value = raining * inside;
    roof.connect(master);
    band('bandpass', 260, 0.9, RAIN.roof, roof);

    // Wind: two slow waves lean on the pass and on the level, so it rises and
    // dies away as gusts do
    const wind = ctx.createGain();
    wind.gain.value = blowing;
    wind.connect(glass);
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

    // The fire: seconds of snaps, each a burst of noise dying away in a few
    // thousandths of a second, over the breath of the flame
    const crackle = ctx.createBuffer(1, Math.round(ctx.sampleRate * FIRE.seconds), ctx.sampleRate);
    const logs = crackle.getChannelData(0);
    const count = Math.round(FIRE.snaps * FIRE.seconds);
    for (let n = 0; n < count; n++) {
      const at = Math.floor(Math.random() * (logs.length - ctx.sampleRate * 0.02));
      const loud = Math.random() < 0.15 ? 0.9 : 0.15 + Math.random() * 0.35;
      const fade = ctx.sampleRate * (0.0008 + Math.random() * 0.004);
      for (let i = 0; i < fade * 5; i++) logs[at + i] += (Math.random() * 2 - 1) * loud * Math.exp(-i / fade);
    }
    const snaps = ctx.createBufferSource();
    snaps.buffer = crackle;
    snaps.loop = true;
    const fire = ctx.createGain();
    fire.gain.value = burning;
    fire.connect(master);
    const bright = ctx.createBiquadFilter();
    bright.type = 'highpass';
    bright.frequency.value = 900;
    const snapLevel = ctx.createGain();
    snapLevel.gain.value = FIRE.level;
    snaps.connect(bright).connect(snapLevel).connect(fire);
    band('lowpass', 320, 0.7, FIRE.breath, fire);

    shower.start();
    snaps.start();
    return { ctx, master, glass, garden, birds, rain, roof, wind, fire, loading: null, playing: false };
  }

  // Fetches the birds and sets them going. They fade in when they arrive.
  async function start() {
    const { ctx, birds } = scape;
    const response = await fetch(new URL(BIRDS.file, base));
    if (!response.ok) throw new Error(`Could not load ${BIRDS.file}`);
    const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = BIRDS.from;
    source.loopEnd = BIRDS.from + BIRDS.length;
    source.connect(birds);
    // Each visit joins the loop somewhere else
    source.start(0, BIRDS.from + Math.random() * BIRDS.length);
    scape.playing = true;
    birds.gain.setTargetAtTime(BIRDS.level * birdsShare, ctx.currentTime, 0.7);
  }

  function resume() {
    const { ctx, master } = scape;
    ctx.resume();
    // A recording that did not arrive is asked for again at the next switch-on
    if (!scape.loading)
      scape.loading = start().catch(() => {
        scape.loading = null;
      });
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

  // Moves a level to `k` over `seconds`, if the sound is built
  const ease = (node, k, seconds) => scape && node(scape).gain.setTargetAtTime(k, scape.ctx.currentTime, seconds);
  // A value that has barely moved is left alone; one that has gone to nothing is passed on
  const still = (k, was, by) => Math.abs(k - was) < by && (k > 0 || was === 0);

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

    // 0..1: how hard it is raining
    rain(k) {
      if (still(k, raining, 0.01)) return;
      raining = k;
      ease((s) => s.rain, k, 0.3);
      ease((s) => s.roof, k * inside, 0.3);
    },

    // 0..1: how hard it is blowing
    wind(k) {
      if (still(k, blowing, 0.01)) return;
      blowing = k;
      ease((s) => s.wind, k, 0.4);
    },

    // 0..1: how far into a room the view has gone
    indoors(k) {
      if (still(k, inside, 0.02)) return;
      inside = k;
      if (!scape) return;
      scape.glass.frequency.setTargetAtTime(cutoff(k), scape.ctx.currentTime, 0.4);
      ease((s) => s.garden, 1 - 0.45 * k, 0.4);
      ease((s) => s.roof, raining * k, 0.4);
    },

    // 0..1: how loud the fire is where the view is
    fire(k) {
      if (still(k, burning, 0.02)) return;
      burning = k;
      ease((s) => s.fire, k, 0.5);
    },

    // The season's share of the birds; called as the year and the day turn
    season(birds) {
      if (Math.abs(birds - birdsShare) < 0.01) return;
      birdsShare = birds;
      if (scape?.playing) ease((s) => s.birds, BIRDS.level * birds, 0.4);
    },
  };
}
