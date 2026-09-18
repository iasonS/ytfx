import { describe, it, expect } from 'vitest';
import { applyCuration, findGaps, writeReport } from '../tools/mhstats/curate.js';

const roster = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];

describe('mhstats curate', () => {
  it('reports every monster-stat pair that no source filled', () => {
    const stats = new Map([['a', { hp: 100, atk: 50, def: 1, spd: 1, wil: 1, siz: 1, tmp: 1 }], ['b', { hp: 100 }]]);
    const gaps = findGaps(stats, roster);
    expect(gaps).toContainEqual({ id: 'b', stat: 'atk' });
    expect(gaps).not.toContainEqual({ id: 'a', stat: 'atk' });
    expect(gaps).toHaveLength(6);
  });

  it('fills a gap from the overlay', () => {
    const stats = new Map([['b', { hp: 100 }]]);
    const { stats: out, applied } = applyCuration(stats, [
      { id: 'b', stat: 'atk', value: 150, reason: 'GU records no enrage data; sits between its Rise and 4U appearances' },
    ], roster);
    expect(out.get('b').atk).toBe(150);
    expect(applied).toBe(1);
  });

  it('rejects an unknown monster, an unknown stat, an out-of-range value or a missing reason', () => {
    const stats = new Map([['b', { hp: 100 }]]);
    const bad = [
      [{ id: 'ghost', stat: 'atk', value: 1, reason: 'x' }, /unknown monster/],
      [{ id: 'b', stat: 'charisma', value: 1, reason: 'x' }, /unknown stat/],
      [{ id: 'b', stat: 'atk', value: 0, reason: 'x' }, /range/],
      [{ id: 'b', stat: 'atk', value: 301, reason: 'x' }, /range/],
      [{ id: 'b', stat: 'atk', value: 150 }, /reason/],
    ];
    for (const [entry, msg] of bad) expect(() => applyCuration(stats, [entry], roster)).toThrow(msg);
  });

  it('refuses to overwrite a value a source already supplied', () => {
    const stats = new Map([['a', { hp: 100 }]]);
    expect(() => applyCuration(stats, [{ id: 'a', stat: 'hp', value: 200, reason: 'x' }], roster))
      .toThrow(/already has/);
  });

  it('writes a report listing every non-source value in one place', () => {
    const md = writeReport({
      inherited: [{ id: 'azure-rathalos', input: 'enrage_trigger', from: 'rathalos' }],
      refinements: [{ id: 'a', stat: 'atk', rank: 1, reason: 'hits hardest' }],
      curation: [{ id: 'b', stat: 'atk', value: 150, reason: 'no GU enrage data' }],
      gaps: [],
    });
    expect(md).toContain('azure-rathalos');
    expect(md).toContain('hits hardest');
    expect(md).toContain('no GU enrage data');
  });

  it('flags remaining gaps in the report', () => {
    const md = writeReport({ inherited: [], refinements: [], curation: [], gaps: [{ id: 'b', stat: 'atk' }] });
    expect(md).toMatch(/Still missing/);
    expect(md).toContain('b');
  });
});
