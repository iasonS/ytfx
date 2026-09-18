import { describe, it, expect } from 'vitest';
import { STAT_MAX, normalise, computeStats } from '../tools/mhstats/scale.js';

const e = (id, game, value) => ({ id, game, value });
const at = (game, value) => ({ value, game });

describe('mhstats scale', () => {
  it('uses a 300-point scale', () => {
    expect(STAT_MAX).toBe(300);
  });

  it('normalises within a game, not across games', () => {
    const n = normalise([e('a', 'MHFU', 1000), e('b', 'MHFU', 2000), e('c', 'MHWilds', 4000), e('d', 'MHWilds', 8000)], {});
    expect(n.get('a')).toBeCloseTo(0);
    expect(n.get('b')).toBeCloseTo(1);
    expect(n.get('c')).toBeCloseTo(0);
    expect(n.get('d')).toBeCloseTo(1);
  });

  it('inverts when asked, so a low hitzone scores high', () => {
    const n = normalise([e('soft', 'MHRise', 90), e('tough', 'MHRise', 20)], { invert: true });
    expect(n.get('tough')).toBeGreaterThan(n.get('soft'));
  });

  it('clips outliers at the 2nd and 98th percentile', () => {
    const entries = Array.from({ length: 50 }, (_, i) => e(`m${i}`, 'MHWorld', 100 + i));
    entries.push(e('siege', 'MHWorld', 100000));
    const n = normalise(entries, { log: true });
    // The siege monster is pinned to the top rather than compressing everyone else to zero.
    expect(n.get('siege')).toBeCloseTo(1);
    expect(n.get('m25')).toBeGreaterThan(0.2);
  });

  it('is single-valued when a game has one monster', () => {
    const n = normalise([e('only', 'MHFU', 42)], {});
    expect(n.get('only')).toBeCloseTo(0.5);
  });

  // Scaling produces only the stats that derive from published figures. Speed derives from
  // nothing at all and Attack only from real per-move damage; both are supplied by the
  // rating file downstream. See ADR-013.
  it('produces the data-derived stats as integers in 1..STAT_MAX', () => {
    const resolved = new Map([
      ['a', {
        base_hp: at('MHRise', 3000), size_base: at('MHRise', 500),
        enrage_attack_mult: at('MHRise', 1.1), enrage_speed_mult: at('MHRise', 1.0),
        hitzone_mean_raw: at('MHRise', 60),
        tolerance_poison: at('MHRise', 100), tolerance_paralysis: at('MHRise', 100),
        tolerance_sleep: at('MHRise', 100), tolerance_stun: at('MHRise', 100),
        // Snaps sooner AND stays angry longer, so it is unambiguously hotter-tempered.
        // (Give it only one of the two and Temper's mean lands at the midpoint for both.)
        enrage_trigger: at('MHRise', 500), enrage_duration: at('MHRise', 180),
      }],
      ['b', {
        base_hp: at('MHRise', 9000), size_base: at('MHRise', 4000),
        enrage_attack_mult: at('MHRise', 1.4), enrage_speed_mult: at('MHRise', 1.3),
        hitzone_mean_raw: at('MHRise', 25),
        tolerance_poison: at('MHRise', 300), tolerance_paralysis: at('MHRise', 300),
        tolerance_sleep: at('MHRise', 300), tolerance_stun: at('MHRise', 300),
        enrage_trigger: at('MHRise', 2000), enrage_duration: at('MHRise', 60),
      }],
    ]);
    const stats = computeStats(resolved);
    for (const s of stats.values()) {
      // No 'spd': Speed has no source input at all. No 'atk': these fixtures carry the
      // enrage multiplier, which is deliberately no longer an Attack input.
      expect(Object.keys(s).sort()).toEqual(['def', 'hp', 'siz', 'tmp', 'wil']);
      for (const v of Object.values(s)) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(STAT_MAX);
      }
    }
    expect(stats.get('b').hp).toBeGreaterThan(stats.get('a').hp);
    expect(stats.get('b').def).toBeGreaterThan(stats.get('a').def); // a lower MEAN hitzone is a tougher monster
    expect(stats.get('a').tmp).toBeGreaterThan(stats.get('b').tmp); // snaps sooner
  });

  it('omits a stat whose inputs are all missing', () => {
    const stats = computeStats(new Map([['a', { base_hp: at('MHGU', 3000) }]]));
    expect(stats.get('a').hp).toBeDefined();
    expect(stats.get('a').atk).toBeUndefined();
    expect(stats.get('a').spd).toBeUndefined();
  });
});
