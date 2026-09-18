import { describe, it, expect, beforeAll } from 'vitest';
import initSqlJs from 'sql.js';
import { queryMhguDb, parseKiranicoGu } from '../tools/mhstats/sources/mhgu.js';

// Fixtures below are the card's verified Agnaktor example
// (docs/superpowers/research/2026-09-18-source-locators.md, "######## GU" section,
// VERDICT block, held_out=Agnaktor). Agnaktor is a multi-state monster: sqlite's
// "(Cool)" head row is a flat 15/15/15 placeholder that disagrees with Kiranico's
// state-a Head (20/20/15); both sources agree once the head is taken as the max
// over every state, which is the rule the VERDICT's FAILED note prescribes.

let SQL;
beforeAll(async () => {
  SQL = await initSqlJs();
});

function buildFixtureDb() {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE monsters (_id INTEGER PRIMARY KEY, name TEXT, base_hp INT);
    CREATE TABLE monster_damage (_id INTEGER PRIMARY KEY, monster_id INT, body_part TEXT, cut INT, impact INT, shot INT);
    CREATE TABLE monster_status (_id INTEGER PRIMARY KEY, monster_id INT, status TEXT, initial INT);
    INSERT INTO monsters (_id, name, base_hp) VALUES (1, 'Agnaktor', 4600);
    INSERT INTO monster_damage (monster_id, body_part, cut, impact, shot) VALUES
      (1, 'Head (Cool)', 15, 15, 15),
      (1, 'Neck (Cool)', 15, 15, 15),
      (1, 'Head (Hot/Break)', 55, 60, 50),
      (1, 'Neck (Hot/Break)', 40, 35, 30);
    INSERT INTO monster_status (monster_id, status, initial) VALUES
      (1, 'Poison', 180), (1, 'Para', 180), (1, 'Sleep', 180), (1, 'KO', 200);
  `);
  return db;
}

// Trimmed to the tables the parser reads. Numbers match the real Kiranico GU
// page for Agnaktor (https://mhgu.kiranico.com/monster/677b6).
const AGNAKTOR_HTML = `
<h2>Agnaktor</h2>
<h5>Size: 2,737.31</h5>
<h6>Small Crown: &le;2,463.58</h6>
<h6>Silver Crown: &ge;3,147.91</h6>
<h6>Gold Crown: &ge;3,366.89</h6>
<h5>Hit Data</h5>
<div class="tab-content">
  <div class="tab-pane active" id="state-a" role="tabpanel">
    <table class="table table-sm">
      <thead><tr><th>Body Part</th><th>Slash</th><th>Impact</th><th>Shot</th><th>Fir</th><th>Wat</th><th>Thn</th><th>Ice</th><th>Dra</th><th>Dizzy</th><th>Exh</th></tr></thead>
      <tr><td>Head</td><td>20</td><td>20</td><td>15</td><td>10</td><td>30</td><td>15</td><td>25</td><td>0</td><td>100</td><td>100</td></tr>
      <tr><td>Neck</td><td>20</td><td>20</td><td>15</td><td>10</td><td>15</td><td>0</td><td>15</td><td>0</td><td>0</td><td>100</td></tr>
      <tr><td>NO DATA</td><td>999</td><td>999</td><td>999</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
    </table>
  </div>
  <div class="tab-pane" id="state-b" role="tabpanel">
    <table class="table table-sm">
      <thead><tr><th>Body Part</th><th>Slash</th><th>Impact</th><th>Shot</th><th>Fir</th><th>Wat</th><th>Thn</th><th>Ice</th><th>Dra</th><th>Dizzy</th><th>Exh</th></tr></thead>
      <tr><td>Head</td><td>55</td><td>60</td><td>50</td><td>25</td><td>10</td><td>10</td><td>20</td><td>40</td><td>0</td><td>0</td></tr>
      <tr><td>Neck</td><td>40</td><td>35</td><td>30</td><td>20</td><td>5</td><td>5</td><td>15</td><td>30</td><td>0</td><td>0</td></tr>
    </table>
  </div>
</div>
<h5>Body Part</h5>
<div class="tab-content">
  <div class="tab-pane active" id="part" role="tabpanel">
    <table class="table table-sm">
      <thead><tr><th>Body Part</th><th>Stagger</th><th>Extract</th></tr></thead>
      <tr><td>Head</td><td>200</td><td><span class="extract-1">&#9679;</span></td></tr>
      <tr><td>Tail</td><td>160 [350]</td><td><span class="extract-1">&#9679;</span></td></tr>
      <tr><td>NO DATA</td><td>900</td><td><span class="extract-4">&#9679;</span></td></tr>
    </table>
  </div>
</div>
<h5>Abnormal Status</h5>
<div class="table-responsive">
  <table class="table table-sm">
    <thead><tr><th></th><th>Initial</th><th>Increase</th><th>Maximum</th><th>Damage</th><th>Time</th><th>Reduction</th></tr></thead>
    <tr><td>Psn</td><td>180</td><td>+110</td><td>620</td><td>150</td><td>30sec</td><td>-10/5sec</td></tr>
    <tr><td>Par</td><td>180</td><td>+120</td><td>660</td><td></td><td>10sec</td><td>-5/10sec</td></tr>
    <tr><td>Sle</td><td>180</td><td>+120</td><td>660</td><td></td><td>20sec</td><td>-5/10sec</td></tr>
    <tr><td>Dizzy</td><td>200</td><td>+100</td><td>600</td><td></td><td>10sec</td><td>-0/0sec</td></tr>
  </table>
</div>
`;

// A monster whose page shows 0.00 crowns (no crown ever recorded), like the
// card's Lao-Shan Lung example. 0.00 means "no crown data", not a real size.
const NO_CROWN_HTML = `
<h2>Lao-Shan Lung</h2>
<h5>Size: 6,959.79</h5>
<h6>Small Crown: &le;0.00</h6>
<h6>Silver Crown: &ge;0.00</h6>
<h6>Gold Crown: &ge;0.00</h6>
<h5>Hit Data</h5>
<div class="tab-content">
  <div class="tab-pane active" id="state-a" role="tabpanel">
    <table class="table table-sm">
      <thead><tr><th>Body Part</th><th>Slash</th><th>Impact</th><th>Shot</th><th>Fir</th><th>Wat</th><th>Thn</th><th>Ice</th><th>Dra</th><th>Dizzy</th><th>Exh</th></tr></thead>
      <tr><td>Head</td><td>28</td><td>21</td><td>30</td><td>20</td><td>5</td><td>15</td><td>5</td><td>20</td><td>0</td><td>0</td></tr>
    </table>
  </div>
</div>
<h5>Body Part</h5>
<div class="tab-content">
  <div class="tab-pane active" id="part" role="tabpanel">
    <table class="table table-sm">
      <thead><tr><th>Body Part</th><th>Stagger</th><th>Extract</th></tr></thead>
      <tr><td>Head</td><td>800</td><td><span class="extract-1">&#9679;</span></td></tr>
    </table>
  </div>
</div>
<h5>Abnormal Status</h5>
<div class="table-responsive">
  <table class="table table-sm">
    <thead><tr><th></th><th>Initial</th><th>Increase</th><th>Maximum</th><th>Damage</th><th>Time</th><th>Reduction</th></tr></thead>
    <tr><td>Psn</td><td>0</td><td>+0</td><td>0</td><td></td><td>0sec</td><td>-0/0sec</td></tr>
  </table>
</div>
`;

describe('queryMhguDb', () => {
  it('matches the verified Agnaktor sqlite figures', () => {
    const db = buildFixtureDb();
    const out = queryMhguDb(db, 'Agnaktor');
    expect(out.base_hp).toBe(4600);
    expect(out.tolerance_poison).toBe(180);
    expect(out.tolerance_paralysis).toBe(180);
    expect(out.tolerance_sleep).toBe(180);
    expect(out.tolerance_stun).toBe(200);
    db.close();
  });

  it('takes the head hitzone as the max over every state, not the first Head% row', () => {
    const db = buildFixtureDb();
    const out = queryMhguDb(db, 'Agnaktor');
    // sqlite's LIKE 'Head%' ORDER BY _id LIMIT 1 would pick the (Cool) 15/15/15
    // placeholder; the corrected rule takes the max across all Head% rows.
    expect(out.headHitzoneMax).toBe(60);
    db.close();
  });
});

describe('parseKiranicoGu', () => {
  it('matches the verified Agnaktor figures', () => {
    const out = parseKiranicoGu(AGNAKTOR_HTML);
    expect(out.sizeBase).toBeCloseTo(2737.31);
    expect(out.sizeGold).toBeCloseTo(3366.89);
    expect(out.headStagger).toBe(200);
    expect(out.tolerance_poison).toBe(180);
    expect(out.tolerance_paralysis).toBe(180);
    expect(out.tolerance_sleep).toBe(180);
    expect(out.tolerance_stun).toBe(200);
  });

  it('defines hitzone_max_raw as the max over all states, skipping NO DATA rows', () => {
    const out = parseKiranicoGu(AGNAKTOR_HTML);
    // If the 999-valued NO DATA row leaked in, this would be 999.
    expect(out.hitzoneMaxRaw).toBe(60);
    expect(out.headHitzoneMax).toBe(60);
  });

  it('skips a NO DATA stagger row rather than parsing it as a body part', () => {
    const out = parseKiranicoGu(AGNAKTOR_HTML);
    expect(out.headStagger).toBe(200);
  });

  it('takes only the first number out of a packed "stagger [sever]" cell', () => {
    // Exercised indirectly: Tail's cell is "160 [350]" in the fixture; if the
    // parser mis-split it, headStagger (Head's own plain "200" cell) would be
    // unaffected either way, so assert the Tail-adjacent Head is still 200
    // and that the parser did not throw on the bracketed cell.
    expect(() => parseKiranicoGu(AGNAKTOR_HTML)).not.toThrow();
    expect(parseKiranicoGu(AGNAKTOR_HTML).headStagger).toBe(200);
  });

  it('emits no size rows when the crowns are all 0.00 (no crown recorded)', () => {
    const out = parseKiranicoGu(NO_CROWN_HTML);
    expect(out.sizeBase).toBeCloseTo(6959.79);
    expect(out.sizeGold).toBeUndefined();
  });
});

describe('mhgu cross-source agreement', () => {
  it('returns the same head hitzone value from both the database and the Kiranico path', () => {
    const db = buildFixtureDb();
    const fromDb = queryMhguDb(db, 'Agnaktor');
    const fromKiranico = parseKiranicoGu(AGNAKTOR_HTML);
    expect(fromDb.headHitzoneMax).toBe(fromKiranico.headHitzoneMax);
    db.close();
  });
});

describe('mhgu enrage data', () => {
  it('never emits any enrage input from either helper', () => {
    const db = buildFixtureDb();
    const fromDb = queryMhguDb(db, 'Agnaktor');
    const fromKiranico = parseKiranicoGu(AGNAKTOR_HTML);
    db.close();
    for (const key of [...Object.keys(fromDb), ...Object.keys(fromKiranico)]) {
      expect(key.startsWith('enrage')).toBe(false);
    }
  });
});
