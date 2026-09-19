// Assembles mhstats-quiz-bank.js from authored question files.
//
//   node tools/mhstats/build-quiz-bank.mjs <questions.json> [<more.json> ...]
//
// Each input is a JSON array of question objects. Questions are validated, de-duplicated by
// wording, given stable ids, and written out as an ES module. The bank is a module rather
// than JSON so nothing depends on import attributes in the production image, and it sits at
// the repo root rather than under public/ because the CLIENT MUST NEVER BE ABLE TO FETCH IT:
// a browser holding the bank is a browser holding every answer.
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';

const ROOT = new URL('../../', import.meta.url);
const roster = JSON.parse(readFileSync(new URL('tools/mhstats/data/roster.json', ROOT), 'utf8'));
const G56 = new Set(['MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds']);
const gen56 = new Set(roster.filter(m => (m.games || []).some(g => G56.has(g))).map(m => m.id));

// Every monster name, longest first, so "Azure Rathalos" is matched before "Rathalos".
// The shortest names in the roster are Gobul, Khezu, Kirin, Amatsu, Leshen, Rajang, Seltas,
// Tigrex and Xu Wu — none of them ordinary English words, so word-boundary matching is safe.
const NAMED = roster
  .map(m => ({ id: m.id, name: m.name, re: new RegExp(`\\b${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') }))
  .sort((a, b) => b.name.length - a.name.length);

// Which monsters a question actually puts in front of a player, read off the text rather
// than taken on trust from `refs`. A question can simply forget to declare a ref; it cannot
// forget to mention the monster it is asking about.
export function monstersNamedIn(q) {
  let haystack = ` ${q.q} ${(q.options ?? []).join(' ')} `;
  const found = [];
  for (const m of NAMED) {
    if (!m.re.test(haystack)) continue;
    found.push(m.id);
    // Blank the match so a longer name does not also count as the shorter one inside it.
    haystack = haystack.replace(new RegExp(m.re.source, 'gi'), ' ');
  }
  return found;
}

const KINDS = ['choice', 'estimate'];
const CATS = ['mh', 'gen'];

// Hiragana, katakana, CJK and halfwidth katakana. The quiz is played in English by people
// who play these games in English: asking which monster is called ベリオロス tests whether
// you can read kana, not whether you know Monster Hunter. Enforced here rather than left to
// whoever is authoring, because it is an easy and tempting question to write.
const JAPANESE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾝ]/;

export function validate(q, seen = new Set()) {
  const fail = why => `${q?.id ?? '(no id)'}: ${why}`;
  if (!q || typeof q !== 'object') return fail('not an object');
  if (typeof q.id !== 'string' || !/^[a-z0-9-]+$/.test(q.id)) return fail('id must be kebab-case');
  if (seen.has(q.id)) return fail('duplicate id');
  if (!CATS.includes(q.cat)) return fail(`cat must be one of ${CATS.join('/')}`);
  if (!KINDS.includes(q.kind)) return fail(`kind must be one of ${KINDS.join('/')}`);
  if (typeof q.q !== 'string' || q.q.trim().length < 10) return fail('question text too short');
  if (typeof q.src !== 'string' || !q.src.trim()) return fail('every question needs a src');
  if (JAPANESE.test(q.q) || (q.options ?? []).some(o => JAPANESE.test(o))) {
    return fail('Japanese script: this quiz is played in English');
  }

  if (q.kind === 'choice') {
    if (!Array.isArray(q.options) || q.options.length !== 4) return fail('a choice needs exactly four options');
    if (q.options.some(o => typeof o !== 'string' || !o.trim())) return fail('empty option');
    if (new Set(q.options.map(o => o.trim().toLowerCase())).size !== 4) return fail('duplicate options');
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer > 3) return fail('answer must be an index 0-3');
    if (q.unit !== undefined) return fail('a choice has no unit');
  } else {
    if (typeof q.answer !== 'number' || !Number.isFinite(q.answer)) return fail('estimate answer must be a finite number');
    if (typeof q.unit !== 'string' || !q.unit.trim()) return fail('an estimate needs a unit');
    if (q.options !== undefined) return fail('an estimate has no options');
  }

  // The rule the whole MH half rests on: generation 5 and 6 only. Enforced against the
  // TEXT, not against `refs` — a question can forget to declare a ref, but it cannot forget
  // to name the monster it asks about, and a wrong multiple-choice option is still a monster
  // the question puts in front of a player. Questions about places and systems name no
  // monster at all, which is fine: the user asked for areas as well as monsters.
  if (q.cat === 'mh') {
    const named = monstersNamedIn(q);
    const stray = named.filter(r => !gen56.has(r));
    if (stray.length) return fail(`names monsters outside generations 5-6: ${stray.join(', ')}`);
    const declared = (q.refs ?? []).filter(r => !gen56.has(r));
    if (declared.length) return fail(`refs outside generations 5-6: ${declared.join(', ')}`);
  } else if (q.refs !== undefined) {
    return fail('a general question has no refs');
  }
  return null;
}

// The options are part of the key, not just the text: "which of these does NOT appear in
// Wilds?" is a different question every time the four monsters change, and keying on the
// sentence alone threw all but the first away. Unicode-aware because stripping to [a-z0-9]
// collapses anything non-Latin to the same key.
const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const wording = q => `${norm(q.q).slice(0, 80)}|${(q.options ?? []).map(norm).sort().join(',')}`;

export function assemble(batches) {
  const seen = new Set();
  const words = new Set();
  const kept = [];
  const rejected = [];
  for (const q of batches.flat()) {
    const problem = validate(q, seen);
    if (problem) { rejected.push(problem); continue; }
    const w = wording(q);
    if (words.has(w)) { rejected.push(`${q.id}: duplicate wording`); continue; }
    seen.add(q.id);
    words.add(w);
    // Field order is fixed so the emitted file diffs cleanly.
    const clean = { id: q.id, cat: q.cat, kind: q.kind, q: q.q.trim() };
    if (q.kind === 'choice') { clean.options = q.options.map(o => o.trim()); clean.answer = q.answer; }
    else { clean.answer = q.answer; clean.unit = q.unit.trim(); }
    clean.src = q.src.trim();
    // Refs are recorded from what the question actually names, so the bank stays
    // self-describing even when the author left them out.
    if (q.cat === 'mh') {
      const refs = [...new Set([...(q.refs ?? []), ...monstersNamedIn(q)])];
      if (refs.length) clean.refs = refs;
    }
    kept.push(clean);
  }
  kept.sort((a, b) => a.cat.localeCompare(b.cat) || a.id.localeCompare(b.id));
  return { kept, rejected };
}

export function emit(questions) {
  const mh = questions.filter(q => q.cat === 'mh').length;
  const gen = questions.filter(q => q.cat === 'gen').length;
  return `// The MH Stats quiz bank. Generated by tools/mhstats/build-quiz-bank.mjs — do not hand-edit;
// author questions into the input files and rebuild, so validation always runs.
//
// ${questions.length} questions: ${mh} Monster Hunter (generations 5 and 6 only), ${gen} general knowledge.
//
// This module is deliberately NOT under public/. The client never receives it: the server
// sends one question at a time without its answer, and the answer only once the question has
// closed. A browser that could fetch this file would hold every answer in the game.
//
// Every question carries a \`src\`. A question that could not be sourced was not written.
export const QUESTIONS = ${JSON.stringify(questions, null, 1)};
`;
}

// Run directly: read the given JSON files, assemble, write the bank.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('usage: node tools/mhstats/build-quiz-bank.mjs <questions.json> [...]');
    process.exit(1);
  }
  const batches = files.map(f => JSON.parse(readFileSync(f, 'utf8')));
  const { kept, rejected } = assemble(batches);
  writeFileSync(new URL('mhstats-quiz-bank.js', ROOT), emit(kept));
  console.log(`bank written: ${kept.length} questions`);
  console.log(`  mh  ${kept.filter(q => q.cat === 'mh').length}`);
  console.log(`  gen ${kept.filter(q => q.cat === 'gen').length}`);
  console.log(`  choice ${kept.filter(q => q.kind === 'choice').length}, estimate ${kept.filter(q => q.kind === 'estimate').length}`);
  if (rejected.length) {
    console.log(`rejected ${rejected.length}:`);
    for (const r of rejected.slice(0, 40)) console.log(`  - ${r}`);
    if (rejected.length > 40) console.log(`  ... and ${rejected.length - 40} more`);
  }
}
