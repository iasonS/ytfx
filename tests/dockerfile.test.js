import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';

// The Dockerfile names the server files one by one rather than copying the tree, which
// keeps the image small but means a new module builds a perfectly healthy image that
// cannot start: `ERR_MODULE_NOT_FOUND ... imported from /app/index.js`, crash-looping on
// boot with every test and every CI check green. Adding mhstats-rooms.js was exactly that,
// and it took the whole site down.
//
// The walk is TRANSITIVE. An earlier version of this test read only index.js's own imports,
// which would have missed mhstats-quiz-bank.js — imported by mhstats-quiz.js, two steps from
// the entry point, and just as fatal when absent.
const root = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');

const dockerfile = read('Dockerfile');

// The COPY lines that place files at the image root.
const copied = new Set(
  dockerfile
    .split('\n')
    .filter(line => /^COPY\s/.test(line) && /\s\.\/\s*$/.test(line))
    .flatMap(line => line.replace(/^COPY\s+/, '').replace(/\s+\.\/\s*$/, '').trim().split(/\s+/)),
);

// Every local module reachable from the entry point, following imports as far as they go.
function reachableFrom(entry) {
  const seen = new Set();
  const missing = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    if (!existsSync(new URL(file, root))) { missing.push(file); continue; }
    const source = read(file);
    // Static `import ... from './x.js'` and `export ... from './x.js'`, root-level only:
    // anything under a directory is not copied by these COPY lines anyway.
    const specifiers = [...source.matchAll(/^(?:import|export)[^'"\n]*from\s*['"]\.\/([^'"]+)['"]/gm)]
      .map(m => m[1])
      .filter(name => !name.includes('/'));
    queue.push(...specifiers);
  }
  seen.delete(entry);
  return { modules: [...seen], missing };
}

describe('Dockerfile', () => {
  it('copies every local module the server can reach, however deep', () => {
    const { modules, missing } = reachableFrom('index.js');
    expect(missing, 'imported but not in the repo').toEqual([]);
    expect(modules.length, 'index.js should reach at least one local module').toBeGreaterThan(0);
    for (const file of modules) {
      expect(copied.has(file),
        `the server reaches ./${file}, but the Dockerfile never copies it, so the image cannot start`).toBe(true);
    }
  });

  it('reaches the modules we expect it to', () => {
    const { modules } = reachableFrom('index.js');
    // A guard on the guard: if the import walk silently stopped working, this catches it.
    // mhstats-quiz-bank.js is only reachable through mhstats-quiz.js, so its presence here
    // is what proves the walk is still transitive.
    expect(modules).toContain('mhstats-rooms.js');
    expect(modules).toContain('mhstats-quiz.js');
    expect(modules).toContain('mhstats-quiz-bank.js');
  });

  it('does not promise to copy a file that no longer exists', () => {
    for (const file of copied) {
      if (file === 'package.json' || file === 'package-lock.json') continue;
      expect(existsSync(new URL(file, root)), `the Dockerfile copies ${file}, which is gone`).toBe(true);
    }
  });
});
