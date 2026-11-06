// =============================================
// PYRAGŲ DIENA — /blog/pyragu-diena/
// The steam over the cake that a pointer can blow aside, the slice that
// lifts as the page scrolls, the note that knows how far off the day is,
// the label's numbers, the oven dial for the child's age, the kitchen timer
// that runs down as the four waiting slices pass, the word jars and the
// little cake in the corner that fills as you read. Runs after /script.js
// and /blog/blog.js (reveal, tones, share).
// =============================================

(function () {
  'use strict';

  const page = document.querySelector('.pyr-page');
  if (!page) return;

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = reduceQuery.matches;
  const hasIO = 'IntersectionObserver' in window;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const motionHandlers = [];

  if (typeof reduceQuery.addEventListener === 'function') {
    reduceQuery.addEventListener('change', (event) => {
      reduceMotion = event.matches;
      motionHandlers.forEach((handler) => handler());
    });
  }

  // A wedge of a circle as an SVG path, angles in degrees from 12 o'clock, clockwise
  function wedgePath(cx, cy, r, from, to) {
    const point = (deg) => {
      const rad = ((deg - 90) * Math.PI) / 180;
      return `${(cx + Math.cos(rad) * r).toFixed(2)} ${(cy + Math.sin(rad) * r).toFixed(2)}`;
    };
    const large = to - from > 180 ? 1 : 0;
    return `M ${cx} ${cy} L ${point(from)} A ${r} ${r} 0 ${large} 1 ${point(to)} Z`;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => el.setAttribute(key, attrs[key]));
    return el;
  }

  // ---------------------------------------------
  // Stickers and loops rest while their part of the page is off-screen
  // ---------------------------------------------
  if (hasIO) {
    const idleObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle('is-idle', !entry.isIntersecting)),
      { rootMargin: '15% 0px' }
    );
    page.querySelectorAll('.p-hero, .p-sec').forEach((el) => idleObserver.observe(el));
  }

  // ---------------------------------------------
  // "Rytoj – Pyragų diena!": the note under the title counts the days in Vilnius
  // ---------------------------------------------
  const when = page.querySelector('[data-when]');
  if (when) {
    let today;
    try {
      today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vilnius', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch (error) {
      today = new Date().toISOString().slice(0, 10);
    }
    const [year, month, day] = today.split('-').map(Number);
    const daysLeft = Math.round((Date.UTC(year, 10, 6) - Date.UTC(year, month - 1, day)) / 86400000);
    const dienos = (n) => {
      if (n % 10 === 1 && n % 100 !== 11) return 'diena';
      if (n % 10 >= 2 && n % 10 <= 9 && (n % 100 < 11 || n % 100 > 19)) return 'dienos';
      return 'dienų';
    };
    let text = '';
    if (daysLeft === 0) text = 'Šiandien – Pyragų diena!';
    else if (daysLeft === 1) text = 'Rytoj – Pyragų diena!';
    else if (daysLeft > 1 && daysLeft <= 21) text = `Iki Pyragų dienos liko ${daysLeft} ${dienos(daysLeft)}`;
    if (text) {
      when.textContent = text;
      when.hidden = false;
    }
  }

  // ---------------------------------------------
  // The cake on the table: one slice is cut, and lifts away as you scroll
  // ---------------------------------------------
  const hero = page.querySelector('.p-hero');
  const table = page.querySelector('[data-table]');
  const cake = table && table.querySelector('[data-cake]');
  if (hero && cake) {
    const rest = cake.querySelector('.p-cake__rest');
    const slice = cake.querySelector('.p-cake__slice');
    // the cake's circle in the picture (fractions of its width), from GENERATED.md
    const cx = parseFloat(cake.dataset.cx) || 0.5;
    const cy = parseFloat(cake.dataset.cy) || 0.5;
    const r = (parseFloat(cake.dataset.r) || 0.43) + 0.01;
    // the slice points down and to the left, towards the words
    const FROM = 199;
    const TO = 244;
    const MID = ((FROM + TO) / 2 - 90) * (Math.PI / 180);

    const arc = (from, to) => {
      const points = [`${(cx * 100).toFixed(2)}% ${(cy * 100).toFixed(2)}%`];
      const steps = Math.max(2, Math.ceil((to - from) / 4));
      for (let i = 0; i <= steps; i += 1) {
        const rad = ((from + ((to - from) * i) / steps - 90) * Math.PI) / 180;
        points.push(`${((cx + Math.cos(rad) * r) * 100).toFixed(2)}% ${((cy + Math.sin(rad) * r) * 100).toFixed(2)}%`);
      }
      return `polygon(${points.join(', ')})`;
    };
    slice.style.clipPath = arc(FROM, TO);
    rest.style.clipPath = arc(TO, FROM + 360);
    cake.classList.add('is-cut');

    let heroHeight = 1;
    let lastLift = -1;
    const measure = () => {
      heroHeight = Math.max(1, hero.offsetHeight);
    };
    const lift = () => {
      const p = reduceMotion ? 0.3 : easeOutCubic(clamp(window.scrollY / (heroHeight * 0.55), 0, 1));
      if (Math.abs(p - lastLift) < 0.002) return;
      lastLift = p;
      const size = cake.offsetWidth;
      const distance = lerp(0.035, 0.2, p) * size;
      const x = Math.cos(MID) * distance;
      const y = Math.sin(MID) * distance - p * size * 0.05;
      slice.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${(-9 * p).toFixed(2)}deg) scale(${(1 + p * 0.06).toFixed(3)})`;
    };
    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(() => {
        queued = false;
        lift();
      });
    };
    measure();
    lift();
    window.addEventListener('scroll', () => {
      if (window.scrollY < heroHeight * 1.2 || lastLift < 1) queue();
    }, { passive: true });
    window.addEventListener('resize', () => {
      measure();
      lastLift = -1;
      queue();
    });
    motionHandlers.push(() => {
      lastLift = -1;
      queue();
    });
  }

  // ---------------------------------------------
  // Steam: soft puffs rise off the cake; a moving pointer (or finger) blows them aside
  // ---------------------------------------------
  const steam = table && table.querySelector('[data-steam]');
  if (steam && steam.getContext) {
    const ctx = steam.getContext('2d');
    const puffs = [];
    const MAX = 64;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let running = false;
    let visible = true;
    let last = 0;
    let spawn = 0;
    let wind = { x: 0, y: 0, vx: 0, vy: 0, t: 0 };
    let blown = false;
    let hintTimer = 0;

    // One soft round puff, drawn once and reused
    const sprite = document.createElement('canvas');
    sprite.width = sprite.height = 64;
    const sctx = sprite.getContext('2d');
    const grad = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
    grad.addColorStop(0.45, 'rgba(255, 252, 246, 0.42)');
    grad.addColorStop(1, 'rgba(255, 250, 240, 0)');
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, 64, 64);

    function size() {
      const box = steam.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = box.width;
      height = box.height;
      steam.width = Math.round(width * dpr);
      steam.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Puffs start on the cake's top: an ellipse in the lower middle of the canvas
    function addPuff() {
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random());
      puffs.push({
        x: width * 0.5 + Math.cos(a) * d * width * 0.3,
        y: height * 0.66 + Math.sin(a) * d * height * 0.22,
        vx: (Math.random() - 0.5) * 6,
        vy: -(14 + Math.random() * 16),
        size: width * (0.07 + Math.random() * 0.06),
        life: 0,
        max: 2.6 + Math.random() * 1.8,
        seed: Math.random() * 100,
      });
    }

    function frame(now) {
      if (!running) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000);
      last = now;
      spawn += dt * 16;
      while (spawn > 1) {
        spawn -= 1;
        if (puffs.length < MAX) addPuff();
      }
      wind.t = Math.max(0, wind.t - dt * 1.6);
      ctx.clearRect(0, 0, width, height);
      for (let i = puffs.length - 1; i >= 0; i -= 1) {
        const p = puffs[i];
        p.life += dt;
        if (p.life >= p.max || p.y < -p.size) {
          puffs.splice(i, 1);
          continue;
        }
        // a lazy curl, then the blow from the pointer, fading with distance
        const curl = Math.sin(p.seed + p.life * 1.7) * 10;
        if (wind.t > 0) {
          const dx = p.x - wind.x;
          const dy = p.y - wind.y;
          const reach = width * 0.28;
          const near = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / reach);
          p.vx += wind.vx * near * wind.t * dt * 2.2;
          p.vy += wind.vy * near * wind.t * dt * 2.2;
        }
        p.vx *= 1 - dt * 0.9;
        p.vy = lerp(p.vy, -24, dt * 0.6);
        p.x += (p.vx + curl) * dt;
        p.y += p.vy * dt;
        const t = p.life / p.max;
        const alpha = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.42;
        const s = p.size * (0.7 + t * 1.6);
        ctx.globalAlpha = alpha;
        ctx.drawImage(sprite, p.x - s / 2, p.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
      window.requestAnimationFrame(frame);
    }

    function start() {
      if (running || reduceMotion || !visible || document.hidden) return;
      running = true;
      last = 0;
      window.requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
    }

    function blow(event) {
      const box = steam.getBoundingClientRect();
      const x = event.clientX - box.left;
      const y = event.clientY - box.top;
      if (wind.px !== undefined) {
        wind.vx = clamp((x - wind.px) * 9, -900, 900);
        wind.vy = clamp((y - wind.py) * 9, -900, 900);
        wind.t = 1;
        if (!blown && Math.abs(wind.vx) + Math.abs(wind.vy) > 260) {
          blown = true;
          table.classList.remove('is-hinting');
        }
      }
      wind.x = x;
      wind.y = y;
      wind.px = x;
      wind.py = y;
    }

    size();
    table.addEventListener('pointermove', blow, { passive: true });
    table.addEventListener('pointerleave', () => {
      wind.px = undefined;
    });
    window.addEventListener('resize', () => {
      window.clearTimeout(size.timer);
      size.timer = window.setTimeout(size, 120);
    });
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
    if (hasIO) {
      new IntersectionObserver((entries) => {
        visible = entries[0].isIntersecting;
        if (visible) start();
        else stop();
      }, { rootMargin: '10% 0px' }).observe(table);
    }
    motionHandlers.push(() => {
      if (reduceMotion) {
        stop();
        ctx.clearRect(0, 0, width, height);
      } else {
        start();
      }
    });
    start();

    // "Pūsk – karšta!" shows once the page has settled, until someone blows
    hintTimer = window.setTimeout(() => {
      if (!blown && !reduceMotion) table.classList.add('is-hinting');
    }, 2600);
    table.addEventListener('pointerdown', () => window.clearTimeout(hintTimer), { once: true });
  }

  // ---------------------------------------------
  // The label: its amounts count up as it comes into view
  // ---------------------------------------------
  const facts = page.querySelector('.p-facts');
  if (facts) {
    const numbers = Array.from(facts.querySelectorAll('[data-amount]'));
    numbers.forEach((el) => {
      el.dataset.final = el.textContent;
    });
    // 1 žodis, 2 žodžiai, 10 žodžių – the noun follows the number
    const plural = (n, forms) => {
      const [one, few, many] = forms.split('|');
      if (n % 10 === 1 && n % 100 !== 11) return one;
      if (n % 10 >= 2 && (n % 100 < 11 || n % 100 > 19)) return few;
      return many;
    };
    const say = (el, n) => `${n} ${el.dataset.forms ? plural(n, el.dataset.forms) : el.dataset.unit}`;
    const countUp = () => {
      if (reduceMotion) return;
      const startTime = performance.now();
      const tick = (now) => {
        const t = clamp((now - startTime) / 1400, 0, 1);
        numbers.forEach((el, i) => {
          const local = clamp(t * 1.3 - i * 0.06, 0, 1);
          // the last step shows the written amount, so 5½ ends as „5½ indelio“
          el.textContent = local < 1 ? say(el, Math.floor(easeOutCubic(local) * Number(el.dataset.amount))) : el.dataset.final;
        });
        if (t < 1) window.requestAnimationFrame(tick);
      };
      numbers.forEach((el) => {
        el.textContent = say(el, 0);
      });
      window.requestAnimationFrame(tick);
    };
    if (hasIO && !reduceMotion) {
      const once = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        once.disconnect();
        countUp();
      }, { threshold: 0.35 });
      once.observe(facts);
    }
  }

  // ---------------------------------------------
  // The oven dial: turn it (or pick a number) to see what a child of that age can do
  // ---------------------------------------------
  const dial = page.querySelector('[data-dial]');
  if (dial) {
    const knob = dial.querySelector('[data-dial-knob]');
    const marks = dial.querySelector('.p-dial__marks');
    const radios = Array.from(dial.querySelectorAll('input[name="p-amzius"]'));
    const panels = Array.from(dial.querySelectorAll('.p-age'));
    const status = dial.querySelector('[data-dial-status]');
    const angles = radios.map((radio) => parseFloat(radio.closest('.p-dial__age').style.getPropertyValue('--a')) || 0);

    // Tick marks around the plate; the long ones point at the four ages
    if (marks) {
      for (let deg = -80; deg <= 80; deg += 10) {
        const major = angles.some((a) => Math.abs(a - deg) < 1);
        const rad = ((deg - 90) * Math.PI) / 180;
        const r1 = major ? 70 : 76;
        marks.appendChild(svgEl('line', {
          x1: (100 + Math.cos(rad) * r1).toFixed(2),
          y1: (100 + Math.sin(rad) * r1).toFixed(2),
          x2: (100 + Math.cos(rad) * 84).toFixed(2),
          y2: (100 + Math.sin(rad) * 84).toFixed(2),
          class: major ? 'is-major' : '',
        }));
      }
    }

    function show(index, announce) {
      radios[index].checked = true;
      knob.style.setProperty('--knob', `${angles[index]}deg`);
      panels.forEach((panel, i) => panel.classList.toggle('is-on', i === index));
      if (status && announce) {
        const jobs = panels[index].querySelectorAll('.p-jobs li').length;
        status.textContent = `${radios[index].value} metų vaikas: ${jobs} darbai.`;
      }
    }

    radios.forEach((radio, i) => radio.addEventListener('change', () => show(i, true)));
    show(Math.max(0, radios.findIndex((radio) => radio.checked)), false);

    // Dragging the knob turns it; letting go snaps to the nearest age
    let dragging = false;
    const angleAt = (event) => {
      const box = knob.getBoundingClientRect();
      const x = event.clientX - (box.left + box.width / 2);
      const y = event.clientY - (box.top + box.height / 2);
      return clamp((Math.atan2(x, -y) * 180) / Math.PI, -80, 80);
    };
    const nearest = (deg) => angles.reduce((best, a, i) => (Math.abs(a - deg) < Math.abs(angles[best] - deg) ? i : best), 0);
    knob.addEventListener('pointerdown', (event) => {
      dragging = true;
      knob.setPointerCapture(event.pointerId);
      knob.classList.add('is-dragging');
    });
    knob.addEventListener('pointermove', (event) => {
      if (!dragging) return;
      const deg = angleAt(event);
      knob.style.setProperty('--knob', `${deg.toFixed(1)}deg`);
      const index = nearest(deg);
      if (!radios[index].checked) show(index, true);
      knob.style.setProperty('--knob', `${deg.toFixed(1)}deg`);
    });
    const release = (event) => {
      if (!dragging) return;
      dragging = false;
      knob.classList.remove('is-dragging');
      const index = nearest(angleAt(event));
      show(index, true);
    };
    knob.addEventListener('pointerup', release);
    knob.addEventListener('pointercancel', release);
  }

  // ---------------------------------------------
  // The kitchen timer: four ten-minute slices; the hand moves on as each card is read
  // ---------------------------------------------
  const timer = page.querySelector('[data-timer]');
  const waitCards = Array.from(page.querySelectorAll('.p-wcard'));
  if (timer && waitCards.length) {
    const slices = timer.querySelector('.p-timer__slices');
    const ticks = timer.querySelector('.p-timer__ticks');
    const read = timer.querySelector('[data-timer-read]');
    const parts = waitCards.map((card, i) => {
      const path = svgEl('path', {
        d: wedgePath(120, 120, 102, i * 90, (i + 1) * 90),
        fill: getComputedStyle(card).getPropertyValue('--c').trim() || '#E6E0FA',
      });
      slices.appendChild(path);
      return path;
    });
    for (let minute = 0; minute < 40; minute += 1) {
      const deg = minute * 9;
      const major = minute % 10 === 0;
      const rad = ((deg - 90) * Math.PI) / 180;
      const r1 = major ? 92 : 100;
      ticks.appendChild(svgEl('line', {
        x1: (120 + Math.cos(rad) * r1).toFixed(2),
        y1: (120 + Math.sin(rad) * r1).toFixed(2),
        x2: (120 + Math.cos(rad) * 108).toFixed(2),
        y2: (120 + Math.sin(rad) * 108).toFixed(2),
        class: major ? 'is-major' : '',
      }));
    }

    let current = -1;
    let ringTimer = 0;
    function setSlice(index) {
      if (index === current) return;
      current = index;
      window.clearTimeout(ringTimer);
      timer.classList.remove('is-ringing');
      waitCards.forEach((card, i) => card.classList.toggle('is-on', i === index));
      parts.forEach((path, i) => {
        path.classList.toggle('is-on', i === index);
        path.classList.toggle('is-done', i < index);
      });
      timer.style.setProperty('--hand', `${index * 90 + 45}deg`);
      read.textContent = `Liko ${40 - index * 10} min`;
      if (index === waitCards.length - 1) {
        ringTimer = window.setTimeout(() => {
          timer.style.setProperty('--hand', '360deg');
          read.textContent = 'Iškepė!';
          parts.forEach((path) => path.classList.add('is-done'));
          timer.classList.add('is-ringing');
        }, reduceMotion ? 0 : 2400);
      }
    }

    if (hasIO) {
      const cardObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) setSlice(waitCards.indexOf(entry.target));
        });
      }, { rootMargin: '-45% 0px -45% 0px' });
      waitCards.forEach((card) => cardObserver.observe(card));
    } else {
      setSlice(0);
    }
  }

  // ---------------------------------------------
  // Word jars: open one to read its word, clap its syllables and ask its question
  // ---------------------------------------------
  const shelf = page.querySelector('[data-shelf]');
  if (shelf) {
    const jars = Array.from(shelf.querySelectorAll('.p-jar'));
    const card = shelf.querySelector('[data-word-card]');
    const hint = card.querySelector('.p-word__hint');
    const items = Array.from(card.querySelectorAll('.p-word__item'));

    function puff(jar) {
      if (reduceMotion) return;
      const color = getComputedStyle(jar).getPropertyValue('--dot').trim() || getComputedStyle(jar).getPropertyValue('--fill').trim();
      for (let i = 0; i < 9; i += 1) {
        const dot = document.createElement('span');
        dot.className = 'p-jar__puff';
        const a = (-90 + (Math.random() - 0.5) * 120) * (Math.PI / 180);
        const d = 30 + Math.random() * 40;
        dot.style.setProperty('--dx', `${(Math.cos(a) * d).toFixed(1)}px`);
        dot.style.setProperty('--dy', `${(Math.sin(a) * d).toFixed(1)}px`);
        dot.style.setProperty('--dot', color);
        dot.style.animationDelay = `${(Math.random() * 0.12).toFixed(2)}s`;
        jar.appendChild(dot);
        dot.addEventListener('animationend', () => dot.remove());
      }
    }

    jars.forEach((jar) => {
      jar.addEventListener('click', () => {
        const word = jar.dataset.word;
        jars.forEach((other) => other.setAttribute('aria-pressed', String(other === jar)));
        items.forEach((item) => item.classList.toggle('is-on', item.dataset.word === word));
        if (hint) hint.hidden = true;
        puff(jar);
        // on narrow screens the card is under the shelf: bring it into view
        if (window.matchMedia('(max-width: 1100px)').matches) {
          const box = card.getBoundingClientRect();
          if (box.bottom > window.innerHeight || box.top < 0) {
            card.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'nearest' });
          }
        }
      });
    });
  }

  // ---------------------------------------------
  // Sources: the full list stays folded until it is wanted. A citation link
  // opens it first (capture runs before blog.js scrolls to the entry), and so
  // does an address that names a source.
  // ---------------------------------------------
  const sources = page.querySelector('[data-sources]');
  if (sources) {
    const openFor = (hash) => {
      if (!/^#saltinis-/.test(hash) || !sources.querySelector(hash)) return false;
      sources.open = true;
      return true;
    };
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#saltinis-"]');
      if (link) openFor(link.getAttribute('href'));
    }, true);
    if (openFor(window.location.hash)) {
      document.querySelector(window.location.hash)?.scrollIntoView({ block: 'center' });
    }
  }

  // ---------------------------------------------
  // Dock: the little cake fills a slice for every part you have passed
  // ---------------------------------------------
  const dock = document.querySelector('[data-dock]');
  if (dock) {
    const button = dock.querySelector('[data-dock-btn]');
    const list = dock.querySelector('.p-dock__list');
    const label = dock.querySelector('[data-dock-label]');
    // keep links and parts paired, so a missing part cannot shift the labels
    const pairs = Array.from(list.querySelectorAll('a'))
      .map((link) => ({ link, part: document.querySelector(link.getAttribute('href')) }))
      .filter((pair) => pair.part);
    const links = pairs.map((pair) => pair.link);
    const parts = pairs.map((pair) => pair.part);
    const pie = dock.querySelector('[data-dock-pie]');
    const wedges = parts.map((part, i) => {
      const step = 360 / parts.length;
      const path = svgEl('path', { d: wedgePath(20, 20, 16, i * step, (i + 1) * step) });
      pie.appendChild(path);
      return path;
    });
    const heroEl = page.querySelector('.p-hero');
    const end = page.querySelector('#saltiniai');
    // the dock steps aside while a game is on screen, so it never covers its buttons
    const games = Array.from(page.querySelectorAll('[data-pk-game], [data-pp-game]'));
    const overGame = () => games.some((game) => {
      const r = game.getBoundingClientRect();
      return r.top < window.innerHeight - 40 && r.bottom > 40;
    });
    let tops = [];
    let shownFrom = 0;
    let hideAt = Infinity;
    let currentPart = -2;

    const measureDock = () => {
      tops = parts.map((part) => part.getBoundingClientRect().top + window.scrollY);
      shownFrom = heroEl ? heroEl.offsetTop + heroEl.offsetHeight * 0.7 : 400;
      hideAt = end ? end.getBoundingClientRect().top + window.scrollY - window.innerHeight * 0.4 : Infinity;
    };

    const setOpen = (open) => {
      button.setAttribute('aria-expanded', String(open));
      list.hidden = !open;
    };

    const update = () => {
      const y = window.scrollY;
      const line = y + window.innerHeight * 0.4;
      const shown = y > shownFrom && y < hideAt && !overGame();
      dock.classList.toggle('is-shown', shown);
      if (!shown && !list.hidden) setOpen(false);
      let index = -1;
      tops.forEach((top, i) => {
        if (line >= top) index = i;
      });
      if (index === currentPart) return;
      currentPart = index;
      wedges.forEach((wedge, i) => {
        wedge.classList.toggle('is-read', i < index);
        wedge.classList.toggle('is-now', i === index);
      });
      links.forEach((link, i) => {
        link.classList.toggle('is-read', i < index);
        if (i === index) link.setAttribute('aria-current', 'true');
        else link.removeAttribute('aria-current');
      });
      if (index >= 0) label.textContent = links[index].textContent;
    };

    let dockQueued = false;
    window.addEventListener('scroll', () => {
      if (dockQueued) return;
      dockQueued = true;
      window.requestAnimationFrame(() => {
        dockQueued = false;
        update();
      });
    }, { passive: true });
    window.addEventListener('resize', () => {
      window.clearTimeout(measureDock.timer);
      measureDock.timer = window.setTimeout(() => {
        measureDock();
        currentPart = -2;
        update();
      }, 150);
    });
    // pictures and the games change the page's height after load
    window.addEventListener('load', () => {
      measureDock();
      currentPart = -2;
      update();
    });
    if ('ResizeObserver' in window) {
      new ResizeObserver(() => {
        measureDock();
        currentPart = -2;
        update();
      }).observe(page);
    }
    measureDock();
    update();

    button.addEventListener('click', () => setOpen(list.hidden));
    links.forEach((link) => link.addEventListener('click', () => setOpen(false)));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !list.hidden) {
        setOpen(false);
        button.focus();
      }
    });
    document.addEventListener('pointerdown', (event) => {
      if (!list.hidden && !dock.contains(event.target)) setOpen(false);
    });
  }
})();
