import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

const deck = JSON.parse(readFileSync(new URL('../public/mhstats/deck.json', import.meta.url), 'utf8'));
const KEYS = ['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp'];

describe('mhstats deck', () => {
  it('holds the whole roster with unique ids', () => {
    expect(deck.monsters.length).toBe(252);
    expect(new Set(deck.monsters.map(m => m.id)).size).toBe(252);
  });

  it('declares the seven stats and the scale', () => {
    expect(deck.statMax).toBe(300);
    expect(deck.stats.map(s => s.key)).toEqual(KEYS);
  });

  it('gives every monster every stat as an integer in range', () => {
    for (const m of deck.monsters) {
      for (const k of KEYS) {
        expect(Number.isInteger(m.stats[k]), `${m.id}.${k}`).toBe(true);
        expect(m.stats[k], `${m.id}.${k}`).toBeGreaterThanOrEqual(1);
        expect(m.stats[k], `${m.id}.${k}`).toBeLessThanOrEqual(deck.statMax);
      }
    }
  });

  it('places every monster in a generation from 1 to 6', () => {
    const counts = new Map();
    for (const m of deck.monsters) {
      expect(Number.isInteger(m.gen), `${m.id} generation`).toBe(true);
      expect(m.gen, `${m.id} generation`).toBeGreaterThanOrEqual(1);
      expect(m.gen, `${m.id} generation`).toBeLessThanOrEqual(6);
      expect(typeof m.debut, `${m.id} debut game`).toBe('string');
      counts.set(m.gen, (counts.get(m.gen) ?? 0) + 1);
    }
    // Every generation must be playable on its own: seven monsters to face plus a reserve
    // standing behind each for the reroll, otherwise the filter can offer a selection that
    // cannot start a game. The smallest generation has 21, so there is room to spare.
    for (const g of [1, 2, 3, 4, 5, 6]) {
      expect(counts.get(g) ?? 0, `generation ${g} pool`).toBeGreaterThanOrEqual(14);
    }
  });

  it('ships an image for every monster', () => {
    for (const m of deck.monsters) {
      expect(existsSync(new URL(`../public/mhstats/${m.img}`, import.meta.url)), `${m.id} image`).toBe(true);
    }
  });

  // Will is the sum of the four status tolerances, and immunity counts as maximum
  // resistance rather than as an absent term. The monsters that cannot be afflicted
  // at all must therefore sit at the top.
  it('ranks status-immune monsters at the top of Will', () => {
    const ranked = deck.monsters.slice().sort((a, b) => b.stats.wil - a.stats.wil);
    const topDecile = new Set(ranked.slice(0, Math.ceil(ranked.length / 10)).map(m => m.id));
    for (const id of ['zorah-magdaros', 'jhen-mohran', 'dalamadur', 'lao-shan-lung']) {
      expect(topDecile.has(id), `${id} is status-immune and should be top-decile Will`).toBe(true);
    }
  });

  // Fatalis cannot be stunned, so its stun row is absent from the source. Counting that
  // absence as immunity rather than as nothing is what keeps it above monsters that are
  // merely mediocre at resisting everything.
  it('scores an immune monster above an equally-tolerant but afflictable one', () => {
    const fatalis = deck.monsters.find(m => m.id === 'fatalis');
    const rathalos = deck.monsters.find(m => m.id === 'rathalos');
    expect(fatalis.stats.wil).toBeGreaterThan(rathalos.stats.wil);
  });

  // The ceiling is 35 rather than something tighter because two stats are coarse at the
  // source and no scaling can fix that. Will sums four status tolerances that the games
  // record in steps of 80/100/150/250, so sums collide. HP is worse: Capcom gives a large
  // slice of each roster one base value — 34 monsters carry their own game's median
  // exactly, Rajang and Aknosom both sitting on Rise's 4500 — and the per-quest multipliers
  // that separate them in play are not published anywhere we read. Spreading either stat
  // further would mean inventing differences the sources do not record.
  // The bug this guards: HP used to be scaled against each game's own range, so a game's
  // roster shape set the stat. World's table runs from Great Jagras to Zorah Magdaros, and
  // that 35000 ceiling pushed every ordinary World monster toward the floor — the median
  // World monster scored 46 while the median Rise monster scored 138, and Fatalis came out
  // on 106. HP is now a rank of "multiples of a typical monster of its era", so no game
  // should sit far from any other. Anything past 25 points means the era adjustment broke.
  it('does not let a monster\'s source game decide its HP', () => {
    const byGame = new Map();
    for (const m of deck.monsters) {
      if (m.curated.includes('hp')) continue; // hand-placed, not scaled
      if (!byGame.has(m.game)) byGame.set(m.game, []);
      byGame.get(m.game).push(m.stats.hp);
    }
    const medians = [...byGame].map(([game, vs]) => {
      vs.sort((a, b) => a - b);
      return { game, median: vs[Math.floor(vs.length / 2)] };
    });
    const lo = medians.reduce((a, b) => (a.median <= b.median ? a : b));
    const hi = medians.reduce((a, b) => (a.median >= b.median ? a : b));
    expect(hi.median - lo.median,
      `${hi.game} median HP ${hi.median} against ${lo.game} median HP ${lo.median}`).toBeLessThanOrEqual(25);
  });

  it('spreads each stat rather than clustering on one value', () => {
    for (const k of KEYS) {
      const counts = new Map();
      for (const m of deck.monsters) counts.set(m.stats[k], (counts.get(m.stats[k]) ?? 0) + 1);
      const biggest = Math.max(...counts.values());
      expect(biggest, `${k} has ${biggest} monsters on one value`).toBeLessThanOrEqual(35);
      expect(counts.size, `${k} distinct values`).toBeGreaterThanOrEqual(30);
    }
  });
});
