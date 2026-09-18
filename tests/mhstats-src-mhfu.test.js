import { describe, it, expect } from 'vitest';
import { deriveMhfu, extract } from '../tools/mhstats/sources/mhfu.js';

describe('mhstats mhfu extractor', () => {
  it('derives Copper Blangonga from the verified card fixture', () => {
    const files = {
      stats: [{
        monster: 'Copper Blangonga',
        'attack-enraged': 1.4,
        appear: [
          { health: 6460 }, { health: 6460 }, { health: 3230 }, { health: 3910 },
          { health: 3740 }, { health: 3740 }, { health: 3740 }, { health: 3740 }, { health: 3740 },
        ],
      }],
      weapon: [{
        monster: 'Copper Blangonga',
        parts: [
          { part: 'head', slash: 65, strike: 70, shooting: 70 },
          { part: 'body', slash: 30, strike: 30, shooting: 30 },
          { part: 'forelegs', slash: 45, strike: 40, shooting: 40 },
          { part: 'hindlegs', slash: 20, strike: 20, shooting: 20 },
          { part: 'tail', slash: 50, strike: 40, shooting: 30 },
        ],
      }],
      status: [{
        monster: 'Copper Blangonga',
        types: [
          { type: 'poison', 'initial-tolerance': 200 },
          { type: 'paralyze', 'initial-tolerance': 150 },
          { type: 'sleep', 'initial-tolerance': 150 },
          { type: 'knockout', 'initial-tolerance': 100 },
        ],
      }],
      duration: [{
        monster: 'Copper Blangonga',
        parts: [{ part: 'head', duration: 350 }, { part: 'body', duration: 160 }],
      }],
      size: [{ monster: 'Copper Blangonga', default: 860, 'golden-largest-min': 1186.8 }],
    };

    const d = deriveMhfu('Copper Blangonga', files);
    expect(d.base_hp.value).toBe(3230);
    expect(d.size_base.value).toBe(860);
    expect(d.size_gold.value).toBe(1186.8);
    expect(d.enrage_attack_mult.value).toBe(1.4);
    expect(d.head_stagger.value).toBe(350);
    expect(d.tolerance_poison.value).toBe(200);
    expect(d.tolerance_paralysis.value).toBe(150);
    expect(d.tolerance_sleep.value).toBe(150);
    expect(d.tolerance_stun.value).toBe(100);
  });

  it('omits rows for a monster absent from size.json and status-effectiveness.json, without throwing', () => {
    const files = {
      stats: [{
        monster: 'Ashen Lao-Shan Lung',
        'attack-enraged': 1.5,
        appear: [{ health: 26666 }, { health: 26666 }, { health: 26666 }, { health: 26666 }],
      }],
      weapon: [{
        monster: 'Ashen Lao-Shan Lung',
        parts: [
          { part: 'head', slash: 28, strike: 20, shooting: 30 },
          { part: 'stomach', slash: 55, strike: 50, shooting: 40 },
          { part: 'internal', slash: 80, strike: 90, shooting: 80 },
        ],
      }],
      status: [],
      duration: [{ monster: 'Ashen Lao-Shan Lung', parts: [{ part: 'head', duration: 400 }] }],
      size: [],
    };

    expect(() => deriveMhfu('Ashen Lao-Shan Lung', files)).not.toThrow();
    const d = deriveMhfu('Ashen Lao-Shan Lung', files);
    expect(d.size_base).toBeUndefined();
    expect(d.size_gold).toBeUndefined();
    expect(d.tolerance_poison).toBeUndefined();
    expect(d.tolerance_paralysis).toBeUndefined();
    expect(d.tolerance_sleep).toBeUndefined();
    expect(d.tolerance_stun).toBeUndefined();
    expect(d.base_hp.value).toBe(26666);
    expect(d.head_stagger.value).toBe(400);
  });

  it('excludes the internal part by name, not by a hyphen check, from hitzone_max_raw', () => {
    const files = {
      stats: [{ monster: 'Ashen Lao-Shan Lung', 'attack-enraged': 1.5, appear: [{ health: 1 }] }],
      weapon: [{
        monster: 'Ashen Lao-Shan Lung',
        parts: [
          { part: 'stomach', slash: 55, strike: 50, shooting: 40 },
          { part: 'internal', slash: 80, strike: 90, shooting: 80 },
        ],
      }],
      status: [],
      duration: [],
      size: [],
    };

    const d = deriveMhfu('Ashen Lao-Shan Lung', files);
    // Real external max is 55 (stomach slash); a hyphen-only filter would leave
    // 'internal' (no hyphen) in and wrongly return 90.
    expect(d.hitzone_max_raw.value).toBe(55);
  });

  it('resolves the Terra S.Ceanataur and Plum D.Hermitaur aliases', () => {
    const files = {
      stats: [
        { monster: 'Terra S.Ceanataur', 'attack-enraged': 1.4, appear: [{ health: 4070 }] },
        { monster: 'Plum D.Hermitaur', 'attack-enraged': 1.3, appear: [{ health: 2000 }] },
      ],
      weapon: [],
      status: [],
      duration: [],
      size: [],
    };

    expect(deriveMhfu('Terra Shogun Ceanataur', files).base_hp.value).toBe(4070);
    expect(deriveMhfu('Plum Daimyo Hermitaur', files).base_hp.value).toBe(2000);
  });

  it('throws listing an unmatched roster monster, never skipping silently', async () => {
    const roster = [{ id: 'not-real', name: 'Not Real Monster', source: 'FU' }];
    await expect(extract(roster)).rejects.toThrow(/Not Real Monster/);
  });
});
