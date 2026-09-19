// The quiz lobby: up to eight players, ten questions, a host who starts it.
//
// This module owns its own DOM and its own polling. app.js owns the stats run and the duel
// and is already long enough; the two only meet at the nav, where each stops the other's
// polling before taking over the view.
//
// The client is deliberately ignorant. It never holds the question bank, never knows the
// correct answer until the server sends it, and never sees another player's guess before
// the question closes. Everything here renders what the server chose to say.

const API = './api/quiz';
const SEAT_KEY = 'mhstats.quizseat.v1';
const POLL_MS = 1500;

const view = document.getElementById('view');
const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const render = node => { view.replaceChildren(node); window.scrollTo({ top: 0 }); };

let seat = null;        // { code, id } — who we are in which lobby
let state = null;       // the last view payload from the server
let timer = null;       // poll interval
let ticker = null;      // countdown animation frame
let painted = null;     // what the screen is currently showing, so typing is not wiped
let lastSeen = 0;       // performance.now() when msLeft was measured
let cat = 'both';
let name = '';
let notice = '';        // something the server refused to do, waiting to be shown once
let lastPhase = null;   // so entering the lobby can adopt its category exactly once

// ---- plumbing -------------------------------------------------------------------------

async function call(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

async function fetchView() {
  const res = await fetch(`${API}/${seat.code}?you=${encodeURIComponent(seat.id)}`, { cache: 'no-store' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `lobby unavailable (${res.status})`);
  return data;
}

function remember() {
  try { window.localStorage.setItem(SEAT_KEY, JSON.stringify(seat)); } catch { /* unavailable */ }
}
function recall() {
  try { return JSON.parse(window.localStorage.getItem(SEAT_KEY) || 'null'); } catch { return null; }
}
function forget() {
  try { window.localStorage.removeItem(SEAT_KEY); } catch { /* unavailable */ }
}

function savedName() {
  try { return window.localStorage.getItem('mhstats.name.v1') || ''; } catch { return ''; }
}
function saveName(n) {
  try { window.localStorage.setItem('mhstats.name.v1', n); } catch { /* unavailable */ }
}

// Stop watching without giving up the seat: wandering off to the Monsters table and coming
// back should put you where you were, not throw you out of a lobby your friends are in.
export function pauseQuiz() {
  if (timer) { clearInterval(timer); timer = null; }
  if (ticker) { cancelAnimationFrame(ticker); ticker = null; }
  state = null; painted = null; lastPhase = null;
}

// Actually leaving: the seat goes too, so the next visit starts fresh.
export function leaveQuiz() {
  pauseQuiz();
  seat = null;
  forget();
}

function startPolling() {
  if (timer) clearInterval(timer);
  timer = setInterval(poll, POLL_MS);
}

async function poll() {
  if (!seat) return;
  try {
    state = await fetchView();
    lastSeen = performance.now();
    paint();
  } catch (err) {
    // A swept lobby is the common case here, and it is not an error worth a red screen.
    if (/no such lobby/i.test(err.message)) { leaveQuiz(); return setupView('That lobby has closed.'); }
  }
}

// ---- entry points ----------------------------------------------------------------------

export function quizView() {
  const saved = recall();
  if (saved && saved.code && saved.id) {
    seat = saved;
    startPolling();
    poll();
    return;
  }
  setupView();
}

export async function joinQuizFromUrl(code) {
  const saved = recall();
  // Rejoining after a refresh keeps the seat you already had.
  if (saved && saved.code === String(code).toUpperCase()) {
    seat = saved;
    startPolling();
    return poll();
  }
  name = savedName();
  setupView(null, String(code).toUpperCase());
}

// ---- screens ---------------------------------------------------------------------------

function setupView(problem, prefill = '') {
  painted = null;
  name = name || savedName();
  const chosen = c => (cat === c ? ' on' : '');
  render(h(`
    <h1>Quiz</h1>
    <p class="lead">Ten questions in a lobby with up to eight people. Multiple choice scores ten
      for the right answer; on an estimate you type a number and the three closest guesses take
      ten, six and three.</p>
    ${problem ? `<p class="quiz-problem">${esc(problem)}</p>` : ''}

    <div class="gens">
      <span class="gens-label">Questions</span>
      <div class="gen-list">
        <button type="button" class="gen${chosen('both')}" data-quiz="cat" data-cat="both">Both</button>
        <button type="button" class="gen${chosen('mh')}" data-quiz="cat" data-cat="mh">Monster Hunter</button>
        <button type="button" class="gen${chosen('gen')}" data-quiz="cat" data-cat="gen">General</button>
      </div>
    </div>
    <p class="note quiz-catnote">${esc(catNote())}</p>

    <div class="join quiz-name">
      <label for="quiz-name">Your name</label>
      <input id="quiz-name" class="search" maxlength="16" value="${esc(name)}" placeholder="Hunter">
    </div>

    <div class="row">
      <button class="btn" data-quiz="create">Start a lobby</button>
    </div>

    <div class="quiz-or">or join one</div>
    <div class="join">
      <input id="quiz-code" class="search code" maxlength="4" placeholder="CODE" value="${esc(prefill)}">
      <button class="btn quiet" data-quiz="join">Join</button>
    </div>`));
}

function catNote() {
  if (cat === 'mh') return 'Monsters and places from World, Iceborne, Rise, Sunbreak and Wilds.';
  if (cat === 'gen') return 'General knowledge: mostly estimates, closest guess wins.';
  return 'Five Monster Hunter questions and five general ones, shuffled together.';
}

function nameField() {
  const el = document.getElementById('quiz-name');
  return el ? el.value.trim().slice(0, 16) : '';
}

function lobbyScreen() {
  const s = state;
  const link = `${location.origin}${location.pathname}?quiz=${s.code}`;
  const host = s.players.find(p => p.isHost);
  render(h(`
    <h1>Lobby</h1>
    <p class="lead">Read the code out, or send the link. The host starts when everyone is in.</p>
    ${noticeLine()}
    <p class="room-code">${esc(s.code)}</p>
    <p class="invite">${esc(link)}</p>
    <div class="row" style="margin-top:10px">
      <button class="btn quiet" data-quiz="copy" data-url="${esc(link)}">Copy link</button>
      <span id="copied" class="note"></span>
    </div>

    <h2 class="quiz-h2">In the lobby (${s.players.length}/8)</h2>
    <ul class="quiz-players">
      ${s.players.map(p => `<li><span class="quiz-who">${esc(p.name)}</span>${p.isHost ? '<span class="quiz-tag">host</span>' : ''}${p.id === s.you.id ? '<span class="quiz-tag you">you</span>' : ''}</li>`).join('')}
    </ul>

    ${s.you.isHost
      ? `<div class="gens" style="margin-top:20px">
          <span class="gens-label">Questions</span>
          <div class="gen-list">
            <button type="button" class="gen${cat === 'both' ? ' on' : ''}" data-quiz="cat" data-cat="both">Both</button>
            <button type="button" class="gen${cat === 'mh' ? ' on' : ''}" data-quiz="cat" data-cat="mh">Monster Hunter</button>
            <button type="button" class="gen${cat === 'gen' ? ' on' : ''}" data-quiz="cat" data-cat="gen">General</button>
          </div>
        </div>`
      : ''}
    <p class="note quiz-catnote">${esc(catNote())}</p>
    <div class="row" style="margin-top:16px">
      ${s.you.isHost
        ? `<button class="btn" data-quiz="start">Start the quiz</button>`
        : `<span class="note">Waiting for ${esc(host ? host.name : 'the host')} to start.</span>`}
      <button class="btn quiet" data-quiz="leave">Leave</button>
    </div>`));
}

function askScreen() {
  const s = state;
  const q = s.question;
  const locked = s.players.filter(p => p.answered).length;
  const playing = s.players.filter(p => p.playing).length;

  const body = s.you.answered
    ? `<p class="quiz-locked">Locked in${s.you.answer !== null ? `: <strong>${esc(formatAnswer(s.you.answer, q))}</strong>` : ''}. Waiting for the others.</p>`
    : q.kind === 'choice'
      ? `<div class="quiz-options">
           ${q.options.map((o, i) => `<button type="button" class="quiz-option" data-quiz="answer" data-value="${i}">${esc(o)}</button>`).join('')}
         </div>`
      : `<div class="join quiz-estimate">
           <input id="quiz-guess" class="search" type="number" inputmode="decimal" step="any" placeholder="your guess">
           <span class="quiz-unit">${esc(q.unit || '')}</span>
           <button class="btn" data-quiz="guess">Lock it in</button>
         </div>
         <p class="note">Closest three score 10, 6 and 3. A wild guess scores nothing.</p>`;

  render(h(`
    <div class="quiz-bar"><div class="quiz-bar-fill" id="quiz-bar"></div></div>
    <p class="quiz-meta"><span>Question ${s.round} of ${s.total}</span>
      <span class="quiz-cat">${q.cat === 'mh' ? 'Monster Hunter' : 'General'}</span>
      <span id="quiz-locked">${locked} of ${playing} locked in</span></p>
    ${noticeLine()}
    <h1 class="quiz-q">${esc(q.q)}</h1>
    ${body}
    ${s.you.playing ? '' : '<p class="note">You joined after this one started — you are in from the next quiz.</p>'}
    <ol class="quiz-scores compact">
      ${s.players.map(p => `<li><span class="quiz-who">${esc(p.name)}</span><span class="quiz-pts">${p.score}</span></li>`).join('')}
    </ol>
    ${exitRow(s)}`));
  tick();
}

// Every screen during a running quiz needs a way out. Without this, starting a quiz by
// accident — or with the wrong category, or before somebody had arrived — meant sitting
// through all ten questions, because Leave only existed in the lobby and on the final table.
//
// "End quiz" is the host's, because it ends the game for everyone; it hands the lobby back
// with all the players still seated, ready to start another. Leaving is anybody's and needs
// no server at all.
function exitRow(s) {
  return `<div class="row quiz-exit">
    ${s.you.isHost ? '<button class="btn quiet" data-quiz="cancel">End quiz</button>' : ''}
    <button class="btn quiet" data-quiz="leave">Leave</button>
  </div>`;
}

function formatAnswer(value, q) {
  if (!q) return String(value);
  if (q.kind === 'choice') return (q.options && q.options[value] !== undefined) ? q.options[value] : String(value);
  return `${trim(value)}${q.unit ? ` ${q.unit}` : ''}`;
}

// Numbers come back as written; long decimals help nobody on a result screen.
function trim(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  if (Math.abs(num) >= 1000) return num.toLocaleString('en-GB', { maximumFractionDigits: 0 });
  return String(Math.round(num * 100) / 100);
}

function revealScreen() {
  const s = state;
  const q = s.question;
  const r = s.reveal;
  const right = q.kind === 'choice'
    ? (r.options && r.options[r.answer] !== undefined ? r.options[r.answer] : String(r.answer))
    : `${trim(r.answer)}${r.unit ? ` ${r.unit}` : ''}`;

  render(h(`
    <p class="quiz-meta"><span>Question ${s.round} of ${s.total}</span>
      <span class="quiz-cat">${q.cat === 'mh' ? 'Monster Hunter' : 'General'}</span></p>
    <h1 class="quiz-q">${esc(q.q)}</h1>
    <p class="quiz-answer">${esc(right)}</p>
    ${sourceLine(r.src)}
    ${q.kind === 'estimate' ? scaleFor(r) : ''}
    <ul class="quiz-results">
      ${r.results.length
        ? r.results.map(x => `<li class="${x.points ? 'scored' : ''}">
            <span class="quiz-who">${esc(x.name)}</span>
            <span class="quiz-said">${esc(formatAnswer(x.answer, q))}</span>
            <span class="quiz-pts">${x.points ? `+${x.points}` : '—'}</span></li>`).join('')
        : '<li class="quiz-nobody">Nobody answered in time.</li>'}
    </ul>
    <ol class="quiz-scores">
      ${s.players.map((p, i) => `<li><span class="quiz-rank">${i + 1}</span><span class="quiz-who">${esc(p.name)}</span><span class="quiz-pts">${p.score}</span></li>`).join('')}
    </ol>
    ${exitRow(s)}`));
}

// A source is worth showing — it is what makes an argument about an answer end. But
// "deck.json:rey-dau.raw.size_base" is a note to ourselves, not to a player, so local
// sources are named in words.
const LOCAL_SOURCES = [
  [/^deck\.json:/, 'the game\'s own numbers'],
  [/^roster\.json:/, 'the series roster'],
];

function sourceLine(src) {
  if (!src) return '';
  if (/^https?:\/\//.test(src)) {
    return `<p class="note quiz-src"><a href="${esc(src)}" target="_blank" rel="noopener noreferrer">source</a></p>`;
  }
  const named = LOCAL_SOURCES.find(([re]) => re.test(src));
  return `<p class="note quiz-src">from ${esc(named ? named[1] : src)}</p>`;
}

// Where everyone landed against the real number. Log-ish placement would be cleverer, but a
// plain linear scale is what people expect to read.
function scaleFor(r) {
  const guesses = r.results.map(x => x.answer);
  if (!guesses.length) return '';
  const lo = Math.min(r.answer, ...guesses);
  const hi = Math.max(r.answer, ...guesses);
  const span = hi - lo || 1;
  // Inset by 4% at each end so a marker sitting exactly on the minimum or maximum — which
  // happens constantly, since the ends ARE somebody's guess — is not drawn half off the track.
  const at = v => `${4 + ((v - lo) / span) * 92}%`;
  return `<div class="quiz-scale">
    <div class="quiz-scale-track">
      <div class="quiz-scale-true" style="left:${at(r.answer)}" title="the answer"><span>answer</span></div>
      ${r.results.map(x => `<div class="quiz-scale-pin${x.points ? ' scored' : ''}" style="left:${at(x.answer)}" title="${esc(x.name)}: ${esc(trim(x.answer))}"></div>`).join('')}
    </div>
    <div class="quiz-scale-ends"><span>${esc(trim(lo))}</span><span>${esc(trim(hi))}</span></div>
  </div>`;
}

function overScreen() {
  const s = state;
  const winner = s.players[0];
  const tied = s.players.filter(p => p.score === winner.score);
  render(h(`
    <h1>Final scores</h1>
    ${noticeLine()}
    <p class="lead">${tied.length > 1
      ? `${esc(tied.map(p => p.name).join(' and '))} tied on ${winner.score}.`
      : `${esc(winner.name)} takes it with ${winner.score}.`}</p>
    <ol class="quiz-scores final">
      ${s.players.map((p, i) => `<li><span class="quiz-rank">${i + 1}</span><span class="quiz-who">${esc(p.name)}</span><span class="quiz-pts">${p.score}</span></li>`).join('')}
    </ol>
    <div class="row" style="margin-top:18px">
      ${s.you.isHost
        ? '<button class="btn" data-quiz="again">Play again</button>'
        : '<span class="note">Waiting for the host to start another.</span>'}
      <button class="btn quiet" data-quiz="leave">Leave</button>
    </div>
    <p class="note" style="margin-top:14px">Same lobby, same code — nobody has to rejoin.</p>`));
}

// ---- painting --------------------------------------------------------------------------

// Re-rendering on every poll would wipe a half-typed number, so the screen is only rebuilt
// when something it shows has actually changed. Between rebuilds the countdown and the
// locked-in count are patched in place.
function signature(s) {
  return [
    s.phase, s.round, s.you.answered, s.you.playing,
    s.players.map(p => `${p.id}:${p.score}:${p.answered ? 1 : 0}`).join(','),
  ].join('|');
}

function paint() {
  if (!state) return;
  // Arriving in a lobby — joining one, or being handed it back by a cancel — adopts its
  // category. Only on the way IN, so a host switching the tabs while sitting there is not
  // overwritten by the next poll.
  if (state.phase === 'lobby' && lastPhase !== 'lobby') cat = state.cat;
  lastPhase = state.phase;
  const sig = signature(state);
  if (sig === painted) return patch();
  painted = sig;
  if (state.phase === 'lobby') return lobbyScreen();
  if (state.phase === 'asking') return askScreen();
  if (state.phase === 'reveal') return revealScreen();
  if (state.phase === 'over') return overScreen();
}

function patch() {
  const el = document.getElementById('quiz-locked');
  if (el && state.question) {
    const locked = state.players.filter(p => p.answered).length;
    const playing = state.players.filter(p => p.playing).length;
    el.textContent = `${locked} of ${playing} locked in`;
  }
  tick();
}

// The bar is drawn from msLeft plus however long ago that was measured, so it runs smoothly
// at 60fps while the poll stays at 1.5s and nothing depends on the player's clock.
function tick() {
  if (ticker) cancelAnimationFrame(ticker);
  const bar = document.getElementById('quiz-bar');
  if (!bar || !state || state.phase !== 'asking') return;
  // The bar is drawn against the phase's FULL length, not against what is left of it.
  // Using msLeft as the denominator made it snap back to 100% on every poll, because at
  // the moment of measurement the remaining time is by definition all of the remaining time.
  const total = state.msTotal || state.msLeft;
  const atPoll = state.msLeft;
  if (!total || !atPoll) { bar.style.width = '0%'; return; }
  const measured = lastSeen;
  const step = () => {
    const left = Math.max(0, atPoll - (performance.now() - measured));
    bar.style.width = `${(left / total) * 100}%`;
    bar.classList.toggle('urgent', left < 6000);
    if (left > 0) ticker = requestAnimationFrame(step);
  };
  step();
}

// ---- actions ---------------------------------------------------------------------------

async function createQuiz() {
  name = nameField();
  if (name) saveName(name);
  try {
    state = await call('', { cat, name });
    lastSeen = performance.now();
    seat = { code: state.code, id: state.you.id };
    remember();
    painted = null;
    startPolling();
    paint();
  } catch (err) { setupView(err.message); }
}

async function joinQuiz() {
  const el = document.getElementById('quiz-code');
  const code = (el ? el.value : '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4}$/.test(code)) return setupView('A lobby code is four characters.');
  name = nameField();
  if (name) saveName(name);
  try {
    state = await call(`/${code}/join`, { name });
    lastSeen = performance.now();
    seat = { code: state.code, id: state.you.id };
    remember();
    painted = null;
    startPolling();
    paint();
  } catch (err) { setupView(err.message, code); }
}

async function act(path, body) {
  if (!seat) return;
  try {
    state = await call(`/${seat.code}${path}`, { you: seat.id, ...body });
    lastSeen = performance.now();
    paint();
  } catch (err) {
    // Losing a race to the timer is normal and the poll will show what actually happened.
    // Anything else has to be SAID: a host pressing Start and watching nothing happen is
    // the worst possible way to find out the server refused.
    if (!/already answered|no question is open/i.test(err.message)) {
      notice = err.message;
      painted = null;
    }
    poll();
  }
}

// Shown once, then cleared, so it does not haunt every later repaint.
function noticeLine() {
  if (!notice) return '';
  const said = notice;
  notice = '';
  return `<p class="quiz-problem">${esc(said)}</p>`;
}

function submitGuess() {
  const el = document.getElementById('quiz-guess');
  if (!el) return;
  const value = Number(el.value);
  if (!Number.isFinite(value)) { el.focus(); return; }
  act('/answer', { value });
}

async function copyLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    const el = document.getElementById('copied');
    if (el) el.textContent = 'Copied.';
  } catch { prompt('Copy this link', url); }
}

// Quiz controls carry data-quiz so app.js's own delegated handler, which looks for
// data-act and data-nav, never sees them.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-quiz]');
  if (!el) return;
  switch (el.dataset.quiz) {
    // Keep whatever they have typed: switching category used to wipe the name field.
    case 'cat': {
      name = nameField() || name;
      cat = el.dataset.cat;
      // In a lobby the tabs sit next to Start, so repaint the lobby rather than the form.
      if (seat && state && state.phase === 'lobby') { painted = null; return paint(); }
      return setupView();
    }
    // Two steps, mutating the button rather than repainting: ending a quiz ends it for up
    // to seven other people, and a repaint here would wipe a half-typed guess.
    case 'cancel': {
      if (el.dataset.armed !== '1') {
        el.dataset.armed = '1';
        el.textContent = 'End it for everyone?';
        return;
      }
      return act('/cancel');
    }
    case 'create': return createQuiz();
    case 'join': return joinQuiz();
    case 'start': return act('/start', { cat });
    case 'answer': return act('/answer', { value: Number(el.dataset.value) });
    case 'guess': return submitGuess();
    case 'again': return act('/again');
    case 'copy': return copyLink(el.dataset.url);
    case 'leave': { leaveQuiz(); return setupView(); }
  }
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'quiz-guess') { e.preventDefault(); submitGuess(); }
  if (e.target.id === 'quiz-code') { e.preventDefault(); joinQuiz(); }
});
