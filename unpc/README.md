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
| `assets/site.js` | Theme, menu, next Sunday, Copy, photo slots, the organizer dialog |
| `assets/chamber.js` | The seat chart drawing shared by every page |
| `assets/story.js`, `assets/paper.js` | The home page story and its paper sheet (home only) |
| `assets/home.js` | The case deck and clock, the day bar, the score sheet, and the team and partner previews (home only) |
| `assets/pages.js` | The team and partner chambers (Team and Partners only) |

## See it on your computer

Run a small server in this folder, then go to http://localhost:8000:

```
python -m http.server 8000
```

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

## Check these facts before you publish

The text comes from UNPC emails and documents. Some of them do not agree. Make sure that each item below is correct before you publish. If an item is wrong, change the text in each place that the item names.

- Organizers: the site says "100+" (more than 100 volunteer organizers). One document says "50+". Find the correct number. The number is on the Home page, in the preamble and the team preview, and on the Team page. `assets/home.js` and `assets/pages.js` also write this sentence, so change the number there too. The drawing on the Team page has 100 back-row seats for the organizers (`n: 100` in `assets/pages.js`). If the number changes, change this value too.
- Students: the site says "500+ engaged". Make sure that this number is correct. The number is on the Home page, in the first step of the story and in the preamble.
- The Diplomat prize: the judges' guide says a two-year subscription. The email after 4 October says one year. The site says one year. Find the correct length. The prize is on the Home page, in the first tournament and the winners caption. It is also in the partner text, in `assets/data.js` and in `partners.html`.
- Kazakhstan: the site says that a local organizer runs the UNPC format in Kazakhstan. The partner text, in `assets/data.js` and in `partners.html`, also says that this competition is for high school students. Make sure that both statements are correct.
- Contact: every page shows tashpulatovo211@gmail.com. This is also the founder's own address (see `organizers` in `assets/data.js`). Decide if it can stay the public contact. If UNPC gets its own address, change `config.email` in `assets/data.js`. The three HTML files also show the address as text for visitors without JavaScript. Change it there too.
