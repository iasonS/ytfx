// 3 Ultimate extractor: the messiest source in the pipeline. Four sites, none of
// which has base_hp, enrage_trigger or move_power_max for MH3U:
//   - dbooga/MonsterHunter3UDatabase SQLite (read with sql.js) -> hitzone_max_raw
//   - mh3g.trigwiki.jp (UTF-8, http:// only)                  -> tolerances
//   - mh3g.org (Shift_JIS, http:// only)                      -> enrage + head_stagger
//   - monsterhunterwiki.org MH3U pages (UTF-8, https:// fine)  -> size_base/size_gold
//
// Identity across the three per-monster sites is a hand-maintained locator map,
// because the Japanese sites don't spell names in English at all.
import initSqlJs from 'sql.js';
import * as cheerio from 'cheerio';
import { cachedFetch } from '../lib/fetch.js';
import { obsRow } from '../lib/observations.js';

const DBOOGA_URL = 'https://raw.githubusercontent.com/dbooga/MonsterHunter3UDatabase/master/MonsterHunter3UDatabase/assets/mh3u.sqlite';
const SQLJS_WASM_DIR = new URL('../../../node_modules/sql.js/dist/', import.meta.url).pathname;

// Inputs this extractor can ever emit. base_hp, enrage_trigger and move_power_max
// do not exist for 3U in any source checked (per the research card) and must
// never appear here.
export const EMITTED_INPUTS = [
  'size_base', 'size_gold',
  'enrage_attack_mult', 'enrage_speed_mult', 'enrage_duration',
  'hitzone_max_raw', 'head_stagger',
  'tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun',
];

// The dbooga English name IS the roster's English name for every 3U monster (both
// ultimately come from the same Capcom localisation), so no alias is needed there.
// trigwiki and mh3g.org, however, use a numeric id and a romaji filename
// respectively, neither of which can be derived from the English name -- hence
// this hand-maintained locator map (from the verified research card).
export const MONSTER_MAP = [
  { name: 'Abyssal Lagiacrus', trigwikiId: 1116, mh3gOrgFile: 'ragiakurusu-c' },
  { name: 'Baleful Gigginox', trigwikiId: 932, mh3gOrgFile: 'giginebura-b' },
  { name: 'Ceadeus', trigwikiId: 917, mh3gOrgFile: 'nabarudeusu' },
  { name: 'Crimson Qurupeco', trigwikiId: 914, mh3gOrgFile: 'kurupekko-b' },
  { name: 'Dire Miralis', trigwikiId: 1114, mh3gOrgFile: 'guranmiraosu' },
  { name: 'Gigginox', trigwikiId: 931, mh3gOrgFile: 'giginebura' },
  { name: 'Glacial Agnaktor', trigwikiId: 926, mh3gOrgFile: 'agunakotoru-b' },
  { name: 'Gobul', trigwikiId: 903, mh3gOrgFile: 'tyanagaburu' },
  { name: 'Goldbeard Ceadeus', trigwikiId: 1110, mh3gOrgFile: 'nabarudeusu-b' },
  { name: 'Green Nargacuga', trigwikiId: 979, mh3gOrgFile: 'narugakuruga-b' },
  { name: 'Green Plesioth', trigwikiId: 1028, mh3gOrgFile: 'ganototosu-b' },
  { name: 'Hallowed Jhen Mohran', trigwikiId: 971, mh3gOrgFile: 'jienmooran-b' },
  { name: 'Ivory Lagiacrus', trigwikiId: 920, mh3gOrgFile: 'ragiakurusu-b' },
  { name: 'Jade Barroth', trigwikiId: 924, mh3gOrgFile: 'boruborosu-b' },
  { name: 'Jhen Mohran', trigwikiId: 918, mh3gOrgFile: 'jienmooran' },
  { name: 'Purple Ludroth', trigwikiId: 936, mh3gOrgFile: 'roarudorosu-b' },
  { name: 'Qurupeco', trigwikiId: 913, mh3gOrgFile: 'kurupekko' },
  { name: 'Rust Duramboros', trigwikiId: 977, mh3gOrgFile: 'doboruberuku-b' },
  { name: 'Sand Barioth', trigwikiId: 934, mh3gOrgFile: 'beriorosu-b' },
  { name: 'Steel Uragaan', trigwikiId: 922, mh3gOrgFile: 'uragankin-b' },
];

// A table with no nested <table> descendant -- avoids double-processing the
// outer page-layout wrapper table that both Japanese sites use.
function leafTables($) {
  return $('table').filter((_, el) => $(el).find('table').length === 0).toArray();
}

function tableRows($, table) {
  return $(table).find('tr').toArray()
    .map(tr => $(tr).find('td,th').map((_, td) => $(td).text().trim()).get());
}

// trigwiki's 状態異常耐性 (status tolerance) table. The header spans two rows
// (種類/効果/備考/耐性値/蓄積値減少, then 初期/上昇/最大 under 耐性値), and each
// data row is 7 cells: [label, 効果, 備考, 初期, 上昇, 最大, 蓄積値減少]. Reading
// by fixed cell index (rather than flattened text) is required: a blank 備考 cell
// disappears when the text is whitespace-collapsed, which shifts a naive regex's
// trailing group onto the next row's label.
const TOLERANCE_LABELS = {
  '毒': 'tolerance_poison',
  '麻痺': 'tolerance_paralysis',
  '睡眠': 'tolerance_sleep',
  'めまい': 'tolerance_stun',
};

export function parseTolerances(html) {
  const $ = cheerio.load(html);
  const result = {};
  for (const table of leafTables($)) {
    const rows = tableRows($, table);
    const headerIdx = rows.findIndex(r => r[0] === '種類');
    if (headerIdx === -1) continue;
    const subHeader = rows[headerIdx + 1];
    if (!subHeader || subHeader[0] !== '初期') continue;
    for (const row of rows.slice(headerIdx + 2)) {
      const input = TOLERANCE_LABELS[row[0]];
      if (!input) continue;
      const raw = row[3];
      if (raw === undefined || raw === '' || raw === '-') continue;
      const value = Number(raw);
      if (Number.isFinite(value)) result[input] = value;
    }
  }
  return result;
}

// mh3g.org's 怒り時の目安 (enrage summary) table: a 4-cell header (継続,
// 怒りやすさ, 攻撃倍率, 行動速度) followed by exactly one 4-cell data row. The
// multiplier prefix is either a full-width '×' or an ASCII 'x'; Jhen Mohran's
// duration cell is a literal '？' (unknown), which must not become a 0.
export function parseEnrage(html) {
  const $ = cheerio.load(html);
  const result = {};
  for (const table of leafTables($)) {
    const rows = tableRows($, table);
    const headerIdx = rows.findIndex(r => r.length === 4 && r[0] === '継続' && r[1] === '怒りやすさ');
    if (headerIdx === -1) continue;
    const data = rows[headerIdx + 1];
    if (!data) continue;
    const [durationRaw, , atkRaw, spdRaw] = data;
    if (durationRaw && durationRaw !== '？' && durationRaw !== '-') {
      const m = /^(\d+(?:\.\d+)?)/.exec(durationRaw);
      if (m) result.enrage_duration = Number(m[1]);
    }
    const atkM = atkRaw ? /^[x×](\d+(?:\.\d+)?)/.exec(atkRaw) : null;
    if (atkM) result.enrage_attack_mult = Number(atkM[1]);
    const spdM = spdRaw ? /^[x×](\d+(?:\.\d+)?)/.exec(spdRaw) : null;
    if (spdM) result.enrage_speed_mult = Number(spdM[1]);
  }
  return result;
}

// mh3g.org's 肉質 (raw hitzone) table, used here only for head_stagger (the
// よろめき column, last of 11). The head-equivalent row is always the FIRST data
// row -- 頭/頭部 for most monsters, 両牙 for the Jhen Mohran pair (no head part),
// 角 for Rust Duramboros (whose 頭 row has no stagger value at all).
const HEAD_ROW = /^(頭部?|両牙|角)$/;

export function parseHeadStagger(html) {
  const $ = cheerio.load(html);
  let result = null;
  for (const table of leafTables($)) {
    const rows = tableRows($, table);
    const headerIdx = rows.findIndex(r => r[0] === '部位' && r[9] === '気絶' && r[10] === 'よろめき');
    if (headerIdx === -1) continue;
    const dataRow = rows[headerIdx + 1];
    if (!dataRow || !HEAD_ROW.test(dataRow[0])) continue;
    const raw = dataRow[10];
    const m = raw ? /^(\d+)/.exec(raw) : null;
    if (m) result = Number(m[1]);
  }
  return result;
}

// monsterhunterwiki.org's per-game infobox crown row, flattened to whitespace-
// normalised text: "Avg. ≤<mini> cm <base> cm ≥<silver> cm ≥<gold> cm". A
// fixed-size monster renders "≤ - cm" WITH a space after ≤ (not "-cm" as an
// earlier draft of the card assumed), so the regex must tolerate that space and
// map '-' to null explicitly -- a genuine non-match is a real parse failure.
const SIZE_RE = /Avg\.\s*≤\s*([\d.]+|-)\s*cm\s*([\d.]+|-)\s*cm\s*≥\s*([\d.]+|-)\s*cm\s*≥\s*([\d.]+|-)\s*cm/;

export function parseSize(html) {
  const $ = cheerio.load(html);
  let text = null;
  $('.monster-game-info').each((_, el) => {
    const t = $(el).text().replace(/\s+/g, ' ').trim();
    if (t.startsWith('Avg.')) text = t;
  });
  if (text === null) return {};
  const m = SIZE_RE.exec(text);
  if (!m) throw new Error(`mh3u: size text did not match the expected pattern: ${text}`);
  const toNum = s => (s === '-' ? null : Number(s));
  const result = {};
  const base = toNum(m[2]);
  const gold = toNum(m[4]);
  if (base !== null) result.size_base = base;
  if (gold !== null) result.size_gold = gold;
  return result;
}

// dbooga's monster_damage rows use -1 (not applicable) and -2 (unknown, e.g. every
// shot column for Dire Miralis) as sentinels. Filtered per VALUE, not per row, so
// a monster missing one column (e.g. shot) still yields a max from the others.
export function hitzoneMaxRaw(rows) {
  let max = null;
  for (const row of rows) {
    for (const v of [row.cut, row.impact, row.shot]) {
      if (v === null || v === undefined) continue;
      if (v < 0) continue;
      if (max === null || v > max) max = v;
    }
  }
  return max;
}

export function queryDbooga(db, name) {
  const stmt = db.prepare(
    'SELECT body_part, cut, impact, shot FROM monster_damage WHERE monster_id = (SELECT _id FROM monsters WHERE name = ?)',
  );
  stmt.bind([name]);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

export async function extract(roster) {
  const mine = roster.filter(r => r.source === '3U');
  const unmatched = mine.filter(r => !MONSTER_MAP.some(m => m.name === r.name));
  if (unmatched.length) {
    throw new Error(`mh3u: no locator mapping for: ${unmatched.map(r => r.name).join(', ')}`);
  }

  const sqliteBuf = await cachedFetch(DBOOGA_URL, { as: 'buffer', cacheName: 'mh3u-dbooga.sqlite' });
  const SQL = await initSqlJs({ locateFile: f => SQLJS_WASM_DIR + f });
  const db = new SQL.Database(sqliteBuf);

  const rows = [];
  for (const entry of mine) {
    const loc = MONSTER_MAP.find(m => m.name === entry.name);

    const dbRows = queryDbooga(db, loc.name);
    const maxRaw = hitzoneMaxRaw(dbRows);
    if (maxRaw !== null) {
      rows.push(obsRow({
        monster: entry.id, game: 'MH3U', input: 'hitzone_max_raw', value: maxRaw,
        unit: 'raw hitzone % (max of cut/impact/shot, sentinels excluded)', source: DBOOGA_URL,
      }));
    }

    const trigUrl = `http://mh3g.trigwiki.jp/data/${loc.trigwikiId}.html`;
    const trigHtml = await cachedFetch(trigUrl, { as: 'text', cacheName: `mh3u-trigwiki-${loc.trigwikiId}.html` });
    for (const [input, value] of Object.entries(parseTolerances(trigHtml))) {
      rows.push(obsRow({
        monster: entry.id, game: 'MH3U', input, value,
        unit: 'status build-up points (village base)', source: trigUrl,
      }));
    }

    const orgUrl = `http://mh3g.org/book/${loc.mh3gOrgFile}.html`;
    const orgBuf = await cachedFetch(orgUrl, { as: 'buffer', cacheName: `mh3u-mh3gorg-${loc.mh3gOrgFile}.html` });
    const orgHtml = new TextDecoder('shift_jis').decode(orgBuf);
    for (const [input, value] of Object.entries(parseEnrage(orgHtml))) {
      const unit = input === 'enrage_duration' ? 'seconds' : 'multiplier';
      rows.push(obsRow({ monster: entry.id, game: 'MH3U', input, value, unit, source: orgUrl }));
    }
    const stagger = parseHeadStagger(orgHtml);
    if (stagger !== null) {
      rows.push(obsRow({
        monster: entry.id, game: 'MH3U', input: 'head_stagger', value: stagger,
        unit: 'damage points (village-quest base)', source: orgUrl,
      }));
    }

    const wikiSlug = loc.name.replace(/ /g, '_');
    const wikiUrl = `https://monsterhunterwiki.org/wiki/${wikiSlug}_(MH3U)`;
    const wikiHtml = await cachedFetch(wikiUrl, { as: 'text', cacheName: `mh3u-mhwiki-${wikiSlug}.html` });
    for (const [input, value] of Object.entries(parseSize(wikiHtml))) {
      rows.push(obsRow({ monster: entry.id, game: 'MH3U', input, value, unit: 'cm', source: wikiUrl }));
    }
  }
  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { readFileSync } = await import('fs');
  const roster = JSON.parse(readFileSync(new URL('../data/roster.json', import.meta.url), 'utf8'));
  const mine = roster.filter(r => r.source === '3U');
  const rows = await extract(mine);
  const byInput = {};
  for (const row of rows) byInput[row.input] = (byInput[row.input] ?? 0) + 1;
  console.log(`mh3u: ${mine.length} monsters, ${rows.length} rows`);
  for (const input of EMITTED_INPUTS) {
    console.log(`  ${input}: ${byInput[input] ?? 0}/${mine.length}`);
  }
}
