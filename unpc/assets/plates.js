/* UNPC photo plates (README, "Photo plates"; SPEC 7.1): the load state of each plate (its swatch until the photo
   arrives, the fade-in, the alt text of the crop that loaded, and the whole plate removed, once it is below the screen,
   if the file is missing), and its slow drift.
   As a plate crosses the screen, its photo settles from a 6% larger scale to its own framing by the time the plate is
   at rest in the space under the nav and the day bar (centred there, or a little higher so the text above it never
   shows only its last line), and drifts down inside the frame by the file's extra rows (--pp-over), so it moves a
   little slower than the page. Only transform is written, so nothing around it moves. Off under reduced motion, where
   the plate shows its crop as is. Classic defer script after site.js; runs in UNPCSite's one scroll rAF and reads
   layout only on UNPCSite's layout signal and when the page changes size. Exposes window.UNPCPlates. */
(function () {
  "use strict";

  const figs = Array.prototype.slice.call(document.querySelectorAll("[data-photo-plate]"));
  if (!figs.length) return;

  /* Load state: a photo still loading is hidden over its swatch and fades in once it has really loaded; a missing
     file takes its whole plate with it (caption included), so the page never shows an empty frame. It never does
     that under the reader: a plate that fails while any of it is on screen, or above the screen, keeps its frame and
     swatch (.is-failed), and goes only once it is wholly below the screen, where taking it out moves nothing in
     view. Each crop can carry its own alt text (data-alt on its <source>, and on the img for the img's own files),
     set once that crop has loaded; until then, and without the script, the img's alt is one that is true of every
     crop. This part needs nothing else, so a plate still shows its photo if the rest of the page's script fails. */
  const fileOf = (u) => String(u || "").split(/[?#]/)[0].split("/").pop();
  function altFor(img) {
    const cur = fileOf(img.currentSrc);
    const pic = img.parentElement;
    if (!cur || !pic) return null;
    const sources = pic.querySelectorAll("source[data-alt]");
    for (let i = 0; i < sources.length; i++) {
      const urls = (sources[i].getAttribute("srcset") || "").split(",").map((c) => fileOf(c.trim().split(/\s+/)[0]));
      if (urls.indexOf(cur) >= 0) return sources[i].getAttribute("data-alt");
    }
    return img.getAttribute("data-alt");
  }
  figs.forEach((fig) => {
    const img = fig.querySelector(".pp-img");
    if (!img) return;
    let watch = null;
    const below = (r) => r.top >= window.innerHeight;
    const ok = () => {
      if (!(img.naturalWidth > 0)) return;
      if (watch) {
        watch.disconnect();
        watch = null;
      }
      const alt = altFor(img);
      if (alt != null && img.alt !== alt) img.alt = alt;
      fig.classList.remove("is-waiting", "is-failed", "is-missing");
      fig.classList.add("is-loaded");
    };
    const fail = () => {
      fig.classList.remove("is-waiting", "is-loaded");
      if (below(fig.getBoundingClientRect())) {
        fig.classList.add("is-missing");
        return;
      }
      fig.classList.add("is-failed");
      if (watch || !window.IntersectionObserver) return;
      watch = new IntersectionObserver((entries) => {
        const e = entries[entries.length - 1];
        if (e.isIntersecting || !below(e.boundingClientRect)) return;
        watch.disconnect();
        watch = null;
        fig.classList.remove("is-failed");
        fig.classList.add("is-missing");
      });
      watch.observe(fig);
    };
    img.addEventListener("load", ok);
    img.addEventListener("error", fail);
    if (!img.complete) fig.classList.add("is-waiting");
    else if (img.naturalWidth > 0) ok();
    else if (img.currentSrc) fail();
  });

  const S = window.UNPCSite;
  if (!S) return;

  const SETTLE = 0.06; // extra scale while a plate comes in
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const ease = (t) => t * t * (3 - 2 * t);

  const items = figs
    .map((fig) => ({ fig, frame: fig.querySelector(".pp-frame"), img: fig.querySelector(".pp-img"), top: 0, h: 1, span: 1, over: 0, inset: 0, near: false, last: "" }))
    .filter((it) => it.frame && it.img);

  /* The chrome that stays on screen over a plate: the fixed nav, and for a plate in the day bar's section the sticky
     band with the fade under it. A plate comes to rest in the space below that chrome, never under it. inset is where
     the chrome ends, fade the height of its fade (its solid part ends at inset - fade). */
  const navEl = document.querySelector("[data-nav]");
  const bands = Array.prototype.slice.call(document.querySelectorAll("[data-daybar-band]"));
  function chromeFor(fig) {
    let inset = navEl && getComputedStyle(navEl).position === "fixed" ? navEl.offsetHeight : 0;
    let fade = 0;
    bands.forEach((b) => {
      const cs = getComputedStyle(b);
      if (cs.position !== "sticky" || !b.parentElement || !b.parentElement.contains(fig)) return;
      const f = parseFloat(getComputedStyle(b, "::after").height) || 0;
      const end = (parseFloat(cs.top) || 0) + b.offsetHeight + f;
      if (end > inset) {
        inset = end;
        fade = f;
      }
    });
    return { inset, fade };
  }

  /* Layout is read here only. */
  let vh = window.innerHeight;
  function measure() {
    vh = window.innerHeight;
    const y = window.scrollY;
    items.forEach((it) => {
      const r = it.frame.getBoundingClientRect();
      it.top = r.top + y;
      it.h = Math.max(1, r.height);
      it.over = parseFloat(getComputedStyle(it.frame).getPropertyValue("--pp-o")) || 0;
      // At rest (p = 0.5) the plate, frame and caption, is centred in the space under the chrome; a plate taller than
      // that space rests with its frame's top just under the chrome.
      const chrome = chromeFor(it.fig);
      it.inset = chrome.inset;
      const whole = Math.max(it.h, it.fig.getBoundingClientRect().bottom - r.top);
      let restTop = it.inset + Math.max(0, (vh - it.inset - whole) / 2);
      // The text just above never shows only its last block at rest (in Article 6, the duration, which the day bar
      // above already reads): if that block would show below the chrome's solid part while the block before it is
      // hidden, the plate rests higher, by just enough to tuck that block under the solid part too.
      const prev = it.fig.previousElementSibling;
      const blocks = prev ? prev.children : [];
      if (blocks.length > 1) {
        const solid = it.inset - chrome.fade;
        const shift = restTop - r.top; // from where things are now to where they are at rest
        const lastEnd = blocks[blocks.length - 1].getBoundingClientRect().bottom + shift;
        const prevEnd = blocks[blocks.length - 2].getBoundingClientRect().bottom + shift;
        if (lastEnd > solid && prevEnd <= solid + 4) restTop = Math.max(it.inset, restTop - (lastEnd - solid));
      }
      it.span = Math.max(1, 2 * (vh - restTop));
    });
    update(window.scrollY);
  }

  function update(y) {
    const on = S.motion();
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      // p: 0 when the frame's top meets the bottom of the screen, 0.5 at rest under the chrome, 1 when the plate has
      // passed under it.
      const p = (y + vh - it.top) / it.span;
      const near = p > -0.15 && p < 1.15;
      if (near !== it.near) {
        it.near = near;
        it.fig.classList.toggle("is-near", near);
      }
      if (!on) {
        if (it.last) {
          it.img.style.transform = "";
          it.last = "";
        }
        continue;
      }
      if (!near && it.last) continue;
      const q = clamp(p, 0, 1);
      const ty = (q - 0.5) * 2 * it.over * it.h; // within the file's extra rows, so no edge ever shows
      const s = 1 + SETTLE * (1 - ease(clamp(q / 0.5, 0, 1)));
      const t = "translate3d(0," + ty.toFixed(1) + "px,0) scale(" + s.toFixed(4) + ")";
      if (t !== it.last) {
        it.img.style.transform = t;
        it.last = t;
      }
    }
  }

  measure();
  S.onLayout(measure);
  S.onScroll(update);
  S.onMotion(() => measure());
  if (window.ResizeObserver) {
    // Anything above a plate that changes height (the story's static form, a font swap, the deck) moves it.
    let queued = false;
    new ResizeObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        measure();
      });
    }).observe(document.body);
  }

  // rest: the scroll position at which a plate is at rest (p = 0.5), for tests.
  window.UNPCPlates = {
    measure,
    items: () => items.map((it) => ({ top: it.top, h: it.h, over: it.over, inset: it.inset, rest: Math.round(it.top - vh + it.span / 2), transform: it.last })),
  };
})();
