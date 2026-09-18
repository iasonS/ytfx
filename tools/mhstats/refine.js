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
      if (!g) {
        throw new Error(`${r.id} is not in a tie group for ${statKey}; refinement may not reorder what the sources separated`);
      }
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
