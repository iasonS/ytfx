# Architecture Decision Records (ADR)

**Purpose**: Track WHY things are the way they are. Before changing any of these, understand the reasoning first. If you make a change that affects architecture, ADD AN ENTRY HERE.

---

## ADR-001: yt-dlp requires `remoteComponents: 'ejs:github'`
**Date**: 2026-03-04
**Status**: Active
**Context**: yt-dlp 2026.02.21+ requires the External JavaScript Solver (EJS) to solve YouTube's n-parameter challenge. Without it, YouTube returns zero video formats and extraction silently fails with empty error messages.
**Decision**: Always pass `remoteComponents: 'ejs:github'` in yt-dlp options.
**Consequence**: First run on a fresh deploy may be slightly slower as EJS is downloaded. Requires network access to GitHub from the server.
**Symptoms if removed**: `WARNING: [youtube] n challenge solving failed`, `Only images are available for download`, empty error strings in logs.

## ADR-002: yt-dlp requires `dumpJson: true`
**Date**: 2026-03-04
**Status**: Active
**Context**: `youtube-dl-exec` (the Node.js wrapper) returns a raw stdout string by default. The code accesses `result.url`, `result.formats`, `result.width`, `result.height` — all of which require parsed JSON.
**Decision**: Always pass `dumpJson: true` in yt-dlp options when we need structured data back.
**Consequence**: Response includes full JSON metadata (large output), but we only use a few fields.
**Symptoms if removed**: `result.url` is `undefined`, stream URL extraction always fails, error message is empty/misleading.

## ADR-003: yt-dlp requires `jsRuntimes: 'node'`
**Date**: 2026-03-03
**Status**: Active
**Context**: YouTube uses JavaScript challenges for bot detection. yt-dlp needs a JS runtime to solve them. Node.js is already available in our runtime.
**Decision**: Always pass `jsRuntimes: 'node'`.
**Consequence**: Depends on Node.js being available in the container/server environment.
**Symptoms if removed**: `WARNING: [youtube] No supported JavaScript runtime could be found`.

## ADR-004: yt-dlp timeout is 30 seconds
**Date**: 2026-03-04 (increased from 2s → 8s → 30s)
**Status**: Active
**Context**: YouTube extraction takes 2-3 seconds normally, but the EJS solver download + n-parameter challenge can take 10-15 seconds on first run or cold deploys. 8-second timeout still caused failures on Render.
**Decision**: 30-second timeout in `executeWithTimeout()`.
**Consequence**: Slow requests take up to 30 seconds before failing. Cache mitigates this for repeated requests (2-hour TTL).
**Symptoms if too low**: `Timeout after Xms` errors on valid videos, especially on first request after deploy.

## ADR-005: Cookie format — `YOUTUBE_COOKIES_B64` over `YOUTUBE_COOKIES`
**Date**: 2026-03-04
**Status**: Active
**Context**: The original `YOUTUBE_COOKIES` (semicolon-separated string) format lost critical metadata:
- Cookie values with `=` were truncated by `split('=')` (e.g., LOGIN_INFO base64, PREF key=value)
- Secure flags were all set to TRUE (wrong for HSID, SID, APISID, SIDCC)
- Expiry timestamps were set to `9999999999` instead of real values
- Session tokens (ST-*) were not included
**Decision**: Prefer `YOUTUBE_COOKIES_B64` — a base64-encoded Netscape cookie file exported directly from Firefox. Falls back to fixed `YOUTUBE_COOKIES` parser.
**How to generate**: `base64 -w 0 cookies.firefox-private.txt`
**Consequence**: Requires Firefox for cookie export (Chrome 127+ uses app-bound encryption). Cookies still expire and need periodic refresh.
**Symptoms if using old format**: `The provided YouTube account cookies are no longer valid`.

## ADR-006: Cookie string parser uses `indexOf('=')` not `split('=')`
**Date**: 2026-03-04
**Status**: Active
**Context**: JavaScript `split('=')` with destructuring `const [name, value] = str.split('=')` discards everything after the first `=`. Many YouTube cookies contain `=` in their values (base64 padding, key=value pairs).
**Decision**: Use `indexOf('=')` + `substring()` to split only on the FIRST `=`.
**Consequence**: Correctly preserves full cookie values.
**Symptoms if reverted**: Cookie values silently truncated, YouTube rejects auth.

## ADR-007: Cache TTL is 2 hours
**Date**: 2026-03-03
**Status**: Active
**Context**: YouTube stream URLs expire after ~6 hours. Cache reduces yt-dlp calls (each takes 2-3 seconds). Increased from 30 minutes for better performance.
**Decision**: 2-hour cache TTL with 5-minute cleanup interval.
**Consequence**: Video metadata changes (title updates, deleted videos) take up to 2 hours to reflect.

## ADR-008: Format `18` for yt-dlp
**Date**: 2026-03-02
**Status**: Active
**Context**: Format 18 is YouTube's pre-muxed 360p MP4 (video+audio). It's the fastest to extract because it doesn't require separate audio/video stream merging.
**Decision**: Use `format: '18'` for fastest extraction.
**Consequence**: Video quality is 360p. Sufficient for Discord embeds which auto-play at low quality anyway.

## ADR-009: Git authorship — always `iasonS`
**Date**: 2026-03-02
**Status**: Active
**Context**: All commits across all projects must be authored by `iasonS <sklavenitisi6@gmail.com>`. No Co-Authored-By lines. No Claude/Anthropic attribution.
**Decision**: Always set `git config user.name "iasonS"` and `git config user.email "sklavenitisi6@gmail.com"` before committing.
**Consequence**: Must verify authorship before every commit.

## ADR-010: Lazy stream extraction for crawler metadata
**Date**: 2026-07-28
**Status**: Active
**Context**: Discord crawler metadata requests were blocked by cold yt-dlp extraction, despite oEmbed being sufficient to describe an embed. Direct YouTube stream URLs also cannot reliably be consumed by Discord due to request-bound access.
**Decision**: Metadata routes fetch bounded oEmbed data and, for Shorts URLs, probe at most 64 KiB of `oar2.jpg` in parallel to discover its real aspect. They publish stable local proxy URLs without invoking yt-dlp. The proxy resolves yt-dlp streams lazily with a two-hour, type-specific cache, forwards Range requests (including upstream 416 responses), and streams upstream bytes without full-download disk caching.
**Consequences**: Cold crawler TTFB is bounded by the 1.5-second oEmbed timeout and 750 ms thumbnail probe instead of yt-dlp; if the image probe fails, dimensions are omitted rather than invented. The first actual media request can still incur extraction latency. Completed pre-existing files remain serveable, but new proxy streams are not persisted. Docker defaults `VIDEOS_DIR` to the `/data` volume shared by the home-server and Render configurations, while direct local runs retain the `/tmp/ytfx_videos` fallback. Rollback: revert the change and rebuild the image; no schema migration is involved.

## ADR-011: Drop Render; serve from tt-server via Cloudflare Tunnel
**Date**: 2026-08-23
**Status**: Active
**Context**: ytfx ran on Render (`ytfx.onrender.com`) with `www.xyyoutube.com` CNAMEd to it from GoDaddy DNS, while an identical container already ran on tt-server as part of `iasonS/is-infra`. Two deployments of the same service, one of them paid, and the domain pointed at the one that was not the source of truth for the rest of the stack. tt-server already terminates public traffic for `orison.zip` through an existing Cloudflare Tunnel.
**Decision**: Serve ytfx publicly from the tt-server container through the existing Cloudflare Tunnel, with `xyyoutube.com` and `www.xyyoutube.com` as tunnel public hostnames routed to `http://ytfx:3000`. Delete `render.yaml`. DNS for the zone moves to Cloudflare; the domain stays registered at GoDaddy.
**Consequences**: One deployment instead of two, and no paid hosting. DNS must live at Cloudflare — tunnel hostnames are proxied CNAMEs to `<tunnel-id>.cfargotunnel.com`, which resolve only inside Cloudflare's network, so third-party DNS cannot point at a tunnel. No origin IP is exposed and no port is forwarded. The app needs no change: it builds absolute URLs from the request `Host` header and sets `trust proxy`, so it follows cloudflared's `X-Forwarded-Proto`. Availability is now tied to the house — power, WAN and tailnet — where Render absorbed that before. Tailscale Funnel was rejected: it serves only `*.ts.net` names, so it cannot carry this domain. Supersedes the Render half of ADR-010's `VIDEOS_DIR` note; the `/data` mount is now supplied only by the compose bind mount. Rollback: recreate `render.yaml`, redeploy on Render, and repoint the two hostnames.

## ADR-012: The MH Stats fan game is static files under `/mhstats/`
**Date**: 2026-09-18
**Status**: Active, amended by ADR-015 (live duels add four routes and an in-memory room store)
**Context**: The owner wanted a Monster Hunter stat game in the style of statle.fun without paying for another domain. ytfx already serves `xyyoutube.com` through the Cloudflare tunnel (ADR-011) and has a static `public/` folder that the image copies.
**Decision**: Ship the game as static files under `public/mhstats/`: no Express routes, no database, no shared state. Its deck (`deck.json`, `img/`) is built offline by `tools/mhstats/` from published game data plus a reviewed overlay, and committed. Runs live in the player's browser only.
**Consequences**: The proxy's code paths are untouched and the game cannot break embeds; the static middleware is registered before the `/:id` catch-all, so `/mhstats/` never reaches it. The image grows by ~14 MB of renders. There are no server-side highscores by design. The renders are Capcom artwork reproduced from fan wikis for a non-commercial fan project; `public/mhstats/credits.txt` carries the attribution the wikis' licences require and must ship with the page. Rollback: delete `public/mhstats/` and `tools/mhstats/`.

## ADR-013: Speed, and Attack for 130 monsters, are rated rather than derived
**Date**: 2026-09-18
**Status**: Active
**Context**: MH Stats gives every monster seven stats. Five derive cleanly from figures the games publish: base HP, size, hitzone softness, status tolerances, and enrage threshold and duration. Two do not. No mainline game publishes an absolute movement speed for a monster, confirmed across all seven data sources and the complete Rise data dump, where the only `move_speed` field is populated for Zinogre alone. And 130 monsters come from games that publish no per-move damage. Both stats were first derived from the enrage multipliers, and both were wrong in the same way: those multipliers measure how much a monster *gains* when enraged, which is largest for slow, lumbering monsters. Attack ranked Dodogama beside Alatreon; Speed ranked Basarios and Khezu as the fastest monsters in the series.
**Decision**: Attack uses real per-move damage where a game publishes it (World and Rise, 122 monsters) and nothing else. Speed uses no source at all. The remainder are rated by judgement against a fixed, published anchor table, held in `tools/mhstats/data/ratings.json`, one written reason per value. "Fast" is defined as animation speed and combat tempo, not locomotion and not size; Glavenus and Rajang are the published calibration cases, both large and both fast.
**Consequences**: 252 Speed values and 130 Attack values are judgement, not measurement, which is the largest hand-authored part of the deck. They are marked `curated` in `deck.json` so a player can see which numbers are opinion, and every one is listed with its reason in `data/curation-report.md`, so a disputed rating is a one-line edit and a rebuild. A calibration pass read all 252 placements as a single ranking and corrected 14, all of them the same error the rating exists to avoid: large monsters rated slow for being large, including Fatalis, Ukanlos, Shara Ishvalda and Anjanath. After rating, every stat passes the deck's anti-clustering bar; Speed's worst cluster fell from 46 monsters on one value to 13. Extracting Wilds' per-move damage from the game files would convert 36 Attack ratings into measured data and was considered; it was rejected as disproportionate, and it would not help Speed, which is not in the files at all.

---

## ADR-014: A measured stat is ranked against the whole roster unless its unit is era-dependent

**Date**: 2026-09-18
**Status**: Active

**Context**: The four measured stats are scaled from raw figures onto a shared 1..300 sheet, and the scaling originally normalised every stat within its own source game. That is right only when the unit drifts between games, and it was applied to units that do not. Hitzone percentages, centimetres and status build-up points mean the same thing in every generation — the median poison tolerance is 150 to 180 in all seven sources — so ranking them within one game compared a monster against whoever happened to share its table. Xeno'jiiva took the Defense floor on a 61.5 mean hitzone while Yama Tsukami, softer at 68.3, scored 124; Arkveld at 1667cm scored smaller than Anjanath at 1646cm. Base HP genuinely is era-dependent, but scaling it against each game's own range let the roster's SHAPE set the stat instead: World's table runs from Great Jagras to Zorah Magdaros, and that 35000 ceiling pushed every ordinary World monster toward the floor while Rise's narrower table spread its monsters out. The median World monster scored 46 against the median Rise monster's 138, Fatalis landed on 106, and Coral Pukei-Pukei came out below base Pukei-Pukei. Each of these was found by playing, not by a test.

**Decision**: Defense, Resist and Size rank against all 252 monsters at once (`global: true`). HP is era-adjusted and then ranked (`eraRank: true`): each monster's base HP becomes a multiple of its own game's median monster, and those multiples are spread over the scale by rank. Rank rather than value for that last step, because the siege monsters are a true order of magnitude above everything else and flatten a value scale — dividing by the median alone squashed the whole roster into 89..106.

**Consequences**: Every game's median deck HP now lands within a point of 132, so a monster's source game no longer decides its toughness: Fatalis reads 275 rather than 106, Alatreon 271 rather than 95. A test pins those per-game medians within 25 points of each other so the fault cannot return quietly. HP is now an ordering rather than a magnitude, which is the deliberate trade — two monsters one HP apart are separated, and the siege monsters occupy the top few slots instead of owning the range. Two limits remain, both from the sources and neither fixable by scaling: 34 monsters carry their own game's median base HP exactly (Rajang and Aknosom both sit on Rise's 4500) because Capcom differentiates them with per-quest multipliers that no source publishes, and Resist collides because the games record tolerances in steps of 80/100/150/250. The deck's anti-clustering bar is set at 35 to admit both. Cross-game variant pairs still disagree where the two forms were read from different games — Brute Tigrex against Tigrex, Rathalos against Silver Rathalos — since the underlying rows really are that far apart.

---

## ADR-015: Live duels hold rooms in memory, and the server decides what each player may see

**Date**: 2026-09-18
**Status**: Active

**Context**: The first duel was asynchronous: you finished a run, sent a link, your opponent played it and sent one back. The owner found the whole flow confusing, and it was — two kinds of link, a same-or-random toggle, and a send-it-back step that had no prompt anywhere. The replacement is two people playing at the same time, which needs somewhere for the two browsers to agree on the seven monsters and, at the end, on who won. That breaks ADR-012's "no Express routes, no shared state".

**Decision**: Four routes under `/mhstats/api/rooms`, backed by `mhstats-rooms.js`: a `Map` of rooms, swept after thirty minutes idle, never written to the database. A room holds a seed, the generation mask, the aim, and up to two players with their picks. Codes are four characters from an alphabet with no `O`, `0`, `I` or `1`, because they get read aloud. The store takes its clock and its randomness as parameters so the sweep and the code alphabet can be tested without waiting or guessing.

The rule the server exists to enforce: **a player's picks are never sent to their opponent until both have finished.** Until then the opponent sees a count. Hiding it in the client would not be hiding it at all, because the number would already be in the browser.

A rematch keeps the room and both players and deals a new seed, but only once BOTH have asked: restarting on one click would wipe the result screen out from under the other before they had read it. A `round` counter, not the seed, is what tells a client a new game has been dealt.

A room deals either one seven for both players or one each. With one each the totals are not comparable — one seven can simply be worth more — so those duels are settled on each player's percentage of their own perfect line, and the opponent's SEED is withheld alongside their picks, because without it their picks name nothing.

**Consequences**: Rooms do not survive a restart, which is correct — a room is a conversation, not a record, and a deploy during a duel costs two people one game. Nothing about the duel is persisted, so there are still no server-side highscores, and ADR-012's reasons for that still hold. Polling is every 1.5 seconds against a dedicated 240/minute limiter; the public endpoints' 60/minute would have rejected two players mid-game. State is per-process, so this cannot be run behind more than one instance without moving rooms to shared storage — the single container behind the tunnel (ADR-011) is the assumption. The old `?d=` challenge links are gone and will not resolve; `?r=` result links are unchanged and still work. Rollback: delete the four routes, `mhstats-rooms.js` and the Duel tab; the solo game has no dependency on any of it.

---

## ADR-016: One reroll per run, dealt up front rather than drawn on demand

**Date**: 2026-09-18
**Status**: Active

**Context**: A run that opens on a monster you know nothing about is a dead round, so the owner asked for a single reroll. The obvious implementation — draw a fresh monster when the button is pressed — would have made a run unreproducible, and reproducibility is what every share link, every replay and the whole duel reveal depend on.

**Decision**: Deal `ROUNDS * 2` monsters at the start: seven to face, and a separate reserve standing behind each of them. The reroll swaps in the reserve for the slot it is spent on. A single shared reserve was tried first and rejected: it made the reroll the same monster wherever it was spent, which is a fact to learn once rather than a risk to take, and the point of the reroll is that you are trading a monster you can see for one you cannot. A run is then still decided entirely by its seed, its generation mask and one number: the position the reroll was spent on. That number rides in the share code's fourth field after the aim, and the duel room records it per player so the opponent's client can rebuild the run at the reveal. `rebuildRun` is the only supported way to reconstruct a run; calling `drawMonsters` directly gives a rerolled run the wrong seven.

**Consequences**: A playable pool is now fourteen monsters rather than seven, so every generation must have at least fourteen for the filter to offer it alone — the smallest is 21, and a test pins the floor. Adding a generation with fewer than fourteen monsters would make it unplayable on its own. Codes written before the reroll decode with `rerollAt: null` and rebuild exactly as they did. The reserve is drawn whether or not it is used, so a run always costs one extra draw. The reroll cannot be saved across monsters or banked: it is one per run, spent where it is spent, which keeps the decision a real one rather than an optimisation to solve.

---

## ADR-017: The quiz keeps its own lobbies, and derives the clock instead of running one

**Date**: 2026-09-19
**Status**: Active

**Context**: The owner asked for a second game beside the stats run and the duel: ten questions, played in a lobby with friends, with an option for Monster Hunter questions, general-knowledge questions, or both. Monster Hunter questions are restricted to generations 5 and 6 — World, Iceborne, Rise, Sunbreak and Wilds — including monsters that debuted earlier but appear in one of those games. General questions are closest-wins estimates. Both of those want up to eight players and a timer, neither of which the duel rooms of ADR-015 do.

**Decision**: A separate store, `mhstats-quiz.js`, with its own six routes under `/mhstats/api/quiz` — not a `mode` flag on `mhstats-rooms.js`. The two look alike but their one important rule differs: the duel withholds an opponent's picks until **both players finish**, while the quiz withholds everything until **the question closes**, on a clock, for up to eight people. Sharing one `view()` between those two rules is how one leaks through the other, and the duel is live and working.

**There is no timer running on the server.** No `setTimeout`, no interval. Every entry point calls `advance(room)` first, which compares the injected clock against `phaseEndsAt` and walks the room forward — `asking` for 25 seconds or until every eligible player has answered, then `reveal` for 6 seconds, then the next question. A question that closes early dates its reveal from now; one that times out keeps the original cadence, so a lobby nobody watched for a minute lands on the phase it should be on rather than drifting. Scoring happens exactly once, when a question closes, and is stored — never recomputed on read, so what a player saw cannot change underneath them.

A choice scores 10 for the right option. An estimate pays the three closest **distinct** distances 10, 6 and 3, with equal distances sharing a place, so being roughly right still scores and a wild guess does not.

The question bank is `mhstats-quiz-bank.js` at the repo root, a plain ES module rather than JSON — nothing then depends on import attributes being available in the production image — and deliberately **not** under `public/`. The client never receives it. A browser that could fetch the bank would hold every answer in the game, so the server sends one question at a time without its answer, and the answer only once the question has closed. Every question carries a `src`; one that could not be sourced was not written, and tests enforce both that and the generation-5/6 rule, checking every `refs` id against `roster.json` — wrong multiple-choice options included, because a wrong option is still a monster the question puts in front of a player. Questions are English-only: asking which monster is called by its Japanese name tests whether you can read kana, not whether you know Monster Hunter.

**Consequences**: Lobbies do not survive a restart, like duel rooms, and for the same reason. Polling is 1.5 seconds against a dedicated 600/minute limiter rather than the duel's 240: eight players poll about 320 times a minute between them, and a household behind one NAT presents as a single IP, so the duel's ceiling would have locked out a family playing together. State is per-process, so this still assumes the single container of ADR-011. A player who joins mid-quiz is seated but cannot score until the next round is dealt, rather than being dropped into question six with no chance of catching up. `tests/dockerfile.test.js` now walks the import graph **transitively**; the bank is reached through `mhstats-quiz.js` rather than from `index.js`, and the old direct-imports-only check would have missed it — which is exactly the omission that crash-looped production when `mhstats-rooms.js` was added. A host may **cancel** a quiz in progress, which hands the lobby back with every player still seated and their scores wiped, ready to start another — optionally on a different category, which `start` accepts. That was added after shipping, because a quiz started by accident or with the wrong category had to be sat out: `Leave` existed only in the lobby and on the final table, so there was no way out of the ten questions in between. Cancelling is the host's alone, since it ends the game for everyone; leaving is anybody's and needs no server at all. Rollback: delete the seven routes, `mhstats-quiz.js`, `mhstats-quiz-bank.js`, `public/mhstats/quiz.js` and the Quiz tab; nothing else depends on any of it.

---

## ADR-018: The MH Stats page and its modules revalidate instead of being cached

**Date**: 2026-09-19
**Status**: Active

**Context**: The quiz shipped and rendered in a real browser completely unstyled — default blue links, bullet markers, the scoreboard running together as plain text. The origin was serving the right stylesheet the whole time; the browser was holding the previous one. `quiz.js` was a brand-new file so it had no cache entry and fetched, while `style.css` had one and did not. New markup, old stylesheet.

`express.static` sends `Cache-Control: public, max-age=0`, but a CDN in front is free to layer its own browser TTL on top of that, and Cloudflare's default is four hours. Every deploy that touched markup and styles together was therefore a coin flip for anyone who had visited in the previous four hours — and the page, its modules and its stylesheet always change together, because they are one thing.

**Decision**: Mount `public/mhstats` ahead of the general static handler and send `Cache-Control: no-cache, must-revalidate` for `.html`, `.css`, `.js` and `.json`. Those files are small and revalidate to a 304, so the cost is one conditional request each rather than a broken page. The intent is stated explicitly at the origin rather than left to a default, so an intermediary has something to respect.

Images are deliberately left alone. The renders under `img/` are 14MB, a render never changes once written, and re-fetching them on every deploy would be the expensive mistake in the other direction.

**Consequences**: A page load costs four extra conditional requests, all 304s. Whether a browser honours this rather than an intermediary's TTL is not something the origin can guarantee alone, so `tools/mhstats/smoke.mjs` asserts the served `Cache-Control` on the page, the stylesheet and both modules, and fails on any `max-age` of 100 seconds or more — run against production, that checks what the CDN actually returns rather than what we asked for. `tests/mhstats-quiz-styles.test.js` guards the other half of the same failure: markup that names a class nothing styles. Rollback: delete the `/mhstats` mount and the page returns to inheriting the default.

---

## How to use this file

1. **Before changing yt-dlp options**: Read ADR-001 through ADR-004 and ADR-008
2. **Before changing cookie handling**: Read ADR-005 and ADR-006
3. **Before changing cache**: Read ADR-007
4. **Before committing**: Read ADR-009
5. **After making an architectural change**: Add a new ADR entry here
