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
  lines.push('The sources tied these monsters. Ranking orders them inside the band the data set;',
    'none of them crosses a monster the data placed above it.', '');
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
