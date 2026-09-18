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
    // Every generation must be playable on its own, which needs at least a full round of
    // monsters, otherwise the filter can offer a selection that cannot start a game.
    for (const g of [1, 2, 3, 4, 5, 6]) {
      expect(counts.get(g) ?? 0, `generation ${g} pool`).toBeGreaterThanOrEqual(7);
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

  it('spreads each stat rather than clustering on one value', () => {
    for (const k of KEYS) {
      const counts = new Map();
      for (const m of deck.monsters) counts.set(m.stats[k], (counts.get(m.stats[k]) ?? 0) + 1);
      const biggest = Math.max(...counts.values());
      expect(biggest, `${k} has ${biggest} monsters on one value`).toBeLessThanOrEqual(25);
      expect(counts.size, `${k} distinct values`).toBeGreaterThanOrEqual(30);
    }
  });
});
