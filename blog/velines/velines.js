// =============================================
// VĖLINĖS — /blog/velines/
// The small pictures to play with: cards that turn over, the pencil marks
// on the door frame, the conversation, the weather inside, the loss switch,
// the basket, the torch over the dark yard, the home rituals,
// the memory candle, the bookshelf and the folded sources. Loops rest while
// their section is off-screen. Runs after /script.js and
// /blog/blog.js (reveal, tones, share, hash position).
// Without scripts every card, answer and panel simply shows.
// =============================================

(function () {
  'use strict';

  const page = document.querySelector('.vel-page');
  if (!page) return;

  const calm = window.matchMedia('(prefers-reduced-motion: reduce)');

  function restart(el, className) {
    el.classList.remove(className);
    void el.offsetWidth;
    el.classList.add(className);
  }

  // Marks one button of a group as chosen
  function press(buttons, chosen) {
    buttons.forEach((button) => {
      const on = button === chosen;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });
  }

  // A row of buttons that shows one panel at a time
  function switcher(buttons, panels, key, onShow) {
    const show = (value, byHand) => {
      const button = buttons.find((b) => b.dataset[key] === value);
      if (!button) return null;
      press(buttons, button);
      let shown = null;
      panels.forEach((panel) => {
        const on = panel.dataset[key.replace(/Pick$/, '')] === value;
        panel.hidden = !on;
        if (on) shown = panel;
      });
      if (shown && byHand) restart(shown, 'is-new');
      if (onShow) onShow(value, byHand);
      return shown;
    };
    buttons.forEach((button) => button.addEventListener('click', () => show(button.dataset[key], true)));
    return show;
  }

  // ---------------------------------------------
  // Loops rest while their part of the page is off-screen
  // ---------------------------------------------
  if ('IntersectionObserver' in window) {
    const idleObserver = new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.target.classList.toggle('is-idle', !entry.isIntersecting)),
      { rootMargin: '15% 0px' }
    );
    page.querySelectorAll('.v-hero, .v-sec').forEach((el) => idleObserver.observe(el));
  }

  // ---------------------------------------------
  // Clear words: a card turns over to show what a child may hear
  // ---------------------------------------------
  page.querySelectorAll('[data-flip]').forEach((card) => {
    card.addEventListener('click', () => {
      const flipped = card.classList.toggle('is-flipped');
      card.setAttribute('aria-pressed', String(flipped));
    });
  });

  // ---------------------------------------------
  // What a child understands: a pencil mark picks the age, the teddy grows
  // ---------------------------------------------
  const grow = page.querySelector('[data-grow]');
  if (grow) {
    const marks = Array.from(grow.querySelectorAll('[data-grow-age]'));
    const cards = Array.from(grow.querySelectorAll('[data-grow-card]'));
    const show = (age, byHand) => {
      const mark = marks.find((m) => m.dataset.growAge === age);
      if (!mark) return;
      press(marks, mark);
      grow.dataset.age = age;
      cards.forEach((card) => {
        card.hidden = card.dataset.growCard !== age;
        if (!card.hidden && byHand) restart(card, 'is-new');
      });
    };
    marks.forEach((mark) => mark.addEventListener('click', () => show(mark.dataset.growAge, true)));
    show(marks[0]?.dataset.growAge, false);
  }

  // ---------------------------------------------
  // Questions children ask: pick a question, the adult "types" an answer
  // for the age chosen above the conversation
  // ---------------------------------------------
  const ask = page.querySelector('[data-ask]');
  if (ask) {
    const questions = Array.from(ask.querySelectorAll('[data-ask-q]'));
    const items = Array.from(ask.querySelectorAll('[data-ask-item]'));
    const ages = Array.from(ask.querySelectorAll('[data-ask-age]'));
    const row = ask.querySelector('.v-chat__qs');
    let current = null;
    let typing = 0;

    const answer = () => {
      ask.classList.remove('is-typing');
      if (current) restart(current, 'is-answered');
    };

    const showQuestion = (value, byHand) => {
      const question = questions.find((q) => q.dataset.askQ === value);
      if (!question) return;
      press(questions, question);
      items.forEach((item) => {
        item.hidden = item.dataset.askItem !== value;
        if (!item.hidden) current = item;
      });
      if (!byHand) return;

      // keep the chosen chip in view when the questions scroll sideways
      if (row && row.scrollWidth > row.clientWidth) {
        const box = row.getBoundingClientRect();
        const chip = question.getBoundingClientRect();
        if (chip.left < box.left || chip.right > box.right) {
          row.scrollBy({ left: chip.left - box.left - 24, behavior: calm.matches ? 'auto' : 'smooth' });
        }
      }

      current.classList.remove('is-answered');
      restart(current, 'is-new');
      window.clearTimeout(typing);
      if (calm.matches) {
        answer();
        return;
      }
      ask.classList.add('is-typing');
      typing = window.setTimeout(answer, 750);
    };

    const setAge = (age, byHand) => {
      const button = ages.find((b) => b.dataset.askAge === age);
      if (!button) return;
      press(ages, button);
      ask.dataset.age = age;
      if (byHand && !ask.classList.contains('is-typing')) answer();
    };

    questions.forEach((q) => q.addEventListener('click', () => {
      if (q.classList.contains('is-active') && !ask.classList.contains('is-typing')) return;
      showQuestion(q.dataset.askQ, true);
    }));
    ages.forEach((b) => b.addEventListener('click', () => setAge(b.dataset.askAge, true)));
    showQuestion(questions[0]?.dataset.askQ, false);
    setAge(ask.dataset.age || ages[0]?.dataset.askAge, false);
  }

  // ---------------------------------------------
  // The weather inside: a word for the feeling changes the sky
  // ---------------------------------------------
  const weather = page.querySelector('[data-weather]');
  if (weather) {
    const chips = Array.from(weather.querySelectorAll('[data-weather-pick]'));
    const say = weather.querySelector('[data-weather-say]');
    const question = weather.querySelector('[data-weather-q]');
    chips.forEach((chip) => chip.addEventListener('click', () => {
      press(chips, chip);
      weather.dataset.w = chip.dataset.weatherPick;
      say.textContent = `„Man dabar ${chip.textContent.trim()}.“`;
      restart(say, 'is-new');
      if (question && chip.dataset.q) question.textContent = `„${chip.dataset.q}“`;
    }));
  }

  // ---------------------------------------------
  // A loss this year: who died picks what to say
  // ---------------------------------------------
  const lossButtons = Array.from(page.querySelectorAll('[data-loss-pick]'));
  if (lossButtons.length) {
    const showLoss = switcher(lossButtons, Array.from(page.querySelectorAll('[data-loss]')), 'lossPick');
    showLoss(lossButtons[0].dataset.lossPick, false);
  }

  // ---------------------------------------------
  // The basket: tapping a thing packs it, tapping again takes it out
  // ---------------------------------------------
  const pack = page.querySelector('[data-pack]');
  if (pack) {
    const things = Array.from(pack.querySelectorAll('[data-pack-thing]'));
    const inside = pack.querySelector('[data-pack-in]');
    const basket = pack.querySelector('.v-pack__basket');
    const count = pack.querySelector('[data-pack-count]');
    const template = count.textContent.trim().replace(/\d+/, '{n}');
    const packed = new Map();
    const tilt = [-14, 9, -4, 12, -9, 5];

    const update = () => {
      const done = packed.size === things.length;
      count.textContent = done ? count.dataset.done : template.replace('{n}', String(packed.size));
      count.classList.toggle('is-done', done);
    };

    things.forEach((thing, i) => thing.addEventListener('click', () => {
      const on = thing.getAttribute('aria-pressed') !== 'true';
      thing.setAttribute('aria-pressed', String(on));
      if (on) {
        const copy = thing.querySelector('img').cloneNode();
        copy.removeAttribute('loading');
        copy.style.setProperty('--r', `${tilt[i % tilt.length]}deg`);
        inside.append(copy);
        packed.set(thing, copy);
        restart(basket, 'is-bump');
      } else {
        packed.get(thing)?.remove();
        packed.delete(thing);
      }
      update();
    }));
    update();
  }

  // ---------------------------------------------
  // Where are the reflectors? A finger, the mouse or the arrow keys move a
  // torch over a dark yard; a reflector flashes when the light finds it.
  // Until someone plays, the light just drifts a little in an empty spot.
  // ---------------------------------------------
  const torch = page.querySelector('[data-torch]');
  if (torch) {
    const stage = torch.querySelector('[data-torch-stage]');
    const refls = Array.from(torch.querySelectorAll('[data-torch-refl]'));
    const glints = Array.from(torch.querySelectorAll('[data-torch-glint]'));
    const count = torch.querySelector('[data-torch-count]');
    const all = torch.querySelector('[data-torch-all]');
    const template = count.textContent.trim();
    const found = new Set();
    let spots = [];
    let reach = 90;
    let x = 0;
    let y = 0;
    let home = { x: 0, y: 0 };
    let played = false;
    let visible = false;
    let drifting = 0;

    const tell = () => {
      const done = found.size === refls.length;
      count.textContent = done ? count.dataset.done : template.replace(/\d+/, String(found.size));
      count.classList.toggle('is-done', done);
    };

    const light = (byHand) => {
      stage.style.setProperty('--tx', `${x}px`);
      stage.style.setProperty('--ty', `${y}px`);
      spots.forEach((s, i) => {
        // the beam's bright middle has to land on it, its rim is not enough
        const hit = Math.hypot(s.x - x, s.y - y) < reach * 0.45;
        refls[i].classList.toggle('is-hit', hit);
        if (hit && byHand && !found.has(i)) {
          found.add(i);
          glints[i].classList.add('is-found');
          tell();
        }
      });
    };

    const measure = () => {
      const box = stage.getBoundingClientRect();
      reach = Math.max(40, Math.min(76, box.width * 0.075));
      stage.style.setProperty('--tr', `${reach}px`);
      spots = refls.map((el, i) => {
        const r = el.getBoundingClientRect();
        const spot = { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height * 0.6 };
        glints[i].style.left = `${spot.x}px`;
        glints[i].style.top = `${spot.y}px`;
        return spot;
      });
      home = { x: box.width * 0.5, y: box.height * 0.5 };
      if (!played) {
        x = home.x;
        y = home.y;
      }
      light(false);
      return box;
    };

    const drift = (now) => {
      drifting = 0;
      if (played || !visible || calm.matches) return;
      const t = now / 1000;
      x = home.x + Math.cos(t * 0.9) * reach * 0.6;
      y = home.y + Math.sin(t * 1.4) * reach * 0.25;
      light(false);
      drifting = requestAnimationFrame(drift);
    };

    const moveTo = (cx, cy) => {
      const box = stage.getBoundingClientRect();
      played = true;
      x = Math.max(0, Math.min(box.width, cx - box.left));
      y = Math.max(0, Math.min(box.height, cy - box.top));
      light(true);
    };
    stage.addEventListener('pointermove', (event) => moveTo(event.clientX, event.clientY));
    stage.addEventListener('pointerdown', (event) => {
      moveTo(event.clientX, event.clientY);
      if (event.pointerType !== 'mouse' && stage.setPointerCapture) stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('keydown', (event) => {
      const keys = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
      const move = keys[event.key];
      if (!move) return;
      event.preventDefault();
      const box = stage.getBoundingClientRect();
      moveTo(box.left + x + move[0] * reach * 0.6, box.top + y + move[1] * reach * 0.6);
    });

    all.addEventListener('click', () => {
      const on = stage.classList.toggle('is-on');
      all.setAttribute('aria-pressed', String(on));
      if (!on) return;
      refls.forEach((el, i) => {
        found.add(i);
        glints[i].classList.add('is-found');
      });
      tell();
    });

    stage.classList.add('is-live');
    new IntersectionObserver((entries) => {
      visible = entries[0].isIntersecting;
      if (!visible) return;
      measure();
      if (!drifting) drifting = requestAnimationFrame(drift);
    }, { rootMargin: '10% 0px' }).observe(stage);
    window.addEventListener('resize', measure);
  }

  // ---------------------------------------------
  // At home: three rituals, one at a time; links to #albumas, #dezute or
  // #zibintas open the right one
  // ---------------------------------------------
  const rituals = page.querySelector('[data-rituals]');
  if (rituals) {
    const tabs = Array.from(rituals.querySelectorAll('[data-ritual-pick]'));
    const cards = Array.from(rituals.querySelectorAll('[data-ritual]'));
    const showRitual = switcher(tabs, cards, 'ritualPick');
    const fromHash = (hash) => {
      const id = hash.replace(/^#/, '');
      return cards.some((card) => card.id === id) ? id : null;
    };

    const start = fromHash(window.location.hash);
    showRitual(start || tabs[0]?.dataset.ritualPick, false);
    if (start) document.getElementById(start)?.scrollIntoView({ block: 'start' });

    window.addEventListener('hashchange', () => {
      const id = fromHash(window.location.hash);
      if (id) showRitual(id, false)?.scrollIntoView({ block: 'start' });
    });
    document.addEventListener('click', (event) => {
      const link = event.target.closest('a[href^="#"]');
      const id = link && fromHash(link.getAttribute('href'));
      if (id) showRitual(id, false);
    });
  }

  // ---------------------------------------------
  // The memory candle: light it, then each press hands over the start of a
  // sentence; putting it out leaves a closing line
  // ---------------------------------------------
  const candle = page.querySelector('[data-candle]');
  if (candle) {
    const starters = Array.from(candle.querySelectorAll('[data-candle-starters] li'), (li) => li.textContent.trim());
    const state = candle.querySelector('[data-candle-state]');
    const line = candle.querySelector('[data-candle-line]');
    const hint = candle.querySelector('[data-candle-hint]');
    const button = candle.querySelector('[data-candle-btn]');
    const label = candle.querySelector('[data-candle-label]');
    const reset = candle.querySelector('[data-candle-reset]');
    const dots = candle.querySelector('[data-candle-dots]');
    const intro = { hint: hint.textContent, label: label.textContent };
    let index = -1;

    dots.replaceChildren(...starters.map(() => document.createElement('li')));
    const dotItems = Array.from(dots.children);

    const show = (next) => {
      index = next;
      state.textContent = state.dataset.lit;
      line.textContent = starters[index];
      restart(line, 'is-new');
      hint.textContent = button.dataset.hintLit;
      label.textContent = button.dataset.labelNext;
      dotItems.forEach((dot, i) => dot.classList.toggle('is-on', i === index));
    };

    button.addEventListener('click', () => {
      if (!starters.length) return;
      if (!candle.classList.contains('is-lit')) {
        candle.classList.add('is-lit');
        reset.hidden = false;
        show(0);
        return;
      }
      show((index + 1) % starters.length);
    });

    reset.addEventListener('click', () => {
      candle.classList.remove('is-lit');
      index = -1;
      state.textContent = state.dataset.out;
      line.textContent = line.dataset.out;
      restart(line, 'is-new');
      hint.textContent = intro.hint;
      label.textContent = intro.label;
      dotItems.forEach((dot) => dot.classList.remove('is-on'));
      reset.hidden = true;
      button.focus();
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
  // The bookshelf: pulling a spine out shows that book
  // ---------------------------------------------
  const shelf = page.querySelector('[data-shelf]');
  if (shelf) {
    const spines = Array.from(shelf.querySelectorAll('[data-book-pick]'));
    const showBook = switcher(spines, Array.from(shelf.querySelectorAll('[data-book]')), 'bookPick');
    showBook(spines[0]?.dataset.bookPick, false);
  }
})();
