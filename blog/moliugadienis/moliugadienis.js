// =============================================
// MOLIŪGADIENIS — /blog/moliugadienis/
// The vine that grows down the day, the float lab, the pumpkin face, the seed
// treasure, the recipe filter, the bingo card with its bedtime story, and the
// dock. Runs after /script.js and /blog/blog.js (reveal, tones, share).
// =============================================

(function () {
  'use strict';

  const page = document.querySelector('.mol-page');
  if (!page) return;

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = reduceQuery.matches;
  const hasIO = 'IntersectionObserver' in window;
  const canAnimate = (el) => !reduceMotion && Boolean(el) && typeof el.animate === 'function';
  const motionHandlers = [];

  function restart(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  // Animations end in a 'finish' or, when interrupted, a 'cancel' — either way, move on
  function whenDone(animation, done) {
    let called = false;
    const once = () => {
      if (called) return;
      called = true;
      done();
    };
    animation.addEventListener('finish', once);
    animation.addEventListener('cancel', once);
  }

  // ---------------------------------------------
  // Stickers and loops rest while their part of the page is off-screen
  // ---------------------------------------------
  if (hasIO) {
    const idleObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle('is-idle', !entry.isIntersecting)),
      { rootMargin: '15% 0px' }
    );
    page.querySelectorAll('.m-hero, .m-need, .m-stop, .m-lab, .m-story').forEach((el) => idleObserver.observe(el));
  }

  // ---------------------------------------------
  // Hero orbit: the sun sets off once the loop is drawn
  // ---------------------------------------------
  const orbit = page.querySelector('[data-orbit]');
  if (orbit) {
    const loop = orbit.querySelector('.orbit__loop');
    const motion = orbit.querySelector('animateMotion');
    let sunUp = false;

    const startSun = () => {
      if (sunUp || reduceMotion || !motion || typeof motion.beginElement !== 'function') return;
      sunUp = true;
      motion.beginElement();
      orbit.classList.add('is-moving');
    };
    window.setTimeout(startSun, 1900);

    if (hasIO && loop && typeof loop.pauseAnimations === 'function') {
      new IntersectionObserver(
        (entries) => entries.forEach((entry) => (entry.isIntersecting ? loop.unpauseAnimations() : loop.pauseAnimations())),
        { rootMargin: '10% 0px' }
      ).observe(orbit);
    }
  }

  // ---------------------------------------------
  // The vine: one green line through the six stops, drawn as far as you have read
  // ---------------------------------------------
  const path = page.querySelector('.m-path');
  const track = path && path.querySelector('[data-vine]');
  if (track) {
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const svg = track.querySelector('.m-vine');
    const shade = svg.querySelector('.m-vine__shade');
    const grow = svg.querySelector('.m-vine__grow');
    const end = track.querySelector('[data-vine-end]');
    const nodes = Array.from(track.querySelectorAll('.m-stop__node'));
    const narrowQuery = window.matchMedia('(max-width: 900px)');

    let length = 0;
    let samples = new Float32Array(0); // y of the vine at evenly spaced lengths
    let nodeYs = [];
    let leaves = [];
    let endY = 0;
    let lastDrawn = -1;
    let lastTip = NaN;

    function lengthAtY(y) {
      const n = samples.length - 1;
      if (y <= samples[0]) return 0;
      if (y >= samples[n]) return length;
      let lo = 0;
      let hi = n;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid] < y) lo = mid;
        else hi = mid;
      }
      const t = (y - samples[lo]) / Math.max(1e-6, samples[hi] - samples[lo]);
      return ((lo + t) / n) * length;
    }

    function update() {
      if (!length) return;
      const tip = reduceMotion ? Infinity : window.innerHeight * 0.62 - track.getBoundingClientRect().top;
      if (tip === lastTip) return;
      lastTip = tip;
      const drawn = reduceMotion ? length : lengthAtY(tip);
      if (Math.abs(drawn - lastDrawn) >= 0.5) {
        lastDrawn = drawn;
        grow.style.strokeDashoffset = (length - drawn).toFixed(1);
      }
      nodes.forEach((node, i) => node.classList.toggle('is-reached', tip >= nodeYs[i] - 4));
      leaves.forEach((leaf) => leaf.el.classList.toggle('is-on', tip >= leaf.y));
      if (end) end.classList.toggle('is-on', tip >= endY - 10);
    }

    function build() {
      const box = track.getBoundingClientRect();
      if (!box.width || !box.height || !nodes.length) return;
      const width = Math.round(box.width);
      const height = Math.round(box.height);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

      const points = nodes.map((node) => {
        const leaf = (node.querySelector('img') || node).getBoundingClientRect();
        return [leaf.left + leaf.width / 2 - box.left, leaf.top + leaf.height / 2 - box.top];
      });
      nodeYs = points.map((point) => point[1]);
      const last = points[points.length - 1];
      endY = Math.max(last[1] + 60, height - 64);
      const route = [[points[0][0], 0], ...points, [last[0], endY]];

      // Each stretch between stops is cut into waves that bend to alternate sides
      const narrow = narrowQuery.matches;
      const amp = narrow ? 9 : 44;
      const wave = narrow ? 230 : 300;
      const bends = [];
      let side = 1;
      let d = `M ${route[0][0].toFixed(1)} 0`;
      for (let i = 1; i < route.length; i++) {
        const [x0, y0] = route[i - 1];
        const [x1, y1] = route[i];
        const parts = Math.max(1, Math.round((y1 - y0) / wave));
        for (let k = 0; k < parts; k++) {
          const xa = x0 + ((x1 - x0) * k) / parts;
          const xb = x0 + ((x1 - x0) * (k + 1)) / parts;
          const ya = y0 + ((y1 - y0) * k) / parts;
          const yb = y0 + ((y1 - y0) * (k + 1)) / parts;
          const bend = amp * side;
          const pull = (yb - ya) * 0.38;
          d += ` C ${(xa + bend).toFixed(1)} ${(ya + pull).toFixed(1)}, ${(xb + bend).toFixed(1)} ${(yb - pull).toFixed(1)}, ${xb.toFixed(1)} ${yb.toFixed(1)}`;
          // the middle of a bent cubic sits 3/4 of the way out
          bends.push({ x: (xa + xb) / 2 + bend * 0.75, y: (ya + yb) / 2, side });
          side = -side;
        }
      }
      shade.setAttribute('d', d);
      grow.setAttribute('d', d);
      length = grow.getTotalLength();
      grow.style.strokeDasharray = `${length.toFixed(1)} ${length.toFixed(1)}`;

      const count = Math.max(80, Math.round(length / 10));
      samples = new Float32Array(count + 1);
      for (let i = 0; i <= count; i++) samples[i] = grow.getPointAtLength((length * i) / count).y;

      // A leaf on the outside of every bend
      leaves.forEach((leaf) => leaf.group.remove());
      leaves = bends.map((bendPoint, i) => {
        const size = i % 3 === 1 ? 0.75 : 1;
        const group = document.createElementNS(SVG_NS, 'g');
        group.setAttribute('transform', `translate(${bendPoint.x.toFixed(1)} ${bendPoint.y.toFixed(1)}) rotate(${bendPoint.side > 0 ? -28 : -152}) scale(${size})`);
        const leaf = document.createElementNS(SVG_NS, 'path');
        leaf.setAttribute('class', 'm-vine__leaf');
        leaf.setAttribute('d', 'M0 0 C 6 -10, 18 -11, 25 0 C 18 11, 6 10, 0 0 Z');
        group.appendChild(leaf);
        svg.insertBefore(group, grow);
        return { group, el: leaf, y: bendPoint.y };
      });

      if (end) {
        end.style.left = `${last[0].toFixed(1)}px`;
        end.style.top = `${endY.toFixed(1)}px`;
        end.style.bottom = 'auto';
      }

      track.classList.add('is-drawn');
      path.classList.toggle('is-live', !reduceMotion);
      lastDrawn = -1;
      lastTip = NaN;
      update();
    }

    let queued = false;
    window.addEventListener(
      'scroll',
      () => {
        if (queued) return;
        queued = true;
        window.requestAnimationFrame(() => {
          queued = false;
          update();
        });
      },
      { passive: true }
    );
    window.addEventListener('resize', () => {
      lastTip = NaN;
      update();
    });

    let buildTimer = 0;
    const queueBuild = () => {
      window.clearTimeout(buildTimer);
      buildTimer = window.setTimeout(build, 120);
    };
    if ('ResizeObserver' in window) new ResizeObserver(queueBuild).observe(track);
    window.addEventListener('load', build);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(build);
    motionHandlers.push(build);
    build();
  }

  // ---------------------------------------------
  // Float lab: guess, drop, see
  // ---------------------------------------------
  const tub = page.querySelector('[data-tub]');
  if (tub) {
    const THINGS = {
      moliugas: { name: 'moliūgas', whom: 'Moliūgą', floats: true, w: 22, text: 'Moliūgas plaukia! Jo viduje daug oro, todėl jis lengvas savo dydžiui.' },
      obuolys: { name: 'obuolys', whom: 'Obuolį', floats: true, w: 13, text: 'Obuolys plaukia – jame irgi slepiasi oro.' },
      bulve: { name: 'bulvė', whom: 'Bulvę', floats: false, w: 15, text: 'Bulvė nuskendo! Ji mažesnė už moliūgą, bet viduje kieta ir tanki – oro joje beveik nėra.' },
      akmenukas: { name: 'akmenukas', whom: 'Akmenuką', floats: false, w: 13, text: 'Akmenukas nuskendo – jis mažas, bet sunkus.' },
      lapas: { name: 'lapas', whom: 'Lapą', floats: true, w: 12, text: 'Lapas plaukia – lengvas ir plokščias, jis guli ant vandens kaip valtelė.' },
      raktas: { name: 'raktas', whom: 'Raktą', floats: false, w: 12, text: 'Raktas nuskendo – metalas sunkus, net jei raktelis mažas.' },
    };
    const SLOTS = { float: [25, 51, 76], sink: [27, 51, 74] };
    const TOTAL = Object.keys(THINGS).length;

    const shelf = Array.from(tub.querySelectorAll('[data-thing]'));
    const guesses = Array.from(tub.querySelectorAll('[data-guess]'));
    const question = tub.querySelector('[data-tub-q]');
    const hover = tub.querySelector('[data-tub-hover]');
    const items = tub.querySelector('[data-tub-items]');
    const glass = tub.querySelector('.m-tub__glass');
    const result = tub.querySelector('[data-tub-result]');
    const score = tub.querySelector('[data-tub-score]');
    const reset = tub.querySelector('[data-tub-reset]');

    const tested = new Map();
    let current = null;
    let right = 0;
    let busy = false;

    const buttonFor = (id) => shelf.find((button) => button.dataset.thing === id);
    const srcOf = (id) => buttonFor(id).querySelector('img').getAttribute('src');

    function sticker(id) {
      const img = document.createElement('img');
      img.src = srcOf(id);
      img.alt = '';
      img.decoding = 'async';
      return img;
    }

    function updateScore() {
      const n = tested.size;
      if (n === 0) score.textContent = `Išbandyta 0 iš ${TOTAL}`;
      else if (n === TOTAL) score.textContent = `Visi ${TOTAL} išbandyti · atspėta ${right}`;
      else score.textContent = `Išbandyta ${n} iš ${TOTAL} · atspėta ${right}`;
      reset.hidden = n === 0;
    }

    function say(lead, text) {
      result.textContent = '';
      if (lead) {
        const b = document.createElement('b');
        b.textContent = lead;
        result.append(b, ' ');
      }
      result.append(text);
    }

    function select(id) {
      if (busy) return;
      current = id;
      const thing = THINGS[id];
      shelf.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.thing === id)));
      const done = tested.get(id);
      if (done) {
        hover.classList.remove('is-on');
        guesses.forEach((button) => { button.disabled = true; });
        question.textContent = `${thing.whom} jau išbandėme – rinkitės kitą daiktą.`;
        say('', thing.text);
        if (!reduceMotion) restart(done.el, 'is-wiggle');
        return;
      }
      hover.textContent = '';
      hover.appendChild(sticker(id));
      hover.classList.add('is-on');
      guesses.forEach((button) => { button.disabled = false; });
      question.textContent = `„Kaip manai – ${thing.name} plauks ar nuskęs?“`;
      result.textContent = '';
    }

    function drop(kind) {
      if (!current || busy || tested.has(current)) return;
      const id = current;
      const thing = THINGS[id];
      const floats = thing.floats;
      const correct = (kind === 'float') === floats;
      if (correct) right += 1;
      busy = true;
      guesses.forEach((button) => { button.disabled = true; });

      const group = floats ? 'float' : 'sink';
      const already = Array.from(tested.values()).filter((entry) => entry.floats === floats).length;
      const x = SLOTS[group][already % 3] + (Math.random() * 4 - 2);
      const holder = document.createElement('span');
      holder.className = `m-tub__item ${floats ? 'is-afloat' : 'is-sunk'}`;
      holder.style.setProperty('--x', `${x.toFixed(1)}%`);
      holder.style.setProperty('--w', `${thing.w}%`);
      const img = sticker(id);
      holder.appendChild(img);
      items.appendChild(holder);
      tested.set(id, { floats, el: holder });

      const finish = () => {
        busy = false;
        if (floats) holder.classList.add('is-bobbing');
        const button = buttonFor(id);
        button.classList.add('is-done');
        button.dataset.result = group;
        say(correct ? 'Atspėjote!' : 'Kitaip, nei spėjote – ir tai atradimas!', thing.text);
        question.textContent = tested.size === TOTAL ? 'Visi daiktai išbandyti!' : 'Pasirinkite kitą daiktą.';
        updateScore();
      };

      const from = hover.firstElementChild;
      hover.classList.remove('is-on');
      if (!canAnimate(img) || !from) {
        finish();
        return;
      }

      // Fly from the hovering copy to the final spot; meet the water on the way
      const a = from.getBoundingClientRect();
      const b = img.getBoundingClientRect();
      const g = glass.getBoundingClientRect();
      const dx = a.left + a.width / 2 - (b.left + b.width / 2);
      const dy = a.top + a.height / 2 - (b.top + b.height / 2);
      const scale = b.width ? a.width / b.width : 1;
      const surface = g.top + g.height * 0.44 - (b.top + b.height / 2);
      const start = { transform: `translate(${dx}px, ${dy}px) scale(${scale}) rotate(-8deg)`, easing: 'cubic-bezier(0.55, 0, 1, 0.45)' };
      const frames = floats
        ? [
            start,
            { transform: 'translate(0, 16px) scale(1) rotate(6deg)', offset: 0.5, easing: 'ease-out' },
            { transform: 'translate(0, -6px) rotate(-3deg)', offset: 0.76, easing: 'ease-in-out' },
            { transform: 'none' },
          ]
        : [
            start,
            { transform: `translate(0, ${surface}px) scale(1) rotate(5deg)`, offset: 0.3, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
            { transform: 'none' },
          ];
      const animation = img.animate(frames, { duration: floats ? 1100 : 1700 });
      whenDone(animation, finish);

      const ripple = document.createElement('span');
      ripple.className = 'm-tub__ripple';
      ripple.style.left = `${x.toFixed(1)}%`;
      glass.appendChild(ripple);
      const wave = ripple.animate(
        [
          { opacity: 0.95, scale: 0.3 },
          { opacity: 0, scale: 1.7 },
        ],
        { duration: 900, delay: floats ? 480 : 500, easing: 'ease-out', fill: 'backwards' }
      );
      whenDone(wave, () => ripple.remove());
    }

    function resetAll() {
      if (busy) return;
      tested.clear();
      right = 0;
      current = null;
      items.textContent = '';
      hover.classList.remove('is-on');
      shelf.forEach((button) => {
        button.setAttribute('aria-pressed', 'false');
        button.classList.remove('is-done');
        delete button.dataset.result;
      });
      guesses.forEach((button) => { button.disabled = true; });
      question.textContent = 'Pasirinkite daiktą iš lentynėlės.';
      result.textContent = '';
      updateScore();
      shelf[0].focus();
    }

    shelf.forEach((button) => button.addEventListener('click', () => select(button.dataset.thing)));
    guesses.forEach((button) => button.addEventListener('click', () => drop(button.dataset.guess)));
    reset.addEventListener('click', resetAll);
    updateScore();
  }

  // ---------------------------------------------
  // Face without a knife: eyes × mouth = a feeling to name
  // ---------------------------------------------
  const face = page.querySelector('[data-face]');
  if (face) {
    const MOODS = {
      'atmerktos|sypsena': ['Linksmas', '„Moliūgas linksmas – jis šypsosi!“'],
      'atmerktos|liudna': ['Liūdnas', '„Moliūgas liūdnas. Kas jį nuliūdino?“'],
      'atmerktos|o': ['Nustebęs', '„Moliūgas nustebęs – ką jis pamatė?“'],
      'dideles|sypsena': ['Džiaugiasi', '„Moliūgas džiaugiasi – net akys spindi!“'],
      'dideles|liudna': ['Išsigandęs', '„Moliūgas išsigandęs. Nebijok, moliūgėli!“'],
      'dideles|o': ['Labai nustebęs', '„Oho! Moliūgas labai nustebęs.“'],
      'uzmerktos|sypsena': ['Ramus', '„Moliūgas ramus ir patenkintas.“'],
      'uzmerktos|liudna': ['Pavargęs', '„Moliūgas pavargęs – gal jam reikia pailsėti?“'],
      'uzmerktos|o': ['Žiovauja', '„Moliūgas žiovauja – jau metas miegoti!“'],
    };
    const state = { eyes: 'atmerktos', mouth: 'sypsena' };
    const parts = Array.from(face.querySelectorAll('.m-face__part'));
    const eyeButtons = Array.from(face.querySelectorAll('[data-face-eyes]'));
    const mouthButtons = Array.from(face.querySelectorAll('[data-face-mouth]'));
    const word = face.querySelector('[data-face-word]');
    const line = face.querySelector('[data-face-say]');
    const surprise = face.querySelector('[data-face-random]');

    function render(changed) {
      parts.forEach((part) => part.classList.toggle('is-on', state[part.dataset.part] === part.dataset.value));
      eyeButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.faceEyes === state.eyes)));
      mouthButtons.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.faceMouth === state.mouth)));
      const [name, sentence] = MOODS[`${state.eyes}|${state.mouth}`];
      word.textContent = name;
      line.textContent = sentence;
      if (changed) restart(word, 'is-new');
    }

    eyeButtons.forEach((button) => button.addEventListener('click', () => {
      state.eyes = button.dataset.faceEyes;
      render(true);
    }));
    mouthButtons.forEach((button) => button.addEventListener('click', () => {
      state.mouth = button.dataset.faceMouth;
      render(true);
    }));
    surprise.addEventListener('click', () => {
      const others = Object.keys(MOODS).filter((key) => key !== `${state.eyes}|${state.mouth}`);
      const [eyes, mouth] = others[Math.floor(Math.random() * others.length)].split('|');
      state.eyes = eyes;
      state.mouth = mouth;
      render(true);
    });
    render(false);
  }

  // ---------------------------------------------
  // Seed treasure: every seed brings a word
  // ---------------------------------------------
  const dig = page.querySelector('[data-dig]');
  if (dig) {
    const WORDS = [
      ['kapstome', 'daro', '„Kapstome sėklas šaukštu.“'],
      ['slidu', 'jaucia', '„Sėkla slidi – išsprūsta iš pirštų!“'],
      ['lipnu', 'jaucia', '„Fui, pirštai lipnūs!“'],
      ['traukiame', 'daro', '„Traukiame oranžinius siūlelius.“'],
      ['drėgna', 'jaucia', '„Viduje drėgna ir vėsu.“'],
      ['kvepia', 'jutimai', '„Pauostyk – kaip kvepia moliūgas?“'],
      ['daug', 'kiek', '„Kiek daug sėklų! Suskaičiuokime.“'],
      ['pilnas', 'kiek', '„Dubenėlis jau pilnas!“'],
      ['tuščias', 'kiek', '„Moliūgas beveik tuščias.“'],
      ['tuk tuk', 'jutimai', '„Pabelsk į moliūgą: tuk tuk!“'],
    ];
    const START = 'Kiekvienoje sėkloje slepiasi žodis. Kapstykite!';
    const list = dig.querySelector('[data-dig-list]');
    const button = dig.querySelector('[data-dig-btn]');
    const label = dig.querySelector('[data-dig-label]');
    const count = dig.querySelector('[data-dig-count]');
    const pumpkin = dig.querySelector('.m-dig__pumpkin');
    const seedSrc = button.querySelector('img').getAttribute('src');
    let found = 0;

    function slots() {
      list.textContent = '';
      WORDS.forEach(() => {
        const li = document.createElement('li');
        li.className = 'm-word is-empty';
        list.appendChild(li);
      });
    }

    function fill(index) {
      const [word, kind, sentence] = WORDS[index];
      const li = list.children[index];
      if (!li) return;
      li.className = `m-word m-word--${kind} is-new`;
      li.textContent = '';
      const b = document.createElement('b');
      b.textContent = word;
      const span = document.createElement('span');
      span.textContent = sentence;
      li.append(b, span);
    }

    button.addEventListener('click', () => {
      if (found >= WORDS.length) {
        found = 0;
        slots();
        label.textContent = 'Kapstyti sėklą';
        count.textContent = START;
        return;
      }
      const index = found;
      found += 1;
      count.textContent = found === WORDS.length
        ? `Visi ${WORDS.length} žodžių rasti! Kurį pasakysite pirmą?`
        : `Rasta ${found} iš ${WORDS.length}: „${WORDS[index][0]}“`;
      if (found === WORDS.length) label.textContent = 'Kapstyti iš naujo';
      if (pumpkin && !reduceMotion) restart(pumpkin, 'is-shake');

      const target = list.children[index];
      if (!pumpkin || !canAnimate(target)) {
        fill(index);
        return;
      }
      // A seed hops out of the pumpkin and lands on its word
      const a = pumpkin.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const x0 = a.left + a.width * 0.5 - 13;
      const y0 = a.top + a.height * 0.3;
      const x1 = b.left + b.width / 2 - 13;
      const y1 = b.top + b.height / 2 - 13;
      const top = Math.min(y0, y1) - 110;
      const seed = document.createElement('img');
      seed.className = 'm-seed-fly';
      seed.src = seedSrc;
      seed.alt = '';
      document.body.appendChild(seed);
      const flight = seed.animate(
        [
          { transform: `translate(${x0}px, ${y0}px) rotate(0deg) scale(0.6)`, opacity: 0 },
          { transform: `translate(${(x0 + x1) / 2}px, ${top}px) rotate(200deg) scale(1.2)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${x1}px, ${y1}px) rotate(400deg) scale(0.8)`, opacity: 1 },
        ],
        { duration: 760, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }
      );
      whenDone(flight, () => {
        seed.remove();
        fill(index);
      });
    });

    slots();
  }

  // ---------------------------------------------
  // Recipe: whose turn is it?
  // ---------------------------------------------
  const recipe = page.querySelector('[data-recipe]');
  if (recipe) {
    const steps = recipe.querySelector('[data-recipe-steps]');
    const buttons = Array.from(recipe.querySelectorAll('[data-recipe-show]'));
    buttons.forEach((button) => button.addEventListener('click', () => {
      steps.dataset.show = button.dataset.recipeShow;
      buttons.forEach((other) => {
        const on = other === button;
        other.classList.toggle('is-active', on);
        other.setAttribute('aria-pressed', String(on));
      });
    }));
  }

  // ---------------------------------------------
  // Bingo marks: kept in this browser, shared by the card, the story and the dock
  // ---------------------------------------------
  const STORE_KEY = 'laviju:moliugadienis';
  const PHRASES = {
    plauks: 'plukdėme moliūgą vonioje',
    sunkesnis: 'svėrėme moliūgą ir obuolį',
    kegliai: 'ridenome moliūgą į butelius',
    veidas: 'piešėme moliūgui veidą',
    seklos: 'kapstėme slidžias sėklas',
    blynai: 'kepėme moliūgų blynelius',
  };
  const TILES = Object.keys(PHRASES);

  function readOrder() {
    try {
      const data = JSON.parse(window.localStorage.getItem(STORE_KEY) || 'null');
      if (!data || data.v !== 1 || !Array.isArray(data.order)) return [];
      return data.order.filter((id, i, all) => TILES.includes(id) && all.indexOf(id) === i);
    } catch (error) {
      return [];
    }
  }

  function writeOrder(order) {
    try {
      if (order.length) window.localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, order }));
      else window.localStorage.removeItem(STORE_KEY);
    } catch (error) {
      // Storage is off: the card still works for this visit.
    }
  }

  let order = readOrder();
  const bingoListeners = [];
  function setOrder(next, byHand) {
    order = next;
    writeOrder(order);
    bingoListeners.forEach((listener) => listener(order, byHand));
  }

  const card = page.querySelector('[data-bingo]');
  if (card) {
    const tiles = Array.from(card.querySelectorAll('[data-tile]'));
    const dots = Array.from(card.querySelectorAll('.m-card__dots i'));
    const status = card.querySelector('[data-bingo-status]');
    const confetti = card.querySelector('[data-confetti]');
    const clear = page.querySelector('[data-bingo-clear]');
    const print = page.querySelector('[data-bingo-print]');
    const LEAVES = ['klevo-lapas', 'azuolo-lapas', 'berzo-lapas', 'moliukas', 'gile', 'kastonas', 'sermuksnis'].map((name) => `/blog/assets/moliugadienis/${name}.webp`);

    function statusText(n) {
      if (n === 0) return `Pažymėta 0 iš ${TILES.length}. Kiek surinksite iki vakaro?`;
      if (n === TILES.length) return 'Moliūgų bingo! Visi šeši langeliai – šaunu!';
      const cheer = n <= 2 ? 'Puiki pradžia!' : n === 3 ? 'Pusė bingo – jau tikras nuotykis!' : 'Liko visai nedaug!';
      return `Pažymėta ${n} iš ${TILES.length}. ${cheer}`;
    }

    function celebrate() {
      if (!canAnimate(confetti)) return;
      const height = card.offsetHeight;
      for (let i = 0; i < 22; i++) {
        const leaf = document.createElement('img');
        leaf.src = LEAVES[i % LEAVES.length];
        leaf.alt = '';
        leaf.style.left = `${(Math.random() * 94).toFixed(1)}%`;
        leaf.style.width = `${Math.round(24 + Math.random() * 22)}px`;
        confetti.appendChild(leaf);
        const fall = leaf.animate(
          [
            { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
            { transform: `translate(${Math.round((Math.random() - 0.5) * 140)}px, ${height + 90}px) rotate(${Math.round((Math.random() - 0.5) * 720)}deg)`, opacity: 0.9 },
          ],
          { duration: 2200 + Math.random() * 1600, delay: Math.random() * 500, easing: 'cubic-bezier(0.3, 0.2, 0.6, 1)', fill: 'backwards' }
        );
        whenDone(fall, () => leaf.remove());
      }
    }

    bingoListeners.push((marked, byHand) => {
      tiles.forEach((tile) => tile.setAttribute('aria-pressed', String(marked.includes(tile.dataset.tile))));
      dots.forEach((dot, i) => dot.classList.toggle('is-on', i < marked.length));
      status.textContent = statusText(marked.length);
      card.classList.toggle('is-full', marked.length === TILES.length);
      if (clear) clear.hidden = marked.length === 0;
      if (byHand && marked.length === TILES.length) celebrate();
    });

    tiles.forEach((tile) => tile.addEventListener('click', () => {
      const id = tile.dataset.tile;
      setOrder(order.includes(id) ? order.filter((other) => other !== id) : [...order, id], true);
    }));

    if (clear) {
      clear.addEventListener('click', () => {
        setOrder([], true);
        tiles[0].focus();
      });
    }

    if (print) {
      const root = document.documentElement;
      window.addEventListener('afterprint', () => root.classList.remove('print-bingo'));
      print.addEventListener('click', () => {
        root.classList.add('print-bingo');
        window.print();
      });
    }
  }

  // ---------------------------------------------
  // Bedtime story: the bingo marks, in the order they were made
  // ---------------------------------------------
  const story = page.querySelector('[data-story]');
  if (story) {
    const tag = story.querySelector('[data-story-tag]');
    const lines = story.querySelector('[data-story-lines]');
    const hint = story.querySelector('[data-story-hint]');
    const EXAMPLE = ['plauks', 'veidas', 'blynai'];
    const MIDDLE = ['Paskui', 'Tada', 'Po to', 'Dar'];

    const linkWords = (n) => {
      if (n === 1) return ['Šiandien'];
      if (n === 2) return ['Pirma', 'Paskui'];
      return ['Pirma', ...MIDDLE.slice(0, n - 2), 'Pabaigoje'];
    };

    bingoListeners.push((marked, byHand) => {
      const yours = marked.length > 0;
      const ids = yours ? marked : EXAMPLE;
      const words = linkWords(ids.length);
      lines.textContent = '';
      ids.forEach((id, i) => {
        const li = document.createElement('li');
        const mark = document.createElement('mark');
        mark.textContent = words[i];
        li.append(mark, ` ${PHRASES[id]}.`);
        if (byHand) {
          li.classList.add('is-new');
          li.style.setProperty('--i', String(i));
        }
        lines.appendChild(li);
      });
      story.classList.toggle('is-yours', yours);
      tag.textContent = yours ? 'Jūsų diena' : 'Pavyzdys';
      if (!yours) hint.textContent = 'Pažymėkite bingo langelius – istorija susidėlios pati, ta tvarka, kuria žymėjote.';
      else if (marked.length === TILES.length) hint.textContent = 'Visa diena vienoje istorijoje! O ką veiksime rytoj?';
      else hint.textContent = 'Perskaitykite garsiai, o vaikas tegul papasakoja, kas buvo toliau.';
    });
  }

  // ---------------------------------------------
  // Dock: shows between the hero and the end, marks where you are and what is done
  // ---------------------------------------------
  const dock = document.querySelector('[data-dock]');
  if (dock && hasIO) {
    const hero = page.querySelector('.m-hero');
    const blockers = [hero, card, document.getElementById('cta'), document.getElementById('footer')].filter(Boolean);
    const visible = new Set();
    const blockerObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => (entry.isIntersecting ? visible.add(entry.target) : visible.delete(entry.target)));
      dock.classList.toggle('is-shown', visible.size === 0);
    });
    blockers.forEach((el) => blockerObserver.observe(el));

    const links = Array.from(dock.querySelectorAll('[data-dock-for]'));
    const count = dock.querySelector('[data-dock-count]');
    const stopObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        links.forEach((link) => {
          const here = link.dataset.dockFor === entry.target.id;
          link.classList.toggle('is-current', here);
          if (here) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }),
      { rootMargin: '-45% 0px -50% 0px' }
    );
    links.forEach((link) => {
      const stop = document.getElementById(link.dataset.dockFor);
      if (stop) stopObserver.observe(stop);
    });

    bingoListeners.push((marked) => {
      if (count) count.textContent = `${marked.length}/${TILES.length}`;
      links.forEach((link) => link.classList.toggle('is-done', marked.includes(link.dataset.dockFor)));
    });
  }

  bingoListeners.forEach((listener) => listener(order, false));

  const onMotionChange = () => {
    reduceMotion = reduceQuery.matches;
    motionHandlers.forEach((handler) => handler());
  };
  if (reduceQuery.addEventListener) reduceQuery.addEventListener('change', onMotionChange);
})();
