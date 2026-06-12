# Joma Jewellery World Cup Sweepstake

A monochrome World Cup 2026 sweepstake tracker, curated by Megg.

Forked from [angrezibahu/2026Sweepstake](https://github.com/angrezibahu/2026Sweepstake) and rethemed.

## Live site

Once GitHub Pages is enabled in Settings → Pages (Source: GitHub Actions), the
site will deploy automatically on every push to `main`.

## Prizes

| Place | Prize |
|---|---|
| 🥇 Winner | £140 |
| 🥈 Runner-up | £50 |
| 🥉 3rd | £25 |
| 💩 Worst Team | £25 |

## Running the draw

Once the list of participants is ready:

1. Visit the site with `?admin=true` on the end of the URL.
2. Paste names (one per line) into the admin textarea.
3. Click **Run the Draw!** and watch the slot machine assign teams.
4. Click **Export Data**, save the JSON, then paste the resulting
   assignments into `data.js` (`DEFAULT_ASSIGNMENTS`) and commit. That
   bakes the draw in so everyone sees the same result without needing
   their own local copy.

## Customising further

- **Colours / theme**: edit the CSS variables at the top of `style.css`
  (`:root { ... }`). The whole palette flows from there.
- **Fonts**:
  - Headings use [Quasimoda](https://www.hoeflerco.com/) (Hoefler), with
    [Mulish](https://fonts.google.com/specimen/Mulish) as a free fallback
    loaded from Google Fonts. To use real Quasimoda, drop the
    `Quasimoda-Regular.woff2` and `Quasimoda-Bold.woff2` files into a
    `fonts/` folder at the repo root — the `@font-face` block at the top
    of `style.css` is already wired up to pick them up.
  - Body text uses Times New Roman (built-in system font, no download
    needed).
- **Brand name / tagline / prizes**: in `index.html`, look for the
  `<header class="hero">` block.

## Automated results

Match results auto-update via the `Update match results` GitHub Action,
which calls football-data.org hourly during the tournament. To enable it
you need to add a `FOOTBALL_DATA_API_TOKEN` repository secret (get a free
token at https://www.football-data.org/). Without the secret, you can
still update results by hand via the admin panel.

See `RESULTS_AUTOMATION.md` for the full automation flow.

## Credit

- App built by [angrezibahu](https://github.com/angrezibahu) for the
  Kewford South sweepstake.
- This Joma Jewellery edition curated by Megg.
