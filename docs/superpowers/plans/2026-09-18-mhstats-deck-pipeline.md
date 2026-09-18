# MH Stats Deck Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `public/mhstats/deck.json` (252 monsters, seven stats each) and `public/mhstats/img/` from real Monster Hunter game data, with every number traceable to a source or to a reviewed overlay entry.

**Architecture:** A chain of small Node ES modules under `tools/mhstats/`. Each source gets one extractor that writes rows into a single append-only observations file; nothing invents numbers at that stage. Merge picks the newest game per stat, scaling normalises per game to 1..300, refinement ranks monsters the sources tied without letting any of them cross a monster the sources separated, inheritance fills variant gaps from base species, and the curation overlay is the only place a fully hand-rated value can enter. All outputs are committed so the Docker build never touches the network.

**Tech Stack:** Node 22 ES modules (CI pins 22; local is 24). `sql.js` is already a dependency and reads the two SQLite sources without a native build. `sharp` is the one new dependency, for image resizing. Everything else uses global `fetch`, `node:zlib` and `TextDecoder`, which handles Shift_JIS.

**Spec:** `docs/superpowers/specs/2026-09-18-mhstats-design.md` (sections 3 and 4).

**Research:** `~/tmp/mhstats-cache/format-cards.md` holds a verified locator card per source: exact JSON key paths, regexes and SQL, each re-tested against a held-out monster. Read the section for your source before writing its extractor. Downloaded source files are already cached under `~/tmp/mhstats-cache/`.

## Global Constraints

- Node ES modules only (`"type": "module"` is already set). No TypeScript.
- Nothing in `tools/mhstats/` may write inside `public/` except `build.js` and `images.js`.
- Network downloads go to `tools/mhstats/.cache/` (gitignored). An extractor must reuse a cached file if present and must never require the network on a second run.
- Every extractor is polite: sequential requests, at least 1000 ms between requests to the same host, a `User-Agent` of `mhstats-deck-builder (github.com/iasonS/ytfx)`, and 3 retries with backoff.
- No number reaches `deck.json` without a row in `observations.csv`, an entry in `refinement.json`, or an entry in `curation.json`. The build fails otherwise.
- Refinement may never reorder two monsters that the sources separated (spec 3.4). `refine.js` enforces the band bounds in code and throws on a violation, so a bad ranking file cannot silently reshape the deck.
- Values are integers from 1 to `STAT_MAX` (300). `STAT_MAX` is defined once, in `scale.js`, and copied into `deck.json` as `statMax`.
- Git authorship `iasonS <sklavenitisi6@gmail.com>`, no Co-Authored-By lines. Inside the worktree call `/usr/bin/git` directly, because the RTK hook trips the worktree guard.
- Commit after every task with the message given in the task.

---

## File map

| File | Responsibility |
|---|---|
| `tools/mhstats/README.md` | How to rebuild the deck, and what each stage does |
| `tools/mhstats/lib/fetch.js` | Cached, rate-limited, retrying fetch; text, JSON and binary |
| `tools/mhstats/lib/observations.js` | Read and write `observations.csv`; the row contract |
| `tools/mhstats/roster.js` | Wiki category to `data/roster.json` (252 monsters) |
| `tools/mhstats/sources/wilds.js` | mhdb API plus robomeche dump |
| `tools/mhstats/sources/rise.js` | mhrice.json, streamed into a slim cache first |
| `tools/mhstats/sources/world.js` | Kiranico World HTML plus poedb for base size |
| `tools/mhstats/sources/mh4u.js` | Kiranico 4U inline `js_vars` JSON |
| `tools/mhstats/sources/mhgu.js` | gatheringhallstudios SQLite plus Kiranico GU HTML |
| `tools/mhstats/sources/mh3u.js` | dbooga SQLite plus three Japanese sites |
| `tools/mhstats/sources/mhfu.js` | Kolyn090/mhfu-db JSON files |
| `tools/mhstats/merge.js` | Newest game per stat, then base-species inheritance |
| `tools/mhstats/scale.js` | Per-game normalisation to 1..`STAT_MAX` |
| `tools/mhstats/refine.js` | Applies `data/refinement.json` within the band rule (spec 3.4) |
| `tools/mhstats/curate.js` | Overlay, validation, `curation-report.md` |
| `tools/mhstats/images.js` | Wiki renders to `public/mhstats/img/*.webp` plus `credits.txt` |
| `tools/mhstats/build.js` | Runs the chain, writes `public/mhstats/deck.json` |
| `tools/mhstats/data/roster.json` | Committed roster |
| `tools/mhstats/data/observations.csv` | Committed raw observations, one row per fact |
| `tools/mhstats/data/refinement.json` | Committed within-band rankings with reasons |
| `tools/mhstats/data/curation.json` | Committed hand-rated values with reasons |
| `tests/mhstats-pipeline.test.js` | Tests for merge, scale, inheritance, curation |
| `tests/mhstats-deck.test.js` | Validates the committed `deck.json` |

**Stat inputs.** Seven stats are derived from these raw inputs, which is what extractors record:

| Stat | Raw inputs |
|---|---|
| HP | `base_hp` |
| Attack | `enrage_attack_mult`, plus `move_power_max` where a source has it |
| Defense | `hitzone_max_raw` (lower is tougher), tie-break `head_stagger` |
| Speed | `enrage_speed_mult` |
| Will | `tolerance_poison` + `tolerance_paralysis` + `tolerance_sleep` + `tolerance_stun` |
| Size | `size_base`, falling back to `size_gold` |
| Temper | `enrage_trigger` (inverted) and `enrage_duration` |

**Known source gaps**, from the verified cards. These are expected, not bugs, and are filled by inheritance then curation:

| Source | Monsters | Missing |
|---|---|---|
| Wilds | 34 | `move_power_max` |
| Rise | 78 | nothing |
| World | 49 | nothing |
| 4U | 23 | `enrage_trigger`, `move_power_max` |
| GU | 45 | all four enrage inputs, `move_power_max` |
| 3U | 20 | `base_hp`, `enrage_trigger`, `move_power_max` |
| FU | 8 | `enrage_speed_mult`, `enrage_trigger`, `enrage_duration`, `move_power_max` |

---

### Task 1: Fetch helper and observation contract

**Files:**
- Create: `tools/mhstats/lib/fetch.js`
- Create: `tools/mhstats/lib/observations.js`
- Create: `tools/mhstats/.gitignore`
- Test: `tests/mhstats-pipeline.test.js`

**Interfaces:**
- Produces: `cachedFetch(url, { as = 'text', cacheName, headers })` returning a string, object or Buffer, reading `tools/mhstats/.cache/<cacheName>` when present; `CACHE_DIR`.
- Produces: `RAW_INPUTS` (array of the 12 input names), `writeObservations(rows, path)`, `readObservations(path)`, `obsRow({ monster, game, input, value, unit, source })`.

- [ ] **Step 1: Write the failing test**

Create `tests/mhstats-pipeline.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { RAW_INPUTS, obsRow, writeObservations, readObservations } from '../tools/mhstats/lib/observations.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('mhstats observations', () => {
  it('names every raw input the stats need', () => {
    expect(RAW_INPUTS).toEqual([
      'base_hp', 'size_base', 'size_gold',
      'enrage_attack_mult', 'enrage_speed_mult', 'enrage_trigger', 'enrage_duration',
      'hitzone_max_raw', 'head_stagger',
      'tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun',
      'move_power_max',
    ]);
  });

  it('rejects an unknown input or a missing source', () => {
    expect(() => obsRow({ monster: 'rathalos', game: 'MHWilds', input: 'vibes', value: 1, unit: 'x', source: 'u' }))
      .toThrow(/unknown input/);
    expect(() => obsRow({ monster: 'rathalos', game: 'MHWilds', input: 'base_hp', value: 1, unit: 'hp', source: '' }))
      .toThrow(/source/);
  });

  it('round-trips rows through CSV, escaping commas and quotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mhstats-'));
    const file = join(dir, 'observations.csv');
    const rows = [
      obsRow({ monster: 'rathalos', game: 'MHWilds', input: 'base_hp', value: 4500, unit: 'hp', source: 'https://wilds.mhdb.io/en/monsters' }),
      obsRow({ monster: 'plum-daimyo-hermitaur', game: 'MH4U', input: 'size_gold', value: 1234.5, unit: 'cm', source: 'https://kiranico.com/a,b "c"' }),
    ];
    writeObservations(rows, file);
    const back = readObservations(file);
    expect(back).toHaveLength(2);
    expect(back[0].value).toBe(4500);
    expect(back[1].source).toBe('https://kiranico.com/a,b "c"');
    expect(back[1].value).toBeCloseTo(1234.5);
  });

  it('sorts rows so the committed file has a stable diff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mhstats-'));
    const file = join(dir, 'observations.csv');
    const mk = (m, i) => obsRow({ monster: m, game: 'MHRise', input: i, value: 1, unit: 'x', source: 's' });
    writeObservations([mk('zinogre', 'base_hp'), mk('arzuros', 'size_base'), mk('arzuros', 'base_hp')], file);
    const back = readObservations(file);
    expect(back.map(r => `${r.monster}/${r.input}`))
      .toEqual(['arzuros/base_hp', 'arzuros/size_base', 'zinogre/base_hp']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: FAIL, cannot find module `../tools/mhstats/lib/observations.js`.

- [ ] **Step 3: Write `tools/mhstats/lib/observations.js`**

```js
// The observation row contract. Extractors only ever produce these; no derived
// stats, no scaling, no judgement. One row is one fact read from one source.
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';

export const RAW_INPUTS = [
  'base_hp', 'size_base', 'size_gold',
  'enrage_attack_mult', 'enrage_speed_mult', 'enrage_trigger', 'enrage_duration',
  'hitzone_max_raw', 'head_stagger',
  'tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun',
  'move_power_max',
];

const COLUMNS = ['monster', 'game', 'input', 'value', 'unit', 'source'];

export function obsRow({ monster, game, input, value, unit, source }) {
  if (!monster) throw new Error('observation needs a monster id');
  if (!game) throw new Error('observation needs a game');
  if (!RAW_INPUTS.includes(input)) throw new Error(`unknown input ${input}`);
  if (!Number.isFinite(value)) throw new Error(`observation ${monster}/${input} needs a numeric value`);
  if (!unit) throw new Error('observation needs a unit');
  if (!source) throw new Error('observation needs a source URL');
  return { monster, game, input, value, unit, source };
}

function esc(v) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

export function writeObservations(rows, path) {
  const sorted = rows.slice().sort((a, b) =>
    a.monster.localeCompare(b.monster) || a.input.localeCompare(b.input) || a.game.localeCompare(b.game));
  const body = sorted.map(r => COLUMNS.map(c => esc(r[c])).join(',')).join('\n');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${COLUMNS.join(',')}\n${body}\n`);
  return sorted;
}

export function readObservations(path) {
  const lines = readFileSync(path, 'utf8').trim().split('\n');
  return lines.slice(1).map(line => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(COLUMNS.map((c, i) => [c, cells[i]]));
    row.value = Number(row.value);
    return row;
  });
}
```

- [ ] **Step 4: Write `tools/mhstats/lib/fetch.js`**

```js
// Cached, polite fetch. A second run of any extractor must work offline, so
// every download is written to .cache/ and read from there when present.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export const CACHE_DIR = new URL('../.cache/', import.meta.url).pathname;
const UA = 'mhstats-deck-builder (github.com/iasonS/ytfx)';
const MIN_GAP_MS = 1000;
const lastRequest = new Map();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function politeGap(host) {
  const since = Date.now() - (lastRequest.get(host) ?? 0);
  if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
  lastRequest.set(host, Date.now());
}

export async function cachedFetch(url, { as = 'text', cacheName, headers = {} } = {}) {
  const name = cacheName ?? encodeURIComponent(url).slice(0, 200);
  const path = join(CACHE_DIR, name);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (as === 'buffer') return buf;
    const text = buf.toString('utf8');
    return as === 'json' ? JSON.parse(text) : text;
  }
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await politeGap(host);
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf);
      if (as === 'buffer') return buf;
      const text = buf.toString('utf8');
      return as === 'json' ? JSON.parse(text) : text;
    } catch (err) {
      lastErr = err;
      await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}
```

- [ ] **Step 5: Write `tools/mhstats/.gitignore`**

```
.cache/
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 7: Commit**

```bash
/usr/bin/git add tools/mhstats/lib tools/mhstats/.gitignore tests/mhstats-pipeline.test.js
/usr/bin/git commit -m "feat(mhstats): observation contract and cached fetch helper"
```

---

### Task 2: Roster

**Files:**
- Create: `tools/mhstats/roster.js`
- Create: `tools/mhstats/data/roster.json` (generated, committed)
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:**
- Consumes: `cachedFetch`.
- Produces: `MAINLINE_GAMES` (18 game codes in release order), `GAME_SOURCE` (game code to source key), `buildRoster()` writing `data/roster.json`, `slugify(name)`.
- A roster entry is `{ id, name, ja, debut, latest, source, games, image }`.

Background: `monsterhunterwiki.org` pages carry a `MonsterAppearancesNav` template with one `Y` flag per game, and a `MonsterGameInfoBox_Overview` with the Japanese name and the render filename. Filtering to entries with at least one mainline flag gives 252 monsters, measured on 2026-09-18.

- [ ] **Step 1: Write the failing test**

Append to `tests/mhstats-pipeline.test.js`:

```js
import { MAINLINE_GAMES, GAME_SOURCE, slugify, parseMonsterPage } from '../tools/mhstats/roster.js';

describe('mhstats roster', () => {
  it('orders the mainline games by release', () => {
    expect(MAINLINE_GAMES).toEqual(['MH1', 'MHG', 'MHF1', 'MH2', 'MHF2', 'MHFU', 'MH3', 'MHP3', 'MH3U',
      'MH4', 'MH4U', 'MHGen', 'MHGU', 'MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds']);
    for (const g of MAINLINE_GAMES) expect(GAME_SOURCE[g]).toBeTruthy();
  });

  it('slugifies names with apostrophes, dots and spaces', () => {
    expect(slugify("Safi'jiiva")).toBe('safi-jiiva');
    expect(slugify('Plum D.Hermitaur')).toBe('plum-d-hermitaur');
    expect(slugify('Yian Kut-Ku')).toBe('yian-kut-ku');
  });

  it('reads flags, japanese name and image out of a wiki page', () => {
    const wikitext = `{{Meta\n|MetaImage = File:MHWilds-Rathalos Render 001.webp\n}}\n` +
      `{{MonsterAppearancesNav\n|MH1 = Y\n|MHWilds = Y\n|MHFrontier = Y\n|Music = Y\n}}\n` +
      `{{MonsterGameInfoBox_Overview\n|English Name = Rathalos\n|Japanese Name = リオレウス\n` +
      `|Image = MHWilds-Rathalos Render 001.webp\n}}`;
    const r = parseMonsterPage('Rathalos', wikitext);
    expect(r).toMatchObject({ id: 'rathalos', name: 'Rathalos', ja: 'リオレウス', debut: 'MH1', latest: 'MHWilds', source: 'Wilds' });
    expect(r.games).toEqual(['MH1', 'MHWilds']);
    expect(r.image).toBe('MHWilds-Rathalos Render 001.webp');
  });

  it('strips the template-default wrapper around an image field', () => {
    const wikitext = `{{MonsterAppearancesNav\n|MH4U = Y\n}}\n{{MonsterGameInfoBox_Overview\n` +
      `|Japanese Name = ダラ・アマデュラ\n|Image = {{{Render|MH4U-Dalamadur Render.png}}}\n}}`;
    expect(parseMonsterPage('Dalamadur', wikitext).image).toBe('MH4U-Dalamadur Render.png');
  });

  it('returns null for a page with no mainline appearance', () => {
    expect(parseMonsterPage('Slime', '{{MonsterAppearancesNav\n|MHST1 = Y\n}}')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: FAIL, cannot find module `../tools/mhstats/roster.js`.

- [ ] **Step 3: Write `tools/mhstats/roster.js`**

```js
// Roster: which monsters are in the deck, and which game supplies each one's
// numbers. Source is monsterhunterwiki.org's Large Monsters category.
import { writeFileSync, mkdirSync } from 'fs';
import { cachedFetch } from './lib/fetch.js';

const API = 'https://monsterhunterwiki.org/api.php';

export const MAINLINE_GAMES = ['MH1', 'MHG', 'MHF1', 'MH2', 'MHF2', 'MHFU', 'MH3', 'MHP3', 'MH3U',
  'MH4', 'MH4U', 'MHGen', 'MHGU', 'MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds'];

// Which extractor covers a game's numbers. Older games share the database of
// the newest game that reprinted their stats.
export const GAME_SOURCE = {
  MH1: 'FU', MHG: 'FU', MHF1: 'FU', MH2: 'FU', MHF2: 'FU', MHFU: 'FU',
  MH3: '3U', MHP3: '3U', MH3U: '3U',
  MH4: '4U', MH4U: '4U',
  MHGen: 'GU', MHGU: 'GU',
  MHWorld: 'World', MHWI: 'World',
  MHRise: 'Rise', MHRS: 'Rise',
  MHWilds: 'Wilds',
};

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function templateBody(wikitext, name) {
  const m = new RegExp(`\\{\\{${name}([\\s\\S]*?)\\n\\}\\}`).exec(wikitext);
  return m ? m[1] : null;
}

function field(body, key) {
  if (!body) return null;
  const m = new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n|]*)`).exec(body);
  return m ? m[1].trim() : null;
}

export function parseMonsterPage(title, wikitext) {
  const nav = templateBody(wikitext, 'MonsterAppearancesNav');
  if (!nav) return null;
  const flagged = new Set();
  for (const line of nav.split('\n|')) {
    const m = /^\s*(\w+)\s*=\s*Y\b/.exec(line);
    if (m) flagged.add(m[1]);
  }
  const games = MAINLINE_GAMES.filter(g => flagged.has(g));
  if (!games.length) return null;

  const box = templateBody(wikitext, 'MonsterGameInfoBox_Overview');
  const meta = templateBody(wikitext, 'Meta');
  // An image can be a bare filename, File:-prefixed, or wrapped in a template default.
  let image = field(box, 'Image') ?? field(meta, 'MetaImage');
  if (image) {
    image = image.replace(/^\{\{\{[^|}]*\|(.*)\}\}\}$/, '$1').replace(/^File:/, '').trim() || null;
  }
  const latest = games[games.length - 1];
  return {
    id: slugify(title),
    name: title,
    ja: field(box, 'Japanese Name'),
    debut: games[0],
    latest,
    source: GAME_SOURCE[latest],
    games,
    image,
  };
}

async function categoryTitles() {
  const url = `${API}?action=query&list=categorymembers&cmtitle=Category:Large%20Monsters` +
    '&cmnamespace=0&cmlimit=500&format=json&formatversion=2';
  const data = await cachedFetch(url, { as: 'json', cacheName: 'wiki-category.json' });
  return data.query.categorymembers.map(m => m.title);
}

async function wikitextFor(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = `${API}?action=query&prop=revisions&rvslots=main&rvprop=content` +
      `&titles=${batch.map(encodeURIComponent).join('|')}&format=json&formatversion=2`;
    const data = await cachedFetch(url, { as: 'json', cacheName: `wiki-pages-${i}.json` });
    for (const p of data.query.pages) {
      if (p.revisions) out.set(p.title, p.revisions[0].slots.main.content);
    }
  }
  return out;
}

export async function buildRoster() {
  const titles = await categoryTitles();
  const pages = await wikitextFor(titles);
  const roster = [];
  for (const [title, text] of pages) {
    const entry = parseMonsterPage(title, text);
    if (entry) roster.push(entry);
  }
  roster.sort((a, b) => a.id.localeCompare(b.id));
  const path = new URL('./data/roster.json', import.meta.url).pathname;
  mkdirSync(new URL('./data/', import.meta.url).pathname, { recursive: true });
  writeFileSync(path, `${JSON.stringify(roster, null, 2)}\n`);
  return roster;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const roster = await buildRoster();
  const bySource = {};
  for (const r of roster) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  console.log(`roster: ${roster.length} monsters`, bySource);
  const noImage = roster.filter(r => !r.image).map(r => r.name);
  if (noImage.length) console.log('no image field:', noImage.join(', '));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Generate the roster and sanity check it**

Run: `node tools/mhstats/roster.js`

Expected: `roster: 252 monsters` with counts near `{ Wilds: 34, Rise: 73, GU: 45, World: 49, '3U': 20, '4U': 23, FU: 8 }`. One monster (Anjanath) is expected to report no image field; that is a known wiki gap and is handled in the images task.

If the count differs from 252 by more than a few, the wiki category changed. Print the diff against the counts above and report it rather than editing the code to match.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/mhstats/roster.js tools/mhstats/data/roster.json tests/mhstats-pipeline.test.js
/usr/bin/git commit -m "feat(mhstats): build the 252-monster roster from the wiki"
```

---

## Extractors (Tasks 3 to 9)

**Read this before any extractor task.** `docs/superpowers/research/2026-09-18-source-locators.md` holds a card per source with the exact JSON key paths, regexes and SQL, plus a `VERDICT` block recording what a skeptic agent found when it re-ran each locator against a held-out monster. The `FAILED` entries in those blocks are locators that looked correct and were not. Each task below lists the ones that will bite; the card has the corrected form.

**Shared contract.** Every extractor is a module exporting `extract(roster) => Promise<row[]>`, where `row` comes from `obsRow(...)` and `roster` is the entries from `data/roster.json` whose `source` matches. It must:

1. Emit only inputs the source genuinely has. A missing input is an omitted row, never a zero.
2. Emit `source` as the specific URL the number came from, not the site root.
3. Match monsters by the source's own spelling, through an explicit alias map where they differ. An unmatched roster entry is a thrown error listing the names, never a silent skip.
4. Work offline on a second run, via `cachedFetch`.

**New dev dependencies**, used only by the pipeline, so they go in `devDependencies` and stay out of the production image: `cheerio` (HTML tables that regex cannot safely parse) and `sharp` (image resizing, images task only).

Each extractor task follows the same five steps, with the per-source specifics given in the task:

- **Step 1:** Write the failing test in `tests/mhstats-pipeline.test.js` from the task's "test asserts" list, using the fixture values given.
- **Step 2:** Run `npx vitest run tests/mhstats-pipeline.test.js` and confirm it fails on the missing module.
- **Step 3:** Implement the extractor against the card, handling every gotcha the task lists.
- **Step 4:** Run `node tools/mhstats/sources/<name>.js` and check the printed coverage table against the task's expected counts. A shortfall is reported, not coded around.
- **Step 5:** Commit with the message given.

---

### Task 3: Wilds extractor (34 monsters)

**Files:**
- Create: `tools/mhstats/sources/wilds.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)`, and `deriveWilds(mhdbMonster, roboRecord)` as a pure function so the test can drive it without network.

**Inputs emitted:** all except `move_power_max` (neither feed has a move table; `/en/motion-values` returns an empty array).

**Sources:** `https://wilds.mhdb.io/en/monsters` (one request covers all 34) and the robomeche dump `MHWilds_Data_compact.json.gz`, gunzipped with `node:zlib`.

**Gotchas that will bite:**
- Join the two feeds on `mhdb.gameId === Number(roboKey)`. The mhdb `id` field (1 to 34) is a different number and joining on it silently mismatches every monster.
- Drop the robomeche entry `High Purrformance Barrel Puncher`, an arena dummy with 50000 HP and a null `AngryTable`. It is absent from mhdb.
- `AngryTable[0].Upper` is High Rank and `.Lower` is Low Rank; use `Upper` throughout and say so in the emitted unit. `MonDamage` is the monster's attack multiplier; `PlDamage` is damage dealt *to* it, and is not Attack.
- For `hitzone_max_raw`, keep only rows with `State === ''` and drop parts matching `/^(HIDE|Weak Point|Unmatched)/`. Without the state filter, 23 of 34 monsters get a max from a conditional weak spot, and mhdb's `parts[].multipliers` reach 1.0 for Xu Wu and Omega Planetes.
- Zoh Shia has two default-state head rows, `Head` and `Head (Crystallized)`. Match `Part === 'Head'` exactly.
- The tolerance row key is spelled `Paralyze`. `ConditionTable.Rows` is found by `Stats === 'Initial Tolerance'`.
- `head_stagger` is `Flinch[0]`, an array whose later entries are further flinch stages. mhdb's `parts[].health` is null for Guardian Rathalos and Gogmazios, so robomeche is required.

**Test asserts** (drive `deriveWilds` with two small hand-built fixtures, taken from the card's verified examples):
- Rathalos: `base_hp` 4500, `size_base` 1704.22, `size_gold` 2096.1907, `enrage_attack_mult` 1.26, `enrage_speed_mult` 1.1, `enrage_trigger` 1500, `enrage_duration` 100, `head_stagger` 500, `tolerance_poison` 250, `tolerance_paralysis` 180, `tolerance_sleep` 150, `tolerance_stun` 120.
- A fixture whose rows include a `State: 'Weak'` part at 90 and a `HIDE` part at 100 yields `hitzone_max_raw` from the default-state rows only.
- No `move_power_max` row is emitted.
- A robomeche record with a null `AngryTable` emits no enrage rows and does not throw.

**Expected coverage:** 34 monsters, 13 of the 14 inputs, 442 rows.

**Commit:** `feat(mhstats): Wilds extractor (mhdb + robomeche)`

---

### Task 4: Rise extractor (73 monsters)

**Files:**
- Create: `tools/mhstats/sources/rise.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)`, `buildSlimCache()` and `deriveRise(slimEntry)`.

**Inputs emitted:** all 14. Rise is the only source with no gaps.

**Source:** `https://mhrice.info/mhrice.json`, 118 MB of pretty-printed JSON behind a 302.

**Gotchas that will bite:**
- Parsing the whole file needs roughly 2 GB of heap. Run the extractor as `node --max-old-space-size=4096`, and have it write a slim derived cache (a few hundred KB) on first run so that every later stage reads the slim file instead. Never print the parsed object.
- **Status tolerances are not the monster's own numbers.** `condition_damage_data.<status>_data.preset_type` indexes `condition_preset.<status>_data`; the monster's own `default_stock` applies only when `preset_type` equals that list's length (poison 7, paralyze 6, sleep 4, stun 6). Reading the raw value gives Magnamalo a poison tolerance of 0 and Rathian 180 instead of 250. This is the single easiest thing to get wrong here.
- Identity: `em_type.Em === id | (sub_id << 8)`. The English name comes from `enemy_type`, not `id`, via `monster_names.entries` named `EnemyIndex{NNN}` or `monster_names_mr.entries` named `EnemyIndex{NNN}_MR`, taking `content[1]`.
- Keep only monsters whose `em_type.Em` appears in `monster_list.data_list`. That drops the unnamed `131_00` dummy with 100 HP.
- The size field is spelled `king_boarder`. Gold crown is `base_size * king_boarder`.
- The head is not always index 0. For hitzones use `monster_list.part_table_data` where `part === 43`; Astalos has no part 43 and needs the `/頭|トサカ/` regex fallback on `collider_mapping`. For stagger, the head part index is 6 for the Rathalos family, 5 for Basarios, 1 for Volvidon and the Somnacanth pair.
- `meat_container` and `enemy_parts_data` are padded to 16 slots; skip all-zero groups and slots whose `extractive_type` is `None`.
- `move_power_max` is `max(atk_colliders[].data.base_damage)`. The sibling `power` field is a knockback tier, not damage.
- `enrage_trigger` is `anger_data.data_info[k].val` with four rank entries; use index 1 (High Rank) and record that in the unit.

**Test asserts** (drive `deriveRise` with hand-built fixtures):
- A monster with `preset_type` 0 and an own poison limit of 180 resolves to the preset's 150, not 180.
- A monster with `preset_type` equal to the preset list length uses its own value.
- Rathian's verified figures: `base_hp` 4500, `size_base` 1754.37, `enrage_attack_mult` 1.2, `enrage_speed_mult` 1.08, `enrage_duration` 80, `head_stagger` 290, `tolerance_stun` 110.
- `em_type.Em` decomposes to the right `id` and `sub_id` for a sub-id monster such as Risen Teostra (27, 8).
- `move_power_max` prefers `base_damage` over `power` when they disagree.

**Expected coverage:** 73 roster monsters (the source has 78; the extras are Rathalos, Rathian, Mizutsune, Gore Magala and Seregios, whose newest game is Wilds), all 14 inputs, about 1020 rows.

**Commit:** `feat(mhstats): Rise extractor (mhrice dump with preset-resolved tolerances)`

---

### Task 5: World extractor (49 monsters)

**Files:**
- Create: `tools/mhstats/sources/world.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)`, `parseKiranico(html)` and `parsePoedb(html)`.

**Inputs emitted:** all 14.

**Sources:** Kiranico World for everything but base size, poedb for base size and as a cross-check. The mhw-db JSON API holds no numeric stats and is not used.

**Gotchas that will bite:**
- **Never derive base size by dividing the gold crown by 1.23.** Crown thresholds are per-monster: Rathalos is 90/115/123 percent but Acidic Glavenus is 90/110/120, and the 1.23 assumption puts it 58 cm out. Read `Base:` from poedb, and cross-check against the percent poedb prints next to the gold figure.
- poedb pages are missing whole cards for some monsters. Acidic Glavenus has no `Monster Damage` card at all, and an unguarded parse throws and takes that monster's HP, size, enrage and tolerances down with it. Null-guard every table lookup.
- Kiranico monster URLs carry a 5-character hash that cannot be derived from the name. Take hrefs from the index, slicing between the `Large Monsters` and `Small Monsters` headers to get exactly 71.
- The Physiology table mixes Master Rank override rows into the same table, marked by an `ib_icon.png` image before the part name. It also carries state variants such as `Head (White)`, which is where Nergigante's max of 90 comes from while its plain head is 45. Decide in one place whether the max includes state rows, and record the choice in the unit.
- Kiranico's element columns are Fire, Water, Thunder, Ice, Dragon, where the icon filenames run `element_1`, `element_2`, `element_4`, `element_3`, `element_5`. Thunder and Ice are not in filename order. This matters only if element hitzones are ever added.
- A blank Ailments cell means immune. Emit no row rather than a zero.
- The Ailments table's `Stun` row is the tolerance. The Physiology table's `Stun` column is hitzone susceptibility. They are different numbers.
- `move_power_max` comes from Kiranico's Monster Attacks table, taking the max over all rows since move names repeat across hitboxes. poedb lists only a subset and is unreliable for this.

**Test asserts** (run the parsers over two committed HTML fixtures, trimmed to the relevant tables):
- Rathalos: `base_hp` 3250, `size_base` 1704.22, `size_gold` 2096.19, enrage 1.10 / 1.10 / 650 / 100, `head_stagger` 240, tolerances 250 / 180 / 150 / 150, `move_power_max` 80.
- Acidic Glavenus: `size_base` 2372.44 with a gold of 2846.93, proving the parser did not assume 1.23; and a page with no Monster Damage card still yields its other inputs.
- A Physiology fixture containing an `ib_icon.png` row and a `Head (White)` row returns the documented max.
- A blank Poison cell emits no `tolerance_poison` row.

**Expected coverage:** 49 monsters, all 14 inputs, about 686 rows.

**Commit:** `feat(mhstats): World extractor (Kiranico + poedb base size)`

---

### Task 6: 4 Ultimate extractor (23 monsters)

**Files:**
- Create: `tools/mhstats/sources/mh4u.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)` and `deriveMh4u(jsVars)`.

**Inputs emitted:** all but `enrage_trigger` and `move_power_max`, neither of which exists for 4U in any source found.

**Source:** Kiranico 4U, where each page embeds `window.js_vars = {"monster":{...}}`. The visible tables are Angular templates and hold no data.

**Gotchas that will bite:**
- `crown_*`, `rage_mod_*` and `hp_mult_*` are strings, not numbers. A value of `'0.0'` means missing, not zero, and applies to 19 of the 83 large monsters, including every Apex variant and all three Fatalis forms.
- **Base size has no fixed divisor here either.** Compute all three candidates from the mini, silver and gold crowns; use the agreed value when they agree within 0.5 cm, otherwise take the mini crown divided by 0.90, which is the only formula consistent across base species. Variants share their base species' crowns, so let them inherit instead.
- Apex variants are stubs with empty `monsterbodyparts` and zeroed rage fields. Emit only their real inputs (`base_hp`, stagger, tolerances) and let inheritance fill the rest from the base species.
- `monster.link` sometimes contains `/index.php/`. Build URLs from the index slug instead.
- Hitzones come from `monsterbodyparts` filtered to `pivot.type === 'A'`. Even within type A, parenthetical state parts such as `Tail (Inflated)` inflate the max, so exclude them and record the rule.
- Status names are `Para` and `KO`, not Paralysis and Stun, and a value of 0 means immune.
- The slug `plum-d.hermitaur` contains a dot, and the display name is `Plum D.Hermitaur`. Alias it to the roster's `Plum Daimyo Hermitaur`.

**Test asserts:**
- Berserk Tetsucabra: `base_hp` 4200, `enrage_attack_mult` 1.3, `enrage_speed_mult` 1.2, `enrage_duration` 90, `head_stagger` 325, tolerances 100 / 200 / 150 / 200.
- A fixture with `crown_king: '0.0'` emits no size rows.
- A fixture with disagreeing crowns resolves through the mini-crown rule, not the gold-crown one.
- A `Tail (Inflated)` part at 78 does not become `hitzone_max_raw` when the head is 55.
- No `enrage_trigger` or `move_power_max` row is ever emitted.

**Expected coverage:** 23 monsters, 12 inputs, roughly 240 rows, with size rows missing for the crownless monsters.

**Commit:** `feat(mhstats): 4 Ultimate extractor (Kiranico js_vars)`

---

### Task 7: Generations Ultimate extractor (45 monsters)

**Files:**
- Create: `tools/mhstats/sources/mhgu.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)`, `queryMhguDb(db, name)` and `parseKiranicoGu(html)`.

**Inputs emitted:** `base_hp`, `size_base`, `size_gold`, `hitzone_max_raw`, `head_stagger` and the four tolerances. **All four enrage inputs are missing for GU in every source checked**, so Attack, Speed and Temper for these 45 monsters come entirely from inheritance or curation. That is the largest gap in the deck and is expected.

**Sources:** the gatheringhallstudios `mhgu.db` SQLite for HP, hitzones and tolerances, read with the `sql.js` already in `dependencies`; Kiranico GU HTML for size and head stagger, which the database does not carry.

**Gotchas that will bite:**
- The database and Kiranico disagree on hitzones for multi-state monsters. For Agnaktor the database's `(Cool)` rows are a flat 15/15/15 placeholder while Kiranico shows 20/20/15. Prefer Kiranico for raw hitzones, and define the head as the maximum over the monster's states, which both sources agree on.
- The database lacks Ahtal-Neset, so it has 93 rows where Kiranico has 94.
- Kiranico GU slugs are 5-hex hashes that must be scraped from the index.
- A stagger cell of `120 [320]` packs the stagger value and the sever threshold. Take the first number.
- Both Kiranico tables contain literal `NO DATA` rows, and part names differ across all three sources.
- Status labels are `Psn`, `Par`, `Sle` and `Dizzy` on Kiranico but `Poison`, `Para`, `Sleep` and `KO` in the database. The database has no status rows at all for Lao-Shan Lung or Fatalis.
- Kiranico GU carries no explicit base HP, only per-quest totals, so HP must come from the database.

**Test asserts:**
- Agnaktor: `base_hp` 4600, `size_base` 2737.31, `size_gold` 3366.89, `head_stagger` 200, tolerances 180 / 180 / 180 / 200.
- A multi-state fixture returns the same head value from both the database and the Kiranico path.
- A `NO DATA` row is skipped rather than parsed as a part.
- No enrage row is emitted for any monster.

**Expected coverage:** 45 monsters, 9 inputs, about 405 rows.

**Commit:** `feat(mhstats): Generations Ultimate extractor (sqlite + Kiranico GU)`

---

### Task 8: 3 Ultimate extractor (20 monsters)

**Files:**
- Create: `tools/mhstats/sources/mh3u.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)`, plus one parser per site.

**Inputs emitted:** `size_base`, `size_gold`, `enrage_attack_mult`, `enrage_speed_mult`, `enrage_duration`, `hitzone_max_raw`, `head_stagger` and the four tolerances. **`base_hp` does not exist for 3 Ultimate in any source checked**, including Kiranico, whose `base_hp` is null for all 74 of its monsters. All 20 of these monsters need HP from inheritance or curation. `enrage_trigger` and `move_power_max` are likewise absent.

**Sources:** the dbooga `mh3u.sqlite` for hitzones; `mh3g.trigwiki.jp` for tolerances; `mh3g.org` for the enrage figures; `monsterhunterwiki.org` MH3U pages for sizes. This is the messiest source in the pipeline and the one with the thinnest coverage.

**Gotchas that will bite:**
- Both Japanese sites have broken HTTPS. Use `http://` for `mh3g.trigwiki.jp` and `mh3g.org`, and decode `mh3g.org` as Shift_JIS with `new TextDecoder('shift_jis')`, which Node supports without a package.
- **Parse these tables by cell index with cheerio, not by flattened-text regex.** The skeptic found the tolerance regex silently running past a blank cell and capturing the next row's label as its own value. The value it returned happened to be right; the alignment was not.
- Monster identity across the three sites is by hand-maintained mapping: a trigwiki numeric page id, an mh3g.org romaji filename, and a Japanese name. The card lists all 20.
- The size regex must tolerate `≤ - cm`, with a space, which is what a fixed-size monster renders. Map `-` to null so that a non-match is a real parse failure rather than an expected absence.
- `monster_damage` uses `-1` for not-applicable and `-2` for unknown; filter negatives before taking a maximum. Dire Miralis has `-2` in every shot column.
- The Jhen Mohran pair has no head part at all; its parts are named for fangs and mouth.
- The enrage multiplier prefix is either a full-width or an ASCII letter x depending on the page, and Jhen Mohran's duration cell is a question mark.
- Expected coverage by input: enrage 15 of 20, stagger 15, tolerances 13, size 15. The extractor prints this table and does not treat a gap as failure.

**Test asserts:**
- Gigginox: `size_base` 1092, `size_gold` 1266.72, `enrage_attack_mult` 1.2, `enrage_speed_mult` 1.1, `enrage_duration` 80, `head_stagger` 250, tolerances 240 / 180 / 200 / 180.
- A tolerance fixture with a blank cell emits no row and does not capture the following row's label.
- A `≤ - cm` fixture emits no size rows, while a malformed one throws.
- A `monster_damage` fixture containing `-1` and `-2` excludes them from the maximum.
- No `base_hp` row is ever emitted.

**Expected coverage:** 20 monsters, 11 inputs, partial as tabulated above, roughly 150 rows.

**Commit:** `feat(mhstats): 3 Ultimate extractor (sqlite + three Japanese sites)`

---

### Task 9: Freedom Unite extractor (8 monsters)

**Files:**
- Create: `tools/mhstats/sources/mhfu.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:** Produces `extract(roster)` and `deriveMhfu(name, files)`.

**Inputs emitted:** `base_hp`, `size_base`, `size_gold`, `enrage_attack_mult`, `hitzone_max_raw`, `head_stagger` and the four tolerances. The source has no speed, trigger, duration or move data.

**Source:** seven JSON files from `Kolyn090/mhfu-db`, pinned to commit `394b2f99a9d56c83153d9dc045e207334bbd1095` so the deck is reproducible.

**Gotchas that will bite:**
- **Every lookup must be optional-chained.** Coverage is uneven: 49 of 60 monsters have size, 53 have tolerances, 49 have stagger. A literal copy of the card's locator expressions throws on 11 of the 60. Of the 8 roster monsters here, only Copper Blangonga and Hypnocatrice have size data at all, and Ashen Lao-Shan Lung has neither size nor tolerances.
- `base_hp` is the minimum non-null `appear[].health`, since the file records per-quest values rather than a base. Filter the nulls first; several entries have them.
- Excluding conditional parts from the hitzone maximum needs a name list, not a hyphen check. Ashen Lao-Shan Lung's `internal` part sits at 90 and contains no hyphen, so a hyphen filter leaves it in and returns 90 against a real external maximum of 55. Exclude `internal` and `inside-shell` by name, and decide explicitly about Yama Tsukami's `eyes` at 90.
- Keys are kebab-case, hitzone keys are `slash`, `strike` and `shooting`, and status types are `poison`, `paralyze`, `sleep` and `knockout`. Gold Rathian additionally carries `-G` suffixed rows that an exact type match skips correctly.
- Aliases: the files spell two roster names as `Terra S.Ceanataur` and `Plum D.Hermitaur`.
- The repository's `Attributions.txt` requires crediting Kolyn090, Gustavo Augustini and MHP2G@Wiki. Add them to the credits file in the images task.

**Test asserts:**
- Copper Blangonga: `base_hp` 3230 from an `appear` array whose first entry is 6460, `size_base` 860, `size_gold` 1186.8, `enrage_attack_mult` 1.4, `head_stagger` 350, tolerances 200 / 150 / 150 / 100.
- A monster absent from `size.json` and `status-effectiveness.json` emits no rows for those inputs and does not throw.
- A parts fixture containing `internal` at 90 returns 55.
- The two aliases resolve.

**Expected coverage:** 8 monsters, 10 inputs, partial, roughly 60 rows.

**Commit:** `feat(mhstats): Freedom Unite extractor (mhfu-db, pinned commit)`

---

### Task 10: Merge and inheritance

**Files:**
- Create: `tools/mhstats/merge.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:**
- Consumes: `readObservations`, `MAINLINE_GAMES`, `GAME_SOURCE` from earlier tasks.
- Produces: `resolveInputs(observations, roster) => Map<id, {input: {value, game, source}}>`, `baseSpeciesOf(id, roster) => id|null`, `applyInheritance(resolved, roster) => { resolved, inherited }`.

Merge resolves raw inputs only. Stats are computed in Task 11, because Temper combines two inputs that must be normalised before they can be blended.

- [ ] **Step 1: Write the failing test**

```js
import { resolveInputs, baseSpeciesOf, applyInheritance } from '../tools/mhstats/merge.js';

const R = [
  { id: 'rathalos', name: 'Rathalos', latest: 'MHWilds', games: ['MH1', 'MHWorld', 'MHWilds'] },
  { id: 'azure-rathalos', name: 'Azure Rathalos', latest: 'MHWorld', games: ['MHWorld'] },
  { id: 'great-jagras', name: 'Great Jagras', latest: 'MHWorld', games: ['MHWorld'] },
  { id: 'ashen-lao-shan-lung', name: 'Ashen Lao-Shan Lung', latest: 'MHFU', games: ['MHFU'] },
  { id: 'lao-shan-lung', name: 'Lao-Shan Lung', latest: 'MHGU', games: ['MHGU'] },
];
const o = (monster, game, input, value) => ({ monster, game, input, value, unit: 'x', source: 's' });

describe('mhstats merge', () => {
  it('takes the newest game that records each input, per input', () => {
    const r = resolveInputs([
      o('rathalos', 'MHWorld', 'base_hp', 3250),
      o('rathalos', 'MHWilds', 'base_hp', 4500),
      o('rathalos', 'MHWorld', 'move_power_max', 80),
    ], R);
    expect(r.get('rathalos').base_hp).toMatchObject({ value: 4500, game: 'MHWilds' });
    // Wilds has no move table, so Attack's tie-break falls back to the newest game that does.
    expect(r.get('rathalos').move_power_max).toMatchObject({ value: 80, game: 'MHWorld' });
  });

  it('ignores observations for monsters outside the roster', () => {
    const r = resolveInputs([o('kestodon', 'MHWorld', 'base_hp', 1)], R);
    expect(r.has('kestodon')).toBe(false);
  });

  it('finds the base species by longest trailing name match', () => {
    expect(baseSpeciesOf('azure-rathalos', R)).toBe('rathalos');
    expect(baseSpeciesOf('ashen-lao-shan-lung', R)).toBe('lao-shan-lung');
    expect(baseSpeciesOf('rathalos', R)).toBeNull();
    expect(baseSpeciesOf('great-jagras', R)).toBeNull();
  });

  it('inherits a missing input from the base species, keeping the base game', () => {
    const resolved = resolveInputs([
      o('rathalos', 'MHWilds', 'enrage_trigger', 1500),
      o('azure-rathalos', 'MHWorld', 'base_hp', 4000),
    ], R);
    const { resolved: out, inherited } = applyInheritance(resolved, R);
    expect(out.get('azure-rathalos').enrage_trigger).toMatchObject({ value: 1500, game: 'MHWilds', from: 'rathalos' });
    expect(out.get('azure-rathalos').base_hp.value).toBe(4000); // its own value is not overwritten
    expect(inherited).toContainEqual({ id: 'azure-rathalos', input: 'enrage_trigger', from: 'rathalos' });
  });

  it('does not chain inheritance through a variant', () => {
    const resolved = resolveInputs([o('rathalos', 'MHWilds', 'base_hp', 4500)], R);
    const { resolved: out } = applyInheritance(resolved, R);
    expect(out.get('azure-rathalos')?.base_hp).toMatchObject({ from: 'rathalos' });
    expect(out.get('ashen-lao-shan-lung')?.base_hp).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: FAIL, cannot find module `../tools/mhstats/merge.js`.

- [ ] **Step 3: Write `tools/mhstats/merge.js`**

```js
// Merge: one value per (monster, raw input), taken from the newest mainline game
// that records it. Then fill variant gaps from the base species.
import { MAINLINE_GAMES } from './roster.js';

const gameRank = new Map(MAINLINE_GAMES.map((g, i) => [g, i]));

export function resolveInputs(observations, roster) {
  const ids = new Set(roster.map(r => r.id));
  const out = new Map();
  for (const row of observations) {
    if (!ids.has(row.monster)) continue;
    if (!out.has(row.monster)) out.set(row.monster, {});
    const bucket = out.get(row.monster);
    const prev = bucket[row.input];
    const rank = gameRank.get(row.game) ?? -1;
    if (!prev || rank > (gameRank.get(prev.game) ?? -1)) {
      bucket[row.input] = { value: row.value, game: row.game, source: row.source };
    }
  }
  return out;
}

// A variant's name ends with its base species' name: "Azure Rathalos" -> "Rathalos",
// "Ashen Lao-Shan Lung" -> "Lao-Shan Lung". Longest match wins, and a monster is
// never its own base.
export function baseSpeciesOf(id, roster) {
  const self = roster.find(r => r.id === id);
  if (!self) return null;
  let best = null;
  for (const other of roster) {
    if (other.id === id) continue;
    if (!self.name.endsWith(other.name)) continue;
    const boundary = self.name[self.name.length - other.name.length - 1];
    if (boundary !== ' ') continue;
    if (!best || other.name.length > best.name.length) best = other;
  }
  return best ? best.id : null;
}

export function applyInheritance(resolved, roster) {
  const inherited = [];
  const out = new Map([...resolved].map(([k, v]) => [k, { ...v }]));
  for (const entry of roster) {
    const baseId = baseSpeciesOf(entry.id, roster);
    if (!baseId) continue;
    // Read the base from the ORIGINAL map so inheritance never chains through
    // another variant's inherited value.
    const base = resolved.get(baseId);
    if (!base) continue;
    const mine = out.get(entry.id) ?? {};
    for (const [input, val] of Object.entries(base)) {
      if (mine[input]) continue;
      mine[input] = { ...val, from: baseId };
      inherited.push({ id: entry.id, input, from: baseId });
    }
    out.set(entry.id, mine);
  }
  return { resolved: out, inherited };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: PASS, including the five merge tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tools/mhstats/merge.js tests/mhstats-pipeline.test.js
/usr/bin/git commit -m "feat(mhstats): merge observations and inherit from base species"
```

---

### Task 11: Scaling

**Files:**
- Create: `tools/mhstats/scale.js`
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:**
- Produces: `STAT_MAX` (300), `STAT_DEFS` (the seven stats with their inputs and flags), `normalise(entries, opts) => Map<id, number>` returning 0..1, `computeStats(resolved) => Map<id, {hp, atk, def, spd, wil, siz, tmp}>`.

Normalisation runs **per game**, because a Freedom Unite HP of 3230 and a Wilds HP of 4500 are not on the same scale. Defense inverts, because a low hitzone means a tough monster. HP and Size use log10, because their raw ranges span an order of magnitude and the siege monsters would otherwise flatten everyone else.

- [ ] **Step 1: Write the failing test**

```js
import { STAT_MAX, normalise, computeStats } from '../tools/mhstats/scale.js';

const e = (id, game, value) => ({ id, game, value });

describe('mhstats scale', () => {
  it('uses a 300-point scale', () => {
    expect(STAT_MAX).toBe(300);
  });

  it('normalises within a game, not across games', () => {
    const n = normalise([e('a', 'MHFU', 1000), e('b', 'MHFU', 2000), e('c', 'MHWilds', 4000), e('d', 'MHWilds', 8000)], {});
    expect(n.get('a')).toBeCloseTo(0);
    expect(n.get('b')).toBeCloseTo(1);
    expect(n.get('c')).toBeCloseTo(0);
    expect(n.get('d')).toBeCloseTo(1);
  });

  it('inverts when asked, so a low hitzone scores high', () => {
    const n = normalise([e('soft', 'MHRise', 90), e('tough', 'MHRise', 20)], { invert: true });
    expect(n.get('tough')).toBeGreaterThan(n.get('soft'));
  });

  it('clips outliers at the 2nd and 98th percentile', () => {
    const entries = Array.from({ length: 50 }, (_, i) => e(`m${i}`, 'MHWorld', 100 + i));
    entries.push(e('siege', 'MHWorld', 100000));
    const n = normalise(entries, { log: true });
    // The siege monster is pinned to the top rather than compressing everyone else to zero.
    expect(n.get('siege')).toBeCloseTo(1);
    expect(n.get('m25')).toBeGreaterThan(0.2);
  });

  it('is single-valued when a game has one monster', () => {
    const n = normalise([e('only', 'MHFU', 42)], {});
    expect(n.get('only')).toBeCloseTo(0.5);
  });

  it('produces seven integer stats in 1..STAT_MAX', () => {
    const resolved = new Map([
      ['a', { base_hp: { value: 3000, game: 'MHRise' }, size_base: { value: 500, game: 'MHRise' },
        enrage_attack_mult: { value: 1.1, game: 'MHRise' }, enrage_speed_mult: { value: 1.0, game: 'MHRise' },
        hitzone_max_raw: { value: 80, game: 'MHRise' },
        tolerance_poison: { value: 100, game: 'MHRise' }, tolerance_paralysis: { value: 100, game: 'MHRise' },
        tolerance_sleep: { value: 100, game: 'MHRise' }, tolerance_stun: { value: 100, game: 'MHRise' },
        enrage_trigger: { value: 500, game: 'MHRise' }, enrage_duration: { value: 60, game: 'MHRise' } }],
      ['b', { base_hp: { value: 9000, game: 'MHRise' }, size_base: { value: 4000, game: 'MHRise' },
        enrage_attack_mult: { value: 1.4, game: 'MHRise' }, enrage_speed_mult: { value: 1.3, game: 'MHRise' },
        hitzone_max_raw: { value: 30, game: 'MHRise' },
        tolerance_poison: { value: 300, game: 'MHRise' }, tolerance_paralysis: { value: 300, game: 'MHRise' },
        tolerance_sleep: { value: 300, game: 'MHRise' }, tolerance_stun: { value: 300, game: 'MHRise' },
        enrage_trigger: { value: 2000, game: 'MHRise' }, enrage_duration: { value: 180, game: 'MHRise' } }],
    ]);
    const stats = computeStats(resolved);
    for (const s of stats.values()) {
      expect(Object.keys(s).sort()).toEqual(['atk', 'def', 'hp', 'siz', 'spd', 'tmp', 'wil']);
      for (const v of Object.values(s)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(STAT_MAX);
      }
    }
    expect(stats.get('b').hp).toBeGreaterThan(stats.get('a').hp);
    expect(stats.get('b').def).toBeGreaterThan(stats.get('a').def); // lower hitzone is tougher
    expect(stats.get('a').tmp).toBeGreaterThan(stats.get('b').tmp); // snaps sooner
  });

  it('omits a stat whose inputs are all missing', () => {
    const stats = computeStats(new Map([['a', { base_hp: { value: 3000, game: 'MHGU' } }]]));
    expect(stats.get('a').hp).toBeDefined();
    expect(stats.get('a').atk).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: FAIL, cannot find module `../tools/mhstats/scale.js`.

- [ ] **Step 3: Write `tools/mhstats/scale.js`**

```js
// Scaling: raw game values to a shared 1..300 character sheet.
// Normalisation is per game, because an MHFU HP and a Wilds HP are different units.

export const STAT_MAX = 300;

// Each stat names the inputs it needs and how they behave.
// invert: a lower raw value means a higher stat (a small hitzone is a tough monster).
// log:    the raw range spans an order of magnitude.
export const STAT_DEFS = [
  { key: 'hp', label: 'HP', parts: [{ input: 'base_hp', log: true }] },
  { key: 'atk', label: 'Attack', parts: [{ input: 'enrage_attack_mult' }] },
  { key: 'def', label: 'Defense', parts: [{ input: 'hitzone_max_raw', invert: true }] },
  { key: 'spd', label: 'Speed', parts: [{ input: 'enrage_speed_mult' }] },
  { key: 'wil', label: 'Will', parts: [{ input: 'tolerance_sum' }] },
  { key: 'siz', label: 'Size', parts: [{ input: 'size_base', log: true }] },
  { key: 'tmp', label: 'Temper', parts: [{ input: 'enrage_trigger', invert: true, log: true }, { input: 'enrage_duration' }] },
];

function quantile(sorted, q) {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// entries: [{ id, game, value }]. Returns Map<id, 0..1>.
export function normalise(entries, { log = false, invert = false } = {}) {
  const out = new Map();
  const byGame = new Map();
  for (const e of entries) {
    if (!byGame.has(e.game)) byGame.set(e.game, []);
    byGame.get(e.game).push(e);
  }
  for (const group of byGame.values()) {
    const xs = group.map(e => (log ? Math.log10(Math.max(e.value, 1)) : e.value));
    const sorted = xs.slice().sort((a, b) => a - b);
    const lo = quantile(sorted, 0.02);
    const hi = quantile(sorted, 0.98);
    for (let i = 0; i < group.length; i++) {
      let t = hi === lo ? 0.5 : (xs[i] - lo) / (hi - lo);
      t = Math.min(1, Math.max(0, t));
      out.set(group[i].id, invert ? 1 - t : t);
    }
  }
  return out;
}

// Some stats are built from inputs that must be combined before scaling.
function derivedInputs(inputs) {
  const tol = ['tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun']
    .map(k => inputs[k]).filter(Boolean);
  if (!tol.length) return inputs;
  return {
    ...inputs,
    tolerance_sum: { value: tol.reduce((s, t) => s + t.value, 0), game: tol[0].game },
  };
}

export function computeStats(resolved) {
  const prepared = new Map([...resolved].map(([id, inputs]) => [id, derivedInputs(inputs)]));

  // Normalise every part of every stat once, across the whole deck.
  const normalised = new Map();
  for (const def of STAT_DEFS) {
    for (const part of def.parts) {
      const entries = [];
      for (const [id, inputs] of prepared) {
        const got = inputs[part.input];
        if (got) entries.push({ id, game: got.game, value: got.value });
      }
      normalised.set(part.input, normalise(entries, part));
    }
  }

  const out = new Map();
  for (const [id] of prepared) {
    const stats = {};
    for (const def of STAT_DEFS) {
      const vals = def.parts.map(p => normalised.get(p.input).get(id)).filter(v => v !== undefined);
      if (!vals.length) continue; // missing everywhere: inheritance or curation fills it
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      stats[def.key] = 1 + Math.round(mean * (STAT_MAX - 1));
    }
    out.set(id, stats);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: PASS, including the seven scale tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tools/mhstats/scale.js tests/mhstats-pipeline.test.js
/usr/bin/git commit -m "feat(mhstats): per-game normalisation to a 300-point scale"
```

---

### Task 12: Refinement

**Files:**
- Create: `tools/mhstats/refine.js`
- Create: `tools/mhstats/data/refinement.json` (starts as `[]`)
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:**
- Produces: `tieGroups(stats, statKey) => [{ anchor, prev, next, ids, bounds: {lo, hi} }]`, `bandBounds(anchor, prev, next)`, `applyRefinement(stats, refinements) => { stats, applied }`.

This implements spec 3.4. Scaling leaves 34 of 78 Rise monsters sharing one Attack value, measured on 2026-09-18. Refinement ranks each such group inside its own band. The band rule is enforced in code, so a bad ranking file throws instead of quietly reshaping the deck.

- [ ] **Step 1: Write the failing test**

```js
import { tieGroups, bandBounds, applyRefinement } from '../tools/mhstats/refine.js';

const S = new Map([
  ['a', { atk: 100 }], ['b', { atk: 100 }], ['c', { atk: 100 }],
  ['d', { atk: 200 }], ['e', { atk: 50 }],
]);

describe('mhstats refine', () => {
  it('finds groups of monsters the sources tied, with their neighbouring anchors', () => {
    const groups = tieGroups(S, 'atk');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ anchor: 100, prev: 50, next: 200 });
    expect(groups[0].ids.sort()).toEqual(['a', 'b', 'c']);
  });

  it('bounds a band at 40 percent of the gap to each neighbour', () => {
    expect(bandBounds(100, 50, 200)).toEqual({ lo: 80, hi: 140 });
  });

  it('uses the scale end where a band has no neighbour on one side', () => {
    expect(bandBounds(50, null, 100).lo).toBe(1);
    expect(bandBounds(200, 100, null).hi).toBe(300);
  });

  it('spreads a ranked group across its band in rank order', () => {
    const { stats } = applyRefinement(S, [
      { id: 'b', stat: 'atk', rank: 1, reason: 'hits hardest of the three' },
      { id: 'a', stat: 'atk', rank: 2, reason: 'middling' },
      { id: 'c', stat: 'atk', rank: 3, reason: 'weakest of the three' },
    ]);
    expect(stats.get('b').atk).toBeGreaterThan(stats.get('a').atk);
    expect(stats.get('a').atk).toBeGreaterThan(stats.get('c').atk);
    for (const id of ['a', 'b', 'c']) {
      expect(stats.get(id).atk).toBeGreaterThanOrEqual(80);
      expect(stats.get(id).atk).toBeLessThanOrEqual(140);
    }
  });

  it('never lets a refined monster reach a neighbouring anchor', () => {
    const { stats } = applyRefinement(S, [
      { id: 'b', stat: 'atk', rank: 1, reason: 'x' },
      { id: 'a', stat: 'atk', rank: 2, reason: 'x' },
      { id: 'c', stat: 'atk', rank: 3, reason: 'x' },
    ]);
    for (const id of ['a', 'b', 'c']) {
      expect(stats.get(id).atk).toBeLessThan(200);
      expect(stats.get(id).atk).toBeGreaterThan(50);
    }
  });

  it('refuses to refine a monster the sources did not tie', () => {
    expect(() => applyRefinement(S, [{ id: 'd', stat: 'atk', rank: 1, reason: 'x' }]))
      .toThrow(/not in a tie group/);
  });

  it('refuses a partial or a duplicate ranking', () => {
    expect(() => applyRefinement(S, [{ id: 'a', stat: 'atk', rank: 1, reason: 'x' }]))
      .toThrow(/ranks all|incomplete/i);
    expect(() => applyRefinement(S, [
      { id: 'a', stat: 'atk', rank: 1, reason: 'x' }, { id: 'b', stat: 'atk', rank: 1, reason: 'x' },
      { id: 'c', stat: 'atk', rank: 3, reason: 'x' },
    ])).toThrow(/rank/);
  });

  it('requires a reason on every entry', () => {
    expect(() => applyRefinement(S, [
      { id: 'a', stat: 'atk', rank: 1 }, { id: 'b', stat: 'atk', rank: 2, reason: 'x' },
      { id: 'c', stat: 'atk', rank: 3, reason: 'x' },
    ])).toThrow(/reason/);
  });

  it('leaves everything untouched when the refinement file is empty', () => {
    const { stats, applied } = applyRefinement(S, []);
    expect(applied).toBe(0);
    expect(stats.get('a').atk).toBe(100);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: FAIL, cannot find module `../tools/mhstats/refine.js`.

- [ ] **Step 3: Write `tools/mhstats/refine.js`**

```js
// Refinement (spec 3.4): the data sets the bands, judgement orders within them.
// A refined monster may pass a monster the sources tied it with, and may never
// pass one the sources placed above it.
import { STAT_MAX } from './scale.js';

const BAND_FRACTION = 0.4;

export function bandBounds(anchor, prev, next) {
  const lo = prev === null || prev === undefined ? 1 : Math.round(anchor - BAND_FRACTION * (anchor - prev));
  const hi = next === null || next === undefined ? STAT_MAX : Math.round(anchor + BAND_FRACTION * (next - anchor));
  return { lo, hi };
}

export function tieGroups(stats, statKey) {
  const byValue = new Map();
  for (const [id, s] of stats) {
    const v = s[statKey];
    if (v === undefined) continue;
    if (!byValue.has(v)) byValue.set(v, []);
    byValue.get(v).push(id);
  }
  const anchors = [...byValue.keys()].sort((a, b) => a - b);
  const groups = [];
  for (let i = 0; i < anchors.length; i++) {
    const ids = byValue.get(anchors[i]);
    if (ids.length < 2) continue;
    const prev = i > 0 ? anchors[i - 1] : null;
    const next = i < anchors.length - 1 ? anchors[i + 1] : null;
    groups.push({ anchor: anchors[i], prev, next, ids, bounds: bandBounds(anchors[i], prev, next) });
  }
  return groups;
}

export function applyRefinement(stats, refinements) {
  const out = new Map([...stats].map(([k, v]) => [k, { ...v }]));
  if (!refinements.length) return { stats: out, applied: 0 };

  for (const r of refinements) {
    if (!r.reason) throw new Error(`refinement ${r.id}/${r.stat} needs a reason`);
  }

  const byStat = new Map();
  for (const r of refinements) {
    if (!byStat.has(r.stat)) byStat.set(r.stat, []);
    byStat.get(r.stat).push(r);
  }

  let applied = 0;
  for (const [statKey, entries] of byStat) {
    const groups = tieGroups(stats, statKey);
    const groupOf = new Map();
    for (const g of groups) for (const id of g.ids) groupOf.set(id, g);

    const byGroup = new Map();
    for (const r of entries) {
      const g = groupOf.get(r.id);
      if (!g) throw new Error(`${r.id} is not in a tie group for ${statKey}; refinement may not reorder what the sources separated`);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(r);
    }

    for (const [g, rs] of byGroup) {
      if (rs.length !== g.ids.length) {
        throw new Error(`refinement for ${statKey} at ${g.anchor} ranks ${rs.length} of ${g.ids.length} monsters; a partial ranking is incomplete`);
      }
      const ranks = rs.map(r => r.rank).sort((a, b) => a - b);
      const expected = rs.map((_, i) => i + 1);
      if (JSON.stringify(ranks) !== JSON.stringify(expected)) {
        throw new Error(`refinement for ${statKey} at ${g.anchor} needs ranks 1..${rs.length} with no duplicates`);
      }
      // Rank 1 is the strongest, so it sits at the top of the band.
      const ordered = rs.slice().sort((a, b) => a.rank - b.rank);
      const { lo, hi } = g.bounds;
      const step = ordered.length === 1 ? 0 : (hi - lo) / (ordered.length - 1);
      ordered.forEach((r, i) => {
        const value = Math.round(hi - i * step);
        out.get(r.id)[statKey] = Math.min(hi, Math.max(lo, value));
        applied++;
      });
    }
  }
  return { stats: out, applied };
}
```

- [ ] **Step 4: Create the empty refinement file**

`tools/mhstats/data/refinement.json`:

```json
[]
```

The rankings are authored in Task 16, after the deck first builds and the real tie groups are visible. The pipeline must work with this file empty.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: PASS, including the nine refine tests.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/mhstats/refine.js tools/mhstats/data/refinement.json tests/mhstats-pipeline.test.js
/usr/bin/git commit -m "feat(mhstats): band-bounded refinement of tied monsters"
```

---

### Task 13: Curation and validation

**Files:**
- Create: `tools/mhstats/curate.js`
- Create: `tools/mhstats/data/curation.json` (starts as `[]`)
- Test: `tests/mhstats-pipeline.test.js` (append)

**Interfaces:**
- Produces: `applyCuration(stats, curation, roster) => { stats, applied }`, `findGaps(stats, roster) => [{ id, stat }]`, `writeReport({ inherited, refinements, curation, gaps }) => string`.

Curation is the last resort, for stats no source and no base species can supply. The known population is Attack, Speed and Temper for the 45 Generations Ultimate monsters, HP for the 20 from 3 Ultimate, and Speed, Temper and duration for the 8 from Freedom Unite, minus whatever inheritance already filled.

- [ ] **Step 1: Write the failing test**

```js
import { applyCuration, findGaps, writeReport } from '../tools/mhstats/curate.js';

const roster = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];

describe('mhstats curate', () => {
  it('reports every monster-stat pair that no source filled', () => {
    const stats = new Map([['a', { hp: 100, atk: 50, def: 1, spd: 1, wil: 1, siz: 1, tmp: 1 }], ['b', { hp: 100 }]]);
    const gaps = findGaps(stats, roster);
    expect(gaps).toContainEqual({ id: 'b', stat: 'atk' });
    expect(gaps).not.toContainEqual({ id: 'a', stat: 'atk' });
    expect(gaps).toHaveLength(6);
  });

  it('fills a gap from the overlay', () => {
    const stats = new Map([['b', { hp: 100 }]]);
    const { stats: out, applied } = applyCuration(stats, [
      { id: 'b', stat: 'atk', value: 150, reason: 'GU records no enrage data; sits between its Rise and 4U appearances' },
    ], roster);
    expect(out.get('b').atk).toBe(150);
    expect(applied).toBe(1);
  });

  it('rejects an unknown monster, an unknown stat, an out-of-range value or a missing reason', () => {
    const stats = new Map([['b', { hp: 100 }]]);
    const bad = [
      [{ id: 'ghost', stat: 'atk', value: 1, reason: 'x' }, /unknown monster/],
      [{ id: 'b', stat: 'charisma', value: 1, reason: 'x' }, /unknown stat/],
      [{ id: 'b', stat: 'atk', value: 0, reason: 'x' }, /range/],
      [{ id: 'b', stat: 'atk', value: 301, reason: 'x' }, /range/],
      [{ id: 'b', stat: 'atk', value: 150 }, /reason/],
    ];
    for (const [entry, msg] of bad) expect(() => applyCuration(stats, [entry], roster)).toThrow(msg);
  });

  it('refuses to overwrite a value a source already supplied', () => {
    const stats = new Map([['a', { hp: 100 }]]);
    expect(() => applyCuration(stats, [{ id: 'a', stat: 'hp', value: 200, reason: 'x' }], roster))
      .toThrow(/already has/);
  });

  it('writes a report listing every non-source value in one place', () => {
    const md = writeReport({
      inherited: [{ id: 'azure-rathalos', input: 'enrage_trigger', from: 'rathalos' }],
      refinements: [{ id: 'a', stat: 'atk', rank: 1, reason: 'hits hardest' }],
      curation: [{ id: 'b', stat: 'atk', value: 150, reason: 'no GU enrage data' }],
      gaps: [],
    });
    expect(md).toContain('azure-rathalos');
    expect(md).toContain('hits hardest');
    expect(md).toContain('no GU enrage data');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: FAIL, cannot find module `../tools/mhstats/curate.js`.

- [ ] **Step 3: Write `tools/mhstats/curate.js`**

```js
// Curation: the last resort, for stats no source and no base species supplies.
// It may only fill a hole, never overwrite a number that came from a game.
import { STAT_DEFS, STAT_MAX } from './scale.js';

const KEYS = STAT_DEFS.map(d => d.key);
const LABEL = Object.fromEntries(STAT_DEFS.map(d => [d.key, d.label]));

export function findGaps(stats, roster) {
  const gaps = [];
  for (const entry of roster) {
    const s = stats.get(entry.id) ?? {};
    for (const key of KEYS) if (s[key] === undefined) gaps.push({ id: entry.id, stat: key });
  }
  return gaps;
}

export function applyCuration(stats, curation, roster) {
  const ids = new Set(roster.map(r => r.id));
  const out = new Map([...stats].map(([k, v]) => [k, { ...v }]));
  let applied = 0;
  for (const c of curation) {
    if (!ids.has(c.id)) throw new Error(`curation names unknown monster ${c.id}`);
    if (!KEYS.includes(c.stat)) throw new Error(`curation names unknown stat ${c.stat}`);
    if (!Number.isInteger(c.value) || c.value < 1 || c.value > STAT_MAX) {
      throw new Error(`curation ${c.id}/${c.stat}: value ${c.value} is outside the range 1..${STAT_MAX}`);
    }
    if (!c.reason) throw new Error(`curation ${c.id}/${c.stat} needs a reason`);
    const bucket = out.get(c.id) ?? {};
    if (bucket[c.stat] !== undefined) {
      throw new Error(`curation ${c.id}/${c.stat}: a source already has this value; curation may only fill gaps`);
    }
    bucket[c.stat] = c.value;
    out.set(c.id, bucket);
    applied++;
  }
  return { stats: out, applied };
}

export function writeReport({ inherited, refinements, curation, gaps }) {
  const lines = ['# MH Stats: every value that did not come straight from a source', ''];
  lines.push('Read this file to audit the deck. Anything not listed here is a game number.', '');

  lines.push(`## Inherited from a base species (${inherited.length})`, '');
  lines.push('| Monster | Input | Inherited from |', '|---|---|---|');
  for (const i of inherited) lines.push(`| ${i.id} | ${i.input} | ${i.from} |`);

  lines.push('', `## Refined within a band (${refinements.length})`, '');
  lines.push('The sources tied these monsters. Ranking orders them inside the band the data set;', 'none of them crosses a monster the data placed above it.', '');
  lines.push('| Monster | Stat | Rank | Reason |', '|---|---|---|---|');
  for (const r of refinements) lines.push(`| ${r.id} | ${LABEL[r.stat] ?? r.stat} | ${r.rank} | ${r.reason} |`);

  lines.push('', `## Hand-rated, no source (${curation.length})`, '');
  lines.push('| Monster | Stat | Value | Reason |', '|---|---|---|---|');
  for (const c of curation) lines.push(`| ${c.id} | ${LABEL[c.stat] ?? c.stat} | ${c.value} | ${c.reason} |`);

  if (gaps.length) {
    lines.push('', `## Still missing (${gaps.length}) — the build fails while this is non-empty`, '');
    for (const g of gaps) lines.push(`- ${g.id}: ${LABEL[g.stat] ?? g.stat}`);
  }
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: Create the empty overlay**

`tools/mhstats/data/curation.json`:

```json
[]
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/mhstats-pipeline.test.js`
Expected: PASS, including the five curate tests.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/mhstats/curate.js tools/mhstats/data/curation.json tests/mhstats-pipeline.test.js
/usr/bin/git commit -m "feat(mhstats): curation overlay, gap detection and audit report"
```

---

### Task 14: Images and credits

**Files:**
- Create: `tools/mhstats/images.js`
- Create: `public/mhstats/img/*.webp` (generated, committed)
- Create: `public/mhstats/credits.txt` (generated, committed)
- Modify: `package.json` (add `sharp` and `cheerio` to `devDependencies`)

**Interfaces:** Produces `fetchImages(roster)`, writing one webp per monster plus a manifest, and `writeCredits(roster, manifest)`.

**Sources:** `monsterhunterwiki.org` through the MediaWiki API, with `monsterhunter.fandom.com` as fallback.

**Gotchas that will bite:**
- Resolve a file title to a URL with `action=query&prop=imageinfo&iiprop=url|size|mime|sha1` and **`redirects=1`**. Renamed files, notably the Wilds renders, are wiki redirects, and the served URL uses a hashed path that cannot be built from the title.
- Batch up to 50 titles per API call. Nine calls cover the whole category.
- The Fandom CDN returns a Cloudflare challenge without a `Referer: https://monsterhunter.fandom.com/` header, whatever the user agent. Append `&format=original` or it transcodes to webp regardless of the Accept header.
- 10 renders are fan-made, flagged by transclusion of `Template:CustomRenderNotice`, and cover the five Guardian monsters plus Xu Wu among others. Detect them in the same API call with `prop=templates&tltemplates=Template:CustomRenderNotice`. Credit the wiki user by name in `credits.txt`, or drop the image and fall back to Fandom.
- Some images are 100 by 100 in-game icons rather than renders. Detect by a name containing `Icon` or a width below 300, and prefer the Fandom fallback for those.
- Anjanath has no image field on the wiki page and needs the Fandom fallback.
- Resize with `sharp(buf).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 })`. Transparency survives from both the palette PNGs and the newer webp sources.
- Skip a download when the cached file's sha1 matches the one the API reports.

**`credits.txt` must contain,** because the licences require it:
- That the game is fan-made and unaffiliated with Capcom, and that the monster renders are Capcom's copyright.
- Monster Hunter Wiki at monsterhunterwiki.org, CC BY-SA 4.0, with a link.
- The named wiki user behind each fan-made render that ships.
- For the Freedom Unite data, Kolyn090 and Gustavo Augustini and MHP2G@Wiki, as that repository's attribution file requires.
- The other data sources by name and URL: mhdb.io, robomeche's MHWilds-Database, MHRice, Kiranico, poedb, gatheringhallstudios, dbooga, mh3g.org and mh3g.trigwiki.jp.

- [ ] **Step 1: Add the dev dependencies**

```bash
npm install --save-dev sharp@0.35.4 cheerio
```

Confirm `sharp` resolved a prebuilt binary and did not invoke a compiler.

- [ ] **Step 2: Write `tools/mhstats/images.js`** against the `Images` card in the research file, handling every gotcha above.

- [ ] **Step 3: Run it and check the result**

Run: `node tools/mhstats/images.js`

Expected: 252 files under `public/mhstats/img/`, each under about 60 KB, totalling roughly 10 MB. The script prints any monster that fell back to Fandom, any that used a fan-made render, and any that produced no image at all. Report those lists rather than silently shipping a gap.

- [ ] **Step 4: Spot check four images visually** across eras, one each from the Freedom Unite, 3 Ultimate, Generations Ultimate and Wilds sets. Confirm each is a full-body render on transparency, not an icon or a screenshot.

- [ ] **Step 5: Commit the code and the images separately**

```bash
/usr/bin/git add package.json package-lock.json tools/mhstats/images.js
/usr/bin/git commit -m "feat(mhstats): fetch and resize monster renders, write credits"
/usr/bin/git add public/mhstats/img public/mhstats/credits.txt
/usr/bin/git commit -m "data(mhstats): monster renders and credits"
```

---

### Task 15: Build, deck validation and README

**Files:**
- Create: `tools/mhstats/build.js`
- Create: `tools/mhstats/README.md`
- Create: `public/mhstats/deck.json` (generated, committed)
- Create: `tests/mhstats-deck.test.js`

**Interfaces:** Produces `build()` running roster, extractors, merge, inheritance, scale, refine, curate, validate and write.

- [ ] **Step 1: Write `tools/mhstats/build.js`**

```js
// The whole chain. Every stage is pure except the extractors and the file writes,
// so a failure names the stage it came from.
import { writeFileSync } from 'fs';
import { readObservations, writeObservations } from './lib/observations.js';
import { buildRoster } from './roster.js';
import { resolveInputs, applyInheritance } from './merge.js';
import { computeStats, STAT_DEFS, STAT_MAX } from './scale.js';
import { applyRefinement } from './refine.js';
import { applyCuration, findGaps, writeReport } from './curate.js';

const DATA = new URL('./data/', import.meta.url).pathname;
const OUT = new URL('../../public/mhstats/', import.meta.url).pathname;

const SOURCES = ['wilds', 'rise', 'world', 'mh4u', 'mhgu', 'mh3u', 'mhfu'];

export async function build({ refresh = false } = {}) {
  const roster = refresh ? await buildRoster() : JSON.parse(await import('node:fs').then(fs => fs.promises.readFile(`${DATA}roster.json`, 'utf8')));

  let observations;
  if (refresh) {
    const rows = [];
    for (const name of SOURCES) {
      const mod = await import(`./sources/${name}.js`);
      const mine = roster.filter(r => r.source === name.replace('mh', '').toUpperCase() || r.source.toLowerCase() === name);
      const got = await mod.extract(mine);
      console.log(`${name}: ${got.length} observations for ${mine.length} monsters`);
      rows.push(...got);
    }
    observations = writeObservations(rows, `${DATA}observations.csv`);
  } else {
    observations = readObservations(`${DATA}observations.csv`);
  }

  const resolvedRaw = resolveInputs(observations, roster);
  const { resolved, inherited } = applyInheritance(resolvedRaw, roster);
  const scaled = computeStats(resolved);

  const refinements = JSON.parse(await import('node:fs').then(fs => fs.promises.readFile(`${DATA}refinement.json`, 'utf8')));
  const { stats: refined, applied: refinedCount } = applyRefinement(scaled, refinements);

  const curation = JSON.parse(await import('node:fs').then(fs => fs.promises.readFile(`${DATA}curation.json`, 'utf8')));
  const { stats: final } = applyCuration(refined, curation, roster);

  const gaps = findGaps(final, roster);
  writeFileSync(`${DATA}curation-report.md`, writeReport({ inherited, refinements, curation, gaps }));
  if (gaps.length) {
    throw new Error(`${gaps.length} monster-stat pairs have no value. See data/curation-report.md.`);
  }

  const inheritedSet = new Set(inherited.map(i => `${i.id}/${i.input}`));
  const curatedSet = new Set(curation.map(c => `${c.id}/${c.stat}`));

  const deck = {
    version: 1,
    built: process.env.MHSTATS_BUILT_AT ?? new Date().toISOString().slice(0, 10),
    statMax: STAT_MAX,
    stats: STAT_DEFS.map(d => ({ key: d.key, label: d.label })),
    monsters: roster.map(r => {
      const inputs = resolved.get(r.id) ?? {};
      const curated = STAT_DEFS.map(d => d.key).filter(k =>
        curatedSet.has(`${r.id}/${k}`) ||
        STAT_DEFS.find(d => d.key === k).parts.some(p => inheritedSet.has(`${r.id}/${p.input}`)));
      return {
        id: r.id,
        name: r.name,
        gen: r.debut,
        game: inputs.base_hp?.game ?? r.latest,
        img: `img/${r.id}.webp`,
        stats: final.get(r.id),
        raw: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, `${v.value} (${v.game})`])),
        curated,
      };
    }),
  };

  writeFileSync(`${OUT}deck.json`, `${JSON.stringify(deck, null, 1)}\n`);
  console.log(`deck: ${deck.monsters.length} monsters, ${refinedCount} refined, ${curation.length} curated, ${inherited.length} inherited`);
  return deck;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await build({ refresh: process.argv.includes('--refresh') });
}
```

- [ ] **Step 2: Write `tests/mhstats-deck.test.js`**

```js
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const deck = JSON.parse(readFileSync(new URL('../public/mhstats/deck.json', import.meta.url), 'utf8'));
const KEYS = ['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp'];

describe('mhstats deck', () => {
  it('holds the whole roster with unique ids', () => {
    expect(deck.monsters.length).toBe(252);
    expect(new Set(deck.monsters.map(m => m.id)).size).toBe(252);
  });

  it('declares the seven stats and the scale', () => {
    expect(deck.statMax).toBe(300);
    expect(deck.stats.map(s => s.key)).toEqual(KEYS);
  });

  it('gives every monster every stat as an integer in range', () => {
    for (const m of deck.monsters) {
      for (const k of KEYS) {
        expect(Number.isInteger(m.stats[k]), `${m.id}.${k}`).toBe(true);
        expect(m.stats[k], `${m.id}.${k}`).toBeGreaterThanOrEqual(1);
        expect(m.stats[k], `${m.id}.${k}`).toBeLessThanOrEqual(deck.statMax);
      }
    }
  });

  it('ships an image for every monster', () => {
    for (const m of deck.monsters) {
      const path = new URL(`../public/mhstats/${m.img}`, import.meta.url);
      expect(existsSync(path), `${m.id} image`).toBe(true);
    }
  });

  it('puts the owner-named anchors at the top of Will', () => {
    const ranked = deck.monsters.slice().sort((a, b) => b.stats.wil - a.stats.wil);
    const topDecile = new Set(ranked.slice(0, Math.ceil(ranked.length / 10)).map(m => m.id));
    for (const id of ['rajang', 'fatalis', 'diablos', 'deviljho']) {
      expect(topDecile.has(id), `${id} should be top-decile Will`).toBe(true);
    }
  });

  it('spreads each stat rather than clustering on one value', () => {
    for (const k of KEYS) {
      const counts = new Map();
      for (const m of deck.monsters) counts.set(m.stats[k], (counts.get(m.stats[k]) ?? 0) + 1);
      const biggest = Math.max(...counts.values());
      expect(biggest, `${k} has ${biggest} monsters on one value`).toBeLessThanOrEqual(25);
      expect(counts.size, `${k} distinct values`).toBeGreaterThanOrEqual(30);
    }
  });
});
```

The last test is the one that fails before Task 16 and passes after it. Attack currently clusters far above 25 monsters on a single value.

- [ ] **Step 3: Write `tools/mhstats/README.md`** covering: what each stage does, `node tools/mhstats/build.js` to rebuild from the committed observations, `--refresh` to re-fetch every source, that `data/curation-report.md` is the audit surface, and that `deck.json` must never be hand-edited.

- [ ] **Step 4: Run the build**

Run: `node --max-old-space-size=4096 tools/mhstats/build.js --refresh`

Expected: a per-source observation count matching the extractor tasks, then a gap list. The gap list will be non-empty on the first run and the build will fail. That is correct: fill the gaps in `curation.json` with reasons, then re-run until it writes the deck.

- [ ] **Step 5: Commit the code, then the data**

```bash
/usr/bin/git add tools/mhstats/build.js tools/mhstats/README.md tests/mhstats-deck.test.js
/usr/bin/git commit -m "feat(mhstats): deck build chain and deck validation tests"
/usr/bin/git add tools/mhstats/data public/mhstats/deck.json
/usr/bin/git commit -m "data(mhstats): observations, curation and the built deck"
```

---

### Task 16: Author the refinement rankings

**Files:**
- Modify: `tools/mhstats/data/refinement.json`
- Modify: `public/mhstats/deck.json` (rebuilt)

This is the judgement pass the owner asked for, and it is the last step because the real tie groups only exist once the deck builds.

- [ ] **Step 1: Print the tie groups**

Add a `--groups` flag to `build.js` that prints, per stat, each tie group with its anchor, its band bounds and its member names. Run it and read the output. Expect the largest groups on Attack and Speed, where the source multipliers are coarsest.

- [ ] **Step 2: Rank each group**

For each group, write one `refinement.json` entry per member: `{ id, stat, rank, reason }`, rank 1 being the strongest. Rank the whole group in a single judgement pass rather than by adjacent comparisons; ranking 34 monsters is one decision about an ordering, not 33 decisions about pairs.

The reason is a short clause a reader can argue with, naming the thing that justifies the position. For example, for Attack: `one-shots most hunters at High Rank; among the hardest hitters in its band`. Avoid reasons that restate the rank.

Work one stat at a time. Each stat is independent, so these are good candidates for parallel subagents on a cheaper model, with the ranking reviewed here before it is written.

- [ ] **Step 3: Walk the band boundaries once**

For each stat, list the monsters adjacent across each band edge, highest of one band against lowest of the next. Anything that reads clearly wrong is recorded as a line in the report's findings, **not** moved, because moving it would break the band rule. If a boundary looks wrong often, the stat's derivation is wrong and that is a spec change, not a refinement.

- [ ] **Step 4: Rebuild and verify**

Run: `node tools/mhstats/build.js` then `npx vitest run tests/mhstats-deck.test.js`

Expected: the clustering test now passes, with no stat having more than 25 monsters on a single value and every stat holding at least 30 distinct values.

- [ ] **Step 5: Read the report end to end**

Open `tools/mhstats/data/curation-report.md` and read every line of the refinement and curation tables. This is the review surface for the whole deck, and it is the artefact to hand the owner.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tools/mhstats/data/refinement.json tools/mhstats/data/curation-report.md public/mhstats/deck.json
/usr/bin/git commit -m "data(mhstats): rank tied monsters within their bands"
```

---

## Self-review against the spec

- Spec 3.1 roster: Task 2, with the 252 count asserted and a reported diff if the wiki moves.
- Spec 3.2 stats: `STAT_DEFS` in Task 11 carries the seven stats and their inputs; the extractor tasks emit every input the table names.
- Spec 3.3 scaling: Task 11, including per-game normalisation, log handling for HP and Size, percentile clipping and the 300-point scale.
- Spec 3.4 refinement: Task 12 implements the band rule in code and Task 16 authors the rankings.
- Spec 3.5 inheritance and curation: Tasks 10 and 13, with the report in Task 13 and the gap-driven build failure in Task 15.
- Spec 3.6 images: Task 14, including the fan-made render flag and the attribution the licences require.
- Spec 4 pipeline: Tasks 1 to 9 cover the fetch helper, the observation contract and all seven extractors, with the committed observations file as the audit trail.

Type consistency: `obsRow` fields match what `resolveInputs` reads; `STAT_DEFS[].parts[].input` names match `RAW_INPUTS` plus the derived `tolerance_sum`; `applyRefinement` and `applyCuration` both take and return `Map<id, stats>`; `build.js` calls each with the signature its task defines.

Known deviation from the spec, deliberate: `build.js` writes `deck.json` with `JSON.stringify(deck, null, 1)` rather than the compact form the spec's example implies, so that the committed deck has a readable diff when numbers change.
