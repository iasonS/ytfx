// Browser smoke test for /mhstats/. Not part of the vitest suite: it needs a
// running server. Usage: PORT=3999 node index.js &  then  node tools/mhstats/smoke.mjs
import puppeteer from 'puppeteer';

const URL_BASE = process.env.MHSTATS_URL ?? 'http://localhost:3999/mhstats/';
const fail = [];
const ok = [];
const check = (cond, label) => (cond ? ok : fail).push(label);

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];    // real script failures
  const missing = [];   // resources that 404/400: expected before the images task runs,
                        // plus /favicon.ico, which ytfx's /:id catch-all answers with 400
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('requestfailed', r => missing.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });

  await page.setViewport({ width: 360, height: 740 });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });

  check(await page.$eval('h1', el => el.textContent.includes('Build your own monster')), 'home renders');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scroll at 360px (overflow ${overflow}px)`);

  // Generation filter: six chips, all on by default, and turning some off narrows the pool.
  const chips = await page.$$('.chip');
  check(chips.length === 6, `six generation chips (found ${chips.length})`);
  const allOn = await page.$$eval('.chip.on', els => els.length);
  check(allOn === 6, `every generation selected by default (${allOn}/6)`);
  const poolBefore = await page.$eval('.note', el => parseInt(el.textContent, 10));
  await chips[0].click();
  await new Promise(r => setTimeout(r, 80));
  const poolAfter = await page.$eval('.note', el => parseInt(el.textContent, 10));
  check(poolAfter < poolBefore, `turning a generation off shrinks the pool (${poolBefore} -> ${poolAfter})`);
  const onAfter = await page.$$eval('.chip.on', els => els.length);
  check(onAfter === 5, `chip turned off (${onAfter}/6 on)`);
  // Restore every generation before playing, so the run below draws from the full deck.
  await (await page.$$('.chip'))[0].click();
  await new Promise(r => setTimeout(r, 80));
  check(await page.$$eval('.chip.on', els => els.length) === 6, 'generation restored');

  await page.click('[data-act="play"]');
  await page.waitForSelector('.slots');
  check((await page.$$('.slot')).length === 7, 'seven slots on the round screen');
  check(await page.$eval('.monster .name', el => el.textContent.trim().length > 0), 'monster named');

  // Play a whole run, always taking the first free slot.
  const values = [];
  for (let i = 0; i < 7; i++) {
    const free = await page.$$('.slot[data-act="pick"]');
    check(free.length === 7 - i, `round ${i + 1} offers ${7 - i} free slots`);
    await free[0].click();
    await new Promise(r => setTimeout(r, 60));
    if (i < 6) {
      const filled = await page.$$eval('.slot[disabled] .value', els => els.map(e => Number(e.textContent)));
      values.push(filled[filled.length - 1]);
    }
  }

  await page.waitForSelector('.total');
  const total = await page.$eval('.total', el => parseInt(el.textContent, 10));
  const kpis = await page.$$eval('.kpi .n', els => els.map(e => parseInt(e.textContent, 10)));
  check(Number.isInteger(total) && total > 0, `end screen shows a total (${total})`);
  check(kpis[0] >= total, `best possible (${kpis[0]}) is at least the run total (${total})`);
  check(kpis[2] <= total, `worst possible (${kpis[2]}) is at most the run total (${total})`);
  check((await page.$$('.sheet tbody tr')).length === 7, 'sheet lists seven monsters');
  const bestNote = await page.$eval('.note', el => el.textContent);
  check(/highest total these seven monsters could have reached/i.test(bestNote),
    'end screen states the best possible total for the drawn seven');

  // The run must survive a reload via localStorage.
  await page.reload({ waitUntil: 'networkidle0' });
  const stored = await page.$$eval('.runs li', els => els.map(e => e.textContent));
  check(stored.length >= 1 && !stored[0].includes('No runs yet'), 'run persisted to top runs');

  // Replay steps through the stored run and lands on its end screen.
  await page.click('[data-act="replay"]');
  await page.waitForSelector('[data-act="replay-next"]');
  for (let i = 0; i < 7; i++) {
    const btn = await page.$('[data-act="replay-next"]');
    if (!btn) break;
    await btn.click();
    await new Promise(r => setTimeout(r, 60));
  }
  await page.waitForSelector('.total');
  const replayTotal = await page.$eval('.total', el => parseInt(el.textContent, 10));
  check(replayTotal === total, `replay reproduces the score (${replayTotal} vs ${total})`);

  // Desktop width keeps the sheet readable.
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });
  const wideOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(wideOverflow <= 0, `no horizontal scroll at 1280px (overflow ${wideOverflow}px)`);

  const scriptErrors = errors.filter(e => !/Failed to load resource/.test(e));
  check(scriptErrors.length === 0,
    `no script errors${scriptErrors.length ? `: ${scriptErrors.slice(0, 3).join(' | ')}` : ''}`);

  const unexpected = missing.filter(u => !/\/mhstats\/img\/|favicon\.ico/.test(u));
  check(unexpected.length === 0,
    `no unexpected failed requests${unexpected.length ? `: ${unexpected.slice(0, 3).join(' | ')}` : ''}`);
  if (missing.length) {
    console.log(`  note  ${missing.length} expected missing resources (monster renders not built yet, favicon)`);
  }
} finally {
  await browser.close();
}

for (const line of ok) console.log(`  ok   ${line}`);
for (const line of fail) console.log(`  FAIL ${line}`);
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
