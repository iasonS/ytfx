// Viewport screenshots for design review. Usage: node tools/mhstats/shot.mjs
import puppeteer from 'puppeteer';

const BASE = process.env.MHSTATS_URL ?? 'http://localhost:3999/mhstats/';
const wait = ms => new Promise(r => setTimeout(r, ms));

// Stop the reel and take the first free stat, seven times, to reach the result screen.
async function playThrough(page) {
  for (let i = 0; i < 7; i++) {
    await page.waitForSelector('.plate.spinning');
    await page.click('.plate');
    await page.waitForSelector('.plate.settled');
    await wait(120);
    await page.evaluate(() => {
      const row = document.querySelector('.entry:not(.filled)');
      (row.querySelector('button') ?? row).click();
    });
    await wait(150);
  }
  await page.waitForSelector('.verdict-score b');
}

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('table.db, .plate', { timeout: 10000 });

await page.click('[data-nav="monsters"]');
await page.waitForSelector('table.db tbody tr');
await wait(400);
await page.screenshot({ path: '/tmp/shot-table.png' });
await (await page.$('.statkey')).screenshot({ path: '/tmp/shot-statkey.png' });

await page.click('[data-nav="home"]');
await page.waitForSelector('.plate.spinning');
await page.click('.plate');
await page.waitForSelector('.plate.settled');
await wait(200);
await page.screenshot({ path: '/tmp/shot-round.png' });

// The result screen, desktop and phone.
await page.goto(BASE, { waitUntil: 'networkidle0' });
await playThrough(page);
await wait(250);
await page.screenshot({ path: '/tmp/shot-result.png', fullPage: true });

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await wait(350);
await page.screenshot({ path: '/tmp/shot-result-mobile.png', fullPage: true });

await browser.close();
console.log('wrote /tmp/shot-table.png, /tmp/shot-round.png, /tmp/shot-result.png and /tmp/shot-result-mobile.png');
