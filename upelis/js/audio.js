// The sound of the creek, made in the browser: no audio files and nothing
// fetched. It stays silent until the visitor asks for it.

const rand = (lo, hi) => lo + Math.random() * (hi - lo);

// Wires up the whole soundscape on a (live or offline) audio context.
export function buildSoundscape(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  // Four seconds of looped noise feed everything that hisses or babbles
  const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 4), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  noise.start();

  const chain = (...nodes) => nodes.reduce((from, to) => (from.connect(to), to));
  const filter = (type, frequency, q = 0.7) => {
    const node = ctx.createBiquadFilter();
    node.type = type;
    node.frequency.value = frequency;
    node.Q.value = q;
    return node;
  };
  const gain = (value) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };

  // The waterfall: a low, steady rush
  const fall = gain(0.12);
  chain(noise, filter('lowpass', 950, 0.5), filter('highpass', 140), fall, master);

  // The run of the creek: a bright hiss...
  chain(noise, filter('bandpass', 2600, 0.6), gain(0.03), master);
  // ...and its babble: narrow bands that wander in pitch and come and go
  const voices = [540, 860, 1320, 1980].map((base) => {
    const band = filter('bandpass', base, 14);
    const level = gain(0);
    chain(noise, band, level, master);
    return { band, level, base };
  });

  // Wind in the leaves, breathing slowly
  const leaves = gain(0.022);
  chain(noise, filter('bandpass', 620, 0.4), leaves, master);
  const breath = ctx.createOscillator();
  breath.frequency.value = 0.07;
  chain(breath, gain(0.012), leaves.gain);
  breath.start();

  return { ctx, master, fall, voices, babbleAt: 0, birdAt: 2.5 };
}

// Lays down the next stretch of babble and birdsong, up to the given time.
export function scheduleSoundscape(scape, until) {
  const { ctx, master, voices } = scape;

  while (scape.babbleAt < until) {
    const at = scape.babbleAt;
    for (const voice of voices) {
      if (Math.random() < 0.55) {
        voice.band.frequency.setTargetAtTime(voice.base * rand(0.74, 1.42), at, 0.03);
        voice.level.gain.setTargetAtTime(rand(0.5, 1.5), at, 0.035);
      } else {
        voice.level.gain.setTargetAtTime(0.12, at, 0.08);
      }
    }
    scape.babbleAt += rand(0.07, 0.16);
  }

  while (scape.birdAt < until) {
    // A phrase of a few quick notes from somewhere in the trees
    const pitch = rand(2500, 4300);
    const pan = rand(-0.75, 0.75);
    let at = scape.birdAt;
    for (let note = 2 + Math.floor(Math.random() * 4); note > 0; note--) {
      const length = rand(0.07, 0.13);
      const from = pitch * rand(0.93, 1.09);
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.frequency.setValueAtTime(from, at);
      osc.frequency.exponentialRampToValueAtTime(from * rand(0.74, 1.36), at + length);
      env.gain.setValueAtTime(0, at);
      env.gain.linearRampToValueAtTime(0.05, at + 0.012);
      env.gain.exponentialRampToValueAtTime(0.0005, at + length);
      osc.connect(env);
      if (ctx.createStereoPanner) {
        const panner = ctx.createStereoPanner();
        panner.pan.value = pan;
        env.connect(panner);
        panner.connect(master);
      } else {
        env.connect(master);
      }
      osc.start(at);
      osc.stop(at + length + 0.04);
      at += length + rand(0.03, 0.09);
    }
    scape.birdAt = at + rand(2.6, 8.5);
  }
}

export function createAudio() {
  const Context = window.AudioContext || window.webkitAudioContext;
  let scape = null;
  let on = false;
  let timer = 0;
  let closeness = -1;

  function tick() {
    if (scape) scheduleSoundscape(scape, scape.ctx.currentTime + 1.2);
  }

  function resume() {
    const { ctx, master } = scape;
    // Nothing is laid down for the time the context spent asleep
    scape.babbleAt = Math.max(scape.babbleAt, ctx.currentTime);
    scape.birdAt = Math.max(scape.birdAt, ctx.currentTime + 1.5);
    ctx.resume();
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.5);
    clearInterval(timer);
    timer = setInterval(tick, 400);
    tick();
  }

  function pause() {
    const { ctx, master } = scape;
    clearInterval(timer);
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
      if (on && !scape) scape = buildSoundscape(new Context());
      if (!scape) return false;
      if (on) resume();
      else pause();
      return on;
    },

    // 0..1: how close the view is to the waterfall
    near(k) {
      if (!scape || !on || Math.abs(k - closeness) < 0.03) return;
      closeness = k;
      scape.fall.gain.setTargetAtTime(0.07 + 0.2 * k, scape.ctx.currentTime, 0.5);
    },
  };
}
