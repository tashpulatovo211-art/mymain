# UNPC website

The site for the Uzbekistan National Policy Competition. It's one page, `index.html`, with no build step. Open it in a browser to see it.

The home page is the name, the emblem and a list of sections: Format, Cases, Scoring, Judges, Speakers, Prizes, Photos and Register. Clicking a section grows it out of its row, and each one has a Next link at the bottom that moves on to the following section.

## Adding photos

You don't need to edit any code. Save the photo as a `.jpg` with the right name in the `photos` folder, and it replaces the globe drawing in that spot.

| File | Where it shows |
| --- | --- |
| `photos/hero.jpg` | The wide photo under the name on the home page |
| `photos/format.jpg` | Format, and its row on the home page. A team presenting works well |
| `photos/cases.jpg` | Cases. A team preparing with the brief |
| `photos/scoring.jpg` | Scoring. Judges filling in the sheet |
| `photos/judges.jpg` | Judges. A judge asking a question |
| `photos/speakers.jpg` | Speakers. The guest speaker |
| `photos/prizes.jpg` | Prizes. Winners with certificates |
| `photos/register.jpg` | Register. Any good crowd shot |

For the Photos section, put pictures in `photos/gallery/` named `1.jpg`, `2.jpg`, `3.jpg` and so on, with no gaps in the numbers. The site stops at the first missing number. Photo `1.jpg` shows large and is also the picture on the Photos row.

Photos around 2000px wide are plenty. Landscape photos fit best everywhere except the gallery, which takes any shape.

## Other things you'll change

- **Registration link.** The Register buttons point to the UNPC Registration Google Form. If you make a new form, search for `docs.google.com/forms` and replace every link.
- **Partners.** Each partner is a `<div class="partner">` block in the Prizes section. Copy one to add a new partner.
- **Speakers.** Each speaker is a `<div class="person">` block. Remove a block if a talk falls through.
- **Cases.** The four cases from 4 October are in the Cases section. Replace them when the cases change.

## Putting it online

Any static host works, because it's plain files. The quickest is [Netlify Drop](https://app.netlify.com/drop): drag the `unpc` folder onto the page and it gives you a link. GitHub Pages also works if this folder goes into its own repository.
