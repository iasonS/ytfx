import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

// The quiz shipped once with every one of its rules present in style.css and a browser
// still drew it unstyled, because the browser had cached the previous stylesheet against
// the new markup. The cache side of that is fixed in index.js; this file guards the other
// half of the same failure — markup that names a class nothing styles.
const quizJs = readFileSync(new URL('../public/mhstats/quiz.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/mhstats/style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/mhstats/index.html', import.meta.url), 'utf8');

// Every quiz-* class the client can put in the DOM, read out of class attributes only —
// #quiz-guess and #quiz-code are element ids the script reaches for, not things CSS has to
// style. Conditionally concatenated classes are caught too, because the whole attribute
// value is scanned (`class="quiz-scale-pin${x.points ? ' scored' : ''}"`).
const used = [...new Set(
  [...quizJs.matchAll(/class="([^"]*)"/g)]
    .flatMap(m => [...m[1].matchAll(/\bquiz-[a-z0-9-]+/g)].map(c => c[0])),
)];

// A class is styled if it appears as a selector anywhere — on its own, or in a compound
// like `.quiz-scores.final li`.
const styled = name => new RegExp(`\\.${name}(?![a-z0-9-])`).test(css);

describe('mhstats quiz styles', () => {
  it('finds quiz classes to check', () => {
    expect(used.length).toBeGreaterThan(15);
  });

  it('styles every class the quiz puts on the page', () => {
    const unstyled = used.filter(n => !styled(n));
    expect(unstyled, `these classes are rendered but nothing in style.css matches them`).toEqual([]);
  });

  // The quiz reuses the duel's furniture rather than growing a second set of buttons.
  it('reuses the shared components it leans on', () => {
    for (const shared of ['btn', 'row', 'note', 'lead', 'room-code', 'invite', 'search', 'gen']) {
      expect(styled(shared), `.${shared} is used by the quiz but not styled`).toBe(true);
    }
  });

  it('keeps the quiz reachable from the masthead', () => {
    expect(html).toMatch(/data-nav="quiz"/);
  });

  // A fifth tab is what pushed the masthead past the width of a phone.
  it('keeps a narrow-screen rule for the masthead', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*560px\)/);
  });
});
