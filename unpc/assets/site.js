/* UNPC shared behaviour, on every page.
   Theme, nav and phone menu, next Sunday in Tashkent, register fallback, Copy with status,
   photo slots, the Next block bookend, the organizer dialog with deep links, and the reader's place across a resize.
   Exposed as window.UNPCSite. Classic defer script; loads after data.js and chamber.js. */
(function () {
  "use strict";

  const data = window.UNPC || {};
  const config = data.config || {};
  const people = data.organizers || [];
  const partners = data.partners || [];
  const shown = people.filter((p) => !p.placeholder);
  const root = document.documentElement;
  const mq = (q) => {
    try {
      return window.matchMedia(q);
    } catch (e) {
      return { matches: false, addEventListener() {} };
    }
  };
  const reducedMQ = mq("(prefers-reduced-motion: reduce)");
  const darkMQ = mq("(prefers-color-scheme: dark)");
  const wideMQ = mq("(min-width: 640px)");

  const $ = (sel, r = document) => r.querySelector(sel);
  const $$ = (sel, r = document) => Array.from(r.querySelectorAll(sel));
  const esc = (value) =>
    String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const on = (target, type, fn, opts) => target && target.addEventListener(type, fn, opts);
  const emit = (type, detail) => root.dispatchEvent(new CustomEvent(type, { detail }));
  const setUrl = (u) => {
    try {
      history.replaceState(history.state, "", u);
    } catch (e) {}
  };
  const motion = () => root.classList.contains("motion");
  const reducedMotion = () => !motion();
  // Typographic care for copy from data.js: keep "4 October" and "188 countries" together on one line.
  const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
  const tidy = (text) =>
    String(text == null ? "" : text)
      .replace(new RegExp("(\\d+) (" + MONTHS + ")", "g"), "$1\u00a0$2")
      .replace(/(\d+) (?=[a-z])/g, "$1\u00a0");
  const initials = (name) =>
    String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  /* ---------- Theme ---------- */

  const THEME_KEY = "unpc-theme";
  const theme = () => {
    const forced = root.getAttribute("data-theme");
    if (forced === "light" || forced === "dark") return forced;
    return darkMQ.matches ? "dark" : "light";
  };
  let lastTheme = theme();

  function setTheme(next, store = true) {
    if (next !== "light" && next !== "dark") return;
    const apply = () => root.setAttribute("data-theme", next);
    if (store) {
      try {
        localStorage.setItem(THEME_KEY, next);
      } catch (e) {}
    }
    // A soft cross-fade of the whole page, where supported and motion is allowed.
    if (motion() && document.startViewTransition && !document.hidden) {
      try {
        document.startViewTransition(() => {
          apply();
          themeChanged();
        });
        return;
      } catch (e) {}
    }
    apply();
    themeChanged();
  }

  function themeChanged() {
    const t = theme();
    if (t === lastTheme) return;
    lastTheme = t;
    $$("[data-theme-toggle]").forEach((b) => b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme"));
    $$('meta[name="theme-color"]').forEach((m) => {
      m.setAttribute("content", t === "dark" ? "#0d1519" : "#f6f8f8");
      m.removeAttribute("media");
    });
    emit("unpc:theme", { theme: t });
  }

  function setupTheme() {
    const t = theme();
    $$("[data-theme-toggle]").forEach((b) => {
      b.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
      on(b, "click", () => setTheme(theme() === "dark" ? "light" : "dark"));
    });
    on(darkMQ, "change", themeChanged);
    // A viewer (or another script) may force data-theme on <html>: follow it.
    new MutationObserver(themeChanged).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  }
  const onTheme = (fn) => {
    const h = (e) => fn(e.detail.theme);
    on(root, "unpc:theme", h);
    return () => root.removeEventListener("unpc:theme", h);
  };

  /* ---------- Motion setting ---------- */

  function setupMotion() {
    on(reducedMQ, "change", () => {
      root.classList.toggle("motion", !reducedMQ.matches);
      emit("unpc:motion", { motion: motion() });
    });
  }
  const onMotion = (fn) => {
    const h = (e) => fn(e.detail.motion);
    on(root, "unpc:motion", h);
    return () => root.removeEventListener("unpc:motion", h);
  };

  /* ---------- One scroll rAF and one layout signal for the page ---------- */

  const scrollFns = new Set();
  let scrollQueued = false;
  function runScroll() {
    scrollQueued = false;
    const y = window.scrollY;
    scrollFns.forEach((fn) => fn(y));
  }
  function queueScroll() {
    if (scrollQueued) return;
    scrollQueued = true;
    requestAnimationFrame(runScroll);
  }
  on(window, "scroll", queueScroll, { passive: true });
  const onScroll = (fn) => {
    scrollFns.add(fn);
    fn(window.scrollY);
    return () => scrollFns.delete(fn);
  };

  const layoutFns = new Set();
  let layoutTimer = 0;
  let lastLW = window.innerWidth;
  let lastLH = window.innerHeight;
  function runLayout() {
    layoutFns.forEach((fn) => fn());
  }
  on(window, "resize", () => {
    // Ignore the phone address bar: height changes under 120px with the same width.
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === lastLW && Math.abs(h - lastLH) < 120) return;
    lastLW = w;
    lastLH = h;
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(runLayout, 120);
  });
  on(window, "load", runLayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(runLayout);
  const onLayout = (fn) => {
    layoutFns.add(fn);
    return () => layoutFns.delete(fn);
  };

  /* ---------- The reader's place across a resize ---------- */

  const navEl = $("[data-nav]");
  const navBottom = () => (navEl ? Math.max(0, navEl.getBoundingClientRect().bottom) : 0);
  // The block the reader is on, under root: the first block element in view under the line (the nav's bottom edge), and
  // inside it the deepest one that still crosses the line, as { el, top, vis }: top is its top's distance below the line
  // (negative for one that crosses it) and vis how much of it lies below the line. null when there is none. Inline
  // boxes are passed over, and so are sticky, fixed and absolute ones, which do not move with the text (the day bar).
  function readBlock(root, line) {
    let best = null;
    let box = root;
    while (box) {
      let next = null;
      for (const el of box.children) {
        const r = el.getBoundingClientRect();
        if (r.bottom <= line || r.height <= 0) continue;
        const cs = getComputedStyle(el);
        if (cs.display.startsWith("inline") || cs.position === "sticky" || cs.position === "fixed" || cs.position === "absolute") continue;
        next = { el, top: r.top - line, vis: r.bottom - line };
        break;
      }
      if (!next) break;
      best = next;
      box = next.top < 0 ? next.el : null;
    }
    return best;
  }
  // Where block b's line is now (window px), so the gap from the nav's bottom edge is the scroll that brings it back: its
  // top at the same distance from that edge, unless it has grown shorter, when as much of it stays below the edge as did
  // before (or all of it), so it never ends up wholly above it. null when it has no box (gone, or hidden at this size).
  const blockTop = (b) => {
    if (!b || !b.el.isConnected) return null;
    const r = b.el.getBoundingClientRect();
    return r.height > 0 ? r.top - Math.max(b.top, Math.min(b.vis, r.height) - r.height) : null;
  };
  // keepPlace(onRead) keeps the reader's block across a resize (a phone turned on its side): the text above them reflows
  // and scrollY stays put, and the browser's own scroll anchoring does not hold it (a phone's rotation anchor finds the
  // fixed nav at the top of the window; on a desktop the gutters and type sizes that follow the window width suppress
  // it). The block (readBlock() of the page under the nav's bottom edge) is read after each scroll and each reflow in
  // main at the same window size (a phone's address bar, under 120px, does not count). After a resize its top goes back
  // to the same distance from the edge in the first frame (before the first paint at the new size) and again on the next
  // two, as nearby content-visibility sections render. Until the reader scrolls it stays the block they were on, so
  // turning the phone back returns the same place exactly. At the very top of the page there is none, and the top stays.
  // onRead(kept) runs after each read, with kept true while the reader is still where a restore (or hold()) left them.
  function keepPlace(onRead) {
    let w = window.innerWidth;
    let h = window.innerHeight;
    const same = () => window.innerWidth === w && Math.abs(window.innerHeight - h) < 120;
    let block = null;
    let keptY = -1; // the scrollY a restore left the reader at
    const kept = () => keptY >= 0 && window.scrollY === keptY;
    let readRaf = 0;
    let backRaf = 0;
    const read = () => {
      readRaf = 0;
      if (!same()) return;
      if (!kept()) {
        keptY = -1;
        block = window.scrollY > 0 ? readBlock(document.body, navBottom()) : null;
      }
      if (onRead) onRead(kept());
    };
    const queue = () => {
      if (!readRaf) readRaf = requestAnimationFrame(read);
    };
    // b stays the reader's block, at this window size, until they scroll from here
    const hold = (b) => {
      w = window.innerWidth;
      h = window.innerHeight;
      block = b;
      keptY = b ? window.scrollY : -1;
    };
    const back = (b, again) => {
      backRaf = 0;
      const bt = blockTop(b);
      if (bt != null && Math.abs(bt - navBottom()) >= 1) window.scrollBy(0, bt - navBottom());
      if (again) backRaf = requestAnimationFrame(() => back(b, again - 1));
      else {
        hold(bt != null ? b : null);
        read();
      }
    };
    const onResize = () => {
      if (same() || backRaf) return;
      const b = block;
      backRaf = requestAnimationFrame(() => back(b, 2));
    };
    on(window, "scroll", queue, { passive: true });
    on(window, "resize", onResize, { passive: true });
    const ro = window.ResizeObserver ? new ResizeObserver(queue) : null;
    if (ro) $$("main > *").forEach((el) => ro.observe(el));
    read();
    return {
      block: () => block,
      same,
      kept,
      hold,
      stop() {
        window.removeEventListener("scroll", queue);
        window.removeEventListener("resize", onResize);
        if (ro) ro.disconnect();
        cancelAnimationFrame(readRaf);
        cancelAnimationFrame(backRaf);
        readRaf = backRaf = 0;
      }
    };
  }

  /* ---------- Nav and phone menu ---------- */

  function setupNav() {
    const nav = $("[data-nav]");
    if (!nav) return;
    onScroll((y) => nav.classList.toggle("is-scrolled", y > 8));

    const button = $("[data-menu]", nav);
    const menu = $("#menu");
    if (!button || !menu) return;
    const isOpen = () => button.getAttribute("aria-expanded") === "true";
    const setOpen = (open) => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.hidden = !open;
      nav.classList.toggle("is-open", open);
      document.body.classList.toggle("menu-open", open);
    };
    on(button, "click", () => setOpen(!isOpen()));
    on(menu, "click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    on(document, "keydown", (e) => {
      if (e.key === "Escape" && isOpen()) {
        setOpen(false);
        button.focus();
      }
    });
    // Focus that leaves the bar and the panel (a Tab past the last link) closes it, so it never sits on the page under
    // the scrim. Focus stays where it went.
    on(nav, "focusout", (e) => {
      if (isOpen() && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false);
    });
    // A tap outside the bar and the panel (on the scrim) closes it, and does nothing else: on touch, the click that
    // follows the tap would otherwise land on whatever the scrim covered once it has gone, so that click is dropped.
    // A swipe there brings no click (the browser cancels the pointer to scroll), and the next press is a new tap: either
    // one disarms the drop, so only the click of that scrim tap is ever lost.
    let disarm = null;
    on(document, "pointerdown", (e) => {
      if (disarm) disarm();
      if (!isOpen() || nav.contains(e.target)) return;
      setOpen(false);
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener("click", swallow, true);
        window.removeEventListener("pointercancel", done, true);
        disarm = null;
      };
      const swallow = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        done();
      };
      const timer = setTimeout(done, 700);
      window.addEventListener("click", swallow, true);
      window.addEventListener("pointercancel", done, true);
      disarm = done;
    });
    // While the Next block is on screen, the nav button steps back so only one solid button is in view.
    const reg = $("[data-nav-register]", nav);
    const next = $("#next");
    if (reg && next && window.IntersectionObserver) {
      new IntersectionObserver((entries) => reg.classList.toggle("is-quiet", entries[0].isIntersecting), { rootMargin: "0px 0px -35% 0px" }).observe(next);
    }
    // Growing past the phone layout closes it.
    on(mq("(min-width: 720px)"), "change", (e) => {
      if (e.matches && isOpen()) setOpen(false);
    });
  }

  /* ---------- Next Sunday, in Tashkent ---------- */

  function tashkentToday() {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Tashkent",
      year: "numeric",
      month: "numeric",
      day: "numeric"
    }).formatToParts(new Date());
    const get = (type) => Number(parts.find((p) => p.type === type).value);
    return new Date(Date.UTC(get("year"), get("month") - 1, get("day")));
  }

  // { date (UTC midnight), label "Sunday 25 October", text (with "Today, " on the day), weekday, day, isToday }
  function nextDate() {
    const today = tashkentToday();
    let date = null;
    if (config.nextTournament) {
      const set = new Date(config.nextTournament + "T00:00:00Z");
      if (!Number.isNaN(set.getTime()) && set >= today) date = set;
    }
    if (!date) {
      date = new Date(today);
      date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7));
    }
    const fmt = (o) => new Intl.DateTimeFormat("en-GB", Object.assign({ timeZone: "UTC" }, o)).format(date);
    const label = fmt({ weekday: "long", day: "numeric", month: "long" });
    const isToday = date.getTime() === today.getTime();
    return {
      date,
      label,
      isToday,
      text: isToday ? "Today, " + label : label,
      weekday: (isToday ? "Today, " : "") + fmt({ weekday: "long" }),
      day: fmt({ day: "numeric", month: "long" })
    };
  }

  function setupNext() {
    const nd = nextDate();
    $$("[data-next-date]").forEach((el) => {
      if (el.hasAttribute("data-next-split")) {
        // Two lines: the weekday, then the day and month. Each line never breaks inside.
        el.innerHTML = '<span class="nd-w">' + esc(nd.weekday) + '</span> <span class="nd-d">' + esc(nd.day) + "</span>";
        el.setAttribute("aria-label", nd.text);
      } else el.textContent = nd.text;
    });

    const url = (config.registerUrl || "").trim();
    $$("[data-register]").forEach((a) => {
      if (!url) return;
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
    });
    $$("[data-register-only]").forEach((el) => (el.hidden = !url));
    $$("[data-register-fallback]").forEach((el) => (el.hidden = Boolean(url)));

    const telegram = (config.telegramUrl || "").trim();
    $$("[data-telegram]").forEach((el) => {
      el.hidden = !telegram;
      const link = el.matches("a") ? el : $("a", el);
      if (telegram && link) {
        link.href = telegram;
        link.target = "_blank";
        link.rel = "noopener";
      }
    });

    if (config.email) {
      $$("[data-email]").forEach((el) => (el.textContent = config.email));
      $$("[data-copy-email]").forEach((el) => (el.dataset.copy = config.email));
      $$("[data-mailto]").forEach((a) => {
        const subject = a.getAttribute("data-mailto");
        a.href = "mailto:" + config.email + (subject ? "?subject=" + encodeURIComponent(subject) : "");
      });
    }
  }

  /* ---------- Copy with status ---------- */

  // A polite status after each Copy button, so screen readers hear the result.
  function addCopyStatus(r = document) {
    $$("[data-copy]", r).forEach((button) => {
      const next = button.nextElementSibling;
      if (next && next.matches("[data-copy-status]")) return;
      const status = document.createElement("span");
      status.className = "sr-only";
      status.setAttribute("role", "status");
      status.dataset.copyStatus = "";
      button.after(status);
    });
  }

  function setupCopy() {
    addCopyStatus();
    on(document, "click", async (e) => {
      const button = e.target.closest("[data-copy]");
      if (!button) return;
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      const next = button.nextElementSibling;
      const status = next && next.matches("[data-copy-status]") ? next : null;
      const say = (word, message) => {
        button.textContent = word;
        if (status) status.textContent = message;
        clearTimeout(button._timer);
        button._timer = setTimeout(() => {
          button.textContent = original;
          if (status) status.textContent = "";
        }, 1800);
      };
      try {
        if (document.featurePolicy && !document.featurePolicy.allowsFeature("clipboard-write")) throw new Error("blocked");
        if (!navigator.clipboard) throw new Error("none");
        await navigator.clipboard.writeText(button.dataset.copy || config.email || "");
        say("Copied", "Email address copied");
      } catch (err) {
        const scope = button.closest(".contact, [data-copy-scope]") || button.parentElement;
        const text = scope && $(".email", scope);
        if (text) {
          const range = document.createRange();
          range.selectNodeContents(text);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        say("Selected", "Email address selected. Press Ctrl+C or Cmd+C to copy it.");
      }
    });
  }

  /* ---------- Photo slots ---------- */

  // A slot ([data-slot]) keeps its designed stand-in until its image really loads; a missing file is removed.
  // An img with data-alt keeps alt="" until then, so screen readers never hear a photo that is not there.
  const watched = new WeakSet();
  function watchImage(img) {
    if (!img || watched.has(img)) return;
    watched.add(img);
    const slot = img.closest("[data-slot]");
    const show = () => { if (img.naturalWidth > 0) { if (img.dataset.alt) img.alt = img.dataset.alt; if (slot) slot.classList.add("has-image"); } };
    const fail = () => {
      if (slot) slot.classList.remove("has-image");
      img.remove();
    };
    img.addEventListener("load", show);
    img.addEventListener("error", fail);
    if (img.complete && img.getAttribute("src")) {
      if (img.naturalWidth > 0) show();
      else fail();
    }
  }
  function watchAll(r = document) {
    if (r.matches && r.matches("[data-slot] img")) watchImage(r);
    $$("[data-slot] img", r).forEach(watchImage);
  }
  function setupSlots() {
    watchAll();
    // Slots rendered later by page scripts are picked up on their own.
    new MutationObserver((records) => {
      records.forEach((rec) => rec.addedNodes.forEach((n) => n.nodeType === 1 && watchAll(n)));
    }).observe(document.body, { childList: true, subtree: true });
  }

  // Markup for a 4:5 portrait slot of an organizer: initials until the photo loads.
  function portraitMarkup(p, opts = {}) {
    const tag = opts.tag || "span";
    const cls = "plate portrait" + (opts.className ? " " + opts.className : "");
    return (
      "<" + tag + ' class="' + cls + '" data-slot data-portrait>' +
      '<span class="monogram" aria-hidden="true">' + esc(initials(p.name)) + "</span>" +
      '<img src="' + esc(p.photo) + '" alt="' + esc(opts.alt == null ? "Portrait of " + p.name : opts.alt) + '"' +
      (opts.eager ? "" : ' loading="lazy"') + ' decoding="async">' +
      "</" + tag + ">"
    );
  }

  /* ---------- The Next block bookend: a quiet chamber with one open seat ---------- */

  function setupNextArc() {
    const C = window.UNPCChamber;
    $$("[data-next-arc]").forEach((svg) => {
      if (!C || svg.childElementCount) return;
      const unit = C.seats(140, 0.42);
      // The seat left open: front row, a little right of centre.
      let pick = 0;
      let best = Infinity;
      unit.list.forEach((st, i) => {
        if (st.row !== 0) return;
        const d = Math.abs(st.th - Math.PI * 0.42);
        if (d < best) {
          best = d;
          pick = i;
        }
      });
      C.chamberSVG(svg, {
        n: 140,
        q: 0.42,
        cx: 200,
        cy: 206,
        R: 192,
        rK: 0.25,
        cls: (i) => (i === pick ? "you" : "seat"),
        r: (i, st, base) => (i === pick ? base * 1.05 : base)
      });
    });
  }

  /* ---------- Organizer dialog (8.3) ---------- */

  const dialogApi = { open() {}, close() {}, isOpen: () => false };

  function contactMarkup(email) {
    return (
      '<div class="contact" data-copy-scope>' +
      '<span class="email">' + esc(email) + "</span>" +
      '<button type="button" class="btn btn-quiet btn-sm" data-copy="' + esc(email) + '">Copy</button>' +
      "</div>"
    );
  }

  function setupPersonDialog() {
    if (!shown.length) return;
    const dialog = document.createElement("dialog");
    dialog.className = "person";
    dialog.setAttribute("aria-labelledby", "person-name");
    dialog.innerHTML =
      '<div class="person-panel" data-panel>' +
      '<button type="button" class="icon-btn person-close" aria-label="Close">' +
      '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>' +
      "</button>" +
      '<div class="plate portrait person-photo" data-slot><span class="monogram" aria-hidden="true"></span></div>' +
      '<div class="person-body">' +
      '<p class="person-role"></p>' +
      '<h2 class="person-name" id="person-name"></h2>' +
      '<p class="person-school"></p>' +
      '<p class="person-bio"></p>' +
      '<p class="person-more"></p>' +
      '<div class="person-contact"></div>' +
      '<div class="person-steps">' +
      '<button type="button" class="btn-link" data-step="-1">Previous</button>' +
      '<span class="person-count"></span>' +
      '<button type="button" class="btn-link" data-step="1">Next</button>' +
      "</div>" +
      "</div>" +
      "</div>";
    document.body.append(dialog);

    const panel = $("[data-panel]", dialog);
    const photo = $(".person-photo", dialog);
    const body = $(".person-body", dialog);
    const closeButton = $(".person-close", dialog);
    const steps = $(".person-steps", dialog);
    const field = (sel) => $(sel, dialog);
    steps.hidden = shown.length < 2;

    let index = 0;
    let opener = null; // the element the user activated, when opened by the user
    let baseHash = "";
    let closing = false;

    const anims = (el) => el.getAnimations && el.getAnimations().forEach((a) => a.cancel());

    const fill = (i) => {
      index = (i + shown.length) % shown.length;
      const p = shown[index];
      // A fresh img each time: a missing file removes its img.
      const old = $("img", photo);
      if (old) old.remove();
      photo.classList.remove("has-image");
      $(".monogram", photo).textContent = initials(p.name);
      const img = document.createElement("img");
      img.alt = "Portrait of " + p.name;
      img.decoding = "async";
      img.src = p.photo;
      photo.append(img);
      watchImage(img);
      field(".person-role").textContent = p.role || "";
      field(".person-name").textContent = p.name;
      field(".person-school").textContent = p.school || "";
      field(".person-school").hidden = !p.school;
      field(".person-bio").textContent = tidy(p.bio);
      field(".person-bio").hidden = !p.bio;
      field(".person-more").textContent = tidy(p.more);
      field(".person-more").hidden = !p.more;
      const email = p.links && p.links.email;
      field(".person-contact").innerHTML = email ? contactMarkup(email) : "";
      field(".person-contact").hidden = !email;
      addCopyStatus(field(".person-contact"));
      field(".person-count").textContent = index + 1 + " of " + shown.length;
      if (p.id) setUrl("#" + p.id);
    };

    // Where the dialog grows out of: the trigger itself, a portrait inside it, the clicked seat of the team chamber or
    // the trigger's own seat mark (Team's founder row), else (other text triggers and deep links) a portrait of the same
    // person at least three quarters in view, so the panel never starts mostly below the fold. null: it fades in instead.
    // A seat or mark is widened to at least 48px (in the portrait's 4:5) so the scale stays gentle.
    const widened = (el) => {
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) return null;
      const w = Math.max(48, r.width);
      const h = w * 1.25;
      return { left: r.left + r.width / 2 - w / 2, top: r.top + r.height / 2 - h / 2, width: w, height: h };
    };
    const sourceRect = (trigger, i) => {
      let el = null;
      if (trigger) el = trigger.matches("[data-portrait], .portrait") ? trigger : $("[data-portrait], .portrait", trigger);
      if (!el && trigger) {
        const seat = trigger instanceof SVGElement ? trigger : $(".role-mark, .sign-mark", trigger);
        const r = seat && widened(seat);
        if (r) return r;
      }
      if (!el) {
        el = $$('[data-person="' + i + '"] [data-portrait], [data-person="' + i + '"][data-portrait], [data-person="' + i + '"] .portrait').find((n) => {
          const r = n.getBoundingClientRect();
          return r.width > 0 && Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0) >= r.height * 0.75;
        });
      }
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? r : null;
    };

    const backdrop = (from, to, duration) => {
      try {
        dialog.animate([{ opacity: from }, { opacity: to }], { duration, easing: "ease-out", pseudoElement: "::backdrop", fill: "forwards" });
      } catch (e) {}
    };

    const animateOpen = (trigger, i) => {
      if (!motion() || !panel.animate) return;
      [panel, body].forEach(anims);
      if (dialog.getAnimations) dialog.getAnimations({ subtree: false }).forEach((a) => a.cancel());
      if (wideMQ.matches) {
        const from = sourceRect(trigger, i);
        const ease = "cubic-bezier(.2,.75,.1,1)";
        backdrop(0, 1, 420);
        if (from) {
          // FLIP: from the clicked portrait's rect to the dialog portrait's rect.
          const pr = panel.getBoundingClientRect();
          const to = photo.getBoundingClientRect();
          let s = from.width / to.width;
          let sy = from.height / to.height;
          let tx = from.left - pr.left - (to.left - pr.left) * s;
          let ty = from.top - pr.top - (to.top - pr.top) * sy;
          // A source portrait larger than the dialog's (Team's founder portrait) would make the panel start oversized
          // and shrink into place. The panel never starts above its size: it starts at 0.94, with its portrait's centre
          // on the clicked portrait's centre, and grows into place from there.
          if (s > 0.94 || sy > 0.94) {
            s = sy = 0.94;
            tx = from.left + from.width / 2 - pr.left - (to.left - pr.left + to.width / 2) * s;
            ty = from.top + from.height / 2 - pr.top - (to.top - pr.top + to.height / 2) * s;
          }
          panel.animate([{ transform: "translate(" + tx + "px," + ty + "px) scale(" + s + "," + sy + ")", borderRadius: "6px" }, { transform: "none" }], { duration: 620, easing: ease });
          // Linear timing with the ease on the last leg, so the text stays hidden for the first 35% of the time.
          body.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 0, transform: "translateY(14px)", offset: 0.35, easing: ease }, { opacity: 1, transform: "none" }], { duration: 620 });
          closeButton.animate([{ opacity: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: 620 });
        } else {
          panel.animate([{ opacity: 0, transform: "translateY(10px) scale(.98)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: ease });
        }
      } else {
        backdrop(0, 1, 360);
        panel.animate([{ transform: "translateY(100%)" }, { transform: "none" }], { duration: 360, easing: "cubic-bezier(.2,.7,.1,1)" });
      }
    };

    const open = (i, trigger, user) => {
      const k = Number(i);
      if (!Number.isInteger(k) || k < 0 || k >= shown.length) return;
      if (dialog.open) {
        fill(k);
        return;
      }
      closing = false;
      // A trigger inside an aria-hidden figure (the team chamber's seat) returns focus to that person's button instead.
      opener = user && trigger ? (trigger.closest('[aria-hidden="true"]') ? $('button[data-person="' + trigger.getAttribute("data-person") + '"]') : trigger) : null;
      if (!shown.some((p) => "#" + p.id === location.hash)) baseHash = location.hash;
      fill(k);
      dialog.showModal();
      panel.scrollTop = 0;
      closeButton.focus({ preventScroll: true });
      animateOpen(trigger, k);
      emit("unpc:dialog", { open: true, index: k });
    };

    const finishClose = () => {
      [panel, body].forEach(anims);
      if (dialog.getAnimations) dialog.getAnimations({ subtree: false }).forEach((a) => a.cancel());
      dialog.close();
      closing = false;
      setUrl(location.pathname + location.search + baseHash);
      // Focus returns to the opener; after a deep link, to the matching card, without scrolling.
      let back = opener && document.contains(opener) ? opener : null;
      if (!back) back = $('[data-person="' + index + '"]') || $('[data-person="' + (shown[index] && shown[index].id) + '"]');
      // After a deep link, a card far off screen would leave focus thousands of pixels away, and a page with no card
      // (Partners) would leave it on the body: use the top of the page.
      const offscreen = (el) => { const r = el.getBoundingClientRect(); return r.bottom < 0 || r.top > innerHeight; };
      if (!opener && (!back || offscreen(back))) back = document.getElementById("main");
      if (back) back.focus({ preventScroll: !opener });
      opener = null;
      emit("unpc:dialog", { open: false, index });
    };

    const close = () => {
      if (!dialog.open || closing) return;
      if (!motion() || !panel.animate) return finishClose();
      closing = true;
      backdrop(1, 0, 220);
      const a = panel.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(.97)" }], { duration: 220, easing: "ease-in", fill: "forwards" });
      a.onfinish = finishClose;
      a.oncancel = () => {
        if (closing) finishClose();
      };
    };

    // Any element with data-person opens the dialog (index into shown, or the person's id).
    const resolve = (v) => {
      if (v == null || v === "") return -1;
      if (/^\d+$/.test(String(v))) return Number(v);
      return shown.findIndex((p) => p.id === v);
    };
    on(document, "click", (e) => {
      const trigger = e.target.closest("[data-person]");
      if (!trigger || dialog.contains(trigger)) return;
      const k = resolve(trigger.getAttribute("data-person"));
      if (k < 0) return;
      e.preventDefault();
      open(k, trigger, true);
    });

    const outside = (e) => {
      const r = panel.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    on(dialog, "pointerdown", (e) => {
      pressedOutside = outside(e);
    });
    on(dialog, "click", (e) => {
      const wasOutside = pressedOutside;
      pressedOutside = false;
      // Keyboard clicks report 0,0 and never count as a backdrop click.
      if (wasOutside && e.detail > 0 && outside(e)) {
        close();
        return;
      }
      const step = e.target.closest("[data-step]");
      if (step) fill(index + Number(step.dataset.step));
    });
    on(closeButton, "click", close);
    on(dialog, "cancel", (e) => {
      e.preventDefault();
      close();
    });
    on(dialog, "keydown", (e) => {
      if (shown.length < 2) return;
      if (e.target.closest && e.target.closest("input, textarea")) return;
      if (e.key === "ArrowRight") fill(index + 1);
      if (e.key === "ArrowLeft") fill(index - 1);
    });

    const fromHash = () => {
      const k = shown.findIndex((p) => p.id && "#" + p.id === location.hash);
      if (k > -1 && !dialog.open) {
        open(k, $('[data-person="' + k + '"]'), false);
        // The browser's own scroll to the fragment can run after this and take focus out of the dialog.
        const refocus = () => { if (dialog.open && !dialog.contains(document.activeElement)) closeButton.focus({ preventScroll: true }); };
        requestAnimationFrame(refocus);
        if (document.readyState !== "complete") window.addEventListener("load", () => requestAnimationFrame(refocus), { once: true });
      }
    };
    on(window, "hashchange", fromHash);
    // Page scripts render their triggers before DOMContentLoaded (all scripts are defer), so check then.
    if (document.readyState === "loading") on(document, "DOMContentLoaded", fromHash);
    else fromHash();

    dialogApi.open = open;
    dialogApi.close = close;
    dialogApi.isOpen = () => dialog.open;
    dialogApi.element = dialog;
  }

  /* ---------- Start ---------- */

  setupMotion();
  setupTheme();
  setupNav();
  setupNext();
  setupCopy();
  setupSlots();
  setupNextArc();
  setupPersonDialog();

  window.UNPCSite = {
    // data
    config,
    people,
    shown,
    partners,
    // organizer dialog: index into `shown`; triggerEl is the element it grows out of and gets focus back
    openPerson: (index, triggerEl) => dialogApi.open(index, triggerEl || null, Boolean(triggerEl)),
    closePerson: () => dialogApi.close(),
    dialogOpen: () => dialogApi.isOpen(),
    // photo slots
    watchImage,
    watchAll,
    portraitMarkup,
    initials,
    // theme and motion
    theme,
    setTheme,
    onTheme,
    reducedMotion,
    motion,
    onMotion,
    // shared loops and signals
    onScroll,
    onLayout,
    // the reader's place across a resize
    navBottom,
    readBlock,
    blockTop,
    keepPlace,
    // next Sunday and contact
    nextDate,
    tashkentToday,
    addCopyStatus,
    contactMarkup,
    // helpers
    tidy,
    setUrl,
    esc,
    $,
    $$
  };
  emit("unpc:ready", {});
})();
