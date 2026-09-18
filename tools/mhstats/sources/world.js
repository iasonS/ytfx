// World extractor: Kiranico World HTML (primary — everything except base size)
// plus poedb MHW HTML (base size, and a cross-check on the gold-crown percent).
// The mhw-db JSON API holds no numeric stats and is deliberately not used.
//
// Both sites are server-rendered HTML with no JSON API for these fields, so
// this module parses tables directly rather than pulling in cheerio: the
// locators below were verified against live pages (including the held-out
// Acidic Glavenus monster) on 2026-09-18.
import { readFileSync } from 'fs';
import { cachedFetch } from '../lib/fetch.js';
import { obsRow, RAW_INPUTS } from '../lib/observations.js';

const UA = 'mhstats-deck-builder (github.com/iasonS/ytfx)';
const KIRANICO_INDEX_URL = 'https://mhworld.kiranico.com/en/monsters';
const POEDB_INDEX_URL = 'https://mhw.poedb.tw/eng/monsters/large';

// The Kiranico World and poedb MHW index pages spell every one of these 49
// roster monsters identically to the roster's own wiki-derived name (verified
// against the live indices: 0 unmatched). Kept as an explicit map, per the
// shared contract, for the day a spelling does diverge.
const ALIASES = {};

// ---------------------------------------------------------------- helpers --

const NEXT_SECTION_RE = /<h6 class="element-header">/;

function tableAfter(html, anchorRe) {
  const m = html.match(anchorRe);
  if (!m) return null;
  const start = m.index + m[0].length;
  // Bound the search by the next section heading, if any, so a section that
  // genuinely has no table of its own (e.g. Ancient Leshen's empty "Other")
  // never spills into the NEXT section's table instead of yielding nothing.
  const nextHeader = html.slice(start).search(NEXT_SECTION_RE);
  const bound = nextHeader === -1 ? html.length : start + nextHeader;
  const tStart = html.indexOf('<table', start);
  if (tStart === -1 || tStart >= bound) return null;
  const tEnd = html.indexOf('</table>', tStart);
  if (tEnd === -1 || tEnd >= bound) return null;
  const body = html.slice(start, tEnd);
  const rows = [];
  for (const tr of body.matchAll(/<tr[^>]*>([\s\S]*?)(?=<tr[^>]*>|$)/g)) {
    const cells = [...tr[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((c) => c[1]);
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function strip(s) {
  return String(s ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&le;/g, '<=')
    .replace(/&ge;/g, '>=')
    .replace(/\s+/g, ' ')
    .trim();
}

function num(s) {
  if (s === null || s === undefined) return null;
  const m = String(s).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function maxOf(values) {
  const finite = values.filter((v) => v !== null && v !== undefined && Number.isFinite(v));
  return finite.length ? Math.max(...finite) : null;
}

// ------------------------------------------------------------- Kiranico ----

// Parses one Kiranico World monster page. Every table lookup is optional:
// a missing section yields nulls for that section's fields rather than
// throwing, so one monster's odd page never takes another monster's inputs
// down with it (see the poedb side for where this actually bites, on
// Acidic Glavenus's missing Monster Damage card).
export function parseKiranico(html) {
  const nameM = html.match(/<div class="align-self-center">([^<]*)<\/div>/);
  const name = nameM ? strip(nameM[1]) : null;

  const hpM = html.match(/<strong>([\d,]+)<\/strong>\s*<div class="balance-label[^"]*">\s*Health/);
  const base_hp = hpM ? num(hpM[1]) : null;

  const crowns = {};
  for (const m of html.matchAll(/crown_(mini|large|king)\.png"[^>]*>\s*<strong>&(?:le|ge);([\d,.]+)cm<\/strong>/g)) {
    crowns[m[1]] = num(m[2]);
  }
  const size_mini = crowns.mini ?? null;
  const size_silver = crowns.large ?? null;
  const size_gold = crowns.king ?? null;

  // Physiology: Part | Sever | Blunt | Ranged | ... . A row's part cell carries
  // an <img ib_icon.png> prefix when it is a Master Rank override — those rows
  // are excluded. State-variant rows such as "Head (White)" carry no such
  // marker and ARE counted toward the max (documented in the emitted unit;
  // this is the source of Nergigante's max of 90, not its plain head's 60).
  let hitzone_max_raw = null;
  const phys = tableAfter(html, /<h6 class="element-header">Physiology<\/h6>/);
  if (phys) {
    const values = phys
      .filter((r) => r.length >= 4 && num(r[1]) !== null)
      .filter((r) => !/ib_icon\.png/.test(r[0]))
      .flatMap((r) => [num(r[1]), num(r[2]), num(r[3])]);
    hitzone_max_raw = maxOf(values);
  }

  // Part Breakability: Part | Value | Sever | Extract Color. head_stagger is
  // the exact "Head" row's Value (flinch threshold), not a state variant.
  let head_stagger = null;
  const pb = tableAfter(html, /<h6 class="element-header">Part Breakability<\/h6>/);
  if (pb) {
    const headRow = pb.find((r) => strip(r[0]) === 'Head' && num(r[1]) !== null);
    head_stagger = headRow ? num(headRow[1]) : null;
  }

  // Other: label | Low Rank/High Rank | Master Rank. Always the LR/HR column;
  // Master Rank is a different number (see Rathalos: MR trigger 300 vs
  // LR/HR 650) and is not emitted.
  const other = tableAfter(html, /<h6 class="element-header">Other<\/h6>/);
  const o = {};
  if (other) {
    for (const r of other) {
      const k = strip(r[0]);
      if (k && r.length >= 2) o[k] = strip(r[1]);
    }
  }
  const enrage = {
    duration: num(o['Enrage Duration']),
    attack_mult: num(o['Enrage Attack']),
    speed_mult: num(o['Enrage Speed']),
    trigger: num(o['Enrage Trigger']),
  };

  // Ailments: Ailments | Buildup | ... . A blank Buildup cell means immune;
  // that must resolve to null, never 0.
  const ail = tableAfter(html, /<h6 class="element-header">Ailments<\/h6>/);
  const a = {};
  if (ail) {
    for (const r of ail) {
      const k = strip(r[0]);
      if (!k) continue;
      const buildup = strip(r[1]);
      const bm = buildup.match(/^(\d+)/);
      a[k] = bm ? Number(bm[1]) : null;
    }
  }
  const tolerances = {
    poison: a.Poison ?? null,
    paralysis: a.Paralysis ?? null,
    sleep: a.Sleep ?? null,
    stun: a.Stun ?? null,
  };

  // Monster Attacks: Attack Move | Power | ... . Move names repeat across
  // hitboxes, so take the max over every row.
  let move_power_max = null;
  const atk = tableAfter(html, /<h6 class="element-header">Monster Attacks<\/h6>/);
  if (atk) {
    move_power_max = maxOf(atk.map((r) => num(r[1])));
  }

  return { name, base_hp, size_mini, size_silver, size_gold, enrage, hitzone_max_raw, head_stagger, tolerances, move_power_max };
}

// --------------------------------------------------------------- poedb -----

// Parses one poedb MHW monster page. Used only for size_base (and a
// cross-check on the gold-crown percent); every card lookup below is
// null-guarded because poedb pages are missing whole cards for some
// monsters — Acidic Glavenus has no "Monster Damage" card at all, and an
// unguarded parse throws there, which would otherwise take down every other
// input for that monster too.
export function parsePoedb(html) {
  const nameM = html.match(/card-times'><\/i><img alt='([^']*)'/) ?? html.match(/card-times"><\/i><img alt='([^']*)'/);
  const name = nameM ? strip(nameM[1]) : null;

  const hpM = html.match(/<th>Base HP<\/th><td>([\d,]+)<\/td>/);
  const base_hp = hpM ? num(hpM[1]) : null;

  let size_base = null;
  let size_gold = null;
  let size_gold_pct = null;
  const sz = html.match(/<th>Size<\/th><td>Base: ([\d.]+)<br>[\s\S]*?[≤<]=?([\d.]+) \((\d+)%\)<br>[\s\S]*?[≥>]=?([\d.]+) \((\d+)%\)<br>[\s\S]*?[≥>]=?([\d.]+) \((\d+)%\)/);
  if (sz) {
    size_base = num(sz[1]);
    size_gold = num(sz[6]);
    size_gold_pct = num(sz[7]);
  }

  const enrage = { trigger: null, duration: null, speed_mult: null, attack_mult: null };
  const en = tableAfter(html, /card-times'><\/i>Enrage<\/div>/) ?? tableAfter(html, /card-times"><\/i>Enrage<\/div>/);
  if (en) {
    const e = {};
    for (const r of en) {
      const k = strip(r[0]);
      if (k) e[k] = strip(r[1]);
    }
    enrage.trigger = num(e.TriggerDamage);
    enrage.duration = num(e.Duration);
    enrage.speed_mult = num(e.SpeedMultiplier) !== null ? num(e.SpeedMultiplier) / 100 : null;
    enrage.attack_mult = num(e.DamageMultiplier) !== null ? num(e.DamageMultiplier) / 100 : null;
  }

  const tolerances = { poison: null, paralysis: null, sleep: null, stun: null };
  const st = tableAfter(html, /card-times'><\/i>Status <small>\/\d+<\/small><\/div>/) ??
    tableAfter(html, /card-times"><\/i>Status <small>\/\d+<\/small><\/div>/);
  if (st && st.length) {
    const cols = st[0].map((c) => (c.match(/title='([^']*)'/) || [, strip(c)])[1]);
    const base = st.find((r) => strip(r[0]) === 'Base');
    if (base) {
      const idx = (k) => cols.indexOf(k);
      const at = (k) => (idx(k) >= 0 ? num(base[idx(k)]) : null);
      tolerances.poison = at('poison');
      tolerances.sleep = at('sleep');
      tolerances.paralysis = at('paralysis');
      tolerances.stun = at('stun');
    }
  }

  // Not used for move_power_max (Kiranico's Monster Attacks table is the sole
  // source there, since poedb only ever lists a subset) — parsed here purely
  // so the null-guard for a missing card is exercised and this function never
  // throws on a page like Acidic Glavenus's.
  let move_power_max = null;
  const md = tableAfter(html, /card-times'><\/i>Monster Damage <small>\/\d+<\/small><\/div>/) ??
    tableAfter(html, /card-times"><\/i>Monster Damage <small>\/\d+<\/small><\/div>/);
  if (md && md.length > 1) {
    move_power_max = maxOf(md.slice(1).map((r) => num(r[1])));
  }

  return { name, base_hp, size_base, size_gold, size_gold_pct, enrage, tolerances, move_power_max };
}

// ------------------------------------------------------------- indices -----

function parseKiranicoIndex(html) {
  const startM = html.match(/<h6 class="element-header">Large Monsters<\/h6>/);
  const endM = html.match(/<h6 class="element-header">Small Monsters<\/h6>/);
  if (!startM || !endM) throw new Error('World extractor: Kiranico index missing Large/Small Monsters markers');
  const slice = html.slice(startM.index, endM.index);
  const out = new Map();
  for (const m of slice.matchAll(/href="(https:\/\/mhworld\.kiranico\.com\/en\/monsters\/([A-Za-z0-9]+)\/([a-z0-9-]+))">([^<]+)<\/a>/g)) {
    const [, url, , slug, rawName] = m;
    out.set(strip(rawName), { url, slug });
  }
  return out;
}

function parsePoedbIndex(html) {
  const out = new Map();
  for (const m of html.matchAll(/href='(\/eng\/monster\/(\d+)\/[^']*)'>\s*<img alt='([^']*)'/g)) {
    const [, path, id, rawName] = m;
    out.set(strip(rawName), { url: `https://mhw.poedb.tw${path}`, id });
  }
  return out;
}

// -------------------------------------------------------------- extract ----

export async function extract(roster) {
  const monsters = roster.filter((r) => r.source === 'World');
  if (!monsters.length) return [];

  const kIndexHtml = await cachedFetch(KIRANICO_INDEX_URL, { cacheName: 'kiranico-world-index.html', headers: { 'User-Agent': UA } });
  const pIndexHtml = await cachedFetch(POEDB_INDEX_URL, { cacheName: 'poedb-mhw-index.html', headers: { 'User-Agent': UA } });
  const kIndex = parseKiranicoIndex(kIndexHtml);
  const pIndex = parsePoedbIndex(pIndexHtml);

  const unmatched = [];
  const matches = [];
  for (const m of monsters) {
    const name = ALIASES[m.name] ?? m.name;
    const k = kIndex.get(name);
    const p = pIndex.get(name);
    if (!k || !p) {
      unmatched.push(m.name);
      continue;
    }
    matches.push({ monster: m, k, p });
  }
  if (unmatched.length) {
    throw new Error(`World extractor: no source match for: ${unmatched.join(', ')}`);
  }

  const rows = [];
  for (const { monster: m, k, p } of matches) {
    const kHtml = await cachedFetch(k.url, { cacheName: `kiranico-world-${k.slug}.html`, headers: { 'User-Agent': UA } });
    const pHtml = await cachedFetch(p.url, { cacheName: `poedb-mhw-${p.id}.html`, headers: { 'User-Agent': UA } });
    const kd = parseKiranico(kHtml);
    const pd = parsePoedb(pHtml);

    const push = (input, value, unit, source) => {
      if (value === null || value === undefined || !Number.isFinite(value)) return;
      rows.push(obsRow({ monster: m.id, game: 'MHWorld', input, value, unit, source }));
    };

    push('base_hp', kd.base_hp, 'HP', k.url);
    push('size_base', pd.size_base, 'cm (poedb Base; never derived as gold/1.23 — crown thresholds are per-monster)', p.url);
    push('size_gold', kd.size_gold, 'cm (gold crown threshold)', k.url);
    push('enrage_attack_mult', kd.enrage.attack_mult, 'multiplier (Low Rank/High Rank column, not Master Rank)', k.url);
    push('enrage_speed_mult', kd.enrage.speed_mult, 'multiplier (Low Rank/High Rank column, not Master Rank)', k.url);
    push('enrage_trigger', kd.enrage.trigger, 'damage points (Low Rank/High Rank column, not Master Rank)', k.url);
    push('enrage_duration', kd.enrage.duration, 'seconds (Low Rank/High Rank column, not Master Rank)', k.url);
    push('hitzone_max_raw', kd.hitzone_max_raw, 'raw hitzone % (max sever/blunt/shot over LR/HR Physiology rows, including state-variant parts e.g. "Head (White)", excluding Master Rank override rows)', k.url);
    push('head_stagger', kd.head_stagger, 'damage (Part Breakability, exact "Head" row)', k.url);
    push('tolerance_poison', kd.tolerances.poison, 'status build-up points', k.url);
    push('tolerance_paralysis', kd.tolerances.paralysis, 'status build-up points', k.url);
    push('tolerance_sleep', kd.tolerances.sleep, 'status build-up points', k.url);
    push('tolerance_stun', kd.tolerances.stun, 'status build-up points', k.url);
    push('move_power_max', kd.move_power_max, 'motion value (max over Monster Attacks rows; poedb only lists a subset so is not used here)', k.url);

    // Cross-check: gold crown should equal base size times the percent poedb
    // prints for it. Purely informational — never throws, never blocks a row.
    if (pd.size_base !== null && pd.size_gold_pct !== null && kd.size_gold !== null) {
      const expected = pd.size_base * (pd.size_gold_pct / 100);
      if (Math.abs(expected - kd.size_gold) > 0.5) {
        console.warn(`World: ${m.name} size cross-check off by ${(expected - kd.size_gold).toFixed(2)}cm`);
      }
    }
  }

  return rows;
}

// ------------------------------------------------------------------ CLI ----

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rosterPath = new URL('../data/roster.json', import.meta.url);
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
  const monsters = roster.filter((r) => r.source === 'World');
  const rows = await extract(roster);

  const perInput = {};
  for (const row of rows) perInput[row.input] = (perInput[row.input] ?? 0) + 1;

  console.log(`World: ${monsters.length} monsters, ${rows.length} rows`);
  for (const input of RAW_INPUTS) {
    const n = perInput[input] ?? 0;
    console.log(`  ${input.padEnd(22)} ${String(n).padStart(3)}/${monsters.length}`);
  }
}
