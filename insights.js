// =============================================
// LAVIJU — first-party visit statistics
// No cookies, no identifiers and no third parties. Page, reading and click
// events go to Laviju's own Supabase Edge Function and are visible only to the
// platform owner. To tell new visitors from returning ones, the browser keeps
// only the time of its last visit, a visit count and the kind of source its
// first visit came from; just coarse groups of those are sent.
// Details: /privacy/#statistika
// =============================================

(function () {
  'use strict';

  const ENDPOINT = 'https://hfmwcmgoduvhmmjiyteh.supabase.co/functions/v1/site-insights';
  const PRODUCTION_HOSTS = ['laviju.lt', 'www.laviju.lt'];
  const OPT_OUT_KEY = 'laviju:statistics-opt-out';
  const VISIT_KEY = 'laviju:statistics-visits';
  const CAMPAIGN_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'];
  // Click identifiers that social networks, ad systems and newsletters add to
  // links. Only which kind of service added one is sent, never its value.
  const CLICK_MARKERS = [
    ['fbclid', 'facebook'], ['igshid', 'instagram'], ['gclid', 'google'], ['gbraid', 'google'],
    ['wbraid', 'google'], ['msclkid', 'bing'], ['ttclid', 'tiktok'], ['twclid', 'x'],
    ['li_fat_id', 'linkedin'], ['mc_cid', 'email'], ['mc_eid', 'email'],
  ];
  const FIRST_CHANNELS = ['direct', 'qr', 'search', 'ai', 'social', 'email', 'referral', 'campaign'];
  // The same host rules as supabase/functions/_shared/siteInsights.ts.
  const AI_HOSTS = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com|you\.com|phind\.com)$/;
  const EMAIL_HOSTS = /^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.yahoo\.com|mail\.proton\.me|(?:web)?mail\.[a-z0-9-]+\.[a-z.]{2,6}|com\.google\.android\.gm|com\.microsoft\.office\.outlook)$/;
  const SEARCH_HOSTS = /^(google\.[a-z.]{2,6}|bing\.com|duckduckgo\.com|(?:search\.)?yahoo\.com|yandex\.[a-z]{2,3}|ecosia\.org|search\.brave\.com|startpage\.com|qwant\.com|baidu\.com|seznam\.cz|(?:search\.)?naver\.com|com\.google\.android\.googlequicksearchbox)$/;
  const SOCIAL_HOSTS = /(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com|instagram\.com|threads\.net|linkedin\.com|lnkd\.in|t\.co|twitter\.com|x\.com|pinterest\.[a-z.]{2,6}|pin\.it|tiktok\.com|youtube\.com|youtu\.be|reddit\.com|whatsapp\.com|wa\.me|telegram\.org|t\.me|vk\.com|snapchat\.com|bsky\.app|mastodon\.social|com\.facebook\.katana|com\.facebook\.orca|com\.instagram\.android|com\.linkedin\.android|com\.whatsapp|org\.telegram\.messenger|com\.zhiliaoapp\.musically)$/;
  const SECTION_SELECTOR = 'section[id], article[id], header[id], footer[id]';
  const SECTION_ID = /^[a-z0-9_-]{1,60}$/;
  const VISIT_GAP_MS = 1800000;
  const VISIT_MEMORY_MS = 34214400000;
  const IDLE_AFTER_MS = 90000;
  const MAX_ENGAGED_MS = 3600000;
  const MAX_INTERACTIONS = 60;
  const MAX_SECTIONS = 40;
  const MAX_ERRORS = 99;
  // The collector refuses bodies over 4096 bytes.
  const MAX_BODY = 3500;
  const nav = window.navigator || {};
  // A keepalive fetch outlives the page just like a beacon. Beacons are only the
  // fallback for browsers without keepalive: privacy filter lists drop every
  // beacon sent to another domain (EasyPrivacy's *$ping,third-party), and the
  // collector runs on Supabase's domain.
  const KEEPALIVE = typeof Request === 'function' && 'keepalive' in Request.prototype;

  // ---------------------------------------------
  // Opt-out: the visitor's own choice, which also forgets past visits.
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
      if (value) {
        window.localStorage.setItem(OPT_OUT_KEY, '1');
        window.localStorage.removeItem(VISIT_KEY);
      } else {
        window.localStorage.removeItem(OPT_OUT_KEY);
      }
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

  function send(payload, leaving) {
    if (isOptedOut()) return;
    // A text/plain body keeps this a simple request (no CORS preflight).
    let body = JSON.stringify(payload);
    if (body.length > MAX_BODY && payload.sectionSeconds) {
      // Reading time per section is the one part that can be left out.
      body = JSON.stringify(Object.assign({}, payload, { sectionSeconds: {} }));
    }
    if (leaving && !KEEPALIVE) {
      try {
        if (typeof nav.sendBeacon === 'function' && nav.sendBeacon(ENDPOINT, body)) return;
      } catch (error) {
        // Fall back to fetch below.
      }
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

  function clickSource() {
    try {
      const params = new URLSearchParams(window.location.search);
      for (const [name, service] of CLICK_MARKERS) {
        if (params.has(name)) return service;
      }
    } catch (error) {
      // No click identifier.
    }
    return null;
  }

  // Reloads and back/forward moves repeat a page the visitor has already seen.
  function loadType(restored) {
    if (restored) return 'back_forward';
    try {
      const navigation = performance.getEntriesByType('navigation')[0];
      const type = navigation && navigation.type;
      if (type === 'reload' || type === 'back_forward') return type;
    } catch (error) {
      // No navigation timing.
    }
    return 'navigate';
  }

  // The kind of source this page was reached from, by the server's rules.
  // A browser's first visit remembers this one word, never the address.
  function touchChannel() {
    const query = campaign();
    if (query.utm_source || query.ref || query.utm_medium || query.utm_campaign) return 'campaign';
    let host = '';
    try {
      const url = new URL(document.referrer);
      if (PRODUCTION_HOSTS.indexOf(url.hostname) === -1 && /^(https?|android-app):$/.test(url.protocol)) {
        host = url.hostname.toLowerCase().replace(/^(?:www\d?|m|l|lm|mobile)\./, '');
      }
    } catch (error) {
      // No referrer.
    }
    if (host) {
      if (AI_HOSTS.test(host)) return 'ai';
      if (EMAIL_HOSTS.test(host)) return 'email';
      if (SEARCH_HOSTS.test(host)) return 'search';
      return SOCIAL_HOSTS.test(host) ? 'social' : 'referral';
    }
    const click = clickSource();
    if (click) return click === 'email' ? 'email' : click === 'google' || click === 'bing' ? 'search' : 'social';
    const agent = nav.userAgent || '';
    if (/FBAN|FBAV|FB_IAB|Instagram/.test(agent)) return 'social';
    const handheld = /Mobi|Android|iPhone|iPad|iPod|Tablet|Silk|Kindle/.test(agent)
      || (/Macintosh/.test(agent) && nav.maxTouchPoints > 1);
    // The flyer QR code opens the blog without any source.
    return handheld && pagePath() === '/blog/' ? 'qr' : 'direct';
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
  // New or returning. The browser remembers when it was last active here,
  // how many visits it has made, the gap in days before the current one and
  // the kind of source its first visit came from. A visit ends after 30
  // minutes without activity, as on the server, and the memory lapses after
  // 13 months. Only coarse groups leave the browser.
  // ---------------------------------------------
  let visit = null;
  let visitSavedAt = 0;

  function localDay(time) {
    const date = new Date(time);
    return Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }

  function readVisitMemory() {
    const raw = window.localStorage.getItem(VISIT_KEY);
    if (!raw) return null;
    try {
      const memory = JSON.parse(raw);
      if (memory && Number.isFinite(memory.t) && Number.isInteger(memory.n) && memory.n >= 1) {
        return {
          t: memory.t,
          n: memory.n,
          g: Number.isInteger(memory.g) && memory.g >= 0 ? memory.g : null,
          f: FIRST_CHANNELS.indexOf(memory.f) !== -1 ? memory.f : null,
        };
      }
    } catch (error) {
      // An unreadable memory starts over.
    }
    return null;
  }

  function saveVisit(time) {
    try {
      // A memory from before first sources were kept has none to save.
      const memory = { t: time, n: visit.n, g: visit.g, f: visit.f || undefined };
      window.localStorage.setItem(VISIT_KEY, JSON.stringify(memory));
      visitSavedAt = time;
      return true;
    } catch (error) {
      return false;
    }
  }

  function beginVisit() {
    const time = Date.now();
    let memory = null;
    try {
      memory = readVisitMemory();
    } catch (error) {
      // Storage is blocked, so new and returning cannot be told apart.
      visit = null;
      return;
    }
    const elapsed = memory ? time - memory.t : Infinity;
    if (memory && elapsed >= 0 && elapsed < VISIT_GAP_MS) {
      visit = { n: memory.n, g: memory.g, f: memory.f };
    } else if (memory && elapsed < VISIT_MEMORY_MS) {
      visit = { n: Math.min(memory.n + 1, 999), g: Math.max(0, localDay(time) - localDay(memory.t)), f: memory.f };
    } else {
      visit = { n: 1, g: null, f: touchChannel() };
    }
    // Without a saved memory every visit would look new; send nothing then.
    if (!saveVisit(time)) visit = null;
  }

  // A first visit's own page view already says where it came from, so the
  // remembered first source only travels with later visits.
  function visitGroups() {
    if (!visit) return null;
    const number = visit.n >= 6 ? 6 : visit.n >= 3 ? 3 : visit.n;
    if (number === 1) return { n: 1 };
    const groups = { n: number };
    const gap = visit.g;
    if (gap !== null) groups.d = gap >= 31 ? 31 : gap >= 8 ? 8 : gap >= 2 ? 2 : gap;
    if (visit.f) groups.f = visit.f;
    return groups;
  }

  // Activity keeps the visit open; saved at most once a minute unless leaving.
  function touchVisit(force) {
    if (!visit) return;
    const time = Date.now();
    if (!force && time - visitSavedAt < 60000) return;
    if (!isOptedOut()) saveVisit(time);
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
  let sectionMs = {};
  let focusId = null;
  let focusAt = 0;
  let errorCount = 0;
  let firstError = null;
  let interactionCount = 0;
  let lastInteraction = '';
  let lastInteractionAt = 0;
  let lastSnapshot = '';
  let nextMilestone = 15000;
  const vitals = { ttfb: null, lcp: null, inp: null, cls: null };

  // ---------------------------------------------
  // Active reading time: visible and used within the last 90 seconds.
  // ---------------------------------------------
  // Reading time belongs to the section in the middle of the screen. Time is
  // settled whenever that section changes or reading stops.
  function settleFocus(next) {
    const time = now();
    if (focusId && stretchStart) {
      sectionMs[focusId] = (sectionMs[focusId] || 0) + Math.max(0, time - Math.max(focusAt, stretchStart));
    }
    focusId = next;
    focusAt = time;
  }

  function stopStretch() {
    if (!stretchStart) return;
    settleFocus(focusId);
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
    touchVisit(false);
  }

  // ---------------------------------------------
  // Scroll depth and the page sections that were actually seen
  // ---------------------------------------------
  function collectSections() {
    sectionElements = Array.from(document.querySelectorAll(SECTION_SELECTOR))
      .filter((element) => SECTION_ID.test(element.id) && !element.closest('nav, dialog, template'))
      .slice(0, MAX_SECTIONS);
  }

  function sectionOf(node) {
    const element = node && typeof node.closest === 'function' ? node : node && node.parentElement;
    const section = element && typeof element.closest === 'function' ? element.closest(SECTION_SELECTOR) : null;
    return section && SECTION_ID.test(section.id) ? section.id : null;
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
    // section (such as the footer) was on screen. Being read: the smallest
    // section across the middle, so a card inside a wider section wins.
    const middle = viewport / 2;
    let focus = null;
    let focusHeight = Infinity;
    sectionElements.forEach((element, index) => {
      const rect = element.getBoundingClientRect();
      if (!rect.height) return;
      const centred = rect.top <= middle && rect.bottom >= middle;
      const visible = Math.min(rect.bottom, viewport) - Math.max(rect.top, 0);
      if (centred || visible >= rect.height * 0.6) sections[element.id] = index;
      if (centred && rect.height < focusHeight) {
        focus = element.id;
        focusHeight = rect.height;
      }
    });
    if (focus !== focusId) settleFocus(focus);
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
  function flush(leaving) {
    if (!pageviewId) return;
    measure();
    settleFocus(focusId);
    const engaged = currentEngaged();
    // Running totals: a lost update loses nothing, so unchanged state is skipped.
    const snapshot = JSON.stringify([
      Math.round(engaged / 1000), maxScroll, Object.keys(sections).length,
      vitals.ttfb, vitals.lcp, vitals.inp, vitals.cls, errorCount,
    ]);
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;
    const sectionSeconds = {};
    Object.keys(sectionMs).forEach((id) => {
      const seconds = Math.round(sectionMs[id] / 1000);
      if (seconds >= 1) sectionSeconds[id] = Math.min(3600, seconds);
    });
    send({
      v: 1,
      type: 'engagement',
      id: pageviewId,
      engagedMs: engaged,
      scrollDepth: maxScroll,
      sections,
      sectionSeconds,
      // The section on screen when these totals were taken; the last update
      // of a page view therefore says where reading stopped.
      focus: focusId,
      vitals,
      errors: errorCount,
      error: firstError,
    }, leaving);
  }

  function startPageview(restored) {
    pageviewId = randomId();
    engagedMs = 0;
    stretchStart = 0;
    maxScroll = 0;
    sections = {};
    sectionMs = {};
    focusId = null;
    focusAt = 0;
    errorCount = 0;
    firstError = null;
    interactionCount = 0;
    lastSnapshot = '';
    nextMilestone = 15000;
    collectSections();
    measure();
    beginVisit();

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
      click: restored ? null : clickSource(),
      load: loadType(restored),
      viewportWidth: window.innerWidth || null,
      touchPoints: Math.min(20, nav.maxTouchPoints || 0),
      language: nav.language || null,
      timeZone: timeZone(),
      visit: visitGroups(),
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
    // Any other button is named by its own caption; forms are left alone.
    if (button.getAttribute('type') === 'submit') return null;
    const caption = cleanLabel(button.getAttribute('aria-label') || button.textContent, 60);
    return caption ? ['button', caption] : null;
  }

  // An expandable block is recorded when it is opened, not when it is closed.
  function describeSummary(summary) {
    const details = summary.parentElement;
    if (details && typeof details.hasAttribute === 'function' && details.hasAttribute('open')) return null;
    const caption = cleanLabel(summary.textContent, 80);
    return caption ? ['details', caption] : null;
  }

  // Three quick clicks on one spot that is not a control: the visitor expected
  // something to happen there. Selecting a paragraph by triple-click is not that.
  let burst = { count: 0, at: 0, x: 0, y: 0 };

  function noteStrayClick(event, target) {
    if (event.button || target.closest('input, textarea, select, label')) return;
    const time = now();
    const x = event.clientX || 0;
    const y = event.clientY || 0;
    const repeated = time - burst.at < 700 && Math.abs(x - burst.x) < 30 && Math.abs(y - burst.y) < 30;
    burst = { count: repeated ? burst.count + 1 : 1, at: time, x, y };
    if (burst.count !== 3) return;
    try {
      if (String(window.getSelection()).length) return;
    } catch (error) {
      // No selection to check.
    }
    const tag = String(target.tagName || '').toLowerCase();
    const name = String(target.getAttribute('class') || '').split(/\s+/)[0];
    const spot = /^[a-z0-9_-]{1,40}$/i.test(name) ? `${tag}.${name}` : tag;
    const section = sectionOf(target);
    track('rage_click', cleanLabel(section ? `${section} · ${spot}` : spot, 120));
  }

  function onClick(event) {
    const target = event.target;
    if (!target || typeof target.closest !== 'function') return;
    const element = target.closest('a[href], button, summary');
    if (!element) {
      noteStrayClick(event, target);
      return;
    }
    if (element.hasAttribute('data-insights-optout')) return;
    const described = element.tagName === 'A' ? describeLink(element)
      : element.tagName === 'SUMMARY' ? describeSummary(element) : describeButton(element);
    if (described) track(described[0], described[1]);
  }

  // ---------------------------------------------
  // Page faults: a script of this site that failed or a file that did not
  // load. Counted with the first one named, so broken visits can be explained.
  // ---------------------------------------------
  function ownPlace(address) {
    try {
      const url = new URL(address, window.location.href);
      return PRODUCTION_HOSTS.indexOf(url.hostname) !== -1 ? url.pathname : url.hostname;
    } catch (error) {
      return null;
    }
  }

  function onPageError(event) {
    if (!pageviewId || !event) return;
    const target = event.target;
    let label = null;
    if (target && target !== window && typeof target.getAttribute === 'function') {
      const address = target.getAttribute('src') || target.getAttribute('href');
      const place = address ? ownPlace(address) : null;
      if (place) label = `failas: ${place}`;
    } else if (event.message && event.filename) {
      // Faults of browser extensions and of other sites' scripts are not the page's.
      // Only the kind of fault is kept: its message could quote something typed on the page.
      const place = ownPlace(event.filename);
      const named = event.error && event.error.name;
      const kind = typeof named === 'string' && /^[A-Za-z]{1,40}$/.test(named)
        ? named
        : (/\b[A-Z][A-Za-z]{0,30}Error\b/.exec(String(event.message)) || ['Error'])[0];
      if (place && place.charAt(0) === '/') label = `skriptas: ${place}:${event.lineno || 0} · ${kind}`;
    }
    if (!label) return;
    errorCount = Math.min(MAX_ERRORS, errorCount + 1);
    if (!firstError) firstError = cleanLabel(label, 120);
  }

  // ---------------------------------------------
  // Boot
  // ---------------------------------------------
  // Capture phase: page scripts may cancel a click (e.g. the quick-read sheet).
  document.addEventListener('click', onClick, true);
  document.addEventListener('auxclick', (event) => {
    if (event.button === 1) onClick(event);
  }, true);

  // Copying is recorded with the section it happened in, never the text.
  let lastCopyAt = -Infinity;
  document.addEventListener('copy', (event) => {
    if (now() - lastCopyAt < 5000) return;
    lastCopyAt = now();
    track('text_copy', sectionOf(event && event.target));
  });
  window.addEventListener('beforeprint', () => track('print', null));
  // Capture phase: files that fail to load do not bubble their error.
  window.addEventListener('error', onPageError, true);

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
      touchVisit(true);
    } else {
      onActivity();
    }
  });
  window.addEventListener('pagehide', () => {
    stopStretch();
    flush(true);
    touchVisit(true);
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) startPageview(true);
  });

  // Periodic totals make short visits count even if the final update is lost.
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
