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

  // ---- the rematch ---------------------------------------------------------------
  // It restarts only once BOTH have asked, so one player cannot pull the result screen out
  // from under the other before they have read it.
  const askAgain = pg => pg.evaluate(() => ({
    label: document.querySelector('[data-act="room-again"]')?.textContent?.trim() ?? '',
    disabled: document.querySelector('[data-act="room-again"]')?.disabled ?? null,
  }));

  const offered = await askAgain(host);
  check(/Duel again/.test(offered.label), `the result offers another duel (${offered.label})`);

  await host.click('[data-act="room-again"]');
  await wait(2600);
  const asked = await askAgain(host);
  const told = await askAgain(guest);
  check(asked.disabled === true, `the asker waits (${asked.label})`);
  check(/want another|accept/i.test(told.label), `the other player is told (${told.label})`);
  check(!!(await guest.$('.verdict-score b')),
    'and is NOT pulled off the result before accepting');
  check(!!(await host.$('.verdict-score b')),
    'the asker keeps reading the result too, until it is accepted');

  await guest.click('[data-act="room-again"]');
  await wait(3200);
  const second = await Promise.all([host, guest].map(pg => pg.evaluate(() => ({
    board: !!document.querySelector('.plate'),
    stillResult: !!document.querySelector('.verdict-score b'),
    picked: document.querySelectorAll('.entry.filled').length,
  }))));
  check(second[0].board && second[1].board, 'accepting deals both players a fresh seven');
  check(!second[0].stillResult && !second[1].stillResult, 'and clears the old result from both');
  check(second[0].picked === 0 && second[1].picked === 0, 'with nobody carrying picks over');

  // ---- the reroll ----------------------------------------------------------------
  // One per run. It swaps the monster on the table for a reserve dealt up front, so the
  // run stays reproducible from its seed plus the position the reroll was spent on.
  const solo2 = await (await browser.createBrowserContext()).newPage();
  await solo2.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await solo2.waitForSelector('.plate.spinning');
  await solo2.click('.plate');
  await solo2.waitForSelector('.plate.settled');
  await wait(150);
  const before = await solo2.$eval('.specimen .name', e => e.textContent.trim());
  check(!!(await solo2.$('[data-act="reroll"]')), 'a fresh run offers a reroll');
  await solo2.click('[data-act="reroll"]');
  await solo2.waitForSelector('.plate.spinning', { timeout: 6000 });
  await solo2.click('.plate');
  await solo2.waitForSelector('.plate.settled');
  await wait(150);
  const after = await solo2.$eval('.specimen .name', e => e.textContent.trim());
  check(after !== before, `the reroll changes the monster (${before} -> ${after})`);
  check(!(await solo2.$('[data-act="reroll"]')), 'and cannot be spent twice');
  check(!!(await solo2.$('.spent')), 'the spent reroll says so');

  // The share code has to carry the reroll, or the link rebuilds a different seven and the
  // picks stop describing the run that was played.
  await solo2.evaluate(() => {
    const free = [...document.querySelectorAll('.entry:not(.filled):not([disabled])')];
    free[0].click();
  });
  await wait(150);
  for (let i = 0; i < 6; i++) await takeOne(solo2, 0);
  await solo2.waitForSelector('.verdict-score b', { timeout: 8000 });
  const rerolled = await solo2.evaluate(() => ({
    score: +document.querySelector('.verdict-score b').textContent,
    url: document.querySelector('[data-url*="?r="]').dataset.url,
    monsters: [...document.querySelectorAll('table.sheet td.col-name b')].map(e => e.textContent),
  }));
  const rerollViewer = await (await browser.createBrowserContext()).newPage();
  await rerollViewer.goto(rerolled.url, { waitUntil: 'networkidle0' });
  await wait(500);
  const rebuilt = await rerollViewer.evaluate(() => ({
    score: +(document.querySelector('.verdict-score b')?.textContent ?? 0),
    monsters: [...document.querySelectorAll('table.sheet td.col-name b')].map(e => e.textContent),
  }));
  check(rebuilt.score === rerolled.score,
    `a rerolled run survives its share link (${rebuilt.score} against ${rerolled.score})`);
  check(JSON.stringify(rebuilt.monsters) === JSON.stringify(rerolled.monsters),
    'and rebuilds the same seven it was actually played against');

  // ---- a room that deals each player their own seven --------------------------------
  const rHost = await (await browser.createBrowserContext()).newPage();
  await rHost.goto(URL_BASE, { waitUntil: 'networkidle0' });
  await rHost.click('[data-nav="duel"]');
  await wait(300);
  await rHost.click('[data-act="room-draw"][data-draw="r"]');
  await wait(300);
  await rHost.click('[data-act="room-create"]');
  await rHost.waitForSelector('.room-code', { timeout: 9000 });
  const rLink = await rHost.$eval('[data-act="copy"]', e => e.dataset.url);
  const rGuest = await (await browser.createBrowserContext()).newPage();
  await rGuest.goto(rLink, { waitUntil: 'networkidle0' });
  await rGuest.waitForSelector('.plate', { timeout: 12000 });
  await rHost.waitForSelector('.plate', { timeout: 12000 });
  const boards = await Promise.all([rHost, rGuest].map(pg =>
    pg.$eval('.specimen .name, .specimen .placeholder', e => e.textContent.trim()).catch(() => '')));
  check(true, `a random room deals two boards (${boards.join(' | ')})`);

  // takeOne, not playOut: finishing a duel lands on the waiting screen, not a verdict.
  for (let i = 0; i < 7; i++) await takeOne(rGuest, i);
  for (let i = 0; i < 7; i++) await takeOne(rHost, i + 3);
  await wait(3200);
  const rEnd = await rHost.evaluate(() => ({
    verdict: document.querySelector('.duel-verdict')?.textContent?.trim() ?? '',
    lines: [...document.querySelectorAll('.duel-line')].map(e => e.textContent.replace(/\s+/g, ' ').trim()),
    note: document.querySelector('.duel-note')?.textContent?.trim() ?? '',
    theirPicksOnMySheet: document.querySelectorAll('table.sheet td.theirs').length,
  }));
  check(rEnd.lines.every(l => /%/.test(l)),
    `a random room is settled on percentages, not totals (${rEnd.lines.join(' / ')})`);
  check(/your own seven/i.test(rEnd.note), `and says why (${rEnd.note})`);
  check(rEnd.theirPicksOnMySheet === 0,
    'their picks are not drawn on your sheet, because they never faced your monsters');

  // ---- the quiz lobby, three browsers at once -------------------------------------
  // Same shape of assertion as the duel: the interesting ones are negative, taken while a
  // question is open and one player has answered.
  const qHost = await (await browser.createBrowserContext()).newPage();
  await qHost.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await qHost.goto(URL_BASE, { waitUntil: 'networkidle0' });
  // A fifth nav tab is what broke the masthead at phone width, so the check lives here.
  const navFits = await qHost.evaluate(() => {
    const el = document.documentElement;
    return { over: el.scrollWidth - el.clientWidth, lines: document.querySelector('.wordmark').getClientRects().length };
  });
  check(navFits.over <= 0, `the quiz tab does not push the page sideways at 390px (overflow ${navFits.over}px)`);
  check(navFits.lines === 1, `the wordmark still fits on one line (${navFits.lines})`);
  await qHost.click('[data-nav="quiz"]');
  await qHost.waitForSelector('[data-quiz="create"]', { timeout: 10000 });
  check(await qHost.$eval('[data-quiz="cat"][data-cat="both"]', e => e.classList.contains('on')),
    'a new lobby defaults to both kinds of question');
  // Pick the category BEFORE typing: switching category re-renders the form.
  await qHost.click('[data-quiz="cat"][data-cat="mh"]');
  await qHost.type('#quiz-name', 'Host');
  check(await qHost.$eval('[data-quiz="cat"][data-cat="mh"]', e => e.classList.contains('on')),
    'picking a category sticks');
  await qHost.click('[data-quiz="cat"][data-cat="mh"]');
  check(await qHost.$eval('#quiz-name', e => e.value) === 'Host',
    'and changing category does not wipe the name you typed');
  await qHost.click('[data-quiz="create"]');
  await qHost.waitForSelector('.room-code', { timeout: 10000 });
  const qCode = await qHost.$eval('.room-code', e => e.textContent.trim());
  const qUrl = await qHost.$eval('[data-quiz="copy"]', e => e.dataset.url);
  check(/^[A-Z0-9]{4}$/.test(qCode), `a quiz lobby gets a four-character code (${qCode})`);
  check(!/[O0I1]/.test(qCode), `the quiz code leaves out the confusable characters (${qCode})`);

  // The bank must not be reachable from the browser at all: a client that can fetch it
  // holds every answer in the game.
  const bankStatus = await qHost.evaluate(async () => {
    const tries = ['./mhstats-quiz-bank.js', '../mhstats-quiz-bank.js', './quiz-bank.json'];
    const codes = [];
    for (const u of tries) {
      try { codes.push((await fetch(u)).status); } catch { codes.push(0); }
    }
    return codes;
  });
  check(bankStatus.every(s => s !== 200), `the question bank is not served to the browser (${bankStatus.join('/')})`);

  const players = [];
  for (const who of ['Bee', 'Cee']) {
    const pg = await (await browser.createBrowserContext()).newPage();
    await pg.goto(qUrl, { waitUntil: 'networkidle0' });
    await pg.waitForSelector('#quiz-name', { timeout: 10000 });
    await pg.type('#quiz-name', who);
    await pg.click('[data-quiz="join"]');
    await pg.waitForSelector('.quiz-players', { timeout: 10000 });
    players.push(pg);
  }
  await wait(2000);
  const seated = await qHost.$$eval('.quiz-players li', els => els.length);
  check(seated === 3, `all three are in the lobby (${seated})`);
  check(!(await players[0].$('[data-quiz="start"]')), 'a guest is not offered the start button');
  check(!!(await qHost.$('[data-quiz="start"]')), 'the host is');

  // Answer whatever kind of question is on screen.
  //
  // Waiting on an INPUT rather than on .quiz-q matters: the reveal screen shows the question
  // too, so waiting for the text would try to answer one that has already closed. The click
  // happens inside the page because the poll repaints every 1.5s, and a handle taken in the
  // test can go stale between finding the button and pressing it.
  // `pick` chooses WHICH option this player takes, so the three players answer differently
  // and the reveal is a real spread rather than three identical guesses.
  const answerQuiz = async (pg, guess, pick = 0) => {
    await pg.waitForSelector('.quiz-option, #quiz-guess', { timeout: 25000 });
    for (let attempt = 0; attempt < 8; attempt++) {
      const acted = await pg.evaluate((v, p) => {
        const options = document.querySelectorAll('.quiz-option');
        if (options.length) { options[Math.min(p, options.length - 1)].click(); return true; }
        const box = document.getElementById('quiz-guess');
        const lock = document.querySelector('[data-quiz="guess"]');
        if (box && lock) { box.value = String(v); lock.click(); return true; }
        return false;      // mid-repaint, or already answered
      }, guess, pick);
      if (acted) {
        // Registered when the screen says so, or when the question closed on the answer.
        const landed = await pg.waitForSelector('.quiz-locked, .quiz-answer', { timeout: 4000 })
          .then(() => true).catch(() => false);
        if (landed) return;
      }
      if (await pg.$('.quiz-locked, .quiz-answer, .quiz-scores.final')) return;
      await wait(400);
    }
    throw new Error('could not get an answer in');
  };

  await qHost.click('[data-quiz="start"]');
  await qHost.waitForSelector('.quiz-q', { timeout: 10000 });
  const firstQ = await qHost.$eval('.quiz-q', e => e.textContent.trim());
  check(firstQ.length > 10, `the first question is asked (${firstQ.slice(0, 48)}...)`);
  check(!!(await qHost.$('.quiz-bar-fill')), 'a countdown bar is running');
  check(!(await qHost.$('.quiz-answer')), 'the correct answer is not on screen while the question is open');

  const firstKind = await qHost.evaluate(() => (document.getElementById('quiz-guess') ? 'estimate' : 'choice'));

  // One player answers; the other two must learn nothing but that they did.
  await answerQuiz(players[0], 11, 1);
  await wait(2200);
  const midQuiz = await qHost.evaluate(() => ({
    revealed: !!document.querySelector('.quiz-answer'),
    said: document.querySelectorAll('.quiz-said').length,
    locked: (document.getElementById('quiz-locked') || {}).textContent || '',
  }));
  check(!midQuiz.revealed, 'one player answering does not reveal the answer to the others');
  check(midQuiz.said === 0, 'nobody else\'s guess is drawn while the question is open');
  check(/1 of 3/.test(midQuiz.locked), `the others only see that somebody locked in (${midQuiz.locked.trim()})`);

  await answerQuiz(qHost, 22, 0);
  await answerQuiz(players[1], 33, 2);
  await qHost.waitForSelector('.quiz-answer', { timeout: 12000 });
  check(true, 'everybody answering closes the question early');
  const revealed = await qHost.evaluate(() => ({
    answer: (document.querySelector('.quiz-answer') || {}).textContent || '',
    said: document.querySelectorAll('.quiz-results li').length,
    src: !!document.querySelector('.quiz-src'),
    scored: document.querySelectorAll('.quiz-results li.scored').length,
  }));
  check(revealed.answer.trim().length > 0, `the answer is shown (${revealed.answer.trim().slice(0, 30)})`);
  check(revealed.said === 3, `all three guesses are laid out (${revealed.said})`);
  check(revealed.src, 'and where the fact came from');
  // Deterministic because the three players deliberately answered differently. On an
  // estimate, three different guesses are three different distances, so all three take one
  // of the paying places. On a choice, three different options means at most one is right.
  check(firstKind === 'estimate' ? revealed.scored === 3 : revealed.scored <= 1,
    `a ${firstKind} pays the right number of players (${revealed.scored} of 3 scored)`);
  const revealFits = await qHost.evaluate(() => {
    const el = document.documentElement;
    return { over: el.scrollWidth - el.clientWidth, raw: /\.json:/.test(document.body.textContent) };
  });
  check(revealFits.over <= 0, `the reveal fits a phone (overflow ${revealFits.over}px)`);
  check(!revealFits.raw, 'the source reads as words, not as a path into our own data files');

  // Play the rest out. Every question closes as soon as all three are in, so this is paced
  // by the reveal rather than the 25-second timer.
  for (let round = 2; round <= 10; round += 1) {
    await Promise.all([
      answerQuiz(qHost, 10 * round),
      answerQuiz(players[0], 10 * round + 1),
      answerQuiz(players[1], 10 * round + 2),
    ]);
  }
  const finished = await qHost.waitForSelector('.quiz-scores.final', { timeout: 30000 })
    .then(() => true).catch(() => false);
  check(finished, 'ten questions in, the quiz ends on a final table');
  if (finished) {
    const final = await qHost.evaluate(() => ({
      rows: document.querySelectorAll('.quiz-scores.final li').length,
      top: (document.querySelector('.quiz-scores.final .quiz-pts') || {}).textContent || '',
      again: !!document.querySelector('[data-quiz="again"]'),
    }));
    check(final.rows === 3, `the final table ranks all three (${final.rows})`);
    check(Number(final.top) > 0, `the winner scored something (${final.top})`);
    check(final.again, 'and the host is offered another');
    const guestAgain = await players[0].$('[data-quiz="again"]');
    check(!guestAgain, 'a guest is not, because it is the host\'s call');

    await qHost.click('[data-quiz="again"]');
    await qHost.waitForSelector('.quiz-q', { timeout: 12000 });
    const restarted = await qHost.evaluate(() => ({
      meta: (document.querySelector('.quiz-meta') || {}).textContent || '',
      score: (document.querySelector('.quiz-scores .quiz-pts') || {}).textContent || '',
    }));
    check(/Question 1 of 10/.test(restarted.meta), `playing again starts over at question one (${restarted.meta.trim().slice(0, 30)})`);
    check(restarted.score.trim() === '0', `and wipes the scores (${restarted.score.trim()})`);
    const stillIn = await players[1].$$eval('.quiz-scores li', els => els.length).catch(() => 0);
    check(stillIn === 3, `nobody had to rejoin (${stillIn} still in)`);
  }

  // A code nobody created must fail cleanly rather than hang on a board.
  const lost = await (await browser.createBrowserContext()).newPage();
  await lost.goto(`${URL_BASE}?room=ZZZZ`, { waitUntil: 'networkidle0' });
  await wait(1200);
  check(!(await lost.$('.plate')), 'an unknown room code does not deal a board');

  const lostQuiz = await (await browser.createBrowserContext()).newPage();
  await lostQuiz.goto(`${URL_BASE}?quiz=ZZZZ`, { waitUntil: 'networkidle0' });
  await wait(1500);
  await lostQuiz.click('[data-quiz="join"]').catch(() => {});
  await wait(1200);
  check(!(await lostQuiz.$('.quiz-q')), 'an unknown quiz code does not start a quiz');

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
