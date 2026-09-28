// =============================================
// LAVIJU — first-party visit statistics
// No cookies, no stored identifiers and no third parties. Page, reading and
// click events go to Laviju's own Supabase Edge Function and are visible only
// to the platform owner. Details: /privacy/#statistika
// =============================================

(function () {
  'use strict';

  const ENDPOINT = 'https://hfmwcmgoduvhmmjiyteh.supabase.co/functions/v1/site-insights';
  const PRODUCTION_HOSTS = ['laviju.lt', 'www.laviju.lt'];
  const OPT_OUT_KEY = 'laviju:statistics-opt-out';
  const CAMPAIGN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'src', 'ref'];
  const IDLE_AFTER_MS = 90000;
  const MAX_ENGAGED_MS = 3600000;
  const MAX_INTERACTIONS = 60;
  const MAX_SECTIONS = 40;
  const nav = window.navigator || {};

  // ---------------------------------------------
  // Opt-out: the visitor's own choice is the only thing ever stored.
  // It works on every host so /privacy/ can offer it anywhere.
  // ---------------------------------------------
  function isOptedOut() {
    try {
      return window.localStorage.getItem(OPT_OUT_KEY) === '1';
    } catch (error) {
      return false;
    }
  }

  function setOptedOut(value) {
    try {
      if (value) window.localStorage.setItem(OPT_OUT_KEY, '1');
      else window.localStorage.removeItem(OPT_OUT_KEY);
      return true;
    } catch (error) {
      return false;
    }
  }

  function bindOptOutControls() {
    const buttons = Array.from(document.querySelectorAll('[data-insights-optout]'));
    const status = document.querySelector('[data-insights-status]');
    if (!buttons.length) return;

    function render() {
      const optedOut = isOptedOut();
      buttons.forEach((button) => {
        button.hidden = false;
        button.textContent = optedOut ? 'Vėl įtraukti mano apsilankymus' : 'Neįtraukti mano apsilankymų';
      });
      if (status) {
        status.textContent = optedOut
          ? 'Šioje naršyklėje jūsų apsilankymai neskaičiuojami.'
          : 'Šioje naršyklėje apsilankymai skaičiuojami anonimiškai.';
      }
    }

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        if (!setOptedOut(!isOptedOut())) {
          if (status) status.textContent = 'Naršyklė neleido išsaugoti pasirinkimo.';
          return;
        }
        render();
      });
    });
    render();
  }

  bindOptOutControls();

  // Only the public site is measured: local, preview and automated browsers
  // never send anything.
  if (PRODUCTION_HOSTS.indexOf(window.location.hostname) === -1) return;
  if (isOptedOut() || nav.webdriver) return;
  if (/bot|crawl|spider|headless|lighthouse/i.test(nav.userAgent || '')) return;

  // ---------------------------------------------
  // Helpers
  // ---------------------------------------------
  function now() {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  }

  function cleanLabel(value, max) {
    const text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text ? text.slice(0, max) : null;
  }

  function randomId() {
    const cryptoApi = window.crypto;
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID();
    const bytes = new Uint8Array(16);
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
    else for (let index = 0; index < 16; index++) bytes[index] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function send(payload, beacon) {
    if (isOptedOut()) return;
    const body = JSON.stringify(payload);
    try {
      // A text/plain body keeps this a simple request (no CORS preflight).
      if (beacon && typeof nav.sendBeacon === 'function' && nav.sendBeacon(ENDPOINT, body)) return;
    } catch (error) {
      // Fall back to fetch below.
    }
    try {
      fetch(ENDPOINT, { method: 'POST', body, keepalive: true, credentials: 'omit', mode: 'cors' }).catch(() => {});
    } catch (error) {
      // Statistics must never interrupt reading.
    }
  }

  // The canonical address groups /docs and /docs/ and ignores query strings.
  function pagePath() {
    let path = window.location.pathname || '/';
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) {
      try {
        const url = new URL(canonical.getAttribute('href'), window.location.href);
        if (PRODUCTION_HOSTS.indexOf(url.hostname) !== -1) path = url.pathname;
      } catch (error) {
        // Keep the address bar path.
      }
    }
    return path.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/index\.html$/, '/') || '/';
  }

  // Only the referring site's origin leaves the browser; an internal
  // referrer keeps its path so navigation between pages can be followed.
  function referrer() {
    if (!document.referrer) return null;
    try {
      const url = new URL(document.referrer);
      if (PRODUCTION_HOSTS.indexOf(url.hostname) !== -1) return url.origin + url.pathname;
      if (url.protocol === 'http:' || url.protocol === 'https:') return `${url.origin}/`;
      if (url.protocol === 'android-app:' && url.hostname) return `android-app://${url.hostname}/`;
    } catch (error) {
      // Unreadable referrers count as direct visits.
    }
    return null;
  }

  function campaign() {
    const query = {};
    try {
      const params = new URLSearchParams(window.location.search);
      CAMPAIGN_PARAMS.forEach((key) => {
        const value = params.get(key);
        if (value) query[key] = value.slice(0, 80);
      });
    } catch (error) {
      // No campaign.
    }
    return query;
  }

  function timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
    } catch (error) {
      return null;
    }
  }

  function isHidden() {
    return document.visibilityState === 'hidden';
  }

  // ---------------------------------------------
  // Page view state
  // ---------------------------------------------
  let pageviewId = null;
  let engagedMs = 0;
  let stretchStart = 0;
  let lastActivity = 0;
  let idleTimer = 0;
  let maxScroll = 0;
  let sections = {};
  let sectionElements = [];
  let interactionCount = 0;
  let lastInteraction = '';
  let lastInteractionAt = 0;
  let lastSnapshot = '';
  let nextMilestone = 15000;
  const vitals = { ttfb: null, lcp: null, inp: null, cls: null };

  // ---------------------------------------------
  // Active reading time: visible and used within the last 90 seconds.
  // ---------------------------------------------
  function stopStretch() {
    if (!stretchStart) return;
    engagedMs = Math.min(MAX_ENGAGED_MS, engagedMs + (now() - stretchStart));
    stretchStart = 0;
  }

  function currentEngaged() {
    return Math.min(MAX_ENGAGED_MS, Math.round(engagedMs + (stretchStart ? now() - stretchStart : 0)));
  }

  function onActivity() {
    if (isHidden()) return;
    const time = now();
    if (stretchStart && time - lastActivity < 1000) return;
    lastActivity = time;
    if (!stretchStart) stretchStart = time;
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(stopStretch, IDLE_AFTER_MS);
  }

  // ---------------------------------------------
  // Scroll depth and the page sections that were actually seen
  // ---------------------------------------------
  function collectSections() {
    sectionElements = Array.from(document.querySelectorAll('section[id], article[id], header[id], footer[id]'))
      .filter((element) => /^[a-z0-9_-]{1,60}$/.test(element.id) && !element.closest('nav, dialog, template'))
      .slice(0, MAX_SECTIONS);
  }

  function measure() {
    const root = document.documentElement;
    const viewport = window.innerHeight || (root && root.clientHeight) || 0;
    const top = window.scrollY || window.pageYOffset || (root && root.scrollTop) || 0;
    const height = Math.max(root ? root.scrollHeight : 0, document.body ? document.body.scrollHeight : 0);
    if (!viewport) return;

    if (height) {
      const depth = top + viewport >= height - 2 ? 100 : Math.round(((top + viewport) / height) * 100);
      maxScroll = Math.max(maxScroll, Math.min(100, depth));
    }

    // Seen: the section crossed the middle of the screen, or most of a short
    // section (such as the footer) was on screen.
    const middle = viewport / 2;
    sectionElements.forEach((element, index) => {
      if (Object.prototype.hasOwnProperty.call(sections, element.id)) return;
      const rect = element.getBoundingClientRect();
      if (!rect.height) return;
      const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
      if ((rect.top <= middle && rect.bottom >= middle) || visible >= rect.height * 0.6) {
        sections[element.id] = index;
      }
    });
  }

  let measureTimer = 0;
  function queueMeasure() {
    if (measureTimer) return;
    measureTimer = window.setTimeout(() => {
      measureTimer = 0;
      measure();
    }, 200);
  }

  // ---------------------------------------------
  // Web Vitals (Chromium reports all; other browsers report what they support)
  // ---------------------------------------------
  function observe(type, callback, options) {
    try {
      if (typeof PerformanceObserver !== 'function') return false;
      const supported = PerformanceObserver.supportedEntryTypes;
      if (!supported || supported.indexOf(type) === -1) return false;
      const observer = new PerformanceObserver((list) => callback(list.getEntries()));
      observer.observe(Object.assign({ type, buffered: true }, options || {}));
      return true;
    } catch (error) {
      return false;
    }
  }

  function setupVitals() {
    let activationStart = 0;
    try {
      const navigation = performance.getEntriesByType('navigation')[0];
      if (navigation) {
        activationStart = navigation.activationStart || 0;
        if (navigation.responseStart > 0) {
          vitals.ttfb = Math.max(0, Math.round(navigation.responseStart - activationStart));
        }
      }
    } catch (error) {
      // No navigation timing.
    }

    observe('largest-contentful-paint', (entries) => {
      const last = entries[entries.length - 1];
      if (last) vitals.lcp = Math.max(0, Math.round(last.startTime - activationStart));
    });

    // Cumulative Layout Shift: the largest burst of shifts (session window).
    let windowValue = 0;
    let windowStart = 0;
    let windowLast = 0;
    const clsSupported = observe('layout-shift', (entries) => {
      entries.forEach((entry) => {
        if (entry.hadRecentInput) return;
        if (windowValue && entry.startTime - windowLast < 1000 && entry.startTime - windowStart < 5000) {
          windowValue += entry.value;
        } else {
          windowValue = entry.value;
          windowStart = entry.startTime;
        }
        windowLast = entry.startTime;
        vitals.cls = Math.max(vitals.cls || 0, Math.round(windowValue * 1000) / 1000);
      });
    });
    if (clsSupported && vitals.cls === null) vitals.cls = 0;

    // Interaction to Next Paint: the slowest interactions, skipping one
    // outlier per 50 interactions as the metric's definition does.
    const durations = new Map();
    let interactionTotal = 0;
    observe('event', (entries) => {
      entries.forEach((entry) => {
        const id = entry.interactionId;
        if (!id) return;
        if (!durations.has(id)) {
          interactionTotal += 1;
          if (durations.size >= 100) durations.delete(durations.keys().next().value);
        }
        durations.set(id, Math.max(durations.get(id) || 0, entry.duration));
      });
      const slowest = Array.from(durations.values()).sort((a, b) => b - a);
      if (slowest.length) {
        vitals.inp = Math.round(slowest[Math.min(slowest.length - 1, Math.floor(interactionTotal / 50))]);
      }
    }, { durationThreshold: 40 });
  }

  // ---------------------------------------------
  // Sending
  // ---------------------------------------------
  function flush(beacon) {
    if (!pageviewId) return;
    measure();
    const engaged = currentEngaged();
    // Running totals: a lost update loses nothing, so unchanged state is skipped.
    const snapshot = JSON.stringify([
      Math.round(engaged / 1000), maxScroll, Object.keys(sections).length,
      vitals.ttfb, vitals.lcp, vitals.inp, vitals.cls,
    ]);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    send({
      v: 1,
      type: 'engagement',
      id: pageviewId,
      engagedMs: engaged,
      scrollDepth: maxScroll,
      sections,
      vitals,
    }, beacon);
  }

  function startPageview(restored) {
    pageviewId = randomId();
    engagedMs = 0;
    stretchStart = 0;
    maxScroll = 0;
    sections = {};
    interactionCount = 0;
    lastSnapshot = '';
    nextMilestone = 15000;
    collectSections();
    measure();

    send({
      v: 1,
      type: 'pageview',
      id: pageviewId,
      path: pagePath(),
      title: cleanLabel(String(document.title || '').replace(/\s+[–—-]\s+Laviju\s*$/, ''), 150),
      // A page restored from the back/forward cache is a new view of a visit
      // that is already under way, so its original referrer does not apply.
      referrer: restored ? null : referrer(),
      query: restored ? {} : campaign(),
      viewportWidth: window.innerWidth || null,
      touchPoints: Math.min(20, nav.maxTouchPoints || 0),
      language: nav.language || null,
      timeZone: timeZone(),
    }, false);

    onActivity();
  }

  function track(name, label) {
    if (!pageviewId || interactionCount >= MAX_INTERACTIONS) return;
    const key = `${name}|${label}`;
    const time = now();
    if (key === lastInteraction && time - lastInteractionAt < 800) return;
    lastInteraction = key;
    lastInteractionAt = time;
    interactionCount += 1;
    onActivity();
    send({ v: 1, type: 'interaction', id: pageviewId, name, label: label || null }, true);
  }

  // ---------------------------------------------
  // What a click means. Only fixed labels, link targets and element text
  // are recorded — never anything a visitor typed.
  // ---------------------------------------------
  const NAVIGATION_AREAS = [
    ['.docs-sidebar', 'šoninis meniu'],
    ['.mobile-menu', 'mobilus meniu'],
    ['footer', 'poraštė'],
    ['nav', 'viršus'],
  ];

  function describeLink(link) {
    let url;
    try {
      url = new URL(link.getAttribute('href'), window.location.href);
    } catch (error) {
      return null;
    }

    if (url.protocol === 'mailto:') {
      let address = url.pathname;
      try {
        address = decodeURIComponent(address);
      } catch (error) {
        // Keep the raw address.
      }
      const subject = url.searchParams.get('subject');
      return ['email', cleanLabel(subject ? `${address} · ${subject}` : address, 120)];
    }
    if (url.protocol === 'tel:') return ['phone', cleanLabel(url.pathname, 40)];
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

    const host = url.hostname.toLowerCase();
    if (PRODUCTION_HOSTS.indexOf(host) === -1 && host !== window.location.hostname) {
      if (/(^|\.)play\.google\.com$/.test(host)) return ['app_download', 'google_play'];
      if (/(^|\.)apps\.apple\.com$/.test(host)) return ['app_download', 'app_store'];
      return ['outbound', host.replace(/^www\./, '')];
    }

    const path = `${url.pathname}${url.hash}`;
    const text = cleanLabel(link.textContent, 60);
    const href = link.getAttribute('href') || '';
    if (link.hasAttribute('download') || /\.(pdf|zip|png|jpe?g|webp|svg|docx?|xlsx?|pptx?)$/i.test(url.pathname)) {
      return ['download', cleanLabel(url.pathname, 120)];
    }
    if (link.hasAttribute('data-filter-link')) return ['blog_filter', cleanLabel(link.getAttribute('data-filter-link'), 40)];
    if (link.hasAttribute('data-peek')) return ['quick_read', cleanLabel(link.getAttribute('data-peek'), 60)];
    if (link.hasAttribute('data-peek-link')) return ['quick_read_full', cleanLabel(path, 120)];
    if (/^#saltinis-/.test(href)) return ['citation', href.slice(1)];
    if (link.closest('[data-toc]')) return ['toc', cleanLabel(url.hash.slice(1), 60)];
    if (link.closest('[data-rail]')) return ['chapter_rail', cleanLabel(url.hash.slice(1), 60)];
    for (const [selector, area] of NAVIGATION_AREAS) {
      if (link.closest(selector)) return ['nav', cleanLabel(`${text || path} · ${area}`, 120)];
    }
    const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
    if (samePage && url.hash) return ['anchor', cleanLabel(url.hash.slice(1), 60)];
    return ['internal_link', cleanLabel(text ? `${path} · ${text}` : path, 120)];
  }

  const TALK_LABELS = { before: 'prieš', after: 'po' };

  function describeButton(button) {
    const value = (name) => cleanLabel(button.getAttribute(name), 40);
    if (button.hasAttribute('data-filter')) return ['blog_filter', value('data-filter')];
    if (button.hasAttribute('data-sound')) return ['sound', value('data-sound')];
    if (button.hasAttribute('data-plus-set')) return ['word_builder', `rinkinys: ${value('data-plus-set')}`];
    if (button.hasAttribute('data-plus-next')) return ['word_builder', 'kitas žodis'];
    if (button.hasAttribute('data-plus-reset')) return ['word_builder', 'iš naujo'];
    if (button.hasAttribute('data-talk')) {
      const talk = button.getAttribute('data-talk');
      return ['conversation', TALK_LABELS[talk] || value('data-talk')];
    }
    if (button.hasAttribute('data-day-prev')) return ['day_story', 'atgal'];
    if (button.hasAttribute('data-day-next')) return ['day_story', 'pirmyn'];
    if (button.hasAttribute('data-stairs-set')) return ['steps', `sritis: ${value('data-stairs-set')}`];
    if (button.classList.contains('stairs__step')) return ['steps', `žingsnis ${value('data-step')}`];
    if (button.hasAttribute('data-share-copy')) return ['share', 'kopijuoti nuorodą'];
    if (button.hasAttribute('data-share-native')) return ['share', 'dalintis'];
    if (button.classList.contains('docs-faq-question')) return ['faq', cleanLabel(button.textContent, 100)];
    if (button.id === 'nav-menu-btn' || button.id === 'docs-menu-btn') {
      return ['menu', button.getAttribute('aria-expanded') === 'true' ? 'uždaryti' : 'atidaryti'];
    }
    return null;
  }

  function onClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const element = target.closest('a[href], button');
    if (!element || element.hasAttribute('data-insights-optout')) return;
    const described = element.tagName === 'A' ? describeLink(element) : describeButton(element);
    if (described) track(described[0], described[1]);
  }

  // ---------------------------------------------
  // Boot
  // ---------------------------------------------
  // Capture phase: page scripts may cancel a click (e.g. the quick-read sheet).
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', (event) => {
    if (event.button === 1) onClick(event);
  }, true);

  let lastCopyAt = -Infinity;
  document.addEventListener('copy', () => {
    if (now() - lastCopyAt < 5000) return;
    lastCopyAt = now();
    track('text_copy', null);
  });

  // Documentation search: only the fact that someone searched, not the words.
  const docsSearch = document.getElementById('docs-search-input');
  if (docsSearch) {
    let searchTimer = 0;
    docsSearch.addEventListener('input', () => {
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(() => {
        if (String(docsSearch.value || '').trim().length >= 2) track('docs_search', null);
      }, 1500);
    });
  }

  ['scroll', 'wheel', 'keydown', 'pointerdown', 'pointermove', 'touchstart'].forEach((type) => {
    window.addEventListener(type, onActivity, { passive: true, capture: true });
  });
  window.addEventListener('scroll', queueMeasure, { passive: true });
  window.addEventListener('resize', queueMeasure, { passive: true });

  document.addEventListener('visibilitychange', () => {
    if (isHidden()) {
      stopStretch();
      flush(true);
    } else {
      onActivity();
    }
  });
  window.addEventListener('pagehide', () => {
    stopStretch();
    flush(true);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) startPageview(true);
  });

  // Periodic totals make short visits count even if the final beacon is lost.
  window.setInterval(() => {
    if (!pageviewId || currentEngaged() < nextMilestone) return;
    nextMilestone = nextMilestone < 60000 ? 60000 : nextMilestone + 120000;
    flush(false);
  }, 5000);

  setupVitals();

  if (document.prerendering) {
    document.addEventListener('prerenderingchange', () => startPageview(false), { once: true });
  } else {
    startPageview(false);
  }
})();
