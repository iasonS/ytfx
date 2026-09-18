// The whole chain. Every stage is pure except the extractors and the file writes,
// so a failure names the stage it came from.
import { readFileSync, writeFileSync } from 'fs';
import { readObservations, writeObservations } from './lib/observations.js';
import { buildRoster, GAME_SOURCE } from './roster.js';
import { resolveInputs, applyInheritance } from './merge.js';
import { computeStats, STAT_DEFS, STAT_MAX } from './scale.js';
import { applyRefinement, tieGroups } from './refine.js';
import { applyCuration, findGaps, writeReport } from './curate.js';

const DATA = new URL('./data/', import.meta.url).pathname;
const OUT = new URL('../../public/mhstats/', import.meta.url).pathname;

// Extractor module name -> the roster "source" value it covers.
const SOURCES = {
  wilds: 'Wilds', rise: 'Rise', world: 'World',
  mh4u: '4U', mhgu: 'GU', mh3u: '3U', mhfu: 'FU',
};

// A monster goes to EVERY extractor whose games it appears in, not just the one for
// its newest game. Tetsucabra's newest game is GU, which records no enrage data, but
// it also appears in 4U, which does. Merge then takes the newest game per input.
function monstersFor(roster, sourceKey) {
  return roster.filter(r => r.games.some(g => GAME_SOURCE[g] === sourceKey));
}

const readJson = p => JSON.parse(readFileSync(p, 'utf8'));

export async function loadRoster({ refresh = false } = {}) {
  return refresh ? await buildRoster() : readJson(`${DATA}roster.json`);
}

export async function gatherObservations(roster, { tolerant = false } = {}) {
  const rows = [];
  for (const [mod, sourceKey] of Object.entries(SOURCES)) {
    const mine = monstersFor(roster, sourceKey);
    let extract;
    try {
      ({ extract } = await import(`./sources/${mod}.js`));
    } catch {
      console.log(`${mod}: no extractor yet, skipping ${mine.length} monsters`);
      continue;
    }
    try {
      const got = await extract(mine);
      console.log(`${mod}: ${got.length} observations for ${mine.length} monsters`);
      rows.push(...got);
    } catch (err) {
      // An extractor throws when a monster it was handed is not in its source, which is
      // almost always a cross-game spelling difference. Collect them all in one run
      // rather than failing on the first, then fix the aliases.
      console.log(`${mod}: FAILED — ${err.message}`);
      if (!tolerant) throw err;
    }
  }
  return rows;
}

export async function build({ refresh = false, groupsOnly = false, tolerant = false } = {}) {
  const roster = await loadRoster({ refresh });

  const observations = refresh
    ? writeObservations(await gatherObservations(roster, { tolerant }), `${DATA}observations.csv`)
    : readObservations(`${DATA}observations.csv`);

  const { resolved, inherited } = applyInheritance(resolveInputs(observations, roster), roster);
  const scaled = computeStats(resolved);

  if (groupsOnly) {
    const byId = new Map(roster.map(r => [r.id, r.name]));
    for (const def of STAT_DEFS) {
      const groups = tieGroups(scaled, def.key).sort((a, b) => b.ids.length - a.ids.length);
      const tied = groups.reduce((n, g) => n + g.ids.length, 0);
      console.log(`\n== ${def.label}: ${groups.length} tie groups covering ${tied} monsters`);
      for (const g of groups) {
        console.log(`  anchor ${g.anchor} band ${g.bounds.lo}..${g.bounds.hi} (${g.ids.length}): ` +
          g.ids.map(id => byId.get(id) ?? id).join(', '));
      }
    }
    return null;
  }

  const refinements = readJson(`${DATA}refinement.json`);
  const { stats: refined, applied: refinedCount } = applyRefinement(scaled, refinements);

  const curation = readJson(`${DATA}curation.json`);
  const { stats: final } = applyCuration(refined, curation, roster);

  const gaps = findGaps(final, roster);
  writeFileSync(`${DATA}curation-report.md`, writeReport({ inherited, refinements, curation, gaps }));
  if (gaps.length) {
    const byStat = {};
    for (const g of gaps) byStat[g.stat] = (byStat[g.stat] ?? 0) + 1;
    throw new Error(`${gaps.length} monster-stat pairs have no value (${JSON.stringify(byStat)}). ` +
      'See data/curation-report.md for the full list.');
  }

  const inheritedSet = new Set(inherited.map(i => `${i.id}/${i.input}`));
  const curatedSet = new Set(curation.map(c => `${c.id}/${c.stat}`));

  const deck = {
    version: 1,
    built: process.env.MHSTATS_BUILT_AT ?? new Date().toISOString().slice(0, 10),
    statMax: STAT_MAX,
    stats: STAT_DEFS.map(d => ({ key: d.key, label: d.label })),
    monsters: roster.map(r => {
      const inputs = resolved.get(r.id) ?? {};
      const curated = STAT_DEFS.filter(d =>
        curatedSet.has(`${r.id}/${d.key}`) || d.parts.some(p => inheritedSet.has(`${r.id}/${p.input}`)),
      ).map(d => d.key);
      return {
        id: r.id,
        name: r.name,
        gen: r.debut,
        game: inputs.base_hp?.game ?? r.latest,
        img: `img/${r.id}.webp`,
        stats: final.get(r.id),
        raw: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, `${v.value} (${v.game})`])),
        curated,
      };
    }),
  };

  writeFileSync(`${OUT}deck.json`, `${JSON.stringify(deck, null, 1)}\n`);
  console.log(`deck: ${deck.monsters.length} monsters, ${refinedCount} refined, ` +
    `${curation.length} curated, ${inherited.length} inherited inputs`);
  return deck;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  await build({
    refresh: process.argv.includes('--refresh'),
    groupsOnly: process.argv.includes('--groups'),
    tolerant: process.argv.includes('--tolerant'),
  });
}
