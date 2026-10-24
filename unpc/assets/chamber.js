/* UNPC chamber core.
   Seat geometry and static drawing, shared by the story (story.js), the Team and Partners
   figures (pages.js) and the Next block bookend (site.js). Ported from the Hemicycle prototype.
   Colours are read from the CSS tokens in style.css, never hard-coded.
   Exposed as window.UNPCChamber. Classic script, no dependencies. */
(function () {
  "use strict";

  const N = 520;
  const Q = 0.42; // inner radius of the chamber, as a share of the outer radius
  const RUBRIC = [15, 20, 20, 15, 15, 15];
  const SVGNS = "http://www.w3.org/2000/svg";

  /* ---------- Small maths ---------- */

  const clamp = (v, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (a, b, x) => {
    const t = clamp((x - a) / (b - a));
    return t * t * (3 - 2 * t);
  };
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeIn = (t) => t * t * t;
  const angLerp = (a, b, t) => {
    let d = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
    if (d < -Math.PI) d += 2 * Math.PI;
    return a + d * t;
  };

  /* Seeded random (mulberry32), so drawings are the same for everyone. */
  function rng(seed) {
    return function () {
      seed |= 0;
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /* ---------- Geometry ---------- */

  /* Seats of a hemicycle in unit space: outer radius 1, centre of the floor at 0,0, y pointing down.
     Rows are chosen so that seats sit as far apart along the arc as the rows sit apart.
     Returns { list: [{r, th, row}], rows, pitch }, sorted by angle from the left (th = PI) to the right. */
  const seatCache = new Map();
  function seats(n, q = Q) {
    const key = n + ":" + q;
    if (seatCache.has(key)) return seatCache.get(key);
    const k = (2 * n * (1 - q)) / (Math.PI * (1 + q));
    const rows = Math.max(2, Math.round((1 + Math.sqrt(1 + 4 * k)) / 2));
    const radii = [];
    let sum = 0;
    for (let j = 0; j < rows; j++) {
      const r = q + ((1 - q) * j) / (rows - 1);
      radii.push(r);
      sum += r;
    }
    const exact = radii.map((r) => (n * r) / sum);
    const count = exact.map(Math.floor);
    const rem = n - count.reduce((a, b) => a + b, 0);
    exact
      .map((c, i) => [c - count[i], i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, rem)
      .forEach(([, i]) => count[i]++);
    const list = [];
    for (let j = 0; j < rows; j++) {
      const m = count[j];
      for (let s = 0; s < m; s++) {
        const th = m === 1 ? Math.PI / 2 : Math.PI * (1 - s / (m - 1));
        list.push({ r: radii[j], th, row: j });
      }
    }
    list.sort((a, b) => b.th - a.th || a.row - b.row);
    const out = { list, rows, pitch: (1 - q) / (rows - 1) };
    seatCache.set(key, out);
    return out;
  }

  // Seats shared out among parties (here: score criteria) by angle, the way parliament charts do it.
  function sectorOf(rank, counts) {
    let acc = 0;
    for (let s = 0; s < counts.length; s++) {
      acc += counts[s];
      if (rank < acc) return s;
    }
    return counts.length - 1;
  }
  // Largest-remainder split of n seats by weights.
  function scaleCounts(weights, n) {
    const total = weights.reduce((a, b) => a + b, 0);
    const exact = weights.map((w) => (w * n) / total);
    const c = exact.map(Math.floor);
    const rem = n - c.reduce((a, b) => a + b, 0);
    exact
      .map((e, i) => [e - c[i], i])
      .sort((a, b) => b[0] - a[0])
      .slice(0, rem)
      .forEach(([, i]) => c[i]++);
    return c;
  }

  // Offset of member `slot` in a team cluster of 3 or 4, with spacing s.
  function clusterOffset(size, slot, s) {
    if (size === 4) {
      const ox = slot % 2 ? 0.5 : -0.5;
      const oy = slot < 2 ? -0.5 : 0.5;
      return [ox * s, oy * s];
    }
    const pts = [
      [0, -0.56],
      [-0.5, 0.3],
      [0.5, 0.3]
    ];
    return [pts[slot][0] * s, pts[slot][1] * s];
  }
  // The grid of n cells of the given aspect (w / h) that gives the biggest cells inside w x h.
  function bestGrid(n, w, h, aspect, evenOnly) {
    let best = null;
    for (let cols = 1; cols <= n; cols++) {
      if (evenOnly && cols % 2) continue;
      const rows = Math.ceil(n / cols);
      const cw = Math.min(w / cols, (h / rows) * aspect);
      const waste = cols * rows - n;
      const score = cw - waste * 0.02 * cw;
      if (!best || score > best.score) best = { cols, rows, cw, ch: cw / aspect, score };
    }
    return best;
  }

  /* A formation: per dot x, y, size s (stroke width), elongation e (length / size), orientation o (radians,
     counter-clockwise, 0 = pointing right), colour index c (see C below) and alpha a. */
  function makeF(n = N) {
    const a = new Float32Array(n);
    a.fill(1);
    return {
      n,
      x: new Float32Array(n),
      y: new Float32Array(n),
      s: new Float32Array(n),
      e: new Float32Array(n),
      o: new Float32Array(n),
      c: new Uint8Array(n),
      a
    };
  }

  /* A chamber formation, ready to draw.
     opts: { n = 520, q = Q, cx, cy, R, sizeK = 0.36 (capsule width as a share of pitch * R), e = 0.6,
             color = C.seat, weights (optional array: seats split into sectors by angle), gap (radians between
             sectors), colors (colour index per sector), order (optional array: order[rank] = dot id) }
     Returns the formation plus { unit, sector (Int8Array per dot), rank (per dot), sectors: [{a0, a1, mid, count}], cx, cy, R, q, pitch }. */
  function chamber(opts = {}) {
    const n = opts.n || N;
    const q = opts.q == null ? Q : opts.q;
    const R = opts.R;
    const cx = opts.cx;
    const cy = opts.cy;
    const unit = seats(n, q);
    const f = makeF(n);
    const size = unit.pitch * R * (opts.sizeK == null ? 0.36 : opts.sizeK);
    const weights = opts.weights || null;
    const gap = opts.gap || 0;
    const counts = weights ? scaleCounts(weights, n) : null;
    const k = weights ? (Math.PI - gap * (weights.length - 1)) / Math.PI : 1;
    const sector = new Int8Array(n);
    const rank = new Int16Array(n);
    const sectors = weights ? weights.map((w, i) => ({ a0: Infinity, a1: -Infinity, mid: 0, count: counts[i] })) : [];
    const order = opts.order || null;
    for (let r = 0; r < n; r++) {
      const id = order ? order[r] : r;
      const st = unit.list[r];
      const sec = counts ? sectorOf(r, counts) : 0;
      const th = counts ? Math.PI - ((Math.PI - st.th) * k + sec * gap) : st.th;
      f.x[id] = cx + Math.cos(th) * st.r * R;
      f.y[id] = cy - Math.sin(th) * st.r * R;
      f.s[id] = size;
      f.e[id] = opts.e == null ? 0.6 : opts.e;
      f.o[id] = th;
      f.c[id] = counts && opts.colors ? opts.colors[sec] : opts.color == null ? C.seat : opts.color;
      sector[id] = sec;
      rank[id] = r;
      if (counts) {
        const S = sectors[sec];
        if (th < S.a0) S.a0 = th;
        if (th > S.a1) S.a1 = th;
      }
    }
    sectors.forEach((S) => (S.mid = (S.a0 + S.a1) / 2));
    return Object.assign(f, { unit, sector, rank, sectors, cx, cy, R, q, pitch: unit.pitch, size });
  }

  // Fit a chamber of outer radius R into a w x h box with padding: returns { cx, cy, R }.
  function fitChamber(w, h, pad = 0, labelRoom = 0) {
    const R = Math.max(1, Math.min((w - pad * 2 - labelRoom * 2) / 2, h - pad * 2 - labelRoom));
    return { cx: w / 2, cy: h - pad - (h - pad * 2 - labelRoom - R) / 2, R };
  }

  /* ---------- Palette ---------- */

  // Colour indices used by formations (f.c).
  const C = { seat: 0, azure: 1, faint: 2, green: 3, rub0: 4, rub1: 5, rub2: 6, rub3: 7, rub4: 8, rub5: 9, ink: 10, ink2: 11, ink3: 12, line: 13, lineStrong: 14, paper: 15, red: 16 };
  const COLOR_VARS = [
    "--seat",
    "--fill-azure",
    "--seat-faint",
    "--fill-green",
    "--rub-0",
    "--rub-1",
    "--rub-2",
    "--rub-3",
    "--rub-4",
    "--rub-5",
    "--ink",
    "--ink-2",
    "--ink-3",
    "--line",
    "--line-strong",
    "--paper",
    "--red"
  ];
  const FALLBACK = ["#6b7d86", "#0099b5", "#cbd6da", "#1e9e3a", "#08505f", "#0a6d81", "#0e8aa2", "#33a7be", "#6ac2d3", "#a2d9e4", "#13212a", "#4a5a62", "#5e6d74", "#dbe3e5", "#c3ced2", "#ffffff", "#ce1126"];
  const palette = {
    rgb: [],
    str: [],
    // named strings
    seat: "",
    azure: "",
    faint: "",
    green: "",
    ink: "",
    ink2: "",
    ink3: "",
    line: "", // --line-strong (room outlines)
    lineSoft: "", // --line
    surface: "",
    paper: "",
    ground: "",
    wash: "",
    planLn: "",
    red: "",
    sheetTint: [1, 1, 1], // what the white of the WebGL paper is multiplied by, 0..1 per channel (--sheet-tint)
    dark: false,
    cache: new Map()
  };
  function hexToRgb(h) {
    h = String(h || "").trim();
    if (!h) return [136, 136, 136];
    if (h.startsWith("rgb")) return h.match(/[\d.]+/g).slice(0, 3).map(Number);
    if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
    const n = parseInt(h.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function readPalette() {
    const cs = getComputedStyle(document.documentElement);
    const get = (v, fb) => (cs.getPropertyValue(v) || "").trim() || fb;
    palette.rgb = COLOR_VARS.map((v, i) => hexToRgb(get(v, FALLBACK[i])));
    palette.str = palette.rgb.map((c) => "rgb(" + c.join(",") + ")");
    palette.seat = palette.str[C.seat];
    palette.azure = palette.str[C.azure];
    palette.faint = palette.str[C.faint];
    palette.green = palette.str[C.green];
    palette.ink = palette.str[C.ink];
    palette.ink2 = palette.str[C.ink2];
    palette.ink3 = palette.str[C.ink3];
    palette.line = palette.str[C.lineStrong];
    palette.lineSoft = palette.str[C.line];
    palette.paper = palette.str[C.paper];
    palette.red = palette.str[C.red];
    palette.surface = get("--surface", "#ffffff");
    palette.ground = get("--ground", "#f6f8f8");
    palette.wash = get("--wash", "#edf2f3");
    palette.planLn = get("--plan-ln", "#9fb0b7");
    {
      const t = get("--sheet-tint", "#ffffff");
      const n = Number(t);
      palette.sheetTint = isFinite(n) && t !== "" ? [n, n, n] : hexToRgb(t).map((c) => c / 255);
    }
    palette.dark = get("color-scheme", "light").indexOf("dark") > -1;
    palette.cache.clear();
    return palette;
  }
  // Colour between palette indices a and b at t (0..1), quantised to 16 steps and cached.
  function mix(a, b, t) {
    if (a === b || t <= 0) return palette.str[a];
    if (t >= 1) return palette.str[b];
    const step = Math.round(t * 16);
    const key = a * 4096 + b * 32 + step;
    let s = palette.cache.get(key);
    if (!s) {
      const A = palette.rgb[a];
      const B = palette.rgb[b];
      const k = step / 16;
      s = "rgb(" + Math.round(lerp(A[0], B[0], k)) + "," + Math.round(lerp(A[1], B[1], k)) + "," + Math.round(lerp(A[2], B[2], k)) + ")";
      palette.cache.set(key, s);
    }
    return s;
  }

  /* ---------- Drawing ---------- */

  // A seat: a round-capped stroke of width `size` and length `len`, at angle `ang`.
  function capsule(ctx, x, y, size, len, ang, color) {
    const h = Math.max(0.01, len / 2);
    const dx = Math.cos(ang) * h;
    const dy = -Math.sin(ang) * h;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
  }

  // Size a canvas to w x h CSS px with DPR capped at 2. Returns its 2D context in CSS px units.
  function sizeCanvas(canvas, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.max(1, Math.round(w * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    return ctx;
  }

  // Draw every dot of a formation. opts: { alpha (global multiplier), scale (size multiplier), color (index override) }
  function drawFormation(ctx, f, opts = {}) {
    const n = f.n || f.x.length;
    const ga = opts.alpha == null ? 1 : opts.alpha;
    const k = opts.scale || 1;
    let lastA = -1;
    for (let i = 0; i < n; i++) {
      const a = (f.a ? f.a[i] : 1) * ga;
      if (a <= 0.003) continue;
      if (a !== lastA) {
        ctx.globalAlpha = a;
        lastA = a;
      }
      const s = f.s[i] * k;
      capsule(ctx, f.x[i], f.y[i], s, s * f.e[i], f.o[i], palette.str[opts.color == null ? f.c[i] : opts.color]);
    }
    ctx.globalAlpha = 1;
  }

  /* Builders registered by the story, so static stills can show every formation.
     registerBuild(build, overlay): build(geo) -> { F: [formations], over }, overlay(ctx, over, k, geo). */
  let registeredBuild = null;
  let registeredOverlay = null;
  function registerBuild(build, overlay) {
    registeredBuild = build || null;
    registeredOverlay = overlay || null;
  }

  // The geometry a still uses: a hero chamber fitted into the canvas and a formation box with padding.
  function staticGeometry(w, h) {
    const pad = Math.max(8, w * 0.02);
    const R = Math.min((w - pad * 2) / 2, (h - pad * 2) * 0.98);
    return {
      hero: { cx: w / 2, cy: h - pad - (h - pad * 2 - R) / 2, R },
      box: { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 },
      w,
      h,
      wide: w > 900
    };
  }

  /* A still frame, sized to the canvas's CSS box.
     k: a formation index (0 = the hemicycle works without a registered builder) or a formation object.
     opts: { build, overlay, geometry(w, h) }. Returns { ctx, geo, model } or null when the canvas has no size. */
  function drawStatic(canvas, k, opts = {}) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return null;
    if (!palette.str.length) readPalette();
    const ctx = sizeCanvas(canvas, w, h);
    ctx.clearRect(0, 0, w, h);
    const geo = (opts.geometry || staticGeometry)(w, h);
    let f = null;
    let model = null;
    if (typeof k === "object" && k) f = k;
    else {
      const build = opts.build || registeredBuild;
      if (build) {
        model = build(geo);
        f = model.F[k];
        const overlay = opts.overlay || registeredOverlay;
        if (overlay) overlay(ctx, model.over, k, geo);
      } else if (k === 0) {
        f = chamber({ cx: geo.hero.cx, cy: geo.hero.cy, R: geo.hero.R });
      }
    }
    if (f) drawFormation(ctx, f);
    return { ctx, geo, model };
  }

  /* A static chamber drawn into a canvas, fitted to its CSS box.
     opts: chamber() options (n, q, weights, gap, colors, color, sizeK, e) plus
           pad (px), labelRoom (px kept free around the arc for labels), alpha, colorOf(i, f) -> index, draw(ctx, f) extra.
     Returns the formation (with cx, cy, R, sectors) or null when the canvas has no size. */
  function drawChamber(canvas, opts = {}) {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return null;
    if (!palette.str.length) readPalette();
    const ctx = sizeCanvas(canvas, w, h);
    ctx.clearRect(0, 0, w, h);
    const fit = fitChamber(w, h, opts.pad == null ? 4 : opts.pad, opts.labelRoom || 0);
    const f = chamber(Object.assign({}, opts, fit));
    if (opts.colorOf) for (let i = 0; i < f.n; i++) f.c[i] = opts.colorOf(i, f);
    drawFormation(ctx, f, { alpha: opts.alpha });
    if (opts.draw) opts.draw(ctx, f);
    f.ctx = ctx;
    f.w = w;
    f.h = h;
    return f;
  }

  /* A static chamber as SVG circles, appended to `svg` (an <svg> or <g>). Colours come from CSS classes,
     so it follows the theme with no redraw.
     opts: { n, q, cx, cy, R, rK = 0.25 (circle radius as a share of pitch * R), weights, gap,
             cls(i, seat, sector) -> class string (default "seat"), r(i, seat, base) -> radius,
             attrs(i, seat) -> extra attributes object }
     Returns { circles, unit, sectors }. */
  function chamberSVG(svg, opts = {}) {
    const n = opts.n || 140;
    const q = opts.q == null ? Q : opts.q;
    const unit = seats(n, q);
    const R = opts.R;
    const cx = opts.cx;
    const cy = opts.cy;
    const base = unit.pitch * R * (opts.rK == null ? 0.25 : opts.rK);
    const weights = opts.weights || null;
    const gap = opts.gap || 0;
    const counts = weights ? scaleCounts(weights, n) : null;
    const k = weights ? (Math.PI - gap * (weights.length - 1)) / Math.PI : 1;
    const sectors = weights ? weights.map((w, i) => ({ a0: Infinity, a1: -Infinity, mid: 0, count: counts[i] })) : [];
    const fmt = (v) => (Math.round(v * 100) / 100).toString();
    const frag = document.createDocumentFragment();
    const circles = unit.list.map((st, i) => {
      const sec = counts ? sectorOf(i, counts) : 0;
      const th = counts ? Math.PI - ((Math.PI - st.th) * k + sec * gap) : st.th;
      if (counts) {
        const S = sectors[sec];
        if (th < S.a0) S.a0 = th;
        if (th > S.a1) S.a1 = th;
      }
      const c = document.createElementNS(SVGNS, "circle");
      c.setAttribute("cx", fmt(cx + Math.cos(th) * st.r * R));
      c.setAttribute("cy", fmt(cy - Math.sin(th) * st.r * R));
      c.setAttribute("r", fmt(opts.r ? opts.r(i, st, base) : base));
      c.setAttribute("class", opts.cls ? opts.cls(i, st, sec) : "seat");
      if (opts.attrs) {
        const extra = opts.attrs(i, st, sec) || {};
        for (const key in extra) c.setAttribute(key, extra[key]);
      }
      frag.appendChild(c);
      return c;
    });
    sectors.forEach((S) => (S.mid = (S.a0 + S.a1) / 2));
    svg.appendChild(frag);
    return { circles, unit, sectors, base };
  }

  /* Keep a static drawing fresh: runs fn now, after fonts load, when the theme changes and when el changes width.
     Returns a function that stops it. */
  const redrawers = new Set();
  function autoRedraw(el, fn) {
    let lastW = -1;
    let lastH = -1;
    const run = () => {
      try {
        fn();
      } catch (e) {
        if (window.console) console.error(e);
      }
    };
    redrawers.add(run);
    let ro = null;
    if (el && window.ResizeObserver) {
      ro = new ResizeObserver(() => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (Math.abs(w - lastW) < 1 && Math.abs(h - lastH) < 1) return;
        lastW = w;
        lastH = h;
        run();
      });
      ro.observe(el);
    } else run();
    return () => {
      redrawers.delete(run);
      if (ro) ro.disconnect();
    };
  }
  function redrawAll() {
    readPalette();
    redrawers.forEach((fn) => fn());
  }

  // The palette follows the theme. site.js fires "unpc:theme" on <html> after every change; this listener
  // is added first (chamber.js loads before site.js), so the palette is fresh before anyone else redraws.
  readPalette();
  document.documentElement.addEventListener("unpc:theme", redrawAll);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(redrawAll);

  window.UNPCChamber = {
    N,
    Q,
    RUBRIC,
    C,
    palette,
    // maths
    clamp,
    lerp,
    smooth,
    easeIO,
    easeOut,
    easeIn,
    angLerp,
    rng,
    shuffle,
    // geometry
    seats,
    sectorOf,
    scaleCounts,
    clusterOffset,
    bestGrid,
    makeF,
    chamber,
    fitChamber,
    staticGeometry,
    // colour
    readPalette,
    mix,
    hexToRgb,
    // drawing
    capsule,
    roundRect,
    sizeCanvas,
    drawFormation,
    drawStatic,
    drawChamber,
    chamberSVG,
    registerBuild,
    autoRedraw,
    redrawAll
  };
})();
