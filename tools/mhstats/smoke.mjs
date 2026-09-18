// Browser smoke test for /mhstats/. Needs a running server:
//   PORT=3999 node index.js &   then   node tools/mhstats/smoke.mjs
// Pass --shot to write screenshots to /tmp/mhstats-*.png for a visual review.
// MHSTATS_URL=https://xyyoutube.com/mhstats/ runs it against production.
import puppeteer from 'puppeteer';

const URL_BASE = process.env.MHSTATS_URL ?? 'http://localhost:3999/mhstats/';
const SHOT = process.argv.includes('--shot');
const fail = [];
const ok = [];
const check = (cond, label) => (cond ? ok : fail).push(label);
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  const missing = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('response', r => { if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`); });

  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });

  // The game IS the landing page: arriving deals a monster, no intro to read.
  await page.waitForSelector('.plate.spinning', { timeout: 10000 });
  check(true, 'arriving starts a run with the reel already spinning');
  check((await page.$$('h1')).length === 0, 'no headline or explainer stands in front of the game');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scroll at 390px (overflow ${overflow}px)`);
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-1-landing-mobile.png', fullPage: true });

  // The reel must actually cycle, and must lock the ledger while it does.
  const first = await page.$eval('.plate img', el => el.getAttribute('src'));
  await wait(500);
  const later = await page.$eval('.plate img', el => el.getAttribute('src'));
  check(first !== later, 'the reel cycles through monsters while spinning');
  check(await page.$$eval('.entry:not([disabled])', els => els.length) === 0,
    'stats cannot be taken while the reel spins');

  // Generation filter.
  const gens = await page.$$('.gen');
  check(gens.length === 6, `six generation tabs (found ${gens.length})`);
  await gens[0].click();
  await wait(120);
  check(await page.$$eval('.gen.on', els => els.length) === 5, 'a generation switches off');
  await (await page.$$('.gen'))[0].click();
  await wait(120);
  check(await page.$$eval('.gen.on', els => els.length) === 6, 'and back on');

  await page.waitForSelector('.plate.spinning');
  await page.click('.plate');
  await page.waitForSelector('.plate.settled');
  check(await page.$eval('.specimen .name', el => el.textContent.trim().length > 0), 'stopping names a monster');
  check(await page.$$eval('.entry:not([disabled])', els => els.length) === 7, 'seven stats open up');
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-2-settled.png', fullPage: true });

  // Play the run out, always taking the first free stat.
  for (let i = 0; i < 7; i++) {
    const open = await page.$$('.entry:not([disabled])');
    check(open.length === 7 - i, `monster ${i + 1} offers ${7 - i} free stats`);
    await open[0].click();
    await wait(90);
    if (i < 6) {
      await page.waitForSelector('.plate.spinning');
      await page.click('.plate');
      await page.waitForSelector('.plate.settled');
    }
  }

  await page.waitForSelector('.verdict-score b');
  const total = await page.$eval('.verdict-score b', el => parseInt(el.textContent, 10));
  const ceiling = await page.$eval(".range-best b", el => parseInt(el.textContent, 10));
  check(Number.isInteger(total) && total > 0, `the run scores (${total})`);
  check(ceiling >= total, `the best possible (${ceiling}) is at least the score (${total})`);
  check((await page.$$('table.sheet tbody tr')).length === 7, 'the result lists seven monsters');
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-3-result.png', fullPage: true });

  // Runs are kept, and a replay reproduces the score exactly.
  await page.reload({ waitUntil: 'networkidle0' });
  await page.click('[data-nav="runs"]');
  await page.waitForSelector('.records li');
  check((await page.$$('.records li')).length >= 1, 'the run was saved');

  await page.click('[data-act="replay"]');
  await page.waitForSelector('[data-act="replay-next"]');
  for (let i = 0; i < 20; i++) {
    const btn = await page.$('[data-act="replay-next"]');
    if (!btn) break;
    await btn.click();
    await wait(70);
  }
  await page.waitForSelector('.verdict-score b');
  const replayTotal = await page.$eval('.verdict-score b', el => parseInt(el.textContent, 10));
  check(replayTotal === total, `replay reproduces the score (${replayTotal} against ${total})`);

  // The monster table.
  await page.click('[data-nav="monsters"]');
  await page.waitForSelector('table.db tbody tr');
  const rows = await page.$$eval('table.db tbody tr', els => els.length);
  check(rows === 252, `the table lists every monster (${rows})`);
  const firstBefore = await page.$eval('table.db tbody tr td.col-name b', el => el.textContent);
  await page.click('table.db th[data-key="hp"]');
  await wait(120);
  const topHp = await page.$$eval('table.db tbody tr', els =>
    els.slice(0, 3).map(r => Number(r.children[2].textContent)));
  check(topHp[0] >= topHp[1] && topHp[1] >= topHp[2], `sorting by HP orders the column (${topHp.join(', ')})`);
  const firstAfter = await page.$eval('table.db tbody tr td.col-name b', el => el.textContent);
  check(firstBefore !== firstAfter, 'sorting actually reorders the table');

  // Resist and Temper are the pair a new player cannot tell apart, so the key has to say
  // which is status and which is aggression, and every header has to carry the same text.
  const key = await page.$$eval('.statkey > div', els =>
    els.map(d => [d.querySelector('dt').textContent, d.querySelector('dd').textContent]));
  check(key.length === 7, `the stat key explains all seven stats (${key.length})`);
  const resist = key.find(([t]) => t === 'Resist');
  const temper = key.find(([t]) => t === 'Temper');
  check(!!resist && /poison/i.test(resist[1]), 'Resist is explained as shrugging off status');
  check(!!temper && /aggressive/i.test(temper[1]), 'Temper is explained as aggression');
  const headerTip = await page.$eval('table.db th[data-key="wil"]', el => el.getAttribute('title'));
  check(headerTip === resist[1], 'the Resist column header carries the same explanation');
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-4-table.png', fullPage: true });

  // Desktop.
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await page.waitForSelector('.plate');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(wide <= 0, `no horizontal scroll at 1280px (overflow ${wide}px)`);
  if (SHOT) {
    await page.click('.plate');
    await page.waitForSelector('.plate.settled');
    await page.screenshot({ path: '/tmp/mhstats-5-round-desktop.png', fullPage: true });
  }

  const scriptErrors = errors.filter(e => !/Failed to load resource/.test(e));
  check(scriptErrors.length === 0, `no script errors${scriptErrors.length ? `: ${scriptErrors.slice(0, 3).join(' | ')}` : ''}`);
  const unexpected = missing.filter(u => !/favicon\.ico/.test(u));
  check(unexpected.length === 0, `no failed requests${unexpected.length ? `: ${unexpected.slice(0, 3).join(' | ')}` : ''}`);
} finally {
  await browser.close();
}

for (const line of ok) console.log(`  ok   ${line}`);
for (const line of fail) console.log(`  FAIL ${line}`);
console.log(`\n${ok.length} passed, ${fail.length} failed`);
process.exit(fail.length ? 1 : 0);
