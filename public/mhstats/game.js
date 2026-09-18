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

// Enumerate every ordering of the stat keys (7! = 5040) and keep the extreme.
// Greedy is wrong here: taking each monster's best free stat in turn can strand
// a later monster on a stat it is bad at.
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
