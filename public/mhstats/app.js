import {
  STATS, STAT_KEYS, ROUNDS, newRun, currentMonster, pick, isComplete, score, valueOf,
  bestAssignment, worstAssignment, encodeShare, decodeShare, randomSeed, drawMonsters,
  GENS, ALL_GENS, poolFor,
} from './game.js';
import { loadRuns, saveRun, topRuns } from './storage.js';

const GEN_KEY = 'mhstats.gens.v1';
const SPIN_MS = 70;      // one frame of the reel
const PRELOAD = 24;      // plates held in memory so the reel does not flicker

const view = document.getElementById('view');
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const LABEL = Object.fromEntries(STATS.map(s => [s.key, s.label]));

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
let phase = 'idle';      // idle | spinning | picking | done
let reelTimer = null;
let reelPool = [];
let replay = null;

const maxTotal = () => ROUNDS * (deck?.statMax || 300);
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
  return `<div class="gens"><span class="gens-label">Generations</span><div class="gen-list">${chips}</div></div>`;
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
  const share = r.best ? Math.round((r.score / r.best) * 100) : 0;
  const names = r.monsters.map(id => (byId(id) || { name: id }).name).slice(0, 3).join(', ');
  const code = encodeShare({ seed: r.seed, picks: r.picks, mask: r.mask });
  return `<li><div><span class="score">${r.score}</span>
    <span class="meta"> of ${r.best} best, ${share}%</span>
    <div class="meta">${esc(names)} and four more</div></div>
    <button class="btn quiet" data-act="replay" data-code="${esc(code)}">Replay</button></li>`;
}

function recordsView() {
  stopReelTimer();
  const runs = topRuns(loadRuns(storage), 50);
  render(h(`
    <h1>Your runs</h1>
    <p class="lead">Saved in this browser.</p>
    <div class="row" style="margin-bottom:16px"><button class="btn" data-nav="home">Play</button></div>
    ${runs.length ? `<ul class="records">${runs.map(recordItem).join('')}</ul>`
      : '<p class="empty">No runs yet.</p>'}
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
      ${interactive ? '' : 'disabled'}><span class="attr">${LABEL[key]}</span><span class="val">·</span></button>`;
  }).join('');
}

function tallyStrip(r) {
  const cells = STAT_KEYS.map(k => {
    const i = r.picks.indexOf(k);
    const v = i >= 0 ? valueOf(r.monsters[i], k) : '·';
    return `<span class="cell">${LABEL[k]} <b>${v}</b></span>`;
  }).join('');
  const best = topRuns(loadRuns(storage), 1)[0];
  const pb = best ? `<span class="cell pb">Best ${best.score}</span>` : '';
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

function resultView(r, { stored = true } = {}) {
  stopReelTimer();
  phase = 'done';
  const best = bestAssignment(r.monsters), worst = worstAssignment(r.monsters), total = score(r);
  const share = Math.round((total / best.score) * 100);
  const rows = r.monsters.map((m, i) => `<tr><td>${esc(m.name)}</td>${STAT_KEYS.map(k => {
    const cls = [r.picks[i] === k ? 'mine' : '', best.picks[i] === k ? 'top' : ''].filter(Boolean).join(' ');
    const rated = (m.curated || []).includes(k) ? ' class="rated"' : '';
    return `<td class="${cls}"><span${rated}>${m.stats[k]}</span></td>`;
  }).join('')}</tr>`).join('');
  const url = `${location.origin}${location.pathname}?r=${encodeShare(r)}`;
  render(h(`
    <h1>Your monster</h1>
    <div class="verdict"><span class="score">${total}</span>
      <span class="outof">out of ${maxTotal()}</span></div>
    <div class="ceiling">
      <div>Best possible was <span class="big">${best.score}</span>. You got ${share}%.</div>
      <div class="note" style="margin-top:4px">Worst possible was ${worst.score}.</div>
    </div>
    <h2>All seven</h2>
    <p class="note">Your picks in gold. Best possible underlined. Grey numbers are judged, not from the games.</p>
    <div class="sheet-scroll"><table class="sheet">
      <thead><tr><th>Monster</th>${STAT_KEYS.map(k => `<th>${LABEL[k]}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="row" style="margin-top:20px">
      <button class="btn" data-act="play">Play again</button>
      <button class="btn quiet" data-act="copy" data-url="${esc(url)}">Copy link</button>
      <span class="note" id="copied"></span>
    </div>
    ${stored ? '' : '<p class="note" style="margin-top:10px">A shared run, so it is not saved to yours.</p>'}
  `));
}


// ---- every monster, sortable --------------------------------------------------

let dbSort = { key: 'name', dir: 1 };
let dbQuery = '';

function dbRows() {
  const q = dbQuery.trim().toLowerCase();
  const rows = deck.monsters.filter(m => !q || m.name.toLowerCase().includes(q));
  const { key, dir } = dbSort;
  return rows.sort((a, b) => {
    if (key === 'name') return dir * a.name.localeCompare(b.name);
    if (key === 'gen') return dir * (a.gen - b.gen) || a.name.localeCompare(b.name);
    return dir * (a.stats[key] - b.stats[key]) || a.name.localeCompare(b.name);
  });
}

function monstersView() {
  stopReelTimer();
  phase = 'idle';
  const rows = dbRows();
  const arrow = k => (dbSort.key === k ? (dbSort.dir === 1 ? ' ▲' : ' ▼') : '');
  const head = [['name', 'Monster'], ['gen', 'Gen'], ...STATS.map(s => [s.key, s.label])]
    .map(([k, label]) => `<th class="${k === 'name' ? 'col-name' : 'col-num'}${dbSort.key === k ? ' sorted' : ''}"
      data-act="sort" data-key="${k}" role="button" tabindex="0">${label}${arrow(k)}</th>`).join('');
  const body = rows.map(m => `<tr>
    <td class="col-name"><img src="${esc(m.img)}" alt="" loading="lazy" width="34" height="34">
      <span><b>${esc(m.name)}</b><small>${esc(gameName(m.game))}</small></span></td>
    <td class="col-num">${m.gen}</td>
    ${STAT_KEYS.map(k => `<td class="col-num${(m.curated || []).includes(k) ? ' judged' : ''}">${m.stats[k]}</td>`).join('')}
  </tr>`).join('');
  render(h(`
    <h1>All monsters</h1>
    <p class="lead">Click a column to sort. Grey numbers are judged, not from the games.</p>
    <input class="search" type="search" placeholder="Search by name" value="${esc(dbQuery)}"
      data-act="search" aria-label="Search monsters by name">
    <p class="note" style="margin:8px 0 12px">${rows.length} shown</p>
    <div class="db-scroll"><table class="db">
      <thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
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
  run = newRun(deck, randomSeed(), genMask);
  preloadPlates();
  phase = 'spinning';
  roundView();
}

function assign(key) {
  if (phase !== 'picking') return;
  run = pick(run, key);
  if (isComplete(run)) {
    const best = bestAssignment(run.monsters), worst = worstAssignment(run.monsters);
    saveRun(storage, {
      seed: run.seed, mask: run.mask, monsters: run.monsters.map(m => m.id), picks: run.picks,
      score: score(run), best: best.score, worst: worst.score, at: new Date().toISOString(),
    });
    resultView(run);
  } else {
    phase = 'spinning';
    roundView();
  }
}

function toggleGen(g) {
  const next = genMask ^ (1 << (g - 1));
  if (next === 0) return;
  genMask = next;
  saveGenMask(genMask);
  if (poolFor(deck, genMask).length < ROUNDS) return tooFewView();
  if (phase === 'idle') startOrBlock(); else { preloadPlates(); roundView(); }
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
  const code = new URLSearchParams(location.search).get('r');
  if (code) startReplay(code); else startOrBlock();
})();
