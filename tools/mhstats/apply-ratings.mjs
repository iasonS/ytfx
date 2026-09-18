// Rebuilds data/ratings.json, the hand-rated half of the deck.
//
// Two of the seven stats have no trustworthy published figure, so both are judged against
// a fixed anchor table with a written reason per value:
//   Speed  — no mainline game publishes an absolute movement speed. Verified across all
//            seven sources and the full Rise data dump, where the only move_speed field is
//            populated for Zinogre alone. The enrage motion multiplier was tried and
//            rejected: it measures how much a monster speeds up when angry, which is
//            largest for slow ones, and ranked Basarios and Khezu as the fastest in the game.
//   Attack — two published figures were tried and both failed. The enrage attack multiplier
//            measures how much a monster GAINS when enraged and put Dodogama beside
//            Alatreon. Per-move damage from the game files looked like the fix and was not:
//            it scored Great Jagras above Teostra, put Velkhana at the floor, and made a
//            mid-tier Sunbreak monster the hardest hitter in the series.
//
// Inputs, both durable:
//   data/ratings.json                      the committed base (252 Speed, 105 Attack)
//   <cache>/ratings/pass2-attack.json      the second Attack pass (the remaining 146)
//
// Run: node tools/mhstats/apply-ratings.mjs
import { readFileSync, writeFileSync } from 'fs';

const DATA = new URL('./data/', import.meta.url).pathname;
const CACHE = '/home/unix/tmp/mhstats-cache/ratings/';

const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
const ids = new Set(roster.map(r => r.id));

const base = JSON.parse(readFileSync(`${DATA}ratings.json`, 'utf8'));
const byId = new Map(base.filter(r => ids.has(r.id)).map(r => [r.id, { ...r }]));

// Overlay the second Attack pass, which covered every monster the first one skipped.
const second = JSON.parse(readFileSync(process.argv[2] ?? `${CACHE}pass2-attack.json`, 'utf8'));
let merged = 0;
for (const r of second.ratings) {
  const mine = byId.get(r.id);
  if (!mine) continue;
  mine.atk = r.atk;
  mine.atk_reason = r.atk_reason;
  merged++;
}

// One monster the second pass skipped, placed against its own base form (Malzeno 215)
// and its Sunbreak peers (Gaismagorm 250, Risen Shagaru Magala 230).
const MISSED = [
  ['primordial-malzeno', 255, 'the Sunbreak endgame form, whose bloodblight strikes drain as they land, above base Malzeno and its Risen peers'],
];
for (const [id, value, why] of MISSED) {
  const r = byId.get(id);
  if (!r) throw new Error(`missed-attack entry names unknown monster ${id}`);
  if (r.atk === undefined) { r.atk = value; r.atk_reason = why; }
}

// The second pass's calibration reviewer read the whole Attack ranking as one list and
// caught three: one elder rated on how seldom it attacks rather than how hard, and two
// variants that failed to sit above their own base species.
const ATK_CORRECTIONS = [
  ['zorah-magdaros', 150, 'an elder dragon rated on how seldom it attacks rather than how hard'],
  ['blackveil-vaal-hazak', 195, 'a variant must not sit below its own base species'],
  ['rusted-kushala-daora', 210, 'a variant tied exactly with its base instead of sitting above it'],
];
for (const [id, value, why] of ATK_CORRECTIONS) {
  const r = byId.get(id);
  if (!r) throw new Error(`attack correction names unknown monster ${id}`);
  r.atk = value;
  r.atk_reason = `${why} (calibration correction)`;
}

const out = [...byId.values()]
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(r => ({ id: r.id, name: r.name, spd: r.spd, spd_reason: r.spd_reason, atk: r.atk, atk_reason: r.atk_reason }));

// Both stats are now rated for every monster: a gap here is a real gap in the deck.
const gaps = [];
for (const r of out) {
  for (const k of ['spd', 'atk']) {
    const v = r[k];
    if (v === undefined) { gaps.push(`${r.id}.${k}`); continue; }
    if (!Number.isInteger(v) || v < 1 || v > 300) throw new Error(`${r.id}.${k} = ${v} is outside 1..300`);
    if (!r[`${k}_reason`]) throw new Error(`${r.id}.${k} has no reason`);
  }
}
if (out.length !== roster.length) throw new Error(`rated ${out.length} monsters, roster has ${roster.length}`);
if (gaps.length) throw new Error(`${gaps.length} unrated: ${gaps.slice(0, 10).join(', ')}`);

writeFileSync(`${DATA}ratings.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`ratings: ${out.length} monsters, Speed and Attack both rated ` +
  `(${merged} merged from the second attack pass, ${ATK_CORRECTIONS.length} calibration corrections)`);
