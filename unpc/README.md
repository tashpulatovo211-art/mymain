# UNPC website

The website of the Uzbekistan National Policy Competition. It has three pages:

- `index.html`: the home page.
- `team.html`: the organizers. Click a photo to open the person's details.
- `partners.html`: the partners, and how to become one.

The site is static. It needs no build step and no server code.

## See it on your computer

Open `index.html` in a browser. Or run a small server in this folder, then go to http://localhost:8000:

```
python -m http.server 8000
```

## Change the team, the partners and the settings

All the data that changes is in `assets/data.js`. Edit the file, save it, and reload the page.

- `config.registerUrl`: paste the public link of the registration Google Form (the link that ends in `/viewform`). If it is empty, the site shows the email address.
- `config.telegramUrl`: paste the Telegram channel link. If it is empty, the Telegram link stays hidden.
- `config.nextTournament`: leave it empty to show the coming Sunday. Write a date such as `"2026-11-01"` to set the date by hand.
- `organizers`: the first person shows large on the Team page. Five entries are placeholders. Replace their name, role, school, photo and bio.
- `partners`: one entry for each partner.

## Add photos

Put each photo at the path below. Until a file exists, the site shows a striped frame with the path in it.

| Where on the site | File | Shape |
|---|---|---|
| Home, under the title | `photos/hero.jpg` | Wide, 21:9 |
| First tournament | `photos/first-tournament/preparation.jpg` | 16:10 |
| First tournament | `photos/first-tournament/presenting.jpg` | Square |
| First tournament | `photos/first-tournament/questions.jpg` | Square |
| First tournament | `photos/first-tournament/guest.jpg` | Wide, 2:1 |
| First tournament | `photos/first-tournament/ceremony.jpg` | 4:3 |
| First tournament | `photos/first-tournament/winners.jpg` | 4:3 |
| Team | `photos/team/<id>.jpg`, for example `photos/team/ozodbek-toshpulatov.jpg` | Portrait, 4:5 |
| Partners | `photos/partners/<id>.png`, for example `photos/partners/the-diplomat.png` | Logo, transparent background |

Use JPG photos that are 2000 px wide or less, so the pages load fast. The recap video from 4 October has good frames for these photos.

## Check these facts before you publish

The text comes from UNPC emails and documents. Some of them do not agree:

- Organizers: the site says "100+". One document says "50+".
- Students: the site says "500+ engaged". Make sure that this number is correct.
- The Diplomat prize: the judges' guide says a two-year subscription. The email after 4 October says one year. The site says one year.
- Kazakhstan: the site says that a local organizer runs the same format. Make sure that this is correct.
- Contact: the site shows tashpulatovo211@gmail.com on every page. Change `config.email` if UNPC gets its own address.
