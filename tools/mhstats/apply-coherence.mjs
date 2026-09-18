// Merges the coherence review into data/ratings.json.
//
// The earlier passes rated each stat on its own: one agent judged Speed for forty monsters,
// another judged Temper. That catches a wrong value but not a wrong MONSTER — a card can be
// defensible on every line and still not read as the thing you fought. This pass asked two
// different questions instead: does the sum of the seven stats order the roster sensibly,
// and do a monster's seven numbers hang together as a portrait of it. One reviewer read the
// whole 252-card ranking, eight read about thirty complete cards each, and a consolidator
// merged them, dropped anything only one unsure reviewer raised, and resolved disagreements.
//
// Only judged stats are written here. Findings against HP, Defense, Will and Size went to
// data/curation-report.md instead: those come from the games, so a bad one is a source or
// normalisation problem and inventing a replacement would hide it.
import { readFileSync, writeFileSync } from 'fs';

const DATA = new URL('./data/', import.meta.url).pathname;
const RATED = ['spd', 'atk', 'tmp'];

const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
const byName = new Map(roster.map(r => [r.name, r.id]));
const ratings = JSON.parse(readFileSync(`${DATA}ratings.json`, 'utf8'));
const byId = new Map(ratings.map(r => [r.id, { ...r }]));

const edits = JSON.parse(readFileSync(process.argv[2] ?? `${DATA}coherence.json`, 'utf8'));

let applied = 0;
for (const e of edits) {
  const id = byName.get(e.name);
  if (!id) throw new Error(`coherence edit names unknown monster ${e.name}`);
  const r = byId.get(id);
  if (!r) throw new Error(`${e.name} has no ratings row`);
  if (!RATED.includes(e.stat)) {
    throw new Error(`${e.name}.${e.stat} is measured, not judged — it cannot be set here`);
  }
  if (!Number.isInteger(e.suggested) || e.suggested < 1 || e.suggested > 300) {
    throw new Error(`${e.name}.${e.stat} = ${e.suggested} is outside 1..300`);
  }
  // The review read the deck, so a stale "current" means the card moved under it and the
  // reasoning may no longer apply.
  if (r[e.stat] !== e.current) {
    throw new Error(`${e.name}.${e.stat} is ${r[e.stat]}, but the review saw ${e.current}`);
  }
  r[e.stat] = e.suggested;
  r[`${e.stat}_reason`] = `${e.why} (coherence review)`;
  applied++;
}

const out = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
for (const r of out) {
  for (const k of RATED) {
    if (!Number.isInteger(r[k]) || r[k] < 1 || r[k] > 300) throw new Error(`${r.id}.${k} = ${r[k]} is outside 1..300`);
    if (!r[`${k}_reason`]) throw new Error(`${r.id}.${k} has no reason`);
  }
}

// Rajang tops Temper, by the owner's call.
const ranked = out.slice().sort((a, b) => b.tmp - a.tmp);
if (ranked[0].name !== 'Rajang') {
  throw new Error(`Rajang must be the highest Temper; ${ranked[0].name} is at ${ranked[0].tmp}`);
}

writeFileSync(`${DATA}ratings.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`coherence: ${applied} of ${edits.length} edits applied across ${out.length} monsters`);
const byStat = {};
for (const e of edits) byStat[e.stat] = (byStat[e.stat] ?? 0) + 1;
console.log('  by stat:', byStat);
