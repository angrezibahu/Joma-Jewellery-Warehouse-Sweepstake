# Automatic results — how it works

The tracker keeps itself up to date from an **internal match calendar** committed
to the repo, so nobody has to sit at the admin panel during the tournament.

## The pieces

| File | What it is |
|------|------------|
| `schedule.json` | The internal calendar: all 104 World Cup 2026 matches with UK (BST) and UTC kickoff times, venues, group/stage, and a `resultsDueUTC` for each (kickoff **+ 4 hours** ≈ 2h play + 2h buffer for extra time / penalties). |
| `results.json` | Per-match scores + winners. Written automatically by the workflow. |
| `tracker-state.json` | Derived tournament state the website reads: who's eliminated, how far each team got (which drives the bracket), and group standings. |
| `manual-results.json` | Optional manual overrides (see below). |
| `scripts/update_results.py` | The engine: fetch scores → record them → derive standings, qualification (top 2 + best 8 third-placed) and the whole knockout bracket. |
| `.github/workflows/update-results.yml` | Runs the engine hourly during the tournament and commits any changes. |

## The flow

1. The workflow runs **hourly** through June 11–30 and July 1–19 (UTC cron).
2. For every match whose `resultsDueUTC` has passed and isn't recorded yet, the
   engine pulls the final score and writes it to `results.json`.
3. It recomputes `tracker-state.json` (eliminations + stages + standings).
4. If anything changed it commits to `main`, which triggers the existing GitHub
   Pages deploy — the live site updates on its own.

The website fetches these JSON files on load, so visitors always see current
results. The `?admin=true` panel still works: admin edits are stored as
**overrides** that take precedence over the automatic results, so you can correct
a wrong or late feed by hand at any time.

## Setup required (one-time)

1. **Add a results data source.** The engine uses
   [football-data.org](https://www.football-data.org/) (free tier). Get a free
   API token and add it as a repository secret named **`FOOTBALL_DATA_API_TOKEN`**
   (Settings → Secrets and variables → Actions → New repository secret).
   - Optionally set `FOOTBALL_DATA_COMPETITION` (defaults to `WC`) if the World
     Cup competition code differs on your plan.
   - GitHub's runners have open internet, so the fetch works there even though it
     can't be tested from a restricted dev environment.
2. That's it. The workflow already has `contents: write` permission to commit
   results back to `main`.

> If you'd rather not use an API at all, you can skip the secret and instead enter
> scores by hand in `manual-results.json` (see below) — everything else still
> derives automatically.

## Manual overrides

`manual-results.json` lets you hand-enter or correct a score. It **wins over the
API**. Keys are the match number (string) from `schedule.json`; values are the
score as `"home-away"` from the home team's perspective:

```json
{
  "1": "2-1",
  "73": "0-0"
}
```

(For a knockout that finished level after 90 mins, the API's winner flag decides
who progresses; for a hand-entered knockout score, enter the score that reflects
the actual aggregate/decisive result.)

## A note on tiebreakers

Group ranking uses the primary FIFA criteria: points, then goal difference, then
goals scored. The rarer tiebreakers (head-to-head, disciplinary/fair-play points,
drawing of lots) aren't reproduced automatically — if one ever decides a group,
use the admin panel to set the affected teams' stage by hand.
