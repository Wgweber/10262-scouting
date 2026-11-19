# 10262 Scouting

Offline-first FRC scouting for Team 10262. Live app: **https://wgweber.github.io/10262-scouting/**

Scouts use it on their phones (installed from the link, no app store); the scouting lead runs the
dashboard on one or more laptops. Everything is saved on the device first and synced through the
team's own Supabase database whenever there's internet. QR codes and backup files move data with no
internet at all.

## What it does

**Scouting (phones)**
- Match scouting built for live matches: sections per phase, big −/+1/+5 counters, yes/no toggles,
  a running point total, a one-tap "didn't show up", automatic station from the scout's assignment.
- Rate teams: all six robots of a match side by side; submit robots one at a time or together.
- Pit scouting with robot photos (shrunk to ~100 KB on the phone).
- Upload progress bar; works with no signal and retries by itself.

**Analysis (main computers)**
- Rankings by average points (auto / teleop / endgame), best match, consistency, reliability, foul
  points given, every match-form field, ratings, Blue Alliance rank/OPR and Statbotics EPA.
- Team pages: stat tiles, points-per-match chart, field averages, match-by-match table, notes,
  pit data, photos, history at other events.
- Compare up to four teams; search all scouting notes.
- Match planner: predicted score and win chance for any match (or custom alliances), each robot's
  numbers, shared strategy notes, printable briefing.
- Picklist with a weighted pick-score formula, groups (1st / 2nd / do not pick) and drag to reorder;
  live alliance-selection board with "best available".
- Scouts page: who scouted what, accuracy against official scores, missing reports, assignments.
- Excel export of everything; JSON backups; import of the original Google-Sheets workbook.

**Next season — no code needed**
The **Game Builder** (main computer) defines the match, pit and rating forms and what every answer is
worth (points per count, per option, when yes; foul points; which answers mean "the robot had a
problem"). Publishing it (delete password required) sends it to every device. All rankings,
predictions and pick scores follow it automatically. Retire fields instead of deleting them to keep
old answers counting. Forms can be downloaded/loaded as JSON.

## How the data is stored

One Supabase table, `records` (see `supabase-setup.sql` in the setup package). Every report is a row:
`kind` (pit, match, rating, photo, team, matchdata, alliance, strategy, assign, tbastats, epa, game),
`event` (e.g. `2027paca`; game forms use `_global`), `data` (JSON). Rows are protected by a team code
checked in the database (row-level security); newest edit wins.

## Files

| File | What it is |
|---|---|
| `index.html`, `css/app.css` | the page and its styles |
| `js/game.js` | game definitions, scoring, built-in 2026 REBUILT form, starter template |
| `js/stats.js` | points per phase, consistency, reliability, predictions, pick scores |
| `js/model.js`, `js/combine.js` | turns records into teams/rankings; combines several scouts' answers |
| `js/core.js` | on-device storage (IndexedDB), outbox and cloud sync |
| `js/tba.js` | The Blue Alliance schedule/standings/OPR and Statbotics EPA |
| `js/io.js`, `js/qr.js` | Excel/JSON import-export, QR transfer |
| `js/charts.js` | the SVG charts |
| `js/ui.js` | app shell, sync, settings and the scouting forms |
| `js/ui-analysis.js`, `js/ui-picklist.js`, `js/ui-admin.js` | analysis screens, picklist, Game Builder / Scouts / Help |
| `sw.js`, `manifest.webmanifest` | offline support and install |

After changing any file, bump `VERSION` in `sw.js` (e.g. `es-shell-v7` → `es-shell-v8`) so every
device offers "Update now".
