import { describe, it, expect } from 'vitest';
import { deriveRise, decomposeEm } from '../tools/mhstats/sources/rise.js';

// Rathian fixture: verified figures from the card
// (docs/superpowers/research/2026-09-18-source-locators.md, "######## Rise" section)
// and cross-checked directly against the cached mhrice.json.
const rathian = {
  id: 1,
  subId: 0,
  em: 1,
  nameEn: 'Rathian',
  baseHpVital: 4500,
  sizeBase: 1754.37,
  kingBoarder: 1.23,
  anger: {
    atkRate: 1.2,
    motRate: 1.08,
    timer: 80,
    dataInfo: [800, 1150, 650, 1600], // Low, High, Rampage, Master
  },
  meatGroups: [
    { slash: 70, strike: 75, shell: 65 },
    { slash: 40, strike: 45, shell: 35 },
    { slash: 0, strike: 0, shell: 0 }, // padding
  ],
  partMap: { 0: ['頭部'], 1: ['胴'] },
  enemyPartsData: [
    { vital: 290, masterVital: -1 },
    { vital: 360, masterVital: -1 },
  ],
  tolerances: {
    // preset_type 4 < length 7: own raw (180) is ignored, preset[4] (250) is the real value.
    poison: { ownLimit: 180, presetType: 4, presetLength: 7, presetLimit: 250 },
    paralysis: { ownLimit: 180, presetType: 0, presetLength: 6, presetLimit: 180 },
    sleep: { ownLimit: 180, presetType: 0, presetLength: 4, presetLimit: 150 },
    // preset_type 6 == length 6: own raw (110) is the real value.
    stun: { ownLimit: 110, presetType: 6, presetLength: 6, presetLimit: undefined },
  },
  atkColliders: [
    { baseDamage: 80, power: 90 },
    { baseDamage: 35, power: 30 },
  ],
};

describe('deriveRise', () => {
  it("matches Rathian's verified figures", () => {
    const v = deriveRise(rathian);
    expect(v.base_hp).toBe(4500);
    expect(v.size_base).toBe(1754.37);
    expect(v.enrage_attack_mult).toBe(1.2);
    expect(v.enrage_speed_mult).toBe(1.08);
    expect(v.enrage_duration).toBe(80);
    expect(v.head_stagger).toBe(290);
    expect(v.tolerance_stun).toBe(110);
  });

  it('resolves size_gold as base_size * king_boarder', () => {
    const v = deriveRise(rathian);
    expect(v.size_gold).toBeCloseTo(1754.37 * 1.23);
  });

  it('resolves enrage_trigger from the High Rank entry (index 1)', () => {
    const v = deriveRise(rathian);
    expect(v.enrage_trigger).toBe(1150);
  });

  it('resolves hitzone_max_raw as the global max over all parts, skipping zero padding', () => {
    const v = deriveRise(rathian);
    expect(v.hitzone_max_raw).toBe(75);
  });

  it("resolves a preset_type below the preset list's length through the preset, not the monster's own value", () => {
    const entry = { tolerances: { poison: { ownLimit: 180, presetType: 0, presetLength: 7, presetLimit: 150 } } };
    const v = deriveRise(entry);
    expect(v.tolerance_poison).toBe(150);
  });

  it("resolves a preset_type equal to the preset list's length through the monster's own value", () => {
    const entry = { tolerances: { poison: { ownLimit: 222, presetType: 7, presetLength: 7, presetLimit: undefined } } };
    const v = deriveRise(entry);
    expect(v.tolerance_poison).toBe(222);
  });

  it('prefers base_damage over power for move_power_max when they disagree', () => {
    const entry = { atkColliders: [{ baseDamage: 70, power: 100 }, { baseDamage: 80, power: 10 }] };
    const v = deriveRise(entry);
    expect(v.move_power_max).toBe(80);
  });

  it('finds the head via the lowest matching, non-excluded partMap index (head not at index 0)', () => {
    // Volvidon-shaped fixture: index 0 is the back, index 1 the head (mixed
    // Japanese labels, one of which matches the head regex).
    const entry = {
      partMap: { 0: ['背中'], 1: ['ダメージアタリ　頭', '頭'] },
      enemyPartsData: [{ vital: 200, masterVital: -1 }, { vital: 180, masterVital: -1 }],
    };
    const v = deriveRise(entry);
    expect(v.head_stagger).toBe(180);
  });

  it('excludes a mud/first-form head look-alike even when it sits at a lower index', () => {
    const entry = {
      partMap: { 0: ['頭部_泥'], 1: ['頭部'] },
      enemyPartsData: [{ vital: 999, masterVital: -1 }, { vital: 250, masterVital: -1 }],
    };
    const v = deriveRise(entry);
    expect(v.head_stagger).toBe(250);
  });

  it('emits no rows for genuinely absent fields and never throws', () => {
    expect(() => deriveRise({})).not.toThrow();
    const v = deriveRise({});
    expect(v).toEqual({});
  });
});

describe('decomposeEm', () => {
  it('decomposes a sub-id monster (Risen Teostra: id 27, sub_id 8)', () => {
    expect(decomposeEm(2075)).toEqual({ id: 27, subId: 8 });
  });

  it('decomposes a plain monster (Rathian: id 1, sub_id 0)', () => {
    expect(decomposeEm(1)).toEqual({ id: 1, subId: 0 });
  });
});
