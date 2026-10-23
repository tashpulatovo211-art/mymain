(() => {
  "use strict";

  const data = window.UNPC || {};
  const config = data.config || {};
  const people = data.organizers || [];
  const partners = data.partners || [];
  const shown = people.filter((p) => !p.placeholder);
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Photo and logo slots keep their placeholder until the file actually loads.
  function watchImage(img) {
    const slot = img.closest("[data-slot]");
    if (!slot) return;
    const show = () => {
      if (img.naturalWidth > 0) slot.classList.add("has-image");
    };
    if (img.complete) show();
    img.addEventListener("load", show);
  }

  /* Navigation */

  function setupNav() {
    const nav = $(".nav");
    if (!nav) return;
    const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    const button = $(".menu-btn", nav);
    const menu = $("#menu");
    if (!button || !menu) return;
    const setOpen = (open) => {
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      menu.hidden = !open;
      nav.classList.toggle("is-open", open);
    };
    button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
    menu.addEventListener("click", (e) => {
      if (e.target.closest("a")) setOpen(false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        setOpen(false);
        button.focus();
      }
    });
  }

  /* Registration, next date, contact */

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

  function setupNext() {
    const targets = $$("[data-next-date]");
    if (targets.length) {
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
      const label = new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "UTC"
      }).format(date);
      const text = date.getTime() === today.getTime() ? "Today, " + label : label;
      targets.forEach((el) => (el.textContent = text));
    }

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
      if (telegram && link) link.href = telegram;
    });

    if (config.email) {
      $$("[data-email]").forEach((el) => (el.textContent = config.email));
      $$("[data-copy-email]").forEach((el) => (el.dataset.copy = config.email));
    }
  }

  function setupCopy() {
    document.addEventListener("click", async (e) => {
      const button = e.target.closest("[data-copy]");
      if (!button) return;
      const original = button.dataset.label || button.textContent;
      button.dataset.label = original;
      const say = (text) => {
        button.textContent = text;
        clearTimeout(button._timer);
        button._timer = setTimeout(() => (button.textContent = original), 1800);
      };
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        say("Copied");
      } catch {
        const text = button.parentElement && $(".email", button.parentElement);
        if (text) {
          const range = document.createRange();
          range.selectNodeContents(text);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        }
        say("Selected");
      }
    });
  }

  /* Hero: draw a case, run the hour */

  function makeClock(root) {
    const clock = $("[data-clock]", root);
    const label = $("[data-clock-label]", root);
    const toggle = $("[data-clock-toggle]", root);
    const reset = $("[data-clock-reset]", root);
    if (!clock || !toggle) return { reset() {} };

    const FULL = 60 * 60 * 1000;
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
        clock.textContent = "00:00";
        setState("done");
        return;
      }
      clock.textContent = format(ms);
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
      clock.textContent = format(FULL);
    };

    toggle.addEventListener("click", () => {
      if (state === "running") pause();
      else if (state === "done") {
        clear();
        start();
      } else start();
    });
    if (reset) reset.addEventListener("click", clear);
    setState("idle");
    return { reset: clear };
  }

  function setupDeck() {
    const deck = $("[data-deck]");
    if (!deck) return;
    const card = $(".case", deck);
    const items = $$(".case-item", deck);
    const count = $("[data-case-count]", deck);
    const drawButton = $("[data-draw]", deck);
    const clock = makeClock(card);
    let current = items.findIndex((el) => el.classList.contains("is-current"));
    let pile = [];
    let busy = false;

    const show = (i) => {
      items.forEach((el, k) => el.classList.toggle("is-current", k === i));
      count.textContent = "Case " + (i + 1) + " of " + items.length;
      current = i;
    };
    const nextIndex = () => {
      if (!pile.length) {
        pile = items.map((_, i) => i).filter((i) => i !== current);
        for (let i = pile.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [pile[i], pile[j]] = [pile[j], pile[i]];
        }
      }
      return pile.pop();
    };

    drawButton.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      const next = nextIndex();
      clock.reset();
      if (reduced.matches || !card.animate) {
        show(next);
        busy = false;
        return;
      }
      const out = card.animate(
        [{ transform: "none", opacity: 1 }, { transform: "translate(-32px, 4px) rotate(-3deg)", opacity: 0 }],
        { duration: 220, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" }
      );
      await out.finished;
      show(next);
      card.animate(
        [{ transform: "translate(20px, 24px) rotate(2.5deg)", opacity: 0 }, { transform: "none", opacity: 1 }],
        { duration: 460, easing: "cubic-bezier(.2,.7,.2,1)" }
      );
      out.cancel();
      busy = false;
    });
  }

  /* The day, drawn to scale */

  function setupDay() {
    const day = $("[data-day]");
    if (!day) return;
    const parts = $$("[data-phase]", day);
    let pinned = null;
    const highlight = (key) => parts.forEach((el) => el.classList.toggle("is-active", key !== null && el.dataset.phase === key));
    parts.forEach((el) => {
      el.addEventListener("pointerenter", () => highlight(el.dataset.phase));
      el.addEventListener("pointerleave", () => highlight(pinned));
    });
    $$("button[data-phase]", day).forEach((button) => {
      button.addEventListener("focus", () => highlight(button.dataset.phase));
      button.addEventListener("blur", () => highlight(pinned));
      button.addEventListener("click", () => {
        pinned = pinned === button.dataset.phase ? null : button.dataset.phase;
        $$("button[data-phase]", day).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.phase === pinned)));
        highlight(pinned);
      });
    });
  }

  /* Judging sheet */

  function setupSheet() {
    const sheet = $("[data-sheet]");
    if (!sheet) return;
    const rows = $$(".sheet-row", sheet);
    const totalA = $('[data-total="a"]', sheet);
    const totalB = $('[data-total="b"]', sheet);
    const verdict = $("[data-verdict]", sheet);

    const paint = (input) => {
      const p = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty("--p", p + "%");
      const out = input.parentElement.querySelector("output");
      if (out) out.textContent = input.value;
    };

    const update = () => {
      let a = 0;
      let b = 0;
      let qa = 0;
      let qb = 0;
      rows.forEach((row) => {
        const [ia, ib] = $$("input", row);
        paint(ia);
        paint(ib);
        a += Number(ia.value);
        b += Number(ib.value);
        if (row.dataset.key === "solution") {
          qa = Number(ia.value);
          qb = Number(ib.value);
        }
      });
      totalA.textContent = a;
      totalB.textContent = b;
      const high = Math.max(a, b);
      const low = Math.min(a, b);
      if (a !== b) {
        verdict.textContent = "Team " + (a > b ? "A" : "B") + " wins the room, " + high + " to " + low + ".";
      } else if (qa !== qb) {
        verdict.textContent =
          "Tied at " + a + ". Team " + (qa > qb ? "A" : "B") + " wins on quality of the solution, " + Math.max(qa, qb) + " to " + Math.min(qa, qb) + ".";
      } else {
        verdict.textContent = "Tied at " + a + ", and level on quality of the solution too. The rubric has no further tie-break, so the judges talk it through.";
      }
    };

    sheet.addEventListener("input", update);
    update();
  }

  /* People */

  const personCard = (p, i) => `
    <li class="person-card${p.placeholder ? " is-placeholder" : ""}">
      <button type="button" class="person-trigger" data-person="${i}" aria-haspopup="dialog">
        <span class="photo" data-slot>
          <img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">
        </span>
        <span class="person-name">${esc(p.name)}</span>
        <span class="person-role">${esc(p.role)}</span>
      </button>
    </li>`;

  // A role that has no organizer yet: a quiet slot, not a button.
  const roleCard = (p) => `
    <li class="person-card is-placeholder">
      <div class="person-trigger">
        <span class="photo" data-slot>
          <img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">
        </span>
        <span class="person-name">${esc(p.role)}</span>
      </div>
    </li>`;

  // On the Team page the first person gets a full-width row with their bio.
  const leadCard = (p, i) => `
    <li class="person-lead${p.placeholder ? " is-placeholder" : ""}">
      <button type="button" class="person-trigger" data-person="${i}" aria-haspopup="dialog" aria-label="${esc(p.name)}, ${esc(p.role)}">
        <span class="photo" data-slot>
          <img src="${esc(p.photo)}" alt="" loading="lazy" decoding="async">
        </span>
      </button>
      <div class="lead-text">
        <p class="person-kicker">${esc(p.role)}</p>
        <h2 class="lead-name">${esc(p.name)}</h2>
        ${p.school ? `<p class="lead-school">${esc(p.school)}</p>` : ""}
        <p class="lead-bio">${esc(p.bio)}</p>
        <button type="button" class="btn btn-line" data-person="${i}" aria-haspopup="dialog">About ${esc(p.name.split(" ")[0])}</button>
      </div>
    </li>`;

  function renderPeople() {
    const lists = $$("[data-people]");
    if (!lists.length || !people.length) return;
    lists.forEach((list) => {
      const featured = list.dataset.people === "team";
      const source = people;
      const limit = Number(list.dataset.limit) || source.length;
      list.innerHTML = source
        .slice(0, limit)
        .map((p, i) => {
          if (p.placeholder) return roleCard(p);
          const n = shown.indexOf(p);
          return featured && i === 0 ? leadCard(p, n) : personCard(p, n);
        })
        .join("");
      $$("img", list).forEach(watchImage);
    });
    if (shown.length) setupPersonDialog();
  }

  function linksHtml(links = {}) {
    const out = [];
    if (links.email) {
      out.push(
        `<span class="contact"><span class="email">${esc(links.email)}</span><button type="button" class="btn-copy" data-copy="${esc(links.email)}">Copy</button></span>`
      );
    }
    if (links.telegram) out.push(`<a href="${esc(links.telegram)}" target="_blank" rel="noopener">Telegram</a>`);
    if (links.linkedin) out.push(`<a href="${esc(links.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`);
    return out.join("");
  }

  function setupPersonDialog() {
    const dialog = document.createElement("dialog");
    dialog.className = "person";
    dialog.setAttribute("aria-labelledby", "person-name");
    dialog.innerHTML = `
      <div class="person-inner">
        <div class="photo person-photo" data-slot>
          <img alt="">
        </div>
        <div class="person-body">
          <p class="person-kicker"></p>
          <h2 id="person-name"></h2>
          <p class="person-school"></p>
          <p class="person-bio"></p>
          <p class="person-more"></p>
          <div class="person-links"></div>
          <div class="person-steps">
            <button type="button" class="btn-text" data-step="-1">Previous</button>
            <span class="person-count"></span>
            <button type="button" class="btn-text" data-step="1">Next</button>
          </div>
        </div>
        <button type="button" class="person-close" aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
        </button>
      </div>`;
    document.body.append(dialog);

    const photo = $(".person-photo", dialog);
    const img = $("img", photo);
    const closeButton = $(".person-close", dialog);
    const field = (sel) => $(sel, dialog);
    let index = 0;
    let list = null;
    let opener = null;
    let baseHash = "";
    const setUrl = (u) => {
      try {
        history.replaceState(null, "", u);
      } catch {}
    };
    watchImage(img);
    $(".person-steps", dialog).hidden = shown.length < 2;

    const fill = (i) => {
      index = (i + shown.length) % shown.length;
      const p = shown[index];
      photo.classList.remove("has-image");
      img.alt = p.placeholder ? "" : "Portrait of " + p.name;
      img.src = p.photo;
      field(".person-kicker").textContent = p.role;
      field("#person-name").textContent = p.name;
      field(".person-school").textContent = p.school || "";
      field(".person-school").hidden = !p.school;
      field(".person-bio").textContent = p.bio || "";
      field(".person-more").textContent = p.more || "";
      field(".person-more").hidden = !p.more;
      field(".person-links").innerHTML = linksHtml(p.links);
      field(".person-count").textContent = index + 1 + " of " + shown.length;
      if (p.id) setUrl("#" + p.id);
    };

    const cardPhoto = (i) => (list ? $(`[data-person="${i}"] .photo`, list) : null);
    const canMorph = (el) => el && document.startViewTransition && !reduced.matches;

    const open = (i, trigger, user) => {
      if (!dialog.open) {
        opener = user ? trigger : null;
        if (!shown.some((p) => "#" + p.id === location.hash)) baseHash = location.hash;
      }
      list = trigger ? trigger.closest("[data-people]") : $("[data-people]");
      const from = (trigger && $(".photo", trigger)) || cardPhoto(i);
      const show = () => {
        fill(i);
        if (!dialog.open) dialog.showModal();
        closeButton.focus();
      };
      if (!canMorph(from)) return show();
      from.style.viewTransitionName = "person-photo";
      dialog.classList.add("is-vt");
      const vt = document.startViewTransition(() => {
        from.style.viewTransitionName = "";
        show();
        photo.style.viewTransitionName = "person-photo";
      });
      vt.finished.finally(() => {
        photo.style.viewTransitionName = "";
        dialog.classList.remove("is-vt");
      });
    };

    const close = () => {
      const to = cardPhoto(index);
      const back = opener && Number(opener.dataset.person) === index ? opener : to ? to.closest("[data-person]") : null;
      const hide = () => {
        dialog.close();
        setUrl(location.pathname + location.search + baseHash);
      };
      if (!canMorph(to) || !dialog.open) {
        hide();
        if (back) back.focus({ preventScroll: !opener });
        return;
      }
      photo.style.viewTransitionName = "person-photo";
      const vt = document.startViewTransition(() => {
        photo.style.viewTransitionName = "";
        hide();
        to.style.viewTransitionName = "person-photo";
      });
      vt.finished.finally(() => {
        to.style.viewTransitionName = "";
        if (back) back.focus({ preventScroll: !opener });
      });
    };

    document.addEventListener("click", (e) => {
      const trigger = e.target.closest("[data-person]");
      if (trigger) open(Number(trigger.dataset.person), trigger, true);
    });
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) close();
      const step = e.target.closest("[data-step]");
      if (step) fill(index + Number(step.dataset.step));
    });
    closeButton.addEventListener("click", close);
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    dialog.addEventListener("keydown", (e) => {
      if (shown.length < 2) return;
      if (e.key === "ArrowRight") fill(index + 1);
      if (e.key === "ArrowLeft") fill(index - 1);
    });

    const fromHash = shown.findIndex((p) => p.id && "#" + p.id === location.hash);
    if (fromHash > -1) {
      const trigger = $(`[data-people] [data-person="${fromHash}"]`);
      open(fromHash, trigger);
    }
  }

  /* Partners */

  const logoSlot = (p) => `
    <div class="logo-slot" data-slot>
      <img src="${esc(p.logo)}" alt="${esc(p.name)}" decoding="async">
      <span class="logo-word">${esc(p.short || p.name)}</span>
    </div>`;

  const partnerTile = (p) => `
    <li>
      ${logoSlot(p)}
      <span class="partner-role">${esc(p.role)}</span>
    </li>`;

  const partnerRow = (p) => {
    let host = "";
    try {
      host = p.url ? new URL(p.url).hostname.replace(/^www\./, "") : "";
    } catch {
      host = "";
    }
    return `
    <li class="partner-row" id="${esc(p.id)}">
      ${logoSlot(p)}
      <div>
        <p class="partner-role">${esc(p.role)}</p>
        <h3>${esc(p.name)}</h3>
        ${p.detail ? `<p class="partner-detail">${esc(p.detail)}</p>` : ""}
        <p class="partner-text">${esc(p.text)}</p>
        ${host ? `<a class="partner-url" href="${esc(p.url)}" target="_blank" rel="noopener">${esc(host)}</a>` : ""}
      </div>
    </li>`;
  };

  function renderPartners() {
    $$("[data-partners]").forEach((list) => {
      const rows = list.dataset.partners === "rows";
      list.innerHTML = partners.map(rows ? partnerRow : partnerTile).join("");
      $$("img", list).forEach(watchImage);
    });
  }

  /* Start */

  $$("[data-slot] img").forEach(watchImage);
  setupNav();
  setupNext();
  setupCopy();
  setupDeck();
  setupDay();
  setupSheet();
  renderPartners();
  renderPeople();
})();
