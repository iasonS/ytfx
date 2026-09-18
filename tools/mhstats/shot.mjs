// Viewport screenshots for design review. Usage: node tools/mhstats/shot.mjs
import puppeteer from 'puppeteer';

const BASE = process.env.MHSTATS_URL ?? 'http://localhost:3999/mhstats/';
const wait = ms => new Promise(r => setTimeout(r, ms));

const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 1 });

await page.goto(BASE, { waitUntil: 'networkidle0' });
await page.waitForSelector('table.db, .plate', { timeout: 10000 });

await page.click('[data-nav="monsters"]');
await page.waitForSelector('table.db tbody tr');
await wait(400);
await page.screenshot({ path: '/tmp/shot-table.png' });

await page.click('[data-nav="home"]');
await page.waitForSelector('.plate.spinning');
await page.click('.plate');
await page.waitForSelector('.plate.settled');
await wait(200);
await page.screenshot({ path: '/tmp/shot-round.png' });

await browser.close();
console.log('wrote /tmp/shot-table.png and /tmp/shot-round.png');
