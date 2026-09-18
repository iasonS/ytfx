// Cached, polite fetch. A second run of any extractor must work offline, so
// every download is written to .cache/ and read from there when present.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export const CACHE_DIR = new URL('../.cache/', import.meta.url).pathname;
const UA = 'mhstats-deck-builder (github.com/iasonS/ytfx)';
const MIN_GAP_MS = 1000;
const lastRequest = new Map();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function politeGap(host) {
  const since = Date.now() - (lastRequest.get(host) ?? 0);
  if (since < MIN_GAP_MS) await sleep(MIN_GAP_MS - since);
  lastRequest.set(host, Date.now());
}

export async function cachedFetch(url, { as = 'text', cacheName, headers = {} } = {}) {
  const name = cacheName ?? encodeURIComponent(url).slice(0, 200);
  const path = join(CACHE_DIR, name);
  if (existsSync(path)) {
    const buf = readFileSync(path);
    if (as === 'buffer') return buf;
    const text = buf.toString('utf8');
    return as === 'json' ? JSON.parse(text) : text;
  }
  const host = new URL(url).host;
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await politeGap(host);
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, redirect: 'follow' });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf);
      if (as === 'buffer') return buf;
      const text = buf.toString('utf8');
      return as === 'json' ? JSON.parse(text) : text;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await sleep(2000 * (attempt + 1));
    }
  }
  throw lastErr;
}
