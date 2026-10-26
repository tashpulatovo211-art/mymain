# Notes for Claude Code: the UNPC website

This is the static website of the Uzbekistan National Policy Competition (UNPC). The design is called "The Chamber". It has no build step and no libraries. Read `README.md` first.

## The design skills apply here

Three skills in `.claude/skills` at the root of the repository apply to every change on this site:

- `redesign-existing-projects`: the audit, and the order of fixes.
- `landing-page-design`: page structure, copy, and the visual rules.
- `design-to-motion`: what may move, and how.

Each skill says that the client's own words win over a rule. The client asked for this, in order: remove anything that looks like AI slop, with taste, in an Apple or Muse style; then "more clean, easy on the eye"; then "make it best design"; then use these skills. The client's anti-slop research names some skill defaults as tells. So UNPC keeps the overrides below. Apply every other rule as the skill says, apart from the few listed under "Held until the client answers".

## How to work

- Never edit `assets/data.js`. It is the client's text. Its own hyphens ("co-writing", "one-year") stay until the client rewords them; the no-hyphen rule covers UNPC's own copy only.
- Use only facts that are already on the site or in the brief. Never invent a number, name, date, quote or policy. Open questions for the client are in the README, under "Check these facts before you publish".
- Copy: plain words, sentence case, no em or en dashes, no hyphenated words, no "not X but Y", no hype words. No last line of one word: use `text-wrap: balance` on short blocks, or bind the last two words with `&nbsp;`.
- Use the site's own tokens in `assets/style.css`: the `--t-*` type, the `--s1` to `--s10` spacing, the `--r-*` radii, `--ease-out` and `--ease-io`. Type and grid tokens are in rem.
- Keep at most one solid button in each view. The nav's Register steps back (`.is-hero-quiet`, `.is-quiet`) while the hero's "Register for Sunday" or the Next block's own button is on screen below the bar, and on Partners while the partner ask (`data-nav-quiet`) is in the top 65% of the view: the ask's own button is quiet, and a student's Register should not compete with it. Without JavaScript it stays quiet, so the page's own solid buttons are never paired with it.
- Keep light and dark, reduced motion, no WebGL and no JavaScript working. Check at 320, 390, 768, 1024, 1440 and 1920 wide, with no sideways scroll.
- One Tab stop for each action. When two controls open the same thing, the one that only repeats it (a portrait beside its "Read about" button, Team's hero role above the founder section) takes `tabindex="-1"`, so a pointer can still use it.
- Without JavaScript, a control that only the script can run is hidden (`html:not(.js)` in `assets/style.css`), and a link that the script improves still goes somewhere on its own (the four case links point at their cards).
- Test in Playwright and look at the screenshots. Keep scripts and screenshots out of this folder.

## UNPC's overrides

Each entry gives the skill rule, what UNPC does instead, and why.

1. Rule: fonts only Geist, Manrope, Geist Mono or Poppins. UNPC: Source Serif 4 for display, reading and figures, and Public Sans for the interface. Why: the research flags Geist and that set of free fonts as a tell the client asked to remove.
2. Rule: one typeface per site. UNPC: the serif and sans pair. Paper and document are serif; screen chrome is sans. Why: the resolution's grammar needs the pair, and the research asks for two faces chosen for the brief.
3. Rule: no italics anywhere. UNPC: italic only on the resolution's clause verbs (Noting, Resolves, Opens), on "Open" on signature lines, and on the printed form title on the WebGL sheet, never in a heading. Why: real resolutions are set this way, so it comes from the subject.
4. Rule: snap every font size to the Tailwind scale. UNPC: the `--t-*` scale for the main roles: hero 40 to 80px, h2 32 to 56px, date 56 to 168px, the reading sizes 21, 19 and 17px (clause, paper, body), small 14.5px, micro 13px, interface 15px, step 30px and step off 20px, figures 56px, clock 48px and the well's date 26px. Below 480px wide seven of them step down: the reading sizes to 18.5, 17.5 and 16px, step to 24px, figures to 44px, the clock to 40px and the well to 20px. The pinned hero runs 36 to 80px, and 32 to 40px on phones; the static story on a short screen sets it at 28px so Register stays in the first view. Components keep literal sizes set for their job: 13, 14, 14.5, 15, 16, 18, 19, 20, 21, 22, 24, 28, 30, 34 and 44px; clamps for the Next email (19 to 26px), the step titles (24 to 30px pinned, 30 to 40px static), the dialog name (30 to 42px), the founder's name (34 to 48px) and the Team, Partners and 404 h1 (34 to 68px); and container units for the portrait initials and the winners' name. A new size reuses one of these. Why: snapping down would shrink the serif reading sizes that make the page easy on the eye, and break the two-line fit of the hero.
5. Rule: main buttons 16px semibold, header buttons 14px semibold. UNPC: `.btn` is sans 500 at 15px (`--t-ui`); the nav's Register is 14px at 500. Weight 600 shows only on the UNPC brand, the sheet's printed header and the bold lead of a photo caption (`.pp-cap-text b`, "Winning team and best speaker."). `strong` and `b` default to 600, and every other use sets its own weight (the legend's points 400, the room bar labels 500). Why: heavy weights looked shouty in review, and the client asked for clean.
6. Rule: dark backgrounds only from the skill's six greys. UNPC: a cool dark ground #0d1519, surface #132026, paper #172730. Why: one cool grey family with every ink, line and seat.
7. Rule: the hero heading in a left to right text gradient. UNPC: a solid h1 in `--ink`. Why: gradient headline text is a top AI tell the client asked to remove.
8. Rule: accent saturation under 80%. UNPC: the flag azure #0099b5 for graphics, #00718a for text and buttons. Why: it is the national flag colour the brief names, and its chroma is already moderate.
9. Rule: noise or grain on flat surfaces. UNPC: flat surfaces; texture only on the WebGL paper sheet. Why: the client asked for clean, and grain over the story would cost every frame.
10. Rule: faint background photos in quiet sections. UNPC: quiet sections sit on `--ground`, with drawn stand-ins only where photos will go. Why: the brief bans outside images and invented content.
11. Rule: no gradients in backgrounds. UNPC: one 20px fade under the sticky day bar, nowhere else. Why: it lets the articles slide under the band. One gradient with a job is not slop.
12. Rule: break symmetry in the hero. UNPC: a centred hemicycle with the next date in the speaker's well, over an asymmetric document grid. Why: a chamber is symmetric, and centring alone is not the tell.
13. Rule: hero heading and subheading capped at 680px. UNPC: the h1 on two lines, one sentence each, up to about 888px; the lede capped at 52ch. Why: 680px splits "The best goes to parliament." in the middle of the thought.
14. Rule: spacing only from the skill's 0 to 96px table; buttons padded 8 by 12px. UNPC: `--s1` to `--s10` (4 to 128px), `--section-y` 80 to 128px, `--gutter` 16 to 56px; buttons 11 by 18px and 44px tall. Why: the generous rhythm is the calm the client asked for, and 8 by 12px gives targets under 44px.
15. Rule: layer elements with negative margins. UNPC: content sits on the page; depth only on real objects (the deck, the sheet, the plates). Why: layered text works against "easy on the eye".
16. Rule: 700ms transitions as the baseline, and never under 200ms. UNPC: interface transitions of 180 to 350ms on `--ease-out` or `--ease-io`. Longer ones: the dialog, the photos, the story, the score sheet's ink ring (drawn over 0.7s) and the founder seat's ring on Team (0.6s), and four small moves of a few pixels: the theme toggle's half disc turning (0.5s), the brand mark's centre seat rising 1.5px on hover (0.5s), a portrait's 2px hover lift (0.5s, `.portrait-btn .plate` and `.sign-portrait`) and the Team chamber's founder seat growing to 1.09 (0.4s); also the deck's draw (0.76s, see 30), the Team chamber's intro seats (0.42s) and the Partners chamber's labels (0.4s, after a 0.34s seat grow). The pinned stepper's caption swap is the one shorter timing: two halves, 120ms out then 120ms in beside the wide chamber, and 160ms out then 200ms in on the narrow panel. Why: 700ms hovers feel slow; a move that covers 2px or less looks abrupt at 200ms and calm at 0.5s; and a swap in two short halves keeps two captions from showing at once without making the reader wait.
17. Rule: a fade up with blur on every element as it scrolls in. UNPC: sections are simply there; motion only in the story, the deck's draw, the ink ring, the page chamber intros and photos as their files arrive (a photo slot fades in from a 14px blur to sharp over 0.6 to 0.8s; a photo plate fades in over its blurred swatch, then settles and drifts a little as it passes). Why: the same fade up on every section is an AI tell; a photo that resolves when it loads answers a real event.
18. Rule: a floating glass island nav. UNPC: a full width fixed 64px bar, the ground at 86% with a 10px blur, lined up with the content column. Why: glass by reflex is a tell; the blur stays only where layers are real.
19. Rule: a full screen blurred mobile menu with staggered links. UNPC: a panel under the bar with three 22px serif links and a 60% scrim. Why: three links need no overlay, and the panel keeps the menu behaviours the judges asked for.
20. Rule: smooth anchor scrolling. UNPC: Home's anchors jump, and the story's buttons use `scrollFor`. Team and Partners glide only for the click, never for the whole page. Why: a glide across the story replays every formation in under a second, and `keepPlace()` must restore the reader's place instantly.
21. Rule: randomize repeated dates. UNPC: "4 October 2026" on all four case cards. Why: it is the true date.
22. Rule: icons from Phosphor, Solar or Iconamoon. UNPC: three custom 1.5px marks (the half disc, two lines that turn into an X, the close X). Why: simple custom marks that match the seats and hairlines.
23. Rule: one proof signal in the first view. UNPC: the hero holds the well date, the h1, the lede and two actions; proof comes at story step 1 (500+) and step 5 (Bobur Bekmurodov). Why: a proof line shrank the chamber and sent short screens to the static story.
24. Rule: three to five benefit bullets. UNPC: each benefit is said where it happens (the Next block, the Articles, Annex A, step 5). Why: a block that only repeats them is a template section.
25. Rule: a tagline reveal with words from 25 to 35% opacity. UNPC: no muted words; the sheet flying into the Oliy Majlis, which fills with azure, is the mid page moment. Why: ink at 25 to 35% fails WCAG AA contrast.
26. Rule: every visual runs a story loop after load. UNPC: a scroll driven story whose loop stops when idle; the hero's only life is the pointer lean and the tap ripple. Why: the client's "clean, easy on the eye" answers the skill's own question about calm screens.
27. Rule: never scale(0) on an object. UNPC: the roll call grows seats from 0 on Home and Partners, and from 0.4 on Team. Why: seats are 4 to 9px marks that draw like ticks, and a blurred pop would put a halo on every dot.
28. Rule: the "up" kind rises 10px with a 4px blur over 1.05s. UNPC: the hero copy rises 12px over 0.6s on `--ease-out`, with no blur. Why: blur smears 80px serif type, and the site keeps its own tokens.
29. Rule: accents on figures (marching dashes, pulse rings, sector cycles). UNPC: Team's open seats are still dashed rings, and the founder's ring shows only on hover or focus; Partners' sectors light only with their row; the Next chamber is still. Why: pulses read as spinners or badges and keep a calm page moving.
30. Rule: a card intro and a story loop on the case deck and score sheet. UNPC: the deck rests flat; it moves only when the reader draws, runs the clock or changes a mark. Why: dealing cards moves text while it is read, moving totals are count up, and a card rise is the fade up tell.
31. Rule: data bars wipe in. UNPC: the day bar follows the reader; the room bar and the Partners mini bars are still. Why: on five help rows a wipe becomes a staggered list reveal.
32. Rule: stand-in visuals act out stories. UNPC: the room plans are complete on first paint. Why: animating a stand-in invents action no photo confirms, and reads as loading.
33. Rule: a logo row as a marquee. UNPC: four typeset partner names, still, now and after logo files arrive. Why: a marquee is a stock effect.
34. Rule: counters count up. UNPC: still figures 500+, 100+ and 2, each with its clause. Why: the brief bans count up stats.
35. Rule: a final CTA identical to the top one (landing-page-design A2, item 12). UNPC: the hero's "Register for Sunday" jumps to the Next block. While `config.registerUrl` is empty, the Next block's button is "Register by email" and opens a mail to the address; once the form link is set, it reads "Register for Sunday" (`data-register`), the same as the hero. Why: the label says what happens on the click, and a button that opens a mail app should say so.

## Held until the client answers

- A questions section (Annex B) and FAQPage JSON-LD wait for answers on cost, time and place, ages and cities, language and what a registration email holds. The drafted answers only repeated Home.
- A risk reversal (landing-page-design A4 and A2, item 11; the redesign skill's Content list) waits for the answer on cost in the README. Until UNPC confirms that taking part is free, the site cannot say it, and it promises nothing else in its place.
- An Event in JSON-LD waits for a confirmed venue and time.
- `canonical`, `og:url` and `og:image` wait for the domain. A comment in each page's head holds them, against the redesign skill's rule on commented code, so the step at publish is to uncomment it; `twitter:card` is live as `summary` until then, and becomes `summary_large_image` with the image.
- Privacy policy and terms links in the footer (landing-page-design B10, the redesign skill's "Strategic omissions") wait for the answers to the Privacy question in the README. Writing a policy without them would invent one.
- The chamber story was exported once as a looping video and two GIFs (design-to-motion, showcase context) for posting outside the site; the scripts are in `tools/showcase/`. The site itself does not loop.
