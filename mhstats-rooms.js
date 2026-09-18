// Live duel rooms for MH Stats.
//
// A room is a conversation between two browsers that lasts a few minutes, so it lives in
// memory and is never written to the database. Losing every room on a restart is the
// correct behaviour: there is nothing here worth recovering, and nothing here is a record.
//
// The one rule the server has to enforce is that neither player can see the other's SCORE
// before both have finished. The client cannot be trusted to hide it, so `view` simply does
// not send the opponent's picks until both are done. Until then it sends a count.

export const ROOM_TTL_MS = 30 * 60 * 1000;   // idle rooms are swept after half an hour
export const ROUNDS = 7;
export const MAX_PLAYERS = 2;
// No O/0 or I/1: the code gets read aloud and typed in by hand.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 4;

export const STATS = ['hp', 'atk', 'def', 'spd', 'wil', 'siz', 'tmp'];
export const AIMS = ['h', 'l'];
// How a room deals its two players. SAME gives them one set of seven monsters, so the
// totals are comparable outright. RANDOM gives each their own, which makes the totals
// meaningless against each other -- one seven can simply be worth more -- so the client
// settles those on how near each player came to their own perfect line.
export const DRAWS = ['s', 'r'];
export const ALL_GENS = 0b111111;

export class RoomError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const bad = (status, message) => { throw new RoomError(status, message); };

export function createStore({ now = () => Date.now(), random = Math.random } = {}) {
  const rooms = new Map();

  const randomOf = alphabet => alphabet[Math.floor(random() * alphabet.length)];
  const makeCode = () => Array.from({ length: CODE_LENGTH }, () => randomOf(CODE_ALPHABET)).join('');
  const makeId = () => Array.from({ length: 12 }, () => randomOf('abcdefghijklmnopqrstuvwxyz0123456789')).join('');
  const makeSeed = () => Math.floor(random() * 0x100000000) >>> 0;

  function sweep() {
    const cutoff = now() - ROOM_TTL_MS;
    for (const [code, room] of rooms) if (room.touchedAt < cutoff) rooms.delete(code);
  }

  function get(code) {
    sweep();
    const room = rooms.get(String(code || '').toUpperCase());
    if (!room) bad(404, 'no such room');
    return room;
  }

  function playerIn(room, playerId) {
    const player = room.players.find(p => p.id === playerId);
    if (!player) bad(403, 'not a player in this room');
    return player;
  }

  function addPlayer(room) {
    // On a random draw every player carries their own seven, so the seed is per player.
    const player = {
      id: makeId(), seed: room.draw === 'r' ? makeSeed() : room.seed,
      picks: [], done: false, wantsAgain: false, rerollAt: null, joinedAt: now(),
    };
    room.players.push(player);
    room.touchedAt = now();
    return player;
  }

  function create({ mask = ALL_GENS, aim = 'h', draw = 's' } = {}) {
    sweep();
    if (!AIMS.includes(aim)) bad(400, 'unknown aim');
    if (!DRAWS.includes(draw)) bad(400, 'unknown draw');
    const n = Number(mask);
    if (!Number.isInteger(n) || n < 1 || n > ALL_GENS) bad(400, 'bad generation mask');

    let code = makeCode();
    for (let tries = 0; rooms.has(code) && tries < 50; tries++) code = makeCode();
    if (rooms.has(code)) bad(503, 'could not allocate a room code');

    const room = {
      code, seed: makeSeed(), mask: n, aim, draw, round: 1,
      createdAt: now(), touchedAt: now(), players: [],
    };
    rooms.set(code, room);
    return { room, player: addPlayer(room) };
  }

  function join(code) {
    const room = get(code);
    if (room.players.length >= MAX_PLAYERS) bad(409, 'this room is full');
    return { room, player: addPlayer(room) };
  }

  function pick(code, playerId, stat) {
    const room = get(code);
    const player = playerIn(room, playerId);
    if (!STATS.includes(stat)) bad(400, `unknown stat ${stat}`);
    if (player.done) bad(409, 'your run is finished');
    if (player.picks.includes(stat)) bad(409, `${stat} is already taken`);
    player.picks.push(stat);
    if (player.picks.length >= ROUNDS) player.done = true;
    room.touchedAt = now();
    return room;
  }

  // One reroll per run, spent on whichever monster is on the table. The position is what
  // the other client needs to rebuild this run once the duel is over, so the server is the
  // one that records it rather than trusting either browser at the reveal.
  function reroll(code, playerId) {
    const room = get(code);
    const player = playerIn(room, playerId);
    if (player.done) bad(409, 'your run is finished');
    if (player.rerollAt !== null) bad(409, 'your reroll is spent');
    player.rerollAt = player.picks.length;
    room.touchedAt = now();
    return room;
  }

  // A rematch keeps the room and both players, and deals a new seven. It only happens once
  // BOTH have asked: restarting the moment one player clicks would wipe the result screen
  // out from under the other before they had finished reading it.
  function again(code, playerId) {
    const room = get(code);
    const player = playerIn(room, playerId);
    if (!player.done) bad(409, 'finish this one first');
    if (room.players.length < MAX_PLAYERS) bad(409, 'there is nobody here to play again');
    player.wantsAgain = true;

    if (room.players.every(p => p.done && p.wantsAgain)) {
      room.seed = makeSeed();
      room.round += 1;
      for (const p of room.players) {
        p.seed = room.draw === 'r' ? makeSeed() : room.seed;
        p.picks = []; p.done = false; p.wantsAgain = false; p.rerollAt = null;
      }
    }
    room.touchedAt = now();
    return room;
  }

  // What one player is allowed to know right now.
  function view(code, playerId) {
    const room = get(code);
    const you = playerIn(room, playerId);
    const them = room.players.find(p => p.id !== playerId) ?? null;
    const bothDone = !!them && you.done && them.done;
    room.touchedAt = now();
    return {
      code: room.code,
      // Your own seven. On a same draw this is the room's; on a random one it is yours.
      seed: you.seed,
      mask: room.mask,
      aim: room.aim,
      draw: room.draw,
      // Bumped by a rematch. The clients watch it to know a new seven has been dealt, which
      // is also how they tell a fresh round from the one they are still looking at.
      round: room.round,
      bothDone,
      you: {
        id: you.id, picks: you.picks.slice(), done: you.done,
        wantsAgain: you.wantsAgain, rerollAt: you.rerollAt,
      },
      // The opponent's PICKS are the opponent's score, so they are withheld until both are
      // finished. A count is enough to show progress and gives nothing away.
      them: them
        ? {
          joined: true, picked: them.picks.length, done: them.done,
          wantsAgain: them.wantsAgain,
          // Their picks AND, on a random draw, the seed needed to know what they picked
          // them from. Both are the score, so both wait for the reveal.
          picks: bothDone ? them.picks.slice() : null,
          seed: bothDone ? them.seed : null,
          rerollAt: bothDone ? them.rerollAt : null,
          // Whether they used it is not their score, so it can be shown as it happens.
          rerolled: them.rerollAt !== null,
        }
        : {
          joined: false, picked: 0, done: false, wantsAgain: false,
          picks: null, seed: null, rerollAt: null, rerolled: false,
        },
    };
  }

  return {
    create, join, pick, reroll, again, view, sweep,
    get size() { sweep(); return rooms.size; },
    // Testing seam only: never called by the routes.
    _rooms: rooms,
  };
}

export const store = createStore();
