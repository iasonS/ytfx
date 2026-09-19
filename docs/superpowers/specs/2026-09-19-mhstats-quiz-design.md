# MH Stats: a ten-question quiz played in a lobby

Date: 2026-09-19
Status: approved

## Contents

- [What this is](#what-this-is)
- [What a question is](#what-a-question-is)
- [Scoring](#scoring)
- [The bank](#the-bank)
- [The room](#the-room)
- [The clock](#the-clock)
- [Routes](#routes)
- [What a player may see](#what-a-player-may-see)
- [The screens](#the-screens)
- [Testing](#testing)
- [Delivery](#delivery)

## What this is

A second game beside the stats run and the duel: ten questions, up to eight players in one
lobby, a host who starts it, a timer on each question, and a scoreboard that updates as you
go.

Questions come in two flavours. **Monster Hunter** questions are restricted to generation 5
and 6 — World, Iceborne, Rise, Sunbreak and Wilds — covering both the monsters and the
places. A monster that debuted in an older generation counts as long as it appears in one of
those games, so Rathalos and Khezu are in and Abyssal Lagiacrus is out. **General** questions
are closest-wins estimates of the "how old is the Earth" sort.

The host chooses `mh`, `gen` or `both` when creating the lobby. `both` deals five of each,
shuffled.

Why a lobby rather than an extension of the duel: the duel is a two-player reveal, and its
one rule is "neither player sees the other's score until both have finished". The quiz is an
eight-player reveal on a timer, and its rule is "nobody sees anything until the question
closes". Those are different state machines over the same idea, so they get different files.

## What a question is

Two kinds:

```js
// kind: 'choice'
{ id: 'mh-wilds-flagship', cat: 'mh', kind: 'choice',
  q: 'Which monster is the flagship of Monster Hunter Wilds?',
  options: ['Arkveld', 'Magnamalo', 'Nergigante', 'Malzeno'],
  answer: 0,                       // index into options
  src: 'https://...',
  refs: ['arkveld'] }              // monster ids this question is about

// kind: 'estimate'
{ id: 'gen-earth-age', cat: 'gen', kind: 'estimate',
  q: 'Approximately how old is the Earth, in years?',
  answer: 4540000000,
  unit: 'years',
  src: 'https://...' }
```

Fields, all required unless noted:

| field | rule |
| --- | --- |
| `id` | unique across the bank, kebab-case, prefixed `mh-` or `gen-` |
| `cat` | `'mh'` or `'gen'` |
| `kind` | `'choice'` or `'estimate'` |
| `q` | the question, one sentence |
| `options` | choice only: exactly four distinct strings |
| `answer` | choice: integer 0–3. estimate: a finite number |
| `unit` | estimate only: what the number counts (`'years'`, `'m'`, `'moons'`) |
| `src` | where the fact came from — a URL, or a local path like `roster.json:rathalos.games` |
| `refs` | optional, monster ids the question is about; every id must be a gen-5/6 monster |

**Every question carries a `src`.** A question that cannot be sourced is not written. This is
the rule that keeps a hand-authored bank honest, and `refs` is the rule that keeps the MH half
inside generations 5 and 6 — both are enforced by tests rather than by memory.

## Scoring

A choice is worth **10 points** for the right option, 0 otherwise.

An estimate is scored by distance. Group the submitted answers by `Math.abs(answer - guess)`,
ascending. The closest distinct distance scores **10**, the second **6**, the third **3**, and
everything beyond scores 0. Players who share a distance share its score, and a player who did
not answer scores 0 and is not ranked.

So being roughly right still pays, ties are not broken arbitrarily, and a wild guess earns
nothing.

## The bank

`mhstats-quiz-bank.js` at the repo root, a plain ES module:

```js
export const QUESTIONS = [ /* ... */ ];
```

It is a module rather than JSON so there is no dependency on import attributes being
available in the production image, and it lives at the root rather than under `public/`
**because the client must never be able to fetch it.** A browser holding the bank is a browser
holding every answer. The server sends one question at a time, without its answer, and the
answer appears only when the question closes.

Target size: at least 120 per category, so a ten-question quiz does not repeat for a long
time and `both` has real variety. The floor enforced by tests is well above ten.

## The room

`mhstats-quiz.js`, same shape as `mhstats-rooms.js`: `createStore({ now, random })`, an
in-memory `Map`, four-character codes from the `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` alphabet,
swept after 30 minutes idle. Nothing is persisted; a lobby is a conversation, not a record.

```
room   { code, cat, hostId, questions: [10 question ids], round, phase,
         phaseEndsAt, createdAt, touchedAt, players[] }
player { id, name, answers: [ {round, value, points} ], score, joinedAt, eligibleFrom }
```

Constants: `MAX_PLAYERS = 8`, `QUESTIONS_PER_QUIZ = 10`, `ASK_MS = 25000`,
`REVEAL_MS = 6000`, `ROOM_TTL_MS = 30 * 60 * 1000`, `NAME_MAX = 16`.

Phases: `lobby → asking → reveal → asking → … → over`.

`eligibleFrom` is the round a player may first score in. Someone who joins mid-quiz sits in
the list at 0 points and starts scoring at the next `again`, rather than being dropped into
question six with no chance of catching up.

## The clock

**There is no timer running on the server.** No `setTimeout`, no interval, nothing ticking in
the background. Every entry point — `view`, `answer`, `start`, `again` — begins by calling
`advance(room)`, which compares `now()` against `room.phaseEndsAt` and moves the machine
forward if it is due, repeatedly, until the room is settled.

- `asking` ends at `phaseEndsAt`, **or early** the moment every eligible player has answered.
- Ending an `asking` phase scores the question once and stores the points.
- `reveal` ends `REVEAL_MS` later, and the next question opens — or the room goes `over` after
  the tenth.

This matters for three reasons: a restart cannot leave a room wedged half-way through a
question, nothing burns CPU on a lobby nobody is looking at, and the whole machine is testable
by injecting a clock, which is the seam `mhstats-rooms.js` already uses.

Scoring happens exactly once, when the question closes, and is stored on the players. It is
never recomputed on read.

## Routes

Six, under `/mhstats/api/quiz`, behind the existing 240/min `duelLimiter` and the 4kb JSON
body limit.

| method | path | body | does |
| --- | --- | --- | --- |
| POST | `/mhstats/api/quiz` | `{ cat, name }` | creates the room, seats the host |
| POST | `/mhstats/api/quiz/:code/join` | `{ name }` | seats a player |
| POST | `/mhstats/api/quiz/:code/start` | `{ you }` | host only; deals ten and opens question 1 |
| POST | `/mhstats/api/quiz/:code/answer` | `{ you, value }` | locks an answer for the open question |
| POST | `/mhstats/api/quiz/:code/again` | `{ you }` | host only; new ten, same lobby, scores reset |
| GET | `/mhstats/api/quiz/:code?you=ID` | — | the view below |

Every route returns the same view payload. Errors are `QuizError(status, message)`, mapped the
way `RoomError` already is: 404 unknown room, 403 not a player / not the host, 409 wrong phase
or already answered, 400 malformed input.

An answer for a round that has already closed is **rejected with 409**, not silently dropped,
so a slow phone is told it missed rather than believing it scored.

## What a player may see

```js
{
  code, cat, phase, round,            // round is 1-based; 0 in the lobby
  total: 10,
  msLeft,                             // ms until this phase ends; 0 in lobby and over
  you:   { id, name, isHost, answered, answer, score, eligible },
  players: [ { id, name, score, answered, isHost } ],   // ordered by score, then name
  question: { id, cat, kind, q, options?, unit? } | null,
  reveal: null | {
    answer, src, unit?,
    results: [ { id, name, answer, points } ]           // ordered by points, then name
  },
}
```

The rules the server enforces, which is the entire reason it exists:

- while `phase === 'asking'`, `question` carries **no `answer` field** and no `src`
- while `phase === 'asking'`, other players' answers are absent — `players[].answered` is a
  boolean and nothing more
- `reveal` is `null` until the question closes, and then carries everything at once

`msLeft` is sent rather than a deadline timestamp so nothing depends on the player's own clock
being correct.

## The screens

`public/mhstats/quiz.js` owns the quiz DOM. `app.js` is already 927 lines and owns the stats
game and the duel; the quiz gets its own module and `app.js` hands control to it. Shared page,
shared stylesheet, so a **Quiz** button joins the masthead nav, and `?quiz=CODE` joins a lobby
the way `?room=CODE` joins a duel.

1. **Setup** — host picks MH only / General / Both, types a name, creates. The code appears.
2. **Lobby** — the code large enough to read aloud, the player list filling in, **Start** for
   the host and "waiting for the host" for everyone else.
3. **Asking** — the question, a draining timer bar, four buttons or a number field, and
   "5 of 8 locked in". No hint of anyone's answer.
4. **Reveal** — the correct answer, what each person said, the points. On an estimate the
   guesses are laid out on a scale so you can see who was nearest.
5. **Scoreboard** — the running order between questions.
6. **Over** — the final table and **Play again**, which re-deals into the same lobby.

The countdown bar is animated locally from `msLeft`; polling stays at 1.5s and exists only to
learn who has locked in and when the phase turns.

Names are capped at `NAME_MAX` characters and escaped on render. Eight strangers typing into
a shared screen is untrusted input.

## Testing

**Store** (`tests/mhstats-quiz.test.js`), with an injected clock:

- the phase advances on time and not a moment before
- every eligible player answering ends the question early
- an answer for a closed round is refused with 409
- `view()` withholds the correct answer and other players' answers while `asking`
- only the host can `start` and `again`
- the ninth player is turned away
- a player joining mid-quiz scores nothing until the next `again`
- estimates score 10/6/3 by distance, ties sharing the higher score, no answer scoring 0
- ten questions, no repeats, and `both` deals five of each

**Bank** (`tests/mhstats-quiz-bank.test.js`):

- ids unique; every question has a `src`; choices have exactly four distinct options and an
  in-range `answer`; estimates have a finite `answer` and a `unit`
- **every id in `refs` is a monster that appears in a gen-5/6 game**, checked against
  `tools/mhstats/data/roster.json`
- each category holds at least the floor, well above ten

**Dockerfile** (`tests/dockerfile.test.js`, extended): the existing test checks only the
modules `index.js` imports directly. It is extended to **walk the import graph transitively**,
so `mhstats-quiz.js` importing `mhstats-quiz-bank.js` is covered. A module missing from the
image's COPY list took the whole site down once; the test exists so it cannot happen twice.

**Smoke** (`tools/mhstats/smoke.mjs`, extended): three browsers — create, two join, host
starts, all three answer, reveal, scoreboard, play again — so the real thing is exercised end
to end the way the duel already is.

## Delivery

**Changed during implementation: one pull request, not two.** The plan was to land the
engine first and the client second. That was wrong: the engine alone deploys six routes with
nothing that can reach them, so the first deploy would ship something unverifiable in
production and the feature would be half-live between the two. The whole quiz goes in one
change, reviewed together, deployed once.

The pipeline that produces the bank is in the repo so it can be rebuilt:

- `tools/mhstats/derive-quiz-questions.mjs` → `data/quiz-derived.json`, questions generated
  from `roster.json` and `deck.json`, every answer copied out of a file
- `data/quiz-authored.json`, the researched questions, each carrying the URL it was checked
  against
- `tools/mhstats/build-quiz-bank.mjs` validates and merges both into `mhstats-quiz-bank.js`

`ADR-017` records the quiz rooms: a separate store rather than a mode flag on the duel, and a
clock derived on read rather than a timer on the server. `CLAUDE.md` is updated in the same
commit as the change that makes it true.
