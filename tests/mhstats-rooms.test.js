import { describe, it, expect } from 'vitest';
import { createStore, RoomError, ROOM_TTL_MS, ROUNDS, STATS, CODE_ALPHABET } from '../mhstats-rooms.js';

// A deterministic store: the clock and the randomness are both injected, so a test can age
// a room by half an hour without waiting and can assert on the exact codes handed out.
function harness({ realRandom = false } = {}) {
  let t = 1_700_000_000_000;
  let i = 0;
  // The default sequence is deterministic, which is what the TTL and rule tests want. It
  // also repeats, so any test that creates hundreds of rooms has to ask for real entropy
  // or it will exhaust the collision retries and fail on the store's own guard.
  const store = createStore({
    now: () => t,
    random: realRandom ? Math.random : () => ((i++) * 0.6180339887) % 1,
  });
  return { store, advance: ms => { t += ms; } };
}

const playThrough = (store, code, id, order = STATS) => {
  for (const s of order) store.pick(code, id, s);
};

describe('mhstats duel rooms', () => {
  it('creates a room with a readable code and seats the maker', () => {
    const { store } = harness();
    const { room, player } = store.create({ mask: 0b111111, aim: 'h' });
    expect(room.code).toHaveLength(4);
    for (const ch of room.code) expect(CODE_ALPHABET).toContain(ch);
    expect(room.players).toHaveLength(1);
    expect(player.picks).toEqual([]);
    expect(Number.isInteger(room.seed)).toBe(true);
  });

  // The code is read aloud and typed in, so the confusable characters are left out.
  it('never puts O, 0, I or 1 in a code', () => {
    const { store } = harness({ realRandom: true });
    for (let n = 0; n < 200; n++) {
      const { room } = store.create();
      expect(room.code).not.toMatch(/[O0I1]/);
    }
  });

  it('lets a second player in and refuses a third', () => {
    const { store } = harness();
    const { room } = store.create();
    const second = store.join(room.code);
    expect(second.player.id).not.toBe(room.players[0].id);
    expect(() => store.join(room.code)).toThrow(RoomError);
    try { store.join(room.code); } catch (e) { expect(e.status).toBe(409); }
  });

  it('accepts a lowercase code, because people type it by hand', () => {
    const { store } = harness();
    const { room } = store.create();
    expect(() => store.join(room.code.toLowerCase())).not.toThrow();
  });

  it('gives both players the same seven monsters', () => {
    const { store } = harness();
    const { room, player } = store.create();
    const { player: other } = store.join(room.code);
    const a = store.view(room.code, player.id);
    const b = store.view(room.code, other.id);
    expect(a.seed).toBe(b.seed);
    expect(a.mask).toBe(b.mask);
    expect(a.aim).toBe(b.aim);
  });

  // The whole point of doing this on the server: a browser cannot be trusted to hide the
  // other player's score, so it is never sent until there is nothing left to protect.
  it('withholds the opponent picks until both players are finished', () => {
    const { store } = harness();
    const { room, player: me } = store.create();
    const { player: foe } = store.join(room.code);

    playThrough(store, room.code, foe.id);
    const midway = store.view(room.code, me.id);
    expect(midway.them.done).toBe(true);
    expect(midway.them.picked).toBe(ROUNDS);
    expect(midway.them.picks).toBeNull();      // finished, but still not readable
    expect(midway.bothDone).toBe(false);

    playThrough(store, room.code, me.id);
    const after = store.view(room.code, me.id);
    expect(after.bothDone).toBe(true);
    expect(after.them.picks).toEqual(STATS);
  });

  it('shows the opponent progressing without showing what they took', () => {
    const { store } = harness();
    const { room, player: me } = store.create();
    const { player: foe } = store.join(room.code);
    store.pick(room.code, foe.id, 'hp');
    store.pick(room.code, foe.id, 'atk');
    const v = store.view(room.code, me.id);
    expect(v.them).toEqual({
      joined: true, picked: 2, done: false, wantsAgain: false,
      picks: null, seed: null, rerollAt: null, rerolled: false,
    });
  });

  it('says when nobody has joined yet', () => {
    const { store } = harness();
    const { room, player } = store.create();
    expect(store.view(room.code, player.id).them.joined).toBe(false);
  });

  it('refuses a repeated stat, an unknown stat and a finished run', () => {
    const { store } = harness();
    const { room, player } = store.create();
    store.pick(room.code, player.id, 'hp');
    expect(() => store.pick(room.code, player.id, 'hp')).toThrow(/already taken/);
    expect(() => store.pick(room.code, player.id, 'nope')).toThrow(/unknown stat/);
    for (const s of STATS.slice(1)) store.pick(room.code, player.id, s);
    expect(store.view(room.code, player.id).you.done).toBe(true);
    expect(() => store.pick(room.code, player.id, 'hp')).toThrow(/finished/);
  });

  it('refuses a stranger who guessed the code', () => {
    const { store } = harness();
    const { room } = store.create();
    expect(() => store.view(room.code, 'not-a-player')).toThrow(RoomError);
    try { store.view(room.code, 'not-a-player'); } catch (e) { expect(e.status).toBe(403); }
  });

  it('reports an unknown room as missing rather than crashing', () => {
    const { store } = harness();
    try { store.view('ZZZZ', 'x'); } catch (e) { expect(e.status).toBe(404); }
  });

  it('rejects a nonsense aim or generation mask at creation', () => {
    const { store } = harness();
    expect(() => store.create({ aim: 'x' })).toThrow(/aim/);
    expect(() => store.create({ mask: 0 })).toThrow(/generation mask/);
    expect(() => store.create({ mask: 999 })).toThrow(/generation mask/);
  });

  // A random-draw room gives each player their own seven, which is why the opponent's SEED
  // is withheld alongside their picks: without it their picks name nothing.
  it('deals each player their own seven in a random room', () => {
    const { store } = harness();
    const { room, player: me } = store.create({ draw: 'r' });
    const { player: foe } = store.join(room.code);
    const mine = store.view(room.code, me.id);
    const theirs = store.view(room.code, foe.id);
    expect(mine.draw).toBe('r');
    expect(mine.seed).not.toBe(theirs.seed);
    expect(mine.them.seed).toBeNull();          // withheld while the duel is on

    playThrough(store, room.code, me.id);
    playThrough(store, room.code, foe.id);
    const after = store.view(room.code, me.id);
    expect(after.bothDone).toBe(true);
    expect(after.them.seed).toBe(theirs.seed);  // revealed with their picks, not before
  });

  it('gives both players one seven in a same-draw room', () => {
    const { store } = harness();
    const { room, player: me } = store.create({ draw: 's' });
    const { player: foe } = store.join(room.code);
    expect(store.view(room.code, me.id).seed).toBe(store.view(room.code, foe.id).seed);
  });

  it('defaults to one shared seven and rejects a nonsense draw', () => {
    const { store } = harness();
    expect(store.create().room.draw).toBe('s');
    expect(() => store.create({ draw: 'x' })).toThrow(/unknown draw/);
  });

  it('re-deals both players separately when a random room plays again', () => {
    const { store } = harness({ realRandom: true });
    const { room, player: me } = store.create({ draw: 'r' });
    const { player: foe } = store.join(room.code);
    const before = [store.view(room.code, me.id).seed, store.view(room.code, foe.id).seed];
    playThrough(store, room.code, me.id);
    playThrough(store, room.code, foe.id);
    store.again(room.code, me.id);
    store.again(room.code, foe.id);
    const after = [store.view(room.code, me.id).seed, store.view(room.code, foe.id).seed];
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
    expect(after[0]).not.toBe(after[1]);
  });

  // A rematch keeps the room and both players and deals a new seven, but only once BOTH
  // have asked. Restarting on one click would wipe the result screen out from under the
  // other player before they had finished reading it.
  it('deals a new seven only when both players ask for a rematch', () => {
    const { store } = harness();
    const { room, player: me } = store.create();
    const { player: foe } = store.join(room.code);
    playThrough(store, room.code, me.id);
    playThrough(store, room.code, foe.id);
    const first = store.view(room.code, me.id);
    expect(first.round).toBe(1);

    store.again(room.code, me.id);
    const asked = store.view(room.code, me.id);
    expect(asked.round).toBe(1);                 // nothing has restarted yet
    expect(asked.you.wantsAgain).toBe(true);
    expect(asked.them.wantsAgain).toBe(false);
    expect(asked.bothDone).toBe(true);           // the result is still readable

    store.again(room.code, foe.id);
    const next = store.view(room.code, me.id);
    expect(next.round).toBe(2);
    expect(next.seed).not.toBe(first.seed);      // a different seven
    expect(next.you.picks).toEqual([]);
    expect(next.you.done).toBe(false);
    expect(next.you.wantsAgain).toBe(false);
    expect(next.them.picked).toBe(0);
    expect(next.bothDone).toBe(false);
  });

  it('tells the other player that a rematch is waiting on them', () => {
    const { store } = harness();
    const { room, player: me } = store.create();
    const { player: foe } = store.join(room.code);
    playThrough(store, room.code, me.id);
    playThrough(store, room.code, foe.id);
    store.again(room.code, me.id);
    expect(store.view(room.code, foe.id).them.wantsAgain).toBe(true);
  });

  it('refuses a rematch before the run is finished, or with nobody to play', () => {
    const { store } = harness();
    const alone = store.create();
    expect(() => store.again(alone.room.code, alone.player.id)).toThrow(/finish this one first/);
    playThrough(store, alone.room.code, alone.player.id);
    expect(() => store.again(alone.room.code, alone.player.id)).toThrow(/nobody here/);
  });

  // Rooms are never persisted, so the only cleanup that exists is the sweep.
  it('sweeps a room once it has been idle for the whole TTL', () => {
    const { store, advance } = harness();
    const { room, player } = store.create();
    expect(store.size).toBe(1);
    advance(ROOM_TTL_MS - 1000);
    expect(store.view(room.code, player.id).code).toBe(room.code);  // a read keeps it alive
    advance(ROOM_TTL_MS - 1000);
    expect(store.size).toBe(1);
    advance(ROOM_TTL_MS + 1000);
    expect(store.size).toBe(0);
  });
});
