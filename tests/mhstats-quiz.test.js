import { describe, it, expect, beforeEach } from 'vitest';
import {
  createStore, QuizError, cleanName,
  ASK_MS, REVEAL_MS, ROOM_TTL_MS, MAX_PLAYERS, QUESTIONS_PER_QUIZ, NAME_MAX,
} from '../mhstats-quiz.js';

// A bank big enough to deal from, and shaped so the answers are obvious in a test:
// every choice's right answer is index 1, every estimate's answer is 100.
const BANK = [
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `mh-c${i}`, cat: 'mh', kind: 'choice', q: `mh choice ${i}?`,
    options: ['a', 'b', 'c', 'd'], answer: 1, src: 'test', refs: ['rathalos'],
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `mh-e${i}`, cat: 'mh', kind: 'estimate', q: `mh estimate ${i}?`,
    answer: 100, unit: 'm', src: 'test', refs: ['rathalos'],
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `gen-c${i}`, cat: 'gen', kind: 'choice', q: `gen choice ${i}?`,
    options: ['a', 'b', 'c', 'd'], answer: 1, src: 'test',
  })),
  ...Array.from({ length: 20 }, (_, i) => ({
    id: `gen-e${i}`, cat: 'gen', kind: 'estimate', q: `gen estimate ${i}?`,
    answer: 100, unit: 'm', src: 'test',
  })),
];

// An estimate-only bank, so a test that wants to score distances always gets one.
const ESTIMATES = BANK.filter(q => q.kind === 'estimate');
// A choice-only bank, likewise.
const CHOICES = BANK.filter(q => q.kind === 'choice');

let clock;
const makeClock = () => { let t = 1_000_000; return { now: () => t, tick: ms => { t += ms; }, at: () => t }; };

function makeStore(bank = BANK) {
  clock = makeClock();
  let s = 42;
  const random = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return createStore({ now: clock.now, random, bank });
}

const thrown = fn => { try { fn(); return null; } catch (e) { return e; } };

describe('mhstats quiz lobby', () => {
  let store;
  beforeEach(() => { store = makeStore(); });

  describe('the lobby', () => {
    it('opens with the creator as host and nobody playing yet', () => {
      const { room, player } = store.create({ cat: 'both', name: 'Ias' });
      expect(room.code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/);
      const v = store.view(room.code, player.id);
      expect(v.phase).toBe('lobby');
      expect(v.round).toBe(0);
      expect(v.you.isHost).toBe(true);
      expect(v.you.name).toBe('Ias');
      expect(v.question).toBe(null);
    });

    it('seats up to eight and turns the ninth away', () => {
      const { room } = store.create({ name: 'host' });
      for (let i = 2; i <= MAX_PLAYERS; i++) store.join(room.code, `p${i}`);
      const err = thrown(() => store.join(room.code, 'one too many'));
      expect(err).toBeInstanceOf(QuizError);
      expect(err.status).toBe(409);
    });

    it('names an unnamed player rather than leaving a blank row', () => {
      const { room } = store.create({ name: '' });
      const { player } = store.join(room.code, '   ');
      expect(player.name).toBe('Hunter 2');
    });

    it('caps and scrubs what a player types for a name', () => {
      expect(cleanName('a'.repeat(50), 'x')).toHaveLength(NAME_MAX);
      expect(cleanName('one\u0000two\nthree', 'x')).toBe('one two three');
      expect(cleanName('', 'Hunter 4')).toBe('Hunter 4');
    });

    it('lets only the host start', () => {
      const { room, player: host } = store.create({ name: 'host' });
      const { player: guest } = store.join(room.code, 'guest');
      const err = thrown(() => store.start(room.code, guest.id));
      expect(err.status).toBe(403);
      expect(() => store.start(room.code, host.id)).not.toThrow();
    });

    it('refuses a stranger and an unknown lobby', () => {
      const { room } = store.create({ name: 'host' });
      expect(thrown(() => store.view(room.code, 'nobody')).status).toBe(403);
      expect(thrown(() => store.view('ZZZZ', 'nobody')).status).toBe(404);
    });
  });

  describe('dealing', () => {
    it('deals ten distinct questions', () => {
      const { room, player } = store.create({ cat: 'mh', name: 'host' });
      store.start(room.code, player.id);
      expect(room.questions).toHaveLength(QUESTIONS_PER_QUIZ);
      expect(new Set(room.questions).size).toBe(QUESTIONS_PER_QUIZ);
    });

    it('deals five of each for "both"', () => {
      const { room, player } = store.create({ cat: 'both', name: 'host' });
      store.start(room.code, player.id);
      const cats = room.questions.map(id => BANK.find(q => q.id === id).cat);
      expect(cats.filter(c => c === 'mh')).toHaveLength(5);
      expect(cats.filter(c => c === 'gen')).toHaveLength(5);
    });

    it('keeps a category quiz inside its category', () => {
      const { room, player } = store.create({ cat: 'gen', name: 'host' });
      store.start(room.code, player.id);
      for (const id of room.questions) expect(BANK.find(q => q.id === id).cat).toBe('gen');
    });

    it('refuses an unknown category', () => {
      expect(thrown(() => store.create({ cat: 'lore' })).status).toBe(400);
    });

    it('will not start twice', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      expect(thrown(() => store.start(room.code, player.id)).status).toBe(409);
    });
  });

  describe('what a player may see', () => {
    it('sends the question without its answer while it is open', () => {
      const { room, player } = store.create({ cat: 'mh', name: 'host' });
      store.start(room.code, player.id);
      const v = store.view(room.code, player.id);
      expect(v.phase).toBe('asking');
      expect(v.question.q).toBeTruthy();
      expect(v.question.answer).toBeUndefined();
      expect(v.question.src).toBeUndefined();
      expect(v.reveal).toBe(null);
    });

    it('does not leak another player\'s answer before the question closes', () => {
      const { room, player: host } = store.create({ cat: 'mh', name: 'host' });
      const { player: guest } = store.join(room.code, 'guest');
      store.start(room.code, host.id);
      store.answer(room.code, guest.id, 1);

      const v = store.view(room.code, host.id);
      expect(v.phase).toBe('asking');           // host has not answered, so it is still open
      const them = v.players.find(p => p.id === guest.id);
      expect(them.answered).toBe(true);          // that they are in is fair game
      expect(them.answer).toBeUndefined();       // what they said is not
      expect(v.reveal).toBe(null);
      // and nothing anywhere in the payload carries their number
      expect(JSON.stringify(v)).not.toMatch(/"answer":1[^0-9]/);
    });

    it('hands over the answer, the source and everyone\'s guess once it closes', () => {
      const { room, player } = store.create({ cat: 'mh', name: 'host' });
      store.start(room.code, player.id);
      store.answer(room.code, player.id, 1);
      const v = store.view(room.code, player.id);
      expect(v.phase).toBe('reveal');
      expect(v.reveal.answer).toBeDefined();
      expect(v.reveal.src).toBe('test');
      expect(v.reveal.results).toHaveLength(1);
      expect(v.reveal.results[0].answer).toBe(1);
    });

    it('counts down in milliseconds left rather than a deadline', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      expect(store.view(room.code, player.id).msLeft).toBe(ASK_MS);
      clock.tick(10_000);
      expect(store.view(room.code, player.id).msLeft).toBe(ASK_MS - 10_000);
    });

    // Without the phase's full length the client can only draw "all of what is left", which
    // snaps the timer bar back to full width on every poll.
    it('says how long the phase gets, not just how much is left of it', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      clock.tick(10_000);
      const asking = store.view(room.code, player.id);
      expect(asking.msTotal).toBe(ASK_MS);
      expect(asking.msLeft).toBeLessThan(asking.msTotal);

      // Only as far as the end of the question: ticking a further ASK_MS would run past the
      // reveal and open question two, which is correct behaviour but not what is under test.
      clock.tick(ASK_MS - 10_000);
      const reveal = store.view(room.code, player.id);
      expect(reveal.phase).toBe('reveal');
      expect(reveal.msTotal).toBe(REVEAL_MS);
    });
  });

  describe('the clock', () => {
    it('keeps the question open until the timer runs out', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      clock.tick(ASK_MS - 1);
      expect(store.view(room.code, player.id).phase).toBe('asking');
      clock.tick(1);
      expect(store.view(room.code, player.id).phase).toBe('reveal');
    });

    it('closes the question early once everybody has answered', () => {
      const { room, player: host } = store.create({ cat: 'mh', name: 'host' });
      const { player: guest } = store.join(room.code, 'guest');
      store.start(room.code, host.id);
      store.answer(room.code, host.id, 1);
      expect(store.view(room.code, host.id).phase).toBe('asking');
      store.answer(room.code, guest.id, 2);
      expect(store.view(room.code, host.id).phase).toBe('reveal');
    });

    it('moves on to the next question after the reveal', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      clock.tick(ASK_MS);
      expect(store.view(room.code, player.id).round).toBe(1);
      clock.tick(REVEAL_MS);
      const v = store.view(room.code, player.id);
      expect(v.phase).toBe('asking');
      expect(v.round).toBe(2);
    });

    it('ends after the tenth question', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      clock.tick((ASK_MS + REVEAL_MS) * QUESTIONS_PER_QUIZ);
      const v = store.view(room.code, player.id);
      expect(v.phase).toBe('over');
      expect(v.msLeft).toBe(0);
    });

    // Nothing ticks on the server, so a lobby nobody looked at for ten minutes has to land
    // on the right phase the moment someone does look.
    it('fast-forwards a lobby nobody was watching', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      clock.tick((ASK_MS + REVEAL_MS) * 3);
      const v = store.view(room.code, player.id);
      expect(v.round).toBe(4);
      expect(v.phase).toBe('asking');
    });

    it('sweeps a lobby that went quiet', () => {
      const { room, player } = store.create({ name: 'host' });
      expect(store.size).toBe(1);
      clock.tick(ROOM_TTL_MS + 1);
      expect(store.size).toBe(0);
      expect(thrown(() => store.view(room.code, player.id)).status).toBe(404);
    });
  });

  describe('answering', () => {
    it('refuses an answer once the question has closed', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      clock.tick(ASK_MS);
      const err = thrown(() => store.answer(room.code, player.id, 1));
      expect(err.status).toBe(409);
      expect(err.message).toMatch(/no question is open/);
    });

    it('refuses a second answer to the same question', () => {
      const { room, player } = store.create({ cat: 'gen', name: 'host' });
      const { player: guest } = store.join(room.code, 'guest');
      store.start(room.code, player.id);
      store.answer(room.code, player.id, 1);
      expect(thrown(() => store.answer(room.code, player.id, 2)).status).toBe(409);
      expect(guest).toBeTruthy();
    });

    it('refuses an answer that is not a number', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      expect(thrown(() => store.answer(room.code, player.id, 'banana')).status).toBe(400);
    });

    it('refuses an option that does not exist', () => {
      const store2 = makeStore(CHOICES);
      const { room, player } = store2.create({ cat: 'mh', name: 'host' });
      store2.start(room.code, player.id);
      expect(thrown(() => store2.answer(room.code, player.id, 9)).status).toBe(400);
      expect(thrown(() => store2.answer(room.code, player.id, 1.5)).status).toBe(400);
    });

    it('takes any finite number for an estimate', () => {
      const store2 = makeStore(ESTIMATES);
      const { room, player } = store2.create({ cat: 'mh', name: 'host' });
      store2.start(room.code, player.id);
      expect(() => store2.answer(room.code, player.id, 4_540_000_000)).not.toThrow();
    });
  });

  describe('scoring', () => {
    it('pays ten for the right option and nothing for a wrong one', () => {
      const store2 = makeStore(CHOICES);
      const { room, player: host } = store2.create({ cat: 'mh', name: 'host' });
      const { player: guest } = store2.join(room.code, 'guest');
      store2.start(room.code, host.id);
      store2.answer(room.code, host.id, 1);   // right
      store2.answer(room.code, guest.id, 0);  // wrong
      const v = store2.view(room.code, host.id);
      expect(v.players.find(p => p.id === host.id).score).toBe(10);
      expect(v.players.find(p => p.id === guest.id).score).toBe(0);
    });

    it('pays an estimate 10/6/3 by how close it landed', () => {
      const store2 = makeStore(ESTIMATES);
      const { room, player: a } = store2.create({ cat: 'mh', name: 'a' });
      const { player: b } = store2.join(room.code, 'b');
      const { player: c } = store2.join(room.code, 'c');
      const { player: d } = store2.join(room.code, 'd');
      store2.start(room.code, a.id);
      store2.answer(room.code, a.id, 101);  // 1 off  -> 10
      store2.answer(room.code, b.id, 95);   // 5 off  -> 6
      store2.answer(room.code, c.id, 80);   // 20 off -> 3
      store2.answer(room.code, d.id, 10);   // 90 off -> 0
      const v = store2.view(room.code, a.id);
      const score = id => v.players.find(p => p.id === id).score;
      expect(score(a.id)).toBe(10);
      expect(score(b.id)).toBe(6);
      expect(score(c.id)).toBe(3);
      expect(score(d.id)).toBe(0);
    });

    it('lets equally close answers share the higher score', () => {
      const store2 = makeStore(ESTIMATES);
      const { room, player: a } = store2.create({ cat: 'mh', name: 'a' });
      const { player: b } = store2.join(room.code, 'b');
      const { player: c } = store2.join(room.code, 'c');
      store2.start(room.code, a.id);
      store2.answer(room.code, a.id, 90);   // 10 off
      store2.answer(room.code, b.id, 110);  // 10 off, same distance
      store2.answer(room.code, c.id, 80);   // 20 off
      const v = store2.view(room.code, a.id);
      const score = id => v.players.find(p => p.id === id).score;
      expect(score(a.id)).toBe(10);
      expect(score(b.id)).toBe(10);
      expect(score(c.id)).toBe(6);   // the next DISTINCT distance takes second place
    });

    it('scores nothing for a player who let the timer run out', () => {
      const store2 = makeStore(ESTIMATES);
      const { room, player: a } = store2.create({ cat: 'mh', name: 'a' });
      const { player: b } = store2.join(room.code, 'b');
      store2.start(room.code, a.id);
      store2.answer(room.code, a.id, 100);
      clock.tick(ASK_MS);
      const v = store2.view(room.code, a.id);
      expect(v.players.find(p => p.id === b.id).score).toBe(0);
      expect(v.reveal.results.map(r => r.id)).toEqual([a.id]);
    });

    it('adds up across the whole quiz', () => {
      const store2 = makeStore(CHOICES);
      const { room, player } = store2.create({ cat: 'mh', name: 'solo' });
      store2.start(room.code, player.id);
      for (let i = 0; i < QUESTIONS_PER_QUIZ; i++) {
        store2.answer(room.code, player.id, 1);
        clock.tick(REVEAL_MS);
      }
      const v = store2.view(room.code, player.id);
      expect(v.phase).toBe('over');
      expect(v.you.score).toBe(10 * QUESTIONS_PER_QUIZ);
    });
  });

  describe('joining late', () => {
    it('seats a latecomer without letting them score this quiz', () => {
      const store2 = makeStore(CHOICES);
      const { room, player: host } = store2.create({ cat: 'mh', name: 'host' });
      store2.start(room.code, host.id);
      const { player: late } = store2.join(room.code, 'late');

      const v = store2.view(room.code, late.id);
      expect(v.players.find(p => p.id === late.id)).toBeTruthy();
      expect(v.you.playing).toBe(false);
      expect(thrown(() => store2.answer(room.code, late.id, 1)).status).toBe(409);
    });

    it('does not wait for a latecomer before closing a question', () => {
      const store2 = makeStore(CHOICES);
      const { room, player: host } = store2.create({ cat: 'mh', name: 'host' });
      store2.start(room.code, host.id);
      store2.join(room.code, 'late');
      store2.answer(room.code, host.id, 1);
      // Everyone ELIGIBLE has answered, so it closes rather than hanging on the latecomer.
      expect(store2.view(room.code, host.id).phase).toBe('reveal');
    });

    it('brings the latecomer in for the next quiz', () => {
      const store2 = makeStore(CHOICES);
      const { room, player: host } = store2.create({ cat: 'mh', name: 'host' });
      store2.start(room.code, host.id);
      const { player: late } = store2.join(room.code, 'late');
      clock.tick((ASK_MS + REVEAL_MS) * QUESTIONS_PER_QUIZ);
      store2.again(room.code, host.id);
      const v = store2.view(room.code, late.id);
      expect(v.you.playing).toBe(true);
      expect(() => store2.answer(room.code, late.id, 1)).not.toThrow();
    });
  });

  describe('playing again', () => {
    it('waits for the quiz to be over', () => {
      const { room, player } = store.create({ name: 'host' });
      store.start(room.code, player.id);
      expect(thrown(() => store.again(room.code, player.id)).status).toBe(409);
    });

    it('is the host\'s call', () => {
      const { room, player: host } = store.create({ name: 'host' });
      const { player: guest } = store.join(room.code, 'guest');
      store.start(room.code, host.id);
      clock.tick((ASK_MS + REVEAL_MS) * QUESTIONS_PER_QUIZ);
      expect(thrown(() => store.again(room.code, guest.id)).status).toBe(403);
    });

    it('deals a fresh ten and wipes the scores', () => {
      const store2 = makeStore(CHOICES);
      const { room, player } = store2.create({ cat: 'mh', name: 'host' });
      store2.start(room.code, player.id);
      store2.answer(room.code, player.id, 1);
      clock.tick((ASK_MS + REVEAL_MS) * QUESTIONS_PER_QUIZ);
      expect(store2.view(room.code, player.id).you.score).toBe(10);

      store2.again(room.code, player.id);
      const v = store2.view(room.code, player.id);
      expect(v.phase).toBe('asking');
      expect(v.round).toBe(1);
      expect(v.you.score).toBe(0);
      expect(v.you.answered).toBe(false);
    });
  });

  it('refuses to deal from a bank that is too small', () => {
    const tiny = createStore({ now: () => 0, random: () => 0.5, bank: BANK.slice(0, 3) });
    const { room, player } = tiny.create({ cat: 'mh', name: 'host' });
    expect(thrown(() => tiny.start(room.code, player.id)).status).toBe(503);
  });
});
