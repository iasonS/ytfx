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

*Extractor tasks (3 to 9), merge, scale, refinement, curation, images and build continue in part two of this plan.*
