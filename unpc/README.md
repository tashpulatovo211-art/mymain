# UNPC website

The site for the Uzbekistan National Policy Competition. It's one page, `index.html`, with no build step. Open it in a browser to see it.

## Adding photos

1. Put the photo files in the `photos` folder. JPGs around 2000px wide are plenty.
2. In `index.html`, find the `gallery` block (search for "To add a photo") and add one line per photo:

```html
<figure><img src="photos/final-room-3.jpg" alt="Two teams in room 3 during questions" loading="lazy"><figcaption>Room 3, the final</figcaption></figure>
```

The first photo shows large. The "4 October 2026" section stays hidden until there is at least one photo in it. Write the `alt` text as what the photo shows, since screen readers read it out. The caption is optional.

## Other things you'll change

- **Registration link.** The three "Register" buttons point to the UNPC Registration Google Form. If you make a new form, search for `docs.google.com/forms` and replace all three links.
- **Partners.** Each partner is a `<div class="partner">` block in the "Prizes and partners" section. Copy one to add a new partner.
- **Guest talks.** Each speaker is a `<div class="person">` block. Remove a block if a talk falls through.
- **Cases.** The four cases from 4 October are in the "The cases" section. Replace them when the cases change.

## Putting it online

Any static host works, because it's plain files. The quickest is [Netlify Drop](https://app.netlify.com/drop): drag the `unpc` folder onto the page and it gives you a link. GitHub Pages also works if this folder goes into its own repository.
