// The sound of the creek: three field recordings, each cut to a loop and mixed
// here. It stays silent, and nothing is fetched, until the visitor asks.

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

export function createAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  let scape = null;
  let on = false;
  let closeness = 0;

  function build() {
    const ctx = new Context();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);

    const layers = {};
    for (const [name, loop] of Object.entries(LOOPS)) {
      const level = ctx.createGain();
      level.gain.value = 0;
      level.connect(master);
      layers[name] = { loop, level, loading: null, playing: false };
    }
    return { ctx, master, layers };
  }

  const levelOf = (name) => LOOPS[name].level * (name === 'fall' ? FALL_FAR + (1 - FALL_FAR) * closeness : 1);

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
  };
}
