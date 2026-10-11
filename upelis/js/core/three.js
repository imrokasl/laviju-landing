// Single entry point for the vendored three.js build, so the rest of the code
// never depends on a CDN or an import map (laviju.lt serves a strict CSP).
export * from '../../vendor/three.module.min.js';
