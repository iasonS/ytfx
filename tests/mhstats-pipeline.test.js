import { describe, it, expect } from 'vitest';
import { RAW_INPUTS, obsRow, writeObservations, readObservations } from '../tools/mhstats/lib/observations.js';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('mhstats observations', () => {
  it('names every raw input the stats need', () => {
    expect(RAW_INPUTS).toEqual([
      'base_hp', 'size_base', 'size_gold',
      'enrage_attack_mult', 'enrage_speed_mult', 'enrage_trigger', 'enrage_duration',
      'hitzone_max_raw', 'head_stagger',
      'tolerance_poison', 'tolerance_paralysis', 'tolerance_sleep', 'tolerance_stun',
      'move_power_max',
    ]);
  });

  it('rejects an unknown input or a missing source', () => {
    expect(() => obsRow({ monster: 'rathalos', game: 'MHWilds', input: 'vibes', value: 1, unit: 'x', source: 'u' }))
      .toThrow(/unknown input/);
    expect(() => obsRow({ monster: 'rathalos', game: 'MHWilds', input: 'base_hp', value: 1, unit: 'hp', source: '' }))
      .toThrow(/source/);
  });

  it('round-trips rows through CSV, escaping commas and quotes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mhstats-'));
    const file = join(dir, 'observations.csv');
    const rows = [
      obsRow({ monster: 'rathalos', game: 'MHWilds', input: 'base_hp', value: 4500, unit: 'hp', source: 'https://wilds.mhdb.io/en/monsters' }),
      obsRow({ monster: 'plum-daimyo-hermitaur', game: 'MH4U', input: 'size_gold', value: 1234.5, unit: 'cm', source: 'https://kiranico.com/a,b "c"' }),
    ];
    writeObservations(rows, file);
    const back = readObservations(file);
    expect(back).toHaveLength(2);
    // Rows come back in sorted order, so look them up rather than indexing.
    const rathalos = back.find(r => r.monster === 'rathalos');
    const hermitaur = back.find(r => r.monster === 'plum-daimyo-hermitaur');
    expect(rathalos.value).toBe(4500);
    expect(rathalos.input).toBe('base_hp');
    expect(hermitaur.source).toBe('https://kiranico.com/a,b "c"');
    expect(hermitaur.value).toBeCloseTo(1234.5);
  });

  it('sorts rows so the committed file has a stable diff', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mhstats-'));
    const file = join(dir, 'observations.csv');
    const mk = (m, i) => obsRow({ monster: m, game: 'MHRise', input: i, value: 1, unit: 'x', source: 's' });
    writeObservations([mk('zinogre', 'base_hp'), mk('arzuros', 'size_base'), mk('arzuros', 'base_hp')], file);
    const back = readObservations(file);
    expect(back.map(r => `${r.monster}/${r.input}`))
      .toEqual(['arzuros/base_hp', 'arzuros/size_base', 'zinogre/base_hp']);
  });
});
