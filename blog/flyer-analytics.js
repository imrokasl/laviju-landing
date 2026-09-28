(function () {
  'use strict';

  // Only the flyer URL is counted. Ordinary blog visits are excluded.
  if (new URLSearchParams(window.location.search).get('src') !== 'flyer') return;

  // An opening is recorded when the browser actually loads the page. The
  // request contains no visitor identifiers and stores no browser state.
  fetch('https://hfmwcmgoduvhmmjiyteh.supabase.co/functions/v1/track-blog-flyer', {
    method: 'POST',
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    keepalive: true,
  }).catch(function () {
    // Analytics must never interrupt reading the blog.
  });
})();
