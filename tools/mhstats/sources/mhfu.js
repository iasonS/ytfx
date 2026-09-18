// Freedom Unite extractor. Source: Kolyn090/mhfu-db on GitHub, pinned to a
// fixed commit so the deck stays reproducible. Coverage is uneven across the
// five raw-data files this source needs (49-53 of 60 monsters per file), so
// every lookup below is optional-chained: a missing row or field is an
// omitted input, never a thrown error and never a zero.
import { readFileSync } from 'fs';
import { cachedFetch } from '../lib/fetch.js';
import { obsRow } from '../lib/observations.js';

const REF = '394b2f99a9d56c83153d9dc045e207334bbd1095';
const RAW = `https://raw.githubusercontent.com/Kolyn090/mhfu-db/${REF}/Monsters`;

// Of the seven JSON files in Monsters/, only these five carry any of the raw
// inputs this deck tracks (element-effectiveness.json and monsters.json do
// not: monsters.json has no numeric stats, element-effectiveness only has
// elemental hitzones, which are not one of the 14 RAW_INPUTS).
const FILES = {
  stats: 'stats.json',
  weapon: 'weapon-effectiveness.json',
  status: 'status-effectiveness.json',
  duration: 'basic-parts-duration.json',
  size: 'size.json',
};

function urlFor(key) {
  return `${RAW}/${FILES[key]}`;
}

// The source spells these two roster monsters differently.
const ALIASES = {
  'Terra Shogun Ceanataur': 'Terra S.Ceanataur',
  'Plum Daimyo Hermitaur': 'Plum D.Hermitaur',
};

function sourceNameFor(rosterName) {
  return ALIASES[rosterName] ?? rosterName;
}

// Parts that are only exposed in a special state (an armor-broken shell, an
// internal cavity reached only after breaking through) and would inflate
// hitzone_max_raw if treated as an ordinary external part. Neither contains a
// hyphen, so a hyphen check alone (which does catch state-suffixed parts like
// "head-brokenshell") misses them; a name list is required. Ashen Lao-Shan
// Lung's real external max is 55 (stomach); its "internal" part sits at 90.
const HITZONE_EXCLUDE = new Set(['internal', 'inside-shell']);

// Pure derivation: given the roster's own name for a monster and the five
// parsed JSON tables, return whichever raw inputs this source actually has
// for it. No network, no throwing on a merely-missing row or field.
export function deriveMhfu(name, files) {
  const sourceName = sourceNameFor(name);
  const s = files.stats?.find(r => r?.monster === sourceName);
  if (!s) return {};

  const out = {};

  const healths = s.appear?.filter(a => a?.health != null).map(a => a.health) ?? [];
  if (healths.length) {
    out.base_hp = {
      value: Math.min(...healths),
      unit: 'HP points (raw, min of appear[].health across quests)',
      source: urlFor('stats'),
    };
  }

  if (Number.isFinite(s['attack-enraged'])) {
    out.enrage_attack_mult = { value: s['attack-enraged'], unit: 'multiplier (x)', source: urlFor('stats') };
  }

  const w = files.weapon?.find(r => r?.monster === sourceName);
  const parts = (w?.parts ?? []).filter(p => p?.part && !p.part.includes('-') && !HITZONE_EXCLUDE.has(p.part));
  const raws = parts.flatMap(p => [p.slash, p.strike, p.shooting]).filter(v => Number.isFinite(v));
  if (raws.length) {
    out.hitzone_max_raw = {
      value: Math.max(...raws),
      unit: 'percent (raw hitzone, external non-conditional parts, max of slash/strike/shooting)',
      source: urlFor('weapon'),
    };
  }

  const d = files.duration?.find(r => r?.monster === sourceName);
  const head = d?.parts?.find(p => p?.part === 'head');
  if (Number.isFinite(head?.duration)) {
    out.head_stagger = { value: head.duration, unit: 'flinch/stagger damage threshold (raw)', source: urlFor('duration') };
  }

  const sz = files.size?.find(r => r?.monster === sourceName);
  if (Number.isFinite(sz?.default)) {
    out.size_base = { value: sz.default, unit: 'cm', source: urlFor('size') };
  }
  if (Number.isFinite(sz?.['golden-largest-min'])) {
    out.size_gold = { value: sz['golden-largest-min'], unit: 'cm', source: urlFor('size') };
  }

  const st = files.status?.find(r => r?.monster === sourceName);
  const tolerance = type => st?.types?.find(t => t?.type === type)?.['initial-tolerance'];
  const statusMap = {
    tolerance_poison: tolerance('poison'),
    tolerance_paralysis: tolerance('paralyze'),
    tolerance_sleep: tolerance('sleep'),
    tolerance_stun: tolerance('knockout'),
  };
  for (const [input, value] of Object.entries(statusMap)) {
    if (Number.isFinite(value)) out[input] = { value, unit: 'status build-up points', source: urlFor('status') };
  }

  return out;
}

export async function extract(roster) {
  const mine = roster.filter(r => r.source === 'FU');

  const files = {};
  for (const key of Object.keys(FILES)) {
    files[key] = await cachedFetch(urlFor(key), { as: 'json', cacheName: `mhfu-${FILES[key]}` });
  }

  const missing = [];
  const rows = [];
  for (const r of mine) {
    const sourceName = sourceNameFor(r.name);
    const hasRow = files.stats?.some(row => row?.monster === sourceName);
    if (!hasRow) {
      missing.push(r.name);
      continue;
    }
    const derived = deriveMhfu(r.name, files);
    for (const [input, { value, unit, source }] of Object.entries(derived)) {
      rows.push(obsRow({ monster: r.id, game: 'MHFU', input, value, unit, source }));
    }
  }

  if (missing.length) {
    throw new Error(`mhfu: no stats.json row for: ${missing.join(', ')}`);
  }

  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const roster = JSON.parse(readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
  const mine = roster.filter(r => r.source === 'FU');
  const rows = await extract(roster);

  const byInput = {};
  for (const row of rows) byInput[row.input] = (byInput[row.input] ?? 0) + 1;

  console.log(`mhfu: ${mine.length} monsters, ${rows.length} rows, ${Object.keys(byInput).length} inputs`);
  console.log('coverage by input (of', mine.length, 'monsters):');
  for (const input of Object.keys(byInput).sort()) {
    console.log(`  ${input.padEnd(20)} ${byInput[input]}`);
  }
}
