import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { QUESTIONS } from '../mhstats-quiz-bank.js';
import { QUESTIONS_PER_QUIZ } from '../mhstats-quiz.js';

// Asserted directly rather than by calling the builder's own validator: a test that reuses
// the implementation's rules only proves the implementation agrees with itself.

const roster = JSON.parse(readFileSync(new URL('../tools/mhstats/data/roster.json', import.meta.url), 'utf8'));
const G56 = new Set(['MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds']);
const gen56 = new Set(roster.filter(m => (m.games || []).some(g => G56.has(g))).map(m => m.id));

// A category quiz deals ten and `both` deals five of each, so ten per category is the hard
// floor. The comfortable floor is what stops the same questions coming round every game.
const MIN_PER_CAT = 60;
const JAPANESE = /[぀-ゟ゠-ヿ一-鿿ｦ-ﾝ]/;

const mh = QUESTIONS.filter(q => q.cat === 'mh');
const gen = QUESTIONS.filter(q => q.cat === 'gen');

describe('mhstats quiz bank', () => {
  it('holds enough of each kind to deal without repeating', () => {
    expect(mh.length, 'monster hunter questions').toBeGreaterThanOrEqual(MIN_PER_CAT);
    expect(gen.length, 'general knowledge questions').toBeGreaterThanOrEqual(MIN_PER_CAT);
    expect(mh.length).toBeGreaterThanOrEqual(QUESTIONS_PER_QUIZ);
    expect(gen.length).toBeGreaterThanOrEqual(QUESTIONS_PER_QUIZ);
  });

  it('gives every question a unique id', () => {
    const ids = QUESTIONS.map(q => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, `${id} should be kebab-case`).toMatch(/^[a-z0-9-]+$/);
  });

  // The rule that keeps a hand-authored bank honest. A question nobody could source is a
  // question somebody made up.
  it('sources every single question', () => {
    for (const q of QUESTIONS) {
      expect(typeof q.src, `${q.id} src`).toBe('string');
      expect(q.src.trim().length, `${q.id} has an empty src`).toBeGreaterThan(0);
    }
  });

  it('asks every question as a question', () => {
    for (const q of QUESTIONS) {
      expect(q.q.trim().endsWith('?'), `${q.id}: "${q.q}"`).toBe(true);
      expect(q.q.length, `${q.id} is too short to be clear`).toBeGreaterThan(15);
      expect(q.q.length, `${q.id} is too long to read on a phone`).toBeLessThan(200);
    }
  });

  it('gives a choice exactly four distinct options and a real answer', () => {
    for (const q of QUESTIONS.filter(x => x.kind === 'choice')) {
      expect(q.options, `${q.id} options`).toHaveLength(4);
      expect(new Set(q.options.map(o => o.trim().toLowerCase())).size, `${q.id} has repeated options`).toBe(4);
      expect(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3, `${q.id} answer ${q.answer}`).toBe(true);
      expect(q.unit, `${q.id} is a choice and should carry no unit`).toBeUndefined();
    }
  });

  it('gives an estimate a finite number and a unit a person can picture', () => {
    for (const q of QUESTIONS.filter(x => x.kind === 'estimate')) {
      expect(Number.isFinite(q.answer), `${q.id} answer ${q.answer}`).toBe(true);
      expect(typeof q.unit === 'string' && q.unit.trim().length > 0, `${q.id} unit`).toBe(true);
      expect(q.options, `${q.id} is an estimate and should carry no options`).toBeUndefined();
    }
  });

  // The rule the user set: generation 5 and 6 only. A monster that debuted earlier counts as
  // long as it shows up in World, Iceborne, Rise, Sunbreak or Wilds — and a wrong option is
  // still a monster the question puts in front of a player, so it is held to the same rule.
  //
  // Checked against the question TEXT rather than the declared refs, because a question can
  // forget to declare a ref but cannot forget to name the monster it asks about. Questions
  // about places and systems name no monster at all, which is allowed: the ask was for areas
  // as well as monsters.
  it('never puts a monster from outside generations 5 and 6 in front of a player', () => {
    const named = roster
      .map(m => ({ id: m.id, name: m.name }))
      .sort((a, b) => b.name.length - a.name.length);
    for (const q of mh) {
      let text = ` ${q.q} ${(q.options ?? []).join(' ')} `;
      for (const m of named) {
        const re = new RegExp(`\\b${m.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
        if (!re.test(text)) continue;
        expect(gen56.has(m.id), `${q.id} names ${m.name}, which is not in a gen 5 or 6 game`).toBe(true);
        text = text.replace(new RegExp(re.source, 'gi'), ' ');
      }
    }
  });

  it('keeps declared refs inside generations 5 and 6 too', () => {
    for (const q of mh) {
      for (const ref of q.refs ?? []) {
        expect(gen56.has(ref), `${q.id} refers to ${ref}, which is not in a gen 5 or 6 game`).toBe(true);
      }
    }
  });

  it('keeps general questions free of Monster Hunter', () => {
    for (const q of gen) expect(q.refs, `${q.id} should have no refs`).toBeUndefined();
  });

  // We play these games in English. Asking which monster is called by its Japanese name
  // tests whether you can read kana, not whether you know Monster Hunter.
  it('is written in English', () => {
    for (const q of QUESTIONS) {
      expect(JAPANESE.test(q.q), `${q.id}: "${q.q}"`).toBe(false);
      for (const o of q.options ?? []) expect(JAPANESE.test(o), `${q.id} option "${o}"`).toBe(false);
    }
  });

  it('does not ask the same question twice', () => {
    const seen = new Map();
    for (const q of QUESTIONS) {
      const norm = s => String(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      const key = `${norm(q.q).slice(0, 80)}|${(q.options ?? []).map(norm).sort().join(',')}`;
      expect(seen.has(key), `${q.id} repeats ${seen.get(key)}`).toBe(false);
      seen.set(key, q.id);
    }
  });

  it('declares a known category and kind throughout', () => {
    for (const q of QUESTIONS) {
      expect(['mh', 'gen'], `${q.id} cat`).toContain(q.cat);
      expect(['choice', 'estimate'], `${q.id} kind`).toContain(q.kind);
    }
  });

  // Both kinds have to exist in both categories, or a quiz turns into ten of the same shape.
  it('mixes both kinds into both categories', () => {
    for (const [name, set] of [['mh', mh], ['gen', gen]]) {
      const choices = set.filter(q => q.kind === 'choice').length;
      const estimates = set.filter(q => q.kind === 'estimate').length;
      expect(choices, `${name} has no multiple choice`).toBeGreaterThan(0);
      expect(estimates, `${name} has no estimates`).toBeGreaterThan(0);
    }
  });
});
