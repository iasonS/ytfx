import { describe, it, expect } from 'vitest';
import { resolveInputs, baseSpeciesOf, applyInheritance } from '../tools/mhstats/merge.js';

const R = [
  { id: 'rathalos', name: 'Rathalos', latest: 'MHWilds', games: ['MH1', 'MHWorld', 'MHWilds'] },
  { id: 'azure-rathalos', name: 'Azure Rathalos', latest: 'MHWorld', games: ['MHWorld'] },
  { id: 'great-jagras', name: 'Great Jagras', latest: 'MHWorld', games: ['MHWorld'] },
  { id: 'ashen-lao-shan-lung', name: 'Ashen Lao-Shan Lung', latest: 'MHFU', games: ['MHFU'] },
  { id: 'lao-shan-lung', name: 'Lao-Shan Lung', latest: 'MHGU', games: ['MHGU'] },
];
const o = (monster, game, input, value) => ({ monster, game, input, value, unit: 'x', source: 's' });

describe('mhstats merge', () => {
  it('takes the newest game that records each input, per input', () => {
    const r = resolveInputs([
      o('rathalos', 'MHWorld', 'base_hp', 3250),
      o('rathalos', 'MHWilds', 'base_hp', 4500),
      o('rathalos', 'MHWorld', 'move_power_max', 80),
    ], R);
    expect(r.get('rathalos').base_hp).toMatchObject({ value: 4500, game: 'MHWilds' });
    // Wilds has no move table, so the tie-break falls back to the newest game that does.
    expect(r.get('rathalos').move_power_max).toMatchObject({ value: 80, game: 'MHWorld' });
  });

  it('ignores observations for monsters outside the roster', () => {
    const r = resolveInputs([o('kestodon', 'MHWorld', 'base_hp', 1)], R);
    expect(r.has('kestodon')).toBe(false);
  });

  it('finds the base species by longest trailing name match', () => {
    expect(baseSpeciesOf('azure-rathalos', R)).toBe('rathalos');
    expect(baseSpeciesOf('ashen-lao-shan-lung', R)).toBe('lao-shan-lung');
    expect(baseSpeciesOf('rathalos', R)).toBeNull();
    expect(baseSpeciesOf('great-jagras', R)).toBeNull();
  });

  it('inherits a missing input from the base species, keeping the base game', () => {
    const resolved = resolveInputs([
      o('rathalos', 'MHWilds', 'enrage_trigger', 1500),
      o('azure-rathalos', 'MHWorld', 'base_hp', 4000),
    ], R);
    const { resolved: out, inherited } = applyInheritance(resolved, R);
    expect(out.get('azure-rathalos').enrage_trigger).toMatchObject({ value: 1500, game: 'MHWilds', from: 'rathalos' });
    expect(out.get('azure-rathalos').base_hp.value).toBe(4000); // its own value is not overwritten
    expect(inherited).toContainEqual({ id: 'azure-rathalos', input: 'enrage_trigger', from: 'rathalos' });
  });

  it('does not chain inheritance through a variant', () => {
    const resolved = resolveInputs([o('rathalos', 'MHWilds', 'base_hp', 4500)], R);
    const { resolved: out } = applyInheritance(resolved, R);
    expect(out.get('azure-rathalos')?.base_hp).toMatchObject({ from: 'rathalos' });
    expect(out.get('ashen-lao-shan-lung')?.base_hp).toBeUndefined();
  });
});
