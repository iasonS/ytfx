import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

// The Dockerfile names the server files one by one rather than copying the tree, which
// keeps the image small but means a new module builds a perfectly healthy image that
// cannot start: `ERR_MODULE_NOT_FOUND ... imported from /app/index.js`, crash-looping on
// boot with every test and every CI check green. Adding mhstats-rooms.js was exactly that.
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');

const dockerfile = read('Dockerfile');
const entry = read('index.js');

// The COPY lines that place files at the image root.
const copied = new Set(
  dockerfile
    .split('\n')
    .filter(line => /^COPY\s/.test(line) && /\s\.\/\s*$/.test(line))
    .flatMap(line => line.replace(/^COPY\s+/, '').replace(/\s+\.\/\s*$/, '').trim().split(/\s+/)),
);

describe('Dockerfile', () => {
  it('copies every local module the server imports', () => {
    const local = [...entry.matchAll(/^import[^'"]*['"]\.\/([^'"]+)['"]/gm)].map(m => m[1]);
    expect(local.length, 'index.js should import at least one local module').toBeGreaterThan(0);
    for (const file of local) {
      expect(existsSync(new URL(file, root)), `${file} is imported but not in the repo`).toBe(true);
      expect(copied.has(file),
        `index.js imports ./${file}, but the Dockerfile never copies it, so the image cannot start`).toBe(true);
    }
  });

  it('does not promise to copy a file that no longer exists', () => {
    for (const file of copied) {
      if (file === 'package.json' || file === 'package-lock.json') continue;
      expect(existsSync(new URL(file, root)), `the Dockerfile copies ${file}, which is gone`).toBe(true);
    }
  });
});
