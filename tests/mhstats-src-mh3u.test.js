import { describe, it, expect } from 'vitest';
import {
  parseTolerances, parseEnrage, parseHeadStagger, parseSize, hitzoneMaxRaw,
  extract, MONSTER_MAP, EMITTED_INPUTS,
} from '../tools/mhstats/sources/mh3u.js';

// Gigginox fixtures, trimmed from the real cached pages (verified values from the
// research card: size_base 1092, size_gold 1266.72, enrage_attack_mult 1.2,
// enrage_speed_mult 1.1, enrage_duration 80, head_stagger 250,
// tolerances 240 / 180 / 200 / 180).
const GIGGINOX_TRIGWIKI = `
<table>
<tr><td>状態異常耐性</td></tr>
<tr><td>種類</td><td>効果</td><td>備考</td><td>耐性値</td><td>蓄積値減少</td></tr>
<tr><td>初期</td><td>上昇</td><td>最大</td></tr>
<tr><td>毒</td><td>△</td><td>75ダメージ</td><td>240</td><td>140</td><td>940</td><td>5/10秒</td></tr>
<tr><td>麻痺</td><td>○</td><td>10秒</td><td>180</td><td>120</td><td>780</td><td>5/10秒</td></tr>
<tr><td>睡眠</td><td>○</td><td>40秒</td><td>200</td><td>120</td><td>800</td><td>5/10秒</td></tr>
<tr><td>めまい</td><td>○</td><td>10秒</td><td>180</td><td>100</td><td>580</td><td>5/10秒</td></tr>
<tr><td>疲れ</td><td>○</td><td>スタミナ-200</td><td>180</td><td>100</td><td>580</td><td>5/10秒</td></tr>
</table>`;

// Abyssal Lagiacrus: every cell in the row is blank ('-' or empty), including an
// empty 備考 cell. The skeptic found a flattened-text regex silently absorbing the
// next row's label here; the cell-index parser must not do that.
const BLANK_TRIGWIKI = `
<table>
<tr><td>状態異常耐性</td></tr>
<tr><td>種類</td><td>効果</td><td>備考</td><td>耐性値</td><td>蓄積値減少</td></tr>
<tr><td>初期</td><td>上昇</td><td>最大</td></tr>
<tr><td>毒</td><td>-</td><td>-</td><td></td><td>-</td><td>-</td><td>-</td></tr>
<tr><td>麻痺</td><td>-</td><td>-</td><td></td><td>-</td><td>-</td><td>-</td></tr>
<tr><td>睡眠</td><td>-</td><td>-</td><td></td><td>-</td><td>-</td><td>-</td></tr>
<tr><td>めまい</td><td>-</td><td>-</td><td></td><td>-</td><td>-</td><td>-</td></tr>
</table>`;

const GIGGINOX_ENRAGE = `
<table>
<tr><td>継続</td><td>怒りやすさ</td><td>攻撃倍率</td><td>行動速度</td></tr>
<tr><td>80秒</td><td>HPが50%以下になると怒りやすくなる</td><td>×1.20</td><td>×1.10</td></tr>
</table>`;

// Jhen Mohran's duration cell is a literal question mark; attack/speed still parse.
const JHEN_ENRAGE = `
<table>
<tr><td>継続</td><td>怒りやすさ</td><td>攻撃倍率</td><td>行動速度</td></tr>
<tr><td>？</td><td>怒りにくい</td><td>×1.20</td><td>x1.00</td></tr>
</table>`;

const GIGGINOX_NIKUSHITSU = `
<table>
<tr><td>肉質（カッコ内は怒り時の肉質）</td></tr>
<tr><td>部位</td><td>切断</td><td>打撃</td><td>弾</td><td>火</td><td>水</td><td>雷</td><td>氷</td><td>龍</td><td>気絶</td><td>よろめき</td></tr>
<tr><td>頭</td><td>45 (19)</td><td>55 (19)</td><td>50 (10)</td><td>30</td><td>5</td><td>0</td><td>0</td><td>20</td><td>100</td><td>250</td></tr>
<tr><td>首</td><td>40 (24)</td><td>40 (25)</td><td>40 (15)</td><td>25</td><td>5</td><td>0</td><td>0</td><td>10</td><td>0</td><td>220</td></tr>
</table>`;

// Abyssal Lagiacrus: the よろめき cell is blank (&nbsp;) for the head row.
const ABYSSAL_NIKUSHITSU = `
<table>
<tr><td>肉質</td></tr>
<tr><td>部位</td><td>切断</td><td>打撃</td><td>弾</td><td>火</td><td>水</td><td>雷</td><td>氷</td><td>龍</td><td>気絶</td><td>よろめき</td></tr>
<tr><td>頭</td><td>15</td><td>15</td><td>18</td><td>20</td><td>0</td><td>0</td><td>5</td><td>35</td><td>100</td><td></td></tr>
</table>`;

// Jhen Mohran has no 頭 row at all; the first data row is 両牙 (fangs).
const JHEN_NIKUSHITSU = `
<table>
<tr><td>肉質</td></tr>
<tr><td>部位</td><td>切断</td><td>打撃</td><td>弾</td><td>火</td><td>水</td><td>雷</td><td>氷</td><td>龍</td><td>気絶</td><td>よろめき</td></tr>
<tr><td>両牙</td><td>18</td><td>18</td><td>18</td><td>0</td><td>5</td><td>5</td><td>15</td><td>15</td><td>0</td><td>600</td></tr>
</table>`;

const GIGGINOX_SIZE = `<div class="monster-game-info">Avg. ≤1004.64 cm 1092 cm ≥1212.12 cm ≥1266.72 cm</div>`;
const FIXED_SIZE = `<div class="monster-game-info">Avg. ≤ - cm - cm ≥ - cm ≥ - cm</div>`;
const MALFORMED_SIZE = `<div class="monster-game-info">Avg. this is not a size table</div>`;

describe('mhstats mh3u source', () => {
  it('parses tolerances by cell index (Gigginox)', () => {
    expect(parseTolerances(GIGGINOX_TRIGWIKI)).toEqual({
      tolerance_poison: 240, tolerance_paralysis: 180, tolerance_sleep: 200, tolerance_stun: 180,
    });
  });

  it('emits no tolerance row for a blank cell, and never captures the next label', () => {
    const result = parseTolerances(BLANK_TRIGWIKI);
    expect(result).toEqual({});
    expect(Object.values(result)).not.toContain('麻痺');
    expect(Object.values(result)).not.toContain('睡眠');
  });

  it('parses enrage attack/speed/duration (Gigginox)', () => {
    expect(parseEnrage(GIGGINOX_ENRAGE)).toEqual({
      enrage_duration: 80, enrage_attack_mult: 1.2, enrage_speed_mult: 1.1,
    });
  });

  it('treats a ？ duration cell as absent but still reads attack/speed', () => {
    const result = parseEnrage(JHEN_ENRAGE);
    expect(result.enrage_duration).toBeUndefined();
    expect(result.enrage_attack_mult).toBeCloseTo(1.2);
    expect(result.enrage_speed_mult).toBeCloseTo(1.0);
  });

  it('parses head_stagger from the first body-part row (Gigginox 頭)', () => {
    expect(parseHeadStagger(GIGGINOX_NIKUSHITSU)).toBe(250);
  });

  it('returns null head_stagger when the よろめき cell is blank', () => {
    expect(parseHeadStagger(ABYSSAL_NIKUSHITSU)).toBeNull();
  });

  it('uses 両牙 as the head row for the Jhen Mohran pair', () => {
    expect(parseHeadStagger(JHEN_NIKUSHITSU)).toBe(600);
  });

  it('parses base and gold crown size (Gigginox)', () => {
    expect(parseSize(GIGGINOX_SIZE)).toEqual({ size_base: 1092, size_gold: 1266.72 });
  });

  it('emits no size rows for a fixed-size monster (≤ - cm, with the space)', () => {
    expect(parseSize(FIXED_SIZE)).toEqual({});
  });

  it('throws on a malformed size table instead of silently returning nothing', () => {
    expect(() => parseSize(MALFORMED_SIZE)).toThrow();
  });

  it('excludes the -1/-2 sentinels from the hitzone max', () => {
    expect(hitzoneMaxRaw([
      { cut: 45, impact: 50, shot: -2 },
      { cut: 30, impact: -2, shot: -2 },
      { cut: -1, impact: -1, shot: -1 },
    ])).toBe(50);
  });

  it('returns null when every value is a sentinel', () => {
    expect(hitzoneMaxRaw([{ cut: -1, impact: -2, shot: -1 }])).toBeNull();
  });

  it('never emits base_hp, enrage_trigger or move_power_max', () => {
    expect(EMITTED_INPUTS).not.toContain('base_hp');
    expect(EMITTED_INPUTS).not.toContain('enrage_trigger');
    expect(EMITTED_INPUTS).not.toContain('move_power_max');
  });

  it('has a locator mapping entry for all 20 roster monsters', () => {
    expect(MONSTER_MAP).toHaveLength(20);
    for (const m of MONSTER_MAP) {
      expect(m.name).toBeTruthy();
      expect(m.trigwikiId).toBeGreaterThan(0);
      expect(m.mh3gOrgFile).toBeTruthy();
    }
  });

  it('throws listing names when a roster monster has no locator mapping', async () => {
    const roster = [{ id: 'made-up-monster', name: 'Made Up Monster', source: '3U' }];
    await expect(extract(roster)).rejects.toThrow(/Made Up Monster/);
  });
});
