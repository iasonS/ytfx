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

function homeView() {
  stopReelTimer();
  phase = 'idle';
  const pool = poolFor(deck, genMask).length;
  const short = pool < ROUNDS;
  const best = topRuns(loadRuns(storage), 3);
  render(h(`
    <h1>Log the specimen before you measure it</h1>
    <p class="lead">Seven monsters, one at a time. Stop the reel, then commit that monster to one
      of seven attributes without seeing its value. Fill the entry and find out how close you came
      to the best possible reading.</p>
    ${genRow()}
    <p class="note" style="margin:10px 0 18px">${pool} monster${pool === 1 ? '' : 's'} in the
      guide${short ? '. Select at least seven to begin.' : '.'}</p>
    <div class="row"><button class="btn" data-act="play" ${short ? 'disabled' : ''}>Begin an entry</button>
      <button class="btn quiet" data-nav="runs">Past records</button></div>
    ${best.length ? `<h2>Best records</h2><ul class="records">${best.map(recordItem).join('')}</ul>` : ''}
    <p class="note" style="margin-top:22px">Generations one to six. Compiled ${esc(deck.built)}.</p>
  `));
}

function recordItem(r) {
  const share = r.best ? Math.round((r.score / r.best) * 100) : 0;
  const names = r.monsters.map(id => (byId(id) || { name: id }).name).slice(0, 3).join(', ');
  const code = encodeShare({ seed: r.seed, picks: r.picks, mask: r.mask });
  return `<li><div><span class="score">${r.score}</span>
    <span class="meta"> of ${r.best} possible, ${share}%</span>
    <div class="meta">${esc(names)} and four more</div></div>
    <button class="btn quiet" data-act="replay" data-code="${esc(code)}">Replay</button></li>`;
}

function recordsView() {
  stopReelTimer();
  const runs = topRuns(loadRuns(storage), 50);
  render(h(`
    <h1>Past records</h1>
    <p class="lead">Kept in this browser only.</p>
    ${runs.length ? `<ul class="records">${runs.map(recordItem).join('')}</ul>`
      : '<p class="empty">No entries yet. The guide is blank.</p>'}
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
  return `<div class="tally">${cells}<span class="sum">Total <b>${score(r)}</b></span></div>`;
}

function roundView() {
  const r = replay ? replay.run : run;
  const m = currentMonster(r);
  const spinning = phase === 'spinning';
  const plateSrc = spinning ? (reelPool[0] ?? m.img) : m.img;
  render(h(`
    ${genRow()}
    <p class="note" style="margin:10px 0 16px">Specimen ${r.picks.length + 1} of ${ROUNDS}</p>
    <div class="bench">
      <div>
        <div class="plate ${spinning ? 'spinning' : 'settled'}" ${spinning ? 'data-act="stop"' : ''}
          ${spinning ? 'role="button" tabindex="0"' : ''}>
          <img src="${esc(plateSrc)}" alt="${spinning ? '' : esc(m.name)}">
        </div>
        <div class="specimen">
          ${spinning
            ? `<div class="placeholder">Stop the reel</div>
               <div class="hint">Click the plate to catch a specimen.</div>`
            : `<div class="name">${esc(m.name)}</div>
               <div class="origin">Generation ${m.gen}, first seen in ${esc(m.debut)}. Figures from ${esc(m.game)}.</div>
               ${replay ? '' : '<div class="instruct">Now commit it to an attribute.</div>'}`}
        </div>
      </div>
      <div class="ledger">${ledgerRows(r, !spinning && !replay)}</div>
    </div>
    ${tallyStrip(r)}
    ${replay ? `<div class="row" style="margin-top:16px">
      <button class="btn" data-act="replay-next">${spinning ? 'Reveal' : 'Next specimen'}</button></div>` : ''}
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
    <h1>Entry complete</h1>
    <div class="verdict"><span class="score">${total}</span>
      <span class="outof">of a possible ${maxTotal()}</span></div>
    <div class="ceiling">
      <div>These seven could have reached <span class="big">${best.score}</span> — you found ${share}% of it.</div>
      <div class="note" style="margin-top:4px">Assigned the worst way they would have scored ${worst.score}.</div>
    </div>
    <h2>The entry</h2>
    <p class="note">Your assignment in brass; the best possible underlined in red. Greyed figures were
      rated by judgement rather than measured.</p>
    <div class="sheet-scroll"><table class="sheet">
      <thead><tr><th>Monster</th>${STAT_KEYS.map(k => `<th>${LABEL[k]}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="row" style="margin-top:20px">
      <button class="btn" data-act="play">Begin another</button>
      <button class="btn quiet" data-act="copy" data-url="${esc(url)}">Copy link to this entry</button>
      <span class="note" id="copied"></span>
    </div>
    ${stored ? '' : '<p class="note" style="margin-top:10px">A shared entry, so it is not kept in your records.</p>'}
  `));
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
  if (phase === 'idle') homeView(); else { preloadPlates(); roundView(); }
}

function startReplay(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { alert('That link is not a valid entry.'); return homeView(); }
  const monsters = drawMonsters(deck, decoded.seed, ROUNDS, decoded.mask);
  const stored = loadRuns(storage).find(x => x.seed === decoded.seed && x.picks.join() === decoded.picks.join());
  if (stored && stored.monsters.join() !== monsters.map(m => m.id).join()) {
    render(h(`<h1>Entry cannot be replayed</h1>
      <p class="lead">The guide has been recompiled since this was recorded, so the specimens no longer
        match. It scored ${stored.score}.</p>
      <div class="row"><button class="btn" data-nav="home">Back to the guide</button></div>`));
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
  if (el.dataset.nav === 'home') return homeView();
  if (el.dataset.nav === 'runs') return recordsView();
  switch (el.dataset.act) {
    case 'play': return play();
    case 'stop': return stopReel();
    case 'assign': return assign(el.dataset.key);
    case 'gen': return toggleGen(Number(el.dataset.gen));
    case 'replay': return startReplay(el.dataset.code);
    case 'replay-next': return replayNext();
    case 'copy': return copy(el.dataset.url);
  }
});

// The reel is a button for keyboard users too.
document.addEventListener('keydown', e => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-act="stop"]')) {
    e.preventDefault();
    stopReel();
  }
});

(async () => {
  try {
    deck = await loadDeck();
  } catch (err) {
    render(h(`<h1>The guide is unavailable</h1>
      <p class="lead">The monster data could not be loaded (${esc(err.message)}). Try again shortly.</p>`));
    return;
  }
  genMask = loadGenMask();
  const code = new URLSearchParams(location.search).get('r');
  if (code) startReplay(code); else homeView();
})();
