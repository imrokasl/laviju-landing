// =============================================
// LAVIJU PRADINIS PUSLAPIS — landing-only interactions
// Runs after /script.js (nav, menu, anchors) and /blog/blog.js
// (reveals, tone canvas, hero parallax, story scenes).
// =============================================

(function () {
  'use strict';

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const hasIO = 'IntersectionObserver' in window;

  // ---------------------------------------------
  // "Ką reiškia 6 žingsniai?" — a climber walks up the achievement steps
  // ---------------------------------------------
  const stairs = document.querySelector('[data-stairs]');
  if (!stairs) return;

  const flight = stairs.querySelector('.stairs__flight');
  const stepButtons = Array.from(stairs.querySelectorAll('.stairs__step'));
  const setButtons = Array.from(stairs.querySelectorAll('[data-stairs-set]'));
  const climber = stairs.querySelector('[data-stairs-climber]');
  const out = {
    code: stairs.querySelector('[data-stairs-code]'),
    name: stairs.querySelector('[data-stairs-name]'),
    num: stairs.querySelector('[data-stairs-num]'),
    desc: stairs.querySelector('[data-stairs-desc]'),
    home: stairs.querySelector('[data-stairs-home]'),
  };

  const sets = {};
  stairs.querySelectorAll('template[data-stairs-data]').forEach((template) => {
    const [width, height] = (template.dataset.climberSize || '').split('x').map(Number);
    sets[template.dataset.stairsData] = {
      code: template.dataset.code,
      name: template.dataset.name,
      color: template.dataset.color,
      home: template.dataset.home,
      climber: template.dataset.climber,
      width,
      height,
      steps: Array.from(template.content.querySelectorAll('li'), (li) => li.textContent.trim()),
    };
  });

  const activeSetButton = setButtons.find((button) => button.classList.contains('is-active')) || setButtons[0];
  let setKey = activeSetButton ? activeSetButton.dataset.stairsSet : Object.keys(sets)[0];
  let step = Number(flight.style.getPropertyValue('--at')) || 3;
  let autoplayTimers = [];

  function clearAutoplay() {
    autoplayTimers.forEach((timer) => window.clearTimeout(timer));
    autoplayTimers = [];
  }

  function hop() {
    if (reduceQuery.matches || !climber) return;
    climber.classList.remove('is-hopping');
    void climber.offsetWidth;
    climber.classList.add('is-hopping');
  }

  function showStep(next, animate) {
    const set = sets[setKey];
    if (!set) return;
    const target = Math.min(6, Math.max(1, next));
    const moved = target !== step;
    step = target;

    flight.style.setProperty('--at', String(step));
    stepButtons.forEach((button) => {
      const n = Number(button.dataset.step);
      button.classList.toggle('is-active', n === step);
      button.classList.toggle('is-past', n < step);
      button.setAttribute('aria-pressed', String(n === step));
    });

    out.num.textContent = String(step);
    out.desc.textContent = set.steps[step - 1] || '';
    if (animate && !reduceQuery.matches) {
      out.desc.classList.remove('is-fresh');
      void out.desc.offsetWidth;
      out.desc.classList.add('is-fresh');
    }
    if (animate && moved) hop();
  }

  function showSet(key) {
    const set = sets[key];
    if (!set) return;
    setKey = key;
    setButtons.forEach((button) => {
      const on = button.dataset.stairsSet === key;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });

    stairs.style.setProperty('--area', set.color);
    out.code.textContent = set.code;
    out.name.textContent = set.name;
    out.home.textContent = set.home;

    if (climber && set.climber) {
      const swap = () => {
        climber.src = set.climber;
        if (set.width) climber.width = set.width;
        if (set.height) climber.height = set.height;
        climber.classList.remove('is-swapping');
      };
      if (reduceQuery.matches) {
        swap();
      } else {
        climber.classList.add('is-swapping');
        window.setTimeout(swap, 220);
      }
    }
  }

  // A short climb from the first step, so the idea of "steps" reads at a glance
  function climbIntro(to) {
    clearAutoplay();
    for (let n = step + 1; n <= to; n++) {
      autoplayTimers.push(window.setTimeout(() => showStep(n, true), 500 + (n - step - 1) * 750));
    }
  }

  stepButtons.forEach((button, index) => {
    button.addEventListener('click', () => {
      clearAutoplay();
      showStep(Number(button.dataset.step), true);
    });

    button.addEventListener('keydown', (event) => {
      const delta = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
      if (!delta) return;
      event.preventDefault();
      const next = stepButtons[Math.min(stepButtons.length - 1, Math.max(0, index + delta))];
      next.focus();
      next.click();
    });
  });

  setButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (button.dataset.stairsSet === setKey) return;
      clearAutoplay();
      showSet(button.dataset.stairsSet);
      showStep(step, true);
    });
  });

  showSet(setKey);

  if (hasIO && !reduceQuery.matches) {
    // Start at the bottom (the section is far below the fold) and climb once it is seen
    const restingStep = step;
    showStep(1, false);
    const introObserver = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        introObserver.disconnect();
        climbIntro(restingStep);
      },
      { threshold: 0.6 }
    );
    introObserver.observe(flight);
  } else {
    showStep(step, false);
  }
})();
