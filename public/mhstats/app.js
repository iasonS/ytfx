import {
  STATS, STAT_KEYS, ROUNDS, newRun, currentMonster, pick, isComplete, score, valueOf,
  encodeShare, decodeShare, randomSeed,
  GENS, ALL_GENS, poolFor, AIM_HIGH, AIM_LOW, isAim, outcome,
  canReroll, reroll, rebuildRun,
} from './game.js';
import { loadRuns, saveRun, topRuns, aimOf } from './storage.js';
import { quizView, joinQuizFromUrl, pauseQuiz } from './quiz.js';

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
// The live duel this browser is in, once it has a room. Null for a solo run.
let room = null;
let roomTimer = null;
// What a new room will deal: one seven for both players, or one each.
let roomDraw = 's';
let phase = 'idle';      // idle | spinning | picking | done
let reelTimer = null;
let reelPool = [];
let replay = null;

const h = html => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const byId = id => deck.monsters.find(m => m.id === id);
function render(node) { view.replaceChildren(node); window.scrollTo({ top: 0 }); }

// Resolved against this MODULE's url rather than the page's, so it picks up the /v-<hash>/
// prefix the page was loaded with. A plain './deck.json' resolves against the document and
// would fetch the unversioned copy — the deck and the code that reads it have to match.
// No cache-busting needed once the URL carries the version: that is the whole point.
async function loadDeck() {
  const res = await fetch(new URL('./deck.json', import.meta.url));
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
    <p class="note" style="margin:14px 0 0">${pool} monster${pool === 1 ? '' : 's'}.
      Pick at least ${ROUNDS * 2} to play: seven to face, and a reserve behind each for the reroll.</p>
  `));
}

function startOrBlock() {
  if (poolFor(deck, genMask).length < ROUNDS * 2) return tooFewView();
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

// ---- live duels --------------------------------------------------------------------
// Two browsers, one room, the same seven monsters. The server holds the room and decides
// what each side is allowed to know: while anyone is still picking it will only say how far
// the opponent has got, never what they took, because a browser cannot be trusted to hide a
// number it has been given. So the "waiting" states here are not politeness, they are the
// only moment the scores can safely be revealed.
const POLL_MS = 1500;
const ROOM_KEY = 'mhstats.room.v1';
const API = './api/rooms';

const roomLink = code => `${location.origin}${location.pathname}?room=${code}`;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `request failed (${res.status})`);
  return data;
}

function rememberRoom() {
  try {
    if (room) window.sessionStorage.setItem(ROOM_KEY, JSON.stringify({ code: room.code, me: room.me }));
    else window.sessionStorage.removeItem(ROOM_KEY);
  } catch { /* unavailable */ }
}
function recallRoom() {
  try { return JSON.parse(window.sessionStorage.getItem(ROOM_KEY) || 'null'); } catch { return null; }
}

function leaveRoom() {
  if (roomTimer) { clearInterval(roomTimer); roomTimer = null; }
  room = null;
  rememberRoom();
}

// One poll drives the whole duel: it starts the run when the opponent arrives, refreshes
// their progress while you play, and ends it when the server finally hands over their picks.
async function pollRoom() {
  if (!room) return;
  let state;
  try {
    state = await api(`/${room.code}?you=${encodeURIComponent(room.me)}`);
  } catch (err) {
    // A room that has been swept, or a network blip. Only the first is worth acting on.
    if (/no such room|not a player/i.test(err.message)) {
      leaveRoom();
      render(h(`<h1>The room is gone</h1>
        <p class="lead">${esc(err.message)}. Rooms are kept for half an hour.</p>
        <div class="row"><button class="btn" data-nav="duel">Start another</button></div>`));
    }
    return;
  }

  const wasWaiting = !room.started;
  // Captured BEFORE the merge: spreading the new state over the old overwrites the round,
  // so comparing afterwards always says nothing changed and no rematch ever starts.
  const lastRound = room.round;
  room = { ...room, ...state };

  // A rematch keeps the room and deals a new seven, so the round number is what says "this
  // is a different game" rather than the seed, which a re-read could repeat.
  if (state.round !== lastRound) {
    room.shown = null;
    run = rebuildRun(deck, { seed: state.seed, mask: state.mask, aim: state.aim, picks: [] });
    room.monsters = run.monsters;
    preloadPlates();
    phase = 'spinning';
    return roundView();
  }

  if (state.bothDone) {
    // Drawn once. The poll keeps running so a rematch can arrive, and redrawing the result
    // under the player every 1.5 seconds would make it unreadable.
    if (room.shown === 'result') return refreshRematchRow();
    room.shown = 'result';
    const finished = rebuildRun(deck, {
      seed: state.seed, mask: state.mask, aim: state.aim,
      rerollAt: state.you.rerollAt, picks: state.you.picks,
    });
    // Their run is rebuilt from their own seed and reroll, because on a random-draw room
    // they never faced the same monsters as you.
    const theirRun = rebuildRun(deck, {
      seed: state.them.seed, mask: state.mask, aim: state.aim,
      rerollAt: state.them.rerollAt, picks: state.them.picks,
    });
    const against = {
      picks: state.them.picks, code: room.code, draw: state.draw,
      monsters: theirRun.monsters, run: theirRun,
    };
    // A duel run is still your run, so it joins the others rather than vanishing.
    const o = outcome(finished);
    saveRun(storage, {
      seed: finished.seed, mask: finished.mask, aim: finished.aim,
      monsters: finished.monsters.map(m => m.id), picks: finished.picks,
      score: o.total, best: o.best.score, worst: o.worst.score,
      at: new Date().toISOString(),
    });
    resultView(finished, { against });
    return;
  }
  room.shown = null;

  if (!state.them.joined) { roomWaitView(); return; }

  if (wasWaiting) {
    // The opponent has arrived: deal the run this side will play. On a random-draw room
    // the seed is this player's own, so the two boards differ by design.
    room.started = true;
    aim = state.aim;
    genMask = state.mask;
    run = rebuildRun(deck, {
      seed: state.seed, mask: state.mask, aim: state.aim,
      rerollAt: state.you.rerollAt, picks: state.you.picks.slice(),
    });
    room.monsters = run.monsters;
    preloadPlates();
    phase = run.picks.length >= ROUNDS ? 'done' : 'spinning';
    if (phase === 'done') return roomWaitView();
    return roundView();
  }

  if (state.you.done) return roomWaitView();
  // Mid-run: only the opponent's progress can have changed, so redraw that strip alone
  // rather than the whole view, which would restart the reel under the player.
  const strip = view.querySelector('.rival');
  if (strip) strip.outerHTML = rivalStrip();
}

// Sits under the result of a duel: ask for another, or say who is waiting on whom.
function rematchRow() {
  if (!room) return '';
  const mine = room.you?.wantsAgain, theirs = room.them?.wantsAgain;
  const label = mine ? 'Waiting for them\u2026' : theirs ? 'They want another \u2014 accept' : 'Duel again';
  return `<span class="again">
    <button class="btn${mine ? ' quiet' : ''}" data-act="room-again" ${mine ? 'disabled' : ''}>${label}</button>
    <span class="note">${mine ? 'They will drop straight into the next one.'
      : theirs ? 'Same room, a new seven.' : `Same room \u00b7 ${esc(room.code)}`}</span>
  </span>`;
}

// Only the rematch row changes while the result is on screen, so only it is redrawn.
function refreshRematchRow() {
  const slot = view.querySelector('.again');
  if (slot) slot.outerHTML = rematchRow();
}

async function askAgain() {
  if (!room) return;
  try {
    const lastRound = room.round;
    const state = await api(`/${room.code}/again`, { method: 'POST', body: { you: room.me } });
    // Accepting an offer that was already waiting starts the next round at once rather than
    // leaving this player on a stale result until the next poll. The merge is left to
    // pollRoom, because merging here would advance room.round and hide the change from it.
    if (state.round !== lastRound) return pollRoom();
    room = { ...room, ...state };
    refreshRematchRow();
  } catch (err) { roomError(err.message); }
}

function startPolling() {
  if (roomTimer) clearInterval(roomTimer);
  roomTimer = setInterval(pollRoom, POLL_MS);
}

// How far the other player has got, and nothing else: seven pips, filled as they pick.
function rivalStrip() {
  if (!room) return '';
  const them = room.them ?? { joined: false, picked: 0, done: false };
  const pips = Array.from({ length: ROUNDS }, (_, i) =>
    `<span class="pip${i < them.picked ? ' on' : ''}"></span>`).join('');
  const state = !them.joined ? 'waiting to join'
    : them.done ? 'finished' : `${them.picked} of ${ROUNDS} picked`;
  // Whether they spent their reroll is not their score, so it can be shown as it happens.
  const spent = them.joined && them.rerolled ? '<span class="rival-state">reroll spent</span>' : '';
  return `<div class="rival">
    <span class="rival-who">Them</span>
    <span class="rival-pips">${pips}</span>
    <span class="rival-state">${state}</span>
    ${spent}
    <span class="rival-note">Their score stays hidden until you both finish.</span>
  </div>`;
}

function duelLobbyView() {
  stopReelTimer();
  leaveRoom();
  phase = 'idle';
  render(h(`
    <h1>Duel someone</h1>
    <p class="lead">You both get the same seven monsters and pick at the same time.
      Neither of you sees the other's score until you have both finished.</p>
    ${genRow()}
    <div class="challenge">
      <span class="gens-label">Monsters</span>
      <div class="gen-list">
        <button type="button" class="aim${roomDraw === 's' ? ' on' : ''}" data-act="room-draw" data-draw="s"
          aria-pressed="${roomDraw === 's' ? 'true' : 'false'}"
          title="Both of you face the identical seven. The higher total wins outright.">the same seven</button>
        <button type="button" class="aim${roomDraw === 'r' ? ' on' : ''}" data-act="room-draw" data-draw="r"
          aria-pressed="${roomDraw === 'r' ? 'true' : 'false'}"
          title="You each get your own seven. Totals would not be comparable, so it is scored on how near each of you came to your own perfect line.">one each</button>
      </div>
      <span class="note">${roomDraw === 's'
        ? 'Same monsters, so the higher total wins outright.'
        : 'Different monsters, so whoever plays their own draw better wins.'}</span>
    </div>
    <div class="row" style="margin-top:18px">
      <button class="btn" data-act="room-create">Create a room</button>
    </div>
    <h2>Or join one</h2>
    <form class="join" data-act="room-join-form">
      <input class="search code" name="code" maxlength="4" autocomplete="off" autocapitalize="characters"
        spellcheck="false" placeholder="CODE" aria-label="Room code">
      <button class="btn quiet" type="submit">Join</button>
    </form>
    <p class="note" id="room-error"></p>
  `));
  const form = view.querySelector('.join');
  if (form) form.addEventListener('submit', e => { e.preventDefault(); joinRoom(form.code.value); });
}

function roomError(message) {
  const slot = view.querySelector('#room-error');
  if (slot) slot.textContent = message;
  else render(h(`<h1>That did not work</h1><p class="lead">${esc(message)}</p>
    <div class="row"><button class="btn" data-nav="duel">Try again</button></div>`));
}

async function createRoom() {
  try {
    const state = await api('', { method: 'POST', body: { mask: genMask, aim, draw: roomDraw } });
    room = { ...state, me: state.you.id, started: false, shown: null };
    rememberRoom();
    roomWaitView();
    startPolling();
  } catch (err) { roomError(err.message); }
}

async function joinRoom(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (code.length !== 4) return roomError('A room code is four characters.');
  try {
    const state = await api(`/${code}/join`, { method: 'POST', body: {} });
    room = { ...state, me: state.you.id, started: false, shown: null };
    rememberRoom();
    roomWaitView();
    startPolling();
    pollRoom();
  } catch (err) { roomError(err.message); }
}

// Shown twice: before the opponent arrives, and after you finish while they are still going.
function roomWaitView() {
  stopReelTimer();
  const waitingForPlayer = !room.them?.joined;
  const link = roomLink(room.code);
  render(h(`
    <h1>${waitingForPlayer ? 'Waiting for someone to join' : 'Waiting for them to finish'}</h1>
    ${waitingForPlayer
      ? `<p class="lead">Give them the code, or the link. The duel starts the moment they join.</p>
         <p class="room-code">${esc(room.code)}</p>
         <p class="invite">${esc(link)}</p>
         <div class="row" style="margin-top:14px">
           <button class="btn" data-act="copy" data-url="${esc(link)}">Copy the link</button>
           <button class="btn quiet" data-act="room-leave">Cancel</button>
           <span class="note" id="copied"></span>
         </div>`
      : `<p class="lead">You are done. Their score appears here as soon as they finish, and not before.</p>
         ${rivalStrip()}
         <div class="row" style="margin-top:14px">
           <button class="btn quiet" data-act="room-leave">Leave the duel</button>
         </div>`}
  `));
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
    ${room ? `<p class="note" style="margin:0 0 10px">Duel \u00b7 room ${esc(room.code)} \u00b7 aiming ${
      (r.aim ?? aim) === AIM_LOW ? 'low' : 'high'}</p>` : genRow()}
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
               ${replay ? '' : `<div class="instruct">Pick a stat.${canReroll(r)
                 ? ' <button type="button" class="reroll" data-act="reroll">Reroll this one</button>'
                 : ' <span class="spent">Reroll spent.</span>'}</div>`}`}
        </div>
      </div>
      <div class="ledger">${ledgerRows(r, !spinning && !replay)}</div>
    </div>
    ${room ? rivalStrip() : ''}
    ${tallyStrip(r)}
    ${replay ? `<div class="row" style="margin-top:16px">
      <button class="btn" data-act="replay-next">${spinning ? 'Stop' : 'Next monster'}</button></div>` : ''}
  `));
  if (spinning) startReel();
}

// One sheet: the seven monsters, what you took, and what the line you were chasing would
// have taken. `against` is the opponent's finished run in a duel, drawn as a second row of
// picks on the same sheet so the two are read side by side rather than as two tables.
function resultSheet(r, perfect, low, against) {
  return r.monsters.map((m, i) => {
    const mine = r.picks[i], top = perfect.picks[i], theirs = against ? against.picks[i] : null;
    // Against the line this run was chasing, for THIS monster. That line is a whole-run
    // optimum and will take a worse stat here to free a better one elsewhere, so it comes
    // out positive as readily as negative. The seven sum to your total minus the perfect one.
    const raw = m.stats[mine] - m.stats[top];
    // Aiming low, sitting UNDER that line is the good direction, so the colour flips.
    const gain = low ? -raw : raw;
    const cells = STAT_KEYS.map(k => {
      const cls = [k === mine ? 'mine' : '', k === top ? 'top' : '', k === theirs ? 'theirs' : '']
        .filter(Boolean).join(' ');
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
}

function resultView(r, opts = {}) {
  const { stored = true, shared = false, against = null } = opts;
  stopReelTimer();
  phase = 'done';
  const o = outcome(r);
  // `perfect` is the line this run was chasing: the best line aiming high, the worst aiming
  // low. Every label below reads off it, so one screen serves both aims.
  const { total, best, worst, perfect, pct, low } = o;
  const span = best.score - worst.score;
  const at = span > 0 ? Math.min(97, Math.max(3, ((total - worst.score) / span) * 100)) : 100;

  // Against a random draw the two totals are not comparable, because one seven can simply
  // be worth more than another, so those duels are settled on how near each player came to
  // their OWN perfect line. On a shared draw the totals ARE the comparison, and their score
  // sits on the same track as yours.
  const apart = !!against && against.draw === 'r';
  const theirOutcome = against ? outcome(against.run ?? { ...r, picks: against.picks }) : null;
  const theirTotal = theirOutcome ? theirOutcome.total : null;
  const markAt = against && !apart && span > 0
    ? Math.min(97, Math.max(3, ((theirTotal - worst.score) / span) * 100)) : null;

  let banner = '';
  if (against) {
    const mine = apart ? pct : total;
    const theirs = apart ? theirOutcome.pct : theirTotal;
    const won = apart || !low ? mine > theirs : mine < theirs;
    const drew = mine === theirs;
    const unit = v => (apart ? `${v}%` : v);
    banner = `<div class="duel ${drew ? 'draw' : won ? 'won' : 'lost'}">
      <span class="duel-verdict">${drew ? 'A draw' : won ? 'You win' : 'They win'}</span>
      <span class="duel-line">You <b>${unit(mine)}</b>${apart ? ` <i>${total}</i>` : ''}</span>
      <span class="duel-line">Them <b>${unit(theirs)}</b>${apart ? ` <i>${theirTotal}</i>` : ''}</span>
      <span class="duel-note">${apart
        ? `You each had your own seven, so this is scored on how near you came to your own ${low ? 'floor' : 'best'}. Room ${esc(against.code)}.`
        : `${low ? 'Lower wins.' : 'Higher wins.'} Room ${esc(against.code)}.`}</span>
    </div>`;
  } else if (shared) {
    banner = `<div class="duel shared">
      <span class="duel-verdict">Someone’s run</span>
      <span class="duel-note">They were aiming ${low ? 'low' : 'high'}.</span>
      <button class="btn" data-act="play">Play your own</button>
    </div>`;
  }

  const url = `${location.origin}${location.pathname}?r=${encodeShare(r)}`;
  render(h(`
    ${banner}
    <header class="verdict">
      <p class="verdict-score"><b>${total}</b><span>points, aiming ${low ? 'low' : 'high'}</span></p>
      <div class="range">
        <div class="range-track" style="--at:${at}%">${
          markAt === null ? '' : `<u style="--them:${markAt}%" title="Their score: ${theirTotal}"></u>`}<i></i></div>
        <div class="range-ends">
          <span${low ? ' class="range-best"' : ''}><b>${worst.score}</b> ${low ? 'floor' : 'worst'}</span>
          <span class="range-share">${pct}% of ${low ? 'floor' : 'best'}</span>
          <span${low ? '' : ' class="range-best"'}><b>${best.score}</b> ${low ? 'worst' : 'best'}</span>
        </div>
      </div>
    </header>
    <div class="sheet-scroll"><table class="sheet">
      <thead><tr><th>Monster</th>${STAT_KEYS.map(k => `<th title="${esc(HELP[k])}">${LABEL[k]}</th>`).join('')}<th>vs ${low ? 'floor' : 'best'}</th></tr></thead>
      <tbody>${resultSheet(r, perfect, low, apart ? null : against)}</tbody></table></div>
    <p class="key">
      <span class="k-mine">Your pick</span>
      <span class="k-top">${low ? 'Lowest line' : 'Best pick'}</span>
      ${against && !apart ? '<span class="k-theirs">Their pick</span>' : ''}
    </p>
    <div class="row" style="margin-top:20px">
      ${against ? rematchRow() : '<button class="btn" data-act="play">Play again</button>'}
      ${against ? '<button class="btn quiet" data-act="room-leave">Leave the room</button>'
        : '<button class="btn quiet" data-nav="duel">Duel someone</button>'}
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
  leaveRoom();
  run = newRun(deck, randomSeed(), genMask, aim);
  preloadPlates();
  phase = 'spinning';
  roundView();
}

function assign(key) {
  if (phase !== 'picking') return;
  run = pick(run, key);
  if (room) return assignInRoom(key);
  if (isComplete(run)) {
    const o = outcome(run);
    saveRun(storage, {
      seed: run.seed, mask: run.mask, aim: run.aim, monsters: run.monsters.map(m => m.id),
      picks: run.picks, score: o.total, best: o.best.score, worst: o.worst.score,
      at: new Date().toISOString(),
    });
    resultView(run);
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
  // In a duel the aim is the room's, not yours, so this only reaches a solo run.
  replay = null;
  if (room && !room.started) return duelLobbyView();
  startOrBlock();
}

// In a duel the pick is also sent to the room, because the server is what decides when
// the two scores may be compared. The local run has already advanced, so a rejected pick
// means the two have drifted and the poll will put it right.
async function assignInRoom(key) {
  phase = isComplete(run) ? 'done' : 'spinning';
  if (isComplete(run)) roomWaitView(); else roundView();
  try {
    const state = await api(`/${room.code}/pick`, { method: 'POST', body: { you: room.me, stat: key } });
    room = { ...room, ...state };
    if (state.bothDone) return pollRoom();
    const strip = view.querySelector('.rival');
    if (strip) strip.outerHTML = rivalStrip();
  } catch (err) {
    roomError(err.message);
  }
}

async function useReroll() {
  if (phase !== 'picking' || !run || !canReroll(run)) return;
  // The server records it first in a duel: it is what lets the other client rebuild this
  // run at the reveal, and a reroll the server never saw would make the two disagree.
  if (room) {
    try {
      const state = await api(`/${room.code}/reroll`, { method: 'POST', body: { you: room.me } });
      room = { ...room, ...state };
    } catch (err) { return roomError(err.message); }
  }
  run = reroll(run);
  if (room) room.monsters = run.monsters;
  phase = 'spinning';
  roundView();
}

function toggleGen(g) {
  const next = genMask ^ (1 << (g - 1));
  if (next === 0) return;
  genMask = next;
  saveGenMask(genMask);
  if (poolFor(deck, genMask).length < ROUNDS * 2) return tooFewView();
  if (phase === 'idle') startOrBlock(); else { preloadPlates(); roundView(); }
}

// A link someone sent. It used to drop you into a step-through that looked exactly like a
// new game, so a shared link read as "it just opens the page". Show the finished run
// instead, and offer the same seven monsters as a challenge.
function showShared(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { return badLink(); }
  if (decoded.picks.length !== ROUNDS) return badLink();
  // rebuildRun, not drawMonsters: a run that spent its reroll faced a different seven, and
  // redrawing without it would show picks against monsters that were never on the table.
  const theirs = rebuildRun(deck, decoded);
  leaveRoom();
  replay = null;
  resultView(theirs, { stored: false, shared: true });
}

function badLink() {
  render(h(`<h1>That link did not work</h1>
    <p class="lead">It is not a run this game can read. It may have been cut short when it was copied.</p>
    <div class="row"><button class="btn" data-nav="home">Play</button></div>`));
}

function startReplay(code) {
  let decoded;
  try { decoded = decodeShare(code); } catch { alert('That link is not a valid run.'); return startOrBlock(); }
  const rebuilt = rebuildRun(deck, { ...decoded, picks: [] });
  const monsters = rebuilt.monsters;
  const stored = loadRuns(storage).find(x => x.seed === decoded.seed && x.picks.join() === decoded.picks.join());
  if (stored && stored.monsters.join() !== monsters.map(m => m.id).join()) {
    render(h(`<h1>Can't replay this run</h1>
      <p class="lead">The monster list changed since this run, so it would draw different monsters.
        It scored ${stored.score}.</p>
      <div class="row"><button class="btn" data-nav="home">Play</button></div>`));
    return;
  }
  replay = { run: rebuilt, picks: decoded.picks, stored: !!stored };
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
  // Leaving the quiz for another screen stops its polling but keeps the seat, so coming
  // back rejoins the lobby your friends are still sitting in.
  if (el.dataset.nav && el.dataset.nav !== 'quiz') pauseQuiz();
  if (el.dataset.nav === 'home') return startOrBlock();
  if (el.dataset.nav === 'duel') return duelLobbyView();
  if (el.dataset.nav === 'quiz') { leaveRoom(); return quizView(); }
  if (el.dataset.nav === 'runs') return recordsView();
  if (el.dataset.nav === 'monsters') return monstersView();
  switch (el.dataset.act) {
    case 'play': return play();
    case 'stop': return stopReel();
    case 'assign': return assign(el.dataset.key);
    case 'gen': return toggleGen(Number(el.dataset.gen));
    case 'aim': return setAim(el.dataset.aim);
    case 'room-create': return createRoom();
    case 'room-draw': { roomDraw = el.dataset.draw === 'r' ? 'r' : 's'; return duelLobbyView(); }
    case 'reroll': return useReroll();
    case 'room-again': return askAgain();
    case 'room-leave': { leaveRoom(); return duelLobbyView(); }
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
  const roomCode = params.get('room');
  const quizCode = params.get('quiz');
  const sharedCode = params.get('r');
  if (quizCode) {
    joinQuizFromUrl(quizCode);
  } else if (roomCode) {
    // Rejoining after a refresh keeps the seat you already had; a fresh visit takes a new one.
    const seat = recallRoom();
    if (seat && seat.code === roomCode.toUpperCase()) {
      room = { code: seat.code, me: seat.me, started: false, shown: null };
      startPolling();
      pollRoom();
    } else {
      joinRoom(roomCode);
    }
  } else if (sharedCode) showShared(sharedCode);
  else startOrBlock();
})();
