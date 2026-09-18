import { describe, it, expect } from 'vitest';
import { STORAGE_KEY, MAX_RUNS, loadRuns, saveRun, topRuns } from '../public/mhstats/storage.js';

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return {
    getItem: k => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    dump: () => data,
  };
}

const rec = (score, at = '2026-09-18T10:00:00Z') => ({
  seed: 1, monsters: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  picks: ['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp'], score, best: 1500, worst: 300, at,
});

describe('mhstats storage', () => {
  it('uses the spec key and cap', () => {
    expect(STORAGE_KEY).toBe('mhstats.runs.v1');
    expect(MAX_RUNS).toBe(50);
  });

  it('loads [] from empty, null or corrupt storage', () => {
    expect(loadRuns(memoryStorage())).toEqual([]);
    expect(loadRuns(null)).toEqual([]);
    expect(loadRuns(memoryStorage({ [STORAGE_KEY]: '{not json' }))).toEqual([]);
    expect(loadRuns(memoryStorage({ [STORAGE_KEY]: '{"a":1}' }))).toEqual([]);
    expect(loadRuns({ getItem() { throw new Error('blocked'); }, setItem() {} })).toEqual([]);
  });

  it('saves newest first and persists', () => {
    const s = memoryStorage();
    saveRun(s, rec(100, '2026-09-18T10:00:00Z'));
    const runs = saveRun(s, rec(200, '2026-09-18T11:00:00Z'));
    expect(runs.map(r => r.score)).toEqual([200, 100]);
    expect(JSON.parse(s.dump()[STORAGE_KEY]).map(r => r.score)).toEqual([200, 100]);
  });

  it('caps at MAX_RUNS', () => {
    const s = memoryStorage();
    let runs;
    for (let i = 0; i < MAX_RUNS + 5; i++) runs = saveRun(s, rec(i));
    expect(runs).toHaveLength(MAX_RUNS);
    expect(runs[0].score).toBe(MAX_RUNS + 4);
  });

  it('returns the in-memory list even when setItem throws', () => {
    const s = { getItem: () => null, setItem() { throw new Error('quota'); } };
    expect(saveRun(s, rec(5))).toEqual([rec(5)]);
    expect(saveRun(null, rec(6))).toEqual([rec(6)]);
  });

  it('topRuns sorts by score desc then newest, and limits', () => {
    const runs = [rec(300, '2026-09-18T10:00:00Z'), rec(500, '2026-09-18T09:00:00Z'),
      rec(500, '2026-09-18T12:00:00Z'), rec(100)];
    const top = topRuns(runs, 3);
    expect(top.map(r => [r.score, r.at])).toEqual([
      [500, '2026-09-18T12:00:00Z'], [500, '2026-09-18T09:00:00Z'], [300, '2026-09-18T10:00:00Z']]);
    expect(runs[0].score).toBe(300); // input not mutated
  });
});
