/* UNPC paper: the written resolution as a sheet of paper drawn in WebGL.
   Adapted from the Resolution prototype. The sheet folds in thirds along two soft, rounded creases
   (a cylinder wrap, not a hinge), is lit by one soft light and casts a contact shadow. It carries three
   textures painted in 2D canvas: the printed form, the back of the sheet, and an "info" texture whose
   R channel holds pen ink and G channel the moment each bit of ink is written (B is always 0).
   The story (story.js) drives it: sheet.set(state) then sheet.draw(). Textures are built in idle chunks.
   Exposed as window.UNPCPaper. Classic defer script, no dependencies. */
(function () {
  "use strict";

  var LW = 1024, LH = 1448;          // logical drawing size (A-series proportion)
  var TW = 1024, TH = 2048;          // power-of-two texture size at scale 1 (512 x 1024 at scale 0.5)
  var SY = TH / LH;
  var H = LH / LW;                   // sheet height when width = 1
  var YA = -H / 6, YB = H / 6, L3 = H / 3;
  var R1 = 0.007, R2 = 0.016;        // crease radii; the top flap (second) lies on top of the bottom flap
  var PI = Math.PI, DEG = PI / 180;

  var INK = "#15202a", INK2 = "#4d5964", INK3 = "#65707b";
  var SERIF = '"Source Serif 4", "Iowan Old Style", Georgia, serif';
  var SANS = '"Public Sans", "Segoe UI", system-ui, sans-serif';

  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function rng(seed) { var s = seed >>> 0; return function () { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  /* ------------------------------------------------------------------ */
  /* fonts                                                               */
  /* ------------------------------------------------------------------ */
  var fontsReady = null;
  function loadFonts() {
    if (fontsReady) return fontsReady;
    var list = ['600 22px "Public Sans"', '500 20px "Public Sans"', '400 17px "Public Sans"',
      '400 27px "Source Serif 4"', 'italic 400 30px "Source Serif 4"'];
    var p = (document.fonts && document.fonts.load)
      ? Promise.all(list.map(function (f) { return document.fonts.load(f).catch(function () {}); }))
      : Promise.resolve();
    var t = new Promise(function (res) { setTimeout(res, 2600); });
    fontsReady = Promise.race([p, t]);
    return fontsReady;
  }

  /* ------------------------------------------------------------------ */
  /* the printed form and the handwriting                                */
  /* ------------------------------------------------------------------ */
  // Field and section rule positions, in logical units (1024 x 1448).
  var FORM = {
    team: 236, room: 314, case_: 392,
    sections: [
      { n: "1", t: "The policy", y: 488, lines: [550, 604, 658, 712, 766] },
      { n: "2", t: "Who does what", y: 852, lines: [914, 968, 1022] },
      { n: "3", t: "What changed after the questions", y: 1108, lines: [1170, 1224] }
    ]
  };
  // Every printed rule, for the flat 2D sheet: { y, x0, x1, a (ink alpha), w (width) }.
  function rules() {
    var out = [
      { y: 146, x0: 96, x1: 928, a: 0.85, w: 1.6 },
      { y: FORM.team, x0: 186, x1: 928, a: 0.32, w: 1.2 },
      { y: FORM.room, x0: 186, x1: 470, a: 0.32, w: 1.2 },
      { y: FORM.room, x0: 586, x1: 928, a: 0.32, w: 1.2 },
      { y: FORM.case_, x0: 186, x1: 928, a: 0.32, w: 1.2 }
    ];
    FORM.sections.forEach(function (s) { s.lines.forEach(function (ly) { out.push({ y: ly, x0: 96, x1: 928, a: 0.13, w: 1.1 }); }); });
    out.push({ y: 1316, x0: 96, x1: 928, a: 0.25, w: 1 });
    return out;
  }

  /* Illegible cursive, generated stroke by stroke. Each word is one pen stroke. */
  function cursive(x0, x1, base, xh, r) {
    var strokes = [], x = x0 + r() * 6;
    var kinds = ["n", "n", "e", "e", "o", "l", "e", "g", "i", "n", "o", "l", "u"];
    while (x < x1 - xh * 2.2) {
      var n = 2 + Math.floor(r() * 6), w = xh * 0.66;
      if (x + n * w > x1) n = Math.max(1, Math.floor((x1 - x) / w));
      var pts = [], lx = x, wb = base + (r() - 0.5) * xh * 0.18;
      pts.push([lx - w * 0.35, wb + xh * 0.05]);
      for (var k = 0; k < n; k++) {
        var kind = kinds[Math.floor(r() * kinds.length)], amp = 0.86 + r() * 0.26, lw = w, steps = 16;
        if (kind === "i") lw = w * 0.6;
        for (var s = 1; s <= steps; s++) {
          var t = s / steps, X, Y;
          if (kind === "n") { X = lx + lw * t; Y = wb - xh * amp * Math.sin(PI * t); }
          else if (kind === "u") { X = lx + lw * t - 0.12 * lw * Math.sin(2 * PI * t); Y = wb - xh * amp * (0.5 - 0.5 * Math.cos(2 * PI * t)) * 0.9; }
          else if (kind === "e" || kind === "o") { var hh = kind === "e" ? 0.82 : 1.0; X = lx + lw * t - 0.3 * lw * Math.sin(2 * PI * t); Y = wb - xh * hh * amp * (1 - Math.cos(2 * PI * t)) / 2; }
          else if (kind === "l") { X = lx + lw * t - 0.27 * lw * Math.sin(2 * PI * t); Y = wb - xh * 2.25 * amp * (1 - Math.cos(2 * PI * t)) / 2; }
          else if (kind === "g") { X = lx + lw * t + 0.28 * lw * Math.sin(2 * PI * t); Y = wb + xh * 1.45 * amp * (1 - Math.cos(2 * PI * t)) / 2; }
          else { X = lx + lw * t; Y = wb - xh * 0.62 * amp * Math.sin(PI * t); }
          pts.push([X, Y]);
        }
        lx += lw;
      }
      pts.push([lx + w * 0.3, wb - xh * 0.25]);
      // slant and a little tremor
      for (var j = 0; j < pts.length; j++) {
        var p = pts[j];
        p[0] += (base - p[1]) * 0.3;
        p[1] += Math.sin(j * 0.7 + x * 0.01) * 0.35;
      }
      strokes.push(pts);
      x = lx + xh * (1.05 + r() * 0.7);
    }
    return strokes;
  }

  function strokeLen(pts) { var l = 0; for (var i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; }

  /* The handwriting, generated once: every stroke with its write times, and one entry per written line:
     { ly, x0, x1, t0, t1 }. x in logical units, t normalised over the whole page.
     Team, Room and Case get writing; Date stays blank. */
  var scriptCache = null;
  function script() {
    if (scriptCache) return scriptCache;
    var r = rng(4102026), raw = [];
    function add(x0, x1, base, xh, ly) { raw.push({ ly: ly, strokes: cursive(x0, x1, base, xh, r) }); }
    add(200, 610, FORM.team - 7, 13, FORM.team);
    add(200, 430, FORM.room - 7, 13, FORM.room);
    add(200, 760, FORM.case_ - 7, 13, FORM.case_);
    FORM.sections.forEach(function (sec) {
      sec.lines.forEach(function (ly, i) {
        var end = i === sec.lines.length - 1 ? 420 + r() * 260 : 860 + r() * 60;
        add(104, end, ly - 7, 13.5, ly);
      });
    });
    // measure lengths so writing speed is even; pen lifts take time too
    var total = 0, items = [];
    raw.forEach(function (L) { L.strokes.forEach(function (pts) { var len = strokeLen(pts); items.push({ pts: pts, len: len }); total += len + 40; }); });
    var acc = 0, k = 0, lines = [];
    raw.forEach(function (L) {
      var x0 = Infinity, x1 = -Infinity, t0 = 1, t1 = 0;
      L.strokes.forEach(function () {
        var it = items[k++];
        it.t0 = acc / total;
        it.t1 = (acc + it.len) / total;
        acc += it.len + 40;
        if (it.t0 < t0) t0 = it.t0;
        if (it.t1 > t1) t1 = it.t1;
        for (var i = 0; i < it.pts.length; i++) { var x = it.pts[i][0]; if (x < x0) x0 = x; if (x > x1) x1 = x; }
      });
      lines.push({ ly: L.ly, x0: x0, x1: x1, t0: t0, t1: t1 });
    });
    scriptCache = { items: items, lines: lines };
    return scriptCache;
  }
  function lines() { return script().lines; }

  /* ------------------------------------------------------------------ */
  /* texture painting                                                    */
  /* ------------------------------------------------------------------ */
  function canvas2d(scale, read) {
    var c = document.createElement("canvas");
    c.width = Math.round(TW * scale); c.height = Math.round(TH * scale);
    var x = c.getContext("2d", read ? { willReadFrequently: true } : undefined);
    x.setTransform(scale, 0, 0, SY * scale, 0, 0);
    return { c: c, x: x };
  }

  function paperGround(x, base, seed) {
    x.fillStyle = base;
    x.fillRect(0, 0, LW, LH);
    var r = rng(seed), i;
    // a very soft tonal drift, as in real stock
    var g = x.createLinearGradient(0, 0, LW, LH);
    g.addColorStop(0, "rgba(255,255,255,0.35)");
    g.addColorStop(1, "rgba(120,130,140,0.05)");
    x.fillStyle = g; x.fillRect(0, 0, LW, LH);
    for (i = 0; i < 3200; i++) {
      x.fillStyle = "rgba(40,50,60," + (r() * 0.05).toFixed(3) + ")";
      x.fillRect(r() * LW, r() * LH, 0.6 + r() * 1.3, 0.6 + r() * 1.3);
    }
    x.lineWidth = 0.6;
    for (i = 0; i < 260; i++) {
      var px = r() * LW, py = r() * LH, a = r() * PI * 2, l = 6 + r() * 18;
      x.strokeStyle = "rgba(60,72,84," + (0.025 + r() * 0.04).toFixed(3) + ")";
      x.beginPath(); x.moveTo(px, py);
      x.quadraticCurveTo(px + Math.cos(a + 0.6) * l * 0.5, py + Math.sin(a + 0.6) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l);
      x.stroke();
    }
  }

  function rule(x, x0, x1, y, alpha, w) {
    x.strokeStyle = "rgba(21,32,42," + alpha + ")";
    x.lineWidth = w || 1.2;
    x.beginPath(); x.moveTo(x0, y); x.lineTo(x1, y); x.stroke();
  }

  // The printed form: the paper, then the print (two parts, so the builder can paint them in separate chunks).
  function paintFront(scale) {
    var k = canvas2d(scale || 1);
    paperGround(k.x, "#fdfdfb", 7);
    printFront(k.x);
    return k.c;
  }
  function printFront(x) {
    x.textBaseline = "alphabetic";
    x.fillStyle = INK;
    x.font = "600 22px " + SANS;
    x.fillText("Uzbekistan National Policy Competition", 96, 118);
    x.textAlign = "right";
    x.font = "italic 400 30px " + SERIF;
    x.fillText("Written resolution", 928, 118);
    x.textAlign = "left";
    rule(x, 96, 928, 146, 0.85, 1.6);

    x.font = "500 20px " + SANS; x.fillStyle = INK2;
    x.fillText("Team", 96, FORM.team - 6); rule(x, 186, 928, FORM.team, 0.32);
    x.fillText("Room", 96, FORM.room - 6); rule(x, 186, 470, FORM.room, 0.32);
    x.fillText("Date", 520, FORM.room - 6); rule(x, 586, 928, FORM.room, 0.32);
    x.fillText("Case", 96, FORM.case_ - 6); rule(x, 186, 928, FORM.case_, 0.32);

    FORM.sections.forEach(function (s) {
      x.fillStyle = INK3; x.font = "400 28px " + SERIF; x.fillText(s.n, 96, s.y);
      x.fillStyle = INK; x.font = "400 27px " + SERIF; x.fillText(s.t, 132, s.y);
      s.lines.forEach(function (ly) { rule(x, 96, 928, ly, 0.13, 1.1); });
    });

    rule(x, 96, 928, 1316, 0.25, 1);
    x.fillStyle = INK3; x.font = "400 17px " + SANS;
    x.fillText("Hand in at the end of the round. 5 to 10 minutes.", 96, 1358);
    x.textAlign = "right"; x.fillStyle = INK; x.font = "400 26px " + SERIF;
    x.fillText("UNPC", 928, 1360);
    x.textAlign = "left";
  }

  // The back. The top third is printed upside down, so it reads correctly once the sheet is folded.
  function paintBack(scale) {
    var k = canvas2d(scale || 1);
    paperGround(k.x, "#f1f2ef", 19);
    printBack(k.x);
    return k.c;
  }
  function printBack(x) {
    var h = LH / 3;
    x.save();
    x.translate(0, h); x.scale(1, -1);
    x.textAlign = "center";
    x.fillStyle = INK; x.font = "600 24px " + SANS;
    x.fillText("Uzbekistan National Policy Competition", LW / 2, 214);
    x.fillStyle = INK2; x.font = "italic 400 40px " + SERIF;
    x.fillText("Written resolution", LW / 2, 280);
    x.restore();
  }

  // Ink and write-time canvases (two separate greyscale canvases; packed later).
  // inkCanvas and timeCanvas make them (one each, so the builder can make them in separate chunks); inkStrokes draws
  // script().items[i0, i1) into the pair, so the builder can spread the strokes over chunks too.
  function inkCanvas(scale) {
    var k = canvas2d(scale || 1, true);
    k.x.fillStyle = "#000"; k.x.fillRect(0, 0, LW, LH);
    k.x.lineCap = "round"; k.x.lineJoin = "round";
    return k;
  }
  function timeCanvas(scale) {
    var k = canvas2d(scale || 1, true);
    k.x.fillStyle = "#fff"; k.x.fillRect(0, 0, LW, LH);
    k.x.lineCap = "round"; k.x.lineJoin = "round";
    k.x.globalCompositeOperation = "darken";
    return k;
  }
  function inkPair(ink, tim) { return { ink: ink.c, tim: tim.c, ix: ink.x, tx: tim.x }; }
  function inkStrokes(src, i0, i1) {
    var items = script().items, end = Math.min(i1, items.length);
    for (var n = i0; n < end; n++) {
      var it = items[n], p = it.pts;
      src.ix.strokeStyle = "#fff"; src.ix.lineWidth = 2.1;
      src.ix.beginPath(); src.ix.moveTo(p[0][0], p[0][1]);
      for (var i = 1; i < p.length - 1; i++) {
        var mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
        src.ix.quadraticCurveTo(p[i][0], p[i][1], mx, my);
      }
      src.ix.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
      src.ix.stroke();
      var run = 0;
      src.tx.lineWidth = 6;
      for (var j = 1; j < p.length; j++) {
        run += Math.hypot(p[j][0] - p[j - 1][0], p[j][1] - p[j - 1][1]);
        var v = Math.round(255 * lerp(it.t0, it.t1, run / it.len));
        src.tx.strokeStyle = "rgb(" + v + "," + v + "," + v + ")";
        src.tx.beginPath(); src.tx.moveTo(p[j - 1][0], p[j - 1][1]); src.tx.lineTo(p[j][0], p[j][1]); src.tx.stroke();
      }
    }
    // read one pixel of each, so these strokes are rasterised now, in this chunk, and not all at once by the first packRows
    src.ix.getImageData(0, 0, 1, 1); src.tx.getImageData(0, 0, 1, 1);
  }
  function paintInk(scale) {
    var src = inkPair(inkCanvas(scale), timeCanvas(scale));
    inkStrokes(src, 0, script().items.length);
    return src;
  }

  // The info texture is packed on the CPU into one ImageData (WebGL uploads it as it is). Packing into a canvas
  // instead queues a GPU pixel write per chunk, and the first texture upload then waits for all of them.
  function infoImage(src) { return src.ix.createImageData(src.ink.width, src.ink.height); }
  // Pack rows [y0, y1) of the ink and time canvases into out (an ImageData): R = ink, G = time, B = 0.
  function packRows(src, out, y0, y1) {
    var w = out.width, h = Math.min(y1, out.height) - y0;
    if (h <= 0) return;
    var di = src.ix.getImageData(0, y0, w, h).data;
    var dt = src.tx.getImageData(0, y0, w, h).data;
    var d = out.data, o = y0 * w * 4;
    for (var q = 0; q < di.length; q += 4) { d[o + q] = di[q]; d[o + q + 1] = dt[q]; d[o + q + 2] = 0; d[o + q + 3] = 255; }
  }

  function paintInfo(scale) {
    var src = paintInk(scale), img = infoImage(src);
    packRows(src, img, 0, img.height);
    var out = document.createElement("canvas"); out.width = img.width; out.height = img.height;
    out.getContext("2d").putImageData(img, 0, 0);
    return out;
  }

  /* A flat 2D picture of the sheet, for browsers without WebGL: the front, with the ink when asked.
     info is the builder's ImageData, or a canvas (paintInfo). */
  function composeFlat(front, info, withInk) {
    var c = document.createElement("canvas"); c.width = LW; c.height = LH;
    var x = c.getContext("2d");
    x.drawImage(front, 0, 0, LW, LH);
    if (withInk && info) {
      var t = document.createElement("canvas"); t.width = info.width; t.height = info.height;
      var tx = t.getContext("2d");
      var src = info.data ? info : info.getContext("2d").getImageData(0, 0, info.width, info.height), o = tx.createImageData(info.width, info.height);
      for (var i = 0; i < o.data.length; i += 4) {
        var ink = src.data[i] / 255;
        o.data[i] = 31; o.data[i + 1] = 60; o.data[i + 2] = 116; o.data[i + 3] = ink * 0.92 * 255;
      }
      tx.putImageData(o, 0, 0);
      x.drawImage(t, 0, 0, LW, LH);
    }
    return c;
  }

  /* ------------------------------------------------------------------ */
  /* texture builder: idle chunks, or all at once when the story needs it */
  /* ------------------------------------------------------------------ */
  var builders = {};
  function textures(scale) {
    scale = scale || 1;
    if (builders[scale]) return builders[scale];
    var b = { scale: scale, ready: false, front: null, back: null, info: null, started: false, waiters: [] };
    var src = null, front = null, back = null, ink = null, tim = null, queue = [];
    var rowsPer = 64, strokesPer = 6;
    var fontsOk = false;
    var longest = 0; // the longest task so far, in ms: an idle period starts another task only if it has that much left
    // small tasks: each side is the paper then the print; the ink begins with its two canvases, one a task,
    // then takes 6 strokes a task, then the packing
    function plan() {
      queue = [
        function () { front = canvas2d(scale); paperGround(front.x, "#fdfdfb", 7); },
        function () { printFront(front.x); b.front = front.c; front = null; },
        function () { back = canvas2d(scale); paperGround(back.x, "#f1f2ef", 19); },
        function () { printBack(back.x); b.back = back.c; back = null; },
        function () { ink = inkCanvas(scale); },
        function () { tim = timeCanvas(scale); },
        function () {
          src = inkPair(ink, tim); ink = null; tim = null;
          b._info = infoImage(src);
          var more = [], count = script().items.length, rows = b._info.height, i, y;
          for (i = 0; i < count; i += strokesPer) {
            (function (i0) { more.push(function () { inkStrokes(src, i0, i0 + strokesPer); }); })(i);
          }
          for (y = 0; y < rows; y += rowsPer) {
            (function (y0) { more.push(function () { packRows(src, b._info, y0, y0 + rowsPer); }); })(y);
          }
          queue.splice.apply(queue, [queue.length - 1, 0].concat(more));
        },
        function () { b.info = b._info; src = null; b.ready = true; var w = b.waiters; b.waiters = []; w.forEach(function (fn) { try { fn(b); } catch (e) { if (window.console) console.error(e); } }); }
      ];
    }
    function idle(fn) {
      if (window.requestIdleCallback) window.requestIdleCallback(fn, { timeout: 300 });
      else setTimeout(fn, 300);
    }
    // as many tasks as the idle period has room for (another one starts only while the time left is more than the longest
    // task so far, so the period is not overrun); when it timed out (a busy page leaves no idle time), about 8ms of them,
    // since one small task per timeout would barely move. The queue may have been emptied by pump or finish.
    function step(dl) {
      if (!queue.length) return;
      var t0 = performance.now(), t = t0, now;
      do {
        queue.shift()();
        now = performance.now();
        if (now - t > longest) longest = now - t;
        t = now;
      } while (queue.length && (dl && !dl.didTimeout ? dl.timeRemaining() > Math.max(10, longest) : now - t0 < 8));
      if (queue.length) idle(step);
    }
    // start the idle chain after the fonts the form uses have loaded
    b.start = function () {
      if (b.started) return b;
      b.started = true;
      plan();
      loadFonts().then(function () { fontsOk = true; if (queue.length) idle(step); });
      return b;
    };
    // one task now: the story calls it from its frame loop as the reader nears the sheet, since the loop leaves little idle time
    b.pump = function () { if (fontsOk && queue.length) queue.shift()(); };
    // finish everything now, in this frame (used once if the story reaches the sheet first)
    b.finish = function () {
      if (b.ready) return b;
      if (!b.started) { b.started = true; plan(); }
      while (queue.length) queue.shift()();
      return b;
    };
    b.then = function (fn) { if (b.ready) fn(b); else b.waiters.push(fn); return b; };
    builders[scale] = b;
    return b;
  }

  /* ------------------------------------------------------------------ */
  /* WebGL                                                               */
  /* ------------------------------------------------------------------ */
  var VS = [
    "attribute vec2 aPos;",
    "uniform mat4 uPV; uniform mat4 uM; uniform mat3 uN;",
    "uniform float uT1, uT2, uR1, uR2, uYA, uYB, uH;",
    "varying vec2 vUv; varying vec3 vN; varying float vPy; varying float vLy; varying float vCr;",
    "void main(){",
    "  float y = aPos.y; float py = y; float z = 0.0; vec3 n = vec3(0.0, 0.0, 1.0); float cr = 0.0;",
    "  if (y < uYA) {",
    "    float d = uYA - y; float th = uT1; float r = uR1;",
    "    if (d <= th * r) { float ph = d / r; py = uYA - r * sin(ph); z = r - r * cos(ph); n = vec3(0.0, sin(ph), cos(ph)); cr = sin(ph * 0.5 + 0.0001); }",
    "    else { float ex = d - th * r; py = uYA - r * sin(th) - ex * cos(th); z = r - r * cos(th) + ex * sin(th); n = vec3(0.0, sin(th), cos(th)); }",
    "  } else if (y > uYB) {",
    "    float d = y - uYB; float th = uT2; float r = uR2;",
    "    if (d <= th * r) { float ph = d / r; py = uYB + r * sin(ph); z = r - r * cos(ph); n = vec3(0.0, -sin(ph), cos(ph)); cr = sin(ph * 0.5 + 0.0001); }",
    "    else { float ex = d - th * r; py = uYB + r * sin(th) + ex * cos(th); z = r - r * cos(th) + ex * sin(th); n = vec3(0.0, -sin(th), cos(th)); }",
    "  }",
    "  gl_Position = uPV * (uM * vec4(aPos.x, py, z, 1.0));",
    "  vN = uN * n;",
    "  vUv = vec2(aPos.x + 0.5, (uH * 0.5 - y) / uH);",
    "  vPy = py; vLy = y; vCr = cr;",
    "}"
  ].join("\n");

  var FS = [
    "precision highp float;",
    "uniform sampler2D uFront; uniform sampler2D uBack; uniform sampler2D uInfo;",
    "uniform float uWrite, uAlpha, uT1, uT2, uYA, uYB, uL3;",
    "uniform vec3 uLight, uInk, uTint;",
    "varying vec2 vUv; varying vec3 vN; varying float vPy; varying float vLy; varying float vCr;",
    "void main(){",
    "  vec3 n = normalize(vN); vec3 col;",
    "  if (gl_FrontFacing) {",
    "    col = texture2D(uFront, vUv).rgb;",
    "    col *= mix(vec3(1.0), uTint, dot(col, vec3(0.3333)));", // the tint takes the paper, not the dark print
    "    vec4 info = texture2D(uInfo, vUv);",
    "    float ink = info.r * (1.0 - smoothstep(uWrite - 0.008, uWrite, info.g));",
    "    col = mix(col, uInk, clamp(ink, 0.0, 1.0) * 0.92);",
    "  } else { col = mix(texture2D(uBack, vUv).rgb, texture2D(uFront, vUv).rgb, 0.07); col *= mix(vec3(1.0), uTint, dot(col, vec3(0.3333))); n = -n; col *= 1.0 + 0.06 * (1.0 - smoothstep(0.0, 0.04, min(abs(vLy - uYA), abs(vLy - uYB)))); }",
    "  float hl = dot(n, normalize(uLight)) * 0.5 + 0.5;",
    "  float sh = 0.835 + 0.22 * hl - 0.05 * vCr;",
    "  float s = 0.0;",
    "  if (vLy >= uYA && vLy <= uYB) {",
    "    float tip1 = max(uYA - uL3 * cos(uT1), uYA + 0.015);",
    "    s += 0.24 * sin(uT1) * (1.0 - smoothstep(tip1 - 0.01, tip1 + 0.07, vPy)) * step(uYA, vPy);",
    "  }",
    "  if (vLy <= uYB) {",
    "    float tip2 = min(uYB + uL3 * cos(uT2), uYB - 0.015);",
    "    s += 0.24 * sin(uT2) * smoothstep(tip2 - 0.07, tip2 + 0.01, vPy) * step(vPy, uYB + 0.002);",
    "  }",
    "  sh *= 1.0 - clamp(s, 0.0, 0.4);",
    "  gl_FragColor = vec4(col * sh * uAlpha, uAlpha);",
    "}"
  ].join("\n");

  var SVS = [
    "attribute vec2 aQ; uniform mat4 uPV; uniform mat4 uM; uniform vec4 uRect; uniform float uPad;",
    "varying vec2 vP;",
    "void main(){ vec2 p = uRect.xy + aQ * (uRect.zw + vec2(uPad)); vP = p; gl_Position = uPV * (uM * vec4(p, 0.0, 1.0)); }"
  ].join("\n");
  var SFS = [
    "precision highp float; varying vec2 vP; uniform vec4 uRect; uniform float uBlur; uniform float uStrength; uniform vec3 uCol;",
    "float box(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }",
    "void main(){ float d = box(vP - uRect.xy, uRect.zw); float a = (1.0 - smoothstep(-uBlur, uBlur, d)) * uStrength; gl_FragColor = vec4(uCol * a, a); }"
  ].join("\n");

  // column-major 4x4 matrices
  function I() { var m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; }
  function mul(a, b) { var o = new Float32Array(16); for (var c = 0; c < 4; c++) for (var r = 0; r < 4; r++) { var s = 0; for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function T(x, y, z) { var m = I(); m[12] = x; m[13] = y; m[14] = z; return m; }
  function S(s) { var m = I(); m[0] = m[5] = m[10] = s; return m; }
  function RX(a) { var m = I(), c = Math.cos(a), s = Math.sin(a); m[5] = c; m[6] = s; m[9] = -s; m[10] = c; return m; }
  function RY(a) { var m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[2] = -s; m[8] = s; m[10] = c; return m; }
  function RZ(a) { var m = I(), c = Math.cos(a), s = Math.sin(a); m[0] = c; m[1] = s; m[4] = -s; m[5] = c; return m; }
  function P(fov, asp, n, f) { var m = new Float32Array(16), t = 1 / Math.tan(fov / 2); m[0] = t / asp; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = 2 * f * n / (n - f); return m; }
  function N3(r) { return new Float32Array([r[0], r[1], r[2], r[4], r[5], r[6], r[8], r[9], r[10]]); }

  var FOV = 30 * DEG, CAM = 4;
  var VH = 2 * CAM * Math.tan(FOV / 2); // world units visible vertically at the desk (z = 0)

  /* Software WebGL (no usable GPU) rasterises on the CPU, where multisampling costs a whole frame. Probe once. */
  var software = null;
  function softwareGL() {
    if (software !== null) return software;
    software = false;
    try {
      var c = document.createElement("canvas"), g = c.getContext("webgl");
      if (g) {
        var d = g.getExtension("WEBGL_debug_renderer_info");
        var name = d ? String(g.getParameter(d.UNMASKED_RENDERER_WEBGL)) : "";
        software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(name);
        var lose = g.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
    } catch (e) {}
    return software;
  }

  /* The sheet. new Sheet(canvas). sheet.failed is true when WebGL (or its shaders) is unavailable.
     sheet.setSize(cssW, cssH) caches the canvas box (read on layout only, never per frame).
     sheet.rect = { cx, cy, w } in canvas CSS px: where the flat sheet sits (see layoutFromRect). */
  function Sheet(canvas) {
    this.canvas = canvas;
    this.st = { t1: 0, t2: 0, write: 0, rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0, lift: 0, alpha: 1, scale: 1, shadow: 1 };
    this.dark = false;
    this.tint = [1, 1, 1];
    this.cw = 0; this.ch = 0;
    this.rect = null;
    this.ready = false;
    var gl = null, aa = !softwareGL();
    try {
      gl = canvas.getContext("webgl", { antialias: aa, alpha: true, premultipliedAlpha: true, powerPreference: "low-power" }) ||
           canvas.getContext("experimental-webgl", { antialias: aa, alpha: true, premultipliedAlpha: true });
    } catch (e) { gl = null; }
    if (!gl) { this.failed = true; return; }
    this.gl = gl;
    var self = this;
    this._lost = function (e) { e.preventDefault(); self.lost = true; if (self.onLost) self.onLost(); };
    this._restored = function () { self.lost = false; self.init(); self.upload(); if (self.onRestore) self.onRestore(); };
    canvas.addEventListener("webglcontextlost", this._lost, false);
    canvas.addEventListener("webglcontextrestored", this._restored, false);
    this.init();
  }

  Sheet.prototype.init = function () {
    var gl = this.gl;
    function sh(type, src) { var s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    function prog(v, f) { var p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, v)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); return p; }
    try {
      this.p = prog(VS, FS);
      this.sp = prog(SVS, SFS);
    } catch (e) { this.failed = true; if (window.console) console.warn("paper: shader", e); return; }
    var p = this.p, sp = this.sp, u = {}, su = {};
    ["uPV", "uM", "uN", "uT1", "uT2", "uR1", "uR2", "uYA", "uYB", "uH", "uFront", "uBack", "uInfo", "uWrite", "uTint", "uAlpha", "uL3", "uLight", "uInk"]
      .forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    ["uPV", "uM", "uRect", "uPad", "uBlur", "uStrength", "uCol"].forEach(function (n) { su[n] = gl.getUniformLocation(sp, n); });
    this.u = u; this.su = su;
    this.aPos = gl.getAttribLocation(p, "aPos");
    this.aQ = gl.getAttribLocation(sp, "aQ");

    // a strip of rows, dense near the two creases
    var ys = [], y;
    for (y = -H / 2; y <= H / 2 + 1e-6; y += 0.012) ys.push(y);
    for (y = YA - 0.064; y <= YA + 0.004; y += 0.0012) ys.push(y);
    for (y = YB - 0.004; y <= YB + 0.064; y += 0.0012) ys.push(y);
    ys.push(YA, YB, H / 2);
    ys = ys.filter(function (v) { return v >= -H / 2 - 1e-6 && v <= H / 2 + 1e-6; }).sort(function (a, b) { return a - b; });
    var uniq = [];
    ys.forEach(function (v) { if (!uniq.length || v - uniq[uniq.length - 1] > 1e-5) uniq.push(v); });
    var verts = new Float32Array(uniq.length * 4), idx = [];
    uniq.forEach(function (v, i) { verts[i * 4] = -0.5; verts[i * 4 + 1] = v; verts[i * 4 + 2] = 0.5; verts[i * 4 + 3] = v; });
    for (var i = 0; i < uniq.length - 1; i++) { var a = i * 2, b = a + 1, c = a + 3, d = a + 2; idx.push(a, b, c, a, c, d); }
    this.count = idx.length;
    this.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.vb); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    this.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW);
    this.qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.qb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]), gl.STATIC_DRAW);
    this.aniso = gl.getExtension("EXT_texture_filter_anisotropic") || gl.getExtension("WEBKIT_EXT_texture_filter_anisotropic");
    // read once here: a getParameter in each upload is a round trip that waits for all queued GPU work
    this.anisoMax = this.aniso ? Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)) : 0;
    this.tex = {};
  };

  Sheet.prototype.setTextures = function (front, back, info) {
    this.src = { front: front, back: back, info: info };
    this.upload();
  };

  // Upload one texture (name: front, back or info), so the story can spread uploads over idle frames.
  Sheet.prototype.uploadOne = function (name, img) {
    if (this.failed) return;
    var gl = this.gl, self = this;
    this.src = this.src || {};
    this.src[name] = img;
    if (this.tex[name]) gl.deleteTexture(this.tex[name]);
    var t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    var pot = (img.width & (img.width - 1)) === 0 && (img.height & (img.height - 1)) === 0;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (pot) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (self.aniso && self.anisoMax) gl.texParameterf(gl.TEXTURE_2D, self.aniso.TEXTURE_MAX_ANISOTROPY_EXT, self.anisoMax);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    this.tex[name] = t;
    this.ready = Boolean(this.tex.front && this.tex.back && this.tex.info);
  };

  Sheet.prototype.upload = function () {
    if (this.failed || !this.src) return;
    var self = this;
    this.tex = {};
    ["front", "back", "info"].forEach(function (n) { if (self.src[n]) self.uploadOne(n, self.src[n]); });
  };

  Sheet.prototype.set = function (o) { for (var k in o) this.st[k] = o[k]; };
  /* tint: what the white of the paper is multiplied by, as [r, g, b] in 0..1 or one number. The dark print and the pen ink
     keep their full strength. Dark mode's default is a cool off-white taken from the ground's hue. */
  var DARK_TINT = [0.863, 0.89, 0.906];
  Sheet.prototype.setTheme = function (dark, tint) {
    this.dark = Boolean(dark);
    if (tint == null) tint = dark ? DARK_TINT : 1;
    this.tint = typeof tint === "number" ? [tint, tint, tint] : [tint[0], tint[1], tint[2]];
  };
  Sheet.prototype.setSize = function (cw, ch) { this.cw = cw; this.ch = ch; };

  // CSS px per world unit at the desk (z = 0), for the cached canvas height.
  Sheet.prototype.pxPerWorld = function () { return (this.ch || 1) / VH; };

  /* Pixel-exact mapping: a flat sheet at z = 0 whose width is rect.w CSS px, centred at rect.cx, rect.cy
     (canvas CSS px). Returns { s, x, y } in world units. */
  Sheet.prototype.layoutFromRect = function (rect) {
    var ppw = this.pxPerWorld(), cw = this.cw || 1, ch = this.ch || 1;
    if (!rect) return { s: Math.min(VH * 0.86 / H, VH * (cw / ch) * 0.9), x: 0, y: 0 };
    return { s: rect.w / ppw, x: (rect.cx - cw / 2) / ppw, y: -(rect.cy - ch / 2) / ppw };
  };
  // A point in canvas CSS px, as world units at the desk.
  Sheet.prototype.toWorld = function (px, py) {
    var ppw = this.pxPerWorld();
    return { x: (px - (this.cw || 1) / 2) / ppw, y: -(py - (this.ch || 1) / 2) / ppw };
  };

  Sheet.prototype.clear = function () {
    if (this.failed || this.lost) return;
    var gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  };

  Sheet.prototype.size = function () {
    var c = this.canvas, dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = Math.max(1, Math.round((this.cw || 1) * dpr)), h = Math.max(1, Math.round((this.ch || 1) * dpr));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { w: w, h: h };
  };

  Sheet.prototype.draw = function () {
    if (this.failed || !this.ready || this.lost) return;
    var gl = this.gl, st = this.st, u = this.u, su = this.su;
    var sz = this.size();
    var asp = (this.cw || 1) / (this.ch || 1);
    var lay = this.layoutFromRect(this.rect);
    gl.viewport(0, 0, sz.w, sz.h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (st.alpha <= 0.002) return;
    var PV = mul(P(FOV, asp, 0.5, 40), T(0, 0, -CAM));
    var s = lay.s * st.scale;
    var R = mul(RZ(st.rz), mul(RY(st.ry), RX(st.rx)));
    var M = mul(T(lay.x + st.tx, lay.y + st.ty, st.tz + st.lift), mul(R, S(s)));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // shadow on the page, under the folded footprint
    var bottom = YA - L3 * Math.max(Math.cos(st.t1), 0), top = YB + L3 * Math.max(Math.cos(st.t2), 0);
    var lift = st.lift, k = st.shadow * Math.pow(st.alpha, 4); // the shadow only once the sheet is nearly opaque, so it never greys the ground
    if (k > 0.01) {
      gl.disable(gl.DEPTH_TEST);
      gl.useProgram(this.sp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.qb);
      gl.enableVertexAttribArray(this.aQ);
      gl.vertexAttribPointer(this.aQ, 2, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(su.uPV, false, PV);
      // dark mode: a deeper, black shadow, since one in the ground's own colour does not show on a dark ground
      var base = this.dark ? 1 : 0.2;
      var layers = [[0.008 + lift * 0.1, base * 0.9, 0.004, -0.006], [0.06 + lift * 0.5, base * 0.75, 0.02 + lift * 0.35, -0.035 - lift * 0.45]];
      for (var i = 0; i < 2; i++) {
        var L = layers[i];
        var SM = mul(T(lay.x + st.tx + L[2] * s, lay.y + st.ty + L[3] * s, st.tz - 0.003), mul(R, S(s)));
        gl.uniformMatrix4fv(su.uM, false, SM);
        gl.uniform4f(su.uRect, 0, (top + bottom) / 2, 0.5 - L[0] * 0.3, (top - bottom) / 2 - L[0] * 0.3);
        gl.uniform1f(su.uPad, L[0] * 2.2);
        gl.uniform1f(su.uBlur, L[0]);
        gl.uniform1f(su.uStrength, L[1] * k * (1 - clamp(lift * 3, 0, 0.7)));
        if (this.dark) gl.uniform3f(su.uCol, 0, 0, 0); else gl.uniform3f(su.uCol, 0.03, 0.07, 0.1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      gl.disableVertexAttribArray(this.aQ);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(this.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vb);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ib);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniformMatrix4fv(u.uPV, false, PV);
    gl.uniformMatrix4fv(u.uM, false, M);
    gl.uniformMatrix3fv(u.uN, false, N3(R));
    gl.uniform1f(u.uT1, st.t1); gl.uniform1f(u.uT2, st.t2);
    gl.uniform1f(u.uR1, R1); gl.uniform1f(u.uR2, R2);
    gl.uniform1f(u.uYA, YA); gl.uniform1f(u.uYB, YB); gl.uniform1f(u.uH, H); gl.uniform1f(u.uL3, L3);
    gl.uniform1f(u.uWrite, lerp(-0.01, 1.01, st.write));
    gl.uniform3f(u.uTint, this.tint[0], this.tint[1], this.tint[2]);
    gl.uniform1f(u.uAlpha, st.alpha);
    gl.uniform3f(u.uLight, -0.35, 0.55, 0.9);
    gl.uniform3f(u.uInk, 0.12, 0.235, 0.455);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex.front); gl.uniform1i(u.uFront, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.tex.back); gl.uniform1i(u.uBack, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.tex.info); gl.uniform1i(u.uInfo, 2);
    gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(this.aPos);
  };

  Sheet.prototype.destroy = function () {
    if (this.canvas) {
      this.canvas.removeEventListener("webglcontextlost", this._lost, false);
      this.canvas.removeEventListener("webglcontextrestored", this._restored, false);
    }
    if (this.gl && !this.failed) {
      var gl = this.gl, self = this;
      ["front", "back", "info"].forEach(function (n) { if (self.tex && self.tex[n]) gl.deleteTexture(self.tex[n]); });
      this.tex = {};
      this.ready = false;
    }
  };

  window.UNPCPaper = {
    LW: LW, LH: LH, H: H, YA: YA, YB: YB, FOV: FOV, CAM: CAM, DEG: DEG,
    FORM: FORM,
    rules: rules,
    lines: lines,
    script: script,
    loadFonts: loadFonts,
    paintFront: paintFront,
    paintBack: paintBack,
    paintInfo: paintInfo,
    composeFlat: composeFlat,
    textures: textures,
    Sheet: Sheet
  };
})();
