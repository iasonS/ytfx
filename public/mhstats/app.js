import {
  STATS, STAT_KEYS, ROUNDS, newRun, currentMonster, pick, isComplete, score, valueOf,
  encodeShare, decodeShare, randomSeed, drawMonsters,
  GENS, ALL_GENS, poolFor, AIM_HIGH, AIM_LOW, isAim, outcome,
} from './game.js';
import { loadRuns, saveRun, topRuns, aimOf } from './storage.js';

const GEN_KEY = 'mhstats.gens.v1';
const AIM_KEY = 'mhstats.aim.v1';
const SPIN_MS = 70;      // one frame of the reel
const PRELOAD = 24;      // plates held in memory so the reel does not flicker

const view = document.getElementById('view');
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const LABEL = Object.fromEntries(STATS.map(s => [s.key, s.label]));
const HELP = {
  ...Object.fromEntries(STATS.map(s => [s.key, s.help])),
  total: 'The seven stats added up. A rough measure of the whole animal, not of how hard the fight is.',
};

// Seven abstract nouns in a column is a lot to hold, and Resist and Temper in particular
// need telling apart. Printed once under the table, and on every stat header as a tooltip.
const statKey = () =>
  `<dl class="statkey">${STATS.map(s => `<div><dt>${s.label}</dt><dd>${esc(s.help)}</dd></div>`).join('')}</dl>`;

// Resist is a sum of four tolerances, so the number alone never says WHICH statuses a
// monster shrugs off. An absent row in the source is not missing data: it means the monster
// cannot be afflicted by that status at all, which is how Fatalis reaches 244 without a
// single stun figure, and how Nakarkos reaches 300 on one poison row and three immunities.
const STATUSES = [
  ['poison', 'Poison', 'poisoned'],
  ['paralysis', 'Paralysis', 'paralysed'],
  ['sleep', 'Sleep', 'slept'],
  ['stun', 'Stun', 'stunned'],
];
// "or", not "and": these read under a negation, so it is "cannot be slept or stunned".
const joinWords = ws => (ws.length < 2 ? (ws[0] ?? '') : `${ws.slice(0, -1).join(', ')} or ${ws[ws.length - 1]}`);

function resistDetail(m) {
  const rows = STATUSES.map(([key, label, verb]) => [label, verb, m.raw?.[`tolerance_${key}`]]);
  const known = rows.filter(([, , v]) => v);
  if (!known.length) {
    // The siege monsters carry no tolerance rows at all and are placed by hand as immune.
    return m.stats.wil >= 250
      ? 'Cannot be poisoned, paralysed, slept or stunned.'
      : 'No status tolerances recorded in its source; this value is judged.';
  }
  const immune = rows.filter(([, , v]) => !v).map(([, verb]) => verb);
  const figures = known.map(([label, , v]) => `${label} ${parseInt(v, 10)}`).join(' \u00b7 ');
  return immune.length ? `Cannot be ${joinWords(immune)}. ${figures}` : figures;
}

const GAME_NAMES = {
  MH1: 'the first game', MHG: 'Monster Hunter G', MHF1: 'Freedom',
  MH2: 'Dos', MHF2: 'Freedom 2', MHFU: 'Freedom Unite',
  MH3: 'Tri', MHP3: 'Portable 3rd', MH3U: '3 Ultimate',
  MH4: 'MH4', MH4U: '4 Ultimate', MHGen: 'Generations', MHGU: 'Generations Ultimate',
  MHWorld: 'World', MHWI: 'Iceborne', MHRise: 'Rise', MHRS: 'Sunbreak', MHWilds: 'Wilds',
};
const gameName = code => GAME_NAMES[code] ?? code;

let deck = null;
let run = null;
let genMask = ALL_GENS;
let aim = AIM_HIGH;
// Set while playing someone else's challenge: their picks over the same seven monsters.
let duel = null;
let phase = 'idle';      // idle | spinning | picking | done
let reelTimer = null;
let reelPool = [];
let replay = null;

const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => deck.monsters.find(m => m.id === id);
function render(node) { view.replaceChildren(node); window.scrollTo({ top: 0 }); }

async function loadDeck() {
  const res = await fetch('./deck.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`deck.json ${res.status}`);
  return res.json();
}

function loadGenMask() {
  try {
    const raw = window.localStorage.getItem(GEN_KEY);
    const n = raw === null ? ALL_GENS : Number(raw);
    return Number.isInteger(n) && n >= 1 && n <= ALL_GENS ? n : ALL_GENS;
  } catch { return ALL_GENS; }
}
function saveGenMask(mask) {
  try { window.localStorage.setItem(GEN_KEY, String(mask)); } catch { /* unavailable */ }
}

function loadAim() {
  try {
    const raw = window.localStorage.getItem(AIM_KEY);
    return isAim(raw) ? raw : AIM_HIGH;
  } catch { return AIM_HIGH; }
}
function saveAim(a) {
  try { window.localStorage.setItem(AIM_KEY, a); } catch { /* unavailable */ }
}

const AIM_LABEL = { [AIM_HIGH]: 'Highest', [AIM_LOW]: 'Lowest' };

// ---- the reel ---------------------------------------------------------------
// The reel is presentation. Which monster it lands on was already decided by the run's
// seed, so a replay or a shared link always shows the same seven specimens.

function preloadPlates() {
  const pool = poolFor(deck, genMask);
  reelPool = [];
  for (let i = 0; i < Math.min(PRELOAD, pool.length); i++) {
    const m = pool[Math.floor(Math.random() * pool.length)];
    const img = new Image();
    img.src = m.img;
    reelPool.push(m.img);
  }
}

function startReel() {
  stopReelTimer();
  const plate = view.querySelector('.plate img');
  if (!plate || !reelPool.length) return;
  let i = Math.floor(Math.random() * reelPool.length);
  reelTimer = setInterval(() => {
    i = (i + 1 + Math.floor(Math.random() * 3)) % reelPool.length;
    plate.src = reelPool[i];
  }, SPIN_MS);
}

function stopReelTimer() {
  if (reelTimer) { clearInterval(reelTimer); reelTimer = null; }
}

function stopReel() {
  if (phase !== 'spinning') return;
  stopReelTimer();
  phase = 'picking';
  roundView();
}

// ---- views ------------------------------------------------------------------

function genRow() {
  const counts = new Map(GENS.map(g => [g, 0]));
  for (const m of deck.monsters) counts.set(m.gen, (counts.get(m.gen) ?? 0) + 1);
  const chips = GENS.map(g => {
    const on = genMask & (1 << (g - 1));
    return `<button type="button" class="gen${on ? ' on' : ''}" data-act="gen" data-gen="${g}"
      aria-pressed="${on ? 'true' : 'false'}">${g}<span class="count">${counts.get(g) ?? 0}</span></button>`;
  }).join('');
  return `<div class="gens"><span class="gens-label">Generations</span><div class="gen-list">${chips}</div>
    <span class="gens-label aim-label">Aim for</span>
    <div class="gen-list">${[AIM_HIGH, AIM_LOW].map(a => `<button type="button" class="aim${a === aim ? ' on' : ''}"
      data-act="aim" data-aim="${a}" aria-pressed="${a === aim ? 'true' : 'false'}"
      title="${a === AIM_LOW ? 'Give every monster its weakest stat. Scored against the worst line these seven allow.' : 'Give every monster its strongest stat. Scored against the best line these seven allow.'}"
      >${AIM_LABEL[a]}</button>`).join('')}</div></div>`;
}

// Shown only when the generation filter leaves fewer than seven monsters to deal.
function tooFewView() {
  stopReelTimer();
  phase = 'idle';
  const pool = poolFor(deck, genMask).length;
  render(h(`
    ${genRow()}
    <p class="note" style="margin:14px 0 0">${pool} monster${pool === 1 ? '' : 's'}. Pick at least seven to play.</p>
  `));
}

function startOrBlock() {
  if (poolFor(deck, genMask).length < ROUNDS) return tooFewView();
  play();
}

function recordItem(r) {
  const low = aimOf(r) === AIM_LOW;
  // A run aiming low is measured against the floor, so its percentage counts the other way.
  const target = low ? r.worst : r.best;
  const share = target ? Math.round((low ? target / r.score : r.score / target) * 100) : 0;
  const names = r.monsters.map(id => (byId(id) || { name: id }).name).slice(0, 3).join(', ');
  const code = encodeShare({ seed: r.seed, picks: r.picks, mask: r.mask, aim: aimOf(r) });
  return `<li><div><span class="score">${r.score}</span>
    <span class="meta"> of ${target} ${low ? 'floor' : 'best'}, ${share}%</span>
    <div class="meta">${esc(names)} and four more</div></div>
    <button class="btn quiet" data-act="replay" data-code="${esc(code)}">Replay</button></li>`;
}

function recordsView() {
  stopReelTimer();
  const all = loadRuns(storage);
  const section = (a, title, blurb) => {
    const runs = topRuns(all, 25, a);
    if (!runs.length) return '';
    return `<h2>${title}</h2><p class="note" style="margin:0 0 8px">${blurb}</p>
      <ul class="records">${runs.map(recordItem).join('')}</ul>`;
  };
  const body = section(AIM_HIGH, 'Aiming high', 'Best first.')
    + section(AIM_LOW, 'Aiming low', 'Lowest first \u2014 smaller is better here.');
  render(h(`
    <h1>Your runs</h1>
    <p class="lead">Saved in this browser.</p>
    <div class="row" style="margin-bottom:16px"><button class="btn" data-nav="home">Play</button></div>
    ${body || '<p class="empty">No runs yet.</p>'}
  `));
}

function ledgerRows(r, interactive) {
  return STAT_KEYS.map(key => {
    const i = r.picks.indexOf(key);
    if (i >= 0) {
      const m = r.monsters[i];
      return `<button class="entry filled" disabled>
        <span class="attr">${LABEL[key]}</span><span class="val">${valueOf(m, key)}</span>
        <span class="who"><img src="${esc(m.img)}" alt=""> ${esc(m.name)}</span></button>`;
    }
    return `<button class="entry${interactive ? '' : ' waiting'}" data-act="assign" data-key="${key}"
      title="${esc(HELP[key])}" ${interactive ? '' : 'disabled'}><span class="attr">${LABEL[key]}</span><span class="val">·</span></button>`;
  }).join('');
}

function tallyStrip(r) {
  const cells = STAT_KEYS.map(k => {
    const i = r.picks.indexOf(k);
    const v = i >= 0 ? valueOf(r.monsters[i], k) : '·';
    return `<span class="cell">${LABEL[k]} <b>${v}</b></span>`;
  }).join('');
  // The personal best only means anything within one aim: 715 is a triumph aiming low.
  const best = topRuns(loadRuns(storage), 1, r.aim ?? aim)[0];
  const pb = best ? `<span class="cell pb">${(r.aim ?? aim) === AIM_LOW ? 'Lowest' : 'Best'} ${best.score}</span>` : '';
  return `<div class="tally">${cells}${pb}<span class="sum">Total <b>${score(r)}</b></span></div>`;
}

function roundView() {
  const r = replay ? replay.run : run;
  const m = currentMonster(r);
  const spinning = phase === 'spinning';
  const plateSrc = spinning ? (reelPool[0] ?? m.img) : m.img;
  render(h(`
    ${genRow()}
    <p class="note" style="margin:10px 0 16px">Monster ${r.picks.length + 1} of ${ROUNDS}</p>
    <div class="bench">
      <div>
        <div class="plate ${spinning ? 'spinning' : 'settled'}" ${spinning ? 'data-act="stop"' : ''}
          ${spinning ? 'role="button" tabindex="0"' : ''}>
          <img src="${esc(plateSrc)}" alt="${spinning ? '' : esc(m.name)}">
        </div>
        <div class="specimen">
          ${spinning
            ? `<div class="placeholder">Click to stop</div>`
            : `<div class="name">${esc(m.name)}</div>
               <div class="origin">Generation ${m.gen} · stats from ${esc(gameName(m.game))}</div>
               ${replay ? '' : '<div class="instruct">Pick a stat.</div>'}`}
        </div>
      </div>
      <div class="ledger">${ledgerRows(r, !spinning && !replay)}</div>
    </div>
    ${tallyStrip(r)}
    ${replay ? `<div class="row" style="margin-top:16px">
      <button class="btn" data-act="replay-next">${spinning ? 'Stop' : 'Next monster'}</button></div>` : ''}
  `));
  if (spinning) startReel();
}

function resultView(r, { stored = true, shared = false, against = null } = {}) {
  stopReelTimer();
  phase = 'done';
  const o = outcome(r);
  // `perfect` is the line this run was chasing: the best line aiming high, the worst aiming
  // low. Every label below reads off it, so one screen serves both aims.
  const { total, best, worst, perfect, pct, low } = o;
  const span = best.score - worst.score;
  const at = span > 0 ? Math.min(97, Math.max(3, ((total - worst.score) / span) * 100)) : 100;
  const markAt = span > 0 && against !== null
    ? Math.min(97, Math.max(3, ((against.score - worst.score) / span) * 100)) : null;

  const rows = r.monsters.map((m, i) => {
    const mine = r.picks[i], top = perfect.picks[i];
    // Against the line this run was chasing, for THIS monster. That line is a whole-run
    // optimum and will take a worse stat here to free a better one elsewhere, so it comes
    // out positive as readily as negative. The seven sum to your total minus the perfect one.
    const raw = m.stats[mine] - m.stats[top];
    // Aiming low, sitting UNDER that line is the good direction, so the colour flips.
    const gain = low ? -raw : raw;
    const cells = STAT_KEYS.map(k => {
      const cls = [k === mine ? 'mine' : '', k === top ? 'top' : ''].filter(Boolean).join(' ');
      const detail = k === 'wil' ? ` title="${esc(resistDetail(m))}"` : '';
      return `<td class="${cls}"${detail}><span>${m.stats[k]}</span></td>`;
    }).join('');
    return `<tr>
      <td class="col-name"><img src="${esc(m.img)}" alt="" loading="lazy" width="34" height="34">
        <b>${esc(m.name)}</b></td>
      ${cells}
      <td class="delta ${gain < 0 ? 'down' : gain > 0 ? 'up' : 'level'}">${
        raw === 0 ? '·' : `${raw < 0 ? '−' : '+'}${Math.abs(raw)}`}</td>
    </tr>`;
  }).join('');

  const code = encodeShare(r);
  const url = `${location.origin}${location.pathname}?r=${code}`;
  const duelUrl = `${location.origin}${location.pathname}?d=${code}`;

  let banner = '';
  if (against) {
    const won = low ? total < against.score : total > against.score;
    const drew = total === against.score;
    banner = `<div class="duel ${drew ? 'draw' : won ? 'won' : 'lost'}">
      <span class="duel-verdict">${drew ? 'A draw' : won ? 'You win' : 'They win'}</span>
      <span class="duel-line">You <b>${total}</b></span>
      <span class="duel-line">Them <b>${against.score}</b></span>
      <span class="duel-note">${low ? 'Lower wins.' : 'Higher wins.'} Same seven monsters.</span>
    </div>`;
  } else if (shared) {
    banner = `<div class="duel shared">
      <span class="duel-verdict">Someone’s run</span>
      <span class="duel-note">They were aiming ${low ? 'low' : 'high'}. Take the same seven and see if you can beat it.</span>
      <button class="btn" data-act="duel" data-code="${esc(code)}">Play these seven</button>
    </div>`;
  }

  render(h(`
    ${banner}
    <header class="verdict">
      <p class="verdict-score"><b>${total}</b><span>points, aiming ${low ? 'low' : 'high'}</span></p>
      <div class="range">
        <div class="range-track" style="--at:${at}%">${
          markAt === null ? '' : `<u style="--them:${markAt}%" title="Their score: ${against.score}"></u>`}<i></i></div>
        <div class="range-ends">
          <span${low ? ' class="range-best"' : ''}><b>${worst.score}</b> ${low ? 'floor' : 'worst'}</span>
          <span class="range-share">${pct}% of ${low ? 'floor' : 'best'}</span>
          <span${low ? '' : ' class="range-best"'}><b>${best.score}</b> ${low ? 'worst' : 'best'}</span>
        </div>
      </div>
    </header>
    <div class="sheet-scroll"><table class="sheet">
      <thead><tr><th>Monster</th>${STAT_KEYS.map(k => `<th title="${esc(HELP[k])}">${LABEL[k]}</th>`).join('')}<th>vs ${low ? 'floor' : 'best'}</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="key">
      <span class="k-mine">Your pick</span>
      <span class="k-top">${low ? 'Lowest line' : 'Best pick'}</span>
    </p>
    <div class="row" style="margin-top:20px">
      <button class="btn" data-act="play">Play again</button>
      <button class="btn quiet" data-act="copy" data-url="${esc(duelUrl)}">Challenge a friend</button>
      <button class="btn quiet" data-act="copy" data-url="${esc(url)}">Copy result link</button>
      <span class="note" id="copied"></span>
    </div>
    ${stored ? '' : '<p class="note" style="margin-top:10px">Someone else’s run, so it is not saved to yours.</p>'}
  `));
}

// ---- every monster, sortable --------------------------------------------------

let dbSort = { key: 'name', dir: 1 };
let dbQuery = '';

const totalOf = m => STAT_KEYS.reduce((n, k) => n + m.stats[k], 0);

function dbRows() {
  const q = dbQuery.trim().toLowerCase();
  const rows = deck.monsters.filter(m => !q || m.name.toLowerCase().includes(q));
  const { key, dir } = dbSort;
  return rows.sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    if (key === 'gen') return dir * (a.gen - b.gen) || a.name.localeCompare(b.name);
    if (key === 'total') return dir * (totalOf(a) - totalOf(b)) || a.name.localeCompare(b.name);
    return dir * (a.stats[key] - b.stats[key]) || a.name.localeCompare(b.name);
  });
}

function monstersView() {
  stopReelTimer();
  phase = 'idle';
  const rows = dbRows();
  const arrow = k => (dbSort.key === k ? (dbSort.dir === 1 ? ' ▲' : ' ▼') : '');
  const head = [['name', 'Monster'], ['gen', 'Gen'], ...STATS.map(s => [s.key, s.label]), ['total', 'Total']]
    .map(([k, label]) => `<th class="${k === 'name' ? 'col-name' : 'col-num'}${k === 'total' ? ' col-total' : ''}${dbSort.key === k ? ' sorted' : ''}"
      data-act="sort" data-key="${k}" role="button" tabindex="0"${HELP[k] ? ` title="${esc(HELP[k])}"` : ''}>${label}${arrow(k)}</th>`).join('');
  const body = rows.map(m => `<tr>
    <td class="col-name"><img src="${esc(m.img)}" alt="" loading="lazy" width="34" height="34">
      <span><b>${esc(m.name)}</b><small>${esc(gameName(m.game))}</small></span></td>
    <td class="col-num">${m.gen}</td>
    ${STAT_KEYS.map(k => (k === 'wil'
      ? `<td class="col-num has-detail" title="${esc(resistDetail(m))}">${m.stats[k]}</td>`
      : `<td class="col-num">${m.stats[k]}</td>`)).join('')}
    <td class="col-num col-total">${totalOf(m)}</td>
  </tr>`).join('');
  render(h(`
    <h1>All monsters</h1>
    <p class="lead">Click a column to sort.</p>
    <input class="search" type="search" placeholder="Search by name" value="${esc(dbQuery)}"
      data-act="search" aria-label="Search monsters by name">
    <p class="note" style="margin:8px 0 12px">${rows.length} shown</p>
    <div class="db-scroll"><table class="db">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
    <h2>What the stats mean</h2>
    ${statKey()}
  `));
  const box = view.querySelector('.search');
  if (box) {
    box.addEventListener('input', e => {
      dbQuery = e.target.value;
      const at = e.target.selectionStart;
      monstersView();
      const next = view.querySelector('.search');
      if (next) { next.focus(); next.setSelectionRange(at, at); }
    });
  }
}

function sortBy(key) {
  dbSort = dbSort.key === key ? { key, dir: -dbSort.dir } : { key, dir: key === 'name' ? 1 : -1 };
  monstersView();
}

// ---- actions ----------------------------------------------------------------

function play() {
  replay = null;
  duel = null;
  run = newRun(deck, randomSeed(), genMask, aim);
  preloadPlates();
  phase = 'spinning';
  roundView();
}

function assign(key) {
  if (phase !== 'picking') return;
  run = pick(run, key);
  if (isComplete(run)) {
    const o = outcome(run);
    saveRun(storage, {
      seed: run.seed, mask: run.mask, aim: run.aim, monsters: run.monsters.map(m => m.id),
      picks: run.picks, score: o.total, best: o.best.score, worst: o.worst.score,
      at: new Date().toISOString(),
    });
    resultView(run, duel ? { against: { score: duel.score } } : {});
    duel = null;
  } else {
    phase = 'spinning';
    roundView();
  }
}

function setAim(next) {
  if (!isAim(next) || next === aim) return;
  aim = next;
  saveAim(aim);
  // Changing the goal mid-run would score picks made under the other one, so it restarts.
  duel = null;
  replay = null;
  startOrBlock();
}

function toggleGen(g) {
  const next = genMask ^ (1 << (g - 1));
  if (next === 0) return;
  genMask = next;
  saveGenMask(genMask);
  if (poolFor(deck, genMask).length < ROUNDS) return tooFewView();
  if (phase === 'idle') startOrBlock(); else { preloadPlates(); roundView(); }
}

// A link someone sent. It used to drop you into a step-through that looked exactly like a
// new game, so a shared link read as "it just opens the page". Show the finished run
// instead, and offer the same seven monsters as a challenge.
function showShared(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { return badLink(); }
  if (decoded.picks.length !== ROUNDS) return badLink();
  const monsters = drawMonsters(deck, decoded.seed, ROUNDS, decoded.mask);
  const theirs = { seed: decoded.seed, mask: decoded.mask, aim: decoded.aim, monsters, picks: decoded.picks };
  duel = null;
  replay = null;
  resultView(theirs, { stored: false, shared: true });
}

// Their code sets the draw AND the aim, otherwise the two runs are not comparable.
function startDuel(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { return badLink(); }
  if (decoded.picks.length !== ROUNDS) return badLink();
  const monsters = drawMonsters(deck, decoded.seed, ROUNDS, decoded.mask);
  aim = decoded.aim;
  saveAim(aim);
  genMask = decoded.mask;
  saveGenMask(genMask);
  duel = { code, score: score({ monsters, picks: decoded.picks }) };
  replay = null;
  run = { seed: decoded.seed, mask: decoded.mask, aim: decoded.aim, monsters, picks: [] };
  preloadPlates();
  phase = 'spinning';
  roundView();
}

function badLink() {
  render(h(`<h1>That link did not work</h1>
    <p class="lead">It is not a run this game can read. It may have been cut short when it was copied.</p>
    <div class="row"><button class="btn" data-nav="home">Play</button></div>`));
}

function startReplay(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { alert('That link is not a valid run.'); return startOrBlock(); }
  const monsters = drawMonsters(deck, decoded.seed, ROUNDS, decoded.mask);
  const stored = loadRuns(storage).find(x => x.seed === decoded.seed && x.picks.join() === decoded.picks.join());
  if (stored && stored.monsters.join() !== monsters.map(m => m.id).join()) {
    render(h(`<h1>Can't replay this run</h1>
      <p class="lead">The monster list changed since this run, so it would draw different monsters.
        It scored ${stored.score}.</p>
      <div class="row"><button class="btn" data-nav="home">Play</button></div>`));
    return;
  }
  replay = { run: { seed: decoded.seed, mask: decoded.mask, monsters, picks: [] }, picks: decoded.picks, stored: !!stored };
  preloadPlates();
  phase = 'spinning';
  roundView();
}

function replayNext() {
  if (phase === 'spinning') { stopReelTimer(); phase = 'picking'; return roundView(); }
  const next = replay.picks[replay.run.picks.length];
  replay.run = pick(replay.run, next);
  if (replay.run.picks.length >= replay.picks.length) {
    const done = replay.run, stored = replay.stored;
    replay = null;
    resultView(done, { stored });
  } else {
    phase = 'spinning';
    roundView();
  }
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById('copied').textContent = 'Copied.';
  } catch { prompt('Copy this link', url); }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-nav]');
  if (!el || !deck) return;
  if (el.dataset.nav === 'home') return startOrBlock();
  if (el.dataset.nav === 'runs') return recordsView();
  if (el.dataset.nav === 'monsters') return monstersView();
  switch (el.dataset.act) {
    case 'play': return play();
    case 'stop': return stopReel();
    case 'assign': return assign(el.dataset.key);
    case 'gen': return toggleGen(Number(el.dataset.gen));
    case 'aim': return setAim(el.dataset.aim);
    case 'duel': return startDuel(el.dataset.code);
    case 'replay': return startReplay(el.dataset.code);
    case 'replay-next': return replayNext();
    case 'sort': return sortBy(el.dataset.key);
    case 'copy': return copy(el.dataset.url);
  }
});

// The reel is a button for keyboard users too.
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (e.target.closest('[data-act="stop"]')) { e.preventDefault(); stopReel(); return; }
  const th = e.target.closest('[data-act="sort"]');
  if (th) { e.preventDefault(); sortBy(th.dataset.key); }
});

(async () => {
  try {
    deck = await loadDeck();
  } catch (err) {
    render(h(`<h1>Could not load the monsters</h1>
      <p class="lead">${esc(err.message)}. Try again in a moment.</p>`));
    return;
  }
  genMask = loadGenMask();
  aim = loadAim();
  const params = new URLSearchParams(location.search);
  const duelCode = params.get('d');
  const sharedCode = params.get('r');
  if (duelCode) startDuel(duelCode);
  else if (sharedCode) showShared(sharedCode);
  else startOrBlock();
})();
