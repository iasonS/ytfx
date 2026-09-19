// Live quiz lobbies for MH Stats.
//
// Up to eight players, ten questions, a host who starts it. Like the duel rooms next door
// this lives in memory and is swept when it goes quiet: a lobby is a conversation, not a
// record, and losing every one of them on a restart is the correct behaviour.
//
// It is a separate store rather than a mode flag on mhstats-rooms.js because the two have
// different secrecy rules over the same shape. The duel withholds the opponent's picks
// until BOTH players have finished; the quiz withholds everything until the QUESTION
// closes, on a clock, for up to eight people at once. Sharing one `view` between those two
// rules is how you end up leaking one through the other.
//
// The server exists for one reason, the same reason the duel server does: a browser cannot
// be trusted to sit on an answer it already has. The correct answer is not sent until the
// question is over, and neither is anybody else's guess.

import { QUESTIONS } from './mhstats-quiz-bank.js';

export const ROOM_TTL_MS = 30 * 60 * 1000;   // idle lobbies are swept after half an hour
export const MAX_PLAYERS = 8;
export const QUESTIONS_PER_QUIZ = 10;
export const ASK_MS = 25_000;                 // how long a question stays open
export const REVEAL_MS = 6_000;               // how long the answer stays up before the next
export const NAME_MAX = 16;

// No O/0 or I/1: the code gets read aloud and typed in by hand.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export const CATS = ['mh', 'gen', 'both'];
export const PHASES = ['lobby', 'asking', 'reveal', 'over'];

// What a question is worth. An estimate pays the three closest distinct distances, so being
// roughly right still scores and a wild guess does not.
export const POINTS = 10;
export const ESTIMATE_POINTS = [10, 6, 3];

export class QuizError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (status, message) => { throw new QuizError(status, message); };

// Names come from eight strangers typing into a shared screen, so they are untrusted input.
// Control characters go, whitespace collapses, and the length is capped here rather than
// trusted to the client.
export function cleanName(raw, fallback) {
  const name = String(raw ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return name || fallback;
}

export function createStore({ now = () => Date.now(), random = Math.random, bank = QUESTIONS } = {}) {
  const rooms = new Map();

  const randomOf = alphabet => alphabet[Math.floor(random() * alphabet.length)];
  const makeCode = () => Array.from({ length: CODE_LENGTH }, () => randomOf(CODE_ALPHABET)).join('');
  const makeId = () => Array.from({ length: 12 }, () => randomOf('abcdefghijklmnopqrstuvwxyz0123456789')).join('');

  const byId = new Map(bank.map(q => [q.id, q]));
  const pool = cat => bank.filter(q => q.cat === cat);

  // Partial Fisher-Yates, same as the deck draw: distinct questions, no repeats within a quiz.
  function drawFrom(list, count) {
    const copy = list.slice();
    if (copy.length < count) bad(503, `the ${count}-question bank is short: only ${copy.length} available`);
    const out = [];
    for (let i = 0; i < count; i++) {
      const j = i + Math.floor(random() * (copy.length - i));
      [copy[i], copy[j]] = [copy[j], copy[i]];
      out.push(copy[i]);
    }
    return out;
  }

  // `both` deals five of each and shuffles them together, so the two kinds interleave
  // instead of arriving in two blocks.
  function deal(cat) {
    if (cat === 'both') {
      const half = QUESTIONS_PER_QUIZ / 2;
      const mixed = [...drawFrom(pool('mh'), half), ...drawFrom(pool('gen'), half)];
      for (let i = mixed.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [mixed[i], mixed[j]] = [mixed[j], mixed[i]];
      }
      return mixed.map(q => q.id);
    }
    return drawFrom(pool(cat), QUESTIONS_PER_QUIZ).map(q => q.id);
  }

  function sweep() {
    const cutoff = now() - ROOM_TTL_MS;
    for (const [code, room] of rooms) if (room.touchedAt < cutoff) rooms.delete(code);
  }

  function get(code) {
    sweep();
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) bad(404, 'no such lobby');
    return room;
  }

  function playerIn(room, playerId) {
    const player = room.players.find(p => p.id === playerId);
    if (!player) bad(403, 'not a player in this lobby');
    return player;
  }

  function hostIn(room, playerId) {
    const player = playerIn(room, playerId);
    if (room.hostId !== player.id) bad(403, 'only the host can do that');
    return player;
  }

  const questionOf = room =>
    (room.round >= 1 && room.round <= room.questions.length
      ? byId.get(room.questions[room.round - 1])
      : null);

  // Players who arrive mid-quiz sit in the list on nothing until the next one starts, rather
  // than being dropped into question six with no chance of catching up.
  const eligible = (room, p) => p.eligibleFrom <= room.round;

  function addPlayer(room, rawName) {
    const fallback = `Hunter ${room.players.length + 1}`;
    const player = {
      id: makeId(),
      name: cleanName(rawName, fallback),
      answers: [],          // { round, value, points }
      score: 0,
      joinedAt: now(),
      // In a lobby that has not started, everyone plays from question one.
      eligibleFrom: room.phase === 'lobby' ? 1 : QUESTIONS_PER_QUIZ + 1,
    };
    room.players.push(player);
    room.touchedAt = now();
    return player;
  }

  const answerFor = (player, round) => player.answers.find(a => a.round === round) ?? null;

  // Scoring happens exactly once, the moment a question closes, and the points are stored on
  // the players. Nothing is recomputed on read, so what a player saw cannot change later.
  function scoreQuestion(room) {
    const q = questionOf(room);
    if (!q) return;
    const answered = room.players
      .filter(p => eligible(room, p))
      .map(p => ({ player: p, entry: answerFor(p, room.round) }))
      .filter(x => x.entry && x.entry.value !== null && x.entry.value !== undefined);

    if (q.kind === 'choice') {
      for (const { player, entry } of answered) {
        entry.points = entry.value === q.answer ? POINTS : 0;
        player.score += entry.points;
      }
      return;
    }

    // Estimates pay by distance. Equal distances share a place, and the three closest
    // DISTINCT distances are the ones that pay.
    const distances = [...new Set(answered.map(x => Math.abs(x.entry.value - q.answer)))]
      .sort((a, b) => a - b)
      .slice(0, ESTIMATE_POINTS.length);
    for (const { player, entry } of answered) {
      const place = distances.indexOf(Math.abs(entry.value - q.answer));
      entry.points = place === -1 ? 0 : ESTIMATE_POINTS[place];
      player.score += entry.points;
    }
  }

  const allAnswered = room => {
    const playing = room.players.filter(p => eligible(room, p));
    return playing.length > 0 && playing.every(p => answerFor(p, room.round));
  };

  // The whole clock. There is no timer running on the server: every entry point calls this
  // first, and it walks the room forward to wherever it should be by now. A restart cannot
  // leave a lobby wedged half-way through a question, and nothing burns CPU on a lobby
  // nobody is looking at.
  function advance(room) {
    for (let guard = 0; guard < QUESTIONS_PER_QUIZ * 4 + 8; guard++) {
      const t = now();
      if (room.phase === 'asking') {
        const early = allAnswered(room);
        if (!early && t < room.phaseEndsAt) return;
        scoreQuestion(room);
        // A question closed early ends its reveal a full REVEAL_MS from now; one that ran
        // out of time keeps the original cadence, so a lobby nobody watched for a minute
        // lands on the phase it should be on rather than drifting.
        room.phase = 'reveal';
        room.phaseEndsAt = (early ? t : room.phaseEndsAt) + REVEAL_MS;
        continue;
      }
      if (room.phase === 'reveal') {
        if (t < room.phaseEndsAt) return;
        if (room.round >= room.questions.length) {
          room.phase = 'over';
          room.phaseEndsAt = 0;
          return;
        }
        room.round += 1;
        room.phase = 'asking';
        room.phaseEndsAt += ASK_MS;
        continue;
      }
      return; // lobby and over sit still until someone acts
    }
  }

  function create({ cat = 'both', name } = {}) {
    sweep();
    if (!CATS.includes(cat)) bad(400, 'unknown category');

    let code = makeCode();
    for (let tries = 0; rooms.has(code) && tries < 50; tries++) code = makeCode();
    if (rooms.has(code)) bad(503, 'could not allocate a lobby code');

    const room = {
      code, cat, hostId: null, questions: [], round: 0, phase: 'lobby',
      phaseEndsAt: 0, createdAt: now(), touchedAt: now(), players: [],
    };
    rooms.set(code, room);
    const player = addPlayer(room, name);
    room.hostId = player.id;
    return { room, player };
  }

  function join(code, name) {
    const room = get(code);
    advance(room);
    if (room.players.length >= MAX_PLAYERS) bad(409, 'this lobby is full');
    return { room, player: addPlayer(room, name) };
  }

  // The host may change the category on the way in, so a lobby that was cancelled to start
  // "a different one" does not have to be torn down and rebuilt with a new code.
  function start(code, playerId, cat) {
    const room = get(code);
    advance(room);
    hostIn(room, playerId);
    if (room.phase !== 'lobby') bad(409, 'this quiz has already started');
    if (cat !== undefined && cat !== null) {
      if (!CATS.includes(cat)) bad(400, 'unknown category');
      room.cat = cat;
    }
    room.questions = deal(room.cat);
    room.round = 1;
    room.phase = 'asking';
    room.phaseEndsAt = now() + ASK_MS;
    for (const p of room.players) { p.answers = []; p.score = 0; p.eligibleFrom = 1; }
    room.touchedAt = now();
    return room;
  }

  function answer(code, playerId, value) {
    const room = get(code);
    advance(room);
    const player = playerIn(room, playerId);
    if (room.phase !== 'asking') bad(409, 'no question is open');
    if (!eligible(room, player)) bad(409, 'you join in at the next quiz');
    if (answerFor(player, room.round)) bad(409, 'you have already answered this one');

    const q = questionOf(room);
    const n = Number(value);
    if (!Number.isFinite(n)) bad(400, 'an answer has to be a number');
    if (q.kind === 'choice' && !(Number.isInteger(n) && n >= 0 && n < q.options.length)) {
      bad(400, 'that is not one of the options');
    }

    player.answers.push({ round: room.round, value: n, points: 0 });
    room.touchedAt = now();
    // Everyone in: close the question now rather than making seven people watch a dead timer.
    advance(room);
    return room;
  }

  function again(code, playerId) {
    const room = get(code);
    advance(room);
    hostIn(room, playerId);
    if (room.phase !== 'over') bad(409, 'this quiz is still running');
    room.questions = deal(room.cat);
    room.round = 1;
    room.phase = 'asking';
    room.phaseEndsAt = now() + ASK_MS;
    for (const p of room.players) { p.answers = []; p.score = 0; p.eligibleFrom = 1; }
    room.touchedAt = now();
    return room;
  }

  // Abandon a quiz in progress and put the lobby back where it was before it started, with
  // everyone still seated. Ten questions is a long time to be locked into something started
  // by accident, or with the wrong category, or before someone had arrived — without this
  // the only way out was to sit through it.
  //
  // The host's call, because it ends the game for everybody. Anyone who simply wants out on
  // their own just leaves; that needs no server involvement at all.
  function cancel(code, playerId) {
    const room = get(code);
    advance(room);
    hostIn(room, playerId);
    if (room.phase === 'lobby') bad(409, 'no quiz is running');
    room.questions = [];
    room.round = 0;
    room.phase = 'lobby';
    room.phaseEndsAt = 0;
    // Everybody starts the next one level, including anyone who arrived mid-quiz.
    for (const p of room.players) { p.answers = []; p.score = 0; p.eligibleFrom = 1; }
    room.touchedAt = now();
    return room;
  }

  // What one player is allowed to know right now. Everything withheld here is withheld
  // because sending it would hand a browser the answer.
  function view(code, playerId) {
    const room = get(code);
    advance(room);
    const you = playerIn(room, playerId);
    room.touchedAt = now();

    const q = questionOf(room);
    const revealing = room.phase === 'reveal' || room.phase === 'over';
    const mine = q ? answerFor(you, room.round) : null;

    const standings = room.players
      .slice()
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .map(p => ({
        id: p.id, name: p.name, score: p.score,
        isHost: p.id === room.hostId,
        playing: eligible(room, p),
        // Whether someone has locked in is not their answer, so it can be shown live.
        answered: !!(q && answerFor(p, room.round)),
      }));

    return {
      code: room.code,
      cat: room.cat,
      phase: room.phase,
      round: room.phase === 'lobby' ? 0 : room.round,
      total: room.questions.length || QUESTIONS_PER_QUIZ,
      // Sent rather than a deadline, so nothing depends on the player's own clock.
      msLeft: room.phaseEndsAt ? Math.max(0, room.phaseEndsAt - now()) : 0,
      // How long this phase gets in total. The client needs it to draw a bar that drains:
      // with only msLeft it can only ever draw "all of what is left", which snaps back to
      // full on every poll.
      msTotal: room.phase === 'asking' ? ASK_MS : room.phase === 'reveal' ? REVEAL_MS : 0,
      you: {
        id: you.id,
        name: you.name,
        isHost: you.id === room.hostId,
        playing: eligible(room, you),
        answered: !!mine,
        answer: mine ? mine.value : null,
        score: you.score,
      },
      players: standings,
      // The question WITHOUT its answer or its source. Both would be the answer.
      question: q && room.phase !== 'lobby'
        ? { id: q.id, cat: q.cat, kind: q.kind, q: q.q, options: q.options ?? null, unit: q.unit ?? null }
        : null,
      // Everything at once, the moment the question is closed and not before.
      reveal: q && revealing
        ? {
          answer: q.answer,
          src: q.src,
          unit: q.unit ?? null,
          options: q.options ?? null,
          results: room.players
            .map(p => ({ p, a: answerFor(p, room.round) }))
            .filter(x => x.a)
            .sort((x, y) => y.a.points - x.a.points || x.p.name.localeCompare(y.p.name))
            .map(x => ({ id: x.p.id, name: x.p.name, answer: x.a.value, points: x.a.points })),
        }
        : null,
    };
  }

  return {
    create, join, start, answer, again, cancel, view, sweep,
    get size() { sweep(); return rooms.size; },
    // Testing seam only: never called by the routes.
    _rooms: rooms,
    _advance: advance,
  };
}

export const store = createStore();
