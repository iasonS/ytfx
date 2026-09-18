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
    const player = { id: makeId(), picks: [], done: false, joinedAt: now() };
    room.players.push(player);
    room.touchedAt = now();
    return player;
  }

  function create({ mask = ALL_GENS, aim = 'h' } = {}) {
    sweep();
    if (!AIMS.includes(aim)) bad(400, 'unknown aim');
    const n = Number(mask);
    if (!Number.isInteger(n) || n < 1 || n > ALL_GENS) bad(400, 'bad generation mask');

    let code = makeCode();
    for (let tries = 0; rooms.has(code) && tries < 50; tries++) code = makeCode();
    if (rooms.has(code)) bad(503, 'could not allocate a room code');

    const room = {
      code, seed: makeSeed(), mask: n, aim,
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

  // What one player is allowed to know right now.
  function view(code, playerId) {
    const room = get(code);
    const you = playerIn(room, playerId);
    const them = room.players.find(p => p.id !== playerId) ?? null;
    const bothDone = !!them && you.done && them.done;
    room.touchedAt = now();
    return {
      code: room.code,
      seed: room.seed,
      mask: room.mask,
      aim: room.aim,
      bothDone,
      you: { id: you.id, picks: you.picks.slice(), done: you.done },
      // The opponent's PICKS are the opponent's score, so they are withheld until both are
      // finished. A count is enough to show progress and gives nothing away.
      them: them
        ? { joined: true, picked: them.picks.length, done: them.done, picks: bothDone ? them.picks.slice() : null }
        : { joined: false, picked: 0, done: false, picks: null },
    };
  }

  return {
    create, join, pick, view, sweep,
    get size() { sweep(); return rooms.size; },
    // Testing seam only: never called by the routes.
    _rooms: rooms,
  };
}

export const store = createStore();
