import * as THREE from './three.js';
import { clamp, damp, ease, lerp } from './math.js';

// Camera rig: a constrained orbit around the island with damping, zoom towards
// the cursor, a gentle idle drift and scripted flights to the hotspots.

const ROTATE_SPEED = 0.0052;
const AZIMUTH_RANGE = 0.95;
const POLAR_MIN = 0.52;
const POLAR_MAX = 1.3;
const ZOOM_MIN = 0.26; // closest distance, as a share of the overview distance
const ZOOM_MAX = 1.06;
const PAN_RADIUS = 13.5;
const ROOM_MAX = 1.4; // how much further back the overview may stand to fit the room it is given
const FOOT = 0.05; // the cliff under the near rim, as a share of the island's height on the screen

const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

export function createRig(camera, dom, { target, homes, fitPoints, reducedMotion = false, onInteract = () => {} }) {
  const homeTarget = new THREE.Vector3().fromArray(target);
  const size = { w: 1, h: 1 };
  let home = homes.landscape;
  let fit = 60;
  // Where the page leaves the picture less room than the frame has, the
  // overview stands further back than `fit` and is lifted into that room.
  // Closer views keep `fit` for their measure.
  let room = null;
  let overview = fit;
  let lift = 0;

  const view = { az: home.azimuth, pol: home.polar, dist: fit, x: homeTarget.x, y: homeTarget.y, z: homeTarget.z };
  const goal = { ...view };
  const shift = { x: 0, y: 0, gx: 0, gy: 0 };
  const parallax = { x: 0, y: 0, gx: 0, gy: 0 };
  let flight = null;
  let lastInput = -100;
  let now = 0;
  let enabled = true;
  let moved = 0;
  let inputs = 0;

  // ---------- Framing ----------
  function orbitBasis(az, pol) {
    _forward.set(-Math.sin(pol) * Math.sin(az), -Math.cos(pol), -Math.sin(pol) * Math.cos(az));
    _right.set(Math.cos(az), 0, -Math.sin(az));
    _up.crossVectors(_right, _forward);
  }

  // Distance at which every fit point sits inside the frame, with breathing room.
  function fitDistance(az, pol, aspect) {
    orbitBasis(az, pol);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const tanH = tanV * aspect;
    // An upright screen cannot hold the whole island at a size worth looking
    // at, so there the rim may run past the sides while the landmarks stay in
    const upright = clamp((1.05 - aspect) / 0.45, 0, 1);
    const marginH = aspect > 1 ? 0.9 : lerp(0.94, 1.22, upright);
    const marginV = aspect > 1 ? 0.8 : 0.72;
    let best = 1;
    for (const p of fitPoints) {
      _v.copy(p).sub(homeTarget);
      const x = _v.dot(_right);
      const y = _v.dot(_up);
      const z = _v.dot(_forward);
      best = Math.max(best, Math.abs(x) / (tanH * marginH) - z, Math.abs(y) / (tanV * marginV) - z);
    }
    return best;
  }

  // The overview in the room it is given: how far back it has to stand for the
  // island to fit between the top and the bottom of that room, and how far up
  // the picture has to move to sit in the middle of it.
  function fitRoom() {
    overview = fit;
    lift = 0;
    if (!room) return;
    orbitBasis(home.azimuth, home.polar);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const space = Math.max(1, room.bottom - room.top);
    // Where the island begins and ends, in pixels below the middle of the frame
    let top = 0;
    let bottom = 0;
    const measure = () => {
      top = Infinity;
      bottom = -Infinity;
      for (const p of fitPoints) {
        _v.copy(p).sub(homeTarget);
        const y = (-_v.dot(_up) / ((overview + _v.dot(_forward)) * tanV)) * size.h * 0.5;
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
      bottom += (bottom - top) * FOOT;
    };
    measure();
    for (let pass = 0; pass < 4 && bottom - top > space && overview < fit * ROOM_MAX; pass++) {
      overview = Math.min(fit * ROOM_MAX, (overview * (bottom - top)) / space);
      measure();
    }
    // In the middle of its room. A room too low even for the furthest overview
    // keeps the treetops clear, and the foot of the island gives way.
    lift = size.h / 2 + (bottom - top <= space ? (top + bottom) / 2 - (room.top + room.bottom) / 2 : top - room.top);
  }

  const atHome = () => Math.abs(goal.dist - overview) < 0.01 && Math.abs(goal.az - home.azimuth) < 0.001;

  // The room the page leaves the overview, from `top` to `bottom` in CSS
  // pixels down the frame; called with nothing, it is the whole of the frame.
  function setRoom(top = null, bottom = null) {
    const next = top == null ? null : { top, bottom };
    if (next?.top === room?.top && next?.bottom === room?.bottom) return;
    const wasHome = atHome();
    room = next;
    fitRoom();
    if (wasHome) goal.dist = overview;
  }

  function resize(width, height) {
    const wasHome = atHome();
    size.w = width;
    size.h = height;
    const aspect = width / height;
    // Blend the home view between the landscape and the portrait framing
    const k = clamp((1.25 - aspect) / 0.6, 0, 1);
    home = {
      azimuth: lerp(homes.landscape.azimuth, homes.portrait.azimuth, k),
      polar: lerp(homes.landscape.polar, homes.portrait.polar, k),
    };
    fit = fitDistance(home.azimuth, home.polar, aspect);
    fitRoom();
    camera.aspect = aspect;
    if (wasHome || !flight) {
      if (wasHome) {
        goal.az = home.azimuth;
        goal.pol = home.polar;
        goal.dist = overview;
      } else {
        goal.dist = clamp(goal.dist, fit * ZOOM_MIN, overview * ZOOM_MAX);
      }
    }
    applyCamera(0);
  }

  // The way into the sky at a spot of the overview as it sits on the page:
  // across and up from the middle of the frame, each -1..1 at its edges.
  function skyAt(x, y, out) {
    orbitBasis(home.azimuth, home.polar);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    // The overview is lifted into its room, and the sky behind it with it
    const up = y - (2 * lift) / size.h;
    return out
      .copy(_forward)
      .addScaledVector(_right, x * tanV * (size.w / size.h))
      .addScaledVector(_up, up * tanV)
      .normalize();
  }

  // ---------- Limits ----------
  function constrain(g) {
    g.az = clamp(g.az, home.azimuth - AZIMUTH_RANGE, home.azimuth + AZIMUTH_RANGE);
    g.pol = clamp(g.pol, POLAR_MIN, POLAR_MAX);
    g.dist = clamp(g.dist, fit * ZOOM_MIN, overview * ZOOM_MAX);
    // The closer the camera, the further the target may wander from the centre
    const reach = PAN_RADIUS * clamp(1.18 - g.dist / fit, 0, 1);
    const dx = g.x - homeTarget.x;
    const dz = g.z - homeTarget.z;
    const d = Math.hypot(dx, dz * 1.3);
    if (d > reach) {
      const k = reach / (d || 1);
      g.x = homeTarget.x + dx * k;
      g.z = homeTarget.z + dz * k;
    }
    // High enough for a flight to reach the stork's nest on its pole
    g.y = clamp(g.y, 0.2, 6.2);
  }

  // ---------- Input ----------
  const pointers = new Map();
  let pinch = 0;
  let pinchMid = null;

  function touch() {
    lastInput = now;
    if (flight) {
      flight = null;
      Object.assign(goal, view);
    }
    onInteract();
  }

  function groundPoint(clientX, clientY, out) {
    const rect = dom.getBoundingClientRect();
    _ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    _plane.constant = -view.y;
    return _ray.ray.intersectPlane(_plane, out);
  }

  function pan(dx, dy) {
    // Drag the ground: a pixel moves the target by what a pixel covers there
    const perPixel = (2 * view.dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / size.h;
    orbitBasis(view.az, view.pol);
    const fx = -Math.sin(view.az);
    const fz = -Math.cos(view.az);
    goal.x -= _right.x * dx * perPixel - fx * dy * perPixel * 1.25;
    goal.z -= _right.z * dx * perPixel - fz * dy * perPixel * 1.25;
  }

  function zoomAt(factor, clientX, clientY) {
    const before = goal.dist;
    goal.dist = clamp(goal.dist * factor, fit * ZOOM_MIN, overview * ZOOM_MAX);
    const applied = goal.dist / before;
    if (applied < 1 && groundPoint(clientX, clientY, _hit)) {
      // Zooming in pulls the target towards what is under the cursor
      goal.x = _hit.x + (goal.x - _hit.x) * applied;
      goal.z = _hit.z + (goal.z - _hit.z) * applied;
    } else if (applied > 1) {
      // Zooming out eases back to the middle of the island
      const k = clamp((goal.dist / fit - 0.5) / 0.5, 0, 1) * 0.35;
      goal.x = lerp(goal.x, homeTarget.x, k);
      goal.y = lerp(goal.y, homeTarget.y, k);
      goal.z = lerp(goal.z, homeTarget.z, k);
    }
    constrain(goal);
  }

  function onPointerDown(e) {
    if (!enabled) return;
    if (e.pointerType === 'mouse' && e.button > 2) return;
    dom.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, button: e.button, shift: e.shiftKey });
    moved = 0;
    pinch = 0;
    pinchMid = null;
    dom.classList.add('is-grabbing');
    touch();
  }

  function onPointerMove(e) {
    if (e.pointerType === 'mouse' && !pointers.size) {
      const rect = dom.getBoundingClientRect();
      parallax.gx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      parallax.gy = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      return;
    }
    const p = pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastInput = now;
    inputs += 1;

    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch > 0 && pinchMid) {
        zoomAt(pinch / Math.max(d, 1), mid.x, mid.y);
        pan(mid.x - pinchMid.x, mid.y - pinchMid.y);
      }
      pinch = d;
      pinchMid = mid;
    } else if (p.button === 2 || p.button === 1 || p.shift) {
      pan(dx, dy);
    } else {
      goal.az -= dx * ROTATE_SPEED;
      goal.pol -= dy * ROTATE_SPEED * 0.8;
    }
    constrain(goal);
  }

  function onPointerUp(e) {
    pointers.delete(e.pointerId);
    pinch = 0;
    pinchMid = null;
    if (!pointers.size) dom.classList.remove('is-grabbing');
  }

  function onWheel(e) {
    if (!enabled) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 32 : e.deltaY;
    touch();
    inputs += 1;
    zoomAt(Math.exp(clamp(delta, -240, 240) * 0.0014), e.clientX, e.clientY);
  }

  dom.addEventListener('pointerdown', onPointerDown);
  dom.addEventListener('pointermove', onPointerMove);
  dom.addEventListener('pointerup', onPointerUp);
  dom.addEventListener('pointercancel', onPointerUp);
  dom.addEventListener('pointerleave', () => {
    parallax.gx = 0;
    parallax.gy = 0;
  });
  dom.addEventListener('wheel', onWheel, { passive: false });
  dom.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Scripted moves ----------
  function flyTo(to, duration = 1.5) {
    const end = { ...goal, ...to };
    constrain(end);
    if (reducedMotion || duration <= 0) {
      Object.assign(view, end);
      Object.assign(goal, end);
      flight = null;
      return;
    }
    flight = { from: { ...view }, to: end, t: 0, duration };
    Object.assign(goal, end);
  }

  function goHome(duration = 1.6) {
    flyTo({ az: home.azimuth, pol: home.polar, dist: overview, x: homeTarget.x, y: homeTarget.y, z: homeTarget.z }, duration);
  }

  // Look at a point from a given direction; distance is a share of the overview.
  function focus(point, { azimuth, polar, zoom = 0.42 } = {}, duration = 1.6) {
    flyTo(
      {
        x: point.x,
        y: point.y,
        z: point.z,
        az: azimuth ?? clamp(view.az, home.azimuth - 0.5, home.azimuth + 0.5),
        pol: polar ?? 1.0,
        dist: fit * zoom,
      },
      duration
    );
  }

  function intro() {
    if (reducedMotion) return goHome(0);
    Object.assign(view, {
      az: home.azimuth - 0.62,
      pol: home.polar - 0.2,
      dist: overview * 1.5,
      x: homeTarget.x,
      y: homeTarget.y + 1.2,
      z: homeTarget.z,
    });
    flight = {
      from: { ...view },
      to: { az: home.azimuth, pol: home.polar, dist: overview, x: homeTarget.x, y: homeTarget.y, z: homeTarget.z },
      t: 0,
      duration: 3.6,
      easing: ease.outQuart,
    };
    Object.assign(goal, flight.to);
  }

  // Slide the picture aside to make room for the title or the card (CSS
  // pixels; positive values move it left and up).
  function setShift(x, y, immediate = false) {
    shift.gx = x;
    shift.gy = y;
    if (immediate || reducedMotion) {
      shift.x = x;
      shift.y = y;
    }
  }

  // ---------- Per frame ----------
  function applyCamera(drift) {
    const az = view.az + drift + parallax.x * 0.022;
    const pol = clamp(view.pol + parallax.y * 0.012, 0.3, 1.45);
    const sp = Math.sin(pol);
    camera.position.set(view.x + view.dist * sp * Math.sin(az), view.y + view.dist * Math.cos(pol), view.z + view.dist * sp * Math.cos(az));
    camera.lookAt(view.x, view.y, view.z);
    camera.near = Math.max(1, view.dist - 34);
    camera.far = view.dist + 150;
    if (Math.abs(shift.x) > 0.5 || Math.abs(shift.y) > 0.5) camera.setViewOffset(size.w, size.h, shift.x, shift.y, size.w, size.h);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  function update(dt, time) {
    now = time;
    if (flight) {
      flight.t = Math.min(1, flight.t + dt / flight.duration);
      const k = (flight.easing || ease.inOutCubic)(flight.t);
      for (const key of Object.keys(view)) view[key] = lerp(flight.from[key], flight.to[key], k);
      if (flight.t >= 1) flight = null;
    } else {
      const lambda = pointers.size ? 14 : 6.5;
      for (const key of Object.keys(view)) view[key] = damp(view[key], goal[key], lambda, dt);
    }

    shift.x = damp(shift.x, shift.gx, 5, dt);
    shift.y = damp(shift.y, shift.gy, 5, dt);
    parallax.x = damp(parallax.x, reducedMotion ? 0 : parallax.gx, 2.5, dt);
    parallax.y = damp(parallax.y, reducedMotion ? 0 : parallax.gy, 2.5, dt);

    // After a quiet moment the camera breathes a little
    const idle = reducedMotion ? 0 : clamp((time - lastInput - 3.5) / 4, 0, 1);
    const drift = Math.sin(time * 0.11) * 0.035 * idle;
    applyCamera(drift);
  }

  return {
    update,
    resize,
    flyTo,
    focus,
    goHome,
    intro,
    setShift,
    setRoom,
    skyAt,
    get view() {
      return view;
    },
    get fit() {
      return fit;
    },
    // How far back the overview stands, and how far up it sits in its room
    get overview() {
      return overview;
    },
    get lift() {
      return lift;
    },
    get home() {
      return home;
    },
    get zoom() {
      return view.dist / fit;
    },
    get flying() {
      return !!flight;
    },
    get dragged() {
      return moved > 6;
    },
    // Grows every time the visitor turns, pans or zooms the view by hand
    get inputs() {
      return inputs;
    },
    get isHome() {
      return (
        Math.abs(goal.dist - overview) < overview * 0.02 &&
        Math.abs(goal.az - home.azimuth) < 0.03 &&
        Math.abs(goal.pol - home.polar) < 0.03 &&
        Math.hypot(goal.x - homeTarget.x, goal.z - homeTarget.z) < 0.3
      );
    },
    set enabled(v) {
      enabled = v;
    },
  };
}
