// =============================================
// LAVIJU TINKLARAŠTIS — scroll storytelling & interactions
// Runs after /script.js (shared nav, mobile menu, anchor scrolling).
// =============================================

(function () {
  'use strict';

  const doc = document.documentElement;
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointerQuery = window.matchMedia('(hover: hover) and (pointer: fine)');
  const pinQuery = window.matchMedia('(min-width: 901px) and (min-height: 600px)');
  let reduceMotion = reduceQuery.matches;
  const hasIO = 'IntersectionObserver' in window;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (edge0, edge1, x) => {
    const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const pageTop = (el) => el.getBoundingClientRect().top + window.scrollY;

  // ---------------------------------------------
  // Scroll + measure loop (one rAF per frame, cached geometry)
  // ---------------------------------------------
  const scrollHandlers = [];
  const measureHandlers = [];
  let scrollQueued = false;
  let viewportH = window.innerHeight;
  let viewportW = window.innerWidth;

  function runScroll() {
    scrollQueued = false;
    const y = window.scrollY;
    for (const handler of scrollHandlers) handler(y, viewportH);
  }

  function queueScroll() {
    if (!scrollQueued) {
      scrollQueued = true;
      window.requestAnimationFrame(runScroll);
    }
  }

  function measureAll() {
    viewportH = window.innerHeight;
    viewportW = window.innerWidth;
    for (const handler of measureHandlers) handler();
    runScroll();
  }

  let resizeTimer = 0;
  function queueMeasure() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(measureAll, 120);
  }

  window.addEventListener('scroll', queueScroll, { passive: true });
  window.addEventListener('resize', queueMeasure);

  // ---------------------------------------------
  // Reading progress
  // ---------------------------------------------
  const progressBar = document.querySelector('.read-progress__bar');
  let scrollRange = 1;
  measureHandlers.push(() => {
    scrollRange = Math.max(1, doc.scrollHeight - viewportH);
  });
  scrollHandlers.push((y) => {
    if (progressBar) progressBar.style.transform = `scaleX(${clamp(y / scrollRange, 0, 1)})`;
  });

  // ---------------------------------------------
  // Tone canvas: background drifts between section pastels
  // ---------------------------------------------
  const TONES = {
    base: '#F4F7FC',
    white: '#FFFFFF',
    sage: '#F1F8F3',
    butter: '#FFF9EA',
    peach: '#FFF4EF',
    lilac: '#F5F3FD',
    sky: '#EEF5FD',
  };
  const toneCanvas = document.querySelector('.tone-canvas');

  if (toneCanvas && hasIO) {
    const toneObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const tone = TONES[entry.target.dataset.tone] || TONES.base;
            toneCanvas.style.setProperty('--tone', tone);
          }
        });
      },
      { rootMargin: '-48% 0px -48% 0px' }
    );
    document.querySelectorAll('[data-tone]').forEach((section) => toneObserver.observe(section));
  }

  // ---------------------------------------------
  // Reveal on scroll (staggered per batch)
  // ---------------------------------------------
  const revealTargets = Array.from(document.querySelectorAll('[data-reveal]'));

  function revealNow(el) {
    if (el.classList.contains('is-in')) return;
    el.style.transition = 'none';
    el.classList.add('is-in');
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        el.style.transition = '';
      });
    });
  }

  let revealObserver = null;
  if (hasIO && !reduceMotion) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        const entering = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left));

        entering.forEach((entry, index) => {
          const el = entry.target;
          el.style.setProperty('--rd', `${Math.min(index, 6) * 0.08}s`);
          el.classList.add('is-in');
          revealObserver.unobserve(el);
          window.setTimeout(() => el.style.removeProperty('--rd'), 1600);
        });
      },
      { threshold: 0.12, rootMargin: '0px 0px -6% 0px' }
    );
    revealTargets.forEach((el) => revealObserver.observe(el));
  } else {
    revealTargets.forEach((el) => el.classList.add('is-in'));
  }

  // Pause idle sticker animations while their section is off-screen
  if (hasIO) {
    const idleObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle('is-idle', !entry.isIntersecting)),
      { rootMargin: '15% 0px' }
    );
    document.querySelectorAll('.b-hero, .b-section, .day, .marquee, .b-cta, .situation, .together').forEach((el) => idleObserver.observe(el));
  }

  // ---------------------------------------------
  // Hero: kinetic title lines + layered parallax
  // ---------------------------------------------
  const hero = document.querySelector('.b-hero');
  if (hero) {
    const heroLines = Array.from(hero.querySelectorAll('[data-hero-line]'));
    const layers = Array.from(hero.querySelectorAll('.layer[data-depth]')).map((el) => ({
      el,
      depth: parseFloat(el.dataset.depth) || 0,
    }));
    let heroHeight = 1;
    let heroScroll = 0;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    let pointerRaf = 0;
    let heroVisible = true;

    function applyLayers() {
      const scrollLift = heroScroll;
      for (const layer of layers) {
        const x = pointerX * layer.depth * 22;
        const y = pointerY * layer.depth * 16 - scrollLift * layer.depth * 0.22;
        layer.el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      }
    }

    measureHandlers.push(() => {
      heroHeight = Math.max(1, hero.offsetHeight);
    });

    scrollHandlers.push((y) => {
      if (reduceMotion) return;
      if (y > heroHeight * 1.1 && heroScroll > heroHeight) return;
      heroScroll = y;
      const p = clamp(y / heroHeight, 0, 1);
      heroLines.forEach((line) => {
        const dir = parseFloat(line.dataset.heroLine) || 0;
        line.style.transform = p > 0 ? `translate3d(${(dir * p * 9).toFixed(3)}vw, 0, 0)` : '';
        line.style.opacity = p > 0 ? String(1 - p * 0.55) : '';
      });
      applyLayers();
    });

    function pointerLoop() {
      pointerX = lerp(pointerX, targetX, 0.08);
      pointerY = lerp(pointerY, targetY, 0.08);
      applyLayers();
      if (Math.abs(pointerX - targetX) > 0.001 || Math.abs(pointerY - targetY) > 0.001) {
        pointerRaf = window.requestAnimationFrame(pointerLoop);
      } else {
        pointerRaf = 0;
      }
    }

    if (hasIO) {
      new IntersectionObserver((entries) => {
        heroVisible = entries[0].isIntersecting;
      }).observe(hero);
    }

    window.addEventListener(
      'pointermove',
      (event) => {
        if (reduceMotion || !finePointerQuery.matches || !heroVisible) return;
        targetX = (event.clientX / viewportW) * 2 - 1;
        targetY = (event.clientY / viewportH) * 2 - 1;
        if (!pointerRaf) pointerRaf = window.requestAnimationFrame(pointerLoop);
      },
      { passive: true }
    );
  }

  // ---------------------------------------------
  // Magnetic buttons
  // ---------------------------------------------
  document.querySelectorAll('.magnetic').forEach((el) => {
    el.addEventListener('pointermove', (event) => {
      if (reduceMotion || !finePointerQuery.matches) return;
      const rect = el.getBoundingClientRect();
      const dx = (event.clientX - (rect.left + rect.width / 2)) / rect.width;
      const dy = (event.clientY - (rect.top + rect.height / 2)) / rect.height;
      el.style.translate = `${(dx * 10).toFixed(1)}px ${(dy * 8).toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => {
      el.style.translate = '';
    });
  });

  // ---------------------------------------------
  // Marquee: loops forever, speeds up / reverses with scroll velocity
  // ---------------------------------------------
  const marqueeTrack = document.querySelector('.marquee__track');
  if (marqueeTrack) {
    const group = marqueeTrack.querySelector('.marquee__group');
    if (group) marqueeTrack.appendChild(group.cloneNode(true));

    if (!reduceMotion && typeof marqueeTrack.animate === 'function') {
      const duration = 42000;
      const marqueeAnimation = marqueeTrack.animate(
        [{ transform: 'translate3d(0, 0, 0)' }, { transform: 'translate3d(-50%, 0, 0)' }],
        { duration, iterations: Infinity }
      );
      marqueeAnimation.currentTime = duration * 500;

      let lastY = window.scrollY;
      let rate = 1;
      let targetRate = 1;
      let direction = 1;
      let rateRaf = 0;
      let marqueeVisible = false;

      function rateLoop() {
        targetRate = lerp(targetRate, direction, 0.04);
        rate = lerp(rate, targetRate, 0.12);
        marqueeAnimation.playbackRate = rate;
        if (Math.abs(rate - direction) > 0.01) {
          rateRaf = window.requestAnimationFrame(rateLoop);
        } else {
          marqueeAnimation.playbackRate = direction;
          rateRaf = 0;
        }
      }

      scrollHandlers.push((y) => {
        const delta = y - lastY;
        lastY = y;
        if (!marqueeVisible || delta === 0) return;
        direction = delta > 0 ? 1 : -1;
        targetRate = direction * clamp(1 + Math.abs(delta) * 0.09, 1, 5);
        if (!rateRaf) rateRaf = window.requestAnimationFrame(rateLoop);
      });

      if (hasIO) {
        new IntersectionObserver((entries) => {
          marqueeVisible = entries[0].isIntersecting;
          if (marqueeVisible) marqueeAnimation.play();
          else marqueeAnimation.pause();
        }).observe(marqueeTrack);
      }

      marqueeTrack.addEventListener('pointerenter', () => marqueeAnimation.updatePlaybackRate && marqueeAnimation.updatePlaybackRate(0.35));
      marqueeTrack.addEventListener('pointerleave', () => marqueeAnimation.updatePlaybackRate && marqueeAnimation.updatePlaybackRate(direction));
    }
  }

  // ---------------------------------------------
  // Lead story ticker: rotates through the five situations
  // ---------------------------------------------
  const ticker = document.querySelector('[data-ticker]');
  if (ticker && !reduceMotion) {
    const items = Array.from(ticker.querySelectorAll('.ticker__item'));
    let index = 0;
    let timer = 0;
    let paused = false;

    function advance() {
      if (paused || document.hidden) return;
      const current = items[index];
      index = (index + 1) % items.length;
      const next = items[index];
      current.classList.remove('is-active');
      current.classList.add('is-leaving');
      next.classList.remove('is-leaving');
      next.classList.add('is-active');
      window.setTimeout(() => current.classList.remove('is-leaving'), 600);
    }

    const link = ticker.closest('a');
    if (link) {
      link.addEventListener('pointerenter', () => { paused = true; });
      link.addEventListener('pointerleave', () => { paused = false; });
      link.addEventListener('focusin', () => { paused = true; });
      link.addEventListener('focusout', () => { paused = false; });
    }

    if (hasIO) {
      new IntersectionObserver((entries) => {
        window.clearInterval(timer);
        if (entries[0].isIntersecting) timer = window.setInterval(advance, 2000);
      }).observe(ticker);
    }
  }

  // ---------------------------------------------
  // "Kodėl tai svarbu?" — sticky scrollytelling
  // ---------------------------------------------
  const why = document.querySelector('.why');
  if (why) {
    const steps = Array.from(why.querySelectorAll('.why-step'));
    const scenes = Array.from(why.querySelectorAll('.why-scene'));
    const counter = why.querySelector('.why__counter-now');
    const stepList = why.querySelector('.why__steps');
    let activeScene = 0;
    let listTop = 0;
    let listHeight = 1;

    function setScene(index) {
      if (index === activeScene) return;
      activeScene = index;
      steps.forEach((step, i) => step.classList.toggle('is-active', i === index));
      scenes.forEach((scene, i) => scene.classList.toggle('is-active', i === index));
      if (counter) counter.textContent = String(index + 1).padStart(2, '0');
    }

    if (hasIO) {
      const stepObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) setScene(steps.indexOf(entry.target));
          });
        },
        { rootMargin: '-44% 0px -44% 0px' }
      );
      steps.forEach((step) => stepObserver.observe(step));
    } else {
      steps.forEach((step) => step.classList.add('is-active'));
    }

    measureHandlers.push(() => {
      listTop = pageTop(stepList);
      listHeight = Math.max(1, stepList.offsetHeight);
    });

    scrollHandlers.push((y, vh) => {
      if (y + vh < listTop - vh || y > listTop + listHeight + vh) return;
      const p = clamp((y + vh * 0.5 - listTop) / listHeight, 0, 1);
      stepList.style.setProperty('--why-p', p.toFixed(4));
    });
  }

  // ---------------------------------------------
  // Animated counters
  // ---------------------------------------------
  const counters = Array.from(document.querySelectorAll('[data-count]'));
  if (counters.length && hasIO && !reduceMotion) {
    const counterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          counterObserver.unobserve(el);
          const to = parseFloat(el.dataset.count);
          const from = parseFloat(el.dataset.countFrom || '0');
          const duration = to - from > 2 ? 1500 : 900;
          const start = performance.now();
          function tick(now) {
            const t = clamp((now - start) / duration, 0, 1);
            el.textContent = String(Math.round(lerp(from, to, easeOutCubic(t))));
            if (t < 1) window.requestAnimationFrame(tick);
          }
          window.requestAnimationFrame(tick);
        });
      },
      { threshold: 0.6 }
    );
    counters.forEach((el) => {
      el.textContent = el.dataset.countFrom || '0';
      counterObserver.observe(el);
    });
  }

  // ---------------------------------------------
  // "Diena" — pinned horizontal journey through the day
  // ---------------------------------------------
  const day = document.querySelector('.day');
  if (day) {
    const viewport = day.querySelector('.day__viewport');
    const track = day.querySelector('.day__track');
    const panels = Array.from(track.children);
    const timeEl = day.querySelector('.day__time');
    const whenEl = day.querySelector('.day__when');
    const hand = day.querySelector('.day__clock-face i');
    const dots = Array.from(day.querySelectorAll('.day__dots i'));
    const prevBtn = day.querySelector('[data-day-prev]');
    const nextBtn = day.querySelector('[data-day-next]');
    const rail = document.querySelector('[data-rail]');

    const SKY = [
      ['#FCE1D2', '#FFF4EA'],
      ['#FFE6CC', '#FFF7EC'],
      ['#D6E8FB', '#F3F8FE'],
      ['#DDF0E3', '#FFF5DC'],
      ['#F6D5C8', '#ECE2FA'],
      ['#2A3A6C', '#4C5C93'],
      ['#1A2650', '#2C3A6E'],
    ];
    const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const SKY_RGB = SKY.map(([top, bottom]) => [hexToRgb(top), hexToRgb(bottom)]);
    const mixRgb = (a, b, t) => `rgb(${a.map((v, i) => Math.round(lerp(v, b[i], t))).join(',')})`;

    const toMinutes = (value) => {
      const [h, m] = value.split(':').map(Number);
      return h * 60 + m;
    };
    const times = panels.map((panel) => toMinutes(panel.dataset.time || '07:00'));

    let pinned = false;
    let dayTop = 0;
    let journey = 1;
    let maxShift = 0;
    let anchors = [];
    let lastPos = -1;
    let lastNearest = -1;

    // Track shift → fractional panel index. Each panel's anchor is the shift that centres it,
    // clamped to the journey, so the first panel is "current" at the start and the last at the end.
    function positionFromShift(shift) {
      if (shift <= anchors[0]) return 0;
      for (let i = 0; i < anchors.length - 1; i++) {
        if (shift <= anchors[i + 1]) {
          const span = anchors[i + 1] - anchors[i];
          return span > 0 ? i + (shift - anchors[i]) / span : i + 1;
        }
      }
      return anchors.length - 1;
    }

    function applyDay(pos) {
      if (Math.abs(pos - lastPos) < 0.0005) return;
      lastPos = pos;

      const i = Math.min(Math.floor(pos), SKY_RGB.length - 2);
      const t = pos - i;
      day.style.setProperty('--sky-top', mixRgb(SKY_RGB[i][0], SKY_RGB[i + 1][0], t));
      day.style.setProperty('--sky-bottom', mixRgb(SKY_RGB[i][1], SKY_RGB[i + 1][1], t));

      // Sun arcs across the sky from dawn to dusk, then the night takes over
      const vw = viewportW;
      const vh = viewportH;
      const sunT = clamp((pos - 0.45) / 4.15, 0, 1);
      const sunX = lerp(vw * 0.05, vw * 0.88, sunT) - 48;
      const sunY = vh * 0.92 - Math.sin(Math.PI * sunT) * vh * 0.8 - 48;
      const night = smoothstep(4.35, 5.05, pos);
      day.style.setProperty('--sun-x', `${sunX.toFixed(1)}px`);
      day.style.setProperty('--sun-y', `${sunY.toFixed(1)}px`);
      day.style.setProperty('--sun-o', (1 - smoothstep(4.1, 4.8, pos)).toFixed(3));
      day.style.setProperty('--moon-x', `${(vw * 0.8 - night * vw * 0.04).toFixed(1)}px`);
      day.style.setProperty('--moon-y', `${(vh * 0.2 - night * vh * 0.05).toFixed(1)}px`);
      day.style.setProperty('--night', night.toFixed(3));
      day.dataset.night = night > 0.5 ? '1' : '0';

      // Clock
      const minutes = lerp(times[i], times[i + 1], t);
      const rounded = Math.round(minutes / 5) * 5;
      const hh = String(Math.floor(rounded / 60) % 24).padStart(2, '0');
      const mm = String(rounded % 60).padStart(2, '0');
      if (timeEl) timeEl.textContent = `${hh}:${mm}`;
      if (hand) hand.style.setProperty('--hand', `${((minutes % 720) / 720) * 360}deg`);

      const nearest = Math.round(pos);
      if (nearest !== lastNearest) {
        lastNearest = nearest;
        if (whenEl) whenEl.textContent = panels[nearest].dataset.when || '';
        panels.forEach((panel, index) => panel.classList.toggle('is-current', index === nearest));
        dots.forEach((dot, index) => dot.classList.toggle('is-active', index === nearest - 1));
        if (prevBtn) prevBtn.disabled = nearest <= 0;
        if (nextBtn) nextBtn.disabled = nearest >= panels.length - 1;
      }
    }

    // The panels run edge to edge (pinned or swiped) — tuck the chapter rail away meanwhile
    if (hasIO && rail) {
      new IntersectionObserver(
        (entries) => rail.classList.toggle('is-away', entries[0].isIntersecting),
        { rootMargin: '-15% 0px -15% 0px' }
      ).observe(day);
    }

    function measureDay() {
      pinned = pinQuery.matches && !reduceMotion;
      day.classList.toggle('is-pinned', pinned);
      track.style.transform = '';

      // Measure the panels, not the track: a max-content flex row can report a much wider box
      // (Firefox sizes it from the panels' unwrapped text), which left an empty sky at the end.
      const trackLeft = track.getBoundingClientRect().left;
      const edges = panels.map((panel) => {
        const rect = panel.getBoundingClientRect();
        return [rect.left - trackLeft, rect.right - trackLeft];
      });
      const frame = viewport.clientWidth || viewportW;
      const trackEnd = edges[edges.length - 1][1] + (parseFloat(getComputedStyle(track).paddingRight) || 0);
      maxShift = Math.max(0, trackEnd - frame);
      anchors = edges.map(([left, right]) => clamp((left + right) / 2 - frame / 2, 0, maxShift));

      if (pinned) {
        journey = Math.max(1, maxShift * 0.92);
        day.style.setProperty('--day-h', `${Math.round(journey + viewportH)}px`);
      } else {
        day.style.removeProperty('--day-h');
      }
      dayTop = pageTop(day);
      lastPos = -1;
      lastNearest = -1;
      if (!pinned) applyDay(positionFromShift(viewport.scrollLeft));
    }

    // measure the journey first: its height moves everything below it
    measureHandlers.unshift(measureDay);

    scrollHandlers.push((y, vh) => {
      if (!pinned) return;
      if (y < dayTop - vh || y > dayTop + journey + vh) return;
      const local = clamp(y - dayTop, 0, journey);
      const shift = (local / journey) * maxShift;
      track.style.transform = `translate3d(${(-shift).toFixed(1)}px, 0, 0)`;
      applyDay(positionFromShift(shift));
    });

    // Swipe mode (touch, narrow screens, reduced motion)
    let swipeQueued = false;
    viewport.addEventListener(
      'scroll',
      () => {
        if (pinned || swipeQueued) return;
        swipeQueued = true;
        window.requestAnimationFrame(() => {
          swipeQueued = false;
          applyDay(positionFromShift(viewport.scrollLeft));
        });
      },
      { passive: true }
    );

    function goToPanel(index) {
      viewport.scrollTo({
        left: anchors[clamp(index, 0, panels.length - 1)],
        behavior: reduceMotion ? 'auto' : 'smooth',
      });
    }

    if (prevBtn) prevBtn.addEventListener('click', () => goToPanel(Math.round(lastPos) - 1));
    if (nextBtn) nextBtn.addEventListener('click', () => goToPanel(Math.round(lastPos) + 1));

    // Keyboard focus inside the pinned track: scroll the page to that panel
    track.addEventListener('focusin', (event) => {
      if (!pinned) return;
      const panel = event.target.closest('.day-panel');
      const index = panels.indexOf(panel);
      if (index < 0 || !maxShift) return;
      window.scrollTo({ top: dayTop + (anchors[index] / maxShift) * journey, behavior: reduceMotion ? 'auto' : 'smooth' });
    });
  }

  // ---------------------------------------------
  // Soundboard — "Garsažodžių galia"
  // ---------------------------------------------
  const tiles = Array.from(document.querySelectorAll('.sound-tile'));
  if (tiles.length) {
    const result = document.querySelector('.sounds__result');
    const soundOut = document.querySelector('[data-sound-out]');
    const wordOut = document.querySelector('[data-word-out]');
    const countOut = document.querySelector('[data-sound-count]');
    const progressDots = Array.from(document.querySelectorAll('.sounds__dots i'));
    const tried = new Set();

    tiles.forEach((tile, index) => {
      tile.addEventListener('click', () => {
        tile.classList.remove('is-playing');
        void tile.offsetWidth;
        tile.classList.add('is-playing');
        window.clearTimeout(tile.playTimer);
        tile.playTimer = window.setTimeout(() => tile.classList.remove('is-playing'), 1700);

        soundOut.textContent = tile.dataset.sound;
        wordOut.textContent = tile.dataset.word;
        result.classList.remove('is-fresh');
        void result.offsetWidth;
        result.classList.add('is-fresh');

        tried.add(index);
        tile.classList.add('is-done');
        progressDots.forEach((dot, i) => dot.classList.toggle('is-on', i < tried.size));
        countOut.textContent = tried.size === tiles.length
          ? `Puiku! Išbandyti visi ${tiles.length} ${ltForm(tiles.length, ['garsas', 'garsai', 'garsų'])}.`
          : `Išbandyta ${tried.size} iš ${tiles.length}`;
      });

      tile.addEventListener('pointermove', (event) => {
        if (reduceMotion || !finePointerQuery.matches) return;
        const rect = tile.getBoundingClientRect();
        const dx = (event.clientX - rect.left) / rect.width - 0.5;
        const dy = (event.clientY - rect.top) / rect.height - 0.5;
        tile.style.setProperty('--tilt-x', `${(-dy * 10).toFixed(2)}deg`);
        tile.style.setProperty('--tilt-y', `${(dx * 12).toFixed(2)}deg`);
      });
      tile.addEventListener('pointerleave', () => {
        tile.style.removeProperty('--tilt-x');
        tile.style.removeProperty('--tilt-y');
      });
    });
  }

  // ---------------------------------------------
  // Library — topic filters with FLIP layout animation
  // ---------------------------------------------
  const grid = document.querySelector('[data-grid]');
  const filterButtons = Array.from(document.querySelectorAll('.filter'));
  const filterStatus = document.querySelector('[data-filter-status]');
  const posts = grid ? Array.from(grid.querySelectorAll('.post')) : [];
  const FILTER_NAMES = {
    all: '',
    kalba: 'Kalba',
    kasdienybe: 'Kasdienybė',
    zaidimai: 'Žaidimai',
    knygos: 'Knygos',
    tevams: 'Tėvams',
  };
  let activeFilter = 'all';
  let filterRun = 0;

  function ltForm(n, forms) {
    const n10 = n % 10;
    const n100 = n % 100;
    if (n10 === 1 && n100 !== 11) return forms[0];
    if (n10 >= 2 && n10 <= 9 && (n100 < 11 || n100 > 19)) return forms[1];
    return forms[2];
  }

  function updateStatus(count, filter) {
    if (!filterStatus) return;
    const verb = ltForm(count, ['Rodomas', 'Rodomi', 'Rodoma']);
    const noun = ltForm(count, ['straipsnis', 'straipsniai', 'straipsnių']);
    const topic = FILTER_NAMES[filter] ? ` · ${FILTER_NAMES[filter]}` : '';
    filterStatus.textContent = `${verb} ${count} ${noun}${topic}`;
  }

  function applyFilter(filter, animate) {
    if (!grid || !(filter in FILTER_NAMES)) return;
    activeFilter = filter;
    const run = ++filterRun;
    const shouldShow = (post) => filter === 'all' || post.dataset.cat === filter;

    filterButtons.forEach((button) => {
      const on = button.dataset.filter === filter;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });

    const visibleCount = posts.filter(shouldShow).length;
    updateStatus(visibleCount, filter);

    const canAnimate = animate && !reduceMotion && typeof grid.animate === 'function';
    const leaving = posts.filter((post) => !post.hidden && !shouldShow(post));

    function relayout() {
      if (run !== filterRun) return;
      const first = new Map();
      posts.forEach((post) => {
        if (!post.hidden) first.set(post, post.getBoundingClientRect());
      });

      posts.forEach((post) => {
        const show = shouldShow(post);
        post.hidden = !show;
        if (show) {
          revealNow(post);
          if (revealObserver) revealObserver.unobserve(post);
        }
      });

      if (!canAnimate) return;
      posts.forEach((post) => {
        if (post.hidden) return;
        const last = post.getBoundingClientRect();
        const before = first.get(post);
        if (!before || leaving.includes(post)) {
          post.animate(
            [
              { opacity: 0, transform: 'translateY(18px) scale(0.97)' },
              { opacity: 1, transform: 'none' },
            ],
            { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', delay: 60 }
          );
          return;
        }
        const dx = before.left - last.left;
        const dy = before.top - last.top;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
          post.animate(
            [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
            { duration: 600, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
          );
        }
      });
    }

    if (canAnimate && leaving.length) {
      const fades = leaving.map((post) =>
        post.animate(
          [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(0.96)' }],
          { duration: 180, easing: 'ease-in', fill: 'forwards' }
        )
      );
      Promise.all(fades.map((animation) => animation.finished.catch(() => {}))).then(() => {
        fades.forEach((animation) => animation.cancel());
        relayout();
      });
    } else {
      relayout();
    }

    try {
      const url = new URL(window.location.href);
      if (filter === 'all') url.searchParams.delete('tema');
      else url.searchParams.set('tema', filter);
      window.history.replaceState(null, '', url);
    } catch (error) {
      // URL API unavailable — filtering still works
    }
  }

  filterButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.filter !== activeFilter) applyFilter(button.dataset.filter, true);
    });
  });

  document.querySelectorAll('[data-filter-link]').forEach((link) => {
    link.addEventListener('click', () => {
      applyFilter(link.dataset.filterLink, false);
    });
  });

  // ---------------------------------------------
  // Quick-read sheet (native <dialog>)
  // ---------------------------------------------
  const peek = document.getElementById('peek');
  let closeQuickRead = null;
  if (peek && typeof peek.showModal === 'function') {
    const sheet = peek.querySelector('[data-peek-sheet]');
    const artSlot = peek.querySelector('[data-peek-art]');
    const metaSlot = peek.querySelector('[data-peek-meta]');
    const titleSlot = peek.querySelector('[data-peek-title]');
    const pointsSlot = peek.querySelector('[data-peek-points]');
    const linkSlot = peek.querySelector('[data-peek-link]');
    let trigger = null;
    let closing = false;

    function sourceCardFor(id) {
      const link = document.querySelector(`.library a[data-peek="${id}"]`) || document.querySelector(`a[data-peek="${id}"]`);
      return link ? link.closest('.post, .story') : null;
    }

    function openPeek(link) {
      const id = link.dataset.peek;
      const template = document.querySelector(`template[data-peek-id="${id}"]`);
      if (!template) return false;
      const card = link.closest('.post, .story') || sourceCardFor(id);

      artSlot.textContent = '';
      const art = card && card.querySelector('.art');
      if (art) {
        const artClone = art.cloneNode(true);
        artClone.removeAttribute('data-reveal');
        artSlot.appendChild(artClone);
        artSlot.hidden = false;
      } else {
        artSlot.hidden = true;
      }

      const meta = card && card.querySelector('.meta');
      metaSlot.innerHTML = meta ? meta.innerHTML : '';
      const title = card && card.querySelector('.post__title, .story__title');
      const listTitle = link.querySelector('.start__title');
      titleSlot.textContent = (title || listTitle || link).textContent.trim();

      pointsSlot.textContent = '';
      pointsSlot.appendChild(template.content.cloneNode(true));
      linkSlot.href = link.getAttribute('href');

      trigger = link;
      closing = false;
      peek.classList.remove('is-closing');
      sheet.style.transform = '';
      peek.showModal();
      doc.style.overflow = 'hidden';
      return true;
    }

    function finishClose() {
      peek.classList.remove('is-closing');
      if (peek.open) peek.close();
      doc.style.overflow = '';
      sheet.style.transform = '';
      closing = false;
      if (trigger) trigger.focus({ preventScroll: true });
    }

    function closePeek() {
      if (!peek.open || closing) return;
      closing = true;
      if (reduceMotion) {
        finishClose();
        return;
      }
      peek.classList.add('is-closing');
      window.setTimeout(finishClose, 280);
    }

    // Instant close, used when a link inside the sheet points elsewhere on the page
    closeQuickRead = () => {
      if (peek.open) finishClose();
    };

    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[data-peek]');
      if (!link || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (openPeek(link)) event.preventDefault();
    });

    peek.querySelectorAll('[data-peek-close]').forEach((button) => button.addEventListener('click', closePeek));
    peek.addEventListener('cancel', (event) => {
      event.preventDefault();
      closePeek();
    });
    peek.addEventListener('click', (event) => {
      if (event.target === peek) closePeek();
    });
    peek.addEventListener('close', () => {
      doc.style.overflow = '';
    });

    // Drag the sheet down to dismiss (touch)
    let dragStart = null;
    let dragY = 0;
    sheet.addEventListener('pointerdown', (event) => {
      if (event.pointerType !== 'touch' || sheet.scrollTop > 0) return;
      dragStart = event.clientY;
      dragY = 0;
    });
    sheet.addEventListener('pointermove', (event) => {
      if (dragStart === null) return;
      dragY = Math.max(0, event.clientY - dragStart);
      if (dragY > 4) sheet.style.transform = `translateY(${dragY}px)`;
    });
    const endDrag = () => {
      if (dragStart === null) return;
      dragStart = null;
      if (dragY > 110) {
        closePeek();
      } else {
        sheet.animate
          ? sheet.animate([{ transform: sheet.style.transform || 'none' }, { transform: 'none' }], { duration: 250, easing: 'ease-out' })
          : null;
        sheet.style.transform = '';
      }
    };
    sheet.addEventListener('pointerup', endDrag);
    sheet.addEventListener('pointercancel', endDrag);
  }

  // ---------------------------------------------
  // "+1" word builder
  // ---------------------------------------------
  const plusStage = document.querySelector('.plus__stage');
  if (plusStage) {
    const PLUS_SETS = {
      lauke: {
        child: 'Šuo!',
        sticker: ['/blog/assets/stickers/dog.webp', 409, 480],
        steps: [
          [['taip', 'Taip,'], ['suo', 'šuo.']],
          [['taip', 'Taip,'], ['didelis', 'didelis'], ['suo', 'šuo.']],
          [['taip', 'Taip,'], ['didelis', 'didelis'], ['suo', 'šuo'], ['bega', 'bėga.']],
        ],
      },
      virtuve: {
        child: 'Obuolį.',
        sticker: ['/blog/assets/stickers/apple.webp', 366, 451],
        steps: [
          [['taip', 'Taip,'], ['obuoli', 'obuolį.']],
          [['taip', 'Taip,'], ['obuoli', 'obuolį'], ['dedi', 'dedi.']],
          [['taip', 'Taip,'], ['obuoli', 'obuolį'], ['dedi', 'dedi'], ['dubeni', 'į dubenį.']],
        ],
      },
      knyga: {
        child: 'Meškiukas!',
        sticker: ['/blog/assets/stickers/teddy.webp', 352, 443],
        steps: [
          [['taip', 'Taip,'], ['meskiukas', 'meškiukas.']],
          [['taip', 'Taip,'], ['meskiukas', 'meškiukas'], ['iesko', 'ieško.']],
          [['taip', 'Taip,'], ['meskiukas', 'meškiukas'], ['iesko', 'ieško'], ['draugo', 'draugo.']],
        ],
      },
    };
    const BLOCK_TONES = ['sky', 'butter', 'sage', 'peach'];

    const sentence = plusStage.querySelector('[data-plus-sentence]');
    const childText = plusStage.querySelector('[data-plus-child]');
    const sticker = plusStage.querySelector('[data-plus-stk]');
    const nextButton = plusStage.querySelector('[data-plus-next]');
    const resetButton = plusStage.querySelector('[data-plus-reset]');
    const stepBars = Array.from(plusStage.querySelectorAll('.plus__steps i'));
    const setButtons = Array.from(document.querySelectorAll('[data-plus-set]'));

    let setKey = 'lauke';
    let step = -1;
    let autoplayTimers = [];
    const blocks = new Map();

    function clearAutoplay() {
      autoplayTimers.forEach((timer) => window.clearTimeout(timer));
      autoplayTimers = [];
    }

    function render(nextStep) {
      const words = PLUS_SETS[setKey].steps[nextStep] || [];
      const first = new Map();
      blocks.forEach((el, key) => first.set(key, el.getBoundingClientRect()));

      const keep = new Set(words.map(([key]) => key));
      blocks.forEach((el, key) => {
        if (!keep.has(key)) {
          el.remove();
          blocks.delete(key);
        }
      });

      words.forEach(([key, text], index) => {
        let el = blocks.get(key);
        const isNew = !el;
        if (isNew) {
          el = document.createElement('span');
          el.className = 'word-block';
          el.dataset.tone = BLOCK_TONES[blocks.size % BLOCK_TONES.length];
          blocks.set(key, el);
        }
        el.textContent = text;
        if (isNew && nextStep > 0) {
          const badge = document.createElement('span');
          badge.className = 'word-block__plus';
          badge.setAttribute('aria-hidden', 'true');
          badge.textContent = '+1';
          el.appendChild(badge);
        }
        el.classList.toggle('is-new', isNew && !reduceMotion);
        sentence.insertBefore(el, sentence.children[index] || null);
      });

      if (!reduceMotion) {
        blocks.forEach((el, key) => {
          const before = first.get(key);
          if (!before || typeof el.animate !== 'function') return;
          const after = el.getBoundingClientRect();
          const dx = before.left - after.left;
          const dy = before.top - after.top;
          if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
            el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
              duration: 520,
              easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
            });
          }
        });
      }

      step = nextStep;
      stepBars.forEach((bar, index) => bar.classList.toggle('is-on', index <= step));
      const atEnd = step >= PLUS_SETS[setKey].steps.length - 1;
      nextButton.disabled = atEnd;
      nextButton.querySelector('span').textContent = atEnd ? 'Sakinys užaugo!' : '+1 žodis';
    }

    function resetSentence() {
      blocks.forEach((el) => el.remove());
      blocks.clear();
      step = -1;
      render(0);
    }

    function autoplay(delay) {
      clearAutoplay();
      resetSentence();
      if (reduceMotion) return;
      autoplayTimers.push(window.setTimeout(() => render(1), delay));
      autoplayTimers.push(window.setTimeout(() => render(2), delay + 1300));
    }

    function switchSet(key) {
      if (!PLUS_SETS[key]) return;
      setKey = key;
      setButtons.forEach((button) => {
        const on = button.dataset.plusSet === key;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
      });
      const [src, width, height] = PLUS_SETS[key].sticker;
      sticker.classList.add('is-swapping');
      window.setTimeout(() => {
        sticker.src = src;
        sticker.width = width;
        sticker.height = height;
        childText.textContent = PLUS_SETS[key].child;
        sticker.classList.remove('is-swapping');
      }, reduceMotion ? 0 : 220);
      autoplay(900);
    }

    nextButton.addEventListener('click', () => {
      clearAutoplay();
      if (step < PLUS_SETS[setKey].steps.length - 1) render(step + 1);
    });
    resetButton.addEventListener('click', () => {
      clearAutoplay();
      resetSentence();
    });
    setButtons.forEach((button) => button.addEventListener('click', () => switchSet(button.dataset.plusSet)));

    resetSentence();

    if (hasIO && !reduceMotion) {
      const plusObserver = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            plusObserver.disconnect();
            autoplay(1100);
          }
        },
        { threshold: 0.55 }
      );
      plusObserver.observe(plusStage);
    }
  }

  // ---------------------------------------------
  // Two conversations — before / after
  // ---------------------------------------------
  const talkPhone = document.querySelector('.talks__phone');
  if (talkPhone) {
    const talkButtons = Array.from(document.querySelectorAll('[data-talk]'));
    let userChose = false;

    function setTalk(state) {
      talkPhone.dataset.talkState = state;
      talkButtons.forEach((button) => {
        const on = button.dataset.talk === state;
        button.classList.toggle('is-active', on);
        button.setAttribute('aria-pressed', String(on));
      });
      const variant = talkPhone.querySelector(`[data-variant="${state}"]`);
      if (variant) variant.replaceWith(variant.cloneNode(true));
    }

    talkButtons.forEach((button) => {
      button.addEventListener('click', () => {
        userChose = true;
        setTalk(button.dataset.talk);
      });
    });

    if (hasIO && !reduceMotion) {
      const talkObserver = new IntersectionObserver(
        (entries) => {
          if (!entries[0].isIntersecting) return;
          talkObserver.disconnect();
          if (userChose) return;
          setTalk('before');
          window.setTimeout(() => {
            if (!userChose) setTalk('after');
          }, 4600);
        },
        { threshold: 0.5 }
      );
      talkObserver.observe(talkPhone);
    }
  }

  // ---------------------------------------------
  // Quote — words ink in as you scroll
  // ---------------------------------------------
  const quote = document.querySelector('[data-ink]');
  if (quote) {
    const accentWords = ['ramiai', 'pavyzdys'];
    const words = quote.textContent.trim().split(/\s+/);
    quote.textContent = '';
    const spans = words.map((word, index) => {
      const span = document.createElement('span');
      span.className = 'w';
      if (accentWords.some((accent) => word.toLowerCase().startsWith(accent))) span.classList.add('is-accent');
      span.textContent = word;
      quote.appendChild(span);
      if (index < words.length - 1) quote.appendChild(document.createTextNode(' '));
      return span;
    });

    let quoteTop = 0;
    let quoteHeight = 1;
    let inked = -1;

    function ink(count) {
      if (count === inked) return;
      inked = count;
      spans.forEach((span, index) => span.classList.toggle('is-inked', index < count));
    }

    if (reduceMotion) {
      ink(spans.length);
    } else {
      measureHandlers.push(() => {
        quoteTop = pageTop(quote);
        quoteHeight = Math.max(1, quote.offsetHeight);
      });
      scrollHandlers.push((y, vh) => {
        if (y + vh < quoteTop - vh || y > quoteTop + quoteHeight + vh) return;
        const start = quoteTop - vh * 0.85;
        const end = quoteTop + quoteHeight - vh * 0.45;
        const p = clamp((y - start) / Math.max(1, end - start), 0, 1);
        ink(Math.round(p * spans.length));
      });
    }
  }

  // ---------------------------------------------
  // Chapter rail (desktop)
  // ---------------------------------------------
  const rail = document.querySelector('[data-rail]');
  const chapters = Array.from(document.querySelectorAll('[data-chapter][id]'));
  if (rail && chapters.length && hasIO) {
    const links = chapters.map((chapter) => {
      const link = document.createElement('a');
      link.className = 'rail__link';
      link.href = `#${chapter.id}`;
      link.innerHTML = '<span class="rail__label"></span><span class="rail__dot" aria-hidden="true"></span>';
      link.querySelector('.rail__label').textContent = chapter.dataset.chapter;
      link.addEventListener('click', (event) => {
        event.preventDefault();
        chapter.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      });
      rail.appendChild(link);
      return link;
    });
    rail.hidden = false;

    const chapterObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const index = chapters.indexOf(entry.target);
          links.forEach((link, i) => {
            const on = i === index;
            link.classList.toggle('is-active', on);
            if (on) link.setAttribute('aria-current', 'true');
            else link.removeAttribute('aria-current');
          });
        });
      },
      { rootMargin: '-50% 0px -50% 0px' }
    );
    chapters.forEach((chapter) => chapterObserver.observe(chapter));
  }

  // ---------------------------------------------
  // Article — table of contents follows the reader
  // ---------------------------------------------
  const tocList = document.querySelector('[data-toc]');
  if (tocList) {
    const tocLinks = Array.from(tocList.querySelectorAll('a[href^="#"]'));
    const tocTargets = tocLinks.map((link) => document.getElementById(link.getAttribute('href').slice(1)));
    const tocCurrent = document.querySelector('[data-toc-current]');
    const tocDetails = document.querySelector('[data-toc-details]');
    const tocSummary = tocDetails && tocDetails.querySelector('summary');
    const prose = document.querySelector('.prose');
    const compactQuery = window.matchMedia('(max-width: 1024px)');
    let tocTops = [];
    let proseTop = 0;
    let proseHeight = 1;
    let tocActive = -2;

    function setTocActive(index) {
      if (index === tocActive) return;
      tocActive = index;
      tocLinks.forEach((link, i) => {
        const on = i === index;
        link.classList.toggle('is-active', on);
        link.classList.toggle('is-past', i < index);
        if (on) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
      if (tocCurrent) tocCurrent.textContent = index >= 0 ? tocLinks[index].textContent : '';
    }

    measureHandlers.push(() => {
      tocTops = tocTargets.map((target) => (target ? pageTop(target) : Infinity));
      if (prose) {
        proseTop = pageTop(prose);
        proseHeight = Math.max(1, prose.offsetHeight);
      }
    });

    scrollHandlers.push((y, vh) => {
      const line = y + vh * 0.3;
      let index = -1;
      for (let i = 0; i < tocTops.length; i++) {
        if (tocTops[i] <= line) index = i;
      }
      setTocActive(index);
      tocList.style.setProperty('--toc-p', clamp((line - proseTop) / proseHeight, 0, 1).toFixed(4));
    });

    // Phones & tablets: the contents fold into a sticky bar that opens on demand
    function syncTocMode() {
      if (!tocDetails) return;
      tocDetails.open = !compactQuery.matches;
      if (tocSummary) tocSummary.tabIndex = compactQuery.matches ? 0 : -1;
    }

    if (tocDetails) {
      syncTocMode();
      if (compactQuery.addEventListener) compactQuery.addEventListener('change', syncTocMode);

      tocSummary.addEventListener('click', (event) => {
        if (!compactQuery.matches) event.preventDefault();
      });
      tocLinks.forEach((link) => link.addEventListener('click', () => {
        if (compactQuery.matches) tocDetails.open = false;
      }));
      document.addEventListener('click', (event) => {
        if (compactQuery.matches && tocDetails.open && !tocDetails.contains(event.target)) tocDetails.open = false;
      });
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !compactQuery.matches || !tocDetails.open) return;
        tocDetails.open = false;
        tocSummary.focus();
      });

      // Folds away again once the reader carries on scrolling the article
      let openedAt = 0;
      tocDetails.addEventListener('toggle', () => {
        if (tocDetails.open) openedAt = window.scrollY;
      });
      scrollHandlers.push((y) => {
        if (compactQuery.matches && tocDetails.open && Math.abs(y - openedAt) > 120) tocDetails.open = false;
      });
    }
  }

  // ---------------------------------------------
  // Article — share (copy link / native share sheet)
  // ---------------------------------------------
  const canonical = document.querySelector('link[rel="canonical"]');
  const shareUrl = canonical ? canonical.href : window.location.href;

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch (error) {
      copied = false;
    }
    field.remove();
    return copied ? Promise.resolve() : Promise.reject(new Error('copy failed'));
  }

  document.querySelectorAll('[data-share]').forEach((box) => {
    const copyButton = box.querySelector('[data-share-copy]');
    const copyLabel = box.querySelector('[data-share-copy-label]');
    const nativeButton = box.querySelector('[data-share-native]');
    const status = box.querySelector('[data-share-status]');
    const idleLabel = copyLabel ? copyLabel.textContent : '';
    let resetTimer = 0;

    function flash(label, message, ok) {
      if (copyLabel) copyLabel.textContent = label;
      if (status) status.textContent = message;
      copyButton.classList.toggle('is-done', ok);
      window.clearTimeout(resetTimer);
      resetTimer = window.setTimeout(() => {
        copyButton.classList.remove('is-done');
        if (copyLabel) copyLabel.textContent = idleLabel;
        if (status) status.textContent = '';
      }, 2600);
    }

    if (copyButton) {
      copyButton.addEventListener('click', () => {
        copyText(shareUrl).then(
          () => flash('Nukopijuota!', 'Nuoroda nukopijuota.', true),
          () => flash('Nepavyko nukopijuoti', 'Nepavyko nukopijuoti nuorodos.', false)
        );
      });
    }

    if (nativeButton && typeof navigator.share === 'function') {
      nativeButton.hidden = false;
      nativeButton.addEventListener('click', () => {
        const description = document.querySelector('meta[name="description"]');
        navigator
          .share({ title: document.title, text: description ? description.content : '', url: shareUrl })
          .catch(() => {});
      });
    }
  });

  // ---------------------------------------------
  // Source citations → jump to their entry in the sources list and flash it
  // ---------------------------------------------
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#saltinis-"]');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const target = document.getElementById(link.getAttribute('href').slice(1));
    if (!target) return;
    event.preventDefault();
    if (closeQuickRead) closeQuickRead();

    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'center' });
    target.classList.remove('is-flash');
    void target.offsetWidth;
    target.classList.add('is-flash');
    window.clearTimeout(target.flashTimer);
    target.flashTimer = window.setTimeout(() => target.classList.remove('is-flash'), 2400);

    const sourceLink = target.querySelector('a');
    if (sourceLink) sourceLink.focus({ preventScroll: true });
  });

  // ---------------------------------------------
  // Boot
  // ---------------------------------------------
  function restoreHashPosition() {
    const hash = window.location.hash;
    if (hash.length < 2) return;
    let target = null;
    try {
      target = document.getElementById(decodeURIComponent(hash.slice(1)));
    } catch (error) {
      target = null;
    }
    if (target) target.scrollIntoView({ block: 'start' });
  }

  const initialTopic = new URLSearchParams(window.location.search).get('tema');
  if (initialTopic && initialTopic in FILTER_NAMES) applyFilter(initialTopic, false);

  measureAll();
  restoreHashPosition();

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(measureAll);
  }
  window.addEventListener('load', () => {
    measureAll();
  });

  if ('ResizeObserver' in window) {
    let lastHeight = doc.scrollHeight;
    new ResizeObserver(() => {
      const height = doc.scrollHeight;
      if (Math.abs(height - lastHeight) > 2) {
        lastHeight = height;
        queueMeasure();
      }
    }).observe(document.body);
  }

  const onMotionChange = () => {
    reduceMotion = reduceQuery.matches;
    measureAll();
  };
  const onPinChange = () => measureAll();
  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', onMotionChange);
    pinQuery.addEventListener('change', onPinChange);
  }
})();
