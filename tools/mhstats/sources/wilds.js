// Wilds extractor: joins the mhdb.io Wilds API with the robomeche game-data
// dump on gameId. See docs/superpowers/research/2026-09-18-source-locators.md
// ("######## Wilds") for the verified locators this follows.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { cachedFetch } from '../lib/fetch.js';
import { obsRow, RAW_INPUTS } from '../lib/observations.js';

const MHDB_URL = 'https://wilds.mhdb.io/en/monsters';
const ROBO_URL = 'https://raw.githubusercontent.com/robomeche/MHWilds-Database/main/monster/assets/json/MHWilds_Data_compact.json.gz';
const GAME = 'MHWilds';

// The robomeche dump's arena dummy. Absent from mhdb; dropped by name so a
// future roster addition can't accidentally resurrect it.
const BARREL_PUNCHER = 'High Purrformance Barrel Puncher';

// Roster names (from monsterhunterwiki.org) and mhdb names are identical for
// all 34 Wilds monsters as of 2026-09-18; kept explicit per the shared
// contract in case a future roster spelling drifts.
const ALIASES = {};

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// Pure: derive raw-input rows (without monster/game, which extract() adds)
// from one mhdb monster record and its joined robomeche record. Never throws
// on a missing field or a null AngryTable/Hitzones/ConditionTable — those are
// omitted rows, not zeros.
export function deriveWilds(mhdbMonster, roboRecord) {
  const rows = [];
  const push = (input, value, unit, source) => {
    if (!isNum(value)) return;
    rows.push({ input, value, unit, source });
  };

  push('base_hp', mhdbMonster?.baseHealth, 'HP points', MHDB_URL);
  push('size_base', mhdbMonster?.size?.base, 'cm', MHDB_URL);
  push('size_gold', mhdbMonster?.size?.gold, 'cm', MHDB_URL);

  const angry = roboRecord?.AngryTable?.[0]?.Upper;
  if (angry) {
    push('enrage_attack_mult', angry.MonDamage, 'multiplier (High Rank)', ROBO_URL);
    push('enrage_speed_mult', angry.Speed, 'motion-speed multiplier (High Rank)', ROBO_URL);
    push('enrage_trigger', angry.Limit, 'damage points (High Rank)', ROBO_URL);
    push('enrage_duration', angry.Time, 'seconds (High Rank)', ROBO_URL);
  }

  const hzRows = roboRecord?.Hitzones?.Rows;
  if (Array.isArray(hzRows)) {
    const defaultState = hzRows.filter(r => r.State === '' && !/^(HIDE|Weak Point|Unmatched)/.test(r.Part));
    if (defaultState.length) {
      // One value per part: that part's best raw (slash/blunt/shot).
      const bestPerPart = defaultState.map(r => Math.max(r.Meat.Slash, r.Meat.Blow, r.Meat.Shot));
      push('hitzone_max_raw', Math.max(...bestPerPart), 'percent (robomeche Meat, default state max)', ROBO_URL);
      // The max is a weak-spot detector and saturates; the mean over the SAME parts
      // is the toughness measure Defense wants. Same list, no extra exclusions.
      const meanRaw = bestPerPart.reduce((a, b) => a + b, 0) / bestPerPart.length;
      push('hitzone_mean_raw', Math.round(meanRaw * 10) / 10, 'percent (robomeche Meat, mean over default-state parts)', ROBO_URL);
    }
    const head = defaultState.find(r => r.Part === 'Head');
    push('head_stagger', head?.Flinch?.[0], 'damage points (base)', ROBO_URL);
  }

  const tol = roboRecord?.ConditionTable?.Rows?.find(r => r.Stats === 'Initial Tolerance');
  if (tol) {
    push('tolerance_poison', tol.Poison, 'status build-up points', ROBO_URL);
    push('tolerance_paralysis', tol.Paralyze, 'status build-up points', ROBO_URL);
    push('tolerance_sleep', tol.Sleep, 'status build-up points', ROBO_URL);
    push('tolerance_stun', tol.Stun, 'stun (KO) build-up points', ROBO_URL);
  }

  // No move_power_max: neither feed has a monster attack/motion-value table.

  return rows;
}

export async function extract(roster) {
  const mhdbList = await cachedFetch(MHDB_URL, { as: 'json', cacheName: 'wilds-mhdb-monsters.json' });
  const gz = await cachedFetch(ROBO_URL, { as: 'buffer', cacheName: 'wilds-robomeche-MHWilds_Data_compact.json.gz' });
  const robo = JSON.parse(gunzipSync(gz).toString('utf8'));

  const byName = new Map(mhdbList.map(m => [m.name, m]));
  const roboByGameId = new Map(
    Object.entries(robo['Monster Data'])
      .filter(([, v]) => v && v.Name !== BARREL_PUNCHER)
      .map(([gameId, v]) => [Number(gameId), v]),
  );

  const rows = [];
  const unmatched = [];
  for (const entry of roster) {
    const sourceName = ALIASES[entry.name] ?? entry.name;
    const mhdbMonster = byName.get(sourceName);
    if (!mhdbMonster) {
      unmatched.push(entry.name);
      continue;
    }
    const roboRecord = roboByGameId.get(mhdbMonster.gameId);
    for (const d of deriveWilds(mhdbMonster, roboRecord)) {
      rows.push(obsRow({ monster: entry.id, game: GAME, input: d.input, value: d.value, unit: d.unit, source: d.source }));
    }
  }

  if (unmatched.length) {
    throw new Error(`wilds: unmatched roster monsters: ${unmatched.join(', ')}`);
  }

  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rosterPath = new URL('../data/roster.json', import.meta.url);
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8')).filter(r => r.source === 'Wilds');
  const rows = await extract(roster);

  const counts = Object.fromEntries(RAW_INPUTS.map(i => [i, 0]));
  for (const r of rows) counts[r.input]++;

  console.log(`wilds: ${roster.length} monsters, ${rows.length} rows`);
  for (const input of RAW_INPUTS) {
    console.log(`  ${input.padEnd(20)} ${counts[input]}/${roster.length}`);
  }
}
