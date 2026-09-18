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
// "Ashen Lao-Shan Lung" -> "Lao-Shan Lung". Longest match wins, the boundary must be
// a space so "Great Jagras" does not match a "Jagras", and a monster is never its own base.
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
