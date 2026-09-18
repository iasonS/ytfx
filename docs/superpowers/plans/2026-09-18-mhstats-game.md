# MH Stats Game Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the playable `/mhstats/` page: seven rounds of assigning a drawn monster to a free stat slot, an end screen with the best and worst possible totals, browser-stored top runs and replays, and share links.

**Architecture:** A static page under `public/mhstats/` served by the existing `express.static('public')` middleware. Pure game logic (`game.js`) and storage logic (`storage.js`) are ES modules with no DOM access so vitest can test them in Node. `app.js` owns the DOM and state transitions. The deck is `deck.json` produced by the deck pipeline plan; until it exists, tests use a fixture deck.

**Tech Stack:** Vanilla HTML, CSS and ES modules. vitest (already in the repo, `globals: true`, node environment). No bundler, no framework, no new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-09-18-mhstats-design.md` (sections 2, 5, 6, 7, 8).

## Global Constraints

- Route is `/mhstats/`. No new Express routes and no edits to `index.js`.
- Seven stats in this order and with these keys and labels: `hp` HP, `atk` Attack, `def` Defense, `spd` Speed, `wil` Will, `siz` Size, `tmp` Temper. Values are integers 1 to 100. Max total 700.
- Storage key is `mhstats.runs.v1`, at most 50 runs, newest first. Every storage read and write is wrapped in try/catch and the game must work with storage unavailable.
- Mobile first: 16 px side gutter, no horizontal scroll at 360 px width.
- Dark theme default, light variant through `prefers-color-scheme: light`.
- Footer text, verbatim: `Fan-made. Monster Hunter is a trademark of Capcom. Renders via monsterhunterwiki.org and the Monster Hunter Wiki on Fandom.`
- Git authorship `iasonS <sklavenitisi6@gmail.com>`. No Co-Authored-By lines. Inside the worktree, call `/usr/bin/git` directly because the RTK hook collides with the worktree guard.
- Commit after every task with the message given in the task.

---

## File map

| File | Responsibility |
|---|---|
| `public/mhstats/game.js` | Pure logic: seeded RNG, draws, picks, scoring, best and worst assignment, share encoding |
| `public/mhstats/storage.js` | Pure logic: load, save, cap and rank runs against an injected storage object |
| `public/mhstats/app.js` | DOM: views (home, round, end, replay), event wiring, deck loading, query-string share handling |
| `public/mhstats/index.html` | Markup shell, OpenGraph tags, footer |
| `public/mhstats/style.css` | Tokens, layout, components, light and dark |
| `tests/fixtures/mhstats-deck.json` | Ten-monster fixture deck in the real `deck.json` shape |
| `tests/mhstats-game.test.js` | Tests for `game.js` |
| `tests/mhstats-storage.test.js` | Tests for `storage.js` |

`deck.json` and `img/` come from the deck pipeline plan and are not created here.

---

### Task 1: Fixture deck and seeded draw

**Files:**
- Create: `tests/fixtures/mhstats-deck.json`
- Create: `public/mhstats/game.js`
- Test: `tests/mhstats-game.test.js`

**Interfaces:**
- Produces: `STATS` (array of `{key,label}`), `STAT_KEYS` (array of 7 strings), `mulberry32(seed) => () => number`, `drawMonsters(deck, seed, count = 7) => monster[]`.

- [ ] **Step 1: Create the fixture deck**

`tests/fixtures/mhstats-deck.json`:

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
    { "id": "rathalos", "name": "Rathalos", "gen": 1, "game": "MHWilds", "img": "img/rathalos.webp",
      "stats": { "hp": 58, "atk": 71, "def": 44, "spd": 63, "wil": 52, "siz": 55, "tmp": 40 },
      "raw": { "hp": "4500 base HP" }, "curated": [] },
    { "id": "rajang", "name": "Rajang", "gen": 2, "game": "MHRise", "img": "img/rajang.webp",
      "stats": { "hp": 61, "atk": 95, "def": 40, "spd": 90, "wil": 97, "siz": 18, "tmp": 96 },
      "raw": { "hp": "5400 base HP" }, "curated": [] },
    { "id": "fatalis", "name": "Fatalis", "gen": 1, "game": "MHWorld", "img": "img/fatalis.webp",
      "stats": { "hp": 99, "atk": 98, "def": 80, "spd": 45, "wil": 100, "siz": 92, "tmp": 70 },
      "raw": { "hp": "5500 base HP" }, "curated": [] },
    { "id": "great-jagras", "name": "Great Jagras", "gen": 5, "game": "MHWorld", "img": "img/great-jagras.webp",
      "stats": { "hp": 12, "atk": 10, "def": 15, "spd": 30, "wil": 8, "siz": 35, "tmp": 25 },
      "raw": { "hp": "2200 base HP" }, "curated": [] },
    { "id": "diablos", "name": "Diablos", "gen": 1, "game": "MHRise", "img": "img/diablos.webp",
      "stats": { "hp": 66, "atk": 80, "def": 70, "spd": 55, "wil": 94, "siz": 68, "tmp": 85 },
      "raw": { "hp": "5000 base HP" }, "curated": [] },
    { "id": "deviljho", "name": "Deviljho", "gen": 3, "game": "MHWorld", "img": "img/deviljho.webp",
      "stats": { "hp": 78, "atk": 90, "def": 50, "spd": 40, "wil": 96, "siz": 75, "tmp": 60 },
      "raw": { "hp": "4400 base HP" }, "curated": [] },
    { "id": "khezu", "name": "Khezu", "gen": 1, "game": "MHRise", "img": "img/khezu.webp",
      "stats": { "hp": 45, "atk": 55, "def": 35, "spd": 88, "wil": 30, "siz": 42, "tmp": 90 },
      "raw": { "hp": "4200 base HP" }, "curated": ["spd"] },
    { "id": "kirin", "name": "Kirin", "gen": 1, "game": "MHWorld", "img": "img/kirin.webp",
      "stats": { "hp": 40, "atk": 60, "def": 75, "spd": 85, "wil": 80, "siz": 5, "tmp": 95 },
      "raw": { "hp": "3200 base HP" }, "curated": [] },
    { "id": "zorah-magdaros", "name": "Zorah Magdaros", "gen": 5, "game": "MHWorld", "img": "img/zorah-magdaros.webp",
      "stats": { "hp": 100, "atk": 30, "def": 95, "spd": 1, "wil": 60, "siz": 100, "tmp": 1 },
      "raw": { "hp": "12000 base HP" }, "curated": ["spd"] },
    { "id": "yian-kut-ku", "name": "Yian Kut-Ku", "gen": 1, "game": "MHWilds", "img": "img/yian-kut-ku.webp",
      "stats": { "hp": 8, "atk": 20, "def": 10, "spd": 50, "wil": 15, "siz": 30, "tmp": 45 },
      "raw": { "hp": "3800 base HP" }, "curated": [] }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`tests/mhstats-game.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { STATS, STAT_KEYS, mulberry32, drawMonsters } from '../public/mhstats/game.js';

const deck = JSON.parse(readFileSync(new URL('./fixtures/mhstats-deck.json', import.meta.url), 'utf8'));

describe('mhstats game: stats and rng', () => {
  it('exposes the seven stats in spec order', () => {
    expect(STAT_KEYS).toEqual(['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp']);
    expect(STATS.map(s => s.label)).toEqual(['HP', 'Attack', 'Defense', 'Speed', 'Will', 'Size', 'Temper']);
  });

  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    const ys = Array.from({ length: 5 }, () => b());
    expect(xs).toEqual(ys);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(new Set(xs).size).toBe(5);
  });
});

describe('mhstats game: drawMonsters', () => {
  it('draws seven distinct monsters deterministically for a seed', () => {
    const a = drawMonsters(deck, 123);
    const b = drawMonsters(deck, 123);
    expect(a).toHaveLength(7);
    expect(new Set(a.map(m => m.id)).size).toBe(7);
    expect(a.map(m => m.id)).toEqual(b.map(m => m.id));
  });

  it('different seeds give different draws', () => {
    const a = drawMonsters(deck, 1).map(m => m.id);
    const b = drawMonsters(deck, 2).map(m => m.id);
    expect(a).not.toEqual(b);
  });

  it('throws when the deck is smaller than the draw', () => {
    expect(() => drawMonsters({ monsters: deck.monsters.slice(0, 3) }, 1)).toThrow(/at least 7/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/mhstats-game.test.js`
Expected: FAIL, cannot find module `../public/mhstats/game.js`.

- [ ] **Step 4: Write `game.js` with the RNG and draw**

`public/mhstats/game.js`:

```js
// Pure game logic for MH Stats. No DOM, no storage. Safe to import in Node tests.

export const STATS = [
  { key: 'hp', label: 'HP' },
  { key: 'atk', label: 'Attack' },
  { key: 'def', label: 'Defense' },
  { key: 'spd', label: 'Speed' },
  { key: 'wil', label: 'Will' },
  { key: 'siz', label: 'Size' },
  { key: 'tmp', label: 'Temper' },
];
export const STAT_KEYS = STATS.map(s => s.key);
export const ROUNDS = STAT_KEYS.length;

// Small, fast, seedable PRNG. Returns floats in [0, 1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic draw of `count` distinct monsters (partial Fisher-Yates on a copy).
export function drawMonsters(deck, seed, count = ROUNDS) {
  const pool = deck.monsters.slice();
  if (pool.length < count) throw new Error(`deck needs at least ${count} monsters, has ${pool.length}`);
  const rng = mulberry32(seed);
  const out = [];
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
    out.push(pool[i]);
  }
  return out;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/mhstats-game.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 6: Commit**

```bash
/usr/bin/git add tests/fixtures/mhstats-deck.json tests/mhstats-game.test.js public/mhstats/game.js
/usr/bin/git commit -m "feat(mhstats): seeded monster draw and fixture deck"
```

---

### Task 2: Run state, picks and scoring

**Files:**
- Modify: `public/mhstats/game.js`
- Test: `tests/mhstats-game.test.js`

**Interfaces:**
- Consumes: `drawMonsters`, `STAT_KEYS`, `ROUNDS` from Task 1.
- Produces: `newRun(deck, seed) => run`, `currentMonster(run) => monster|null`, `freeStats(run) => string[]`, `pick(run, statKey) => run` (returns a new run, never mutates), `isComplete(run) => boolean`, `score(run) => number`, `valueOf(monster, statKey) => number`. A `run` is `{ seed, monsters, picks }` where `picks[i]` is the stat key chosen for `monsters[i]`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/mhstats-game.test.js`:

```js
import { newRun, currentMonster, freeStats, pick, isComplete, score, valueOf } from '../public/mhstats/game.js';

describe('mhstats game: run and picks', () => {
  it('starts with seven monsters, no picks, first monster current', () => {
    const run = newRun(deck, 7);
    expect(run.seed).toBe(7);
    expect(run.monsters).toHaveLength(7);
    expect(run.picks).toEqual([]);
    expect(currentMonster(run)).toBe(run.monsters[0]);
    expect(freeStats(run)).toEqual(STAT_KEYS);
    expect(isComplete(run)).toBe(false);
    expect(score(run)).toBe(0);
  });

  it('pick appends, advances, removes the stat and does not mutate', () => {
    const run = newRun(deck, 7);
    const next = pick(run, 'atk');
    expect(run.picks).toEqual([]);
    expect(next.picks).toEqual(['atk']);
    expect(currentMonster(next)).toBe(run.monsters[1]);
    expect(freeStats(next)).not.toContain('atk');
    expect(score(next)).toBe(valueOf(run.monsters[0], 'atk'));
  });

  it('rejects a used stat and an unknown stat', () => {
    const run = pick(newRun(deck, 7), 'hp');
    expect(() => pick(run, 'hp')).toThrow(/already used/);
    expect(() => pick(run, 'nope')).toThrow(/unknown stat/);
  });

  it('completes after seven picks and rejects an eighth', () => {
    let run = newRun(deck, 7);
    for (const k of STAT_KEYS) run = pick(run, k);
    expect(isComplete(run)).toBe(true);
    expect(currentMonster(run)).toBeNull();
    expect(freeStats(run)).toEqual([]);
    const expected = run.monsters.reduce((s, m, i) => s + m.stats[run.picks[i]], 0);
    expect(score(run)).toBe(expected);
    expect(() => pick(run, 'hp')).toThrow(/complete/);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mhstats-game.test.js`
Expected: FAIL, `newRun` is not exported.

- [ ] **Step 3: Implement run state**

Append to `public/mhstats/game.js`:

```js
export function valueOf(monster, statKey) {
  const v = monster.stats[statKey];
  if (!Number.isInteger(v)) throw new Error(`monster ${monster.id} has no value for ${statKey}`);
  return v;
}

export function newRun(deck, seed) {
  return { seed, monsters: drawMonsters(deck, seed), picks: [] };
}

export function isComplete(run) {
  return run.picks.length >= run.monsters.length;
}

export function currentMonster(run) {
  return isComplete(run) ? null : run.monsters[run.picks.length];
}

export function freeStats(run) {
  return STAT_KEYS.filter(k => !run.picks.includes(k));
}

export function pick(run, statKey) {
  if (isComplete(run)) throw new Error('run is complete');
  if (!STAT_KEYS.includes(statKey)) throw new Error(`unknown stat ${statKey}`);
  if (run.picks.includes(statKey)) throw new Error(`stat ${statKey} already used`);
  return { ...run, picks: [...run.picks, statKey] };
}

export function score(run) {
  return run.picks.reduce((sum, k, i) => sum + valueOf(run.monsters[i], k), 0);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mhstats-game.test.js`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tests/mhstats-game.test.js public/mhstats/game.js
/usr/bin/git commit -m "feat(mhstats): run state, picks and scoring"
```

---

### Task 3: Best and worst assignment, share encoding

**Files:**
- Modify: `public/mhstats/game.js`
- Test: `tests/mhstats-game.test.js`

**Interfaces:**
- Produces: `bestAssignment(monsters) => { score, picks }`, `worstAssignment(monsters) => { score, picks }` where `picks[i]` is the stat key for `monsters[i]`; `encodeShare(run) => string`; `decodeShare(str) => { seed, picks }` (throws on malformed input); `randomSeed(random = Math.random) => number` (32-bit unsigned).

- [ ] **Step 1: Write the failing tests**

Append to `tests/mhstats-game.test.js`:

```js
import { bestAssignment, worstAssignment, encodeShare, decodeShare, randomSeed } from '../public/mhstats/game.js';

describe('mhstats game: assignments', () => {
  // Two monsters that share a strong stat force a real trade-off.
  const tiny = [
    { id: 'a', stats: { hp: 90, atk: 10, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 } },
    { id: 'b', stats: { hp: 80, atk: 70, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 } },
    { id: 'c', stats: { hp: 10, atk: 10, def: 60, spd: 10, wil: 10, siz: 10, tmp: 10 } },
    { id: 'd', stats: { hp: 10, atk: 10, def: 10, spd: 50, wil: 10, siz: 10, tmp: 10 } },
    { id: 'e', stats: { hp: 10, atk: 10, def: 10, spd: 10, wil: 40, siz: 10, tmp: 10 } },
    { id: 'f', stats: { hp: 10, atk: 10, def: 10, spd: 10, wil: 10, siz: 30, tmp: 10 } },
    { id: 'g', stats: { hp: 10, atk: 10, def: 10, spd: 10, wil: 10, siz: 10, tmp: 20 } },
  ];

  it('bestAssignment finds the optimum, not the greedy answer', () => {
    // Greedy gives a->hp(90), then b->atk(70) = same here, so check the total: 90+70+60+50+40+30+20 = 360.
    const best = bestAssignment(tiny);
    expect(best.score).toBe(360);
    expect(best.picks).toEqual(['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp']);
    expect(new Set(best.picks).size).toBe(7);
  });

  it('bestAssignment beats greedy when greedy is wrong', () => {
    const trap = tiny.map(m => ({ ...m, stats: { ...m.stats } }));
    trap[0].stats = { hp: 90, atk: 85, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 }; // greedy takes hp 90
    trap[1].stats = { hp: 89, atk: 10, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 }; // then b gets atk 10
    const best = bestAssignment(trap);
    expect(best.score).toBe(85 + 89 + 60 + 50 + 40 + 30 + 20);
    expect(best.picks[0]).toBe('atk');
    expect(best.picks[1]).toBe('hp');
  });

  it('worstAssignment is the minimum and never above best', () => {
    const worst = worstAssignment(tiny);
    expect(worst.score).toBe(70);
    expect(worst.score).toBeLessThanOrEqual(bestAssignment(tiny).score);
  });

  it('best and worst on a real draw are consistent with a played run', () => {
    let run = newRun(deck, 99);
    for (const k of STAT_KEYS) run = pick(run, k);
    const s = score(run);
    expect(bestAssignment(run.monsters).score).toBeGreaterThanOrEqual(s);
    expect(worstAssignment(run.monsters).score).toBeLessThanOrEqual(s);
  });
});

describe('mhstats game: share codes', () => {
  it('round-trips a complete run', () => {
    let run = newRun(deck, 4000000000);
    for (const k of ['tmp', 'siz', 'wil', 'spd', 'def', 'atk', 'hp']) run = pick(run, k);
    const code = encodeShare(run);
    expect(code).toMatch(/^[0-9a-z]+\.[0-6]{7}$/);
    expect(decodeShare(code)).toEqual({ seed: 4000000000, picks: ['tmp', 'siz', 'wil', 'spd', 'def', 'atk', 'hp'] });
  });

  it('round-trips a partial run', () => {
    const run = pick(newRun(deck, 5), 'wil');
    expect(decodeShare(encodeShare(run))).toEqual({ seed: 5, picks: ['wil'] });
  });

  it('rejects malformed codes', () => {
    expect(() => decodeShare('')).toThrow();
    expect(() => decodeShare('zz.0011223')).toThrow(/duplicate/);
    expect(() => decodeShare('12.9')).toThrow();
    expect(() => decodeShare('12.01234567')).toThrow(/too many/);
  });

  it('randomSeed is a 32-bit unsigned integer', () => {
    const s = randomSeed(() => 0.999999);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(randomSeed(() => 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mhstats-game.test.js`
Expected: FAIL, `bestAssignment` is not exported.

- [ ] **Step 3: Implement assignments and share codes**

Append to `public/mhstats/game.js`:

```js
// Enumerate every ordering of the seven stat keys (7! = 5040) and keep the extreme.
function extremeAssignment(monsters, better) {
  const n = monsters.length;
  const keys = STAT_KEYS.slice(0, n);
  let bestScore = null, bestPicks = null;
  const used = new Array(n).fill(false);
  const picks = new Array(n);
  function walk(i, acc) {
    if (i === n) {
      if (bestScore === null || better(acc, bestScore)) { bestScore = acc; bestPicks = picks.slice(); }
      return;
    }
    for (let k = 0; k < n; k++) {
      if (used[k]) continue;
      used[k] = true; picks[i] = keys[k];
      walk(i + 1, acc + monsters[i].stats[keys[k]]);
      used[k] = false;
    }
  }
  walk(0, 0);
  return { score: bestScore, picks: bestPicks };
}

export function bestAssignment(monsters) {
  return extremeAssignment(monsters, (a, b) => a > b);
}

export function worstAssignment(monsters) {
  return extremeAssignment(monsters, (a, b) => a < b);
}

// Share code: seed in base 36, a dot, then one digit per pick (index into STAT_KEYS).
export function encodeShare(run) {
  return `${run.seed.toString(36)}.${run.picks.map(k => STAT_KEYS.indexOf(k)).join('')}`;
}

export function decodeShare(str) {
  const m = /^([0-9a-z]+)\.([0-6]*)$/.exec(String(str || ''));
  if (!m) throw new Error('malformed share code');
  const seed = parseInt(m[1], 36);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new Error('bad seed');
  const digits = m[2].split('').map(Number);
  if (digits.length > ROUNDS) throw new Error('too many picks');
  if (new Set(digits).size !== digits.length) throw new Error('duplicate picks');
  return { seed, picks: digits.map(d => STAT_KEYS[d]) };
}

export function randomSeed(random = Math.random) {
  return Math.floor(random() * 0x100000000) >>> 0;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mhstats-game.test.js`
Expected: PASS, 17 tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tests/mhstats-game.test.js public/mhstats/game.js
/usr/bin/git commit -m "feat(mhstats): best/worst assignment search and share codes"
```

---

### Task 4: Run storage

**Files:**
- Create: `public/mhstats/storage.js`
- Test: `tests/mhstats-storage.test.js`

**Interfaces:**
- Produces: `STORAGE_KEY`, `MAX_RUNS`, `loadRuns(storage) => record[]`, `saveRun(storage, record) => record[]`, `topRuns(records, n = 10) => record[]`. A `record` is `{ seed, monsters: string[] (ids), picks: string[], score, best, worst, at: ISO string }`. `storage` is any object with `getItem(key)` and `setItem(key, value)`; pass `null` when unavailable.

- [ ] **Step 1: Write the failing tests**

`tests/mhstats-storage.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { STORAGE_KEY, MAX_RUNS, loadRuns, saveRun, topRuns } from '../public/mhstats/storage.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    dump: () => data,
  };
}

const rec = (score, at = '2026-09-18T10:00:00Z') => ({
  seed: 1, monsters: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  picks: ['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp'], score, best: 500, worst: 100, at,
});

describe('mhstats storage', () => {
  it('uses the spec key and cap', () => {
    expect(STORAGE_KEY).toBe('mhstats.runs.v1');
    expect(MAX_RUNS).toBe(50);
  });

  it('loads [] from empty, null or corrupt storage', () => {
    expect(loadRuns(memoryStorage())).toEqual([]);
    expect(loadRuns(null)).toEqual([]);
    expect(loadRuns(memoryStorage({ [STORAGE_KEY]: '{not json' }))).toEqual([]);
    expect(loadRuns(memoryStorage({ [STORAGE_KEY]: '{"a":1}' }))).toEqual([]);
    expect(loadRuns({ getItem() { throw new Error('blocked'); }, setItem() {} })).toEqual([]);
  });

  it('saves newest first and persists', () => {
    const s = memoryStorage();
    saveRun(s, rec(100, '2026-09-18T10:00:00Z'));
    const runs = saveRun(s, rec(200, '2026-09-18T11:00:00Z'));
    expect(runs.map(r => r.score)).toEqual([200, 100]);
    expect(JSON.parse(s.dump()[STORAGE_KEY]).map(r => r.score)).toEqual([200, 100]);
  });

  it('caps at MAX_RUNS', () => {
    const s = memoryStorage();
    let runs;
    for (let i = 0; i < MAX_RUNS + 5; i++) runs = saveRun(s, rec(i));
    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs[0].score).toBe(MAX_RUNS + 4);
  });

  it('returns the in-memory list even when setItem throws', () => {
    const s = { getItem: () => null, setItem() { throw new Error('quota'); } };
    expect(saveRun(s, rec(5))).toEqual([rec(5)]);
    expect(saveRun(null, rec(6))).toEqual([rec(6)]);
  });

  it('topRuns sorts by score desc then newest, and limits', () => {
    const runs = [rec(300, '2026-09-18T10:00:00Z'), rec(500, '2026-09-18T09:00:00Z'),
      rec(500, '2026-09-18T12:00:00Z'), rec(100)];
    const top = topRuns(runs, 3);
    expect(top.map(r => [r.score, r.at])).toEqual([
      [500, '2026-09-18T12:00:00Z'], [500, '2026-09-18T09:00:00Z'], [300, '2026-09-18T10:00:00Z']]);
    expect(runs[0].score).toBe(300); // input not mutated
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/mhstats-storage.test.js`
Expected: FAIL, cannot find module `storage.js`.

- [ ] **Step 3: Implement storage**

`public/mhstats/storage.js`:

```js
// Run persistence against an injected Web Storage-like object. Every access is guarded:
// private windows, blocked storage and quota errors must never break the game.

export const STORAGE_KEY = 'mhstats.runs.v1';
export const MAX_RUNS = 50;

export function loadRuns(storage) {
  try {
    const raw = storage && storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRun(storage, record) {
  const runs = [record, ...loadRuns(storage)].slice(0, MAX_RUNS);
  try {
    if (storage) storage.setItem(STORAGE_KEY, JSON.stringify(runs));
  } catch {
    // storage unavailable or full: the caller still gets the in-memory list
  }
  return runs;
}

export function topRuns(records, n = 10) {
  return records
    .slice()
    .sort((a, b) => (b.score - a.score) || String(b.at).localeCompare(String(a.at)))
    .slice(0, n);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/mhstats-storage.test.js`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add tests/mhstats-storage.test.js public/mhstats/storage.js
/usr/bin/git commit -m "feat(mhstats): guarded run storage and top-runs ranking"
```

---

### Task 5: Page shell, styles and app wiring

**Files:**
- Create: `public/mhstats/index.html`
- Create: `public/mhstats/style.css`
- Create: `public/mhstats/app.js`

**Interfaces:**
- Consumes: everything exported by `game.js` and `storage.js`.
- Produces: the four views. `app.js` reads `?r=<share code>` on load and opens the replay view for it.

This task has no unit tests; it is verified by hand in Task 7. Keep all logic that can be tested inside `game.js` and `storage.js`.

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MH Stats</title>
<meta name="description" content="Build your own monster: assign seven Monster Hunter monsters to seven stats and chase the best possible score.">
<meta property="og:title" content="MH Stats">
<meta property="og:description" content="Seven monsters, seven stats. How close can you get to the perfect build?">
<meta property="og:type" content="website">
<meta property="og:url" content="https://xyyoutube.com/mhstats/">
<meta property="og:image" content="https://xyyoutube.com/mhstats/img/rathalos.webp">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#151311">
<link rel="stylesheet" href="./style.css">
</head>
<body>
<header class="top">
  <a class="brand" href="./">MH Stats</a>
  <nav>
    <button type="button" data-nav="home">Home</button>
    <button type="button" data-nav="runs">Runs</button>
  </nav>
</header>
<main id="view" class="view" aria-live="polite"></main>
<footer class="foot">
  <p>Fan-made. Monster Hunter is a trademark of Capcom. Renders via monsterhunterwiki.org and the Monster Hunter Wiki on Fandom.</p>
</footer>
<script type="module" src="./app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `style.css`**

```css
:root {
  --bg: #151311; --panel: #221f1b; --panel-2: #2c2823; --line: #3a352e;
  --ink: #f2ede4; --muted: #a89f92; --accent: #e0a458; --accent-ink: #1a1408;
  --good: #7fc47f; --bad: #d97b6c;
  --radius: 14px; --gutter: 16px; --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
@media (prefers-color-scheme: light) {
  :root { --bg: #f5f1ea; --panel: #ffffff; --panel-2: #efe9df; --line: #d9d2c5;
    --ink: #1d1a16; --muted: #6b6257; --accent: #b8742a; --accent-ink: #fff8ee; }
}
* { box-sizing: border-box; }
html, body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--font); }
body { display: flex; flex-direction: column; min-height: 100vh; }
img { max-width: 100%; display: block; }
button { font: inherit; }

.top { display: flex; justify-content: space-between; align-items: center; padding: 12px var(--gutter); border-bottom: 1px solid var(--line); }
.brand { color: var(--ink); text-decoration: none; font-weight: 700; letter-spacing: .02em; }
.top nav button { background: none; border: 1px solid var(--line); color: var(--ink); border-radius: 999px; padding: 6px 12px; margin-left: 6px; cursor: pointer; }

.view { flex: 1; width: 100%; max-width: 720px; margin: 0 auto; padding: 20px var(--gutter) 32px; }
.foot { padding: 16px var(--gutter); color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); text-align: center; }

h1 { font-size: 26px; margin: 0 0 8px; }
h2 { font-size: 18px; margin: 20px 0 8px; }
p.lead { color: var(--muted); margin: 0 0 20px; }
.btn { display: inline-block; background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 999px; padding: 12px 22px; font-weight: 700; cursor: pointer; }
.btn.ghost { background: transparent; color: var(--ink); border: 1px solid var(--line); }
.row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
.monster { text-align: center; }
.monster img { width: min(60vw, 260px); height: auto; margin: 0 auto 8px; aspect-ratio: 1; object-fit: contain; }
.monster .name { font-size: 22px; font-weight: 700; }
.monster .game { color: var(--muted); font-size: 13px; }
.progress { display: flex; justify-content: space-between; color: var(--muted); font-size: 13px; margin: 14px 0 6px; }

.slots { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin-top: 12px; }
.slot { background: var(--panel-2); border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; text-align: left; color: var(--ink); cursor: pointer; display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 8px; min-height: 60px; }
.slot:hover:not([disabled]) { border-color: var(--accent); }
.slot[disabled] { cursor: default; opacity: .9; }
.slot .label { font-weight: 700; }
.slot .value { font-size: 22px; font-weight: 800; color: var(--accent); }
.slot .who { grid-column: 1 / -1; display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
.slot .who img { width: 28px; height: 28px; object-fit: contain; }
.flip { animation: flip .45s ease-out; }
@keyframes flip { from { transform: rotateX(90deg); opacity: 0; } to { transform: none; opacity: 1; } }

.total { font-size: 40px; font-weight: 800; margin: 4px 0; }
.total small { font-size: 16px; color: var(--muted); font-weight: 500; }
.kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin: 12px 0; }
.kpi { background: var(--panel-2); border-radius: 12px; padding: 10px; text-align: center; }
.kpi .n { font-size: 22px; font-weight: 800; }
.kpi .l { color: var(--muted); font-size: 12px; }

.sheet { width: 100%; border-collapse: collapse; font-size: 13px; overflow-x: auto; display: block; }
.sheet th, .sheet td { padding: 6px 6px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }
.sheet th:first-child, .sheet td:first-child { text-align: left; }
.sheet td.picked { background: color-mix(in srgb, var(--accent) 22%, transparent); font-weight: 700; }
.sheet td.best { outline: 2px solid var(--good); outline-offset: -2px; }
.sheet .cur::after { content: "*"; color: var(--muted); }
.note { color: var(--muted); font-size: 12px; }

.runs { list-style: none; padding: 0; margin: 0; }
.runs li { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 0; border-bottom: 1px solid var(--line); }
.runs .meta { color: var(--muted); font-size: 12px; }
.empty { color: var(--muted); }
```

- [ ] **Step 3: Write `app.js`**

```js
import { STATS, STAT_KEYS, newRun, currentMonster, freeStats, pick, isComplete, score, valueOf,
  bestAssignment, worstAssignment, encodeShare, decodeShare, randomSeed, drawMonsters } from './game.js';
import { loadRuns, saveRun, topRuns } from './storage.js';

const view = document.getElementById('view');
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const LABEL = Object.fromEntries(STATS.map(s => [s.key, s.label]));

let deck = null;
let run = null;          // the live run
let lastFlip = null;     // stat key just revealed, for the flip animation

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function render(node) { view.replaceChildren(node); window.scrollTo({ top: 0 }); }
function byId(id) { return deck.monsters.find(m => m.id === id); }

async function loadDeck() {
  const res = await fetch('./deck.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`deck.json ${res.status}`);
  return res.json();
}

// ---------- views ----------

function homeView() {
  const runs = topRuns(loadRuns(storage), 5);
  const node = h(`
    <h1>Build your own monster</h1>
    <p class="lead">Seven monsters, one at a time. Give each one a stat before you see the number. Fill all seven slots and see how close you got to the perfect build.</p>
    <div class="row"><button class="btn" data-act="play">Play</button><button class="btn ghost" data-nav="runs">Previous runs</button></div>
    <h2>Top runs</h2>
    <ul class="runs">${runs.length ? runs.map(runItem).join('') : '<li class="empty">No runs yet. Play one.</li>'}</ul>
    <p class="note">Deck: ${deck.monsters.length} monsters, built ${esc(deck.built)}.</p>
  `);
  render(node);
}

function runItem(r) {
  const pct = r.best ? Math.round((r.score / r.best) * 100) : 0;
  const names = r.monsters.map(id => (byId(id) || { name: id }).name).slice(0, 3).join(', ');
  return `<li><div><strong>${r.score}</strong> <span class="meta">of ${r.best} best (${pct}%)</span><div class="meta">${esc(names)}…</div></div>
    <button class="btn ghost" data-act="replay" data-code="${esc(encodeShare({ seed: r.seed, picks: r.picks }))}">Replay</button></li>`;
}

function runsView() {
  const runs = topRuns(loadRuns(storage), 50);
  render(h(`
    <h1>Previous runs</h1>
    <ul class="runs">${runs.length ? runs.map(runItem).join('') : '<li class="empty">Nothing stored in this browser yet.</li>'}</ul>
  `));
}

function slotHtml(r, key, interactive) {
  const i = r.picks.indexOf(key);
  if (i >= 0) {
    const m = r.monsters[i];
    const flip = lastFlip === key ? ' flip' : '';
    return `<button class="slot" disabled><span class="label">${LABEL[key]}</span><span class="value${flip}">${valueOf(m, key)}</span>
      <span class="who"><img src="${esc(m.img)}" alt=""> ${esc(m.name)}</span></button>`;
  }
  return `<button class="slot" data-act="pick" data-key="${key}" ${interactive ? '' : 'disabled'}><span class="label">${LABEL[key]}</span><span class="value">?</span></button>`;
}

function roundView(r, { interactive = true } = {}) {
  const m = currentMonster(r);
  render(h(`
    <div class="card monster">
      <img src="${esc(m.img)}" alt="${esc(m.name)}">
      <div class="name">${esc(m.name)}</div>
      <div class="game">Numbers from ${esc(m.game)} · Gen ${m.gen}</div>
    </div>
    <div class="progress"><span>Round ${r.picks.length + 1} of ${STAT_KEYS.length}</span><span>Total ${score(r)}</span></div>
    <div class="slots">${STAT_KEYS.map(k => slotHtml(r, k, interactive)).join('')}</div>
    ${interactive ? '' : '<div class="row" style="margin-top:14px"><button class="btn" data-act="replay-next">Next pick</button></div>'}
  `));
}

function endView(r, { stored = true } = {}) {
  const best = bestAssignment(r.monsters), worst = worstAssignment(r.monsters), total = score(r);
  const pct = Math.round((total / best.score) * 100);
  const rows = r.monsters.map((m, i) => `<tr><td>${esc(m.name)}</td>${STAT_KEYS.map(k => {
    const cls = [r.picks[i] === k ? 'picked' : '', best.picks[i] === k ? 'best' : ''].join(' ').trim();
    const cur = (m.curated || []).includes(k) ? ' class="cur"' : '';
    return `<td class="${cls}"><span${cur}>${m.stats[k]}</span></td>`;
  }).join('')}</tr>`).join('');
  const code = encodeShare(r);
  const url = `${location.origin}${location.pathname}?r=${code}`;
  render(h(`
    <h1>Your monster</h1>
    <div class="total">${total} <small>of 700</small></div>
    <div class="kpis">
      <div class="kpi"><div class="n">${best.score}</div><div class="l">best possible</div></div>
      <div class="kpi"><div class="n">${pct}%</div><div class="l">of best</div></div>
      <div class="kpi"><div class="n">${worst.score}</div><div class="l">worst possible</div></div>
    </div>
    <p class="note">Highlighted cells are your picks; outlined cells are the best assignment. * means a hand-rated value.</p>
    <table class="sheet"><thead><tr><th>Monster</th>${STAT_KEYS.map(k => `<th>${LABEL[k]}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>
    <div class="row" style="margin-top:16px">
      <button class="btn" data-act="play">Play again</button>
      <button class="btn ghost" data-act="copy" data-url="${esc(url)}">Copy share link</button>
      <span class="note" id="copied"></span>
    </div>
    ${stored ? '' : '<p class="note">This is a shared run; it is not stored in your list.</p>'}
  `));
}

// ---------- replay ----------

let replay = null; // { run, step }

function startReplay(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { alert('That share link is not valid.'); return homeView(); }
  const monsters = drawMonsters(deck, decoded.seed);
  const stored = loadRuns(storage).find(r => r.seed === decoded.seed && r.picks.join() === decoded.picks.join());
  const mismatch = stored && stored.monsters.join() !== monsters.map(m => m.id).join();
  replay = { run: { seed: decoded.seed, monsters, picks: [] }, picks: decoded.picks, mismatch,
    stored: !!stored, storedScore: stored ? stored.score : null };
  replayStep();
}

function replayStep() {
  const { run: r, picks } = replay;
  if (replay.mismatch) {
    render(h(`<h1>Replay</h1><p class="lead">The deck has changed since this run was played, so it cannot be replayed exactly. Stored result: ${replay.storedScore ?? ''}</p><div class="row"><button class="btn" data-nav="home">Home</button></div>`));
    return;
  }
  if (r.picks.length < picks.length) {
    lastFlip = null;
    roundView(r, { interactive: false });
  } else {
    endView(r, { stored: replay.stored });
    replay = null;
  }
}

function replayNext() {
  const { run: r, picks } = replay;
  replay.run = pick(r, picks[r.picks.length]);
  lastFlip = picks[r.picks.length];
  if (replay.run.picks.length < picks.length) roundView(replay.run, { interactive: false });
  else replayStep();
}

// ---------- actions ----------

function play() {
  run = newRun(deck, randomSeed());
  lastFlip = null;
  roundView(run);
}

function doPick(key) {
  run = pick(run, key);
  lastFlip = key;
  if (isComplete(run)) {
    const best = bestAssignment(run.monsters), worst = worstAssignment(run.monsters);
    saveRun(storage, { seed: run.seed, monsters: run.monsters.map(m => m.id), picks: run.picks,
      score: score(run), best: best.score, worst: worst.score, at: new Date().toISOString() });
    endView(run);
  } else {
    roundView(run);
  }
}

async function copy(url) {
  try { await navigator.clipboard.writeText(url); document.getElementById('copied').textContent = 'Copied.'; }
  catch { prompt('Copy this link', url); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-nav]');
  if (!el || !deck) return;
  if (el.dataset.nav === 'home') return homeView();
  if (el.dataset.nav === 'runs') return runsView();
  switch (el.dataset.act) {
    case 'play': return play();
    case 'pick': return doPick(el.dataset.key);
    case 'copy': return copy(el.dataset.url);
    case 'replay': return startReplay(el.dataset.code);
    case 'replay-next': return replayNext();
  }
});

(async () => {
  try {
    deck = await loadDeck();
  } catch (err) {
    render(h(`<h1>MH Stats</h1><p class="lead">Could not load the monster deck (${esc(err.message)}). Try again later.</p>`));
    return;
  }
  const code = new URLSearchParams(location.search).get('r');
  if (code) startReplay(code); else homeView();
})();
```

- [ ] **Step 4: Run the whole test suite to make sure nothing regressed**

Run: `npx vitest run`
Expected: PASS, the baseline 78 plus the new 23 (10 skipped E2E tests stay skipped).

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add public/mhstats/index.html public/mhstats/style.css public/mhstats/app.js
/usr/bin/git commit -m "feat(mhstats): page shell, styles and app wiring"
```

---

### Task 6: Confirm the server and the image serve the page

**Files:** none modified. The Dockerfile on master already has `COPY public ./public`, so this task only proves the route works end to end.

- [ ] **Step 1: Check the route on the plain server**

Run:

```bash
PORT=3999 node index.js & sleep 2; curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3999/mhstats; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/mhstats/; kill %1
```

Expected: first line `301 http://localhost:3999/mhstats/`, second line `200`.

- [ ] **Step 2: Check the Docker image if Docker is available**

Run:

```bash
docker build -t ytfx-mhstats-test . && docker run --rm -d --name ytfx-mhstats-test -p 3999:3000 ytfx-mhstats-test && sleep 3 && curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3999/mhstats/ ; docker rm -f ytfx-mhstats-test
```

Expected: `200`. If Docker is not available locally, say so in the task report; Step 1 is the required check.

- [ ] **Step 3: No commit.** Record the two status lines in the task report.

---

### Task 7: Manual verification in a real browser

**Files:** none created. This task gates the "done" claim for the page.

Prerequisite: `public/mhstats/deck.json` and `public/mhstats/img/` exist from the deck pipeline plan. If they do not yet, copy `tests/fixtures/mhstats-deck.json` to `public/mhstats/deck.json` temporarily, verify, then delete it and do not commit it.

- [ ] **Step 1: Start the server**

Run: `PORT=3999 node index.js` in the background.

- [ ] **Step 2: Play through at phone width**

Use the `webapp-testing` skill (Playwright) with a 360×740 viewport against `http://localhost:3999/mhstats/`:
1. Home renders, no horizontal scroll (`document.documentElement.scrollWidth <= 360`).
2. Press Play. A monster image and seven `?` slots show.
3. Pick seven distinct slots. Each pick reveals an integer 1 to 100 and greys the slot.
4. End screen shows total, best, percentage and worst, and the table has seven rows.
5. Reload. Home lists the run under Top runs.
6. Press Replay. Step through seven picks with Next pick; the end screen matches the stored score.
7. Copy share link, open it in a fresh context. The replay loads without a stored run and shows the not-stored note.
Take screenshots of steps 2, 4 and 6 and keep them out of the repo.

- [ ] **Step 3: Repeat steps 1 to 4 at 1280 px width** and confirm the table is fully visible without scrolling.

- [ ] **Step 4: Storage disabled**

In Playwright, open the page with `localStorage` blocked (context option `storageState` unavailable, or override `window.localStorage` getter to throw before load). Play a full run. Expected: the game completes and the end screen shows, with no console errors other than the storage warning path.

- [ ] **Step 5: Record the result**

If everything passes, no commit is needed. If a defect is found, fix it in the file that owns the behaviour, add a unit test when the defect is in `game.js` or `storage.js`, and commit with `fix(mhstats): <what>`.

---

### Task 8: Docs

**Files:**
- Modify: `README.md` (the endpoint table under `## API Endpoints`)
- Modify: `ARCHITECTURE.md` (add a `### public/mhstats/` subsection under `## Code Structure`, after `### emoticons.js`)
- Modify: `ADR.md` (insert `## ADR-012` after ADR-011, before the `---` that precedes `## How to use this file`)
- Modify: `CLAUDE.md` at the repo root (it exists; add to it, do not replace it)

- [ ] **Step 1: README endpoint table row**

Add this row at the end of the table under `## API Endpoints`:

```markdown
| `/mhstats/` | GET | — | MH Stats fan game (static page, browser-stored runs) |
```

Then add, right after the table and before `**Stats Response Example:**`:

```markdown
`/mhstats/` is a static page under `public/mhstats/`: assign seven Monster Hunter monsters to seven stats and chase the best possible score. No API and no server state. Its deck (`deck.json`, `img/`) is generated by `tools/mhstats/` and committed.
```

- [ ] **Step 2: ARCHITECTURE subsection**

Add under `## Code Structure`, after the `### emoticons.js` subsection:

```markdown
### `public/mhstats/` (MH Stats game)
Static page served by `express.static`. `game.js` and `storage.js` are pure ES modules (tested under vitest); `app.js` owns the DOM. `deck.json` and `img/` are build outputs of `tools/mhstats/` (see that folder's README) and are committed so the Docker build needs no network. The Express catch-all `/:id` never sees `/mhstats/` because the static middleware is registered first.
```

- [ ] **Step 3: ADR entry**

Insert after the ADR-011 block, matching the existing compact format:

```markdown
## ADR-012: The MH Stats fan game is static files under `/mhstats/`
**Date**: 2026-09-18
**Status**: Active
**Context**: The owner wanted a Monster Hunter stat game in the style of statle.fun without paying for another domain. ytfx already serves `xyyoutube.com` through the Cloudflare Tunnel (ADR-011) and has a static `public/` folder that the Docker image copies.
**Decision**: Ship the game as static files under `public/mhstats/`: no Express routes, no database, no shared state. Its deck (`deck.json`, `img/`) is built offline by `tools/mhstats/` from game data and a reviewed curation overlay, and committed. Runs live in the player's browser only.
**Consequences**: The proxy's code paths are untouched and the game cannot break embeds; the static middleware is registered before the `/:id` catch-all, so `/mhstats/` never reaches it. The image grows by roughly 10 MB of renders. There are no server-side highscores by design; anything that needs server state is a new decision, not an extension of this one. Rollback: delete `public/mhstats/` and `tools/mhstats/`.
```

- [ ] **Step 4: Extend `CLAUDE.md`**

Append this sentence to the end of the `## Architecture` paragraph:

```markdown
`public/mhstats/` is the MH Stats fan game (ADR-012): `game.js` and `storage.js` are pure ES modules, `app.js` owns the DOM, and `deck.json` plus `img/` are generated by `tools/mhstats/` and committed.
```

Add a new section after `## Validation`:

```markdown
## MH Stats deck

Rebuild with `node tools/mhstats/build.js` (see `tools/mhstats/README.md`). Deck numbers come only from the sources or the curation overlay `tools/mhstats/data/curation.json`; never hand-edit `deck.json`. Commit regenerated `deck.json` and `img/` in their own commit.
```

Add to the end of `## Validation`:

```markdown
The MH Stats tests are `tests/mhstats-*.test.js` and run under `npm test`.
```

- [ ] **Step 5: Commit**

```bash
/usr/bin/git add README.md ARCHITECTURE.md ADR.md CLAUDE.md
/usr/bin/git commit -m "docs: document /mhstats, add ADR-012, extend CLAUDE.md"
```

---

## Self-review against the spec

- Spec 2 placement: Task 5 and 6. No Express changes: confirmed, none planned.
- Spec 5.1 logic: Tasks 1 to 3 cover draws, picks, best and worst, share codes, seeds.
- Spec 5.2 screens: Task 5 has home, round, end and replay, including the not-stored note for shared runs and the curated marker.
- Spec 5.3 presentation: Task 5 CSS (gutter, dark and light), OpenGraph tags in `index.html`; Task 7 checks 360 px.
- Spec 6 persistence: Task 4, including the deck-changed fallback in `startReplay` (Task 5), which shows `replay.storedScore` when the stored monsters no longer match the deck.
- Spec 7 testing: Tasks 1 to 4 unit tests; Task 7 manual; the `deck.json` validity test belongs to the pipeline plan.
- Spec 8 docs: Task 8.

Type consistency: `pick`, `score`, `valueOf`, `bestAssignment().picks`, `encodeShare({seed, picks})` are used in `app.js` with the signatures defined in Tasks 2 and 3. `runItem` builds a share code from a stored record's `seed` and `picks`, which matches `encodeShare`'s contract.
