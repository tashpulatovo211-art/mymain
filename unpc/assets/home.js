/* UNPC home sections (spec 6.0 to 6.5).
   The day bar and its playhead, the case deck with the tuck-under draw and the 60:00 clock,
   the Annex A score sheet with the real tie-break and the ink ring, the four case links,
   and the team and partner previews rendered from data.js.
   Classic defer script; uses window.UNPCSite. Exposes window.UNPCHome. */
(function () {
  "use strict";

  const S = window.UNPCSite;
  if (!S) return;
  const { $, $$, esc } = S;
  const EASE_OUT = "cubic-bezier(.2,.7,.1,1)";
  const EASE_IO = "cubic-bezier(.65,0,.35,1)";
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  /* ---------- 6.1 The day bar ---------- */

  // The five parts of the day, in minutes from the start (124 to 139 in all). short: the track's label, which the
  // readout shows instead of a long name when the bar is too narrow for it (style.css).
  const PHASES = [
    { name: "Welcome and guest speaker", short: "Welcome", dur: "20 to 30 minutes", from: 0, to: 30 },
    { name: "Preparation", dur: "60 minutes", from: 30, to: 90 },
    { name: "Presentations and questions", short: "Presenting", dur: "24 minutes per room", from: 90, to: 114 },
    { name: "Written resolution", dur: "5 to 10 minutes", from: 114, to: 124 },
    { name: "Award ceremony", dur: "15 minutes", from: 124, to: 139 }
  ];
  const DAY = 139;

  function setupDay() {
    const section = $("#format");
    const bar = $("[data-daybar]");
    const list = $("[data-articles]");
    if (!section || !bar || !list) return;
    const head = $("[data-day-head]", bar);
    const nameEl = $("[data-day-name]", bar);
    const durEl = $("[data-day-dur]", bar);
    const segs = $$("[data-dseg]", bar);
    const arts = $$(".art", list).map((el) => {
      const after = el.hasAttribute("data-after");
      const from = after ? DAY : Number(el.dataset.from);
      const to = after ? DAY : Number(el.dataset.to);
      const phase = after ? 5 : PHASES.findIndex((p) => from >= p.from && from < p.to);
      return { el, after, from, to, phase, top: 0, h: 1 };
    });

    // Layout is read here only: on resize, font load, window load and when the list or the page changes size (the story
    // switching to its static form moves every article).
    let vh = window.innerHeight;
    let secTop = 0;
    let secBottom = 0;
    const measure = () => {
      const y = window.scrollY;
      vh = window.innerHeight;
      arts.forEach((a) => {
        const r = a.el.getBoundingClientRect();
        a.top = r.top + y;
        a.h = Math.max(1, r.height);
      });
      const sr = section.getBoundingClientRect();
      secTop = sr.top + y;
      secBottom = sr.bottom + y;
      update(window.scrollY, true);
    };

    let lastPhase = -2;
    let lastP = -1;
    let lastArt = -2;
    function update(y, force) {
      if (!force && (y + vh < secTop - 200 || y > secBottom + 200)) return;
      const anchor = y + vh * 0.45;
      let cur = -1;
      let prog = 0;
      for (let i = 0; i < arts.length; i++) {
        if (arts[i].top <= anchor) {
          cur = i;
          prog = clamp((anchor - arts[i].top) / arts[i].h, 0, 1);
        }
      }
      let phase = 0;
      let min = 0;
      if (cur >= 0) {
        const a = arts[cur];
        phase = a.phase;
        min = a.after ? DAY : a.from + (a.to - a.from) * prog;
      }
      const p = Math.round((min / DAY) * 10000) / 10000;
      if (p !== lastP) {
        lastP = p;
        head.style.setProperty("--p", p);
      }
      if (phase !== lastPhase) {
        lastPhase = phase;
        segs.forEach((s, i) => {
          s.classList.toggle("is-past", i < phase);
          s.classList.toggle("is-now", i === phase);
        });
        if (phase === 5) {
          nameEl.textContent = "After the day";
          durEl.textContent = "";
        } else {
          const ph = PHASES[phase];
          nameEl.innerHTML = ph.short ? '<span class="dn-long">' + ph.name + '</span><span class="dn-short">' + ph.short + "</span>" : ph.name;
          durEl.textContent = ph.dur;
        }
      }
      if (cur !== lastArt) {
        lastArt = cur;
        arts.forEach((a, i) => a.el.classList.toggle("is-now", i === cur));
      }
    }

    measure();
    S.onLayout(measure);
    S.onScroll((y) => update(y, false));
    if (window.ResizeObserver) {
      let queued = false;
      const ro = new ResizeObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          measure();
        });
      });
      ro.observe(list);
      ro.observe(section.parentElement || document.body);
    }
  }

  /* ---------- 6.1 The 60:00 clock (from the current site's makeClock) ---------- */

  function makeClock(root) {
    const digits = root && $("[data-clock]", root);
    const label = root && $("[data-clock-label]", root);
    const toggle = root && $("[data-clock-toggle]", root);
    const reset = root && $("[data-clock-reset]", root);
    if (!digits || !toggle) return { reset() {}, state: () => "idle" };

    const FULL = 60 * 60 * 1000;
    const LATE = 5 * 60 * 1000;
    const words = {
      idle: ["Preparation time", "Start the hour"],
      running: ["Teams are preparing", "Pause"],
      paused: ["Paused", "Resume"],
      done: ["Time. Teams present now.", "Start again"]
    };
    let left = FULL;
    let startedAt = 0;
    let timer = 0;
    let state = "idle";

    const format = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return String(Math.floor(s / 60)).padStart(2, "0") + ":" + String(s % 60).padStart(2, "0");
    };
    const remaining = () => (state === "running" ? left - (performance.now() - startedAt) : left);
    const show = (ms) => {
      digits.textContent = format(ms);
      // The last five minutes turn red, as on the real card clock.
      root.classList.toggle("is-late", ms <= LATE);
    };
    const setState = (next) => {
      state = next;
      root.dataset.clockState = next;
      label.textContent = words[next][0];
      toggle.textContent = words[next][1];
      if (reset) reset.hidden = next === "idle";
    };
    const tick = () => {
      const ms = remaining();
      if (ms <= 0) {
        clearInterval(timer);
        left = 0;
        show(0);
        setState("done");
        return;
      }
      show(ms);
    };
    const start = () => {
      startedAt = performance.now();
      setState("running");
      clearInterval(timer);
      timer = setInterval(tick, 250);
      tick();
    };
    const pause = () => {
      left = remaining();
      clearInterval(timer);
      setState("paused");
      tick();
    };
    const clear = () => {
      clearInterval(timer);
      left = FULL;
      setState("idle");
      show(FULL);
    };

    toggle.addEventListener("click", () => {
      if (state === "running") pause();
      else if (state === "done") {
        clear();
        start();
      } else start();
    });
    if (reset)
      reset.addEventListener("click", () => {
        clear();
        toggle.focus();
      });
    setState("idle");
    show(FULL);
    return { reset: clear, state: () => state };
  }

  /* ---------- 6.1 The case deck: a physical stack at rest, with keynote's tuck-under draw ---------- */

  // Resting transforms by depth. The top card always rests at none, so its text stays crisp.
  const POS_WIDE = ["none", "translate(-6px, 5px) rotate(-1.6deg)", "translate(-12px, 10px) rotate(-3.2deg)", "translate(-12px, 10px) rotate(-3.2deg)"];
  // One-column pages (760px and below, as style.css): smaller offsets, so the under-card edges stop at the gutter.
  const POS_NARROW = ["none", "translate(-4px, 4px) rotate(-0.7deg)", "translate(-8px, 8px) rotate(-1.4deg)", "translate(-8px, 8px) rotate(-1.4deg)"];
  const narrowDeck = window.matchMedia ? window.matchMedia("(max-width: 760px)") : null;

  function setupDeck() {
    const deck = $("[data-deck]");
    if (!deck) return null;
    const cards = $$(".case-card", deck);
    const pips = $$("[data-pip]", deck);
    const drawButton = $("[data-draw]", deck);
    const status = $("[data-deck-status]", deck);
    const clock = makeClock($("[data-clock-root]", deck));
    let order = cards.map((_, i) => i); // order[0] is the top card
    let pile = [];
    let running = null;
    const timers = [];

    const place = () => {
      order.forEach((ci, r) => {
        const card = cards[ci];
        card.dataset.pos = String(r);
        card.classList.toggle("is-top", r === 0);
        if (r === 0) card.removeAttribute("aria-hidden");
        else card.setAttribute("aria-hidden", "true");
      });
      pressPip(order[0]);
    };
    const pressPip = (k) => pips.forEach((p, i) => p.setAttribute("aria-pressed", String(i === k)));

    const finish = () => {
      timers.splice(0).forEach(clearTimeout);
      if (!running) return;
      const r = running;
      running = null;
      r.done();
      r.anims.forEach((a) => a.cancel());
    };

    const announce = (i) => {
      const card = cards[i];
      const title = $(".case-title", card).textContent;
      const q = $$(".case-q", card).map((p) => p.textContent).join(" ");
      status.textContent = "Case " + (i + 1) + " of " + cards.length + ". " + title + ". " + q;
    };

    function go(target, opts = {}) {
      const t = Number(target);
      if (!Number.isInteger(t) || t < 0 || t >= cards.length) return;
      finish();
      if (order[0] === t) return;
      const prev = order[0];
      const rest = order.slice(1).filter((i) => i !== t);
      // Put the chosen case straight under the top card first: under-cards show only their edges.
      order = [prev, t].concat(rest);
      place();
      const next = [t].concat(rest, [prev]);
      pressPip(t);
      clock.reset();
      announce(t);
      const commit = () => {
        order = next;
        place();
        deck.classList.remove("is-drawing");
      };
      if (opts.instant || !S.motion() || !deck.animate) {
        commit();
        return;
      }
      deck.classList.add("is-drawing");
      const POS = narrowDeck && narrowDeck.matches ? POS_NARROW : POS_WIDE;
      const A = cards[prev];
      const B = cards[t];
      const C = rest.length ? cards[rest[0]] : null;
      const T = 760;
      const out = "translate(56%, -14px) rotate(4deg)";
      const o = (ms) => ms / T;
      const anims = [];
      // The top card slides out to the side (300ms), drops below the stack, then tucks under (360ms).
      anims.push(
        A.animate(
          [
            { offset: 0, transform: POS[0], zIndex: 20, easing: EASE_OUT },
            { offset: o(300), transform: out, zIndex: 20 },
            { offset: o(301), transform: out, zIndex: 0 },
            { offset: o(400), transform: out, zIndex: 0, easing: EASE_IO },
            { offset: 1, transform: POS[3], zIndex: 0 }
          ],
          { duration: T, fill: "forwards" }
        )
      );
      // The new top card settles from the first edge position (from 300ms, 360ms); the next edge follows.
      const settle = (el, from, to) =>
        el.animate(
          [
            { offset: 0, transform: from },
            { offset: o(300), transform: from, easing: EASE_OUT },
            { offset: o(660), transform: to },
            { offset: 1, transform: to }
          ],
          { duration: T, fill: "forwards" }
        );
      anims.push(settle(B, POS[1], POS[0]));
      if (C) anims.push(settle(C, POS[2], POS[1]));
      timers.push(
        setTimeout(() => {
          B.classList.add("is-top");
          A.classList.remove("is-top");
        }, 300)
      );
      const r = { anims, done: commit };
      running = r;
      anims[0].onfinish = () => {
        if (running !== r) return;
        running = null;
        commit();
        anims.forEach((a) => a.cancel());
      };
    }

    // "Draw another case": the shuffled pile from the current site's setupDeck().
    const fromPile = () => {
      for (let k = 0; k < 8; k++) {
        if (!pile.length) {
          pile = cards.map((_, i) => i).filter((i) => i !== order[0]);
          for (let i = pile.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pile[i], pile[j]] = [pile[j], pile[i]];
          }
        }
        const n = pile.pop();
        if (n !== order[0]) return n;
      }
      return (order[0] + 1) % cards.length;
    };

    if (drawButton)
      drawButton.addEventListener("click", () => {
        finish();
        go(fromPile());
      });
    pips.forEach((p) => p.addEventListener("click", () => go(Number(p.dataset.pip))));
    place();

    // Keyboard focus on a deck control (pips, Draw, the clock's buttons): the browser brings only the control into view,
    // which can leave the card or the clock's digits under the sticky day bar, or the rest of the deck below the fold.
    // Then the whole deck comes in under the bar, when it fits (after the browser's own scroll, so in the next frame).
    // In a wide, short window the deck is
    // taller than the room under the bar: then the focused control's own unit (the whole clock, or the control) does.
    const keyFocus = (el) => {
      try {
        return el.matches(":focus-visible");
      } catch (e) {
        return true;
      }
    };
    deck.addEventListener("focusin", (e) => {
      if (!keyFocus(e.target)) return;
      requestAnimationFrame(() => {
        const band = $("[data-daybar-band]");
        const nav = $("[data-nav]");
        const cover = Math.max(nav ? nav.getBoundingClientRect().bottom : 0, band ? band.getBoundingClientRect().bottom : 0);
        const r = deck.getBoundingClientRect();
        const room = window.innerHeight - cover - r.height;
        const behavior = S.motion() ? "smooth" : "auto";
        if (room < 0) {
          const unit = e.target.closest("[data-clock-root]") || e.target;
          const ur = unit.getBoundingClientRect();
          if (ur.top < cover + 4) window.scrollBy({ top: ur.top - cover - 12, behavior });
          // a pip focused without a scroll (a case link) can sit below the fold: it comes up only as far as keeps the
          // card's title clear of the bar (on a short screen it may stay below the fold; the next Tab brings it in)
          else if (ur.bottom > window.innerHeight - 4) {
            const title = e.target.hasAttribute("data-pip") ? $(".case-card.is-top .case-title", deck) : null;
            const titleTop = title ? title.getBoundingClientRect().top : Infinity;
            const by = Math.min(ur.bottom - window.innerHeight + 12, ur.top - cover - 12, titleTop - cover - 8);
            if (by > 0) window.scrollBy({ top: by, behavior });
          }
          return;
        }
        // the deck fits: it comes in whole, just under the bar (a case link's pip can leave its bottom below the fold)
        const by = r.top - cover - Math.min(20, room / 2);
        if (r.top < cover) window.scrollBy({ top: by, behavior });
        else if (r.bottom > window.innerHeight - 4) {
          const up = Math.min(by, r.bottom - window.innerHeight + 12);
          if (up > 0) window.scrollBy({ top: up, behavior });
        }
      });
    });

    return { go, current: () => order[0], pips, el: deck, clock };
  }

  /* ---------- 6.3 The four case links: scroll to the deck and show that case ---------- */

  function setupCaseLinks(deckApi) {
    if (!deckApi) return null;
    const show = (i) => {
      const k = Number(i);
      const el = deckApi.el;
      const smooth = S.motion();
      const run = () => {
        deckApi.go(k);
        const pip = deckApi.pips[k];
        if (pip) pip.focus({ preventScroll: true });
      };
      const r = el.getBoundingClientRect();
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      const delta = r.top - margin;
      if (Math.abs(delta) < 4) return run();
      el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      if (!smooth) return run();
      let done = false;
      let t = 0;
      const once = () => {
        if (done) return;
        done = true;
        window.removeEventListener("scrollend", once);
        clearTimeout(t);
        run();
      };
      window.addEventListener("scrollend", once);
      t = setTimeout(once, 1400);
    };
    $$("[data-show-case]").forEach((b) => b.addEventListener("click", () => show(b.dataset.showCase)));
    return show;
  }

  /* ---------- 6.2 Annex A: the score sheet ---------- */

  const EXAMPLE = { A: [12, 17, 15, 11, 12, 11], B: [13, 15, 16, 12, 11, 11] };
  const SOLUTION = 1; // the quality-of-the-solution row decides a tie

  function setupSheet() {
    const sheet = $("[data-sheet]");
    if (!sheet) return null;
    const inputs = $$('input[type="range"]', sheet);
    const totals = { A: $('[data-total="A"]', sheet), B: $('[data-total="B"]', sheet) };
    const rings = { A: $(".st-a .ring", sheet), B: $(".st-b .ring", sheet) };
    const verdict = $("[data-verdict]", sheet);
    const tag = $("[data-tie-tag]", sheet);
    const resetButton = $("[data-sheet-reset]", sheet);
    let lastWinner;
    let seen = !("IntersectionObserver" in window);

    const paint = (input) => {
      input.parentElement.style.setProperty("--v", input.value);
      const val = $("[data-val]", input.closest(".cell"));
      if (val) val.textContent = input.value;
    };

    const ring = (w) => {
      if (!seen) return;
      ["A", "B"].forEach((t) => rings[t] && rings[t].classList.remove("is-on"));
      if (w && rings[w]) {
        const r = rings[w];
        void r.getBoundingClientRect(); // restart the 700ms draw each time the winner changes
        r.classList.add("is-on");
      }
    };

    function update() {
      const s = { A: [0, 0, 0, 0, 0, 0], B: [0, 0, 0, 0, 0, 0] };
      inputs.forEach((inp) => {
        s[inp.dataset.team][Number(inp.dataset.i)] = Number(inp.value);
      });
      const sum = (arr) => arr.reduce((x, y) => x + y, 0);
      const a = sum(s.A);
      const b = sum(s.B);
      const qa = s.A[SOLUTION];
      const qb = s.B[SOLUTION];
      totals.A.textContent = a;
      totals.B.textContent = b;
      let w = null;
      let text;
      if (a !== b) {
        w = a > b ? "A" : "B";
        text = "Team " + w + " wins the room, " + Math.max(a, b) + " to " + Math.min(a, b) + ".";
      } else if (qa !== qb) {
        w = qa > qb ? "A" : "B";
        text = "Tied at " + a + ". Team " + w + " wins on quality of the solution, " + Math.max(qa, qb) + " to " + Math.min(qa, qb) + ".";
      } else {
        text = "Tied at " + a + ", and level on quality of the solution too. The rubric has no further tie-break.";
      }
      if (verdict.textContent !== text) verdict.textContent = text;
      if (tag) tag.classList.toggle("is-off", a !== b);
      sheet.dataset.winner = w || "";
      if (w !== lastWinner) {
        lastWinner = w;
        ring(w);
      }
    }

    sheet.addEventListener("input", (e) => {
      const t = e.target;
      if (!t.matches || !t.matches('input[type="range"]')) return;
      paint(t);
      update();
    });
    if (resetButton)
      resetButton.addEventListener("click", () => {
        inputs.forEach((inp) => {
          inp.value = EXAMPLE[inp.dataset.team][Number(inp.dataset.i)];
          paint(inp);
        });
        lastWinner = undefined;
        update();
      });

    inputs.forEach(paint);
    update();
    // The ring is first drawn when the totals come into view, so the reader sees it happen.
    if (!seen) {
      const io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((en) => en.isIntersecting)) return;
          io.disconnect();
          seen = true;
          ring(lastWinner);
        },
        { threshold: 0.6 }
      );
      io.observe($(".sheet-total", sheet));
    }
    return { update };
  }

  /* ---------- 6.4 Team preview, from data.js ---------- */

  function renderSignatories() {
    const box = $("[data-signatories]");
    const founder = S.shown[0];
    if (!box || !founder) return;
    const first = String(founder.name || "").split(/\s+/)[0];
    let html =
      '<div class="founder">' +
      '<button type="button" class="portrait-btn founder-portrait" data-person="0" aria-haspopup="dialog" aria-label="' + esc(founder.name + ", " + founder.role) + '">' +
      S.portraitMarkup(founder, { alt: "" }) +
      "</button>" +
      '<div class="founder-sig">' +
      '<p class="founder-name">' + esc(founder.name) + "</p>" +
      '<p class="founder-meta"><span>' + esc(founder.role) + "</span>" + (founder.school ? "<span>" + esc(founder.school) + "</span>" : "") + "</p>" +
      '<p class="founder-more"><button type="button" class="btn-link" data-person="0" aria-haspopup="dialog">Read about ' + esc(first) + "</button></p>" +
      "</div></div>";

    // Every other role is a signature line: open (placeholder, role only) or signed (a real organizer).
    const lines = S.people
      .filter((p) => p !== founder)
      .map((p) => {
        if (p.placeholder) {
          return '<li class="sig"><span class="sig-role">' + esc(p.role) + '</span><span class="sig-state">Open<span class="sr-only"> role</span></span></li>';
        }
        const k = S.shown.indexOf(p);
        return (
          '<li class="sig sig-filled"><button type="button" class="sig-signed" data-person="' + k + '" aria-haspopup="dialog">' +
          '<span class="sig-role">' + esc(p.role) + '</span><span class="sig-name">' + esc(p.name) + "</span></button></li>"
        );
      })
      .join("");
    if (lines) html += '<ul class="sig-list" aria-label="Roles">' + lines + "</ul>";
    // The counts in the sub follow the data, in the same words as the Team page's lede (pages.js).
    const sub = document.querySelector("#team .sec-sub");
    if (sub) {
      const total = S.people.length, open = S.people.filter((p) => p.placeholder).length;
      const W = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
      const w = (n) => W[n] || String(n);
      let tail = ".";
      if (open === 1) tail = "; one of them is open.";
      else if (open > 1 && open === total) tail = "; all of them are open.";
      else if (open > 1) tail = "; " + w(open) + " of them are open.";
      sub.textContent = "UNPC is student-run, with more than 100 volunteer organizers. " + w(total).replace(/^./, (c) => c.toUpperCase()) + (total === 1 ? " role leads" : " roles lead") + " the work" + tail;
    }
    box.innerHTML = html;
  }

  /* ---------- 6.5 Partners preview, from data.js ---------- */

  function renderSupport() {
    const list = $("[data-support]");
    if (!list || !S.partners.length) return;
    list.innerHTML = S.partners
      .map((p) => {
        const word = p.short
          ? '<span aria-hidden="true">' + esc(p.short) + '</span><span class="sr-only">' + esc(p.name) + "</span>"
          : esc(p.name);
        // The typeset name stays readable to screen readers, so the logo itself is decorative.
        const img = p.logo ? '<img src="' + esc(p.logo) + '" alt="" loading="lazy" decoding="async">' : "";
        return (
          '<li class="supporter"><span class="logo-slot" data-slot><span class="logo-word">' + word + "</span>" + img + "</span>" +
          '<span class="supporter-role">' + esc(p.role || "") + "</span></li>"
        );
      })
      .join("");
  }

  /* ---------- Start ---------- */

  renderSignatories();
  renderSupport();
  setupDay();
  const deck = setupDeck();
  const showCase = setupCaseLinks(deck);
  const sheet = setupSheet();

  window.UNPCHome = {
    // Show case i (0 to 3) in the deck; { instant: true } skips the draw.
    goCase: (i, opts) => deck && deck.go(i, opts),
    // Scroll to the deck, then show case i, as the record's case links do.
    showCase: (i) => showCase && showCase(i),
    currentCase: () => (deck ? deck.current() : 0),
    updateSheet: () => sheet && sheet.update()
  };
})();
