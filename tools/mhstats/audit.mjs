// Audits the built deck for values that do not make sense.
// Run: node tools/mhstats/audit.mjs
//
// Three bad stats shipped before this existed, all the same mistake: an extremal or
// relative figure standing in for an absolute quality. Attack used how much a monster
// GAINS when enraged, then the single biggest move in its table. Speed used how much it
// accelerates when enraged. Defense used its single softest hitzone. Each looked fine in
// a small sample and collapsed across 252 monsters. These checks are what would have
// caught them.
import { readFileSync } from 'fs';
import { baseSpeciesOf } from './merge.js';
import { STAT_DEFS, STAT_MAX } from './scale.js';

const DATA = new URL('./data/', import.meta.url).pathname;
const deck = JSON.parse(readFileSync(new URL('../../public/mhstats/deck.json', import.meta.url).pathname, 'utf8'));
const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
const KEYS = STAT_DEFS.map(d => d.key);
const LABEL = Object.fromEntries(STAT_DEFS.map(d => [d.key, d.label]));
const byId = new Map(deck.monsters.map(m => [m.id, m]));

const findings = [];
const flag = (severity, stat, msg) => findings.push({ severity, stat, msg });

// ---- 1. Distribution health -------------------------------------------------------
// A stat that piles monsters onto the floor or ceiling is not measuring anything.
console.log('DISTRIBUTION');
console.log('stat      distinct  biggest  at floor  at ceiling   p10   p50   p90');
for (const k of KEYS) {
  const vals = deck.monsters.map(m => m.stats[k]).sort((a, b) => a - b);
  const counts = new Map();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const atFloor = vals.filter(v => v === 1).length;
  const atCeil = vals.filter(v => v === STAT_MAX).length;
  const q = p => vals[Math.floor((vals.length - 1) * p)];
  const biggest = Math.max(...counts.values());
  console.log(`${LABEL[k].padEnd(9)}${String(counts.size).padStart(6)}${String(biggest).padStart(9)}` +
    `${String(atFloor).padStart(10)}${String(atCeil).padStart(12)}${String(q(0.1)).padStart(6)}${String(q(0.5)).padStart(6)}${String(q(0.9)).padStart(6)}`);

  // Normalisation clips at the 2nd and 98th percentile, which pins about five monsters at
  // each end by design, plus whoever ties with them. Only a much larger pile means the
  // input itself saturates, which is how Defense-by-softest-hitzone was caught (ten at the
  // floor including Fatalis and Dalamadur).
  if (atFloor > 15) flag('HIGH', k, `${atFloor} monsters pinned at the floor — the input probably saturates`);
  if (atCeil > 15) flag('HIGH', k, `${atCeil} monsters pinned at the ceiling — the input probably saturates`);
  if (biggest > 25) flag('MEDIUM', k, `${biggest} monsters share one value`);
  if (counts.size < 30) flag('MEDIUM', k, `only ${counts.size} distinct values across 252 monsters`);
}

// ---- 2. Variants against their base species ---------------------------------------
// A Deviant, Apex, Risen or subspecies form is a harder version of the base. Scoring
// BELOW its base on a combat stat is nearly always an error, not a design choice.
const COMBAT = ['hp', 'atk', 'def', 'spd', 'wil', 'tmp'];
let variantChecks = 0;
const variantIssues = [];
for (const entry of roster) {
  const base = baseSpeciesOf(entry.id, roster);
  if (!base) continue;
  const me = byId.get(entry.id), them = byId.get(base);
  if (!me || !them) continue;
  variantChecks++;
  for (const k of COMBAT) {
    const gap = them.stats[k] - me.stats[k];
    if (gap > 40) variantIssues.push(`${me.name} ${LABEL[k]} ${me.stats[k]} is ${gap} below ${them.name} (${them.stats[k]})`);
  }
}

// ---- 2b. A variant's measured LENGTH against its base species ----------------------
// Size is left out of the combat check above, because a variant has no obligation to be
// bigger. What it cannot be is a different animal: across the roster a deviant measures
// 1.15 to 1.5 times its base. Anything outside 0.5x to 2x means the two rows were taken
// on different conventions, which is how Kiranico has Stonefist Hermitaur at 1494.73cm
// against Daimyo Hermitaur's 495 — both with self-consistent crowns, three times apart,
// leaving the base species at the roster's Size floor and its deviant at 139.
const rawCm = m => {
  const got = /^([\d.]+)/.exec(m?.raw?.size_base ?? '');
  return got ? Number(got[1]) : null;
};
// baseSpeciesOf matches a full name suffix, so it links "Pink Rathian" to "Rathian" but
// not "Stonefist Hermitaur" to "Daimyo Hermitaur" — no bare "Hermitaur" is on the roster.
// For this check only, fall back to the last word of the name and take the shortest
// candidate as the base. The audit reports; it does not change what the deck inherits.
const genusBaseOf = id => {
  const self = roster.find(r => r.id === id);
  if (!self) return null;
  const genus = self.name.split(' ').pop();
  if (self.name === genus) return null;
  const kin = roster.filter(r => r.id !== id && r.name !== genus && r.name.split(' ').pop() === genus);
  if (!kin.length) return null;
  return kin.reduce((a, b) => (a.name.length <= b.name.length ? a : b)).id;
};

const sizeIssues = [];
const seenPair = new Set();
for (const entry of roster) {
  const base = baseSpeciesOf(entry.id, roster) ?? genusBaseOf(entry.id);
  if (!base) continue;
  const pair = [entry.id, base].sort().join('/');
  if (seenPair.has(pair)) continue;
  seenPair.add(pair);
  const me = rawCm(byId.get(entry.id)), them = rawCm(byId.get(base));
  if (!me || !them) continue;
  const ratio = me / them;
  if (ratio < 0.5 || ratio > 2) {
    sizeIssues.push(`${byId.get(entry.id).name} measures ${me}cm against ${byId.get(base).name}'s ${them}cm ` +
      `(${ratio.toFixed(2)}x) — one of the two rows uses a different convention`);
  }
}

// ---- 3. Sanity anchors ------------------------------------------------------------
// What a Monster Hunter player would object to on sight. Each is a band, not a number,
// so a rating can move without tripping it.
const pct = (k, id) => {
  const vals = deck.monsters.map(m => m.stats[k]).sort((a, b) => a - b);
  const v = byId.get(id)?.stats[k];
  return v === undefined ? null : vals.filter(x => x < v).length / vals.length;
};
const EXPECT = [
  ['atk', 'fatalis', 0.9, 1, 'the series damage ceiling'],
  ['atk', 'alatreon', 0.8, 1, 'an elder dragon that punishes in every element'],
  ['atk', 'teostra', 0.6, 1, 'an elder dragon'],
  ['atk', 'velkhana', 0.6, 1, 'an Iceborne flagship elder'],
  ['atk', 'deviljho', 0.8, 1, 'famous for raw damage'],
  ['atk', 'brachydios', 0.6, 1, 'slime detonations on top of heavy punches'],
  ['atk', 'great-jagras', 0, 0.2, 'a starter monster'],
  ['atk', 'kulu-ya-ku', 0, 0.3, 'an early-game bird wyvern'],
  ['spd', 'nargacuga', 0.9, 1, 'the speed archetype of the series'],
  ['spd', 'rajang', 0.85, 1, 'sprints, leaps and punches in flurries'],
  ['spd', 'glavenus', 0.6, 1, 'huge tail, fast swings: bulk is not slowness'],
  ['spd', 'zorah-magdaros', 0, 0.05, 'a walking landmass'],
  ['spd', 'basarios', 0, 0.15, 'mostly buried or stationary'],
  // Defense is how hard a monster is to DAMAGE, which is not the same as how armoured it
  // looks. Kirin has some of the lowest hitzones in the series despite being a slender
  // horse, and Fatalis is mid because its head is soft and that is what hunters hit.
  ['def', 'gravios', 0.75, 1, 'armour plating is its whole identity'],
  ['def', 'kirin', 0.7, 1, 'low hitzones everywhere: it takes reduced damage from everything'],
  ['def', 'great-jagras', 0, 0.2, 'soft all over, the softest thing in the early game'],
  ['def', 'uth-duna', 0, 0.25, 'its water veil is the softest surface on any Wilds monster'],
  ['wil', 'zorah-magdaros', 0.85, 1, 'immune to every status'],
  ['wil', 'jhen-mohran', 0.85, 1, 'immune to every status'],
  ['hp', 'great-jagras', 0, 0.25, 'a starter monster'],
  ['siz', 'dalamadur', 0.95, 1, 'the longest monster in the series'],
  ['siz', 'kirin', 0, 0.2, 'a slender horse-sized elder'],
];

console.log('\nSANITY ANCHORS');
for (const [k, id, lo, hi, why] of EXPECT) {
  const p = pct(k, id);
  if (p === null) { flag('HIGH', k, `anchor monster ${id} is missing from the deck`); continue; }
  const ok = p >= lo && p <= hi;
  const band = `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${LABEL[k].padEnd(8)}${(byId.get(id)?.name ?? id).padEnd(20)}` +
    `at ${String(Math.round(p * 100)).padStart(3)}th pct (want ${band})  — ${why}`);
  if (!ok) flag('HIGH', k, `${byId.get(id)?.name ?? id} sits at the ${Math.round(p * 100)}th percentile of ${LABEL[k]}, expected ${band}: ${why}`);
}

// ---- 4. Report --------------------------------------------------------------------
console.log(`\nVARIANTS (${variantChecks} checked against their base species)`);
if (!variantIssues.length) console.log('  none more than 40 points below their base');
for (const v of variantIssues.slice(0, 20)) console.log(`  ${v}`);
if (variantIssues.length > 20) console.log(`  ... and ${variantIssues.length - 20} more`);
if (variantIssues.length) flag('MEDIUM', 'variants', `${variantIssues.length} variants sit well below their base species`);

console.log('\nSIZE CONVENTION (a variant measured against its base species)');
if (!sizeIssues.length) console.log('  every variant measures within 0.5x to 2x of its base');
for (const v of sizeIssues) console.log(`  ${v}`);
if (sizeIssues.length) flag('HIGH', 'siz', `${sizeIssues.length} species have a variant measured on a different convention from its base`);

// ---- 3b. Extremes: anything very low or very high is worth a second look -----------
const LOW = 50, HIGH = 250;
const extremes = [];
for (const m of deck.monsters) {
  for (const k of KEYS) {
    const v = m.stats[k];
    if (v < LOW || v > HIGH) extremes.push({ name: m.name, stat: k, v, high: v > HIGH });
  }
}
console.log(`\nEXTREME VALUES (under ${LOW} or over ${HIGH}): ${extremes.length} of ${deck.monsters.length * KEYS.length}`);
for (const k of KEYS) {
  const mine = extremes.filter(e => e.stat === k);
  const hi = mine.filter(e => e.high).sort((a, b) => b.v - a.v);
  const lo = mine.filter(e => !e.high).sort((a, b) => a.v - b.v);
  console.log(`  ${LABEL[k]}: ${lo.length} under ${LOW}, ${hi.length} over ${HIGH}`);
  if (hi.length) console.log(`    highest: ${hi.slice(0, 8).map(e => `${e.name} ${e.v}`).join(', ')}`);
  if (lo.length) console.log(`    lowest:  ${lo.slice(0, 8).map(e => `${e.name} ${e.v}`).join(', ')}`);
}

console.log('\nEXTREMES');
for (const k of KEYS) {
  const s = deck.monsters.slice().sort((a, b) => b.stats[k] - a.stats[k]);
  console.log(`  ${LABEL[k]}`);
  console.log(`    top: ${s.slice(0, 5).map(m => `${m.name} ${m.stats[k]}`).join(', ')}`);
  console.log(`    bot: ${s.slice(-5).map(m => `${m.name} ${m.stats[k]}`).join(', ')}`);
}

console.log('\nFINDINGS');
const high = findings.filter(f => f.severity === 'HIGH');
const med = findings.filter(f => f.severity === 'MEDIUM');
for (const f of [...high, ...med]) console.log(`  ${f.severity.padEnd(7)}${LABEL[f.stat] ?? f.stat}: ${f.msg}`);
if (!findings.length) console.log('  nothing to report');
console.log(`\n${high.length} high, ${med.length} medium`);
process.exit(high.length ? 1 : 0);
