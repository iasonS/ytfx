// Roster: which monsters are in the deck, and which game supplies each one's
// numbers. Source is monsterhunterwiki.org's Large Monsters category.
import { writeFileSync, mkdirSync } from 'fs';
import { cachedFetch } from './lib/fetch.js';

const API = 'https://monsterhunterwiki.org/api.php';

export const MAINLINE_GAMES = ['MH1', 'MHG', 'MHF1', 'MH2', 'MHF2', 'MHFU', 'MH3', 'MHP3', 'MH3U',
  'MH4', 'MH4U', 'MHGen', 'MHGU', 'MHWorld', 'MHWI', 'MHRise', 'MHRS', 'MHWilds'];

// Which extractor covers a game's numbers. Older games share the database of
// the newest game that reprinted their stats.
export const GAME_SOURCE = {
  MH1: 'FU', MHG: 'FU', MHF1: 'FU', MH2: 'FU', MHF2: 'FU', MHFU: 'FU',
  MH3: '3U', MHP3: '3U', MH3U: '3U',
  MH4: '4U', MH4U: '4U',
  MHGen: 'GU', MHGU: 'GU',
  MHWorld: 'World', MHWI: 'World',
  MHRise: 'Rise', MHRS: 'Rise',
  MHWilds: 'Wilds',
};

export function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function templateBody(wikitext, name) {
  const m = new RegExp(`\\{\\{${name}([\\s\\S]*?)\\n\\}\\}`).exec(wikitext);
  return m ? m[1] : null;
}

// Template parameters are one per line, so a value runs to end of line. It may
// legitimately contain pipes: "{{{Render|X.png}}}", "{{Element|Fire}}<br>...".
function field(body, key) {
  if (!body) return null;
  const m = new RegExp(`\\|\\s*${key}\\s*=\\s*([^\\n]*)`).exec(body);
  return m ? m[1].trim() : null;
}

export function parseMonsterPage(title, wikitext) {
  const nav = templateBody(wikitext, 'MonsterAppearancesNav');
  if (!nav) return null;
  const flagged = new Set();
  for (const line of nav.split('\n|')) {
    const m = /^\s*(\w+)\s*=\s*Y\b/.exec(line);
    if (m) flagged.add(m[1]);
  }
  const games = MAINLINE_GAMES.filter(g => flagged.has(g));
  if (!games.length) return null;

  const box = templateBody(wikitext, 'MonsterGameInfoBox_Overview');
  const meta = templateBody(wikitext, 'Meta');
  // An image can be a bare filename, File:-prefixed, or wrapped in a template default.
  let image = field(box, 'Image') ?? field(meta, 'MetaImage');
  if (image) {
    image = image.replace(/^\{\{\{[^|}]*\|(.*)\}\}\}$/, '$1').replace(/^File:/, '').trim() || null;
  }
  const latest = games[games.length - 1];
  return {
    id: slugify(title),
    name: title,
    ja: field(box, 'Japanese Name'),
    debut: games[0],
    latest,
    source: GAME_SOURCE[latest],
    games,
    image,
  };
}

async function categoryTitles() {
  const url = `${API}?action=query&list=categorymembers&cmtitle=Category:Large%20Monsters` +
    '&cmnamespace=0&cmlimit=500&format=json&formatversion=2';
  const data = await cachedFetch(url, { as: 'json', cacheName: 'wiki-category.json' });
  return data.query.categorymembers.map(m => m.title);
}

async function wikitextFor(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 50) {
    const batch = titles.slice(i, i + 50);
    const url = `${API}?action=query&prop=revisions&rvslots=main&rvprop=content` +
      `&titles=${batch.map(encodeURIComponent).join('|')}&format=json&formatversion=2`;
    const data = await cachedFetch(url, { as: 'json', cacheName: `wiki-pages-${i}.json` });
    for (const p of data.query.pages) {
      if (p.revisions) out.set(p.title, p.revisions[0].slots.main.content);
    }
  }
  return out;
}

export async function buildRoster() {
  const titles = await categoryTitles();
  const pages = await wikitextFor(titles);
  const roster = [];
  for (const [title, text] of pages) {
    const entry = parseMonsterPage(title, text);
    if (entry) roster.push(entry);
  }
  roster.sort((a, b) => a.id.localeCompare(b.id));
  const dir = new URL('./data/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}roster.json`, `${JSON.stringify(roster, null, 2)}\n`);
  return roster;
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const roster = await buildRoster();
  const bySource = {};
  for (const r of roster) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
  console.log(`roster: ${roster.length} monsters`, bySource);
  const noImage = roster.filter(r => !r.image).map(r => r.name);
  if (noImage.length) console.log('no image field:', noImage.join(', '));
  const noJa = roster.filter(r => !r.ja).map(r => r.name);
  if (noJa.length) console.log('no japanese name:', noJa.join(', '));
}
