// Deterministic capture of the UNPC chamber showcase from the real build (design-to-motion C1). Scratch only.
// Usage: NODE_PATH=$(npm root -g) node capture.js --out DIR [--theme light|dark] [--frames N] [--pre P]
//        [--save all|none|LIST|A-B] [--dpr 1.3333] [--date YYYY-MM-DD] [--well show|hide]
// Frame i is saved as DIR/%05d.png; DIR/frames.json holds per-frame loop time, u, story state and a hash of the pixels.
// The export window starts at frame P (loop time 0, right after __start) and spans 1632 frames (27.2 s at 60 fps).
const { chromium } = require('playwright');
const { routeAnyFonts } = require('./fontroute.js');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('out', path.join(__dirname, 'frames-light')));
const THEME = arg('theme', 'light');
const PRE = +arg('pre', 16);
const CYCLE_FRAMES = 1632;
const FRAMES = +arg('frames', PRE + CYCLE_FRAMES + 12);
const DPR = +arg('dpr', 4 / 3);
const SAVE = arg('save', 'all');
const URL = arg('url', (process.env.SITE_URL || 'http://127.0.0.1:8780/index.html'));
// --date: the page's clock, a weekday of the posting week (never a Sunday), 10:00 in Tashkent. The default, Monday
// 26 October 2026, makes the well read the coming Sunday, 1 November. The page's clock then pauses at a fixed
// absolute time, so rAF phases never depend on how long the load took.
// --well hide: leave the well's date out of every frame (see mode.js); the default shows it.
const DATE = arg('date', '2026-10-26');
const T0 = new Date(DATE + 'T10:00:00+05:00').getTime();
if (!Number.isFinite(T0) || new Date(T0).getUTCDay() === 0) throw new Error('--date must be a weekday (YYYY-MM-DD), not ' + DATE);
const HIDE_WELL = arg('well', 'show') === 'hide';
const PAUSE = T0 + 60000;
const TICKS = 62000; // the page's performance.now() when the PRE frames start (see the alignment below)

const saveSet = (() => {
  if (SAVE === 'all') return () => true;
  if (SAVE === 'none') return () => false;
  const parts = SAVE.split(',');
  const fns = parts.map((p) => {
    if (p.includes('-')) {
      const [a, b] = p.split('-').map(Number);
      return (i) => i >= a && i <= b;
    }
    if (p.startsWith('%')) {
      const k = +p.slice(1);
      return (i) => i % k === 0;
    }
    return (i) => i === +p;
  });
  return (i) => fns.some((f) => f(i));
})();

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas', '--hide-scrollbars'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, colorScheme: THEME, reducedMotion: 'no-preference' });
  await routeAnyFonts(c);
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/404|Failed to load/.test(m.text())) errs.push(m.text());
  });
  await p.addInitScript((hideWell) => {
    window.__SHOWCASE = { mode: 'capture', hideWell };
  }, HIDE_WELL);
  await p.addInitScript({ path: path.join(__dirname, 'mode.js') });
  await p.clock.install({ time: T0 });
  await p.goto(URL, { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  for (let i = 0; i < 3; i++) await p.screenshot(); // let the page settle (fonts, first textures) in real frames
  await p.clock.pauseAt(PAUSE);
  // The page's performance.now() is the clock's tick count: it places every requestAnimationFrame on its 16 ms grid,
  // and story.js uses it as the crowd's drift clock. pauseAt usually leaves it at PAUSE - T0 (60000), but in some runs
  // (both light captures of one pass) the page's clock kept only the real ms the load took (about 900, different by
  // 17 ms between the two runs), and the captures differed. So run the paused clock forward to a fixed tick count and
  // set the wall clock again: every capture then starts from the same ticks, rAF phase and wall time.
  const ticks0 = await p.evaluate(() => performance.now());
  if (!(ticks0 <= TICKS)) throw new Error('the load took ' + ticks0 + ' ms of page time, more than ' + TICKS);
  await p.clock.runFor(TICKS - ticks0);
  await p.clock.setSystemTime(T0 + TICKS);
  const ticks1 = await p.evaluate(() => performance.now());
  if (ticks1 !== TICKS) throw new Error('ticks after alignment ' + ticks1 + ', not ' + TICKS);
  const mode = await p.evaluate(() => window.UNPCStory && window.UNPCStory.mode);
  if (mode !== 'motion') throw new Error('story mode is ' + mode + ', not motion');

  const rows = [];
  const t0 = Date.now();
  const START = PRE; // __start runs at frame PRE: its frame is loop time 0
  for (let i = 0; i < FRAMES; i++) {
    // 1. whole milliseconds that average exactly 1000/60 (17, 17, 16, ...)
    const dt = Math.round(((i + 1) * 1000) / 60) - Math.round((i * 1000) / 60);
    await p.clock.runFor(dt);
    const row = await p.evaluate(
      ([i, START, dt]) => {
        // 2. start (loop time 0) and tick inside the same evaluate as the seek
        if (i === START) window.__start();
        else if (i > START) window.__tick(dt / 1000);
        // 3. CSS animations and transitions follow the fake clock: each keeps the mark it was created under
        const now = performance.now();
        const restart = window.__restarted;
        window.__restarted = false;
        for (const a of document.getAnimations()) {
          if (restart) a.__m = window.__mark;
          else if (a.__m === undefined) a.__m = now;
          a.pause();
          a.currentTime = Math.max(0, now - a.__m);
        }
        const s = window.UNPCStory.state();
        const d = window.UNPCStory.dots();
        let h = 0;
        if (d) for (let k = 0; k < d.x.length; k++) h = (h * 31 + Math.round(d.x[k] * 100) * 7 + Math.round(d.y[k] * 100)) % 1000000007;
        return { i, now: Math.round(now), lt: i >= START ? window.__lt : null, uT: i >= START ? +(window.__u || 0).toFixed(5) : null, u: s ? +s.u.toFixed(5) : null, y: window.scrollY, h, gl: s && s.gl, ready: s && s.sheetReady, step: s && s.step };
      },
      [i, START, dt]
    );
    if (saveSet(i)) {
      const buf = await p.screenshot({ path: path.join(OUT, String(i).padStart(5, '0') + '.png') });
      row.md5 = crypto.createHash('md5').update(buf).digest('hex');
    }
    rows.push(row);
    if (i % 100 === 0) {
      const el = (Date.now() - t0) / 1000;
      console.log(`frame ${i}/${FRAMES} lt=${row.lt} u=${row.u} ${(el / (i + 1)).toFixed(2)}s/frame`);
      fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ PRE, START, CYCLE_FRAMES, THEME, DPR, T0, PAUSE, rows }, null, 0));
    }
  }
  const info = await p.evaluate(() => {
    const s = window.UNPCStory.state();
    const gl = document.querySelector('.story-gl').getBoundingClientRect();
    return { well: document.querySelector('[data-next-date]').textContent, glBox: s.glBox, glRect: { x: gl.x, y: gl.y, w: gl.width, h: gl.height }, over: s.over, W: s.W, H: s.H };
  });
  fs.writeFileSync(path.join(OUT, 'frames.json'), JSON.stringify({ PRE, START, CYCLE_FRAMES, THEME, DPR, T0, PAUSE, TICKS, ticks0, DATE, HIDE_WELL, info, errs, rows }, null, 0));
  console.log('done', FRAMES, 'frames in', ((Date.now() - t0) / 1000).toFixed(0), 's; load ticks', ticks0, '-> ' + TICKS + '; well:', info.well, 'errors:', JSON.stringify(errs));
  await b.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
