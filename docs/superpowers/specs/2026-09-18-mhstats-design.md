# MH Stats: design

Date: 2026-09-18. Status: approved in conversation, spec pending user review.

A "build your own monster" stat game in the style of statle.fun, using Monster Hunter
large monsters, served as a static page at `xyyoutube.com/mhstats` from the ytfx
container. It lives here only because the owner does not want a second domain. It
shares nothing with the video proxy beyond the static file middleware.

## Contents

1. [Goal and scope](#1-goal-and-scope)
2. [Placement and stack](#2-placement-and-stack)
3. [The deck](#3-the-deck)
4. [Deck pipeline](#4-deck-pipeline)
5. [Game](#5-game)
6. [Persistence and replays](#6-persistence-and-replays)
7. [Testing and verification](#7-testing-and-verification)
8. [Docs, branch, delivery](#8-docs-branch-delivery)
9. [Risks and open points](#9-risks-and-open-points)

## 1. Goal and scope

**Play loop.** Seven rounds. Each round draws a monster the player has not seen this
run and shows its render and name. The player assigns it to one of seven stat slots
that is still free. The hidden value flips over and is added to the total. After the
seventh pick the end screen shows the total, the best possible total for those seven
monsters and the assignment that reaches it, the worst possible total, and every
monster's full sheet.

**In scope (v1).**
- One game mode. No daily puzzle, no endless mode.
- 252 cards: every large monster of the mainline games, generations 1 to 6.
- Seven stats: HP, Attack, Defense, Speed, Will, Size, Temper. Values 1 to 100.
- One render image per monster.
- Previous runs, a top-runs list and round-by-round replays, stored in the browser.
- A share link that reproduces a run for someone else to watch as a replay.
- Discord link preview (OpenGraph tags) for the page.

**Out of scope (v1).** Accounts, server-side highscores, daily seed, endless mode,
Frontier, Online, Stories, small monsters, a generation filter, localisation.

**Rules the owner set.**
- Every value comes from game data. Where data is missing, a hand-rated value is
  allowed, but only through the curation overlay, with a written reason. No silent
  edits.
- Sanity anchors: Will of Rajang, Fatalis, Diablos and Deviljho must be near the top.
- Size beats weight. Roar, stamina and weight are not stats.

## 2. Placement and stack

- Route: `/mhstats/` (Express `static` already serves `public/`; `/mhstats` without a
  slash redirects to `/mhstats/` through the same middleware). No new Express routes,
  no changes to `index.js`.
- Files: `public/mhstats/index.html`, `app.js` (DOM and state), `game.js` (pure game
  logic, no DOM), `style.css`, `deck.json`, `img/<id>.webp`.
- Plain HTML, CSS and ES modules. No bundler, no framework, to match ytfx.
- The deck ships to the browser. Stats are readable in dev tools. Accepted, since there
  is no shared leaderboard to protect.
- Pipeline: `tools/mhstats/` (Node, ES modules). Its outputs are committed so the
  Docker build never touches the network.
- The Docker image must copy `public/`. Verify on master; add if missing.

Rejected alternatives: a server-backed game with round tokens and a SQLite highscore
table (Statle's model), and a separate container routed by path through the Cloudflare
Tunnel. Both add work for features that were cut.

## 3. The deck

### 3.1 Roster

Source: monsterhunterwiki.org, category "Large Monsters", filtered to entries whose
appearance template flags at least one mainline game (MH1, MHG, MHF1, MH2, MHF2, MHFU,
MH3, MHP3, MH3U, MH4, MH4U, MHGen, MHGU, MHWorld, MHWI, MHRise, MHRS, MHWilds). Measured
count on 2026-09-18: 252. Variants with their own page (Guardian Rathalos, Apex Zinogre,
deviants, Risen elders) are separate cards. Arena training targets and similar
non-monsters go on an explicit exclude list.

Each roster entry: `id` (slug), English name, Japanese name (for matching gen 1 and 2
sources), debut generation, latest mainline game, image source URL.

### 3.2 Stats

One card holds seven values. For each stat separately, the value comes from the
**latest mainline appearance that records that stat**, so a monster whose newest game
is GU takes HP from GU but Speed from an older game that has it, if any. The card's
game badge is the game that supplied HP. Raw values and their game are kept alongside
for the end screen.

| Stat | Raw source | Scale within game | Where it exists |
|---|---|---|---|
| HP | base health | log, min–max | every game |
| Attack | enrage attack multiplier; tie-break by strongest recorded move power | linear | every game (move power: World, Rise, Wilds, MHFU, MH2) |
| Defense | 100 minus the softest raw hitzone across parts and slash/blunt/shot; tie-break by head stagger value | linear | every game |
| Speed | enrage motion-speed multiplier | linear | World, Rise, Wilds, MH1, MHF2. Up to 96 monsters (those never in World, Rise or Wilds) need curation |
| Will | sum of initial tolerances for poison, paralysis, sleep, stun | linear | every game |
| Size | base length in cm; gold-crown size where base is absent | log, min–max | every game except MH1 (no crowns) |
| Temper | quick to anger and stays angry: mean of normalised 1/enrage-trigger-damage and normalised enrage duration | linear | World, Rise, Wilds, 4U, GU. About 28 monsters need curation |

### 3.3 Scaling

Raw scales differ per game (MHFU base HP is not on Wilds' scale), so:

1. Within each game, map raw to 0..1 by min–max, on log10 for HP and Size, after
   clipping at the 2nd and 98th percentile so siege monsters do not flatten the rest.
2. Map 0..1 to 1..100, rounded.
3. Apply the curation overlay.

Sum of a perfect run is therefore at most 700.

### 3.4 Curation overlay

`tools/mhstats/data/curation.json`: a list of `{ id, stat, value, reason }`. It is the
only place a value can come from outside a source. The build fails if an entry names an
unknown monster or stat, or if a monster ends up with a missing stat and no overlay
entry. A rendered report (`tools/mhstats/data/curation-report.md`) lists every overlay
entry so the whole hand-rated set can be reviewed in one place.

### 3.5 Images

One render per monster, taken from the monsterhunterwiki.org infobox image via the
MediaWiki API, Fandom as fallback. Resized to fit 512 px on the long side, encoded as
webp around quality 80, target under 40 KB each, so the whole set stays near 10 MB.
The page footer states: fan-made, Monster Hunter is a Capcom property, renders via the
wikis. Same footing as Statle's use of Pokémon sprites.

### 3.6 deck.json

```json
{
  "version": 1,
  "built": "2026-09-18",
  "stats": [
    { "key": "hp", "label": "HP" }, { "key": "atk", "label": "Attack" },
    { "key": "def", "label": "Defense" }, { "key": "spd", "label": "Speed" },
    { "key": "wil", "label": "Will" }, { "key": "siz", "label": "Size" },
    { "key": "tmp", "label": "Temper" }
  ],
  "monsters": [
    {
      "id": "rathalos", "name": "Rathalos", "gen": 1, "game": "MHWilds",
      "img": "img/rathalos.webp",
      "stats": { "hp": 58, "atk": 71, "def": 44, "spd": 63, "wil": 52, "siz": 55, "tmp": 40 },
      "raw": { "hp": "4500 base HP", "siz": "1704 cm", "spd": "x1.10 enraged" },
      "curated": ["spd"]
    }
  ]
}
```

`curated` lists the stats that came from the overlay, so the end screen can mark them.

## 4. Deck pipeline

Location `tools/mhstats/`. Node only, no Python, to match the repo.

```
roster.js            wiki category + appearance flags -> data/roster.json
sources/<game>.js    one extractor per source -> rows in data/observations.csv
merge.js             latest mainline appearance wins -> per-monster raw sheet
scale.js             section 3.3 -> 1..100 per stat
curate.js            overlay + validation + curation-report.md
images.js            download, resize, encode -> public/mhstats/img/
build.js             runs the chain -> public/mhstats/deck.json
```

- `observations.csv` columns: `monster_id, game, stat, raw_value, unit, source_url,
  fetched_at`. Committed, so every number is auditable and reviewable in a diff.
- Downloads are cached under `tools/mhstats/.cache/` (gitignored). Extractors are
  idempotent and skip when the cache is fresh.
- Sources per game, verified 2026-09-18 (full list with URLs and verdicts in the
  research notes kept outside the repo):
  - Wilds: `wilds.mhdb.io` API plus the robomeche MHWilds-Database JSON (enrage,
    stamina, tolerances, hitzones).
  - Rise and Sunbreak: `mhrice.json` (one 124 MB dump; stream-parse, do not load whole).
  - World and Iceborne: Kiranico World pages, poedb as cross-check. The mhw-db API has
    no numeric stats and is not used.
  - 4U: Kiranico 4U pages expose an inline JSON blob per monster.
  - Generations and GU: Kiranico GU pages; gatheringhallstudios `mhgu.db` as cross-check.
  - 3U and Portable 3rd: dbooga MH3U SQLite, Kiranico 3U, gamerp MHP3 pages.
  - Tri: maliciousbanjo `mh3-data`.
  - Freedom Unite and Freedom 2: Kolyn090 `mhfu-db` JSON.
  - MH2 Dos, MHG, MH1: mhwiki.axibug.com mirrors of the Japanese data-mine wikis,
    matched by Japanese name.
- Matching is by exact English name first, then Japanese name, then a hand-written
  alias table. Unmatched roster entries fail the build with a list.

## 5. Game

### 5.1 Logic (`game.js`, pure)

- `newRun(deck, seed)`: seeded RNG (mulberry32) draws 7 distinct monsters. The seed
  makes a run reproducible for replays and share links.
- `pick(run, statKey)`: assigns the current monster to a free slot, returns the value.
- `bestAssignment(monsters)` and `worstAssignment(monsters)`: brute force over the
  5040 orderings of 7 stats; returns score and mapping.
- `encodeShare(run)` / `decodeShare(str)`: seed plus the seven pick keys, URL-safe.

### 5.2 Screens

- **Home.** Play button, top runs, link to replays. Short "how it works" line.
- **Round.** Render, name, game badge (which game the numbers come from), running
  total, seven slot buttons. Used slots show a small thumbnail of the monster placed
  there and its value. A pick animates the value flipping over.
- **End.** Total out of 700. Best possible total with its assignment drawn as
  monster to stat. Worst possible. A table of all seven monsters with their full
  sheets, the player's pick highlighted, curated stats marked. Buttons: play again,
  copy share link.
- **Replay.** Steps through a stored or shared run one pick at a time, then lands on
  its end screen.

### 5.3 Presentation

- Mobile first, 16 px side gutter, no horizontal scroll, since links open from Discord.
- Dark theme by default with a light variant via `prefers-color-scheme`.
- OpenGraph and Twitter card tags so the `/mhstats/` link previews with a title and an
  image in Discord.

## 6. Persistence and replays

`localStorage` key `mhstats.runs.v1`, a JSON array of at most 50 runs, newest first:

```json
{ "seed": 123456789, "monsters": ["rathalos", "..."], "picks": ["hp", "..."],
  "score": 412, "best": 545, "worst": 210, "at": "2026-09-18T20:15:00Z" }
```

- Top runs: the 10 highest `score`, with `score / best` shown as a percentage.
- Replay: rebuild the run from `seed` and `picks` against the current deck. If the
  deck version changed and the monsters no longer match, show the stored numbers and
  say the deck has changed since.
- Every read and write is wrapped in try/catch; the game works with storage disabled.

## 7. Testing and verification

- `tests/mhstats-scale.test.js`: within-game scaling, log handling, percentile clipping,
  rounding bounds 1..100.
- `tests/mhstats-merge.test.js`: latest appearance wins, alias matching, build fails on
  unmatched roster entries and on missing stats without overlay.
- `tests/mhstats-game.test.js`: seeded draws are reproducible and distinct, pick rules,
  best and worst assignments against hand-computed cases, share encode/decode round
  trip.
- `tests/mhstats-deck.test.js`: the committed `deck.json` is valid: 252 monsters, every
  stat present and in range, every image file exists, the four Will anchors are in the
  top decile.
- Manual: open the page in a real browser at phone width and desktop, play a run,
  reload, confirm top runs and replay, open a share link in a fresh profile. Screenshot
  before claiming done.
- All new tests run under the existing `npm test` so CI covers them.

## 8. Docs, branch, delivery

- Branch `feat/mhstats` off `origin/master`, in a worktree. Commits: spec; pipeline
  with tests; deck data and images as their own commit so the numbers are reviewable;
  game page; docs.
- Add `CLAUDE.md` to ytfx (it has none) covering routes, the pipeline and deploy.
- `README.md` route list and `ARCHITECTURE.md` get a short `/mhstats` section.
- `ADR.md`: one entry recording that a game lives in the video proxy and why.
- PR to master. If the pipeline plus deck diff grows unwieldy, split into two PRs:
  pipeline and deck first, game page second. Deploy is the existing ytfx path on
  tt-server; the page is live when the container is rebuilt.

## 9. Risks and open points

- **Name matching for gens 1 to 3.** Japanese names and subspecies naming vary between
  wikis. Mitigation: alias table, and the build lists every unmatched monster.
- **Source drift.** Fan sites change or vanish. Mitigation: committed observations
  and cache, so a rebuild never depends on a site still being up.
- **Curation volume.** Roughly 96 Speed and 28 Temper values, plus MH1 sizes, are
  hand-rated. They are concentrated in one reviewable report.
- **Image rights.** Renders are Capcom artwork hosted by fan wikis. Fan-made
  disclaimer in the footer; remove on request.
- **Deck changes invalidate stored runs.** Handled in section 6 by keeping the stored
  numbers as the fallback.
