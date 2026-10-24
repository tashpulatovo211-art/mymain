/* UNPC Team and Partners pages (spec 9 and 10).
   Team: the team chamber, the role list, the founder and the signature lines, all rendered from data.js.
   Partners: the partner chamber with four sectors, the partner rows and their lighting.
   Uses window.UNPCSite (site.js) and window.UNPCChamber (chamber.js). Classic defer script, after site.js.
   Organizer triggers carry data-person; site.js opens the dialog for them, so no click handlers here. */
(function () {
  "use strict";

  const S = window.UNPCSite;
  const C = window.UNPCChamber;
  if (!S || !C) return;

  const { $, $$, esc } = S;
  const SVGNS = "http://www.w3.org/2000/svg";
  const page = document.body.getAttribute("data-page");

  // A resize (a phone turned on its side) brings the reader's block back under the nav, as on the home page.
  if (S.keepPlace) S.keepPlace();

  const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const word = (n) => WORDS[n] || String(n);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  // Copy from data.js as it is, set with typographic apostrophes and non-breaking "4 October".
  const typo = (s) => S.tidy(s).replace(/(\w)'(\w)/g, "$1’$2");
  const fmt = (v) => (Math.round(v * 100) / 100).toString();
  const svgEl = (tag, attrs, parent) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(el);
    return el;
  };

  // Play a figure's intro once it is first on screen (motion only). Until then its seats wait, hidden.
  function introWhenSeen(el, duration) {
    if (!S.motion() || !window.IntersectionObserver) return;
    el.classList.add("is-wait");
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        el.classList.remove("is-wait");
        el.classList.add("is-intro");
        setTimeout(() => el.classList.remove("is-intro"), duration + 80);
      },
      { threshold: 0.15 }
    );
    io.observe(el);
  }

  /* =====================================================================
     Team page
     ===================================================================== */

  function team() {
    const people = S.people;
    const shown = S.shown;
    const founder = shown[0] || null;
    const total = people.length;
    const open = people.filter((p) => p.placeholder).length;
    const indexOf = (p) => shown.indexOf(p);

    /* ----- Counts in the copy follow the data ----- */
    const lede = $("[data-team-lede]");
    if (lede) {
      let tail = ".";
      if (open === 1) tail = "; one of them is open.";
      else if (open > 1 && open === total) tail = "; all of them are open.";
      else if (open > 1) tail = "; " + word(open) + " of them are open.";
      lede.textContent = "UNPC is student-run, with more than 100 volunteer organizers. " + cap(word(total)) + (total === 1 ? " role leads" : " roles lead") + " the work" + tail;
    }

    /* ----- Role list (hero) ----- */
    const roles = $("[data-roles]");
    if (roles) {
      roles.setAttribute("aria-label", total === 1 ? "The role" : "The " + word(total) + " roles");
      roles.innerHTML = people
        .map((p) => {
          const txt = (who) => '<span class="role-txt"><span class="role-name">' + esc(p.role) + '</span><span class="role-who">' + who + "</span></span>";
          // An open role shows only its name (its open mark says the rest); the signature lines below list the open roles
          // again, so "Open role" is said once there, and here only to screen readers.
          if (p.placeholder)
            return '<li class="role is-open"><span class="role-mark" aria-hidden="true"></span><span class="role-txt"><span class="role-name">' + esc(p.role) + '<span class="sr-only">, open role</span></span></span></li>';
          // The person's id, not the index: closing a deep-linked dialog then returns focus to the founder section below.
          return (
            '<li class="role is-signed" data-seat-row="' + esc(p.id) + '"><button type="button" class="role-btn" data-person="' + esc(p.id) + '" aria-haspopup="dialog" data-seat-for="' + esc(p.id) + '">' +
            '<span class="role-mark" aria-hidden="true"></span>' + txt(esc(p.name)) + "</button></li>"
          );
        })
        .join("");
    }

    /* ----- Team chamber (9.1): 100 back seats for the volunteers, six front seats for the roles ----- */
    const svg = $("[data-team-arc]");
    const rings = {};
    const leads = {};
    if (svg) {
      const cx = 320;
      const cy = 349;
      const R = 300;
      // The six front seats: r 15, so they stay about 21px across in the 448px figure of the wide hero.
      const r = 15;
      svg.textContent = "";
      C.chamberSVG(svg, { n: 100, q: 0.6, cx, cy, R, rK: 0.26, cls: () => "back", attrs: (i) => ({ style: "--i:" + i }) });
      // Intro order for the front row: open seats left to right, then the signed ones, the founder last.
      const order = people.map((p, i) => i).sort((a, b) => (people[a].placeholder === people[b].placeholder ? a - b : people[a].placeholder ? -1 : 1));
      const signedOrder = order.filter((i) => !people[i].placeholder);
      // Founder last of all.
      const fi = founder ? people.indexOf(founder) : -1;
      const seq = order.filter((i) => people[i].placeholder).concat(signedOrder.filter((i) => i !== fi), fi > -1 ? [fi] : []);
      const g = svgEl("g", { class: "front-row" }, svg);
      people.forEach((p, i) => {
        const th = Math.PI * (1 - (i + 0.5) / people.length);
        const x = fmt(cx + Math.cos(th) * R * 0.4);
        const y = fmt(cy - Math.sin(th) * R * 0.4);
        const j = seq.indexOf(i);
        if (p.placeholder) {
          svgEl("circle", { class: "front open", cx: x, cy: y, r, pathLength: 72, style: "--j:" + j }, g);
          return;
        }
        rings[p.id] = svgEl("circle", { class: "pulse", cx: x, cy: y, r }, g);
        // A pointer click on the seat opens the dialog through site.js (the figure itself is aria-hidden).
        // It carries the id, not the index, so focus after a deep-linked dialog goes to the founder portrait.
        leads[p.id] = svgEl("circle", { class: "front lead", cx: x, cy: y, r, style: "--j:" + j, "data-person": p.id, "data-seat-for": p.id }, g);
      });
      introWhenSeen(svg.closest(".team-fig") || svg, 640 + seq.length * 70 + 360);
    }

    /* ----- The founder (9.2), filled from data ----- */
    const sec = $("[data-founder]");
    if (sec) {
      if (!founder) sec.hidden = true;
      else {
        sec.id = founder.id;
        const set = (sel, text) => {
          const el = $(sel, sec);
          if (el && el.textContent !== text) el.textContent = text;
          return el;
        };
        set("[data-fd-name]", founder.name);
        set("[data-fd-initials]", S.initials(founder.name));
        const role = set("[data-fd-role]", founder.role || "");
        if (role) role.hidden = !founder.role;
        const school = set("[data-fd-school]", founder.school || "");
        if (school) school.hidden = !founder.school;
        const bio = set("[data-fd-bio]", typo(founder.bio || ""));
        if (bio) bio.hidden = !founder.bio;
        const img = $("[data-fd-img]", sec);
        if (img) {
          if (founder.photo && img.getAttribute("src") !== founder.photo) img.setAttribute("src", founder.photo);
          img.alt = "Portrait of " + founder.name;
        }
        const portrait = $("[data-fd-portrait]", sec);
        if (portrait) {
          portrait.setAttribute("aria-label", founder.name + (founder.role ? ", " + founder.role : ""));
          portrait.setAttribute("data-seat-for", founder.id);
        }
        const more = $("[data-fd-more]", sec);
        if (more) more.setAttribute("aria-label", "Read more about " + founder.name);
      }
    }

    /* ----- Signature lines (9.3): every role but the founder's; a filled role signs its line ----- */
    const others = people.filter((p) => p !== founder);
    const openOthers = others.filter((p) => p.placeholder).length;
    const title = $("[data-signs-title]");
    const sub = $("[data-signs-sub]");
    if (title) title.textContent = openOthers ? "Open roles" : "Roles";
    if (sub) {
      if (openOthers > 1) sub.textContent = cap(word(openOthers)) + " roles are open. Each will be signed here when an organizer takes it.";
      else if (openOthers === 1) sub.textContent = "One role is open. It will be signed here when an organizer takes it.";
      else sub.textContent = "Every role is signed.";
    }
    const signs = $("[data-signs]");
    if (signs) {
      signs.closest("section").hidden = !others.length;
      signs.innerHTML = others
        .map((p) => {
          if (p.placeholder) {
            return (
              '<li class="sign is-open"><span class="sign-role">' + esc(p.role) + "</span>" +
              '<span class="sign-line"><span class="sign-mark" aria-hidden="true"></span><span class="sign-state">Open<span class="sr-only"> role</span></span></span></li>'
            );
          }
          return (
            '<li class="sign is-signed" data-seat-row="' + esc(p.id) + '"><button type="button" class="sign-btn" data-person="' + indexOf(p) + '" aria-haspopup="dialog" aria-label="' +
            esc(p.name + (p.role ? ", " + p.role : "")) + '" data-seat-for="' + esc(p.id) + '">' +
            S.portraitMarkup(p, { alt: "", className: "sign-portrait" }) +
            '<span class="sign-line"><span class="sign-name">' + esc(p.name) + "</span></span>" +
            '<span class="sign-role">' + esc(p.role || "") + "</span></button></li>"
          );
        })
        .join("");
    }

    /* ----- The founder seat answers its triggers: a ring expands to 16/11 of the seat's r and fades (600ms) ----- */
    const rowsFor = (id) => $$('[data-seat-row="' + id + '"]');
    function seatOn(id, on, play) {
      const ring = rings[id];
      const lead = leads[id];
      if (!ring || !lead) return;
      lead.classList.toggle("is-hot", on);
      rowsFor(id).forEach((r) => r.classList.toggle("is-hot", on));
      const animated = S.motion() && ring.animate;
      ring.classList.toggle("is-held", on && !animated);
      if (on && play && animated) {
        ring.getAnimations().forEach((a) => a.cancel());
        ring.animate(
          [
            { opacity: 1, transform: "scale(1)" },
            { opacity: 0, transform: "scale(" + 16 / 11 + ")" }
          ],
          { duration: 600, easing: "cubic-bezier(.2,.7,.1,1)" }
        );
      }
    }
    $$("[data-seat-for]").forEach((el) => {
      const id = el.getAttribute("data-seat-for");
      if (!rings[id]) return;
      el.addEventListener("pointerenter", (e) => {
        if (e.pointerType !== "touch") seatOn(id, true, true);
      });
      el.addEventListener("pointerleave", () => seatOn(id, false));
      // The seat itself sits in an aria-hidden figure and is never focused, so only the buttons listen for focus.
      if (!(el instanceof SVGElement)) { el.addEventListener("focus", () => seatOn(id, true, true)); el.addEventListener("blur", () => seatOn(id, false)); }
    });
  }

  /* =====================================================================
     Partners page
     ===================================================================== */

  const partnerRow = (p, k) => {
    const word = p.short || p.name;
    const detail = p.detail || (p.short ? p.name : "");
    const nameHidden = p.short ? ' aria-hidden="true"' : "";
    const domain = p.url ? p.url.replace(/^https?:\/\//, "").replace(/\/$/, "") : "";
    return (
      '<li class="partner" data-partner-id="' + esc(p.id) + '" data-k="' + k + '">' +
      '<div class="partner-logo logo-slot" data-slot><span class="logo-word"><span class="pw-name"' + nameHidden + ">" + esc(word) + "</span>" +
      (detail ? '<span class="pw-detail">' + esc(detail) + "</span>" : "") +
      "</span>" +
      (p.logo ? '<img src="' + esc(p.logo) + '" alt="' + esc(p.name) + '" loading="lazy" decoding="async">' : "") +
      "</div>" +
      '<p class="partner-role"><span class="partner-key" aria-hidden="true"></span>' + esc(p.role || "") + "</p>" +
      '<p class="partner-text">' + esc(typo(p.text || "")) + "</p>" +
      (domain ? '<p class="partner-link"><a href="' + esc(p.url) + '" target="_blank" rel="noopener">' + esc(domain) + "</a></p>" : "") +
      "</li>"
    );
  };

  function partnersPage() {
    const list = S.partners;
    const host = $("[data-partner-list]");

    /* ----- Partner rows (10.2): the static rows are kept when they match data.js, so logos load once ----- */
    if (host) {
      const ids = $$("[data-partner-id]", host).map((li) => li.getAttribute("data-partner-id"));
      const same = ids.length === list.length && list.every((p, i) => p.id === ids[i]);
      if (!same) host.innerHTML = list.map(partnerRow).join("");
      else {
        // Same partners: refresh their copy from data.js without touching the images.
        list.forEach((p, k) => {
          const li = host.children[k];
          const fresh = document.createElement("template");
          fresh.innerHTML = partnerRow(p, k);
          const f = fresh.content.firstElementChild;
          [".logo-word", ".partner-role", ".partner-text"].forEach((sel) => {
            const a = $(sel, li);
            const b = $(sel, f);
            if (a && b && a.innerHTML !== b.innerHTML) a.innerHTML = b.innerHTML;
          });
          const link = $(".partner-link", li);
          const fLink = $(".partner-link", f);
          if (link && !fLink) link.remove();
          else if (fLink && !link) li.append(fLink);
          else if (link && fLink && link.innerHTML !== fLink.innerHTML) link.innerHTML = fLink.innerHTML;
        });
      }
      // Once a logo loads, its typeset name is visually hidden by style.css; hide it from screen readers too,
      // since the image's alt now names the partner.
      $$(".partner-logo img", host).forEach((img) => {
        const done = () => {
          if (img.naturalWidth > 0) {
            const w = $(".logo-word", img.parentNode);
            if (w) w.setAttribute("aria-hidden", "true");
          }
        };
        if (img.complete) done();
        img.addEventListener("load", done);
      });
    }

    /* ----- Partner chamber (10.1) ----- */
    const fig = $("[data-pchamber]");
    if (!fig || !list.length) return;
    const svg = $("svg", fig);
    const N = 160;
    const Q = 0.45;
    const GAP = 0.09;
    const RK = 0.27;
    const weights = list.map(() => 1);
    const unit = C.seats(N, Q);
    const counts = C.scaleCounts(weights, N);
    const kk = (Math.PI - GAP * (weights.length - 1)) / Math.PI;
    // Each sector's angles, independent of the radius.
    const secs = weights.map(() => ({ a0: Infinity, a1: -Infinity, mid: 0 }));
    unit.list.forEach((st, r) => {
      const s = C.sectorOf(r, counts);
      const th = Math.PI - ((Math.PI - st.th) * kk + s * GAP);
      secs[s].a0 = Math.min(secs[s].a0, th);
      secs[s].a1 = Math.max(secs[s].a1, th);
    });
    secs.forEach((s) => (s.mid = (s.a0 + s.a1) / 2));

    // Labels: HTML spans around the arc, aria-hidden with the figure (the rows below say the same).
    $$(".pt-label", fig).forEach((n) => n.remove());
    const labels = list.map((p, k) => {
      const span = document.createElement("span");
      span.className = "pt-label";
      span.setAttribute("data-k", k);
      span.textContent = p.role || p.short || p.name;
      fig.appendChild(span);
      return span;
    });
    const outer = (k) => Math.abs(Math.cos(secs[k].mid)) > 0.6;
    let geo = null;
    let builtKey = "";
    let builtSectors = [];

    function layout() {
      const W = fig.clientWidth;
      if (!W) return;
      const lw = labels.map((l) => l.offsetWidth);
      const lh = labels[0].offsetHeight || 18;
      // The two outer labels sit under the ends of the arc, so the chamber can use the full width.
      const feet = true;
      const gap = 12;
      let R = Math.min(W * 0.47, 330);
      for (let pass = 0; pass < 3; pass++) {
        const sr = unit.pitch * R * RK;
        const off = gap + sr;
        let lim = W / 2 - sr - 1;
        labels.forEach((l, k) => {
          if (feet && outer(k)) return;
          const c = Math.cos(secs[k].mid);
          if (c < -0.01) lim = Math.min(lim, (W / 2 + ((c - 1) / 2) * lw[k]) / -c - off);
          else if (c > 0.01) lim = Math.min(lim, (W / 2 - ((c + 1) / 2) * lw[k]) / c - off);
        });
        R = Math.max(40, Math.min(R, lim));
      }
      const sr = unit.pitch * R * RK;
      const off = gap + sr;
      let top = R + sr;
      labels.forEach((l, k) => {
        if (feet && outer(k)) return;
        const s = Math.sin(secs[k].mid);
        top = Math.max(top, (R + off) * s + ((s + 1) / 2) * lh);
      });
      const cx = W / 2;
      const cy = Math.ceil(top + 2);
      const H = Math.ceil(feet ? cy + sr + 10 + lh + 2 : cy + sr + 2);

      // Rebuild the seats only when the geometry changes (a late font load moves only the labels,
      // so a running intro is never restarted).
      const key = [W, H, cx, cy, R].map((v) => Math.round(v * 10)).join(",");
      if (key !== builtKey) {
        builtKey = key;
        svg.setAttribute("viewBox", "0 0 " + W + " " + H);
        svg.setAttribute("width", W);
        svg.setAttribute("height", H);
        svg.textContent = "";
        builtSectors = C.chamberSVG(svg, {
          n: N,
          q: Q,
          cx,
          cy,
          R,
          rK: RK,
          weights,
          gap: GAP,
          cls: (i, st, s) => "ps s" + (s % 4) + " k" + s,
          // The roll call: delay by angle rank, 62% of 900ms, each seat 38% of it.
          attrs: (i) => ({ style: "--d:" + Math.round((i / (N - 1)) * 0.62 * 900) + "ms" })
        }).sectors;
      }
      labels.forEach((l, k) => {
        const m = secs[k].mid;
        const c = Math.cos(m);
        const s = Math.sin(m);
        if (feet && outer(k)) {
          const left = c < 0;
          l.style.left = (left ? cx - R - sr : cx + R + sr) + "px";
          l.style.top = cy + sr + 10 + "px";
          l.style.transform = left ? "none" : "translateX(-100%)";
        } else {
          l.style.left = cx + (R + off) * c + "px";
          l.style.top = cy - (R + off) * s + "px";
          l.style.transform = "translate(" + fmt((c - 1) * 50) + "%," + fmt(-(s + 1) * 50) + "%)";
        }
      });
      geo = { cx, cy, R, sr, sectors: builtSectors };
    }

    let lastW = -1;
    const relayout = () => {
      const w = fig.clientWidth;
      if (w === lastW) return;
      lastW = w;
      layout();
    };
    layout();
    lastW = fig.clientWidth;
    if (window.ResizeObserver) new ResizeObserver(relayout).observe(fig);
    // Fonts change the label widths: lay out again once they are in.
    S.onLayout(() => {
      lastW = -1;
      relayout();
    });
    introWhenSeen(fig, 900 + 560);

    /* ----- Lighting: a row hovered or focused lights its sector; a sector hovered lights its row ----- */
    const rows = host ? $$(".partner", host) : [];
    let lit = -1;
    function light(k) {
      if (k === lit) return;
      lit = k;
      if (k < 0) fig.removeAttribute("data-lit");
      else fig.setAttribute("data-lit", k);
      rows.forEach((r, i) => r.classList.toggle("is-lit", i === k));
    }
    rows.forEach((row, k) => {
      row.addEventListener("pointerenter", () => light(k));
      row.addEventListener("pointerleave", () => light(-1));
      row.addEventListener("focusin", () => light(k));
      row.addEventListener("focusout", (e) => {
        if (!row.contains(e.relatedTarget)) light(-1);
      });
    });

    // On the chamber itself: the sector under the pointer, found by angle so the gaps between seats never flicker.
    let box = null;
    fig.addEventListener("pointerenter", () => {
      box = svg.getBoundingClientRect();
    });
    fig.addEventListener("pointermove", (e) => {
      if (!geo || e.pointerType === "touch") return;
      if (!box) box = svg.getBoundingClientRect();
      const x = e.clientX - box.left - geo.cx;
      const y = geo.cy - (e.clientY - box.top);
      const d = Math.hypot(x, y);
      const pad = geo.sr * 2.4;
      if (y < -pad || d < geo.R * Q - pad || d > geo.R + pad) return light(-1);
      const th = Math.atan2(Math.max(y, 0), x);
      let k = -1;
      geo.sectors.forEach((s, i) => {
        if (th >= s.a0 - GAP / 2 && th <= s.a1 + GAP / 2) k = i;
      });
      light(k);
    });
    fig.addEventListener("pointerleave", () => {
      box = null;
      light(-1);
    });
    window.addEventListener("scroll", () => (box = null), { passive: true });
  }

  if (page === "team") team();
  else if (page === "partners") partnersPage();
})();
