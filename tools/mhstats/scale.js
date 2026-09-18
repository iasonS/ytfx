// Scaling: raw game values to a shared 1..300 character sheet.
// Normalisation is per game, because an MHFU HP and a Wilds HP are different units.

export const STAT_MAX = 300;

// Each stat names the inputs it needs and how they behave.
// invert: a lower raw value means a higher stat (a small hitzone is a tough monster).
// log:    the raw range spans an order of magnitude.
// global: the unit means the same thing in every game, so rank against the whole roster.
//         Only base HP is era-dependent — a Freedom Unite 4000 and a Wilds 4000 are not
//         the same monster — so only HP is normalised per game. Centimetres, hitzone
//         percentages and status build-up points are absolute. Normalising those per game
//         produced contradictions: Arkveld at 1667cm scored SMALLER than Anjanath at
//         1646cm, and Xeno'jiiva scored the Defense floor while softer monsters from other
//         games scored above it.
export const STAT_DEFS = [
  // HP is era-adjusted and then ranked, rather than scaled per game against its own range.
  // Scaling per game let each game's ROSTER SHAPE set the stat: World's table holds both
  // Great Jagras and Zorah Magdaros, so its 35000 ceiling squashed every ordinary World
  // monster toward the floor, while Rise's narrower table spread its monsters out. The
  // result was that HP measured which game a monster was read from, not how tough it is:
  // the median World monster scored 46 against the median Rise monster's 138, Fatalis
  // landed on 106, and Coral Pukei-Pukei came out below base Pukei-Pukei. Dividing by the
  // game's median puts every monster on "multiples of a typical monster of its era", and
  // ranking those multiples keeps the siege monsters from compressing everyone else.
  { key: 'hp', label: 'HP', parts: [{ input: 'base_hp', eraRank: true }] },
  // Attack has NO source input, for the same reason as Speed. Two published figures were
  // tried and both were rejected. The enrage attack multiplier measures how much a monster
  // GAINS when angry, and ranked Dodogama beside Alatreon. Per-move damage from the game
  // files looked like the fix and was not: it scored Great Jagras above Teostra, put
  // Velkhana at the floor, and made a mid-tier Sunbreak monster the hardest hitter in the
  // series. Every Attack value is a rating, in data/ratings.json, with a reason.
  { key: 'atk', label: 'Attack', parts: [] },
  // Defense uses the MEAN hitzone across a monster's parts, not the softest one. The max
  // saturates: nearly every monster has some weak point around 85-100, so ten monsters
  // including Fatalis, Dalamadur and Jhen Mohran were pinned at the floor. Inverted,
  // because a low hitzone means a hard monster to hurt.
  { key: 'def', label: 'Defense', parts: [{ input: 'hitzone_mean_raw', invert: true, global: true }] },
  // Speed has NO source input. No mainline game publishes an absolute movement speed
  // (verified across all seven sources and the full Rise data dump, where the only
  // move_speed field is populated for Zinogre alone). The enrage motion multiplier was
  // tried and rejected: it measures how much a monster speeds up when angry, which is
  // largest for slow ones, and it ranked Basarios and Khezu as the fastest in the game.
  // Every Speed value is therefore a rating, carried in data/ratings.json with a reason.
  { key: 'spd', label: 'Speed', parts: [] },
  { key: 'wil', label: 'Will', parts: [{ input: 'tolerance_sum', global: true }] },
  { key: 'siz', label: 'Size', parts: [{ input: 'size_base', log: true, global: true }] },
  // Temper has NO source input, the fourth stat to lose one. It was the mean of "snaps
  // sooner" (damage needed to enrage) and "stays angry longer". Both are published, and
  // both measure the wrong thing: damage-to-enrage scales with a monster's health pool and
  // with its game's damage numbers, not with its temperament. Rajang needs 1150 damage to
  // flip, which is Rise's 75th percentile, so the formula ranked the angriest monster in
  // the series 221st of 252 — below Bulldrome. Every Temper value is a rating.
  { key: 'tmp', label: 'Temper', parts: [] },
];

function quantile(sorted, q) {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

// Express each value as a multiple of its own game's median, then spread those multiples
// evenly over 0..1 by rank. Rank rather than value because the siege monsters are a true
// order of magnitude above everything else, and on a value scale they flatten the roster.
function eraRanked(entries, invert) {
  const byGame = new Map();
  for (const e of entries) {
    if (!byGame.has(e.game)) byGame.set(e.game, []);
    byGame.get(e.game).push(e.value);
  }
  const median = new Map();
  for (const [game, vs] of byGame) {
    vs.sort((a, b) => a - b);
    median.set(game, vs[Math.floor(vs.length / 2)]);
  }

  // Ties share the rank of the first of their group, so equal inputs give equal stats.
  const ranked = entries
    .map(e => ({ id: e.id, ratio: e.value / median.get(e.game) }))
    .sort((a, b) => a.ratio - b.ratio);
  const out = new Map();
  const last = Math.max(1, ranked.length - 1);
  let i = 0;
  while (i < ranked.length) {
    let j = i;
    while (j + 1 < ranked.length && ranked[j + 1].ratio === ranked[i].ratio) j++;
    const t = i / last;
    for (let k = i; k <= j; k++) out.set(ranked[k].id, invert ? 1 - t : t);
    i = j + 1;
  }
  return out;
}

// entries: [{ id, game, value }]. Returns Map<id, 0..1>.
export function normalise(entries, { log = false, invert = false, global = false, eraRank = false } = {}) {
  if (eraRank) return eraRanked(entries, invert);
  const out = new Map();
  const byGame = new Map();
  for (const e of entries) {
    // A global input is ranked against every monster at once, so they all share one bucket.
    const bucket = global ? '*' : e.game;
    if (!byGame.has(bucket)) byGame.set(bucket, []);
    byGame.get(bucket).push(e);
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

const TOLERANCES = ['tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun'];

// Will is the sum of the four status tolerances. Immunity is recorded as an ABSENT row,
// not as a zero, so a monster that cannot be stunned at all (Fatalis) would otherwise
// sum only three terms and score as less resilient than one that can be stunned easily.
// An absent status on a monster that records at least one other counts as immunity, and
// scores as the most resistant value seen for that status in that monster's game.
function addToleranceSums(prepared) {
  const maxPerGameStatus = new Map();
  for (const inputs of prepared.values()) {
    for (const k of TOLERANCES) {
      const got = inputs[k];
      if (!got) continue;
      const key = `${got.game}/${k}`;
      maxPerGameStatus.set(key, Math.max(maxPerGameStatus.get(key) ?? 0, got.value));
    }
  }
  for (const inputs of prepared.values()) {
    const present = TOLERANCES.map(k => inputs[k]).filter(Boolean);
    if (!present.length) continue; // no tolerance data at all: a gap for curation
    const game = present[0].game;
    let sum = 0;
    for (const k of TOLERANCES) {
      sum += inputs[k]?.value ?? maxPerGameStatus.get(`${game}/${k}`) ?? 0;
    }
    inputs.tolerance_sum = { value: sum, game };
  }
}

export function computeStats(resolved) {
  const prepared = new Map([...resolved].map(([id, inputs]) => [id, { ...inputs }]));
  addToleranceSums(prepared);

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
