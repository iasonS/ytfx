// Pure game logic for MH Stats. No DOM, no storage. Safe to import in Node tests.

// The key is what share codes and saved runs are written in, so it never changes. The
// label is only what a player reads. "Will" was one of those: next to Temper it read as a
// second word for temperament, and nothing told you it meant shrugging off status.
export const STATS = [
  { key: 'hp', label: 'HP', help: 'How much punishment it takes before it goes down.' },
  { key: 'atk', label: 'Attack', help: 'How hard a hit lands when it connects.' },
  { key: 'def', label: 'Defense', help: 'How well its hide turns damage away.' },
  { key: 'spd', label: 'Speed', help: 'How quickly it moves and swings.' },
  { key: 'wil', label: 'Resist', help: 'How well it shrugs off poison, paralysis, sleep and stun. The highest scores belong to monsters that cannot be afflicted at all.' },
  { key: 'siz', label: 'Size', help: 'How long it measures, nose to tail.' },
  { key: 'tmp', label: 'Temper', help: 'How aggressive it is, and how long it stays that way.' },
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

export const GENS = [1, 2, 3, 4, 5, 6];
export const ALL_GENS = 0b111111; // every generation selected

// Generations are carried as a bitmask so a whole selection fits in one share-code segment.
export function gensToMask(gens) {
  return gens.reduce((m, g) => m | (1 << (g - 1)), 0);
}

export function maskToGens(mask) {
  return GENS.filter(g => mask & (1 << (g - 1)));
}

export function poolFor(deck, mask = ALL_GENS) {
  if (mask === ALL_GENS) return deck.monsters;
  return deck.monsters.filter(m => mask & (1 << (m.gen - 1)));
}

// Deterministic draw of `count` distinct monsters (partial Fisher-Yates on a copy).
// The generation mask is part of the draw: the same seed with a different mask is a
// different run, which is why the mask travels in the share code.
export function drawMonsters(deck, seed, count = ROUNDS, mask = ALL_GENS) {
  const pool = poolFor(deck, mask).slice();
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

export function newRun(deck, seed, mask = ALL_GENS) {
  return { seed, mask, monsters: drawMonsters(deck, seed, ROUNDS, mask), picks: [] };
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

// Share code: seed in base 36, a dot, one digit per pick (index into STAT_KEYS), then
// optionally a dot and the generation mask. The mask MUST travel with the code: the same
// seed over a different generation selection draws a different seven monsters. A two-part
// code predates the filter and means every generation.
export function encodeShare(run) {
  const base = `${run.seed.toString(36)}.${run.picks.map(k => STAT_KEYS.indexOf(k)).join('')}`;
  const mask = run.mask ?? ALL_GENS;
  return mask === ALL_GENS ? base : `${base}.${mask.toString(36)}`;
}

export function decodeShare(str) {
  const m = /^([0-9a-z]+)\.([0-6]*)(?:\.([0-9a-z]+))?$/.exec(String(str || ''));
  if (!m) throw new Error('malformed share code');
  const seed = parseInt(m[1], 36);
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xFFFFFFFF) throw new Error('bad seed');
  const digits = m[2].split('').map(Number);
  if (digits.length > ROUNDS) throw new Error('too many picks');
  if (new Set(digits).size !== digits.length) throw new Error('duplicate picks');
  let mask = ALL_GENS;
  if (m[3] !== undefined) {
    mask = parseInt(m[3], 36);
    if (!Number.isInteger(mask) || mask < 1 || mask > ALL_GENS) throw new Error('bad generation mask');
  }
  return { seed, picks: digits.map(d => STAT_KEYS[d]), mask };
}

export function randomSeed(random = Math.random) {
  return Math.floor(random() * 0x100000000) >>> 0;
}
