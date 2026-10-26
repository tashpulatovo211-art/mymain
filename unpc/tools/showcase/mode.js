/* UNPC chamber showcase mode (design-to-motion, SHOWCASE context). Scratch only: it never ships with the site.

   It runs inside the REAL build (build/index.html), so every frame is the site's own rendering. It is injected:
   - by capture.js through page.addInitScript (window.__SHOWCASE = { mode: "capture" }), or
   - by preview.html into a same-origin iframe of the build (mode "loop" or "still").

   What it does:
   - hides the nav bar, the hero's two actions and the skip link (visibility only, so no layout moves);
   - drives the story's u from a clock instead of the reader's scroll: u(t) is the timeline below, turned into a
     scroll target (rounded to 3 CSS px, which is 4 device px at the capture's device scale of 4/3);
   - capture: no clock of its own. capture.js steps Playwright's fake clock and calls __start(), __tick(dt) and reads
     __lt (skill C1). Trusted scroll events are stopped (their arrival time is not deterministic) and a synthetic
     scroll event is sent in the same task as each scroll, so the story's listener always sees it at the same time.
   - loop (preview only): the same timeline on requestAnimationFrame, with the dissolve done as the opacity of the pin.
   - still: the rest frame, u 5.92. */
(function () {
  "use strict";
  if (window.__showcaseMode) return;
  window.__showcaseMode = true;
  const CFG = window.__SHOWCASE || {};
  const MODE = CFG.mode || "capture";

  /* ---------------- Timeline (seconds) ---------------- */
  // Cycle 27.2 s: build-in 0 to 1.52 at u 0 (the site's own roll call and hero copy), the headline holds, then five
  // moves, each followed by a short hold (1.45 to 1.7 s) so its step title reads. The last hold runs to 26.2, the
  // dissolve to the empty state is 26.2 to 26.7 (opacity, 0.5 s; done on the PNG frames in capture), then the empty
  // state to 27.2.
  //
  // Time goes only to what is seen. story.js draws nothing different inside these u bands (checked against its code,
  // segment(), updateDom(), computeSheet() and the label fades, and against the first capture's frames):
  //   0 to 0.30 (the hero), 1.10 to 1.40 (the crowd; its drift runs on time, not u), 2.20 to 2.50 (the rooms),
  //   3.30 to 3.42 (the score chamber and its labels), 4.50 to 4.80 (the written page), 5.85 to 5.92 (the rest frame).
  // So each move covers only its visible band, and during the hold before it u steps across the static band in one
  // frame (`jump`, 0.35 s after the previous move lands, so the story's own smoothing of u has settled long before the
  // move starts). Jump targets and move ends sit 0.003 inside the static band, beyond the 3 px scroll rounding.
  //
  // A move is a list of [time, u] marks: its two ends, and between them the edges of the bands the story draws (named
  // below), so each band gets the time it needs to read. Within a band u runs at a steady speed. Band edges blend over
  // 0.2 s either side (smoothstep), and the move eases in and out over its first and last 0.8 s (or 60% of a shorter
  // end band) with --io's own speed profile (its speed rises from zero exactly as io's does up to io's middle). The
  // band speeds are then corrected until every band edge is passed at its mark (to well under a frame), so the speed
  // is continuous, starts and ends at zero, and has no surges.
  const TL = {
    cycle: 27.2,
    build: 1.52,
    dissolve: [26.2, 26.7],
    rest: 5.92,
    ramp: 0.8,
    blend: 0.2,
    moves: [
      // 1. hero to crowd (3.25 s): the hero copy and the well fade (u 0.30 to 0.40, 1.25 s, so the fade itself reads for
      //    about 0.9 s after the ease-in), the chamber glides out of the hero while the stepper arrives (0.33 to 0.62,
      //    0.8 s), a short beat (0.62 to 0.70, 0.1 s), the chamber becomes the crowd (0.70 to 1.10, 1.1 s)
      { jump: 2.2, keys: [[2.9, 0.297], [4.15, 0.4], [4.95, 0.62], [5.05, 0.7], [6.15, 1.103]] },
      // 2. crowd to rooms (2.25 s, 1.40 to 2.20): the crowd splits into rooms; most of what moves on screen sits in 1.45
      //    to 2.00 (measured on the frames), which gets 1.35 s; step 2 takes over at 1.80; the rooms settle and their
      //    outlines draw (1.90 to 2.20)
      { jump: 6.5, keys: [[7.65, 1.397], [8.1, 1.45], [9.45, 2.0], [9.9, 2.203]] },
      // 3. rooms to the score chamber (2.5 s, 2.50 to 3.30): the rooms go and the sectors form; most of what moves sits
      //    in 2.62 to 3.13 (measured), which gets 1.5 s; step 3 takes over at 2.90; the sectors settle and their labels
      //    come up (3.10 to 3.30)
      { jump: 10.25, keys: [[11.45, 2.497], [11.95, 2.62], [13.45, 3.13], [13.95, 3.303]] },
      // 4. seats to ink (4.4 s): the sector labels go (3.42 to 3.58, 0.5 s), the sheet arrives (3.60 to 3.75, 0.5 s),
      //    the seats fly onto its lines (from 3.60, 0.8 s to 4.05), step 4 takes over at 3.95, and the handwriting
      //    replaces them line by line (4.05 to 4.50, 2.6 s, the slowest band of the loop)
      { jump: 14.3, keys: [[15.5, 3.417], [16.0, 3.6], [16.5, 3.75], [17.3, 4.05], [19.9, 4.503]] },
      // 5. fold and flight (3.15 s): the sheet tilts (4.80 to 4.92, 0.45 s), folds in two flaps (4.88 to 5.20, 0.95 s),
      //    flies into the well (5.18 to 5.50, 0.85 s), and the Oliy Majlis fills azure (5.40 to 5.85, 0.9 s)
      { jump: 20.25, keys: [[21.35, 4.797], [21.8, 4.88], [22.75, 5.2], [23.6, 5.5], [24.5, 5.853]] }
    ],
    // after the last move: across the rest band to the rest frame, which then holds to the dissolve (1.7 s)
    restJump: 24.85
  };

  // --io: cubic-bezier(0.65, 0, 0.35, 1), solved exactly (Newton, then bisection)
  function bezier(x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t;
    const sy = (t) => ((ay * t + by) * t + cy) * t;
    const dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) {
        const e = sx(t) - x;
        if (Math.abs(e) < 1e-9) return sy(t);
        const d = dx(t);
        if (Math.abs(d) < 1e-7) break;
        t -= e / d;
      }
      let lo = 0, hi = 1;
      t = x;
      for (let i = 0; i < 60; i++) {
        const v = sx(t);
        if (Math.abs(v - x) < 1e-10) break;
        if (v < x) lo = t; else hi = t;
        t = (lo + hi) / 2;
      }
      return sy(t);
    };
  }
  const io = bezier(0.65, 0, 0.35, 1);

  // io's speed at x (dy/dx of the bezier), for the moves' ease-in and ease-out
  const ioSpeed = (() => {
    const x1 = 0.65, y1 = 0, x2 = 0.35, y2 = 1;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    return (x) => {
      let lo = 0, hi = 1;
      for (let i = 0; i < 60; i++) {
        const m = (lo + hi) / 2;
        if (((ax * m + bx) * m + cx) * m < x) lo = m; else hi = m;
      }
      const t = (lo + hi) / 2;
      return ((3 * ay * t + 2 * by) * t + cy) / ((3 * ax * t + 2 * bx) * t + cx);
    };
  })();
  const IO_PEAK = ioSpeed(0.5);
  const sstep = (a, b, x) => {
    const k = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return k * k * (3 - 2 * k);
  };
  // A move's u, tabulated per millisecond of its time (see the timeline note above).
  function buildMove({ jump, keys }) {
    const s = keys[0][0], e = keys[keys.length - 1][0];
    const n = Math.round((e - s) * 1000);
    const nb = keys.length - 1;
    const tk = keys.map(([t]) => t), uk = keys.map(([, u]) => u);
    const du = [], v = [];
    for (let k = 0; k < nb; k++) {
      du.push(uk[k + 1] - uk[k]);
      v.push((uk[k + 1] - uk[k]) / (tk[k + 1] - tk[k]));
    }
    // the ease-in and ease-out: up to TL.ramp, and at most 60% of the first or last band, so a short end band is
    // not pushed to run faster than its neighbour to make up for its ramp
    const Ri = Math.min(TL.ramp, 0.6 * (tk[1] - tk[0])), Ro = Math.min(TL.ramp, 0.6 * (tk[nb] - tk[nb - 1]));
    const B = TL.blend;
    const env = new Float64Array(n + 1), W = [];
    for (let k = 0; k < nb; k++) W.push(new Float64Array(n + 1));
    for (let i = 0; i <= n; i++) {
      const t = s + i / 1000;
      const a = (t - s) / Ri, b = (e - t) / Ro;
      env[i] = (a < 1 ? ioSpeed(a / 2) / IO_PEAK : 1) * (b < 1 ? ioSpeed(b / 2) / IO_PEAK : 1);
      for (let k = 0; k < nb; k++) {
        const lo = k === 0 ? 1 : sstep(tk[k] - B, tk[k] + B, t);
        const hi = k === nb - 1 ? 1 : 1 - sstep(tk[k + 1] - B, tk[k + 1] + B, t);
        W[k][i] = lo * hi;
      }
    }
    const U = new Float64Array(n + 1);
    const integrate = () => {
      let prev = 0;
      U[0] = uk[0];
      for (let i = 0; i <= n; i++) {
        let vel = 0;
        for (let k = 0; k < nb; k++) vel += W[k][i] * v[k];
        vel *= env[i];
        if (i > 0) U[i] = U[i - 1] + ((vel + prev) / 2) * 0.001;
        prev = vel;
      }
    };
    const at = (t) => {
      const x = Math.min(n, Math.max(0, (t - s) * 1000));
      const i = Math.min(n - 1, Math.floor(x));
      return U[i] + (U[i + 1] - U[i]) * (x - i);
    };
    for (let it = 0; it < 80; it++) {
      integrate();
      for (let k = 0; k < nb; k++) {
        const got = at(tk[k + 1]) - at(tk[k]);
        if (got > 1e-9) v[k] *= du[k] / got;
      }
    }
    integrate();
    const k = (uk[nb] - uk[0]) / (U[n] - uk[0]);
    for (let i = 0; i <= n; i++) U[i] = uk[0] + (U[i] - uk[0]) * k;
    return { jump, s, e, u0: uk[0], u1: uk[nb], at };
  }
  const moves = TL.moves.map(buildMove);
  function uAt(t) {
    let u = 0;
    for (const m of moves) {
      if (t < m.jump) return u;
      if (t < m.s) return m.u0;
      if (t < m.e) return m.at(t);
      u = m.u1;
    }
    return t < TL.restJump ? u : TL.rest;
  }
  // the dissolve: opacity of the contents, with --e2 (cubic-bezier(0.33, 1, 0.68, 1)) as the skill's opacity curve
  const e2 = bezier(0.33, 1, 0.68, 1);
  function contentAlpha(t) {
    const [a, b] = TL.dissolve;
    if (t < a) return 1;
    if (t >= b) return 0;
    return 1 - e2((t - a) / (b - a));
  }

  /* ---------------- Page side ---------------- */
  // Stop trusted scroll events: the browser fires them on its own frame clock, not on the fake one, so their timing would
  // differ from run to run. The synthetic event sent with each scroll below is untrusted and passes.
  if (MODE === "capture") {
    window.addEventListener(
      "scroll",
      (e) => {
        if (e.isTrusted) e.stopImmediatePropagation();
      },
      { capture: true }
    );
    document.addEventListener(
      "scroll",
      (e) => {
        if (e.isTrusted) e.stopImmediatePropagation();
      },
      { capture: true }
    );
  }

  const CSS = `
    /* showcase: nothing interactive shows (nav, the hero's two actions, the skip link); visibility only, so nothing moves */
    .nav, .skip, .hero-actions { visibility: hidden !important; }
    /* capture only: keep these composited, so their antialiasing never changes when a neighbour starts to move (skill A6) */
    .stepper, [data-hero] { will-change: transform, opacity; }
    html, body { scrollbar-width: none; }
    html::-webkit-scrollbar { display: none; }
    /* before __start the stage is the bare ground (the empty state, skill B1) */
    html.sc-pre .story-pin > * { visibility: hidden !important; }
    html.sc-pre .story-pin .hero-actions { visibility: hidden !important; }
  ` +
    // optional (capture.js --well hide): no "Next tournament" date in the chamber's well, for an export meant to stay up
    // longer than a week. Off by default: the client decides (the date is baked into every frame otherwise).
    (CFG.hideWell ? ".well { visibility: hidden !important; }\n" : "");
  // At DOMContentLoaded: the init script runs before <html> exists, and the page's pre-paint script sets its classes.
  function addStyle() {
    const s = document.createElement("style");
    s.setAttribute("data-showcase", "");
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
    if (MODE === "capture") document.documentElement.classList.add("sc-pre");
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addStyle);
  else addStyle();

  const story = () => window.UNPCStory;
  let lt = 0; // loop time in seconds, from ltMs
  let ltMs = 0; // whole milliseconds, so 1632 capture frames land exactly on 27.2 s
  let lastY = -1;
  const round3 = (y) => Math.round(y / 3) * 3;
  function scrollToU(u) {
    const y = round3(story().scrollFor(u));
    if (y === lastY && Math.abs(window.scrollY - y) < 0.5) return y;
    lastY = y;
    window.scrollTo(0, y);
    if (MODE === "capture") document.dispatchEvent(new Event("scroll", { bubbles: true }));
    return y;
  }

  // Start a cycle: the reader's place goes to the top, the story is made again (the roll call plays because it opens on
  // the hero), and every CSS animation is restarted fresh: is-intro is taken off and the style flushed first, so the
  // hero copy's keyframes are new objects each cycle.
  function start() {
    const root = document.documentElement;
    const s = document.querySelector("[data-story]");
    lastY = -1;
    window.scrollTo(0, 0);
    if (MODE === "capture") document.dispatchEvent(new Event("scroll", { bubbles: true }));
    s.classList.remove("is-intro");
    void s.offsetWidth;
    story().reinit();
    root.classList.remove("sc-pre");
    void s.offsetWidth;
    lt = 0;
    ltMs = 0;
    window.__lt = 0;
    window.__restarted = true;
    window.__mark = performance.now();
    window.__cycleMark = window.__mark;
    window.__u = 0;
  }
  function tick(dt) {
    // dt in seconds (whole milliseconds in capture): 27.2 s is reached exactly after 1632 frames (sum of the dt steps)
    ltMs += Math.round(dt * 1000);
    lt = ltMs / 1000;
    if (ltMs >= Math.round(TL.cycle * 1000)) {
      start();
      return 0;
    }
    window.__lt = lt;
    const u = uAt(lt);
    window.__u = u;
    scrollToU(u);
    return lt;
  }

  window.__showcase = { TL, uAt, contentAlpha, io, e2, start, tick, scrollToU, mode: MODE };
  window.__start = start;
  window.__tick = tick;
  window.__lt = 0;

  /* ---------------- Preview modes (real time, for a person to watch; not used for the exports) ---------------- */
  if (MODE === "loop" || MODE === "still") {
    const ready = () =>
      new Promise((res) => {
        const go = () => (story() && story().mode === "motion" ? res() : setTimeout(go, 50));
        go();
      });
    const run = async () => {
      await ready();
      if (document.fonts) await document.fonts.ready;
      const pin = document.querySelector(".story-pin");
      if (MODE === "still") {
        scrollToU(TL.rest);
        return;
      }
      start();
      let prev = performance.now();
      const loop = (now) => {
        const dt = Math.min(0.05, (now - prev) / 1000);
        prev = now;
        const before = lt;
        tick(dt);
        if (lt < before) pin.style.opacity = "";
        const a = contentAlpha(lt);
        pin.style.opacity = a < 1 ? String(a) : "";
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    };
    if (document.readyState === "complete") run();
    else window.addEventListener("load", run);
  }
})();
