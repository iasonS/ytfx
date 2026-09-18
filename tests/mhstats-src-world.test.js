import { describe, it, expect } from 'vitest';
import { parseKiranico, parsePoedb } from '../tools/mhstats/sources/world.js';

// Fixtures below are trimmed excerpts of real Kiranico World / poedb MHW markup
// (verified against the live pages on 2026-09-18), kept to just the tables each
// test needs. Values are the real, verified figures from the research card.

const KIRANICO_RATHALOS = `
<div class="align-self-center">Rathalos</div>
<div class="balance-table">
  <table class="table table-v-compact mb-0">
    <tbody>
    <tr>
      <td><strong></strong></td>
      <td>
        <strong>3250</strong>
        <div class="balance-label smaller lighter text-nowrap">Health</div>
      </td>
      <td></td>
    </tr>
    <tr>
      <td><img src="crown_mini.png" width="16"><strong>&le;1,533.80cm</strong></td>
      <td><img src="crown_large.png" width="16"><strong>&ge;1,959.85cm</strong></td>
      <td><img src="crown_king.png" width="16"><strong>&ge;2,096.19cm</strong></td>
    </tr>
    </tbody>
  </table>
</div>
<h6 class="element-header">Physiology</h6>
<div class="table-responsive"><table class="table table-lightborder table-sm">
  <thead><tr><th>Part</th><th class="text-center">Sever</th><th class="text-center">Blunt</th><th class="text-center">Ranged</th></tr></thead>
  <tbody>
  <tr><td class="nowrap">Head</td><td class="text-center">65</td><td class="text-center">70</td><td class="text-center">60</td></tr>
  <tr><td class="nowrap">Neck</td><td class="text-center">35</td><td class="text-center">40</td><td class="text-center">30</td></tr>
  </tbody>
</table></div>
<h6 class="element-header">Part Breakability</h6>
<div class="table-responsive"><table class="table table-lightborder table-sm">
  <thead><tr><th>Part</th><th class="text-center">Value</th><th class="text-center">Sever</th><th class="text-center">Extract Color</th></tr></thead>
  <tbody>
  <tr><td>Head</td><td class="text-center">240</td><td class="text-center"></td><td class="text-center">R</td></tr>
  <tr><td>Tail</td><td class="text-center">280</td><td class="text-center">320 Sever</td><td class="text-center">R</td></tr>
  </tbody>
</table></div>
<h6 class="element-header">Other</h6>
<div class="table-responsive"><table class="table table-sm">
  <thead><tr><th></th><th>Low Rank / High Rank</th><th>Master Rank</th></tr></thead>
  <tbody>
  <tr><td>Enrage Duration</td><td>100 seconds</td><td>60 seconds</td></tr>
  <tr><td>Enrage Attack</td><td>x1.10</td><td>x1.10</td></tr>
  <tr><td>Enrage Speed</td><td>x1.10</td><td>x1.05</td></tr>
  <tr><td>Enrage Trigger</td><td>650 Damage</td><td>300 Damage</td></tr>
  </tbody>
</table></div>
<h6 class="element-header">Ailments</h6>
<div class="table-responsive"><table class="table table-lightborder table-sm">
  <thead><tr><th>Ailments</th><th class="text-center">Buildup</th><th class="text-center">Decay</th></tr></thead>
  <tbody>
  <tr><td>Poison</td><td class="text-center"><abbr title="250→400→550→700">250 +150 → 700</abbr></td><td class="text-center">90</td></tr>
  <tr><td>Paralysis</td><td class="text-center"><abbr title="180→310→440→570">180 +130 → 570</abbr></td><td class="text-center">90</td></tr>
  <tr><td>Sleep</td><td class="text-center"><abbr title="150→250→400→550">150 +100 → 550</abbr></td><td class="text-center">120</td></tr>
  <tr><td>Stun</td><td class="text-center"><abbr title="150→270→450→630">150 +120 → 630</abbr></td><td class="text-center">90</td></tr>
  </tbody>
</table></div>
<h6 class="element-header">Monster Attacks</h6>
<div class="table-responsive"><table class="table table-sm">
  <thead><tr><th>Attack Move</th><th class="text-center">Power</th></tr></thead>
  <tbody>
  <tr><td>销先ブレス1</td><td class="text-center">40</td></tr>
  <tr><td>销先ブレス2</td><td class="text-center">80</td></tr>
  <tr><td>销先ブレス3</td><td class="text-center">55</td></tr>
  </tbody>
</table></div>
`;

const KIRANICO_NERGIGANTE_PHYSIOLOGY = `
<div class="align-self-center">Nergigante</div>
<h6 class="element-header">Physiology</h6>
<div class="table-responsive"><table class="table table-lightborder table-sm">
  <thead><tr><th>Part</th><th class="text-center">Sever</th><th class="text-center">Blunt</th><th class="text-center">Ranged</th></tr></thead>
  <tbody>
  <tr><td class="nowrap">Head</td><td class="text-center">45</td><td class="text-center">60</td><td class="text-center">40</td></tr>
  <tr><td class="nowrap"><img src="ib_icon.png" width="16">&nbsp;Head</td><td class="text-center">999</td><td class="text-center">999</td><td class="text-center">999</td></tr>
  <tr><td class="nowrap">Head (White)</td><td class="text-center">75</td><td class="text-center">90</td><td class="text-center">70</td></tr>
  </tbody>
</table></div>
`;

const KIRANICO_BLANK_POISON = `
<div class="align-self-center">Zorah Magdaros</div>
<h6 class="element-header">Ailments</h6>
<div class="table-responsive"><table class="table table-lightborder table-sm">
  <thead><tr><th>Ailments</th><th class="text-center">Buildup</th></tr></thead>
  <tbody>
  <tr><td>Poison</td><td class="text-center"></td></tr>
  </tbody>
</table></div>
`;

const POEDB_RATHALOS = `
<div class="card-times"></i><img alt='Rathalos' width='64'/></div>
<table><tr><th>Base HP</th><td>3,250</td></tr>
<tr><th>Size</th><td>Base: 1704.22<br> <img src='x'/>≤1533.8 (90%)<br> <img src='x'/>≥1959.85 (115%)<br> <img src='x'/>≥2096.19 (123%)<br> </td></tr>
</table>
<div class="card-times"></i>Enrage</div>
<table class='table table-striped table-bordered filters'>
<tr><th>Rank</th><td>Low Rank/High Rank</td><td>Master Rank</td></tr>
<tr><th>TriggerDamage</th><td>650</td><td>300</td></tr>
<tr><th>Duration</th><td>100</td><td>60</td></tr>
<tr><th>SpeedMultiplier</th><td>110%</td><td>105%</td></tr>
<tr><th>DamageMultiplier</th><td>110%</td><td>110%</td></tr>
</table>
<div class="card-times"></i>Status <small>/5</small></div>
<table class='table table-striped table-bordered filters'>
<thead><tr><th></th><th><img title='poison'/></th><th><img title='sleep'/></th><th><img title='paralysis'/></th><th><img title='blast'/></th><th><img title='stun'/></th></tr></thead>
<tbody><tr><td>Base</td><td>250</td><td>150</td><td>180</td><td>120</td><td>150</td></tr></tbody>
</table>
`;

// A trimmed, real excerpt of poedb's Acidic Glavenus page: it has a Size card
// and a Base HP card but genuinely has NO "Monster Damage" card at all (verified
// live on mhw.poedb.tw/eng/monster/67/Acidic%20Glavenus).
const POEDB_ACIDIC_GLAVENUS = `
<div class="card-times"></i><img alt='Acidic Glavenus' width='64'/></div>
<table><tr><th>Base HP</th><td>2,990</td></tr>
<tr><th>Size</th><td>Base: 2372.44<br> <img src='x'/>≤2135.2 (90%)<br> <img src='x'/>≥2609.68 (110%)<br> <img src='x'/>≥2846.93 (120%)<br> </td></tr>
</table>
<div class="card-times"></i>Enrage</div>
<table class='table table-striped table-bordered filters'>
<tr><th>Rank</th><td>Low Rank/High Rank</td><td>Master Rank</td></tr>
<tr><th>TriggerDamage</th><td>370</td><td>370</td></tr>
<tr><th>Duration</th><td>130</td><td>130</td></tr>
<tr><th>SpeedMultiplier</th><td>110%</td><td>110%</td></tr>
<tr><th>DamageMultiplier</th><td>100%</td><td>100%</td></tr>
</table>
<div class="card-times"></i>Status <small>/5</small></div>
<table class='table table-striped table-bordered filters'>
<thead><tr><th></th><th><img title='poison'/></th><th><img title='sleep'/></th><th><img title='paralysis'/></th><th><img title='blast'/></th><th><img title='stun'/></th></tr></thead>
<tbody><tr><td>Base</td><td>150</td><td>150</td><td>180</td><td>70</td><td>150</td></tr></tbody>
</table>
`;

describe('mhstats world: parseKiranico', () => {
  it('reads Rathalos figures off the Kiranico tables', () => {
    const d = parseKiranico(KIRANICO_RATHALOS);
    expect(d.name).toBe('Rathalos');
    expect(d.base_hp).toBe(3250);
    expect(d.size_gold).toBeCloseTo(2096.19);
    expect(d.enrage).toMatchObject({ attack_mult: 1.10, speed_mult: 1.10, trigger: 650, duration: 100 });
    expect(d.head_stagger).toBe(240);
    expect(d.tolerances).toMatchObject({ poison: 250, paralysis: 180, sleep: 150, stun: 150 });
    expect(d.move_power_max).toBe(80);
  });

  it('excludes Master Rank override rows but keeps state-variant rows in the hitzone max', () => {
    const d = parseKiranico(KIRANICO_NERGIGANTE_PHYSIOLOGY);
    // The MR row (999s, marked by ib_icon.png) must be excluded, or the max
    // would wrongly be 999. "Head (White)" is a state variant, not an MR row,
    // and IS counted toward hitzone_max_raw (documented in the emitted unit).
    expect(d.hitzone_max_raw).toBe(90);
  });

  it('emits no tolerance for a blank ailment cell (immune), never a zero', () => {
    const d = parseKiranico(KIRANICO_BLANK_POISON);
    expect(d.tolerances.poison).toBeNull();
  });

  it('does not throw on a page missing every table it looks for', () => {
    const d = parseKiranico('<div class="align-self-center">Nobody</div>');
    expect(d.name).toBe('Nobody');
    expect(d.base_hp).toBeNull();
    expect(d.hitzone_max_raw).toBeNull();
    expect(d.head_stagger).toBeNull();
    expect(d.move_power_max).toBeNull();
    expect(d.tolerances).toEqual({ poison: null, paralysis: null, sleep: null, stun: null });
  });
});

describe('mhstats world: parsePoedb', () => {
  it('reads Rathalos base size from poedb, not derived from the gold crown', () => {
    const d = parsePoedb(POEDB_RATHALOS);
    expect(d.base_hp).toBe(3250);
    expect(d.size_base).toBeCloseTo(1704.22);
    expect(d.size_gold).toBeCloseTo(2096.19);
  });

  it('reads Acidic Glavenus size_base as 2372.44 with a gold of 2846.93, proving no 1.23 assumption', () => {
    const d = parsePoedb(POEDB_ACIDIC_GLAVENUS);
    expect(d.size_base).toBeCloseTo(2372.44);
    expect(d.size_gold).toBeCloseTo(2846.93);
    // 2846.93 / 1.23 = 2314.58, which would be WRONG for this monster.
    expect(d.size_base).not.toBeCloseTo(2846.93 / 1.23, 1);
  });

  it('does not throw on a page with no Monster Damage card, and still yields its other inputs', () => {
    const d = parsePoedb(POEDB_ACIDIC_GLAVENUS);
    expect(d.base_hp).toBe(2990);
    expect(d.size_base).toBeCloseTo(2372.44);
    expect(d.move_power_max).toBeNull();
  });
});
