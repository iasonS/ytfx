// Browser smoke test for /mhstats/. Needs a running server:
//   PORT=3999 node index.js &   then   node tools/mhstats/smoke.mjs
// Pass --shot to also write screenshots to /tmp/mhstats-*.png for a visual review.
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

  check(await page.$eval('h1', el => el.textContent.trim().length > 0), 'guide renders');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(overflow <= 0, `no horizontal scroll at 390px (overflow ${overflow}px)`);
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-1-home-mobile.png', fullPage: true });

  // Generation filter narrows the pool.
  const gens = await page.$$('.gen');
  check(gens.length === 6, `six generation tabs (found ${gens.length})`);
  const poolBefore = await page.$eval('.note', el => parseInt(el.textContent, 10));
  await gens[0].click();
  await wait(80);
  const poolAfter = await page.$eval('.note', el => parseInt(el.textContent, 10));
  check(poolAfter < poolBefore, `deselecting a generation shrinks the pool (${poolBefore} to ${poolAfter})`);
  await (await page.$$('.gen'))[0].click();
  await wait(80);
  check(await page.$$eval('.gen.on', els => els.length) === 6, 'generation restored');

  await page.click('[data-act="play"]');
  await page.waitForSelector('.plate.spinning');
  check(true, 'the reel starts spinning');

  // The reel must actually cycle images before it is stopped.
  const first = await page.$eval('.plate img', el => el.getAttribute('src'));
  await wait(400);
  const later = await page.$eval('.plate img', el => el.getAttribute('src'));
  check(first !== later, 'the reel cycles through monsters while spinning');
  check(await page.$$eval('.entry:not([disabled])', els => els.length) === 0,
    'attributes cannot be assigned while the reel spins');
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-2-spinning.png', fullPage: true });

  await page.click('.plate');
  await page.waitForSelector('.plate.settled');
  check(await page.$eval('.specimen .name', el => el.textContent.trim().length > 0), 'a specimen is named on stop');
  check(await page.$$eval('.entry:not([disabled])', els => els.length) === 7, 'seven attributes open for assignment');
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-3-settled.png', fullPage: true });

  // Play the whole entry, always taking the first free attribute.
  for (let i = 0; i < 7; i++) {
    const open = await page.$$('.entry:not([disabled])');
    check(open.length === 7 - i, `specimen ${i + 1} offers ${7 - i} free attributes`);
    await open[0].click();
    await wait(90);
    if (i < 6) {
      await page.waitForSelector('.plate.spinning');
      await page.click('.plate');
      await page.waitForSelector('.plate.settled');
    }
  }

  await page.waitForSelector('.verdict .score');
  const total = await page.$eval('.verdict .score', el => parseInt(el.textContent, 10));
  const ceiling = await page.$eval('.ceiling .big', el => parseInt(el.textContent, 10));
  check(Number.isInteger(total) && total > 0, `the entry scores (${total})`);
  check(ceiling >= total, `the best possible (${ceiling}) is at least the score (${total})`);
  check((await page.$$('table.sheet tbody tr')).length === 7, 'the sheet lists seven monsters');
  if (SHOT) await page.screenshot({ path: '/tmp/mhstats-4-result.png', fullPage: true });

  // Records survive a reload and replay reproduces the score.
  await page.reload({ waitUntil: 'networkidle0' });
  const records = await page.$$eval('.records li', els => els.map(e => e.textContent));
  check(records.length >= 1, 'the entry was kept in records');

  await page.click('[data-act="replay"]');
  await page.waitForSelector('[data-act="replay-next"]');
  for (let i = 0; i < 20; i++) {
    const btn = await page.$('[data-act="replay-next"]');
    if (!btn) break;
    await btn.click();
    await wait(70);
  }
  await page.waitForSelector('.verdict .score');
  const replayTotal = await page.$eval('.verdict .score', el => parseInt(el.textContent, 10));
  check(replayTotal === total, `replay reproduces the score (${replayTotal} against ${total})`);

  // Desktop.
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.goto(URL_BASE, { waitUntil: 'networkidle0' });
  const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(wide <= 0, `no horizontal scroll at 1280px (overflow ${wide}px)`);
  if (SHOT) {
    await page.screenshot({ path: '/tmp/mhstats-5-home-desktop.png', fullPage: true });
    await page.click('[data-act="play"]');
    await page.waitForSelector('.plate.spinning');
    await page.click('.plate');
    await page.waitForSelector('.plate.settled');
    await page.screenshot({ path: '/tmp/mhstats-6-round-desktop.png', fullPage: true });
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
