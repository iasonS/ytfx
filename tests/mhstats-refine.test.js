import { describe, it, expect } from 'vitest';
import { tieGroups, bandBounds, applyRefinement } from '../tools/mhstats/refine.js';

const S = new Map([
  ['a', { atk: 100 }], ['b', { atk: 100 }], ['c', { atk: 100 }],
  ['d', { atk: 200 }], ['e', { atk: 50 }],
]);
const full = [
  { id: 'b', stat: 'atk', rank: 1, reason: 'hits hardest of the three' },
  { id: 'a', stat: 'atk', rank: 2, reason: 'middling' },
  { id: 'c', stat: 'atk', rank: 3, reason: 'weakest of the three' },
];

describe('mhstats refine', () => {
  it('finds groups of monsters the sources tied, with their neighbouring anchors', () => {
    const groups = tieGroups(S, 'atk');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ anchor: 100, prev: 50, next: 200 });
    expect(groups[0].ids.slice().sort()).toEqual(['a', 'b', 'c']);
  });

  it('bounds a band at 40 percent of the gap to each neighbour', () => {
    expect(bandBounds(100, 50, 200)).toEqual({ lo: 80, hi: 140 });
  });

  it('uses the scale end where a band has no neighbour on one side', () => {
    expect(bandBounds(50, null, 100).lo).toBe(1);
    expect(bandBounds(200, 100, null).hi).toBe(300);
  });

  it('spreads a ranked group across its band in rank order', () => {
    const { stats } = applyRefinement(S, full);
    expect(stats.get('b').atk).toBeGreaterThan(stats.get('a').atk);
    expect(stats.get('a').atk).toBeGreaterThan(stats.get('c').atk);
    for (const id of ['a', 'b', 'c']) {
      expect(stats.get(id).atk).toBeGreaterThanOrEqual(80);
      expect(stats.get(id).atk).toBeLessThanOrEqual(140);
    }
  });

  it('never lets a refined monster reach a neighbouring anchor', () => {
    const { stats } = applyRefinement(S, full);
    for (const id of ['a', 'b', 'c']) {
      expect(stats.get(id).atk).toBeLessThan(200);
      expect(stats.get(id).atk).toBeGreaterThan(50);
    }
  });

  it('refuses to refine a monster the sources did not tie', () => {
    expect(() => applyRefinement(S, [{ id: 'd', stat: 'atk', rank: 1, reason: 'x' }]))
      .toThrow(/not in a tie group/);
  });

  it('refuses a partial or a duplicate ranking', () => {
    expect(() => applyRefinement(S, [{ id: 'a', stat: 'atk', rank: 1, reason: 'x' }]))
      .toThrow(/incomplete/i);
    expect(() => applyRefinement(S, [
      { id: 'a', stat: 'atk', rank: 1, reason: 'x' }, { id: 'b', stat: 'atk', rank: 1, reason: 'x' },
      { id: 'c', stat: 'atk', rank: 3, reason: 'x' },
    ])).toThrow(/rank/);
  });

  it('requires a reason on every entry', () => {
    expect(() => applyRefinement(S, [
      { id: 'a', stat: 'atk', rank: 1 }, { id: 'b', stat: 'atk', rank: 2, reason: 'x' },
      { id: 'c', stat: 'atk', rank: 3, reason: 'x' },
    ])).toThrow(/reason/);
  });

  it('leaves everything untouched when the refinement file is empty', () => {
    const { stats, applied } = applyRefinement(S, []);
    expect(applied).toBe(0);
    expect(stats.get('a').atk).toBe(100);
  });

  it('does not mutate the input stats', () => {
    applyRefinement(S, full);
    expect(S.get('a').atk).toBe(100);
  });
});
