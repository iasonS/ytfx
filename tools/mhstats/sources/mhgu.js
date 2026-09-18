// Generations Ultimate extractor: gatheringhallstudios' mhgu.db SQLite for
// base_hp and the four status tolerances, Kiranico GU HTML for size_base,
// size_gold, head_stagger and hitzone_max_raw (sqlite has no size/stagger
// table at all). See docs/superpowers/research/2026-09-18-source-locators.md
// ("######## GU" section) for the verified locators this follows.
//
// GU has no enrage data anywhere (no rage/enrage field in the database, no
// enrage block on Kiranico GU or Gen): no enrage_attack_mult, enrage_speed_mult,
// enrage_trigger or enrage_duration is ever emitted for this source, and
// Attack/Speed/Temper for these 45 monsters come entirely from inheritance or
// curation.
import { inflateRawSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import initSqlJs from 'sql.js';
import { cachedFetch } from '../lib/fetch.js';
import { obsRow, RAW_INPUTS } from '../lib/observations.js';

const ZIP_URL = 'https://raw.githubusercontent.com/gatheringhallstudios/MHGenDatabase/master/app/src/main/assets/databases/mhgu.db.zip';
const INDEX_URL = 'https://mhgu.kiranico.com/monster';
const GAME = 'MHGU';

// Roster names (from monsterhunterwiki.org) are byte-identical to both the
// mhgu.db `monsters.name` column and the Kiranico GU index for all 45 roster
// monsters, as of 2026-09-18. Kept explicit per the shared contract in case a
// future roster spelling drifts.
const ALIASES = {};

// sqlite's status labels differ from Kiranico's (Poison/Para/Sleep/KO here,
// Psn/Par/Sle/Dizzy there).
const SQLITE_STATUS_TO_INPUT = {
  Poison: 'tolerance_poison',
  Para: 'tolerance_paralysis',
  Sleep: 'tolerance_sleep',
  KO: 'tolerance_stun',
};

const KIRANICO_STATUS_TO_INPUT = {
  Psn: 'tolerance_poison',
  Par: 'tolerance_paralysis',
  Sle: 'tolerance_sleep',
  Dizzy: 'tolerance_stun',
};

function isNum(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

// mhgu.db.zip is a single-entry, DEFLATE-compressed zip (verified against the
// cached copy: local-file-header flags 0, so sizes are known upfront and no
// data-descriptor handling is needed). sql.js reads a raw database buffer,
// not a zip, so this unwraps it without pulling in a zip dependency.
function unzipSingleEntry(zipBuf) {
  if (zipBuf.readUInt32LE(0) !== 0x04034b50) {
    throw new Error('mhgu: mhgu.db.zip does not start with a local file header');
  }
  const compressedSize = zipBuf.readUInt32LE(18);
  const nameLength = zipBuf.readUInt16LE(26);
  const extraLength = zipBuf.readUInt16LE(28);
  const dataStart = 30 + nameLength + extraLength;
  const compressed = zipBuf.subarray(dataStart, dataStart + compressedSize);
  return inflateRawSync(compressed);
}

let sqlJsPromise;
function loadSqlJs() {
  sqlJsPromise ??= initSqlJs();
  return sqlJsPromise;
}

// Pure (given an already-open sql.js Database): the base_hp and four status
// tolerances for one monster, plus headHitzoneMax, the max raw hitzone over
// every `Head%` row (both plain and state-suffixed, e.g. Agnaktor's
// "Head (Cool)" / "Head (Hot/Break)"). A LIKE 'Head%' ORDER BY _id LIMIT 1
// query would pick whichever state happens to sort first, which for Agnaktor
// is the (Cool) placeholder (15/15/15) rather than the real weak point
// (55/60/50) — see the card's VERDICT FAILED note. Maxing over every state
// avoids that trap and is the one rule sqlite and Kiranico GU agree on.
export function queryMhguDb(db, name) {
  const out = {};

  const hpStmt = db.prepare('SELECT base_hp FROM monsters WHERE name = ?');
  hpStmt.bind([name]);
  if (hpStmt.step()) {
    const hp = hpStmt.getAsObject().base_hp;
    if (isNum(hp)) out.base_hp = hp;
  }
  hpStmt.free();

  const statusStmt = db.prepare(
    'SELECT status, initial FROM monster_status WHERE monster_id = (SELECT _id FROM monsters WHERE name = ?)',
  );
  statusStmt.bind([name]);
  while (statusStmt.step()) {
    const row = statusStmt.getAsObject();
    const input = SQLITE_STATUS_TO_INPUT[row.status];
    // A build-up threshold of 0 means immune (e.g. Old Fatalis' KO row), not
    // a real value; omit rather than emit a false zero.
    if (input && isNum(row.initial) && row.initial > 0) out[input] = row.initial;
  }
  statusStmt.free();

  const damageStmt = db.prepare(
    "SELECT cut, impact, shot FROM monster_damage WHERE monster_id = (SELECT _id FROM monsters WHERE name = ?) AND body_part LIKE 'Head%'",
  );
  damageStmt.bind([name]);
  let headHitzoneMax;
  while (damageStmt.step()) {
    const row = damageStmt.getAsObject();
    for (const v of [row.cut, row.impact, row.shot]) {
      if (isNum(v) && (headHitzoneMax === undefined || v > headHitzoneMax)) headHitzoneMax = v;
    }
  }
  damageStmt.free();
  if (headHitzoneMax !== undefined) out.headHitzoneMax = headHitzoneMax;

  return out;
}

function num(text) {
  const n = Number(String(text).replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : undefined;
}

function h5Matching($, re) {
  return $('h5').filter((_, el) => re.test($(el).text().trim())).first();
}

// Pure: parse one Kiranico GU monster page into size, stagger, hitzone and
// (secondary/fallback) tolerance figures. Body-part and hit-data tables both
// carry literal "NO DATA" rows that must be skipped rather than parsed as a
// part; the stagger cell can be "N [M]" (stagger [sever]) so only the first
// number is taken.
export function parseKiranicoGu(html) {
  const $ = load(html);
  const out = { name: $('h2').first().text().trim() };

  const sizeMatch = /Size:\s*([\d,.]+)/.exec(h5Matching($, /^Size:/).text());
  if (sizeMatch) out.sizeBase = num(sizeMatch[1]);

  const goldText = $('h6').filter((_, el) => /^Gold Crown:/.test($(el).text().trim())).first().text();
  const goldMatch = /Gold Crown:\s*[≥≤]?\s*([\d,.]+)/.exec(goldText);
  if (goldMatch) {
    const gold = num(goldMatch[1]);
    // A monster with no crown ever recorded renders "≥0.00", not a real size.
    if (gold) out.sizeGold = gold;
  }

  // Hit Data: one <div class="tab-pane" id="state-X"> per monster state.
  // hitzone_max_raw is the max raw value (slash/impact/shot) over EVERY part
  // in EVERY state; restricting to the default state alone under-reports
  // monsters like Agnaktor whose weak point only appears once "broken".
  // hitzone_mean_raw is the arithmetic mean of those same per-part bests over
  // exactly the same rows the max ranges over (same state panes, same "NO DATA"
  // skip, same 11-cell row shape): the max finds the softest spot, the mean
  // measures how armoured the monster is overall.
  let hitzoneMaxRaw;
  let hitzoneSum = 0;
  let hitzoneCount = 0;
  let headHitzoneMax;
  const hitPanes = h5Matching($, /^Hit Data$/).nextAll('.tab-content').first().find('.tab-pane');
  hitPanes.find('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length !== 11) return; // header row (th) or a malformed row
    const part = $(cells[0]).text().trim();
    if (part === 'NO DATA') return;
    const slash = num($(cells[1]).text());
    const impact = num($(cells[2]).text());
    const shot = num($(cells[3]).text());
    const localMax = Math.max(...[slash, impact, shot].filter(isNum));
    if (!isNum(localMax)) return;
    if (hitzoneMaxRaw === undefined || localMax > hitzoneMaxRaw) hitzoneMaxRaw = localMax;
    hitzoneSum += localMax;
    hitzoneCount += 1;
    if (/^Head\b/.test(part) && (headHitzoneMax === undefined || localMax > headHitzoneMax)) {
      headHitzoneMax = localMax;
    }
  });
  if (hitzoneMaxRaw !== undefined) out.hitzoneMaxRaw = hitzoneMaxRaw;
  if (hitzoneCount > 0) out.hitzoneMeanRaw = Math.round((hitzoneSum / hitzoneCount) * 10) / 10;
  if (headHitzoneMax !== undefined) out.headHitzoneMax = headHitzoneMax;

  // Body Part: stagger/extract table, single tab (id="part"). Cell 2 is e.g.
  // "120 [320]" (stagger [sever]) or a plain number.
  const bodyPartTable = h5Matching($, /^Body Part$/).nextAll('.tab-content').first();
  bodyPartTable.find('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length !== 3) return;
    const part = $(cells[0]).text().trim();
    if (part !== 'Head') return;
    const m = /^(\d+)/.exec($(cells[1]).text().trim());
    if (m) out.headStagger = Number(m[1]);
  });

  // Abnormal Status: fallback/cross-check tolerances (sqlite is primary).
  const statusTable = h5Matching($, /^Abnormal Status$/).nextAll('.table-responsive').first();
  statusTable.find('table tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length !== 7) return;
    const input = KIRANICO_STATUS_TO_INPUT[$(cells[0]).text().trim()];
    if (!input) return;
    const value = num($(cells[1]).text());
    if (isNum(value) && value > 0) out[input] = value;
  });

  return out;
}

function parseKiranicoIndex(html) {
  const map = new Map();
  const re = /<a[^>]*href="(https:\/\/mhgu\.kiranico\.com\/monster\/[0-9a-f]{5})"[^>]*>([^<]*)<\/a>/g;
  for (const m of html.matchAll(re)) map.set(m[2].trim(), m[1]);
  return map;
}

export async function extract(roster) {
  const SQL = await loadSqlJs();
  const zipBuf = await cachedFetch(ZIP_URL, { as: 'buffer', cacheName: 'mhgu-db.zip' });
  const db = new SQL.Database(unzipSingleEntry(zipBuf));

  const indexHtml = await cachedFetch(INDEX_URL, { as: 'text', cacheName: 'mhgu-kiranico-index.html' });
  const index = parseKiranicoIndex(indexHtml);

  const rows = [];
  const unmatched = [];
  for (const entry of roster) {
    const sourceName = ALIASES[entry.name] ?? entry.name;
    const url = index.get(sourceName);
    const dbData = queryMhguDb(db, sourceName);
    if (!url || dbData.base_hp === undefined) {
      unmatched.push(entry.name);
      continue;
    }

    const hash = url.split('/').pop();
    const html = await cachedFetch(url, { as: 'text', cacheName: `mhgu-kiranico-${hash}.html` });
    const kiranico = parseKiranicoGu(html);

    const push = (input, value, unit, source) => {
      if (!isNum(value)) return;
      rows.push(obsRow({ monster: entry.id, game: GAME, input, value, unit, source }));
    };

    push('base_hp', dbData.base_hp, 'HP', ZIP_URL);
    push('tolerance_poison', dbData.tolerance_poison, 'status build-up points', ZIP_URL);
    push('tolerance_paralysis', dbData.tolerance_paralysis, 'status build-up points', ZIP_URL);
    push('tolerance_sleep', dbData.tolerance_sleep, 'status build-up points', ZIP_URL);
    push('tolerance_stun', dbData.tolerance_stun, 'status build-up points', ZIP_URL);
    push('size_base', kiranico.sizeBase, 'cm', url);
    push('size_gold', kiranico.sizeGold, 'cm', url);
    push('head_stagger', kiranico.headStagger, 'stagger threshold (raw)', url);
    push('hitzone_max_raw', kiranico.hitzoneMaxRaw, 'raw hitzone percent (max over all Kiranico GU states)', url);
    push('hitzone_mean_raw', kiranico.hitzoneMeanRaw, 'percent (mean over the same Kiranico GU part rows the max uses, all states)', url);

    // No enrage_attack_mult, enrage_speed_mult, enrage_trigger, enrage_duration
    // or move_power_max: absent for GU in every source checked.
  }

  db.close();

  if (unmatched.length) {
    throw new Error(`mhgu: unmatched roster monsters: ${unmatched.join(', ')}`);
  }

  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rosterPath = new URL('../data/roster.json', import.meta.url);
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8')).filter(r => r.source === 'GU');
  const rows = await extract(roster);

  const counts = Object.fromEntries(RAW_INPUTS.map(i => [i, 0]));
  for (const r of rows) counts[r.input]++;

  console.log(`mhgu: ${roster.length} monsters, ${rows.length} rows`);
  for (const input of RAW_INPUTS) {
    console.log(`  ${input.padEnd(20)} ${counts[input]}/${roster.length}`);
  }
}
