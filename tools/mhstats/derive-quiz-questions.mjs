// Generates the derived half of the quiz bank from data already verified on disk.
//
//   node tools/mhstats/derive-quiz-questions.mjs   ->  tools/mhstats/data/quiz-derived.json
//
// Every answer here is copied out of roster.json or deck.json, so `src` points at the file
// and the value can be re-checked by reading it — no research, nothing remembered. The other
// half of the bank, data/quiz-authored.json, is researched and carries URLs instead.
// English only: no kana, no kanji. We play these games in English.
import { readFileSync, writeFileSync } from 'fs';

const ROOT = new URL('../../', import.meta.url);
const roster = JSON.parse(readFileSync(new URL('tools/mhstats/data/roster.json', ROOT), 'utf8'));
const deck = JSON.parse(readFileSync(new URL('public/mhstats/deck.json', ROOT), 'utf8'));

const G56 = new Set(['MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds']);
const gen56 = roster.filter(m => (m.games || []).some(g => G56.has(g)));
const gen56Ids = new Set(gen56.map(m => m.id));
const rosterById = new Map(roster.map(m => [m.id, m]));
const deckById = new Map(deck.monsters.map(m => [m.id, m]));

let s = 20260919;
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const shuffle = a => { const c = a.slice(); for (let i = c.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [c[i], c[j]] = [c[j], c[i]]; } return c; };

const GAME_NAMES = {
  MHWorld: 'Monster Hunter World', MHWI: 'Monster Hunter World: Iceborne',
  MHRise: 'Monster Hunter Rise', MHRS: 'Monster Hunter Rise: Sunbreak',
  MHWilds: 'Monster Hunter Wilds', MHGU: 'Monster Hunter Generations Ultimate',
  MH4U: 'Monster Hunter 4 Ultimate', MH3U: 'Monster Hunter 3 Ultimate',
  MHFU: 'Monster Hunter Freedom Unite',
};
const numberOf = raw => { const m = /^([\d.]+)\s*\(([A-Za-z0-9]+)\)$/.exec(String(raw ?? '')); return m ? { value: Number(m[1]), game: m[2] } : null; };
const sizeOf = id => { const d = deckById.get(id); const n = d && numberOf(d.raw?.size_base); return n ? n.value : null; };

const out = [];

// --- Which game did it debut in ----------------------------------------------------------
const DEBUT_GAMES = { MHWorld: 'Monster Hunter World', MHWI: 'Monster Hunter World: Iceborne', MHRise: 'Monster Hunter Rise', MHRS: 'Monster Hunter Rise: Sunbreak', MHWilds: 'Monster Hunter Wilds' };
const DEBUT_PICKS = [
  'nergigante', 'magnamalo', 'arkveld', 'velkhana', 'malzeno', 'bazelgeuse', 'anjanath',
  'mizutsune', 'goss-harag', 'rey-dau', 'uth-duna', 'chatacabra', 'namielle', 'shara-ishvalda',
  'almudron', 'rakna-kadaki', 'lunagaron', 'garangolm', 'doshaguma', 'xeno-jiiva',
];
for (const id of DEBUT_PICKS) {
  const m = rosterById.get(id);
  if (!m || !gen56Ids.has(id) || !DEBUT_GAMES[m.debut]) continue;
  const wrong = shuffle(Object.values(DEBUT_GAMES).filter(g => g !== DEBUT_GAMES[m.debut])).slice(0, 3);
  const options = shuffle([DEBUT_GAMES[m.debut], ...wrong]);
  out.push({
    id: `mh-debut-${id}`, cat: 'mh', kind: 'choice',
    q: `Which game did ${m.name} first appear in?`,
    options, answer: options.indexOf(DEBUT_GAMES[m.debut]),
    src: `roster.json:${id}.debut`, refs: [id],
  });
}

// --- Odd one out: which of these is not in that game -------------------------------------
// Every option is a generation 5/6 monster; the odd one out simply is not in the game named.
for (const game of ['MHWilds', 'MHWorld', 'MHRise', 'MHRS', 'MHWI']) {
  const inGame = shuffle(gen56.filter(m => m.games.includes(game)));
  const outGame = shuffle(gen56.filter(m => !m.games.includes(game)));
  for (let n = 0; n < 4 && inGame.length >= 3 * (n + 1) && outGame.length > n; n++) {
    const three = inGame.slice(n * 3, n * 3 + 3);
    const odd = outGame[n];
    if (three.length < 3 || !odd) break;
    const options = shuffle([...three, odd]);
    out.push({
      id: `mh-notin-${game.toLowerCase()}-${n}`, cat: 'mh', kind: 'choice',
      q: `Which of these monsters does NOT appear in ${GAME_NAMES[game]}?`,
      options: options.map(o => o.name), answer: options.findIndex(o => o.id === odd.id),
      src: `roster.json:${odd.id}.games`, refs: options.map(o => o.id),
    });
  }
}

// --- Which is longest --------------------------------------------------------------------
const sized = shuffle(gen56.filter(m => sizeOf(m.id) !== null));
for (let n = 0; n < 8; n++) {
  const four = sized.slice(n * 4, n * 4 + 4);
  if (four.length < 4) break;
  const ranked = four.slice().sort((a, b) => sizeOf(b.id) - sizeOf(a.id));
  // Only ask when the winner is clear: a near-tie is a coin flip, not a question.
  if (sizeOf(ranked[0].id) < sizeOf(ranked[1].id) * 1.25) continue;
  out.push({
    id: `mh-longest-${n}`, cat: 'mh', kind: 'choice',
    q: 'Which of these monsters is the longest, nose to tail?',
    options: four.map(o => o.name), answer: four.findIndex(o => o.id === ranked[0].id),
    src: `deck.json:${ranked[0].id}.raw.size_base`, refs: four.map(o => o.id),
  });
}

// --- Numbers straight out of the deck ----------------------------------------------------
const HP_PICKS = ['arkveld', 'nergigante', 'magnamalo', 'rathalos', 'fatalis', 'velkhana', 'zinogre', 'diablos', 'malzeno', 'bazelgeuse', 'teostra', 'anjanath'];
for (const id of HP_PICKS) {
  const d = deckById.get(id);
  if (!d || !gen56Ids.has(id)) continue;
  const hp = numberOf(d.raw?.base_hp);
  if (!hp || !GAME_NAMES[hp.game]) continue;
  out.push({
    id: `mh-hp-${id}`, cat: 'mh', kind: 'estimate',
    q: `Roughly how much base health does ${d.name} have in ${GAME_NAMES[hp.game]}?`,
    answer: hp.value, unit: 'HP',
    src: `deck.json:${id}.raw.base_hp`, refs: [id],
  });
}

const SIZE_PICKS = ['arkveld', 'jin-dahaad', 'rathalos', 'nergigante', 'magnamalo', 'zorah-magdaros', 'velkhana', 'diablos', 'great-izuchi', 'chatacabra', 'uth-duna', 'rey-dau', 'malzeno', 'nu-udra'];
for (const id of SIZE_PICKS) {
  const d = deckById.get(id);
  if (!d || !gen56Ids.has(id)) continue;
  const size = numberOf(d.raw?.size_base);
  if (!size || !GAME_NAMES[size.game]) continue;
  out.push({
    id: `mh-size-${id}`, cat: 'mh', kind: 'estimate',
    q: `About how long is ${d.name}, nose to tail, in metres (as measured in ${GAME_NAMES[size.game]})?`,
    answer: Math.round(size.value) / 100, unit: 'm',
    src: `deck.json:${id}.raw.size_base`, refs: [id],
  });
}

const JAPANESE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾝ]/;
const bad = out.filter(q => (q.refs ?? []).some(r => !gen56Ids.has(r)));
if (bad.length) throw new Error(`seed references non-gen5/6 monsters: ${bad.map(q => q.id).join(', ')}`);
const jp = out.filter(q => JAPANESE.test(q.q) || (q.options ?? []).some(o => JAPANESE.test(o)));
if (jp.length) throw new Error(`seed contains Japanese script: ${jp.map(q => q.id).join(', ')}`);

writeFileSync(new URL('tools/mhstats/data/quiz-derived.json', ROOT), `${JSON.stringify(out, null, 1)}\n`);
console.log(`derived questions: ${out.length}`);
console.log(`  choice: ${out.filter(q => q.kind === 'choice').length}, estimate: ${out.filter(q => q.kind === 'estimate').length}`);
console.log(`  english only: ${jp.length === 0}, all refs gen5/6: ${bad.length === 0}`);
