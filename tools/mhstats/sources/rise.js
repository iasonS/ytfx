// Rise (+ Sunbreak) extractor. Source: the MHRice machine-readable dump
// (https://mhrice.info/mhrice.json, ~124 MB pretty-printed JSON). See
// docs/superpowers/research/2026-09-18-source-locators.md, section
// "######## Rise", for the verified locators this follows. That card has no
// FAILED corrections (its skeptic re-run on a held-out monster, Aknosom,
// confirmed every locator), so the FIELDS section is followed literally.
//
// THE TRAP this file exists to not fall into: status tolerances are not the
// monster's own numbers. `condition_damage_data.<status>_data.preset_type`
// indexes `condition_preset.<status>_data[]`; the monster's own
// `default_stock` applies only when `preset_type` equals that list's length
// (poison 7, paralyze 6, sleep 4, stun 6). Reading the raw value gives
// Magnamalo a poison tolerance of 0 and Rathian 180 instead of 250.
//
// Parsing the full file needs ~2 GB of heap (run with
// `node --max-old-space-size=4096`), so this module reduces it to a slim
// derived cache (tools/mhstats/.cache/rise-slim.json, a few hundred KB) on
// first run; every later run reads the slim file instead and needs no extra
// heap. The parsed object is never printed.
//
// Field-choice notes (recorded here, and in each row's `unit`, because the
// source has more than one candidate for some fields):
//   - base_hp uses `data_tune.base_hp_vital` (the card's primary locator),
//     not `master_hp_vital` (an MR-specific override that differs for 17 of
//     the 78 monsters, e.g. Khezu 4200 vs 3600). The card lists base_hp_vital
//     as *the* locator and master_hp_vital only as a parenthetical aside.
//   - head_stagger uses `enemy_parts_data[q].vital`, not `.master_vital`
//     (same primary-vs-aside distinction; -1 there means "no MR override").
//   - enrage_trigger uses `anger_data.data_info[1]` (High Rank), per this
//     task's explicit instruction, not the Master Rank entry (index 3).
//   - hitzone_max_raw is the max raw hitzone (slash/strike/shell) over EVERY
//     body part and phase, not just the head — confirmed against the card's
//     own Magnamalo example, where the global max (63) differs from the
//     head's own max (55).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cachedFetch, CACHE_DIR } from '../lib/fetch.js';
import { obsRow } from '../lib/observations.js';

const MHRICE_URL = 'https://mhrice.info/mhrice.json';
const GAME = 'MHRS';
const SLIM_CACHE_PATH = join(CACHE_DIR, 'rise-slim.json');

// The source's own spelling matches the roster's for all 73 Rise monsters as
// of 2026-09-18 (verified by diffing the full name lists). Kept explicit per
// the shared contract in case a future roster or source spelling drifts.
const ALIASES = {};

// Status preset list lengths (condition_preset.<status>_data.length). A
// monster's preset_type equal to this means "unique, use my own numbers".
const PRESET_LENGTH = { poison: 7, paralyze: 6, sleep: 4, stun: 6 };

const HEAD_RE = /頭|トサカ/;
const HEAD_EXCLUDE_RE = /泥|第一形態/;

const UNITS = {
  base_hp: 'HP (base_hp_vital, LR/HR)',
  size_base: 'cm',
  size_gold: 'cm (base_size * king_boarder)',
  enrage_attack_mult: 'multiplier',
  enrage_speed_mult: 'motion-rate multiplier',
  enrage_trigger: 'damage points (High Rank)',
  enrage_duration: 'seconds',
  hitzone_max_raw: 'hitzone percent (max over all parts and phases)',
  head_stagger: 'part vital (flinch value, LR/HR)',
  tolerance_poison: 'status build-up points',
  tolerance_paralysis: 'status build-up points',
  tolerance_sleep: 'status build-up points',
  tolerance_stun: 'status build-up points',
  move_power_max: 'raw damage (max base_damage)',
};

// em_type.Em == id | (sub_id << 8). Decomposing the other way lets buildSlimCache
// assert the identity holds for every monster, including sub-id forms such as
// Risen Teostra (id 27, sub_id 8, em 2075).
export function decomposeEm(em) {
  return { id: em & 0xff, subId: em >> 8 };
}

// Resolves one status tolerance to the value the game actually uses: the
// preset's value, unless preset_type points past the end of the preset list,
// in which case the monster's own value is the real one.
function resolveTolerance(t) {
  if (!t) return undefined;
  return t.presetType === t.presetLength ? t.ownLimit : t.presetLimit;
}

// Lowest partMap index whose name matches the head regex and not the
// mud/first-form exclusion, then that index's part vital. The head is not
// always index 0 (Rathalos family = 6, Basarios = 5, Volvidon = 1, the
// Somnacanth pair = 1); this is why it must be searched, not assumed.
function findHeadStagger(partMap, enemyPartsData) {
  if (!partMap || !enemyPartsData) return undefined;
  const keys = Object.keys(partMap).map(Number).sort((a, b) => a - b);
  for (const k of keys) {
    const names = partMap[String(k)];
    if (names.some(s => HEAD_RE.test(s) && !HEAD_EXCLUDE_RE.test(s))) {
      const part = enemyPartsData[k];
      return part ? part.vital : undefined;
    }
  }
  return undefined;
}

// Global max raw hitzone over every body part and phase, skipping the
// all-zero padding groups (meat_container is always padded to 16 slots).
function hitzoneMaxRaw(meatGroups) {
  let max = -Infinity;
  for (const g of meatGroups) {
    if (g.slash === 0 && g.strike === 0 && g.shell === 0) continue;
    max = Math.max(max, g.slash, g.strike, g.shell);
  }
  return max === -Infinity ? undefined : max;
}

/**
 * Pure: derive this source's raw-input values from one slim-cache entry
 * (see buildSlimCache). Returns { [input]: value }; a genuinely missing
 * input is simply absent, never zero.
 */
export function deriveRise(entry) {
  const out = {};

  if (Number.isFinite(entry.baseHpVital)) out.base_hp = entry.baseHpVital;
  if (Number.isFinite(entry.sizeBase)) out.size_base = entry.sizeBase;
  if (Number.isFinite(entry.sizeBase) && Number.isFinite(entry.kingBoarder)) {
    out.size_gold = entry.sizeBase * entry.kingBoarder;
  }

  const anger = entry.anger;
  if (anger) {
    if (Number.isFinite(anger.atkRate)) out.enrage_attack_mult = anger.atkRate;
    if (Number.isFinite(anger.motRate)) out.enrage_speed_mult = anger.motRate;
    if (Array.isArray(anger.dataInfo) && Number.isFinite(anger.dataInfo[1])) {
      out.enrage_trigger = anger.dataInfo[1];
    }
    if (Number.isFinite(anger.timer)) out.enrage_duration = anger.timer;
  }

  if (Array.isArray(entry.meatGroups)) {
    const h = hitzoneMaxRaw(entry.meatGroups);
    if (h !== undefined) out.hitzone_max_raw = h;
  }

  const stagger = findHeadStagger(entry.partMap, entry.enemyPartsData);
  if (Number.isFinite(stagger)) out.head_stagger = stagger;

  if (entry.tolerances) {
    const poison = resolveTolerance(entry.tolerances.poison);
    if (Number.isFinite(poison)) out.tolerance_poison = poison;
    const paralysis = resolveTolerance(entry.tolerances.paralysis);
    if (Number.isFinite(paralysis)) out.tolerance_paralysis = paralysis;
    const sleep = resolveTolerance(entry.tolerances.sleep);
    if (Number.isFinite(sleep)) out.tolerance_sleep = sleep;
    const stun = resolveTolerance(entry.tolerances.stun);
    if (Number.isFinite(stun)) out.tolerance_stun = stun;
  }

  if (Array.isArray(entry.atkColliders) && entry.atkColliders.length) {
    const damages = entry.atkColliders.map(c => c.baseDamage).filter(Number.isFinite);
    if (damages.length) out.move_power_max = Math.max(...damages);
  }

  return out;
}

function resolveName(raw, enemyType) {
  const key = `EnemyIndex${String(enemyType).padStart(3, '0')}`;
  const entry = raw.monster_names.entries.find(e => e.name === key);
  if (entry) return entry.content[1];
  const mrKey = `${key}_MR`;
  const mrEntry = raw.monster_names_mr.entries.find(e => e.name === mrKey);
  return mrEntry ? mrEntry.content[1] : null;
}

// Reduces the ~124 MB parsed dump to a slim per-monster cache with only the
// fields deriveRise needs. Written once to tools/mhstats/.cache/rise-slim.json
// (gitignored); every later run reads that instead of re-parsing the dump.
export async function buildSlimCache() {
  if (existsSync(SLIM_CACHE_PATH)) {
    return JSON.parse(readFileSync(SLIM_CACHE_PATH, 'utf8'));
  }

  const raw = await cachedFetch(MHRICE_URL, { as: 'json', cacheName: 'mhrice.json' });

  const mlistEms = new Set(raw.monster_list.data_list.map(e => e.em_type.Em));
  const sizeByEm = new Map(raw.size_list.size_info_list.map(s => [s.em_type.Em, s]));
  const presets = raw.condition_preset;

  const slim = [];
  for (const m of raw.monsters) {
    const em = m.em_type.Em;
    if (!mlistEms.has(em)) continue; // drops the 131_00 Toadversary dummy

    const { id: decId, subId: decSubId } = decomposeEm(em);
    if (decId !== m.id || decSubId !== m.sub_id) {
      throw new Error(`rise: em ${em} does not decompose to id/sub_id ${m.id}/${m.sub_id} (got ${decId}/${decSubId})`);
    }

    const nameEn = resolveName(raw, m.enemy_type);
    if (!nameEn) throw new Error(`rise: no English name for enemy_type ${m.enemy_type} (em ${em})`);

    const size = sizeByEm.get(em);
    const cd = m.condition_damage_data;
    const tol = (status, key, len) => ({
      ownLimit: cd[key].default_stock.default_limit,
      presetType: cd[key].preset_type,
      presetLength: len,
      presetLimit: cd[key].preset_type < len
        ? presets[key][cd[key].preset_type].default_stock.default_limit
        : undefined,
    });

    slim.push({
      id: m.id,
      subId: m.sub_id,
      em,
      nameEn,
      baseHpVital: m.data_tune.base_hp_vital,
      sizeBase: size?.base_size,
      kingBoarder: size?.king_boarder,
      anger: {
        atkRate: m.anger_data.atk_rate,
        motRate: m.anger_data.mot_rate,
        timer: m.anger_data.timer,
        dataInfo: m.anger_data.data_info.map(d => d.val),
      },
      meatGroups: m.meat_data.meat_container.flatMap(p => p.meat_group_info.map(g => ({
        slash: g.slash, strike: g.strike, shell: g.shell,
      }))),
      partMap: m.collider_mapping.part_map,
      enemyPartsData: m.data_tune.enemy_parts_data.map(p => ({ vital: p.vital, masterVital: p.master_vital })),
      tolerances: {
        poison: tol('poison', 'poison_data', PRESET_LENGTH.poison),
        paralysis: tol('paralysis', 'paralyze_data', PRESET_LENGTH.paralyze),
        sleep: tol('sleep', 'sleep_data', PRESET_LENGTH.sleep),
        stun: tol('stun', 'stun_data', PRESET_LENGTH.stun),
      },
      atkColliders: m.atk_colliders.map(c => ({ baseDamage: c.data.base_damage, power: c.data.power })),
    });
  }

  writeFileSync(SLIM_CACHE_PATH, JSON.stringify(slim));
  return slim;
}

export async function extract(roster) {
  const riseRoster = roster.filter(r => r.source === 'Rise');
  const slim = await buildSlimCache();
  const byName = new Map(slim.map(s => [s.nameEn, s]));

  const rows = [];
  const unmatched = [];
  for (const entry of riseRoster) {
    const sourceName = ALIASES[entry.name] ?? entry.name;
    const slimEntry = byName.get(sourceName);
    if (!slimEntry) {
      unmatched.push(entry.name);
      continue;
    }
    const derived = deriveRise(slimEntry);
    for (const [input, value] of Object.entries(derived)) {
      rows.push(obsRow({ monster: entry.id, game: GAME, input, value, unit: UNITS[input], source: MHRICE_URL }));
    }
  }

  if (unmatched.length) {
    throw new Error(`rise: unmatched roster monsters: ${unmatched.join(', ')}`);
  }

  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rosterPath = new URL('../data/roster.json', import.meta.url);
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8')).filter(r => r.source === 'Rise');
  const rows = await extract(roster);

  const RAW_INPUTS_ORDER = Object.keys(UNITS);
  const counts = Object.fromEntries(RAW_INPUTS_ORDER.map(i => [i, 0]));
  for (const r of rows) counts[r.input]++;

  console.log(`rise: ${roster.length} monsters, ${rows.length} rows`);
  for (const input of RAW_INPUTS_ORDER) {
    console.log(`  ${input.padEnd(20)} ${counts[input]}/${roster.length}`);
  }
}
