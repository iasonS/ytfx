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

  // The plate clips what overflows it, so a render taller than its 4:3 box loses its body.
  // Measured against the tallest portrait in the deck rather than whatever was drawn.
  const fit = await page.evaluate(async () => {
    const img = document.querySelector('.plate img');
    img.src = 'img/great-izuchi.webp';
    await img.decode().catch(() => {});
    const i = img.getBoundingClientRect(), p = document.querySelector('.plate').getBoundingClientRect();
    return { over: Math.round(Math.max(i.bottom - p.bottom, p.top - i.top, i.right - p.right, p.left - i.left)) };
  });
  check(fit.over <= 0, `a tall portrait render stays inside the plate (worst edge ${fit.over}px)`);
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
  // Resist is a sum, so the number alone cannot say which statuses a monster shrugs off.
  // Fatalis has no stun row at all in World's table, which IS the reason it scores high.
  const resistDetails = await page.evaluate(() => {
    const pick = name => {
      const row = [...document.querySelectorAll('table.db tbody tr')]
        .find(tr => tr.querySelector('td.col-name b')?.textContent === name);
      return row?.querySelector('td.has-detail')?.getAttribute('title') ?? '';
    };
    return { fatalis: pick('Fatalis'), rathalos: pick('Rathalos'), zorah: pick('Zorah Magdaros') };
  });
  check(/cannot be stunned/i.test(resistDetails.fatalis),
    `Fatalis's Resist names the status it is immune to ("${resistDetails.fatalis.slice(0, 40)}")`);
  check(/Poison \d+ .* Stun \d+/.test(resistDetails.rathalos),
    'a fully-recorded monster breaks its Resist into all four figures');
  check(/cannot be poisoned, paralysed, slept or stunned/i.test(resistDetails.zorah),
    'a status-immune monster says so in plain words');

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

  // Play a whole run: stop the reel, take a free stat, seven times.
  const takeOne = async (pg, nth = 0) => {
    await pg.waitForSelector('.plate.spinning', { timeout: 8000 });
    await pg.click('.plate');
    await pg.waitForSelector('.plate.settled', { timeout: 8000 });
    await wait(80);
    await pg.evaluate(n => {
      const free = [...document.querySelectorAll('.entry:not(.filled):not([disabled])')];
      free[n % free.length].click();
    }, nth);
    await wait(120);
  };
  const playOut = async (pg, offset = 0) => {
    for (let i = 0; i < 7; i++) await takeOne(pg, offset + i);
    await pg.waitForSelector('.verdict-score b', { timeout: 8000 });
  };

  // ---- a shared result link ----------------------------------------------------
  // It used to drop you into a step-through that looked exactly like a new game, so a
  // shared link read as "it just opens the page". It has to show the finished run.
  const solo = await (await browser.createBrowserContext()).newPage();
  await solo.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await solo.waitForSelector('[data-act="aim"][data-aim="l"]');
  await solo.click('[data-act="aim"][data-aim="l"]');     // aim LOW, the inverted game
  await wait(250);
  await playOut(solo, 0);
  const theirs = await solo.evaluate(() => ({
    score: +document.querySelector('.verdict-score b').textContent,
    aimText: document.querySelector('.verdict-score span').textContent,
    resultUrl: document.querySelector('[data-url*="?r="]')?.dataset.url ?? '',
  }));
  check(/aiming low/.test(theirs.aimText), `a run aiming low says so (${theirs.aimText})`);

  const viewer = await (await browser.createBrowserContext()).newPage();
  await viewer.goto(theirs.resultUrl, { waitUntil: 'networkidle0' });
  await wait(500);
  const shared = await viewer.evaluate(() => ({
    score: +(document.querySelector('.verdict-score b')?.textContent ?? 0),
    banner: document.querySelector('.duel-verdict')?.textContent?.trim() ?? '',
    spinning: !!document.querySelector('.plate.spinning'),
  }));
  check(shared.score === theirs.score,
    `a result link shows the shared score on arrival (${shared.score} against ${theirs.score})`);
  check(!shared.spinning, 'a result link does not open into a fresh spinning game');
  check(/run/i.test(shared.banner), `a result link says whose run it is ("${shared.banner}")`);

  // ---- a live duel, two browsers at once -----------------------------------------
  // The server exists for one reason: a browser cannot be trusted to hide the opponent's
  // score. So the interesting assertions are the negative ones, taken while one player has
  // finished and the other has not.
  const host = await (await browser.createBrowserContext()).newPage();
  await host.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await host.click('[data-nav="duel"]');
  await wait(300);
  await host.click('[data-act="room-create"]');
  await host.waitForSelector('.room-code', { timeout: 10000 });
  const code = await host.$eval('.room-code', e => e.textContent.trim());
  const roomUrl = await host.$eval('[data-act="copy"]', e => e.dataset.url);
  check(/^[A-Z0-9]{4}$/.test(code), `a room gets a four-character code (${code})`);
  check(!/[O0I1]/.test(code), `the code leaves out the confusable characters (${code})`);

  const guest = await (await browser.createBrowserContext()).newPage();
  await guest.goto(roomUrl, { waitUntil: 'networkidle0' });
  const guestDealt = await guest.waitForSelector('.plate', { timeout: 12000 }).then(() => true).catch(() => false);
  check(guestDealt, 'joining by link deals the guest a board');
  const hostDealt = await host.waitForSelector('.plate', { timeout: 12000 }).then(() => true).catch(() => false);
  check(hostDealt, 'the host starts too, without needing a refresh');

  const sameSeven = await Promise.all([host, guest].map(pg =>
    pg.$eval('.plate img', el => el.getAttribute('src'))));
  check(!!sameSeven[0], 'both players are looking at a monster');

  for (let i = 0; i < 3; i++) await takeOne(guest, 0);
  await wait(2400);
  const midway = await host.evaluate(() => ({
    pips: document.querySelectorAll('.pip.on').length,
    state: document.querySelector('.rival-state')?.textContent ?? '',
    scoreShown: !!document.querySelector('.duel-line, .duel-verdict'),
  }));
  check(midway.pips === 3, `the opponent's progress shows as pips (${midway.pips} of 3)`);
  check(/3 of 7/.test(midway.state), `and in words (${midway.state})`);
  check(!midway.scoreShown, 'but their score is not shown while they are still picking');

  for (let i = 0; i < 4; i++) await takeOne(guest, 0);
  await wait(2400);
  const guestDone = await host.evaluate(() => ({
    state: document.querySelector('.rival-state')?.textContent ?? '',
    revealed: !!document.querySelector('.duel-verdict'),
  }));
  check(/finished/.test(guestDone.state), `a finished opponent says so (${guestDone.state})`);
  check(!guestDone.revealed,
    'their score is STILL hidden once they finish, until you finish too');
  const waiting = await guest.evaluate(() => ({
    heading: document.querySelector('h1')?.textContent ?? '',
    revealed: !!document.querySelector('.duel-verdict'),
  }));
  check(/Waiting/.test(waiting.heading), `the finished player waits (${waiting.heading})`);
  check(!waiting.revealed, 'and cannot see the result before the other is done either');

  for (let i = 0; i < 7; i++) await takeOne(host, 3);
  await wait(3000);
  const readEnd = pg => pg.evaluate(() => ({
    verdict: document.querySelector('.duel-verdict')?.textContent?.trim() ?? '',
    lines: [...document.querySelectorAll('.duel-line')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
  }));
  const hostEnd = await readEnd(host);
  const guestEnd = await readEnd(guest);
  check(/You win|They win|A draw/.test(hostEnd.verdict), `the host sees a verdict (${hostEnd.verdict})`);
  check(/You win|They win|A draw/.test(guestEnd.verdict), `the guest sees one too (${guestEnd.verdict})`);
  // Each side reads it from their own seat, so the two verdicts must be opposites.
  const opposite = (hostEnd.verdict === 'A draw' && guestEnd.verdict === 'A draw')
    || (hostEnd.verdict === 'You win' && guestEnd.verdict === 'They win')
    || (hostEnd.verdict === 'They win' && guestEnd.verdict === 'You win');
  check(opposite, `the two screens agree who won (${hostEnd.verdict} / ${guestEnd.verdict})`);
  const nums = t => (t.match(/\d+/g) ?? []).map(Number).sort((a, b) => a - b);
  check(JSON.stringify(nums(hostEnd.lines.join(' '))) === JSON.stringify(nums(guestEnd.lines.join(' '))),
    `and on the two scores (${hostEnd.lines.join(' / ')} | ${guestEnd.lines.join(' / ')})`);

  // A code nobody created must fail cleanly rather than hang on a board.
  const lost = await (await browser.createBrowserContext()).newPage();
  await lost.goto(`${URL_BASE}?room=ZZZZ`, { waitUntil: 'networkidle0' });
  await wait(1200);
  check(!(await lost.$('.plate')), 'an unknown room code does not deal a board');

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
