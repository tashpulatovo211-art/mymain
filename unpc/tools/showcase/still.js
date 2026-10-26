// Fresh stills of the showcase from the real build, at the capture's device scale (skill B9: the rest check).
// Usage: NODE_PATH=$(npm root -g) node still.js --out DIR [--theme light|dark] [--u 5.92] [--date YYYY-MM-DD] [--well show|hide]
// Writes DIR/still-jump.png (the page loaded at u 0, then scrolled straight to u and settled, no reinit) and
// DIR/still-reinit.png (the story made again while the reader is already at u). Both run 4 s of fake clock.
const { chromium } = require('playwright');
const { routeAnyFonts } = require('./fontroute.js');
const fs = require('fs');
const path = require('path');
const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i > 0 ? process.argv[i + 1] : d;
};
const OUT = path.resolve(arg('out', path.join(__dirname, 'stills')));
const THEME = arg('theme', 'light');
const U = +arg('u', 5.92);
const DPR = +arg('dpr', 4 / 3);
// the same clock and well as capture.js (--date, --well)
const T0 = new Date(arg('date', '2026-10-26') + 'T10:00:00+05:00').getTime();
const HIDE_WELL = arg('well', 'show') === 'hide';

async function shot(variant) {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-accelerated-2d-canvas', '--hide-scrollbars'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR, colorScheme: THEME, reducedMotion: 'no-preference' });
  await routeAnyFonts(c);
  const p = await c.newPage();
  await p.addInitScript((hideWell) => {
    window.__SHOWCASE = { mode: 'capture', hideWell };
  }, HIDE_WELL);
  await p.addInitScript({ path: path.join(__dirname, 'mode.js') });
  await p.clock.install({ time: T0 });
  await p.goto((process.env.SITE_URL || 'http://127.0.0.1:8780/index.html'), { waitUntil: 'load' });
  await p.evaluate(() => document.fonts.ready);
  for (let i = 0; i < 3; i++) await p.screenshot();
  await p.clock.pauseAt(T0 + 60000);
  // the same tick alignment as capture.js
  const ticks0 = await p.evaluate(() => performance.now());
  if (!(ticks0 <= 62000)) throw new Error('load took ' + ticks0 + ' ms of page time');
  await p.clock.runFor(62000 - ticks0);
  await p.clock.setSystemTime(T0 + 62000);
  await p.evaluate(
    ([u, variant]) => {
      document.documentElement.classList.remove('sc-pre');
      window.__showcase.scrollToU(u);
      if (variant === 'reinit') window.UNPCStory.reinit();
      window.__mark = performance.now();
    },
    [U, variant]
  );
  for (let i = 0; i < 240; i++) {
    const dt = Math.round(((i + 1) * 1000) / 60) - Math.round((i * 1000) / 60);
    await p.clock.runFor(dt);
    await p.evaluate(() => {
      const now = performance.now();
      for (const a of document.getAnimations()) {
        if (a.__m === undefined) a.__m = window.__mark;
        a.pause();
        a.currentTime = Math.max(0, now - a.__m);
      }
    });
  }
  const st = await p.evaluate(() => ({ u: window.UNPCStory.state().u, y: window.scrollY }));
  fs.mkdirSync(OUT, { recursive: true });
  await p.screenshot({ path: path.join(OUT, `still-${variant}.png`) });
  console.log(variant, JSON.stringify(st));
  await b.close();
}
(async () => {
  await shot('jump');
  await shot('reinit');
})();
