import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  STATS, STAT_KEYS, ROUNDS, mulberry32, drawMonsters,
  newRun, currentMonster, freeStats, pick, isComplete, score, valueOf,
  bestAssignment, worstAssignment, encodeShare, decodeShare, randomSeed, AIM_HIGH, AIM_LOW, outcome,
  canReroll, reroll, rebuildRun, dealMonsters,
  GENS, ALL_GENS, gensToMask, maskToGens, poolFor,
} from '../public/mhstats/game.js';

const deck = JSON.parse(readFileSync(new URL('./fixtures/mhstats-deck.json', import.meta.url), 'utf8'));

describe('mhstats game: stats and rng', () => {
  it('exposes the seven stats in spec order', () => {
    // The keys are what share codes and saved runs are written in, so they are frozen even
    // when a label changes: 'wil' reads as "Resist" now, because next to Temper the old
    // "Will" read as a second word for temperament rather than shrugging off status.
    expect(STAT_KEYS).toEqual(['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp']);
    expect(STATS.map(s => s.label)).toEqual(['HP', 'Attack', 'Defense', 'Speed', 'Resist', 'Size', 'Temper']);
    expect(ROUNDS).toBe(7);
  });

  it('explains every stat in a sentence', () => {
    for (const s of STATS) {
      expect(typeof s.help, `${s.key} help`).toBe('string');
      expect(s.help.length, `${s.key} help`).toBeGreaterThan(20);
    }
  });

  it('mulberry32 is deterministic and in [0,1)', () => {
    const a = mulberry32(42), b = mulberry32(42);
    const xs = Array.from({ length: 5 }, () => a());
    const ys = Array.from({ length: 5 }, () => b());
    expect(xs).toEqual(ys);
    for (const x of xs) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); }
    expect(new Set(xs).size).toBe(5);
  });
});

describe('mhstats game: drawMonsters', () => {
  it('draws seven distinct monsters deterministically for a seed', () => {
    const a = drawMonsters(deck, 123);
    const b = drawMonsters(deck, 123);
    expect(a).toHaveLength(7);
    expect(new Set(a.map(m => m.id)).size).toBe(7);
    expect(a.map(m => m.id)).toEqual(b.map(m => m.id));
  });

  it('different seeds give different draws', () => {
    const a = drawMonsters(deck, 1).map(m => m.id);
    const b = drawMonsters(deck, 2).map(m => m.id);
    expect(a).not.toEqual(b);
  });

  it('throws when the deck is smaller than the draw', () => {
    expect(() => drawMonsters({ monsters: deck.monsters.slice(0, 3) }, 1)).toThrow(/at least 7/);
    // A run also needs a reserve behind each monster, so fourteen is the real floor.
    expect(() => newRun({ monsters: deck.monsters.slice(0, 13) }, 1)).toThrow(/at least 14/);
  });
});

describe('mhstats game: run and picks', () => {
  it('starts with seven monsters, no picks, first monster current', () => {
    const run = newRun(deck, 7);
    expect(run.seed).toBe(7);
    expect(run.monsters).toHaveLength(7);
    expect(run.picks).toEqual([]);
    expect(currentMonster(run)).toBe(run.monsters[0]);
    expect(freeStats(run)).toEqual(STAT_KEYS);
    expect(isComplete(run)).toBe(false);
    expect(score(run)).toBe(0);
  });

  it('pick appends, advances, removes the stat and does not mutate', () => {
    const run = newRun(deck, 7);
    const next = pick(run, 'atk');
    expect(run.picks).toEqual([]);
    expect(next.picks).toEqual(['atk']);
    expect(currentMonster(next)).toBe(run.monsters[1]);
    expect(freeStats(next)).not.toContain('atk');
    expect(score(next)).toBe(valueOf(run.monsters[0], 'atk'));
  });

  it('rejects a used stat and an unknown stat', () => {
    const run = pick(newRun(deck, 7), 'hp');
    expect(() => pick(run, 'hp')).toThrow(/already used/);
    expect(() => pick(run, 'nope')).toThrow(/unknown stat/);
  });

  it('completes after seven picks and rejects an eighth', () => {
    let run = newRun(deck, 7);
    for (const k of STAT_KEYS) run = pick(run, k);
    expect(isComplete(run)).toBe(true);
    expect(currentMonster(run)).toBeNull();
    expect(freeStats(run)).toEqual([]);
    const expected = run.monsters.reduce((s, m, i) => s + m.stats[run.picks[i]], 0);
    expect(score(run)).toBe(expected);
    expect(() => pick(run, 'hp')).toThrow(/complete/);
  });
});

describe('mhstats game: assignments', () => {
  // Two monsters that share a strong stat force a real trade-off.
  const tiny = [
    { id: 'a', stats: { hp: 90, atk: 10, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 } },
    { id: 'b', stats: { hp: 80, atk: 70, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 } },
    { id: 'c', stats: { hp: 10, atk: 10, def: 60, spd: 10, wil: 10, siz: 10, tmp: 10 } },
    { id: 'd', stats: { hp: 10, atk: 10, def: 10, spd: 50, wil: 10, siz: 10, tmp: 10 } },
    { id: 'e', stats: { hp: 10, atk: 10, def: 10, spd: 10, wil: 40, siz: 10, tmp: 10 } },
    { id: 'f', stats: { hp: 10, atk: 10, def: 10, spd: 10, wil: 10, siz: 30, tmp: 10 } },
    { id: 'g', stats: { hp: 10, atk: 10, def: 10, spd: 10, wil: 10, siz: 10, tmp: 20 } },
  ];

  it('bestAssignment finds the optimum', () => {
    const best = bestAssignment(tiny);
    expect(best.score).toBe(360);
    expect(best.picks).toEqual(['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp']);
    expect(new Set(best.picks).size).toBe(7);
  });

  it('bestAssignment beats greedy when greedy is wrong', () => {
    const trap = tiny.map(m => ({ ...m, stats: { ...m.stats } }));
    trap[0].stats = { hp: 90, atk: 85, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 };
    trap[1].stats = { hp: 89, atk: 10, def: 10, spd: 10, wil: 10, siz: 10, tmp: 10 };
    const best = bestAssignment(trap);
    expect(best.score).toBe(85 + 89 + 60 + 50 + 40 + 30 + 20);
    expect(best.picks[0]).toBe('atk');
    expect(best.picks[1]).toBe('hp');
  });

  it('worstAssignment is the minimum and never above best', () => {
    const worst = worstAssignment(tiny);
    expect(worst.score).toBe(70);
    expect(worst.score).toBeLessThanOrEqual(bestAssignment(tiny).score);
  });

  it('best and worst on a real draw bracket a played run', () => {
    let run = newRun(deck, 99);
    for (const k of STAT_KEYS) run = pick(run, k);
    const s = score(run);
    expect(bestAssignment(run.monsters).score).toBeGreaterThanOrEqual(s);
    expect(worstAssignment(run.monsters).score).toBeLessThanOrEqual(s);
  });
});

describe('mhstats game: share codes', () => {
  it('round-trips a complete run', () => {
    let run = newRun(deck, 4000000000);
    for (const k of ['tmp', 'siz', 'wil', 'spd', 'def', 'atk', 'hp']) run = pick(run, k);
    const code = encodeShare(run);
    expect(code).toMatch(/^[0-9a-z]+\.[0-6]{7}$/);
    expect(decodeShare(code)).toEqual({ seed: 4000000000, picks: ['tmp', 'siz', 'wil', 'spd', 'def', 'atk', 'hp'], mask: ALL_GENS, aim: AIM_HIGH, rerollAt: null });
  });

  it('round-trips a partial run', () => {
    const run = pick(newRun(deck, 5), 'wil');
    expect(decodeShare(encodeShare(run))).toEqual({ seed: 5, picks: ['wil'], mask: ALL_GENS, aim: AIM_HIGH, rerollAt: null });
  });

  it('rejects malformed codes', () => {
    expect(() => decodeShare('')).toThrow(/malformed/);
    expect(() => decodeShare('12.9')).toThrow(/malformed/);        // 9 is not a stat index
    expect(() => decodeShare('12.01234567')).toThrow(/malformed/); // 7 is not a stat index
    expect(() => decodeShare('12.00000000')).toThrow(/too many/);  // 8 picks, all valid digits
    expect(() => decodeShare('zz.001122')).toThrow(/duplicate/);   // right length, repeated picks
  });

  it('randomSeed is a 32-bit unsigned integer', () => {
    const s = randomSeed(() => 0.999999);
    expect(Number.isInteger(s)).toBe(true);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(0xFFFFFFFF);
    expect(randomSeed(() => 0)).toBe(0);
  });
});

describe('mhstats game: generation filter', () => {
  it('maps generations to a bitmask and back', () => {
    expect(gensToMask([1, 2, 3, 4, 5, 6])).toBe(ALL_GENS);
    expect(maskToGens(ALL_GENS)).toEqual(GENS);
    expect(maskToGens(gensToMask([1, 5]))).toEqual([1, 5]);
  });

  // One reroll per run. The reserve is dealt up front with the other seven, so a rerolled
  // run is still decided entirely by its seed, mask and the position the reroll was spent
  // on -- which is what lets a share link and a duel opponent rebuild it exactly.
  describe('the reroll', () => {
    it('deals a reserve behind every one of the seven', () => {
      const { monsters, reserves } = dealMonsters(deck, 4242, ALL_GENS);
      expect(monsters).toHaveLength(7);
      expect(reserves).toHaveLength(7);
      // Fourteen distinct monsters: no reserve repeats a monster you are already facing,
      // and no two slots share a reserve.
      const all = [...monsters, ...reserves].map(m => m.id);
      expect(new Set(all).size).toBe(14);
    });

    // One shared reserve would have made the reroll the same monster wherever it was spent,
    // which is a fact to learn rather than a risk to take.
    it('gives a different monster depending on where it is spent', () => {
      const base = newRun(deck, 4242, ALL_GENS, AIM_HIGH);
      const got = [];
      for (let at = 0; at < 7; at++) {
        let run = base;
        for (let i = 0; i < at; i++) run = pick(run, STAT_KEYS[i]);
        got.push(reroll(run).monsters[at].id);
      }
      expect(new Set(got).size).toBe(7);
    });

    it('swaps the reserve in for the monster on the table', () => {
      let run = newRun(deck, 4242, ALL_GENS, AIM_HIGH);
      expect(canReroll(run)).toBe(true);
      run = pick(run, 'hp');
      run = pick(run, 'atk');
      const replaced = run.monsters[2];
      const after = reroll(run);
      expect(after.monsters[2].id).toBe(run.reserves[2].id);
      expect(after.monsters[2].id).not.toBe(replaced.id);
      expect(after.rerollAt).toBe(2);
      // Only the monster on the table changes; the ones already played and the ones still
      // to come are untouched.
      expect(after.monsters.filter((_, i) => i !== 2).map(m => m.id))
        .toEqual(run.monsters.filter((_, i) => i !== 2).map(m => m.id));
    });

    it('is spent after one use', () => {
      let run = newRun(deck, 99, ALL_GENS, AIM_HIGH);
      run = reroll(run);
      expect(canReroll(run)).toBe(false);
      expect(() => reroll(run)).toThrow(/spent/);
    });

    it('cannot be spent on a finished run', () => {
      let run = newRun(deck, 99, ALL_GENS, AIM_HIGH);
      for (const k of STAT_KEYS) run = pick(run, k);
      expect(() => reroll(run)).toThrow(/complete/);
    });

    it('survives the share code, monsters and score intact', () => {
      let run = newRun(deck, 4242, ALL_GENS, AIM_HIGH);
      run = pick(run, 'hp');
      run = pick(run, 'atk');
      run = reroll(run);
      for (const k of ['def', 'spd', 'wil', 'siz', 'tmp']) run = pick(run, k);

      const decoded = decodeShare(encodeShare(run));
      expect(decoded.rerollAt).toBe(2);
      const rebuilt = rebuildRun(deck, decoded);
      expect(rebuilt.monsters.map(m => m.id)).toEqual(run.monsters.map(m => m.id));
      expect(score(rebuilt)).toBe(score(run));
    });

    it('rebuilds a run that never rerolled just as faithfully', () => {
      let run = newRun(deck, 777, ALL_GENS, AIM_LOW);
      for (const k of STAT_KEYS) run = pick(run, k);
      const decoded = decodeShare(encodeShare(run));
      expect(decoded.rerollAt).toBeNull();
      expect(rebuildRun(deck, decoded).monsters.map(m => m.id)).toEqual(run.monsters.map(m => m.id));
    });

    // Without the reroll position a code rebuilds a DIFFERENT seven, and the picks stop
    // describing the run that was played.
    it('changes the monsters the code describes', () => {
      let a = newRun(deck, 4242, ALL_GENS, AIM_HIGH);
      const plain = a.monsters.map(m => m.id);
      a = reroll(a);
      expect(a.monsters.map(m => m.id)).not.toEqual(plain);
    });
  });

  it('narrows the pool to the selected generations', () => {
    expect(poolFor(deck, ALL_GENS)).toHaveLength(17);
    expect(poolFor(deck, gensToMask([1]))).toHaveLength(14);
    expect(poolFor(deck, gensToMask([5]))).toHaveLength(3);
    expect(poolFor(deck, gensToMask([1]))).toSatisfy(ms => ms.every(m => m.gen === 1));
  });

  it('draws only from the selected generations', () => {
    const run = newRun(deck, 42, gensToMask([1]));
    expect(run.monsters).toHaveLength(7);
    for (const m of run.monsters) expect(m.gen).toBe(1);
  });

  it('refuses a selection that cannot fill seven slots', () => {
    expect(() => newRun(deck, 1, gensToMask([5]))).toThrow(/at least 14/);
  });

  // The same seed over a different selection is a different run, so the mask has to
  // travel in the share code or a replay would draw the wrong monsters.
  it('carries the mask through the share code', () => {
    let run = newRun(deck, 77, gensToMask([1]));
    for (const k of STAT_KEYS) run = pick(run, k);
    const decoded = decodeShare(encodeShare(run));
    expect(decoded.mask).toBe(gensToMask([1]));
    expect(drawMonsters(deck, decoded.seed, 7, decoded.mask).map(m => m.id))
      .toEqual(run.monsters.map(m => m.id));
  });

  it('treats a code with no mask segment as every generation', () => {
    expect(decodeShare('12.0123456').mask).toBe(ALL_GENS);
  });

  // The aim decides whether a run is judged against the best line or the worst, so a
  // challenge link that lost it would pit two runs against different targets.
  it('carries the aim through the share code', () => {
    let run = newRun(deck, 77, ALL_GENS, AIM_LOW);
    for (const k of STAT_KEYS) run = pick(run, k);
    const decoded = decodeShare(encodeShare(run));
    expect(decoded.aim).toBe(AIM_LOW);
    expect(decoded.mask).toBe(ALL_GENS);
  });

  it('writes the mask whenever it writes the aim', () => {
    // "l" is a legal base-36 mask, so a three-part seed.picks.l would decode as mask 21.
    let run = newRun(deck, 5, ALL_GENS, AIM_LOW);
    run = pick(run, 'wil');
    expect(encodeShare(run).split('.')).toHaveLength(4);
  });

  it('reads a code written before the aim existed as aiming high', () => {
    expect(decodeShare('12.0123456').aim).toBe(AIM_HIGH);
    expect(decodeShare('12.0123456.5').aim).toBe(AIM_HIGH);
  });

  it('rejects an unknown aim', () => {
    expect(() => decodeShare('12.0123456.5.x')).toThrow(/malformed/);
  });

  // The old link challenge wrote a draw character after the aim. Rooms replaced it, but
  // codes carrying it are still out there and must not be refused.
  it('still reads a code that carries the retired draw character', () => {
    expect(decodeShare('12.0123456.5.hr').aim).toBe(AIM_HIGH);
    expect(decodeShare('12.0123456.5.lr').aim).toBe(AIM_LOW);
  });

  it('judges a run against the line it was aiming for', () => {
    let high = newRun(deck, 99, ALL_GENS, AIM_HIGH);
    let low = newRun(deck, 99, ALL_GENS, AIM_LOW);
    for (const k of STAT_KEYS) { high = pick(high, k); low = pick(low, k); }

    const a = outcome(high), b = outcome(low);
    expect(a.total).toBe(b.total);                  // same picks, same points
    expect(a.perfect.score).toBe(a.best.score);     // aiming high chases the ceiling
    expect(b.perfect.score).toBe(b.worst.score);    // aiming low chases the floor
    expect(a.low).toBe(false);
    expect(b.low).toBe(true);
  });

  it('scores a perfect run at 100% whichever way it aimed', () => {
    const monsters = drawMonsters(deck, 123, 7, ALL_GENS);
    for (const aim of [AIM_HIGH, AIM_LOW]) {
      const base = { seed: 123, mask: ALL_GENS, aim, monsters, picks: [] };
      const perfect = aim === AIM_LOW ? worstAssignment(monsters) : bestAssignment(monsters);
      expect(outcome({ ...base, picks: perfect.picks }).pct).toBe(100);
    }
  });

  it('rejects an out-of-range mask', () => {
    expect(() => decodeShare('12.0123456.0')).toThrow(/generation mask/);
    expect(() => decodeShare('12.0123456.zz')).toThrow(/generation mask/);
  });
});
