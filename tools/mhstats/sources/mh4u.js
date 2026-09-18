// 4 Ultimate extractor. Source: Kiranico MH4U (https://kiranico.com/en/mh4u/monster).
// Every monster page renders its tables from Angular templates that are empty in the
// raw HTML; the real data is an inline `window.js_vars = {"monster": {...}}` blob.
//
// See docs/superpowers/research/2026-09-18-source-locators.md, section "######## 4U",
// for the verified locators and the skeptic's FAILED corrections this file follows:
//   - size_base has no fixed crown divisor (candidates must be compared, not assumed).
//   - hp_mult_* rank-total multipliers are frequently '0.0' and must never be used.
//   - monster.link sometimes contains '/index.php/'; URLs are built from the index slug.
//   - weaponspecialattack ids live at pivot.weaponspecialattack_id, not on the row itself
//     (unused here since we match by local_name, as the card's own locator does).
//   - stagger "region" can be '' on any monster, not just the elder dragons; always
//     match /^head/i and take the first hit.
//   - hitzone type 'A' still contains conditional parenthetical-state parts (e.g.
//     "Tail (Inflated)"), which must be excluded from both the max-raw and the
//     mean-raw hitzone (the two share one part set by construction).
import { cachedFetch } from '../lib/fetch.js';
import { obsRow } from '../lib/observations.js';

const INDEX_URL = 'https://kiranico.com/en/mh4u/monster';
const GAME = 'MH4U';

// The source's own spelling differs from the roster's for two monsters:
// one dot-abbreviated on Kiranico and spelled out on the wiki roster, and one
// that 4U shipped as "White Fatalis" before Generations renamed it "Old Fatalis".
const ALIASES = {
  'plum-daimyo-hermitaur': 'Plum D.Hermitaur',
  'old-fatalis': 'White Fatalis',
};

function decodeEntities(s) {
  return s
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function num(x) {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

// A '0.0' string (or numeric 0) from crown_*, rage_mod_* or hp_mult_* means "missing",
// never a real zero (see the task's own gotcha and the card's QUIRKS #2/#3).
function nonZero(x) {
  const n = num(x);
  return n && n !== 0 ? n : null;
}

/**
 * Pure derive: takes the parsed `window.js_vars` blob for one monster page
 * ({ monster: {...} }) and returns the raw facts this source genuinely has, as
 * { [input]: { value, unit } }. A missing input is simply absent from the result;
 * this function never invents or zeroes a value.
 */
export function deriveMh4u(jsVars) {
  const m = jsVars?.monster ?? {};
  const facts = {};

  const baseHp = num(m.base_hp);
  if (baseHp) facts.base_hp = { value: baseHp, unit: 'HP' };

  // Base size has no fixed divisor: compute all three candidates and use the one
  // they agree on. crown_* is missing (not zero) once any of the three is '0.0'.
  const king = nonZero(m.crown_king);
  const large = nonZero(m.crown_large);
  const mini = nonZero(m.crown_miniature);
  if (king && large && mini) {
    const a = king / 1.23;
    const b = large / 1.15;
    const c = mini / 0.90;
    const spread = Math.max(a, b, c) - Math.min(a, b, c);
    const base = spread <= 0.5 ? (a + b + c) / 3 : c;
    facts.size_base = { value: base, unit: 'cm' };
    facts.size_gold = { value: king, unit: 'cm' };
  }

  const atk = nonZero(m.rage_mod_attack);
  if (atk) facts.enrage_attack_mult = { value: atk, unit: 'multiplier' };
  const spd = nonZero(m.rage_mod_speed);
  if (spd) facts.enrage_speed_mult = { value: spd, unit: 'multiplier' };
  const dur = nonZero(m.rage_duration);
  if (dur) facts.enrage_duration = { value: dur, unit: 'seconds' };
  // enrage_trigger does not exist for 4U in any source found (card FIELDS: present=False).

  // Hitzones: type 'A' is the default-state damage table (B/C are alternate/enraged
  // states). Even within type A, parenthetical state parts (e.g. "Tail (Inflated)")
  // are conditional and must be excluded from the max.
  const parts = Array.isArray(m.monsterbodyparts) ? m.monsterbodyparts : [];
  const defaultParts = parts.filter(p => p?.pivot?.type === 'A' && !/\(/.test(p?.local_name ?? ''));
  const partMaxes = defaultParts
    .map(p => {
      const vals = [num(p.pivot?.res_cut), num(p.pivot?.res_impact), num(p.pivot?.res_shot)]
        .filter(v => v !== null);
      return vals.length ? Math.max(...vals) : null;
    })
    .filter(v => v !== null);
  if (partMaxes.length) {
    facts.hitzone_max_raw = { value: Math.max(...partMaxes), unit: 'hitzone %' };
    // The mean over the SAME parts is the toughness measure: the max only finds the
    // one soft spot every monster has, so it saturates and cannot rank armour.
    const mean = partMaxes.reduce((sum, v) => sum + v, 0) / partMaxes.length;
    facts.hitzone_mean_raw = {
      value: Math.round(mean * 10) / 10,
      unit: 'percent (mean over default-state parts)',
    };
  }

  // head_stagger: region can be '' on any monster; always match /^head/i and take
  // the first hit (some monsters, e.g. Red Khezu, have two rows named "Head").
  const staggers = Array.isArray(m.monsterstaggerlimits) ? m.monsterstaggerlimits : [];
  const head = staggers.find(s => /^head/i.test(s?.region ?? ''));
  const headValue = head ? num(head.value) : null;
  if (headValue !== null) facts.head_stagger = { value: headValue, unit: 'damage' };

  // Tolerances: names are 'Para' and 'KO', not Paralysis/Stun. 0 means immune, so
  // it must emit no row rather than a zero.
  const attacks = Array.isArray(m.weaponspecialattacks) ? m.weaponspecialattacks : [];
  const TOLERANCE_INPUTS = {
    Poison: 'tolerance_poison',
    Para: 'tolerance_paralysis',
    Sleep: 'tolerance_sleep',
    KO: 'tolerance_stun',
  };
  for (const [label, input] of Object.entries(TOLERANCE_INPUTS)) {
    const row = attacks.find(w => w?.local_name === label);
    const v = row ? num(row.pivot?.initial) : null;
    if (v) facts[input] = { value: v, unit: 'status build-up points' };
  }
  // move_power_max does not exist for 4U in any source found (card FIELDS: present=False).

  return facts;
}

async function fetchIndex() {
  const html = await cachedFetch(INDEX_URL, { as: 'text', cacheName: 'kiranico-mh4u-index.html' });
  const byName = new Map();
  const re = /href="https:\/\/kiranico\.com\/en\/mh4u\/monster\/([^"]+)">([^<]+)<\/a>/g;
  let match;
  while ((match = re.exec(html))) {
    const [, slug, rawName] = match;
    const name = decodeEntities(rawName);
    if (!byName.has(name)) byName.set(name, slug);
  }
  return byName;
}

async function fetchMonster(slug) {
  const url = `https://kiranico.com/en/mh4u/monster/${slug}`;
  const html = await cachedFetch(url, { as: 'text', cacheName: `kiranico-mh4u-${slug}.html` });
  const m = /window\.js_vars\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/.exec(html);
  if (!m) throw new Error(`mh4u: no window.js_vars found on ${url}`);
  return { jsVars: JSON.parse(m[1]), url };
}

export async function extract(roster) {
  const bySourceName = await fetchIndex();

  const missing = [];
  const targets = roster.map(entry => {
    const sourceName = ALIASES[entry.id] ?? entry.name;
    const slug = bySourceName.get(sourceName);
    if (!slug) missing.push(`${entry.name} (${entry.id})`);
    return { entry, slug };
  });
  if (missing.length) {
    throw new Error(`mh4u: no Kiranico slug found for: ${missing.join(', ')}`);
  }

  const rows = [];
  for (const { entry, slug } of targets) {
    const { jsVars, url } = await fetchMonster(slug);
    const facts = deriveMh4u(jsVars);
    for (const [input, { value, unit }] of Object.entries(facts)) {
      rows.push(obsRow({ monster: entry.id, game: GAME, input, value, unit, source: url }));
    }
  }
  return rows;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const { readFileSync } = await import('fs');
  const rosterPath = new URL('../data/roster.json', import.meta.url).pathname;
  const roster = JSON.parse(readFileSync(rosterPath, 'utf8')).filter(r => r.source === '4U');

  const rows = await extract(roster);

  const byMonster = new Map();
  for (const r of rows) {
    if (!byMonster.has(r.monster)) byMonster.set(r.monster, new Set());
    byMonster.get(r.monster).add(r.input);
  }
  const inputCounts = new Map();
  for (const r of rows) inputCounts.set(r.input, (inputCounts.get(r.input) ?? 0) + 1);

  console.log(`mh4u: ${roster.length} monsters, ${rows.length} rows`);
  console.log('coverage by input:');
  for (const [input, count] of [...inputCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${input.padEnd(20)} ${count}/${roster.length}`);
  }
  const thin = roster.filter(r => (byMonster.get(r.id)?.size ?? 0) < 6);
  if (thin.length) {
    console.log('monsters with fewer than 6 inputs:');
    for (const r of thin) console.log(`  ${r.name}: ${byMonster.get(r.id)?.size ?? 0} inputs`);
  }
}
