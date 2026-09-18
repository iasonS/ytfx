import {
  STATS, STAT_KEYS, newRun, currentMonster, pick, isComplete, score, valueOf,
  bestAssignment, worstAssignment, encodeShare, decodeShare, randomSeed, drawMonsters,
} from './game.js';
import { loadRuns, saveRun, topRuns } from './storage.js';

const view = document.getElementById('view');
const storage = (() => { try { return window.localStorage; } catch { return null; } })();
const LABEL = Object.fromEntries(STATS.map(s => [s.key, s.label]));

let deck = null;
let run = null;        // the live run
let lastFlip = null;   // stat key just revealed, for the flip animation
let replay = null;     // { run, picks, mismatch, stored, storedScore }

const maxTotal = () => STAT_KEYS.length * (deck?.statMax || 300);

function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; }
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function render(node) { view.replaceChildren(node); window.scrollTo({ top: 0 }); }
function byId(id) { return deck.monsters.find(m => m.id === id); }

async function loadDeck() {
  const res = await fetch('./deck.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`deck.json ${res.status}`);
  return res.json();
}

// ---------- views ----------

function runItem(r) {
  const pct = r.best ? Math.round((r.score / r.best) * 100) : 0;
  const names = r.monsters.map(id => (byId(id) || { name: id }).name).slice(0, 3).join(', ');
  const code = encodeShare({ seed: r.seed, picks: r.picks });
  return `<li><div><strong>${r.score}</strong> <span class="meta">of ${r.best} best (${pct}%)</span>
    <div class="meta">${esc(names)}…</div></div>
    <button class="btn ghost" data-act="replay" data-code="${esc(code)}">Replay</button></li>`;
}

function homeView() {
  const runs = topRuns(loadRuns(storage), 5);
  render(h(`
    <h1>Build your own monster</h1>
    <p class="lead">Seven monsters, one at a time. Give each one a stat before you see the number.
      Fill all seven slots and see how close you got to the perfect build.</p>
    <div class="row"><button class="btn" data-act="play">Play</button>
      <button class="btn ghost" data-nav="runs">Previous runs</button></div>
    <h2>Top runs</h2>
    <ul class="runs">${runs.length ? runs.map(runItem).join('') : '<li class="empty">No runs yet. Play one.</li>'}</ul>
    <p class="note">Deck: ${deck.monsters.length} monsters, built ${esc(deck.built)}.</p>
  `));
}

function runsView() {
  const runs = topRuns(loadRuns(storage), 50);
  render(h(`
    <h1>Previous runs</h1>
    <ul class="runs">${runs.length ? runs.map(runItem).join('') : '<li class="empty">Nothing stored in this browser yet.</li>'}</ul>
  `));
}

function slotHtml(r, key, interactive) {
  const i = r.picks.indexOf(key);
  if (i >= 0) {
    const m = r.monsters[i];
    const flip = lastFlip === key ? ' flip' : '';
    return `<button class="slot" disabled><span class="label">${LABEL[key]}</span>
      <span class="value${flip}">${valueOf(m, key)}</span>
      <span class="who"><img src="${esc(m.img)}" alt=""> ${esc(m.name)}</span></button>`;
  }
  return `<button class="slot" data-act="pick" data-key="${key}" ${interactive ? '' : 'disabled'}>
    <span class="label">${LABEL[key]}</span><span class="value">?</span></button>`;
}

function roundView(r, { interactive = true } = {}) {
  const m = currentMonster(r);
  render(h(`
    <div class="card monster">
      <img src="${esc(m.img)}" alt="${esc(m.name)}">
      <div class="name">${esc(m.name)}</div>
      <div class="game">Numbers from ${esc(m.game)} · Debut ${esc(m.gen)}</div>
    </div>
    <div class="progress"><span>Round ${r.picks.length + 1} of ${STAT_KEYS.length}</span><span>Total ${score(r)}</span></div>
    <div class="slots">${STAT_KEYS.map(k => slotHtml(r, k, interactive)).join('')}</div>
    ${interactive ? '' : '<div class="row" style="margin-top:14px"><button class="btn" data-act="replay-next">Next pick</button></div>'}
  `));
}

function endView(r, { stored = true } = {}) {
  const best = bestAssignment(r.monsters), worst = worstAssignment(r.monsters), total = score(r);
  const pct = Math.round((total / best.score) * 100);
  const rows = r.monsters.map((m, i) => `<tr><td>${esc(m.name)}</td>${STAT_KEYS.map(k => {
    const cls = [r.picks[i] === k ? 'picked' : '', best.picks[i] === k ? 'best' : ''].filter(Boolean).join(' ');
    const cur = (m.curated || []).includes(k) ? ' class="cur"' : '';
    return `<td class="${cls}"><span${cur}>${m.stats[k]}</span></td>`;
  }).join('')}</tr>`).join('');
  const url = `${location.origin}${location.pathname}?r=${encodeShare(r)}`;
  render(h(`
    <h1>Your monster</h1>
    <div class="total">${total} <small>of ${maxTotal()}</small></div>
    <div class="kpis">
      <div class="kpi"><div class="n">${best.score}</div><div class="l">best possible</div></div>
      <div class="kpi"><div class="n">${pct}%</div><div class="l">of best</div></div>
      <div class="kpi"><div class="n">${worst.score}</div><div class="l">worst possible</div></div>
    </div>
    <p class="note">Highlighted cells are your picks; outlined cells are the best assignment. * means a hand-rated value.</p>
    <div class="sheet-wrap"><table class="sheet">
      <thead><tr><th>Monster</th>${STAT_KEYS.map(k => `<th>${LABEL[k]}</th>`).join('')}</tr></thead>
      <tbody>${rows}</tbody></table></div>
    <div class="row" style="margin-top:16px">
      <button class="btn" data-act="play">Play again</button>
      <button class="btn ghost" data-act="copy" data-url="${esc(url)}">Copy share link</button>
      <span class="note" id="copied"></span>
    </div>
    ${stored ? '' : '<p class="note">This is a shared run; it is not stored in your list.</p>'}
  `));
}

// ---------- replay ----------

function startReplay(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { alert('That share link is not valid.'); return homeView(); }
  const monsters = drawMonsters(deck, decoded.seed);
  const stored = loadRuns(storage).find(x => x.seed === decoded.seed && x.picks.join() === decoded.picks.join());
  const mismatch = !!stored && stored.monsters.join() !== monsters.map(m => m.id).join();
  replay = {
    run: { seed: decoded.seed, monsters, picks: [] },
    picks: decoded.picks,
    mismatch,
    stored: !!stored,
    storedScore: stored ? stored.score : null,
  };
  replayStep();
}

function replayStep() {
  if (replay.mismatch) {
    render(h(`<h1>Replay</h1><p class="lead">The deck has changed since this run was played, so it cannot be
      replayed exactly. Stored result: ${replay.storedScore ?? 'unknown'}.</p>
      <div class="row"><button class="btn" data-nav="home">Home</button></div>`));
    replay = null;
    return;
  }
  if (replay.run.picks.length < replay.picks.length) {
    roundView(replay.run, { interactive: false });
  } else {
    const done = replay.run, stored = replay.stored;
    replay = null;
    endView(done, { stored });
  }
}

function replayNext() {
  const next = replay.picks[replay.run.picks.length];
  replay.run = pick(replay.run, next);
  lastFlip = next;
  replayStep();
}

// ---------- actions ----------

function play() {
  run = newRun(deck, randomSeed());
  lastFlip = null;
  roundView(run);
}

function doPick(key) {
  run = pick(run, key);
  lastFlip = key;
  if (isComplete(run)) {
    const best = bestAssignment(run.monsters), worst = worstAssignment(run.monsters);
    saveRun(storage, {
      seed: run.seed, monsters: run.monsters.map(m => m.id), picks: run.picks,
      score: score(run), best: best.score, worst: worst.score, at: new Date().toISOString(),
    });
    endView(run);
  } else {
    roundView(run);
  }
}

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    document.getElementById('copied').textContent = 'Copied.';
  } catch {
    prompt('Copy this link', url);
  }
}

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act],[data-nav]');
  if (!el || !deck) return;
  if (el.dataset.nav === 'home') return homeView();
  if (el.dataset.nav === 'runs') return runsView();
  switch (el.dataset.act) {
    case 'play': return play();
    case 'pick': return doPick(el.dataset.key);
    case 'copy': return copy(el.dataset.url);
    case 'replay': return startReplay(el.dataset.code);
    case 'replay-next': return replayNext();
  }
});

(async () => {
  try {
    deck = await loadDeck();
  } catch (err) {
    render(h(`<h1>MH Stats</h1><p class="lead">Could not load the monster deck (${esc(err.message)}). Try again later.</p>`));
    return;
  }
  const code = new URLSearchParams(location.search).get('r');
  if (code) startReplay(code); else homeView();
})();
