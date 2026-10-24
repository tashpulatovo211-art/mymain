# UNPC website

The website of the Uzbekistan National Policy Competition. It has three pages:

- `index.html`: the home page. It opens on the chamber story, then the preamble, the Sunday in order, the score sheet, the first tournament, the team and the partners.
- `team.html`: the organizers. Click the founder's portrait or name to open his details.
- `partners.html`: the partners, and how to become one.

The site is static. It needs no build step, no server code and no outside scripts. Fonts come from Google Fonts.

## Files

| File | What it holds |
|---|---|
| `assets/style.css` | The one stylesheet for all three pages |
| `assets/data.js` | Settings, organizers and partners (edit this one) |
| `assets/site.js` | Theme, menu, next Sunday, Copy, photo slots, the organizer dialog, keeping the reader's place when the window changes size |
| `assets/chamber.js` | The seat chart drawing shared by every page |
| `assets/story.js`, `assets/paper.js` | The home page story and its paper sheet (home only) |
| `assets/home.js` | The case deck and clock, the day bar, the score sheet, and the team and partner previews (home only) |
| `assets/pages.js` | The team and partner chambers (Team and Partners only) |
| `assets/plates.js` | Photo plates: the fade-in once a photo loads, the alt text for each crop, and the slow drift as a plate passes (home only for now) |
| `tools/plates.py`, `tools/plates.json` | The one way to make the files for a photo plate: grade, crops, sizes and the markup. The site does not load them |

## See it on your computer

Run a small server in this folder, then go to http://localhost:8000:

```
python -m http.server 8000
```

The photos are AVIF files first. Any server you use, and the host you publish to, must send `.avif` files as `image/avif`. Recent Python does. For the Node `http-server`, start it with `--mimetypes` and a file that holds the line `image/avif avif`.

## Change the team, the partners and the settings

All the data that changes is in `assets/data.js`. Edit the file, save it, and reload the page.

- `config.registerUrl`: paste the public link of the registration Google Form (the link that ends in `/viewform`). If it is empty, the site shows the email address.
- `config.telegramUrl`: paste the Telegram channel link. If it is empty, the Telegram link stays hidden.
- `config.nextTournament`: leave it empty to show the coming Sunday. Write a date such as `"2026-11-01"` to set the date by hand.
- `organizers`: the first person shows large on the Team page. Five entries are placeholders: the site shows only their role as an open signature line. Fill in a person's details and remove `placeholder: true`, and the line is signed with their name (and, on the Team page, their portrait).
- `partners`: one entry for each partner.

## Add photos

Put each photo at the path below. Until a file exists, the site shows a drawn stand-in: a room plan for most tournament photos, the team name for the winners, initials for portraits and the typeset name for logos. When the file is there, it fades in over the stand-in.

| Where on the site | File | Shape |
|---|---|---|
| First tournament, the large frame | `photos/hero.jpg` | Wide, 21:9 |
| First tournament | `photos/first-tournament/preparation.jpg` | 3:2 |
| First tournament | `photos/first-tournament/presenting.jpg` | Square |
| First tournament | `photos/first-tournament/questions.jpg` | Square |
| First tournament | `photos/first-tournament/guest.jpg` | Wide, 2:1 |
| First tournament | `photos/first-tournament/ceremony.jpg` | 4:3 |
| First tournament | `photos/first-tournament/winners.jpg` | 4:3 |
| Team | `photos/team/<id>.jpg`, for example `photos/team/ozodbek-toshpulatov.jpg` | Portrait, 4:5 |
| Partners | `photos/partners/<id>.png`, for example `photos/partners/the-diplomat.png` | Logo, transparent background |

Use JPG photos that are 2000 px wide or less, so the pages load fast. The recap video from 4 October has good frames for these photos.

## Photo plates

A photo plate is a real photo set into the page as part of the document, with a caption under it. The first one is in Article 6 of the home page ("Awards certificates and prizes..."): the photo of the winning team and best speaker certificates. It sits there because it shows what that article describes, and the day bar above it reads "Award ceremony" while it passes. The first tournament's own photo slots (in "Add photos", above) are only for photos from 4 October; a photo whose date is not confirmed goes in a plate.

How a plate behaves:

- It spans the full width of the content on computers and runs edge to edge on phones. The caption lines up with the article's text.
- Each plate has two crops: a wide one, and a closer one for screens 560 px wide and less, so faces never get too small on a phone. Each crop has its own alt text, and the plate has one more that is true of both, for browsers without JavaScript. If the closer crop cuts off something the caption mentions, the phone gets its own caption line.
- Until the photo arrives, the frame shows a tiny blurred copy of the photo's own colours. The photo then fades in. If the file is missing, the whole plate is left out, caption included, so the page never shows an empty frame. If the plate is on the screen when that happens, it keeps the blurred copy until it is off the screen, so the page never jumps under the reader.
- As the plate comes up the screen, the photo settles from slightly larger to its own framing by the time the plate sits whole in the space under the menu bar and the day bar, then drifts down a little inside its frame. Nothing around it moves. With reduced motion turned on, the photo simply sits still.
- The files already carry the site's photo treatment, so the plate needs no filter. In the dark theme a thin veil dims it, as the other photos are dimmed.

### Where later photos go

Use one plate for each article at most, so the document keeps its calm. Put a plate after the article's text, and only where the photo shows that step of the day:

- A guest speaker: Article 1. Article 1's note names Bobur Bekmurodov as the guest on 4 October, so a plate there must show him on that day. A photo of any other speaker, or one where the speaker is not confirmed, needs that note changed first, or it would read as him.
- Teams preparing: Article 3. The case deck right above it shows the four cases of 4 October, so use a photo from that day, or say in the caption which Sunday it is from.
- A team presenting or answering questions: Article 4.

The rule behind this: read the text right above and right below a plate, at every screen width. If that text names a person or a day, no one in the crop may seem to be that person and the photo may not seem to be from that day, unless UNPC has confirmed it.

### Make the files

All the files for a plate come from `tools/plates.py`, with one entry for each photo in `tools/plates.json`. Do not export or resize plate photos by hand, and do not type the sizes into the page: the script writes the files and prints the markup to paste.

1. Put the full-size photo in a folder `tools/masters/` (make it if it is not there), for example `tools/masters/guest.jpg`. The masters are large and the site does not use them, so leave this folder out when you upload the site. Telegram sends photos at 1280 px wide; that is enough. If you make a photo larger before you grade it, use a plain resize (Lanczos). Do not use an AI upscaler: it can change letters and faces. One turned the B of "Best speaker" on the certificate into a D. The script never makes a file wider than the crop really is: a size above that becomes one file at the crop's own width, and the printed markup lists it.
2. Copy the `winners` entry in `plates.json` and change it:
   - `name`: what the photo shows, in lower case, such as `guest`. File names start with it.
   - `src`: the master, such as `masters/guest.jpg`.
   - `grade`: start from the winners values. `wall` tones down one strong colour, `light` lifts the faces a little and darkens the edges and the top, and `finish` is the site's photo treatment; keep `finish` as it is. Never remove or retouch anything in a photo.
   - `crops`, `wide`: `box` is the part of the photo to show, as fractions of its width and height (left, top, right, bottom). Keep everyone's head and hands inside it, and leave room above and below for `over` (0.04 is a good value). `focus` is the middle of the faces, as fractions of the box (across, down); the plate settles toward it.
   - `crops`, the phone crop (the one with `media`): a closer, squarer box with the main faces, so they stay large on a phone. Keep `media` as `(max-width: 560px)`.
   - `alt` at the top of the entry: one line that is true of every crop, such as "Certificates that read Winning team and Best speaker, held up in front of a whiteboard and a screen." Browsers without JavaScript show it with either crop.
   - `alt` for each crop: what that crop shows, plainly. Count the people in it and say what they hold and what is behind them, for example "Three people stand in front of a whiteboard and a screen. Two hold certificates that read Winning team, and one holds a certificate that reads Best speaker." If someone in the crop holds nothing, do not write "people holding certificates".
   - `caption`: a short title, then a sentence or two about what can be seen in the photo.
   - `caption` in the phone crop (optional): the caption's sentences for phones, when the closer crop cuts off something the main caption names. The winners plate uses it because the phone crop cuts off the "Wheel of Names" tab.
3. Run `python3 plates.py plates.json guest` in the `tools` folder. It needs Python 3 with numpy and a recent Pillow (`python3 -m pip install -U numpy pillow`); it stops with a message if Pillow cannot write AVIF. It writes AVIF, WebP and JPEG files to `photos/sundays/` (such as `guest-wide-1440.avif`) and prints the shape and the weight of each one, then the `<figure class="photo-plate">` markup.
4. Paste the markup into `index.html`, after the article's text, inside its `<li>`.
5. Look at the plate in a browser at a phone width and a computer width, in the light and the dark theme.

Captions and alt text: use only what can be seen in the photo and what the site already says. Do not name people, guess the date, or say which tournament it is from unless UNPC has confirmed it. Plain words, sentence case, no dashes.

The sizes: the wide crop is made 960, 1440 and 1920 px wide, and the phone crop 480, 720 and 1080 px wide. AVIF is the main format (about 50 KB for the 1440 px wide crop), WebP is for browsers without AVIF, and JPEG at the two smaller sizes is for very old browsers. A browser loads only one file for each plate, and only when the plate comes near the screen.

## Check these facts before you publish

The text comes from UNPC emails and documents. Some of them do not agree. Make sure that each item below is correct before you publish. If an item is wrong, change the text in each place that the item names.

- Organizers: the site says "100+" (more than 100 volunteer organizers). One document says "50+". Find the correct number. The number is on the Home page, in the preamble and the team preview, and on the Team page. `assets/home.js` and `assets/pages.js` also write this sentence, so change the number there too. The drawing on the Team page has 100 back-row seats for the organizers (`n: 100` in `assets/pages.js`). If the number changes, change this value too.
- Students: the site says "500+ engaged". Make sure that this number is correct. The number is on the Home page, in the first step of the story and in the preamble.
- The Diplomat prize: the judges' guide says a two-year subscription. The email after 4 October says one year. The site says one year. Find the correct length. The prize is on the Home page, in the first tournament and the winners caption. It is also in the partner text, in `assets/data.js` and in `partners.html`.
- Kazakhstan: the site says that a local organizer runs the UNPC format in Kazakhstan. The partner text, in `assets/data.js` and in `partners.html`, also says that this competition is for high school students. Make sure that both statements are correct.
- Contact: every page shows tashpulatovo211@gmail.com. This is also the founder's own address (see `organizers` in `assets/data.js`). Decide if it can stay the public contact. If UNPC gets its own address, change `config.email` in `assets/data.js`. The three HTML files also show the address as text for visitors without JavaScript. Change it there too.
- The winners photo in Article 6: the site does not say which Sunday it is from or who is in it, and it says nothing about the man on the left, who holds no certificate. Confirm which Sunday it is from, and whether a dated caption or the names of the people in it can be added. Write them into the `caption` (and the `alt`, if names are added) in `tools/plates.json`, and in the markup in `index.html`. Do not move it to the first tournament's winners slot: that slot's caption names Young Policy Leaders, and the photo also shows a best speaker and a man with no certificate.
- Consent: make sure that everyone in the winners photo, and in any photo added later, agreed to appear on the site. If someone did not, take the photo out (delete its `<figure class="photo-plate">` from `index.html`) until a photo without them is ready.
