import { describe, it, expect } from 'vitest';
import { deriveMh4u } from '../tools/mhstats/sources/mh4u.js';

// Fixtures below are trimmed shapes of the real window.js_vars blob Kiranico MH4U
// embeds per monster page: { monster: {...} }. Numbers taken from the verified
// research card (docs/superpowers/research/2026-09-18-source-locators.md, ######## 4U),
// held-out monster Berserk Tetsucabra.

const berserkTetsucabra = {
  monster: {
    base_hp: 4200,
    crown_king: '1556.9',
    crown_large: '1481.0',
    crown_miniature: '1227.8',
    rage_mod_attack: '1.3',
    rage_mod_defense: '1.0',
    rage_mod_speed: '1.2',
    rage_duration: 90,
    monsterbodyparts: [
      { local_name: 'Head', pivot: { type: 'A', res_cut: 52, res_impact: 52, res_shot: 55 } },
      { local_name: 'Tusk', pivot: { type: 'A', res_cut: 40, res_impact: 45, res_shot: 35 } },
      { local_name: 'Torso', pivot: { type: 'A', res_cut: 25, res_impact: 25, res_shot: 25 } },
      { local_name: 'Front Legs', pivot: { type: 'A', res_cut: 38, res_impact: 35, res_shot: 37 } },
      { local_name: 'Back Leg', pivot: { type: 'A', res_cut: 37, res_impact: 34, res_shot: 37 } },
      { local_name: 'Tail', pivot: { type: 'A', res_cut: 30, res_impact: 30, res_shot: 30 } },
      { local_name: 'Tail (Inflated)', pivot: { type: 'A', res_cut: 73, res_impact: 73, res_shot: 78 } },
    ],
    monsterstaggerlimits: [
      { region: 'Head', value: 325 },
      { region: 'Torso', value: 250 },
      { region: '', value: 30 },
    ],
    weaponspecialattacks: [
      { local_name: 'Poison', pivot: { initial: 100 } },
      { local_name: 'Sleep', pivot: { initial: 150 } },
      { local_name: 'Para', pivot: { initial: 200 } },
      { local_name: 'KO', pivot: { initial: 200 } },
    ],
  },
};

describe('deriveMh4u', () => {
  it("reads Berserk Tetsucabra's verified figures", () => {
    const f = deriveMh4u(berserkTetsucabra);
    expect(f.base_hp).toMatchObject({ value: 4200 });
    expect(f.enrage_attack_mult).toMatchObject({ value: 1.3 });
    expect(f.enrage_speed_mult).toMatchObject({ value: 1.2 });
    expect(f.enrage_duration).toMatchObject({ value: 90 });
    expect(f.head_stagger).toMatchObject({ value: 325 });
    expect(f.tolerance_poison).toMatchObject({ value: 100 });
    expect(f.tolerance_paralysis).toMatchObject({ value: 200 });
    expect(f.tolerance_sleep).toMatchObject({ value: 150 });
    expect(f.tolerance_stun).toMatchObject({ value: 200 });
  });

  it('excludes the parenthetical Tail (Inflated) part from hitzone_max_raw, even though it is type A and higher', () => {
    const f = deriveMh4u(berserkTetsucabra);
    // Head is 52/52/55 (max 55); Tail (Inflated) is 73/73/78 but must be excluded.
    expect(f.hitzone_max_raw).toMatchObject({ value: 55 });
  });

  it('never emits enrage_trigger or move_power_max: 4U has neither in any source', () => {
    const f = deriveMh4u(berserkTetsucabra);
    expect(f.enrage_trigger).toBeUndefined();
    expect(f.move_power_max).toBeUndefined();
  });

  it("emits no size rows when crown_king is '0.0' (missing, not zero)", () => {
    const f = deriveMh4u({
      monster: {
        base_hp: 5000,
        crown_king: '0.0',
        crown_large: '0.0',
        crown_miniature: '0.0',
        rage_mod_attack: '0.0',
        rage_mod_speed: '0.0',
        rage_duration: 0,
      },
    });
    expect(f.size_base).toBeUndefined();
    expect(f.size_gold).toBeUndefined();
    // Zeroed rage fields (the Apex/siege stub shape) must not emit enrage rows either.
    expect(f.enrage_attack_mult).toBeUndefined();
    expect(f.enrage_speed_mult).toBeUndefined();
    expect(f.enrage_duration).toBeUndefined();
    // base_hp is real even for these stubs and must still come through.
    expect(f.base_hp).toMatchObject({ value: 5000 });
  });

  it('resolves disagreeing crowns through the mini-crown rule, not the gold-crown one', () => {
    // king/1.23 = 200, large/1.15 = 100, mini/0.90 = 100 -- king disagrees by far more than 0.5cm.
    const f = deriveMh4u({
      monster: { crown_king: '246', crown_large: '115', crown_miniature: '90' },
    });
    expect(f.size_base.value).toBeCloseTo(100, 1);
    expect(f.size_base.value).not.toBeCloseTo(200, 1);
    // size_gold is always the gold crown itself, regardless of the base-size formula.
    expect(f.size_gold).toMatchObject({ value: 246 });
  });

  it('uses the agreed candidate when all three crowns agree within 0.5 cm', () => {
    // king/1.23 = 100, large/1.15 = 100, mini/0.90 = 100 -- all agree.
    const f = deriveMh4u({
      monster: { crown_king: '123', crown_large: '115', crown_miniature: '90' },
    });
    expect(f.size_base.value).toBeCloseTo(100, 1);
  });

  it('does not become a real hitzone_max_raw or head_stagger value when monsterbodyparts/stagger are absent (Apex-style stub)', () => {
    const f = deriveMh4u({ monster: { base_hp: 3000, monsterbodyparts: [], monsterstaggerlimits: [] } });
    expect(f.hitzone_max_raw).toBeUndefined();
    expect(f.head_stagger).toBeUndefined();
  });

  it('treats a status tolerance of 0 as immune, emitting no row', () => {
    const f = deriveMh4u({
      monster: {
        weaponspecialattacks: [
          { local_name: 'Poison', pivot: { initial: 0 } },
          { local_name: 'Para', pivot: { initial: 0 } },
        ],
      },
    });
    expect(f.tolerance_poison).toBeUndefined();
    expect(f.tolerance_paralysis).toBeUndefined();
  });

  it('takes the first Head row when stagger has duplicates (e.g. Red Khezu)', () => {
    const f = deriveMh4u({
      monster: {
        monsterstaggerlimits: [
          { region: 'Head', value: 260 },
          { region: 'Head', value: 200 },
        ],
      },
    });
    expect(f.head_stagger).toMatchObject({ value: 260 });
  });
});
