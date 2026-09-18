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
  // Temper is the mean of "snaps sooner" and "stays angry longer". A monster strong in
  // one and weak in the other lands mid-scale by design, not by accident.
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
