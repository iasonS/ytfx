// Fetches one render per monster from the Monster Hunter wikis and writes a
// 512px webp per monster, plus the credits file the wikis' licences require.
//
// The renders are Capcom's artwork, hosted by fan wikis. This is a non-commercial
// fan project: credits.txt names Capcom, the wikis under their licence, the wiki
// users behind the fan-made renders, and every data source. It must ship with the page.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { cachedFetch, CACHE_DIR } from './lib/fetch.js';

const WIKI = 'https://monsterhunterwiki.org/api.php';
const FANDOM = 'https://monsterhunter.fandom.com/api.php';
const DATA = new URL('./data/', import.meta.url).pathname;
const IMG_DIR = new URL('../../public/mhstats/img/', import.meta.url).pathname;
const OUT_DIR = new URL('../../public/mhstats/', import.meta.url).pathname;

const MAX_PX = 512;
const chunk = (xs, n) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

// One API call per 50 file titles. redirects=1 is essential: renamed files (the Wilds
// renders in particular) are wiki redirects, and the served URL uses a hashed path
// that cannot be built from the title.
async function imageInfo(api, titles, tag) {
  const out = new Map();
  for (const [i, batch] of chunk(titles, 50).entries()) {
    const url = `${api}?action=query&redirects=1&prop=imageinfo|templates` +
      '&iiprop=url|size|mime|sha1&tltemplates=Template:CustomRenderNotice' +
      `&titles=${batch.map(t => encodeURIComponent(`File:${t}`)).join('|')}` +
      '&format=json&formatversion=2';
    let data;
    try {
      data = await cachedFetch(url, { as: 'json', cacheName: `img-${tag}-${i}.json` });
    } catch (err) {
      console.log(`  imageinfo batch ${i} failed on ${tag}: ${err.message}`);
      continue;
    }
    const q = data.query ?? {};
    // Walk the returned title back to the one we asked for. MediaWiki may both
    // NORMALISE it (underscores become spaces) and REDIRECT it (renamed files, which
    // every Wilds render is). Missing the normalise step silently loses any filename
    // containing an underscore.
    const back = new Map();
    for (const n of q.normalized ?? []) back.set(n.to, n.from);
    for (const r of q.redirects ?? []) back.set(r.to, r.from);
    const askedFor = title => {
      let t = title;
      for (let i = 0; i < 4 && back.has(t); i++) t = back.get(t);
      return t;
    };
    for (const p of q.pages ?? []) {
      const info = p.imageinfo?.[0];
      if (!info) continue;
      const asked = askedFor(p.title);
      out.set(asked.replace(/^File:/, ''), {
        url: info.url,
        width: info.width,
        height: info.height,
        sha1: info.sha1,
        mime: info.mime,
        fanMade: Array.isArray(p.templates) && p.templates.length > 0,
        creditPage: p.title.replace(/^File:/, ''),
      });
    }
  }
  return out;
}

function looksLikeIcon(name, info) {
  return /icon/i.test(name) || (info.width && info.width < 300);
}

async function fetchOriginal(info, fromFandom) {
  const headers = fromFandom ? { Referer: 'https://monsterhunter.fandom.com/' } : {};
  const url = fromFandom && !info.url.includes('format=original')
    ? `${info.url}${info.url.includes('?') ? '&' : '?'}format=original`
    : info.url;
  return cachedFetch(url, { as: 'buffer', cacheName: `img-src-${info.sha1 || encodeURIComponent(url).slice(0, 80)}`, headers });
}

export async function fetchImages(roster) {
  mkdirSync(IMG_DIR, { recursive: true });
  mkdirSync(CACHE_DIR, { recursive: true });

  const wanted = roster.filter(r => r.image);
  const wikiInfo = await imageInfo(WIKI, [...new Set(wanted.map(r => r.image))], 'wiki');

  // Anything the main wiki could not serve, or served as an icon, retries on Fandom.
  const needFallback = roster.filter(r => {
    const info = r.image && wikiInfo.get(r.image);
    return !info || looksLikeIcon(r.image, info);
  });
  const fandomInfo = needFallback.length
    ? await imageInfo(FANDOM, [...new Set(needFallback.map(r => r.image).filter(Boolean))], 'fandom')
    : new Map();

  const manifest = [];
  const failed = [];
  for (const r of roster) {
    const target = join(IMG_DIR, `${r.id}.webp`);
    let info = r.image ? wikiInfo.get(r.image) : null;
    let source = 'monsterhunterwiki.org';
    if (!info || looksLikeIcon(r.image, info)) {
      const alt = r.image ? fandomInfo.get(r.image) : null;
      if (alt) { info = alt; source = 'monsterhunter.fandom.com'; }
    }
    if (!info) { failed.push(r.name); continue; }

    if (!existsSync(target)) {
      try {
        const buf = await fetchOriginal(info, source !== 'monsterhunterwiki.org');
        const out = await sharp(buf)
          .resize({ width: MAX_PX, height: MAX_PX, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82, alphaQuality: 90, effort: 4 })
          .toBuffer();
        writeFileSync(target, out);
      } catch (err) {
        failed.push(`${r.name} (${err.message})`);
        continue;
      }
    }
    manifest.push({ id: r.id, name: r.name, file: info.creditPage, source, fanMade: !!info.fanMade });
  }

  writeFileSync(`${DATA}image-manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
  return { manifest, failed };
}

export function writeCredits(manifest) {
  const fanMade = manifest.filter(m => m.fanMade);
  const fromFandom = manifest.filter(m => m.source === 'monsterhunter.fandom.com');
  const lines = [
    'MH Stats — credits and attribution',
    '',
    'This is a fan-made game. It is not affiliated with, endorsed by, or produced by Capcom.',
    'Monster Hunter and all monster names, designs and artwork are trademarks and copyright',
    'of Capcom Co., Ltd. The monster renders shown here are Capcom artwork, reproduced from',
    'fan wikis for a non-commercial fan project.',
    '',
    'IMAGES',
    `  Monster Hunter Wiki — https://monsterhunterwiki.org — CC BY-SA 4.0`,
    `    https://creativecommons.org/licenses/by-sa/4.0/`,
    `  Monster Hunter Wiki on Fandom — https://monsterhunter.fandom.com — CC BY-SA`,
    `    ${fromFandom.length} render(s) sourced from Fandom.`,
    '',
  ];
  if (fanMade.length) {
    lines.push('FAN-MADE RENDERS',
      '  These renders were created by wiki contributors, not by Capcom, and are used with',
      '  the permission recorded on their wiki file pages:');
    for (const m of fanMade) lines.push(`    ${m.name} — File:${m.file}`);
    lines.push('');
  }
  lines.push(
    'GAME DATA',
    '  Monster Hunter Wilds — mhdb.io (https://wilds.mhdb.io) and',
    '    robomeche/MHWilds-Database (https://github.com/robomeche/MHWilds-Database)',
    '  Monster Hunter Rise / Sunbreak — MHRice by wwylele (https://mhrice.info)',
    '  Monster Hunter World / Iceborne — Kiranico (https://mhworld.kiranico.com)',
    '    and poedb (https://mhw.poedb.tw)',
    '  Monster Hunter 4 Ultimate — Kiranico (https://kiranico.com/en/mh4u)',
    '  Monster Hunter Generations Ultimate — Kiranico (https://mhgu.kiranico.com) and',
    '    gatheringhallstudios/MHGenDatabase',
    '  Monster Hunter 3 Ultimate — dbooga/MonsterHunter3UDatabase, mh3g.org,',
    '    mh3g.trigwiki.jp',
    '  Monster Hunter Freedom Unite — Kolyn090/mhfu-db, whose attribution file credits',
    '    Kolyn090, Gustavo Augustini and MHP2G@Wiki',
    '',
    'If you own any material here and would like it removed, the page will be taken down',
    'on request.',
    '',
  );
  writeFileSync(`${OUT_DIR}credits.txt`, lines.join('\n'));
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const roster = JSON.parse(readFileSync(`${DATA}roster.json`, 'utf8'));
  const { manifest, failed } = await fetchImages(roster);
  writeCredits(manifest);
  const files = readdirSync(IMG_DIR).filter(f => f.endsWith('.webp'));
  const fandom = manifest.filter(m => m.source !== 'monsterhunterwiki.org');
  const fan = manifest.filter(m => m.fanMade);
  console.log(`images: ${files.length}/${roster.length} written`);
  if (fandom.length) console.log(`  fandom fallback (${fandom.length}): ${fandom.map(m => m.name).join(', ')}`);
  if (fan.length) console.log(`  fan-made renders (${fan.length}): ${fan.map(m => m.name).join(', ')}`);
  if (failed.length) console.log(`  NO IMAGE (${failed.length}): ${failed.join(', ')}`);
}
