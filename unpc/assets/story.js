/* UNPC story: the pinned chamber on Home (spec section 5).
   520 seats drawn in Canvas 2D, scrubbed by scroll over 6 viewport heights (u = 0..6):
   the hemicycle (with the roll call, cursor-aware seats and ripples), the students, two teams to a room,
   the score chamber, the written resolution on a WebGL sheet (seats melt into ink, the sheet folds and flies
   into the rostrum), then the Oliy Majlis fills with azure.
   Static story (5.7) for reduced motion, short screens and very narrow screens.
   Uses only the UNPCChamber core (chamber.js) and UNPCPaper (paper.js). Classic defer script; it starts on
   DOMContentLoaded, after paper.js has run. Exposes window.UNPCStory. */
(function () {
  "use strict";

  const doc = document;
  const root = doc.documentElement;
  // Same query as the story rules in style.css: the pinned story needs at least 560px of height and 300px of width,
  // and very narrow phones (340px or less) need 640px of height.
  const MQ = "(min-height: 560px) and (min-width: 300px) and ((min-width: 341px) or (min-height: 640px))";
  const SPAN = 6;
  const HOLD = [0, 1.25, 2.35, 3.45, 4.65, 5.92]; // middle of each step's hold (step 4: the written page, 4.50 to 4.80)
  const DEG = Math.PI / 180;

  function boot() {
    const CH = window.UNPCChamber;
    const story = doc.querySelector("[data-story]");
    if (!CH || !story) return;
    const PAPER = window.UNPCPaper || null;
    const { N, Q, RUBRIC, C, clamp, lerp, smooth, easeIO, easeOut, angLerp, rng, shuffle, seats, scaleCounts, bestGrid, clusterOffset, makeF, chamber, mix, palette } = CH;
    // Seats on the WebGL sheet: --seat, darkened 38% toward --ground in dark mode, because the sheet stays light. In dark
    // mode every seat takes it as the sheet arrives, the ones still beside the sheet too, so it must read on both: about
    // 4:1 on the tinted sheet and 3.4:1 on the dark ground.
    // Kept as an extra palette entry (index 17) so mix() can blend toward it; refreshed whenever the palette is re-read.
    const ON_PAPER = 17;
    let onPaperDark = false;
    function ensureOnPaper(darken) {
      if (palette.rgb.length > ON_PAPER && onPaperDark === darken && palette.str[ON_PAPER]) return;
      const a = palette.rgb[C.seat];
      const g = CH.hexToRgb(palette.ground);
      const k = darken ? 0.38 : 0;
      const rgb = [0, 1, 2].map((j) => Math.round(a[j] + (g[j] - a[j]) * k));
      palette.rgb[ON_PAPER] = rgb;
      palette.str[ON_PAPER] = "rgb(" + rgb.join(",") + ")";
      palette.cache.clear();
      onPaperDark = darken;
    }
    const LW = PAPER ? PAPER.LW : 1024;
    const LH = PAPER ? PAPER.LH : 1448;
    // the baseline of the form's last printed section label (paper.js FORM); f4 marks the seats bound for the lines under it
    const LAST_LABEL_Y = PAPER ? PAPER.FORM.sections[PAPER.FORM.sections.length - 1].y : 1108;
    const $ = (s, r = story) => r.querySelector(s);
    const $$ = (s, r = story) => Array.from(r.querySelectorAll(s));
    const site = () => window.UNPCSite || null;
    const mq = (() => {
      try {
        return window.matchMedia(MQ);
      } catch (e) {
        return { matches: true, addEventListener() {} };
      }
    })();

    /* ================================================================== */
    /* Formations                                                          */
    /* ================================================================== */

    // The draw: team sizes and who goes where, seeded so the page is the same for everyone.
    const TEAMS = (() => {
      const sizes = shuffle([...Array(100).fill(4), ...Array(40).fill(3)], rng(5));
      const perm = shuffle([...Array(N).keys()], rng(9));
      const members = [];
      let p = 0;
      sizes.forEach((sz) => {
        const m = [];
        for (let s = 0; s < sz; s++) m.push(perm[p++]);
        members.push(m);
      });
      return { sizes, members, count: sizes.length };
    })();

    // The crowd: a phyllotaxis disc in unit space (build() assigns its points to the seats).
    let crowdCache = null;
    function crowdUnit() {
      if (crowdCache) return crowdCache;
      const pts = [];
      for (let i = 0; i < N; i++) {
        const r = Math.sqrt((i + 0.5) / N);
        const th = i * 2.39996;
        pts.push([Math.cos(th) * r, Math.sin(th) * r]);
      }
      crowdCache = pts;
      return pts;
    }

    // Written lines of the sheet: { ly, x0, x1, t0, t1 } in texture units. From paper.js when it is there.
    function paperLines() {
      if (PAPER) return PAPER.lines();
      const L = [];
      const add = (ly, x0, x1) => L.push({ ly, x0, x1 });
      add(236, 200, 600);
      add(314, 200, 420);
      add(392, 200, 750);
      [550, 604, 658, 712].forEach((y) => add(y, 104, 880));
      add(766, 104, 560);
      [914, 968].forEach((y) => add(y, 104, 880));
      add(1022, 104, 600);
      add(1170, 104, 880);
      add(1224, 104, 520);
      const tot = L.reduce((a, l) => a + l.x1 - l.x0, 0);
      let acc = 0;
      L.forEach((l) => {
        l.t0 = acc / tot;
        acc += l.x1 - l.x0;
        l.t1 = acc / tot;
      });
      return L;
    }
    const paperRules = () =>
      PAPER
        ? PAPER.rules()
        : paperLines().map((l) => ({ y: l.ly, x0: 96, x1: 928, a: 0.13, w: 1.1 }));

    // The sheet's rectangle in stage px: height 0.92 (wide) or 0.94 (narrow) of the box, centred.
    function sheetRect(B, wide) {
      let h = B.h * (wide ? 0.92 : 0.94);
      let w = (h * LW) / LH;
      if (w > B.w * 0.96) {
        w = B.w * 0.96;
        h = (w * LH) / LW;
      }
      const cx = B.x + B.w / 2;
      const cy = B.y + B.h / 2;
      return { left: cx - w / 2, top: cy - h / 2, w, h, cx, cy };
    }

    /* Every formation for one geometry: geo = { hero: {cx, cy, R}, box: {x, y, w, h}, wide }. */
    function build(geo) {
      const unit = seats(N, Q);
      const B = geo.box;
      const wide = Boolean(geo.wide);
      const bcx = B.x + B.w / 2;
      const bcy = B.y + B.h / 2;
      const over = { rooms: [], labels: [] };

      // f0: the hemicycle
      const hero = geo.hero;
      const f0 = chamber({ cx: hero.cx, cy: hero.cy, R: hero.R, sizeK: 0.36, e: 0.6, color: C.seat });

      // v0: the same chamber, stepped aside into the box
      const kv = (Math.min(B.w / 2, B.h) * 0.9) / hero.R;
      const v0 = makeF(N);
      {
        const cy = bcy + (hero.R * kv) / 2;
        for (let i = 0; i < N; i++) {
          v0.x[i] = bcx + (f0.x[i] - hero.cx) * kv;
          v0.y[i] = cy + (f0.y[i] - hero.cy) * kv;
          v0.s[i] = f0.s[i] * kv;
          v0.e[i] = 0.6;
          v0.o[i] = f0.o[i];
          v0.c[i] = C.seat;
        }
      }

      // f1: 500+ students, a phyllotaxis disc. Which seat takes which point: the seats (where leg 1 left them, v0) and
      // the points are both sorted by angle around the disc's centre, from the left over the top, and matched in runs
      // of 26 by distance from that centre, so each seat steps to a point near it and the chamber dissolves into the
      // crowd where it stands. (Matched by rank of angle from the left, the right wing travelled round to the disc's
      // lower left, through one corridor, and piled up there just before the hold.)
      const f1 = makeF(N);
      {
        const pts = crowdUnit();
        const rr = (Math.min(B.w, B.h) / 2) * 0.94;
        const size = rr * Math.sqrt(Math.PI / N) * 0.5;
        const key = (x, y) => {
          const a = Math.atan2(bcy - y, x - bcx);
          return (((Math.PI - a) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        };
        const dist = (x, y) => Math.hypot(x - bcx, y - bcy);
        const P = pts.map((p) => [bcx + p[0] * rr, bcy + p[1] * rr]).sort((a, b) => key(a[0], a[1]) - key(b[0], b[1]));
        const ids = [...Array(N).keys()].sort((a, b) => key(v0.x[a], v0.y[a]) - key(v0.x[b], v0.y[b]));
        const RUN = 26;
        for (let s0 = 0; s0 < N; s0 += RUN) {
          const run = ids.slice(s0, s0 + RUN).sort((a, b) => dist(v0.x[a], v0.y[a]) - dist(v0.x[b], v0.y[b]));
          const at = P.slice(s0, s0 + RUN).sort((a, b) => dist(a[0], a[1]) - dist(b[0], b[1]));
          run.forEach((id, j) => {
            f1.x[id] = at[j][0];
            f1.y[id] = at[j][1];
          });
        }
        for (let i = 0; i < N; i++) {
          f1.s[i] = size;
          f1.e[i] = 0;
          f1.o[i] = 0;
          f1.c[i] = C.seat;
        }
      }

      // f2: two teams to a room. Wide: A left, B right. Narrow: A on top, B below.
      const f2 = makeF(N);
      {
        const rooms = TEAMS.count / 2;
        const g = bestGrid(rooms, B.w, B.h, wide ? 1.55 : 1.0);
        const short = Math.min(g.cw, g.ch);
        // Narrow rooms stack Team A over Team B: smaller, tighter clusters set further apart, so a clear gap (about
        // twice the space between two members) keeps the two teams apart instead of one column of 7 or 8 dots.
        const cs = short * (wide ? 0.22 : 0.18);
        const size = short * (wide ? 0.136 : 0.116);
        const oy = bcy - (g.rows * g.ch) / 2 + g.ch / 2;
        const lastRow = Math.floor((rooms - 1) / g.cols);
        const lastCount = rooms - lastRow * g.cols;
        for (let r = 0; r < rooms; r++) {
          const col = r % g.cols;
          const row = Math.floor(r / g.cols);
          const inRow = row === lastRow ? lastCount : g.cols;
          const rx = bcx - (inRow * g.cw) / 2 + g.cw / 2 + col * g.cw;
          const ry = oy + row * g.ch;
          over.rooms.push({ x: rx - g.cw * 0.45, y: ry - g.ch * 0.42, w: g.cw * 0.9, h: g.ch * 0.84, r: Math.min(6, g.cw * 0.08) });
          for (let side = 0; side < 2; side++) {
            const t = r * 2 + side;
            const sx = wide ? (side ? 1 : -1) * g.cw * 0.2 : 0;
            const sy = wide ? 0 : (side ? 1 : -1) * g.ch * 0.23;
            TEAMS.members[t].forEach((id, slot) => {
              const off = clusterOffset(TEAMS.sizes[t], slot, cs);
              f2.x[id] = rx + sx + off[0];
              f2.y[id] = ry + sy + off[1];
              f2.s[id] = size;
              f2.e[id] = 0;
              f2.o[id] = 0;
              f2.c[id] = side ? C.green : C.azure;
            });
          }
        }
      }

      // f3: scored out of 100. One seat per point, split 15/20/20/15/15/15; seat rank from f2's x then y.
      let f3;
      {
        const order = [...Array(N).keys()].sort((a, b) => f2.x[a] - f2.x[b] || f2.y[a] - f2.y[b]);
        const pad = Math.max(18, Math.min(30, B.w * 0.05));
        const R = Math.min((B.w - pad * 2) / 2, (B.h - pad) * 0.96);
        const cy = B.y + B.h / 2 + R / 2 + pad * 0.25;
        f3 = chamber({ cx: bcx, cy, R, sizeK: 0.36, e: 0.6, weights: RUBRIC, gap: 0.045, colors: [C.rub0, C.rub1, C.rub2, C.rub3, C.rub4, C.rub5], order });
        f3.sectors.forEach((S, k) => {
          over.labels.push({ x: bcx + Math.cos(S.mid) * (R + pad * 0.72), y: cy - Math.sin(S.mid) * (R + pad * 0.72), text: String(RUBRIC[k]) });
        });
      }
      const rank3 = f3.rank;

      // f4: the page. Dots sit on the written lines of the sheet, shared out by line length, in reading order.
      const f4 = makeF(N);
      const tw = new Float32Array(N);
      const readOf = new Int16Array(N);
      const drop = new Uint8Array(N);
      const sheet = sheetRect(B, wide);
      const lines = paperLines();
      {
        const lens = lines.map((l) => Math.max(1, l.x1 - l.x0));
        const counts = scaleCounts(lens, N);
        const total = lens.reduce((a, b) => a + b, 0);
        const pitchX = ((total / N) * sheet.w) / LW;
        const size = Math.min(pitchX * 0.62, sheet.h * 0.006);
        // Who lands where: seats are taken from the top of the score chamber down, one line's worth at a time, and each line's
        // seats are laid along it left to right by where they sit. So each seat drops a short way onto a nearby line and the
        // paths do not cross (taken in rank order, a whole block flew to the first lines through its own waiting seats).
        const order = [...Array(N).keys()].sort((a, b) => f3.y[a] - f3.y[b] || f3.x[a] - f3.x[b]);
        let idx = 0;
        lines.forEach((L, li) => {
          const c = counts[li];
          const ids = order.slice(idx, idx + c).sort((a, b) => f3.x[a] - f3.x[b]);
          for (let j = 0; j < c; j++) {
            const id = ids[j];
            const f = (j + 0.5) / c;
            const lx = L.x0 + (L.x1 - L.x0) * f;
            f4.x[id] = sheet.left + (lx / LW) * sheet.w;
            f4.y[id] = sheet.top + ((L.ly - 9) / LH) * sheet.h;
            f4.s[id] = size;
            f4.e[id] = 0;
            f4.o[id] = 0;
            f4.c[id] = ON_PAPER;
            tw[id] = L.t0 + (L.t1 - L.t0) * f;
            readOf[id] = idx;
            // the last section's seats are the chamber's lowest, which sit above its printed label or on it (by the window's
            // shape): they drop first and then run along their line, so they cross the label once, straight down
            drop[id] = L.ly > LAST_LABEL_Y ? 1 : 0;
            idx++;
          }
        });
        over.sheet = sheet;
        over.rules = paperRules().map((r) => ({
          y: sheet.top + (r.y / LH) * sheet.h,
          x0: sheet.left + (r.x0 / LW) * sheet.w,
          x1: sheet.left + (r.x1 / LW) * sheet.w,
          a: r.a
        }));
      }

      // f5: the Oliy Majlis. Front rows fill first, left to right.
      const f5 = makeF(N);
      const fillRank = new Int16Array(N);
      let R5, cy5;
      {
        R5 = Math.min((B.w - 24) / 2, (B.h - 12) * 0.97);
        cy5 = B.y + B.h / 2 + R5 / 2;
        const size = unit.pitch * R5 * 0.36;
        const seatOrder = unit.list.map((st, i) => i).sort((a, b) => unit.list[a].row - unit.list[b].row || unit.list[b].th - unit.list[a].th);
        const order = [...Array(N).keys()].sort((a, b) => readOf[a] - readOf[b]);
        order.forEach((id, k) => {
          const st = unit.list[seatOrder[k]];
          f5.x[id] = bcx + Math.cos(st.th) * st.r * R5;
          f5.y[id] = cy5 - Math.sin(st.th) * st.r * R5;
          f5.s[id] = size;
          f5.e[id] = 0.6;
          f5.o[id] = st.th;
          f5.c[id] = C.azure;
          fillRank[id] = k;
        });
        over.ghost = chamber({ cx: bcx, cy: cy5, R: R5, sizeK: 0.36 * 0.8, e: 0.6, color: C.faint });
        over.park = { cx: bcx, cy: cy5, R: R5 };
        over.rostrum = { x: bcx, y: cy5 - R5 * Q * 0.45 };
        over.fs = clamp(R5 * 0.07, 15, 24);
        const pw = R5 * Q * 0.55;
        const ph = (pw * LH) / LW;
        over.packetW = pw;
        over.packet = { left: over.rostrum.x - pw / 2, top: over.rostrum.y - ph / 2, w: pw, h: ph };
      }

      // v5: every seat collapsed into the rostrum point (WebGL), and the 2D fallback's packet.
      const v5 = makeF(N);
      const v5f = makeF(N);
      {
        const P = over.packet;
        const k = P.w / sheet.w;
        for (let i = 0; i < N; i++) {
          v5.x[i] = over.rostrum.x;
          v5.y[i] = over.rostrum.y;
          v5.s[i] = f5.s[i] * 0.5;
          v5.e[i] = 0;
          v5.o[i] = f5.o[i];
          v5.c[i] = C.azure;
          v5.a[i] = 0;
          v5f.x[i] = P.left + (f4.x[i] - sheet.left) * k;
          v5f.y[i] = P.top + (f4.y[i] - sheet.top) * k;
          v5f.s[i] = Math.max(0.7, f4.s[i] * k * 1.6);
          v5f.e[i] = 0;
          v5f.o[i] = 0;
          v5f.c[i] = C.seat;
        }
      }

      // vX, the unpin (wide): the filled chamber glides back to the stage's centre line at the hero's size, a mirror of leg 1,
      // so the story ends on the figure it opened with and the Preamble scrolls in under a centred chamber. It never shrinks
      // (a short window makes the hero's chamber small to fit the hero copy, which has long gone). Its floor settles a quarter
      // of its radius above the formation box's bottom edge, so the Preamble's first row comes up about 175px under it
      // (1440x900) and the two read as one page. Narrow stages keep the chamber where it is: it is already centred.
      const vX = makeF(N);
      {
        const RE = wide ? Math.max(hero.R, R5) : R5;
        const kE = RE / R5;
        const cxE = wide ? hero.cx : bcx;
        const cyE = wide ? Math.max(cy5, B.y + B.h - RE * 0.25) : cy5;
        for (let i = 0; i < N; i++) {
          vX.x[i] = cxE + (f5.x[i] - bcx) * kE;
          vX.y[i] = cyE + (f5.y[i] - cy5) * kE;
          vX.s[i] = f5.s[i] * kE;
          vX.e[i] = 0.6;
          vX.o[i] = f5.o[i];
          vX.c[i] = C.azure;
        }
        over.exitName = { x: cxE, y: cyE - RE * Q * 0.45, fs: clamp(RE * 0.07, 15, 24) };
      }

      // Transitions: who moves first, and how much each path bends.
      const rand = rng(33);
      const mk = (spread, delayFn, bend) => {
        const d = new Float32Array(N);
        const b = new Float32Array(N);
        for (let i = 0; i < N; i++) {
          d[i] = delayFn(i);
          b[i] = (rand() * 2 - 1) * bend;
        }
        return { spread, d, b };
      };
      const draw = rng(9);
      const T = {
        leg1: mk(0.12, (i) => f0.rank[i] / N, 0),
        crowd: mk(0.45, (i) => f0.rank[i] / N, 0.1),
        rooms: mk(0.55, () => draw(), 0.18),
        score: mk(0.5, (i) => rank3[i] / N, 0.14),
        page: mk(0.5, (i) => readOf[i] / N, 0.12),
        fill: mk(0.5, (i) => fillRank[i] / N, 0.08),
        // the unpin glide: leg 1 played back (its spread, the right wing first and the left wing last), so the wing nearest
        // the stepper moves once it has gone; a wider spread squeezed the well until the "Oliy Majlis" name touched the seats
        exit: mk(0.12, (i) => f5.o[i] / Math.PI, 0)
      };
      T.page.drop = drop;

      return { F: [f0, f1, f2, f3, f4, f5], V: { v0, v5, v5f, vX }, T, tw, lines, over, geo };
    }
    // The printed labels of the form, in texture units (1024 x 1448), each as [x0, x1, y0, y1] boxes: the header, the field
    // names Team, Room and Case, the field name Date, and the three section titles. The same regions as paper.js's shader
    // (uLabA, uLabB).
    const PRINT_LABELS = [
      [[96, 928, 88, 152]],
      [[96, 152, 205, 240], [96, 152, 283, 318], [96, 152, 361, 396]],
      [[510, 585, 283, 318]],
      [[96, 600, 458, 500]],
      [[96, 600, 822, 864]],
      [[96, 700, 1078, 1120]]
    ];
    const labA = (clear, u) => 0.12 + 0.88 * smooth(clear, clear + 0.06, u);
    // The sheet's printed labels arrive under the score chamber, which is still standing: each label stays faint (12%)
    // until the last seat over it, or flying across it, has left, then comes up over 0.06 (paper.js uLab). Each clock is
    // measured on the page move's own paths (3.60 to 4.30), once per layout (only the pinned story needs it), so no seat
    // ever cuts through printed words.
    function printClears(model) {
      const over = model.over;
      if (over.labClear) return over.labClear;
      const sheet = over.sheet;
      const f3 = model.F[3];
      const f4 = model.F[4];
      const P = model.T.page;
      const drop = P.drop;
      over.labClear = PRINT_LABELS.map((boxes) => {
        const R = boxes.map((b) => ({
          x0: sheet.left + (b[0] / LW) * sheet.w,
          x1: sheet.left + (b[1] / LW) * sheet.w,
          y0: sheet.top + (b[2] / LH) * sheet.h,
          y1: sheet.top + (b[3] / LH) * sheet.h
        }));
        let last = 3.6;
        for (let u = 3.6; u <= 4.3001; u += 0.005) {
          const m = (u - 3.6) / 0.7;
          let hit = false;
          for (let i = 0; i < N && !hit; i++) {
            const e = easeIO(clamp((m - P.d[i] * P.spread) / (1 - P.spread)));
            const ax = f3.x[i];
            const ay = f3.y[i];
            const bx = f4.x[i];
            const by = f4.y[i];
            const qx = drop[i] ? ax : (ax + bx) / 2 - (by - ay) * P.b[i];
            const qy = drop[i] ? by : (ay + by) / 2 + (bx - ax) * P.b[i];
            const u1 = 1 - e;
            const x = u1 * u1 * ax + 2 * u1 * e * qx + e * e * bx;
            const y = u1 * u1 * ay + 2 * u1 * e * qy + e * e * by;
            const r = lerp(f3.s[i], f4.s[i], e) * 0.9 + 2; // half a capsule's length, and 2px of air
            hit = R.some((b) => x + r > b.x0 && x - r < b.x1 && y + r > b.y0 && y - r < b.y1);
          }
          if (hit) last = u + 0.005;
        }
        return last;
      });
      return over.labClear;
    }

    // Overlays for still frames (drawStatic): room outlines, sector points, the "Oliy Majlis" name.
    function overlay(ctx, over, k) {
      if (k === 2) drawRooms(ctx, over, 1);
      if (k === 3) drawLabels(ctx, over, 1);
      if (k === 5) drawName(ctx, over, 1);
    }
    function drawRooms(ctx, over, a) {
      if (a <= 0.003) return;
      ctx.globalAlpha = a;
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 1;
      over.rooms.forEach((r) => {
        CH.roundRect(ctx, Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w), Math.round(r.h), r.r);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }
    function drawLabels(ctx, over, a) {
      if (a <= 0.003) return;
      ctx.globalAlpha = a;
      ctx.fillStyle = palette.ink2;
      ctx.font = '500 13px "Public Sans", system-ui, sans-serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      over.labels.forEach((l) => ctx.fillText(l.text, l.x, l.y));
      ctx.globalAlpha = 1;
    }
    // Canvas text waits for the web font (chamber.js redraws stills again once fonts are ready).
    const fontsReady = () => !doc.fonts || doc.fonts.status === "loaded" || doc.fonts.check('400 20px "Source Serif 4"');
    // k: how far the unpin glide has taken the chamber (0 = in the formation box, 1 = on the centre line)
    function drawName(ctx, over, a, k = 0) {
      if (a <= 0.003 || !fontsReady()) return;
      const X = over.exitName;
      const fs = X && k > 0 ? lerp(over.fs, X.fs, k) : over.fs;
      const x = X && k > 0 ? lerp(over.rostrum.x, X.x, k) : over.rostrum.x;
      const y = X && k > 0 ? lerp(over.rostrum.y, X.y, k) : over.rostrum.y;
      ctx.globalAlpha = a;
      ctx.fillStyle = palette.ink;
      ctx.font = "400 " + fs.toFixed(1) + 'px "Source Serif 4", Georgia, serif';
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText("Oliy Majlis", x, y + fs * 0.34);
      ctx.globalAlpha = 1;
    }

    CH.registerBuild(build, overlay);

    /* ================================================================== */
    /* Shared pieces                                                       */
    /* ================================================================== */

    const pin = $("[data-pin]");
    const stage = $("[data-stage]");
    const glCanvas = $("[data-gl]");
    const heroCopy = $("[data-hero]");
    const heroText = $("[data-hero-text]");
    const well = $("[data-well]");
    const wellLabel = $(".well-label");
    const wellDate = $(".well-date");
    const stepper = $("[data-stepper]");
    const steps = $$(".step");
    const stepButtons = steps.map((s) => $(".step-btn", s));
    const stepBodies = steps.map((s) => $(".step-body", s));
    // The nav's Register button goes quiet while the hero's own Register button is on screen (one solid button per view).
    const navReg = doc.querySelector("[data-nav-register]");

    // Does the well text fit inside the chamber's inner row at centre height yc? (all in stage px)
    function wellFits(cx, cy, R, s, yc) {
      const ri = R * Q - s * 0.9;
      const lh = wellLabel.offsetHeight;
      const dh = wellDate.offsetHeight;
      const top = yc - (lh + dh) / 2;
      const chord = (dy) => (dy >= ri ? 0 : Math.sqrt(ri * ri - dy * dy));
      const okLabel = chord(cy - top) >= wellLabel.offsetWidth / 2 + 6;
      const okDate = chord(cy - (top + lh)) >= wellDate.offsetWidth / 2 + 6;
      return okLabel && okDate && yc + (lh + dh) / 2 <= cy - s * 0.4;
    }
    // Place the well: the spec's height first, then lower in the well, then smaller type, then under the chamber.
    // Returns { below, yc, h }.
    function placeWell(cx, cy, R, s) {
      well.classList.remove("is-below", "is-compact");
      const h = () => wellLabel.offsetHeight + wellDate.offsetHeight;
      const tries = (compact) => {
        well.classList.toggle("is-compact", compact);
        const yc1 = cy - R * Q * 0.48;
        if (wellFits(cx, cy, R, s, yc1)) return yc1;
        const yc2 = cy - s * 0.6 - h() / 2;
        if (wellFits(cx, cy, R, s, yc2)) return yc2;
        return null;
      };
      let yc = tries(false);
      if (yc == null) yc = tries(true);
      if (yc != null) return { below: false, yc, h: h() };
      well.classList.remove("is-compact");
      well.classList.add("is-below");
      return { below: true, yc: 0, h: h() };
    }

    let mode = null; // "motion" | "static"
    let api = null;
    // { w, h, fonts } of the window where the pinned hero did not fit, and the font status it was judged with; cleared when
    // the window changes, or once the web fonts are in if it was judged on the fallback font's metrics
    let tooShort = null;

    function wantMotion() {
      const s = site();
      const motionOk = s ? s.motion() : root.classList.contains("motion");
      return motionOk && mq.matches && !tooShort;
    }

    // A reader below the story: where they are, as { anchorId, frac, k, block }. block is the block they are on, the
    // first block in view under the nav's bottom edge and the deepest one in it that crosses that edge (site.js
    // readBlock() of the whole page). anchorId is the last section after the story whose top has reached 40% of the
    // window; frac is how far through it that edge sits, and k, for a top still lower than the edge (frac < 0), how far
    // that top is from the edge toward the 40% line (0 to 1): the place when the block has no box at the new size. null
    // when no section has reached the line. Each mode reads it after the reader's scrolls and after reflows below the
    // story at the same window size, so it still describes the page as it was before a resize reflowed it: turning a
    // phone on its side reflows the text below the story by thousands of pixels, so neither scrollY nor the distance
    // from the story's end holds. The browser's own scroll anchoring does not keep the place either: a phone's rotation
    // anchor finds the fixed nav at the top of the window, and on a desktop the gutters and type sizes that follow the
    // window width suppress anchoring.
    const S0 = site();
    const nav = doc.querySelector("[data-nav]");
    const below = $$("main > section[id]", doc).filter((el) => story.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
    const navBottom = () => (nav ? Math.max(0, nav.getBoundingClientRect().bottom) : 0);
    const readBlock = S0 && S0.readBlock ? S0.readBlock : () => null;
    const blockTop = S0 && S0.blockTop ? S0.blockTop : () => null;
    function readPlace() {
      const line = window.innerHeight * 0.4;
      let sec = null;
      for (const el of below) {
        if (el.getBoundingClientRect().top > line) break;
        sec = el;
      }
      if (!sec) return null;
      const r = sec.getBoundingClientRect();
      const nb = navBottom();
      const frac = (nb - r.top) / Math.max(1, r.height);
      return { anchorId: sec.id, frac, k: (r.top - nb) / Math.max(1, line - nb), block: readBlock(doc.body, nb) };
    }
    // Bring that place back: the block at the same distance from the nav's bottom edge (site.js blockTop()) or, with no
    // box for it, the same share of the section at that edge, or a top that was lower down at the same place between
    // that edge and the 40% line. Then again on each of the next two frames, since content-visibility sections near it
    // take their real height only once they render, and then done().
    function restorePlace(p, again = 2, done) {
      const sec = doc.getElementById(p.anchorId);
      if (!sec) return;
      const nb = navBottom();
      const bt = blockTop(p.block);
      let d;
      if (bt != null) d = bt - nb;
      else {
        const r = sec.getBoundingClientRect();
        d = r.top - (p.frac >= 0 ? nb - p.frac * r.height : nb + p.k * Math.max(1, window.innerHeight * 0.4 - nb));
      }
      if (Math.abs(d) >= 1) window.scrollBy(0, d);
      if (again) requestAnimationFrame(() => restorePlace(p, again - 1, done));
      else if (done) done();
    }

    function init() {
      const next = wantMotion() ? "motion" : "static";
      if (api && mode === next) return;
      // A reader inside the story keeps their step across the switch (a phone turned on its side, say).
      // Both modes report inStory and step as the page was before the resize that brought us here reflowed it.
      // One still on the hero stays there: motion reports step 1 from u 0, so before the hero copy is gone it counts as no step.
      const prev = api && api.state ? api.state() : null;
      const onHero = Boolean(prev && prev.u != null && prev.u < 0.4);
      const prevStep = prev && prev.inStory && !onHero ? prev.step : 0;
      // One below the story gets the block they were on back under the nav (the motion story is 7 stage heights tall and
      // the static one much shorter, so the same scrollY would land several screens further on), and the new mode keeps
      // that place as theirs until they scroll, so turning the phone back brings back the same block. Just under the
      // story's end, before any section has reached the 40% line, they keep their distance from that end instead. Both
      // wait one more frame, for the static hero's first draw, which places the well and can change the hero's height.
      const place = prev && !prev.inStory ? prev.place : null;
      const belowBy = !place && prev && !prev.inStory && prev.belowBy != null ? prev.belowBy : null;
      if (api) api.destroy();
      mode = next;
      api = next === "motion" ? Motion() : Static();
      const made = api;
      if (prevStep) requestAnimationFrame(() => api.goto(HOLD[prevStep], null, true));
      else if (place)
        requestAnimationFrame(() => requestAnimationFrame(() => restorePlace(place, 2, () => api === made && made.hold(place))));
      else if (belowBy != null)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => window.scrollTo(0, story.getBoundingClientRect().bottom + window.scrollY + belowBy))
        );
    }

    // Story links: data-goto="<u>" scrolls to that point of the story (or, static, to that step's row).
    function onGoto(e) {
      const a = e.target.closest("[data-goto]");
      if (!a || !story.contains(a)) return;
      e.preventDefault();
      const u = Number(a.getAttribute("data-goto"));
      if (api && api.goto) api.goto(u, a);
    }
    story.addEventListener("click", onGoto);

    /* ================================================================== */
    /* Motion: the pinned, scroll-scrubbed chamber                         */
    /* ================================================================== */

    function Motion() {
      story.classList.remove("is-static");
      const ctx0 = stage.getContext("2d");
      let W = 0;
      let H = 0;
      let wide = true;
      let model = null;
      let storyTop = 0;
      let storyBottom = 0; // in page px, from the last layout
      // The reader's scrollY as of their last scroll at the window size of the last layout (address bar changes aside),
      // so the scroll changes a resize brings (the browser's own, or a page grown shorter) never count as their place.
      let readY = 0;
      let readW = 0;
      let readH = 0;
      // readPlace() after the same scrolls (and after reflows below the story), read in the next frame; null while the
      // middle of the window is still in the story. After a restore (hold()) it stays the place that was restored until
      // the reader scrolls from keptY, so turning a phone back brings back the same block.
      let place = null;
      let placeRaf = 0;
      let keptY = -1;
      const sameWindow = () => window.innerWidth === readW && Math.abs(window.innerHeight - readH) < 120;
      const notePlace = () => {
        placeRaf = 0;
        if (!alive || !sameWindow() || window.scrollY === keptY) return;
        keptY = -1;
        place = storyBottom - window.scrollY < window.innerHeight * 0.5 ? readPlace() : null;
      };
      const hold = (p) => {
        if (!alive || !sameWindow()) return;
        place = p;
        readY = keptY = window.scrollY;
      };
      const noteScroll = () => {
        if (!sameWindow()) return;
        readY = window.scrollY;
        if (!placeRaf) placeRaf = requestAnimationFrame(notePlace);
      };
      let geo = null;
      const px = new Float32Array(N);
      const py = new Float32Array(N);
      const st = new Float32Array(N); // smoothed stretch
      const va = new Float32Array(N); // smoothed travel angle
      const phase = new Float32Array(N);
      {
        const r = rng(3);
        for (let i = 0; i < N; i++) phase[i] = r() * Math.PI * 2;
      }
      let uS = 0; // the smoothed story position
      let lastScrollAt = performance.now(); // the crowd's drift settles 3 to 4.5s after the last scroll, so the loop can rest
      let primed = false;
      let raf = 0;
      let last = 0;
      let visible = true;
      let alive = true;
      let introStart = 0;
      let introDone = false;
      const mouse = { x: -9999, y: -9999, tx: -9999, ty: -9999, amt: 0, target: 0 };
      const ripples = [];
      // the legend row under the pointer (step 3) lights its sector of the score chamber: hiK eases it in and out
      let hiSector = -1;
      let hiShown = -1;
      let hiK = 0;
      const domState = { heroO: -1, heroY: -1, heroInert: null, wellO: 1, stepO: -1, bodyO: 1, titleO: -1, shown: null, active: -1, hi: -1 };
      const legend = $(".legend", stepper);
      const legendRows = legend ? $$("li", legend) : [];

      // The WebGL sheet and its textures. The sheet (a WebGL context, a probe and two shader programs) is made late:
      // in the first idle callback after the first paint, or when the reader reaches u 2.6, whichever comes first.
      let sheet = null;
      let sheetTried = false;
      let tex = null;
      let glKey = "";
      let glClear = true;
      let lay = null;
      let rostW = { x: 0, y: 0 };
      let packetScale = 0.2;
      let glBox = { left: 0, top: 0 };
      const sheetState = { t1: 0, t2: 0, write: 0, rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0, lift: 0, alpha: 0, scale: 1, shadow: 1, lab: [1, 1, 1, 1, 1, 1] };
      // false until the sheet is made, and while the WebGL context is lost, so the 2D fallback sheet stands in
      const glOk = () => sheet && !sheet.failed && !sheet.lost;
      // inFrame: called from frame(), which draws straight after, so no extra wake
      function createSheet(inFrame) {
        if (sheetTried || !alive || !PAPER) return;
        sheetTried = true;
        try {
          sheet = new PAPER.Sheet(glCanvas);
        } catch (e) {
          sheet = null;
        }
        if (!glOk()) return;
        sheet.setTheme(palette.dark, palette.sheetTint);
        // restored: a fresh layout (the window may have changed meanwhile); layout() clears glKey and wakes the loop
        sheet.onRestore = () => {
          glCanvas.style.visibility = "";
          layout();
        };
        // lost: the canvas is hidden, since a lost context can paint its old backing store as an opaque box after a resize
        sheet.onLost = () => {
          glCanvas.style.visibility = "hidden";
          glKey = "";
          primed = false;
          wake();
        };
        placeSheet();
        queueUploads();
        glKey = "";
        if (!inFrame) {
          primed = false;
          wake();
        }
      }
      let uploads = [];
      // The textures are painted in idle time from the first paint on (paper.js), whether or not the sheet is made yet.
      function startTextures() {
        if (!alive || !PAPER || tex) return;
        tex = PAPER.textures(W > 900 ? 1 : 0.5);
        tex.start().then(queueUploads);
      }
      // Once both the textures and the sheet are there: upload in idle frames too, one texture at a time.
      function queueUploads() {
        if (!alive || !glOk() || !tex || !tex.ready || sheet.ready || uploads.length) return;
        uploads = ["front", "back", "info"];
        const next = () => {
          if (!alive || !uploads.length) return;
          // not while the roll call plays (at most 2s): an upload then waits on the GPU drawing it, a long task on slow GPUs
          if (introStart && !introDone && performance.now() - introStart < 2000) {
            idle(next);
            return;
          }
          const name = uploads.shift();
          sheet.uploadOne(name, tex[name]);
          if (uploads.length) idle(next);
          else {
            glKey = "";
            wake();
          }
        };
        idle(next);
      }
      const idle = (fn) => (window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 300 }) : setTimeout(fn, 60));
      function ensureTexturesNow() {
        if (!glOk() || sheet.ready) return;
        if (!tex) tex = PAPER.textures(W > 900 ? 1 : 0.5);
        tex.finish();
        uploads = [];
        ["front", "back", "info"].forEach((n) => sheet.uploadOne(n, tex[n]));
        glKey = "";
      }
      // Where the sheet sits on the WebGL canvas, from the last layout (run by layout(), and once the sheet is made).
      function placeSheet() {
        if (!glOk() || !model) return;
        sheet.setSize(glBox.w, glBox.h);
        const S = model.over.sheet;
        sheet.rect = { cx: S.cx - glBox.left, cy: S.cy - glBox.top, w: S.w };
        lay = sheet.layoutFromRect(sheet.rect);
        const ro = model.over.rostrum;
        rostW = sheet.toWorld(ro.x - glBox.left, ro.y - glBox.top);
        packetScale = model.over.packetW / S.w;
        sheet.size();
      }

      /* ---------- Geometry and layout (read on resize, font load and image load only) ---------- */

      function geometry() {
        const nav = 64;
        // the same test as the stylesheet's desktop stepper (the viewport, scrollbar included), so a classic scrollbar
        // at 901 to 915px never pairs the narrow formations with the desktop stepper; W still sizes everything
        wide = window.matchMedia ? window.matchMedia("(min-width: 901px)").matches : W > 900;
        const gutter = clamp(W * 0.042, 16, 56);
        const pitch = seats(N, Q).pitch;
        const kS = pitch * 0.36;
        let R;
        let top;
        let box;
        let stepW = 400;
        let stepLeft = 0;
        let stepTop = 0;
        if (wide) {
          R = Math.min(W * 0.3, (H - nav) * 0.44, 500);
          top = nav + Math.max(16, H * 0.05);
          // the stepper keeps to the nav's left line, so its active capsule lines up with the brand mark: the gutter, and from
          // 1600px (where the nav's contents keep to the content column, max 1240px) that column, as the sections below
          const navCol = window.matchMedia ? window.matchMedia("(min-width: 1600px)").matches : W >= 1585;
          const inset = navCol ? Math.max(gutter, (W - 1240) / 2) : gutter;
          const x0 = Math.max(inset + (W - 2 * inset) * 0.42, inset + 440);
          box = { x: x0, y: nav + H * 0.05, w: W - inset - x0, h: H * 0.9 - nav };
          stepLeft = inset + 2 + 19; // the active capsule (left: -19px) starts 2px in, where the brand mark sits in its link
          stepW = Math.min(440, x0 - stepLeft - 48);
        } else {
          R = Math.min((W - 2 * gutter) / 2, H * 0.28);
          top = nav + 18;
          // The bottom panel starts at 64% of the stage, or higher when its tallest step (step 3 and its legend) needs the
          // room, since the stage clips; the formation box ends 2% of the stage above the panel. On taller screens (760px
          // and up) that step keeps at least 40px clear of the bottom edge. On tall stages (tablets in portrait) the panel
          // starts lower, so that step ends no more than 48px above the edge: at 64% it left a quarter of the screen blank
          // under step 5 before the Preamble (256px at 768x1024), and the formations take the room instead.
          const ps = getComputedStyle(stepper);
          const stepH = Math.max(...steps.map((el) => el.offsetHeight));
          const padB = Math.max(parseFloat(ps.paddingBottom), H >= 760 ? 40 : 0);
          const room = H - parseFloat(ps.paddingTop) - stepH; // the panel's top with that step at the bottom edge
          stepTop = Math.min(Math.max(H * 0.64, room - 48), room - padB);
          box = { x: gutter, y: 80, w: W - 2 * gutter, h: stepTop - H * 0.02 - 80 };
        }
        // Keep the hero copy inside the stage: shrink the chamber if the text needs the room.
        const textH = heroText.offsetHeight;
        const padB = wide ? 28 : 20;
        let minR = wide ? 150 : 96;
        const fitR = (below, wellH) => {
          const k = 1 + kS * 0.6 + (below ? 0 : 0.1);
          const extra = below ? 14 + wellH + 18 : 0;
          return Math.max(minR, Math.min(R, (H - padB - textH - top - extra) / k));
        };
        const cx = W / 2;
        let r;
        let cy;
        let w;
        let s;
        let wellY;
        let heroTop;
        let fits = false;
        for (let pass = 0; pass < 2 && !fits; pass++) {
          if (pass) minR = Math.round(H * (wide ? 0.16 : 0.11)); // second try: let the chamber shrink further
          r = fitR(false, 0);
          cy = top + r;
          w = placeWell(cx, cy, r, kS * r);
          if (w.below) {
            r = fitR(true, w.h);
            cy = top + r;
            w = placeWell(cx, cy, r, kS * r);
            if (!w.below) {
              // the smaller chamber cannot hold it either: keep it below
              well.classList.add("is-below");
              w = { below: true, yc: 0, h: w.h };
            }
          }
          s = kS * r;
          if (w.below) {
            wellY = cy + s * 0.6 + 14;
            heroTop = wellY + w.h + 18;
          } else {
            wellY = w.yc;
            heroTop = cy + s * 0.6 + r * 0.1;
          }
          fits = heroTop + textH <= H - padB + 1;
        }
        // On tall phones, part of the spare height goes above the chamber so the group sits balanced.
        if (!wide) {
          const spare = H - padB - (heroTop + textH);
          const shift = clamp(spare * 0.38, 0, 64);
          cy += shift;
          wellY += shift;
          heroTop += shift;
        }
        // fits is false when even the smaller chamber leaves the hero copy cut off: the story then goes static
        return { hero: { cx, cy, R: r }, box, wide, stepW, stepLeft, stepTop, wellY, heroTop, gutter, fits };
      }

      // The stage size the ResizeObserver last saw laid out (set at the end of each pass).
      let lastW = 0;
      let lastH = 0;
      // W, H and the font status after the last full pass: a pass where all three are unchanged keeps the geometry,
      // the stepper measure and the formations, and only re-reads storyTop.
      let builtFor = "";
      const fontStatus = () => (doc.fonts ? doc.fonts.status : "");
      // Layout requests from resizes and font loads, batched to one pass per frame.
      let lq = 0;
      const requestLayout = () => {
        if (!lq)
          lq = requestAnimationFrame(() => {
            lq = 0;
            layout();
          });
      };

      /* Wide: when the stepper may show. Its column (the step numbers and step 1's capsule, on the nav's left line, which the
         wing never reaches) fades in from numStart, 0.38 wherever the wing allows, as the hero copy fades out (0.30 to
         0.40), so the two cross-fade. The titles fade in once the chamber's left wing, gliding out of the hero (leg 1), has
         cleared them, but not before 0.38; step 1's body waits until the wing has cleared its lines too, and not before 0.48.
         Measured once per layout, with step 1 active and the stepper at rest; the seats' leg 1 paths are straight lines. */
      let numStart = 0.372;
      let stepStart = 0.372;
      let bodyStart = 1;
      let exitU = SPAN + 0.1;
      // the unpin glide (wide), on the stepper's exit clock: from exitA (when the stepper starts to fade) over 0.22
      let exitA = SPAN - 0.05;
      let exitB = SPAN + 0.17;
      function clearTimes() {
        if (!geo.wide) {
          numStart = stepStart = 0.372;
          bodyStart = 0;
          return;
        }
        stepper.classList.add("is-measuring");
        const was = steps.findIndex((el) => el.classList.contains("is-active"));
        steps.forEach((x, j) => x.classList.toggle("is-active", j === 0));
        const tf = stepper.style.transform;
        stepper.style.transform = "none";
        const pr = pin.getBoundingClientRect();
        const rg = doc.createRange();
        const textBox = (el) => {
          rg.selectNodeContents(el);
          return rg.getBoundingClientRect();
        };
        const sr = stepper.getBoundingClientRect();
        const heads = steps.map((el) => $(".step-h", el).getBoundingClientRect());
        const titles = steps.map((el) => textBox($(".step-title", el)));
        // one box per title row: from the active capsule (19px left of the numbers) to the end of its text
        const titleBoxes = heads.map((hr, k) => ({ x0: sr.left - 19 - pr.left, x1: titles[k].right - pr.left, y0: hr.top - pr.top, y1: hr.bottom - pr.top }));
        // and one per number: from the capsule to the end of the 34px number column
        const numBoxes = steps.map((el, k) => ({ ...titleBoxes[k], x1: $(".step-n", el).getBoundingClientRect().right - pr.left }));
        const b = stepBodies[0] ? textBox(stepBodies[0]) : null;
        const bodyBoxes = b && b.width ? [{ x0: b.left - pr.left, x1: b.right - pr.left, y0: b.top - pr.top, y1: b.bottom - pr.top }] : [];
        stepper.style.transform = tf;
        steps.forEach((x, j) => x.classList.toggle("is-active", j === was));
        void stepper.offsetHeight;
        stepper.classList.remove("is-measuring");
        const F0 = model.F[0];
        const V0 = model.V.v0;
        const L1 = model.T.leg1;
        const clearAt = (boxes, from) => {
          for (let u = from; u < 0.62; u += 0.005) {
            const m = (u - 0.33) / 0.29;
            let hit = false;
            for (let i = 0; i < N && !hit; i++) {
              const e = easeIO(clamp((m - L1.d[i] * L1.spread) / (1 - L1.spread)));
              const x = lerp(F0.x[i], V0.x[i], e);
              const y = lerp(F0.y[i], V0.y[i], e);
              const r = lerp(F0.s[i], V0.s[i], e) + 12; // about the seat's half length, plus 12px of air
              hit = boxes.some((bx) => x + r > bx.x0 && x - r < bx.x1 && y + r > bx.y0 && y - r < bx.y1);
            }
            if (!hit) return u;
          }
          return 0.62;
        };
        numStart = clearAt(numBoxes, 0.38);
        stepStart = clearAt(titleBoxes, 0.38);
        bodyStart = clearAt(bodyBoxes, Math.max(0.48, stepStart));
        geo.numStart = numStart;
        geo.stepStart = stepStart;
        geo.bodyStart = bodyStart;
      }

      function layout() {
        if (!alive) return;
        // where the reader is in the story before the stage height changes, so a height resize keeps their place
        const prevH = H;
        const prevW = W;
        const y0 = readW ? readY : window.scrollY;
        const rawU = prevH ? (y0 - storyTop) / prevH : NaN;
        const prevBottom = storyBottom;
        const rect = pin.getBoundingClientRect();
        W = Math.round(rect.width);
        H = Math.round(rect.height);
        if (!W || !H) return;
        if (!model || builtFor !== W + "," + H + "," + fontStatus()) {
          CH.sizeCanvas(stage, W, H);
          geo = geometry();
          if (!geo.fits) {
            // the hero cannot fit this stage: hand over to the static story until the window grows
            tooShort = { w: window.innerWidth, h: window.innerHeight, fonts: fontStatus() };
            setTimeout(init, 0);
            return;
          }
          story.style.setProperty("--well-y", Math.round(geo.wellY) + "px");
          story.style.setProperty("--hero-top", Math.round(geo.heroTop) + "px");
          story.style.setProperty("--step-w", Math.round(geo.stepW) + "px");
          story.style.setProperty("--step-left", Math.round(geo.stepLeft) + "px");
          if (!geo.wide) story.style.setProperty("--step-top", Math.floor(geo.stepTop) + "px");
          if (geo.wide) {
            stepper.classList.add("is-measuring");
            const was = steps.findIndex((el) => el.classList.contains("is-active"));
            let maxH = 0;
            steps.forEach((el, k) => {
              steps.forEach((x, j) => x.classList.toggle("is-active", j === k));
              maxH = Math.max(maxH, stepper.offsetHeight);
            });
            steps.forEach((x, j) => x.classList.toggle("is-active", j === was));
            void stepper.offsetHeight;
            stepper.classList.remove("is-measuring");
            story.style.setProperty("--step-top", Math.round(Math.max(76, (H - maxH) / 2)) + "px");
          }
          model = build(geo);
          clearTimes();
          // The WebGL canvas covers the formation box plus 40px on each side. It is placed by transform from its 0,0
          // corner, not by left and top, so its first placement after paint does not count as a layout shift.
          const B = geo.box;
          glBox = { left: Math.round(B.x - 40), top: Math.round(B.y - 40), w: Math.round(B.w + 80), h: Math.round(B.h + 80) };
          glCanvas.style.transform = "translate(" + glBox.left + "px," + glBox.top + "px)";
          glCanvas.style.width = glBox.w + "px";
          glCanvas.style.height = glBox.h + "px";
          // read after the measuring above, which may itself have started a font load
          builtFor = W + "," + H + "," + fontStatus();
        }
        // always: a restored context may follow a resize made while the context was lost
        placeSheet();
        storyTop = story.getBoundingClientRect().top + window.scrollY;
        storyBottom = storyTop + story.offsetHeight;
        // the unpin: the story u at which the first row of the section after the story (the Preamble) reaches the bottom
        // of the window; the wide stepper is faded out by then (updateDom)
        const firstRow = below[0] && (below[0].querySelector(".row") || below[0]);
        exitU = firstRow ? (firstRow.getBoundingClientRect().top + window.scrollY - window.innerHeight - storyTop) / H : SPAN + 0.1;
        exitA = Math.max(SPAN - 0.05, Math.max(SPAN, exitU) - 0.1);
        exitB = exitA + 0.22;
        if (prevH && H !== prevH && rawU > 0 && rawU < SPAN) window.scrollTo(0, scrollFor(rawU));
        // a reader past the pin keeps their place under the story, which is 7 stage heights tall and so moved everything
        // below it by 7 times a height change: the block they were on comes back (the text below reflows too, with any
        // change of width: a tablet turned on its side, a desktop window made narrower), or, just past the story's end,
        // their distance from that end
        else if (prevH && (H !== prevH || W !== prevW) && rawU >= SPAN && prevBottom) {
          const p = place;
          if (p) restorePlace(p, 2, () => hold(p));
          else window.scrollTo(0, y0 + storyBottom - prevBottom);
        }
        readW = window.innerWidth;
        readH = window.innerHeight;
        readY = window.scrollY;
        notePlace();
        lastW = W;
        lastH = H;
        primed = false;
        glKey = "";
        computedFor = -1;
        wake();
      }

      // u runs on past the pin by up to 0.3, for the unpin glide (wide), which plays while the section scrolls away
      const target = () => clamp((window.scrollY - storyTop) / Math.max(1, H), 0, SPAN + 0.3);
      // Is the middle of the window inside the story? From the last layout's storyTop and H, so it still answers
      // for the page as it was when a resize has reflowed it but layout() has not run yet.
      const inStory = () => {
        const raw = (window.scrollY - storyTop) / Math.max(1, H);
        return raw > -0.5 && raw < SPAN + 0.5;
      };
      const scrollFor = (u) => storyTop + clamp(u, 0, SPAN) * H;

      /* ---------- The frame ---------- */

      // Which move is playing at u: { A, B, tr, m } (tr null while a formation holds).
      function segment(u) {
        const F = model.F;
        const V = model.V;
        const T = model.T;
        if (u < 0.33) return { A: F[0], B: F[0], tr: null, m: 0 };
        if (u < 0.62) return { A: F[0], B: V.v0, tr: T.leg1, m: (u - 0.33) / 0.29 };
        if (u < 0.7) return { A: V.v0, B: V.v0, tr: null, m: 0 };
        if (u < 1.1) return { A: V.v0, B: F[1], tr: T.crowd, m: (u - 0.7) / 0.4 };
        if (u < 1.4) return { A: F[1], B: F[1], tr: null, m: 0 };
        if (u < 2.2) return { A: F[1], B: F[2], tr: T.rooms, m: (u - 1.4) / 0.8 };
        if (u < 2.5) return { A: F[2], B: F[2], tr: null, m: 0 };
        if (u < 3.3) return { A: F[2], B: F[3], tr: T.score, m: (u - 2.5) / 0.8 };
        if (u < 3.6) return { A: F[3], B: F[3], tr: null, m: 0 };
        if (u < 4.3) return { A: F[3], B: F[4], tr: T.page, m: (u - 3.6) / 0.7, toPage: true };
        if (u < 5.4) return { A: F[4], B: F[4], tr: null, m: 0, page: true };
        if (u < 5.85) return { A: glOk() ? V.v5 : V.v5f, B: F[5], tr: T.fill, m: (u - 5.4) / 0.45, fill: true };
        if (wide && u > exitA) return { A: F[5], B: V.vX, tr: T.exit, m: clamp((u - exitA) / (exitB - exitA)), exit: true };
        return { A: F[5], B: F[5], tr: null, m: 0 };
      }

      function drawFallbackPaper(ctx, u) {
        const o = model.over;
        const S = o.sheet;
        const arr = easeOut(clamp((u - 3.6) / 0.15));
        if (arr <= 0.003 || u > 5.5) return null;
        const p = easeIO(clamp((u - 4.8) / 0.68));
        const P = o.packet;
        const k0 = lerp(0.96, 1, arr);
        const w = lerp(S.w * k0, P.w, p);
        const h = lerp(S.h * k0, P.h, p);
        const cx = lerp(S.cx, P.left + P.w / 2, p);
        const cy = lerp(S.cy, P.top + P.h / 2, p);
        const a = arr * (1 - clamp((u - 5.42) / 0.08));
        const x = cx - w / 2;
        const y = cy - h / 2;
        ctx.globalAlpha = a;
        ctx.fillStyle = palette.paper;
        ctx.shadowColor = palette.dark ? "rgba(0,0,0,.5)" : "rgba(19,33,42,.16)";
        ctx.shadowBlur = 28 * (1 - p) + 4;
        ctx.shadowOffsetY = 10 * (1 - p) + 1;
        CH.roundRect(ctx, x, y, w, h, lerp(4, 2, p));
        ctx.fill();
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        ctx.strokeStyle = palette.lineSoft;
        ctx.lineWidth = 1;
        ctx.stroke();
        const kx = w / S.w;
        const ky = h / S.h;
        ctx.strokeStyle = palette.lineSoft;
        ctx.lineWidth = Math.max(0.5, kx);
        ctx.beginPath();
        o.rules.forEach((r) => {
          const yy = y + (r.y - S.top) * ky;
          ctx.moveTo(x + (r.x0 - S.left) * kx, yy);
          ctx.lineTo(x + (r.x1 - S.left) * kx, yy);
        });
        ctx.stroke();
        ctx.globalAlpha = 1;
        return { x, y, kx, ky, p, a };
      }

      // Where the packet is on screen, so the ghost seats under it stay hidden (they are drawn on the 2D canvas, which lies
      // over the WebGL one): { edges, a }, the packet's outline in stage px as edges [x, y, nx, ny] with inward unit normals,
      // and its opacity. With WebGL the outline is the folded sheet's own box, projected as paper.js draws it.
      function packetOutline(u, flat) {
        if (u < 5.18 || u > 5.5) return null;
        let pts;
        let a;
        if (glOk()) {
          if (!sheet.ready || !lay) return null;
          computeSheet(u);
          pts = sheet.footprint(sheetState).map((p) => [glBox.left + p[0], glBox.top + p[1]]);
          a = sheetState.alpha;
        } else {
          if (!flat) return null;
          const S = model.over.sheet;
          const x1 = flat.x + S.w * flat.kx;
          const y1 = flat.y + S.h * flat.ky;
          pts = [[flat.x, flat.y], [x1, flat.y], [x1, y1], [flat.x, y1]];
          a = flat.a;
        }
        const edges = pts.map((p, j) => {
          const q = pts[(j + 1) % pts.length];
          const len = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1;
          return [p[0], p[1], -(q[1] - p[1]) / len, (q[0] - p[0]) / len];
        });
        return { edges, a };
      }
      // Is (x, y) within m px of the packet's outline, or inside it?
      function underPacket(P, x, y, m) {
        for (let j = 0; j < P.edges.length; j++) {
          const E = P.edges[j];
          if ((x - E[0]) * E[2] + (y - E[1]) * E[3] < -m) return false;
        }
        return true;
      }
      function drawGhost(ctx, g, alpha, P) {
        const col = palette.str[C.faint];
        ctx.strokeStyle = col;
        let lastA = -1;
        for (let i = 0; i < g.n; i++) {
          const x = g.x[i];
          const y = g.y[i];
          // hidden whole under the packet: any seat that would show a part over it (its reach: half its width plus half its length)
          const a = P && underPacket(P, x, y, (g.s[i] * (1 + g.e[i])) / 2 + 1) ? alpha * (1 - P.a) : alpha;
          if (a <= 0.003) continue;
          if (a !== lastA) {
            ctx.globalAlpha = a;
            lastA = a;
          }
          const s = g.s[i];
          const hl = Math.max(0.01, (s * g.e[i]) / 2);
          const dx = Math.cos(g.o[i]) * hl;
          const dy = -Math.sin(g.o[i]) * hl;
          ctx.lineWidth = s;
          ctx.beginPath();
          ctx.moveTo(x - dx, y - dy);
          ctx.lineTo(x + dx, y + dy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      function frame(now) {
        raf = 0;
        if (!alive || !model) return;
        if (!visible || doc.hidden) {
          last = 0;
          return;
        }
        const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
        last = now;
        const uT = target();
        let snap = !primed;
        if (Math.abs(uT - uS) > 1.5) snap = true;
        if (snap) uS = uT;
        else {
          uS += (uT - uS) * (1 - Math.exp(-dt * 10));
          if (Math.abs(uT - uS) < 1e-4) uS = uT;
        }
        const u = uS;

        // the roll call runs once, at load, and only when the page opens on the hero
        if (!introStart) {
          introStart = now;
          if (u >= 0.3) introDone = true;
        }
        const introT = (now - introStart) / 1500;
        if (introT > 1.05) introDone = true;

        // the sheet is made by u 2.6 at the latest; from 2.6 to 3.4 its textures are painted and uploaded a piece a frame,
        // since the moving crowd leaves little idle time; at 3.4 whatever is left is finished at once
        if (u >= 2.6) {
          if (!sheetTried) createSheet(true);
          if (!tex) startTextures();
        }
        if (u >= 2.6 && u < 3.4 && glOk() && !sheet.ready && tex) {
          if (!tex.ready) tex.pump();
          else if (uploads.length) {
            const n = uploads.shift();
            sheet.uploadOne(n, tex[n]);
            if (!uploads.length) glKey = "";
          }
        }
        if (u >= 3.4 && u <= 5.55 && glOk() && !sheet.ready) ensureTexturesNow();

        ensureOnPaper(Boolean(glOk() && palette.dark));
        const ctx = ctx0;
        ctx.clearRect(0, 0, W, H);
        const o = model.over;
        const seg = segment(u);
        const tr = seg.tr;
        const A = seg.A;
        const Bf = seg.B;
        const m = seg.m;
        const hold3 = seg.A === model.F[3] && seg.B === model.F[3];
        hiK += ((hiSector >= 0 && hold3 ? 1 : 0) - hiK) * (1 - Math.exp(-dt * 14));
        // the legend row under the pointer lights with its sector: the other five rows dim with the other sectors (CSS, 200ms)
        const hiRow = hiSector >= 0 && hold3 ? hiSector : -1;
        if (hiRow !== domState.hi && legend) {
          legend.classList.toggle("is-hi", hiRow >= 0);
          legendRows.forEach((li, k) => li.classList.toggle("is-hi", k === hiRow));
          domState.hi = hiRow;
        }

        // weights
        const heroW = u < 0.3 ? 1 : u < 0.62 ? 1 - m : 0;
        let crowdW = 0;
        if (u >= 0.7 && u < 1.1) crowdW = m;
        else if (u >= 1.1 && u < 1.4) crowdW = 1;
        else if (u >= 1.4 && u < 2.2) crowdW = 1 - easeIO(m);
        const driftK = 1 - smooth(3000, 4500, now - lastScrollAt);

        // overlays under the dots
        drawRooms(ctx, o, smooth(1.9, 2.2, u) * (1 - smooth(2.5, 2.7, u)));
        let flat = null;
        if (!glOk() && u >= 3.6 && u <= 5.5) flat = drawFallbackPaper(ctx, u);
        // the ghost chamber goes as the unpin glide starts, before the first seats have moved off it
        // the "Oliy Majlis" name moves with the glide's middle seat (delay 0.5)
        const exitSp = model.T.exit.spread;
        const exitK = seg.exit ? easeIO(clamp((seg.m - exitSp / 2) / (1 - exitSp))) : 0;
        const ghostA = smooth(5.2, 5.45, u) * (palette.dark ? 0.8 : 0.5) * (seg.exit ? 1 - smooth(0, 0.12, seg.m) : 1);
        if (ghostA > 0.003) drawGhost(ctx, o.ghost, ghostA, packetOutline(u, flat));

        // pointer and ripples
        mouse.amt += (mouse.target * heroW - mouse.amt) * (1 - Math.exp(-dt * 6));
        if (mouse.x < -999) {
          mouse.x = mouse.tx;
          mouse.y = mouse.ty;
        }
        mouse.x += (mouse.tx - mouse.x) * (1 - Math.exp(-dt * 10));
        mouse.y += (mouse.ty - mouse.y) * (1 - Math.exp(-dt * 10));
        const reach = Math.max(110, model.F[0].s[0] * 16);
        for (let r = ripples.length - 1; r >= 0; r--) if (now - ripples[r].t > 1800) ripples.splice(r, 1);

        // the writing, 4.05 to 4.50: each seat melts about 0.1 after it lands (the landing wave runs 3.95 to 4.30, in the same
        // reading order), so the finished page holds 4.50 to 4.80 before the sheet tilts. The write time runs to 1.03 (as the
        // shader's uWrite in paper.js): a seat has melted 0.025 after the pen passes it, and the last ones sit at about 0.998,
        // so every seat is gone by about 4.497, before the hold
        const writeU = lerp(-0.01, 1.03, clamp((u - 4.05) / 0.45));
        const tw = model.tw;
        const time = now / 1000;
        const kStretch = 1 - Math.exp(-dt * 22);
        let moving = 0;
        let lastA = -1;
        let lastCol = "";
        const spread = tr ? tr.spread : 0;
        // Dark mode: the light sheet arrives under the score chamber (opaque by about 3.63), where the seats' dark-theme rubric
        // colours (pale cyan) wash out. So every seat takes the on-paper colour as it arrives, all on one clock: those over the
        // sheet and those beside it alike, so no edge of the sheet ever cuts the chamber into two colours (by position, the
        // wings were stencilled by hard vertical lines). The change runs while the fading-in sheet passes the seats'
        // lightness (its opacity 0.45 to 0.75, about 3.605 to 3.611), since a half-way colour reads worse on the half-faded
        // sheet than either end. (Light mode's rubric reads on the white sheet, and the 2D fallback's sheet is dark.)
        // sheetIn() is the sheet's opacity (computeSheet).
        const inkK = onPaperDark && seg.toPage && sheet.ready ? smooth(0.45, 0.75, sheetIn(u)) : 0;
        // the 2D fallback's packet opacity (0 once it has gone, at 5.50), for the seats still parked on it
        const packetA = flat ? flat.a : 0;
        ctx.lineCap = "round";

        for (let i = 0; i < N; i++) {
          let tx;
          let ty;
          let size;
          let elong;
          let orient;
          let ca = A.c[i];
          let cb = Bf.c[i];
          let ct = 0;
          let a = 1;
          if (tr) {
            const e = easeIO(clamp((m - tr.d[i] * spread) / (1 - spread)));
            const ax = A.x[i];
            const ay = A.y[i];
            const bx = Bf.x[i];
            const by = Bf.y[i];
            const b = tr.b[i];
            // a seat marked to drop first (the page move's last section) bends through the point on its line straight
            // below its start: down first, then along the line, under the label printed above it
            const dr = tr.drop && tr.drop[i];
            const qx = dr ? ax : (ax + bx) / 2 - (by - ay) * b;
            const qy = dr ? by : (ay + by) / 2 + (bx - ax) * b;
            const u1 = 1 - e;
            tx = u1 * u1 * ax + 2 * u1 * e * qx + e * e * bx;
            ty = u1 * u1 * ay + 2 * u1 * e * qy + e * e * by;
            size = lerp(A.s[i], Bf.s[i], e);
            elong = lerp(A.e[i], Bf.e[i], e);
            orient = angLerp(A.o[i], Bf.o[i], e);
            ct = e;
            if (inkK > ct) ct = inkK;
            // the writing starts while the last lines are still landing (4.05 to 4.30): a seat that has landed melts the same way
            if (seg.toPage && glOk() && writeU > tw[i] - 0.01) {
              a = 1 - smooth(tw[i] - 0.01, tw[i] + 0.025, writeU);
              size *= 1 - 0.4 * (1 - a);
            }
            if (seg.fill) {
              if (glOk()) a = smooth(0.18, 0.4, e);
              else {
                // no WebGL: a seat still parked on the 2D packet is part of its writing and fades out with it, so no line
                // of dots is left with no paper behind it. One that leaves the packet fades out with it over the first
                // 18% of its move, then shows, sized and coloured, as with WebGL: never a stream of 1px dots.
                const k = smooth(0, 0.18, e);
                a = Math.max(packetA * (1 - k), smooth(0.18, 0.4, e));
                size = lerp(A.s[i], lerp(Bf.s[i] * 0.5, Bf.s[i], e), k);
                ct = k;
              }
            }
          } else {
            tx = A.x[i];
            ty = A.y[i];
            size = A.s[i];
            elong = A.e[i];
            orient = A.o[i];
            if (seg.page) {
              if (glOk()) {
                // seats to ink: each dot melts into the pen stroke written at its place
                a = 1 - smooth(tw[i] - 0.01, tw[i] + 0.025, writeU);
                size *= 1 - 0.4 * (1 - a);
              } else if (flat) {
                // no WebGL: the dots ride the flat sheet down to the rostrum
                const S = o.sheet;
                tx = flat.x + (A.x[i] - S.left) * flat.kx;
                ty = flat.y + (A.y[i] - S.top) * flat.ky;
                size = lerp(A.s[i], model.V.v5f.s[i], flat.p);
              }
            }
          }

          if (crowdW > 0) {
            tx += Math.sin(time * 0.7 * Math.PI * 2 + phase[i]) * 1.6 * driftK * crowdW;
            ty += Math.cos(time * 0.55 * Math.PI * 2 + phase[i] * 1.3) * 1.6 * driftK * crowdW;
          }

          // The chamber notices you: nearby seats lean away, grow a little, turn to face the pointer.
          let lit = 0;
          if (heroW > 0.001) {
            if (mouse.amt > 0.002) {
              const dx = tx - mouse.x;
              const dy = ty - mouse.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              if (d < reach) {
                const fall = 1 - d / reach;
                const g = fall * fall * mouse.amt;
                tx += (dx / (d || 1)) * g * size * 1.4;
                ty += (dy / (d || 1)) * g * size * 1.4;
                size *= 1 + 0.35 * g;
                orient = angLerp(orient, Math.atan2(ty - mouse.y, mouse.x - tx) + Math.PI, Math.min(1, g * 1.6));
                lit = Math.max(lit, g * 1.25);
              }
            }
            for (let r = 0; r < ripples.length; r++) {
              const rp = ripples[r];
              const age = (now - rp.t) / 1000;
              const dx = tx - rp.x;
              const dy = ty - rp.y;
              const d = Math.sqrt(dx * dx + dy * dy);
              const band = Math.exp(-Math.pow((d - age * 520) / 34, 2)) * (1 - age / 1.8) * heroW;
              if (band > 0.01) {
                size *= 1 + 0.5 * band;
                lit = Math.max(lit, band);
              }
            }
            if (!introDone) {
              const k = easeOut(clamp((introT - (i / N) * 0.62) / 0.38));
              size *= lerp(1, k, heroW);
            }
          }
          if (hiK > 0.002 && hold3 && model.F[3].sector[i] !== hiShown) {
            cb = C.faint;
            ct = hiK * 0.7;
          }
          if (lit > 0.01) {
            ca = ct < 0.5 ? ca : cb;
            cb = C.azure;
            ct = Math.min(1, lit);
          }

          // speed becomes stretch
          let speed = 0;
          if (snap) {
            st[i] = 0;
          } else {
            const vx = (tx - px[i]) / Math.max(dt, 0.008);
            const vy = (ty - py[i]) / Math.max(dt, 0.008);
            speed = Math.sqrt(vx * vx + vy * vy);
            const delta = Math.abs(tx - px[i]) + Math.abs(ty - py[i]);
            if (delta > moving) moving = delta;
            if (speed > 4) va[i] = angLerp(va[i], Math.atan2(-vy, vx), 0.5);
          }
          px[i] = tx;
          py[i] = ty;
          const want = Math.min(size * (seg.fill || seg.exit ? 0.8 : 1.8), speed * 0.016);
          st[i] += (want - st[i]) * kStretch;
          if (a <= 0.003 || size <= 0.05) continue;
          const wv = clamp(st[i] / (size * 0.9));
          const ang = wv > 0.001 ? angLerp(orient, va[i], wv) : orient;
          const len = size * elong * (1 - wv) + st[i];
          if (a !== lastA) {
            ctx.globalAlpha = a;
            lastA = a;
          }
          const col = mix(ca, cb, ct);
          if (col !== lastCol) {
            ctx.strokeStyle = col;
            lastCol = col;
          }
          ctx.lineWidth = size;
          const hl = Math.max(0.01, len / 2);
          const dx = Math.cos(ang) * hl;
          const dy = -Math.sin(ang) * hl;
          ctx.beginPath();
          ctx.moveTo(tx - dx, ty - dy);
          ctx.lineTo(tx + dx, ty + dy);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        primed = true;

        // the pen nib: a point of ink at the head of the writing, on the line being written (4.05 to 4.50). The shader inks
        // each bit over the 0.008 of write time after writeU reaches it, so the nib rides 0.004 behind writeU, at the half
        // inked head, and waits at a line's end until its last letters are fully in; past the last line it stays at its end
        // while it fades.
        if (glOk() && sheet.ready && u > 4.05 && u < 4.5) {
          const nibU = writeU - 0.004;
          const end = model.lines[model.lines.length - 1];
          const L = model.lines.find((l) => nibU >= l.t0 && nibU < l.t1 + 0.004) || (nibU >= end.t1 ? end : null);
          const nibA = 1 - smooth(4.46, 4.5, u);
          if (L && nibA > 0.01) {
            const S = o.sheet;
            const f = Math.min(1, (nibU - L.t0) / Math.max(1e-6, L.t1 - L.t0));
            const x = S.left + ((L.x0 + (L.x1 - L.x0) * f) / LW) * S.w;
            const y = S.top + ((L.ly - 9) / LH) * S.h;
            // the shader's uInk; the sheet's tint spares the ink, so the nib is the same colour in both themes
            ctx.globalAlpha = nibA;
            ctx.fillStyle = "rgb(31,60,116)";
            ctx.beginPath();
            ctx.arc(x, y, 1.6, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
        }

        // overlays over the dots
        drawLabels(ctx, o, smooth(3.1, 3.3, u) * (1 - smooth(3.42, 3.58, u)));
        drawName(ctx, o, smooth(5.7, 5.85, u), exitK);

        drawSheet(u);
        updateDom(u);

        let stretching = false;
        for (let i = 0; i < N; i += 7) if (st[i] > 0.05) { stretching = true; break; }
        const busy =
          !introDone ||
          uS !== uT ||
          crowdW * driftK > 0.001 ||
          ripples.length > 0 ||
          Math.abs(hiK - (hiSector >= 0 && u >= 3.3 && u < 3.6 ? 1 : 0)) > 0.002 ||
          Math.abs(mouse.amt - mouse.target * heroW) > 0.002 ||
          (mouse.amt > 0.01 && (Math.abs(mouse.tx - mouse.x) > 0.3 || Math.abs(mouse.ty - mouse.y) > 0.3)) ||
          moving > 0.03 ||
          stretching;
        if (busy) raf = requestAnimationFrame(frame);
        else last = 0;
      }

      /* ---------- The WebGL sheet ---------- */

      function drawSheet(u) {
        if (!glOk()) return;
        if (u < 3.55 || u > 5.55 || !sheet.ready) {
          if (!glClear) {
            sheet.clear();
            glClear = true;
            glKey = "";
          }
          return;
        }
        computeSheet(u);
        const S = sheetState;
        const key =
          Math.round(S.alpha * 1e4) + "," + Math.round(S.write * 1e4) + "," + Math.round(S.lift * 1e4) + "," + Math.round(S.scale * 1e4) + "," +
          Math.round(S.rx * 1e4) + "," + Math.round(S.rz * 1e4) + "," + Math.round(S.t1 * 1e4) + "," + Math.round(S.t2 * 1e4) + "," +
          Math.round(S.shadow * 1e4) + "," + Math.round(S.tx * 1e4) + "," + Math.round(S.ty * 1e4) + "," +
          S.lab.map((v) => Math.round(v * 1e3)).join(",");
        if (key === glKey) return;
        glKey = key;
        sheet.set(S);
        sheet.draw();
        glClear = S.alpha <= 0.002;
      }

      // The sheet's arrival (its opacity, lift and scale): 3.60 to 3.75, or in dark mode 3.60 to 3.63, so the half-faded light
      // sheet on the dark ground (a flat grey card, the seats on it at their lowest contrast) passes in a few pixels: its
      // opacity is past 0.75 by about 3.611, and its scale and lift land with it.
      const ARRIVE_DARK = 0.03;
      const sheetArr = (u) => easeOut(clamp((u - 3.6) / (palette.dark ? ARRIVE_DARK : 0.15)));
      const sheetIn = sheetArr;
      // The sheet's state at u (5.3 to 5.5): arrive, write, tilt, fold, fly into the rostrum.
      let computedFor = -1;
      function computeSheet(u) {
        if (u === computedFor) return;
        computedFor = u;
        const S = sheetState;
        const arr = sheetArr(u);
        const tilt = easeIO(clamp((u - 4.8) / 0.12));
        // the flight: 5.18 to 5.50, with the packet at its final size in the well by 5.45; it fades over 5.42 to 5.50
        const fl = clamp((u - 5.18) / 0.32);
        const pe = easeIO(clamp((u - 5.18) / 0.28));
        const sf = clamp((u - 5.18) / 0.27);
        const se = sf * sf * (0.6 + 0.4 * sf);
        S.alpha = sheetIn(u) * (1 - clamp((u - 5.42) / 0.08));
        S.write = clamp((u - 4.05) / 0.45);
        S.lift = lerp(0.05, 0, arr) + 0.02 * tilt;
        S.scale = lerp(0.96, 1, arr) * lerp(1, packetScale, se);
        S.rx = lerp(-14 * DEG * tilt, -6 * DEG, pe);
        S.rz = lerp(-2 * DEG * tilt, 5 * DEG, pe);
        S.ry = 0;
        // bottom flap first, then the top flap over it (paper.js: t1 is the bottom third, t2 the top third)
        S.t1 = Math.PI * easeIO(clamp((u - 4.88) / 0.18));
        S.t2 = Math.PI * easeIO(clamp((u - 5.02) / 0.18));
        S.shadow = 1 - clamp((u - 5.18) / 0.12);
        // each printed label stays faint until the seats over it have left (printClears)
        const clears = printClears(model);
        for (let k = 0; k < S.lab.length; k++) S.lab[k] = labA(clears[k], u);
        S.tx = lay ? (rostW.x - lay.x) * pe : 0;
        S.ty = lay ? (rostW.y - lay.y) * pe + Math.sin(Math.PI * fl) * 0.1 : 0;
        S.tz = 0;
      }

      /* ---------- Hero copy and stepper ---------- */

      function activeStep(u) {
        if (u < 1.8) return 0;
        if (u < 2.9) return 1;
        // dark mode with WebGL: the seats turn to the on-paper colour as the sheet arrives, by about 3.611 (inkK in frame()),
        // so step 4 takes over there, and step 3's rubric legend never sits beside seats it no longer describes
        if (u < (onPaperDark ? 3.61 : 3.95)) return 2;
        if (u < 5.18) return 3;
        return 4;
      }

      function updateDom(u) {
        const ds = domState;
        // hero copy: 0.30 to 0.40 (wide) or 0.38 (narrow, where step 1 fades in at the same place from 0.372, so the two
        // cross at about 6% opacity), fades and lifts 16px; its links leave the tab order once it is gone
        const ho = 1 - clamp((u - 0.3) / (wide ? 0.1 : 0.08));
        const hy = -16 * (1 - ho);
        // past the threshold, or landing on an end value: a scroll in coarse steps must not leave the copy at 0.002
        const ends = (v, was) => (v === 0 || v === 1) && v !== was;
        if (Math.abs(ho - ds.heroO) > 0.002 || Math.abs(hy - ds.heroY) > 0.05 || ends(ho, ds.heroO)) {
          heroCopy.style.opacity = ho.toFixed(3);
          heroCopy.style.transform = hy ? "translate3d(0," + hy.toFixed(2) + "px,0)" : "";
          ds.heroO = ho;
          ds.heroY = hy;
        }
        // the well's date: 0.30 to 0.35, gone before the seats leave it
        const wo = 1 - clamp((u - 0.3) / 0.05);
        if (Math.abs(wo - ds.wellO) > 0.002 || ends(wo, ds.wellO)) {
          well.style.opacity = wo.toFixed(3);
          ds.wellO = wo;
        }
        const inert = ho < 0.05;
        if (inert !== ds.heroInert) {
          heroCopy.inert = inert;
          ds.heroInert = inert;
          if (navReg) navReg.classList.toggle("is-hero-quiet", !inert);
        }
        // stepper: from numStart over 0.2 (wide: 0.38 where the chamber's left wing allows, so its column cross-fades with
        // the hero copy; narrow: 0.372). Wide, the titles have their own clock from stepStart (0.38, or later on screens where
        // the wing is still passing them), so the numbers carry that beat. The titles sit inside the column, so --title-o is
        // their clock over the column's entry opacity: the reader sees the titles' own clock (times the exit fade), where a
        // plain product squared it (7% at 0.40 where both start at 0.38). It takes taps and clicks only once its titles are
        // more than half shown.
        // wide, on the way out: the stepper (on the nav's left line) fades over the 0.1 before the Preamble (on the document
        // grid) comes up, and never before 5.95, after step 5's hold, so the two left lines never share the screen
        let xo = 1;
        if (wide && u >= SPAN - 0.1) xo = 1 - smooth(exitA, Math.max(SPAN, exitU), (window.scrollY - storyTop) / Math.max(1, H));
        const no = easeOut(clamp((u - numStart) / 0.2));
        const so = no * xo;
        const to = wide ? Math.min(1, easeOut(clamp((u - stepStart) / 0.2)) / Math.max(no, 1e-3)) : 1;
        if (Math.abs(to - ds.titleO) > 0.002 || ends(to, ds.titleO)) {
          stepper.style.setProperty("--title-o", to.toFixed(3));
          ds.titleO = to;
        }
        const shown = so * to > 0.5;
        if (shown !== ds.shown) {
          stepper.classList.toggle("is-shown", shown);
          ds.shown = shown;
        }
        if (Math.abs(so - ds.stepO) > 0.002 || ends(so, ds.stepO)) {
          stepper.style.opacity = so.toFixed(3);
          stepper.style.transform = wide
            ? "translate3d(" + (-12 * (1 - so)).toFixed(2) + "px,0,0)"
            : "translate3d(0," + (24 * (1 - so)).toFixed(2) + "px,0)";
          ds.stepO = so;
        }
        // wide: step 1's body runs on its own, later clock (bodyStart, 0.48 or later, over 0.14), because its lines sit where
        // the chamber's left wing is still passing when the titles above it are already clear. Inline only while below 1,
        // so the class swap of the bodies is untouched after that.
        const bo = wide ? easeOut(clamp((u - bodyStart) / 0.14)) : 1;
        if ((Math.abs(bo - ds.bodyO) > 0.002 || (bo === 1 && ds.bodyO !== 1)) && stepBodies[0]) {
          stepBodies[0].style.opacity = bo < 1 ? bo.toFixed(3) : "";
          stepBodies[0].style.transition = bo < 1 ? "none" : "";
          ds.bodyO = bo;
        }
        const k = activeStep(u);
        if (k !== ds.active) {
          steps.forEach((s, j) => {
            s.classList.toggle("is-active", j === k);
            if (j === k) stepButtons[j].setAttribute("aria-current", "step");
            else stepButtons[j].removeAttribute("aria-current");
            // desktop stacks the five bodies in one cell: only the shown one takes the pointer (the legend rows' hover)
            if (stepBodies[j]) stepBodies[j].style.pointerEvents = j === k ? "" : "none";
          });
          ds.active = k;
        }
      }

      function wake() {
        if (!alive || raf || !visible || !model) return;
        last = 0;
        raf = requestAnimationFrame(frame);
      }

      /* ---------- Wiring ---------- */

      const offs = [];
      const listen = (t, type, fn, opts) => {
        t.addEventListener(type, fn, opts);
        offs.push(() => t.removeEventListener(type, fn, opts));
      };

      const io = new IntersectionObserver((entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        if (visible) wake();
      });
      io.observe(story);
      listen(
        window,
        "scroll",
        () => {
          lastScrollAt = performance.now();
          noteScroll();
          wake();
        },
        { passive: true }
      );
      listen(doc, "visibilitychange", wake);

      // A touch screen's address bar, where it changes the stage height at all: height gains under 120px at the same width
      // are ignored. Any shrink lays out again (a download bar, devtools, a phone after a growth), so the hero is never
      // laid out for a taller stage than it has; with a mouse, so does any gain.
      const coarse = Boolean(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
      const ro = new ResizeObserver(() => {
        const r = pin.getBoundingClientRect();
        const dh = r.height - lastH;
        if (Math.abs(r.width - lastW) < 1 && (Math.abs(dh) < 1 || (coarse && dh > 0 && dh < 120))) return;
        lastW = r.width;
        lastH = r.height;
        requestLayout();
      });
      ro.observe(pin);
      // A reflow below the story at the same window size (a section that renders as it nears the view, a picture that
      // loads) moves the sections without a scroll: read the reader's place again.
      const roBelow = new ResizeObserver(() => {
        if (!placeRaf) placeRaf = requestAnimationFrame(notePlace);
      });
      below.forEach((el) => roBelow.observe(el));
      const s0 = site();
      // site.js also runs these on window load and once the fonts are ready
      if (s0 && s0.onLayout) offs.push(s0.onLayout(requestLayout));
      if (s0 && s0.onTheme)
        offs.push(
          s0.onTheme(() => {
            if (glOk()) sheet.setTheme(palette.dark, palette.sheetTint);
            glKey = "";
            computedFor = -1; // the sheet's arrival opacity follows the theme (sheetIn)
            primed = false;
            wake();
          })
        );

      listen(
        window,
        "pointermove",
        (e) => {
          if (e.pointerType === "touch" || !visible) return;
          mouse.tx = e.clientX;
          mouse.ty = e.clientY;
          mouse.target = e.clientY > 64 && e.clientY < H ? 1 : 0;
          if (uS < 0.62) wake();
        },
        { passive: true }
      );
      listen(root, "pointerleave", () => {
        mouse.target = 0;
        wake();
      });
      $$(".legend li", stepper).forEach((li, k) => {
        listen(li, "pointerenter", (e) => {
          if (e.pointerType === "touch") return;
          hiSector = k;
          hiShown = k;
          wake();
        });
        listen(li, "pointerleave", () => {
          hiSector = -1;
          wake();
        });
      });
      listen(pin, "pointerdown", (e) => {
        if (e.target.closest("a, button, input, label") || uS >= 0.62) return;
        const r = stage.getBoundingClientRect();
        ripples.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() });
        if (ripples.length > 4) ripples.shift();
        wake();
      });
      // A stepper button that takes focus while the stepper is hidden brings its step into view.
      // On the narrow bottom panel only the active step shows, so focusing another step's button moves the story there.
      listen(stepper, "focusin", (e) => {
        const b = e.target.closest(".step-btn");
        if (!b) return;
        const narrowPanel = window.matchMedia("(max-width: 900px)").matches;
        const li = b.closest(".step");
        if (stepper.classList.contains("is-shown") && !(narrowPanel && li && !li.classList.contains("is-active"))) return;
        goto(Number(b.getAttribute("data-goto")));
      });

      function goto(u, _a, instant) {
        const smoothOk = !instant && root.classList.contains("motion");
        try {
          window.scrollTo({ top: scrollFor(u), behavior: smoothOk ? "smooth" : "auto" });
        } catch (e) {
          window.scrollTo(0, scrollFor(u));
        }
      }

      // Start: layout now, roll call on the first frame; after first paint the textures start, and the sheet is made
      // in the first idle callback.
      story.classList.add("is-live");
      layout();
      if (target() < 0.3) story.classList.add("is-intro");
      requestAnimationFrame(() =>
        setTimeout(() => {
          startTextures();
          idle(() => createSheet(false));
        }, 0)
      );

      return {
        mode: "motion",
        goto,
        scrollFor,
        layout,
        hold,
        state: () => ({
          u: uS,
          target: target(),
          step: domState.active + 1,
          inStory: inStory(),
          // the reader's place below the story, from their last scroll and the last layout (for init's switch of modes)
          place,
          belowBy: storyBottom ? readY - storyBottom : null,
          gl: glOk(),
          sheetReady: Boolean(glOk() && sheet.ready),
          running: Boolean(raf),
          W,
          H,
          wide,
          geo,
          over: model && {
            sheet: model.over.sheet,
            rostrum: model.over.rostrum,
            packet: model.over.packet,
            park: model.over.park
          },
          glBox
        }),
        dots: () => ({ x: Array.from(px), y: Array.from(py) }),
        model: () => model,
        destroy() {
          alive = false;
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          if (lq) cancelAnimationFrame(lq);
          lq = 0;
          if (placeRaf) cancelAnimationFrame(placeRaf);
          placeRaf = 0;
          io.disconnect();
          ro.disconnect();
          roBelow.disconnect();
          offs.forEach((f) => f());
          if (sheet) sheet.destroy();
          story.classList.remove("is-live", "is-intro");
          ["--well-y", "--hero-top", "--step-w", "--step-top", "--step-left"].forEach((p) => story.style.removeProperty(p));
          heroCopy.style.opacity = "";
          heroCopy.style.transform = "";
          heroCopy.inert = false;
          if (navReg) navReg.classList.remove("is-hero-quiet");
          stepper.style.opacity = "";
          stepper.style.transform = "";
          stepper.style.removeProperty("--title-o");
          stepper.classList.remove("is-shown");
          if (legend) legend.classList.remove("is-hi");
          legendRows.forEach((li) => li.classList.remove("is-hi"));
          stepBodies.forEach((b) => {
            if (!b) return;
            b.style.pointerEvents = "";
            b.style.opacity = "";
            b.style.transition = "";
          });
          well.style.opacity = "";
          glCanvas.removeAttribute("style");
          well.classList.remove("is-below", "is-compact");
          const c = stage.getContext("2d");
          c.setTransform(1, 0, 0, 1, 0, 0);
          c.clearRect(0, 0, stage.width, stage.height);
        }
      };
    }

    /* ================================================================== */
    /* Static story (5.7)                                                  */
    /* ================================================================== */

    function Static() {
      story.classList.add("is-static");
      story.classList.remove("is-live", "is-intro");
      // sent here by the fit check: the hero takes the short-screen rules at any height
      story.classList.toggle("is-short", Boolean(tooShort));
      const stops = [];
      let alive = true;

      // Where the reader is, refreshed after each scroll and each reflow at the window size it was read at, so init() can
      // read it after the resize that brought it here has reflowed the page.
      // step: the last row whose top has reached 40% of the window height (0 above the first row).
      // place: the section and block the reader is on below the story (readPlace()), or null; after a restore it stays
      // the place that was restored until the reader scrolls (kept), so turning the phone back brings back the same block.
      // belowBy: the scrollY past the story's end (negative while the story's end is still below the window's top).
      const seen = { step: 0, inStory: false, place: null, belowBy: null };
      const look = (kept) => {
        const h = window.innerHeight;
        const sr = story.getBoundingClientRect();
        seen.inStory = sr.top < h * 0.5 && sr.bottom > h * 0.5;
        if (!kept) seen.place = sr.bottom < h * 0.5 ? readPlace() : null;
        seen.belowBy = -sr.bottom;
        seen.step = 0;
        steps.forEach((row, j) => {
          if (row.getBoundingClientRect().top <= h * 0.4) seen.step = j + 1;
        });
      };
      // A resize that keeps the static story (a phone turned on its side, with reduced motion or too short for the pinned
      // story) brings the reader's block back under the nav: site.js keepPlace(), which also calls look() after each of
      // its reads. A switch to the pinned story brings the reader back itself (destroy() stops the keeper first).
      const keep = S0 && S0.keepPlace ? S0.keepPlace(look) : null;
      if (keep) stops.push(keep.stop);
      else {
        const onScroll = () => look(false);
        window.addEventListener("scroll", onScroll, { passive: true });
        stops.push(() => window.removeEventListener("scroll", onScroll));
        look(false);
      }
      // after a switch of modes has restored place p
      const hold = (p) => {
        if (!keep || !keep.same()) return;
        keep.hold(p.block);
        seen.place = p;
      };

      // The nav's Register button stays quiet while the hero's actions are in view.
      if (navReg && window.IntersectionObserver) {
        const io0 = new IntersectionObserver((e) => navReg.classList.toggle("is-hero-quiet", e[e.length - 1].isIntersecting));
        io0.observe($(".hero-actions"));
        stops.push(() => {
          io0.disconnect();
          navReg.classList.remove("is-hero-quiet");
        });
      }

      // Hero: the chamber drawn complete, no intro and no cursor; the well placed inside it when it fits.
      const heroFig = $('[data-fig="0"]');
      stops.push(
        CH.autoRedraw(heroFig, () => {
          const w = heroFig.clientWidth;
          const h = heroFig.clientHeight;
          if (!w || !h) return;
          const kS = seats(N, Q).pitch * 0.36;
          const R = Math.min(w / 2 / (1 + kS * 0.7), (h - 6) / (1 + kS * 1.2));
          const s = kS * R;
          const cx = w / 2;
          const cy = h - s * 0.7 - 2;
          CH.drawStatic(heroFig, chamber({ cx, cy, R, sizeK: 0.36, e: 0.6, color: C.seat }));
          const p = placeWell(cx, cy, R, s);
          story.style.setProperty("--well-y", p.below ? "auto" : Math.round(p.yc) + "px");
        })
      );

      // Steps 1, 2, 3 and 5: stills of the formations. Rooms are laid out for the plate's shape.
      const geometry = (w, h) => {
        const pad = Math.max(14, Math.min(w, h) * 0.07);
        const R = Math.min((w - pad * 2) / 2, (h - pad * 2) * 0.98);
        return {
          hero: { cx: w / 2, cy: h - pad - (h - pad * 2 - R) / 2, R },
          box: { x: pad, y: pad, w: w - pad * 2, h: h - pad * 2 },
          w,
          h,
          wide: w >= h
        };
      };
      [1, 2, 3, 5].forEach((k) => {
        const c = $('[data-fig="' + k + '"]');
        if (!c) return;
        stops.push(CH.autoRedraw(c, () => CH.drawStatic(c, k, { build, overlay, geometry })));
      });

      // Step 4: the sheet, flat and fully written, tilted back 10 degrees (or a flat picture without WebGL).
      let c4 = $('[data-fig="4"]');
      let sheet4 = null;
      if (c4 && PAPER) {
        const tex = PAPER.textures(window.innerWidth > 900 ? 1 : 0.5);
        try {
          sheet4 = new PAPER.Sheet(c4);
        } catch (e) {
          sheet4 = null;
        }
        let flatImg = null;
        const draw4 = () => {
          if (!alive || !tex.ready || !c4) return;
          const cw = c4.clientWidth;
          const ch = c4.clientHeight;
          if (!cw || !ch) return;
          if (sheet4 && !sheet4.failed) {
            sheet4.setSize(cw, ch);
            const h = ch * 0.8;
            sheet4.rect = { cx: cw / 2, cy: ch / 2 + ch * 0.01, w: (h * LW) / LH };
            sheet4.setTheme(palette.dark, palette.sheetTint);
            sheet4.set({ write: 1, t1: 0, t2: 0, rx: -10 * DEG, ry: 0, rz: -1.5 * DEG, tx: 0, ty: 0, tz: 0, lift: 0, alpha: 1, scale: 1, shadow: 1 });
            sheet4.draw();
          } else {
            if (!flatImg) flatImg = PAPER.composeFlat(tex.front, tex.info, true);
            const ctx = CH.sizeCanvas(c4, cw, ch);
            ctx.clearRect(0, 0, cw, ch);
            const h = ch * 0.84;
            const w = (h * LW) / LH;
            const x = (cw - w) / 2;
            const y = (ch - h) / 2;
            ctx.save();
            ctx.shadowColor = palette.dark ? "rgba(0,0,0,.55)" : "rgba(19,33,42,.18)";
            ctx.shadowBlur = 26;
            ctx.shadowOffsetY = 10;
            ctx.fillStyle = "#fdfdfb";
            ctx.fillRect(x, y, w, h);
            ctx.restore();
            ctx.drawImage(flatImg, x, y, w, h);
            if (palette.dark) {
              // the same cool tint as the WebGL sheet
              ctx.globalCompositeOperation = "multiply";
              ctx.fillStyle = "rgb(" + palette.sheetTint.map((c) => Math.round(c * 255)).join(",") + ")";
              ctx.fillRect(x, y, w, h);
              ctx.globalCompositeOperation = "source-over";
            }
          }
        };
        if (sheet4 && sheet4.failed) {
          // a canvas that tried WebGL may refuse a 2D context: draw the picture on a fresh one
          const fresh = doc.createElement("canvas");
          fresh.setAttribute("data-fig", "4");
          c4.replaceWith(fresh);
          c4 = fresh;
        }
        tex.start().then(() => {
          if (!alive) return;
          if (sheet4 && !sheet4.failed) ["front", "back", "info"].forEach((n) => sheet4.uploadOne(n, tex[n]));
          draw4();
        });
        stops.push(CH.autoRedraw(c4, draw4));
        if (sheet4 && !sheet4.failed) sheet4.onRestore = draw4;
      }

      function goto(u, _a, instant) {
        // the hero link and the step titles go to that step's row
        let k = 1;
        HOLD.forEach((h, j) => {
          if (j && u >= h - 0.01) k = j;
        });
        const row = steps[k - 1];
        if (!row) return;
        try {
          row.scrollIntoView({ behavior: !instant && root.classList.contains("motion") ? "smooth" : "auto", block: "start" });
        } catch (e) {
          row.scrollIntoView();
        }
      }

      return {
        mode: "static",
        goto,
        scrollFor: () => 0,
        layout() {},
        hold,
        state: () => ({ mode: "static", gl: Boolean(sheet4 && !sheet4.failed), step: seen.step, inStory: seen.inStory, place: seen.place, belowBy: seen.belowBy }),
        destroy() {
          alive = false;
          stops.forEach((f) => f());
          if (sheet4) sheet4.destroy();
          story.classList.remove("is-static", "is-short");
          story.style.removeProperty("--well-y");
          well.classList.remove("is-below", "is-compact");
        }
      };
    }

    /* ================================================================== */
    /* Start, and re-initialise when the motion setting or the screen changes */
    /* ================================================================== */

    init();
    const s = site();
    if (s && s.onMotion) s.onMotion(init);
    else if (window.matchMedia) {
      try {
        window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", () => setTimeout(init, 0));
      } catch (e) {}
    }
    try {
      mq.addEventListener("change", init);
    } catch (e) {}
    // A window that was too short for the pinned hero tries the motion story again once it is wider, narrower or taller.
    // Taller means by 120px or more (the address bar rule), so a phone's address bar sliding away never flips a reader
    // from the static story into the pinned one.
    window.addEventListener(
      "resize",
      () => {
        if (tooShort && (Math.abs(window.innerWidth - tooShort.w) > 1 || window.innerHeight - tooShort.h >= 120)) {
          tooShort = null;
          init();
        }
      },
      { passive: true }
    );
    // A fit judged on the fallback font's metrics (the web fonts still loading) is judged once more on the final ones.
    const refit = () => {
      if (tooShort && tooShort.fonts !== "loaded" && doc.fonts.status === "loaded") {
        tooShort = null;
        init();
      }
    };
    if (doc.fonts) {
      if (doc.fonts.ready) doc.fonts.ready.then(refit);
      try {
        doc.fonts.addEventListener("loadingdone", refit);
      } catch (e) {}
    }

    window.UNPCStory = {
      get mode() {
        return mode;
      },
      goto: (u) => api && api.goto(u),
      scrollFor: (u) => (api ? api.scrollFor(u) : 0),
      state: () => (api ? api.state() : null),
      dots: () => (api && api.dots ? api.dots() : null),
      model: () => (api && api.model ? api.model() : null),
      build,
      reinit: () => {
        if (api) api.destroy();
        api = null;
        init();
      }
    };
  }

  // Defer scripts run while readyState is "interactive", before paper.js has run: wait for DOMContentLoaded.
  let booted = false;
  const once = () => {
    if (booted) return;
    booted = true;
    boot();
  };
  if (doc.readyState === "complete") once();
  else {
    doc.addEventListener("DOMContentLoaded", once);
    window.addEventListener("load", once);
  }
})();
