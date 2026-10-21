// =============================================
// LAVIJU IDĖJOS — email list form
// Sends one address to Laviju's own Supabase Edge Function
// (supabase/functions/email-signup), which applies the same address check.
// Only the address, this page and the kind of link that opened it are sent.
// Details: /privacy/#laiskai
// =============================================

(function () {
  'use strict';

  const ENDPOINT = 'https://hfmwcmgoduvhmmjiyteh.supabase.co/functions/v1/email-signup';
  const PAGE = '/idejos/';
  // The same rule as normalizeEmail in supabase/functions/_shared/emailSignup.ts.
  const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?=.{4,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,24}$/;
  const MESSAGES = {
    empty: 'Įrašykite savo el. pašto adresą.',
    invalid: 'Patikrinkite el. pašto adresą – atrodo, jame kažko trūksta.',
    limited: 'Per daug bandymų iš šio įrenginio. Pabandykite vėliau.',
    failed: 'Nepavyko išsiųsti. Patikrinkite interneto ryšį ir bandykite dar kartą.',
    sending: 'Siunčiama…',
  };

  function normalizeEmail(value) {
    const email = String(value || '').trim().toLowerCase();
    if (email.length < 6 || email.length > 254 || email.includes('..')) return null;
    return EMAIL_PATTERN.test(email) ? email : null;
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.toLowerCase();
    } catch (error) {
      return '';
    }
  }

  // Which kind of link opened the page: a tag the owner added to the link,
  // the referring site, or the click marker a social network appends.
  function sourceHint(location, referrer) {
    let params;
    try {
      params = new URL(location).searchParams;
    } catch (error) {
      params = new URLSearchParams();
    }
    const tag = (params.get('utm_source') || params.get('src') || params.get('ref') || '').toLowerCase();
    if (/insta|^ig$/.test(tag)) return 'instagram';
    if (/facebook|^fb$|^meta$/.test(tag)) return 'facebook';

    const host = hostOf(referrer);
    if (/(^|\.)instagram\.com$/.test(host)) return 'instagram';
    if (/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/.test(host)) return 'facebook';
    if (params.has('igshid') || params.has('igsh')) return 'instagram';
    if (params.has('fbclid')) return 'facebook';
    if (tag || (host && !/(^|\.)laviju\.lt$/.test(host))) return 'other';
    return 'direct';
  }

  function bind(form) {
    const input = form.querySelector('input[name="email"]');
    const trap = form.querySelector('input[name="website"]');
    const button = form.querySelector('button[type="submit"]');
    const label = form.querySelector('[data-signup-label]');
    const status = form.querySelector('[data-signup-status]');
    const done = document.querySelector('[data-signup-done]');
    const source = sourceHint(window.location.href, document.referrer);
    let sending = false;

    function show(message, tone) {
      status.textContent = message || '';
      if (tone) status.setAttribute('data-tone', tone);
      else status.removeAttribute('data-tone');
    }

    function invalid(message) {
      input.setAttribute('aria-invalid', 'true');
      show(message, 'error');
      input.focus();
    }

    input.addEventListener('input', () => {
      if (input.getAttribute('aria-invalid') === 'true') {
        input.removeAttribute('aria-invalid');
        show('');
      }
    });

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending) return;

      const raw = input.value.trim();
      if (!raw) return invalid(MESSAGES.empty);
      const email = normalizeEmail(raw);
      if (!email) return invalid(MESSAGES.invalid);

      sending = true;
      input.removeAttribute('aria-invalid');
      button.setAttribute('aria-busy', 'true');
      label.textContent = MESSAGES.sending;
      show('');

      let outcome = 'failed';
      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, page: PAGE, source, website: trap ? trap.value : '' }),
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
        });
        if (response.ok) outcome = 'ok';
        else if (response.status === 429) outcome = 'limited';
        else if (response.status === 400) outcome = 'invalid';
      } catch (error) {
        outcome = 'failed';
      }

      sending = false;
      button.removeAttribute('aria-busy');
      label.textContent = 'Noriu idėjų';

      if (outcome === 'ok') {
        form.hidden = true;
        done.hidden = false;
        done.focus();
        return;
      }
      if (outcome === 'invalid') return invalid(MESSAGES.invalid);
      show(MESSAGES[outcome], 'error');
    });
  }

  const form = document.querySelector('[data-signup]');
  if (form) bind(form);

  window.__lavijuSignup = { normalizeEmail, sourceHint };
})();
