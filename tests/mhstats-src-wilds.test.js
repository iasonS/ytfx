import { describe, it, expect } from 'vitest';
import { deriveWilds } from '../tools/mhstats/sources/wilds.js';

// Fixtures below are the card's verified Rathalos example
// (docs/superpowers/research/2026-09-18-source-locators.md, "######## Wilds" section).
const rathalosMhdb = {
  id: 29,
  gameId: 1965232896,
  name: 'Rathalos',
  baseHealth: 4500,
  size: { base: 1704.22, gold: 2096.1907, mini: 1533.798, silver: 1959.8529 },
};

const rathalosRobo = {
  Name: 'Rathalos',
  BHP: 4500,
  AngryTable: [
    {
      Lower: { MonDamage: 1.26, Speed: 1.05, Limit: 750, Time: 80 },
      Upper: { MonDamage: 1.26, Speed: 1.1, Limit: 1500, Time: 100 },
    },
  ],
  Hitzones: {
    Rows: [
      { Part: 'Head', State: '', Meat: { Slash: 65, Blow: 70, Shot: 60, Stun: 100 }, Flinch: [500] },
    ],
  },
  ConditionTable: {
    Rows: [
      { Stats: '' },
      { Stats: 'Duration' },
      { Stats: 'Initial Tolerance', Poison: 250, Paralyze: 180, Sleep: 150, Stun: 120 },
    ],
  },
};

function byInput(rows) {
  return Object.fromEntries(rows.map(r => [r.input, r.value]));
}

describe('deriveWilds', () => {
  it('matches the verified Rathalos figures', () => {
    const rows = deriveWilds(rathalosMhdb, rathalosRobo);
    const v = byInput(rows);
    expect(v.base_hp).toBe(4500);
    expect(v.size_base).toBe(1704.22);
    expect(v.size_gold).toBeCloseTo(2096.1907);
    expect(v.enrage_attack_mult).toBe(1.26);
    expect(v.enrage_speed_mult).toBe(1.1);
    expect(v.enrage_trigger).toBe(1500);
    expect(v.enrage_duration).toBe(100);
    expect(v.head_stagger).toBe(500);
    expect(v.tolerance_poison).toBe(250);
    expect(v.tolerance_paralysis).toBe(180);
    expect(v.tolerance_sleep).toBe(150);
    expect(v.tolerance_stun).toBe(120);
  });

  it('yields hitzone_max_raw from the default-state rows only', () => {
    const robo = {
      ...rathalosRobo,
      Hitzones: {
        Rows: [
          { Part: 'Head', State: '', Meat: { Slash: 40, Blow: 45, Shot: 35 }, Flinch: [500] },
          { Part: 'Foreleg', State: 'Weak', Meat: { Slash: 90, Blow: 90, Shot: 90 } },
          { Part: 'HIDE', State: '', Meat: { Slash: 100, Blow: 100, Shot: 100 } },
        ],
      },
    };
    const rows = deriveWilds(rathalosMhdb, robo);
    const v = byInput(rows);
    expect(v.hitzone_max_raw).toBe(45);
  });

  it('never emits move_power_max', () => {
    const rows = deriveWilds(rathalosMhdb, rathalosRobo);
    expect(rows.some(r => r.input === 'move_power_max')).toBe(false);
  });

  it('emits no enrage rows and does not throw when AngryTable is null', () => {
    const robo = { ...rathalosRobo, AngryTable: null };
    let rows;
    expect(() => { rows = deriveWilds(rathalosMhdb, robo); }).not.toThrow();
    const v = byInput(rows);
    expect(v.enrage_attack_mult).toBeUndefined();
    expect(v.enrage_speed_mult).toBeUndefined();
    expect(v.enrage_trigger).toBeUndefined();
    expect(v.enrage_duration).toBeUndefined();
    // Non-enrage inputs are still derived.
    expect(v.base_hp).toBe(4500);
    expect(v.head_stagger).toBe(500);
  });
});
