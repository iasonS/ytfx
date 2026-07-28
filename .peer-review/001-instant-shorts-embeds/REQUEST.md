# Review Request: Instant Shorts crawler metadata and range streaming
- **Author**: Codex
- **Repository**: git@github.com:iasonS/ytfx.git
- **Branch**: perf/instant-shorts-embeds
- **Base**: master @ 87ab445f8e0ad4300ee5b3a67867120ec1100e83
- **Implementation head**: 00d85c78e1b125737de7fb2ca301fd92be85cff0
- **PR**: N/A — peer review is being completed before the PR is opened
- **Risk level**: 3
- **Scope**: Make Discord crawler responses independent of yt-dlp, advertise truthful portrait/fallback thumbnails for Shorts, and relay media lazily with Range/HEAD support; this does not merge or deploy the change.
- **Source of truth**: User report: “embed takes too much time to pop up” and “thumbnail and embed fight each other”; user then approved the bounded-metadata/lazy-proxy approach with “ok, lets follow your advice”.
- **Risk rationale**: `/proxy/video/:id` is a public media-delivery contract consumed by Discord, and its caching/delivery behavior changes from full-file persistence to live upstream streaming. Rollback is to revert implementation commit `00d85c78e1b125737de7fb2ca301fd92be85cff0` and rebuild only the ytfx image; no schema or data migration is involved.

## Acceptance criteria

1. Discordbot requests to `/watch`, `/shorts/:id`, and `/:id` return embed HTML without invoking yt-dlp; oEmbed is bounded to 1.5 seconds and failure still yields deterministic metadata.
2. A Shorts embed advertises `oar2.jpg` first at `1080x1920`, `maxresdefault.jpg` second at `1280x720`, portrait video/player dimensions, and a stable `/proxy/video/:id?shorts=1` URL.
3. A fresh proxy request lazily extracts and caches the stream URL, keeps regular and Shorts cache identities separate, forwards `Range`, preserves upstream partial-response headers/status, handles `HEAD` without a body, and maps upstream failures to `502`.
4. Completed pre-existing `${VIDEOS_DIR}/:id.mp4` files remain serveable through Express Range/HEAD handling; new streams are relayed without full-download disk persistence.
5. The Docker image contains every runtime module/static asset and defaults `VIDEOS_DIR` to `/data/videos`.
6. Existing human-browser YouTube redirects and unrelated endpoints remain unchanged.
7. Non-goals: no merge, production deployment, schema migration, UI redesign, or guarantee that the first cold media request is instant.

## What changed

- `index.js`: split crawler metadata from stream extraction, add bounded oEmbed fallback, type-specific lazy extraction dedupe/cache, portrait/fallback metadata, and upstream Range/HEAD streaming.
- `tests/mocked.test.js`, `tests/unit.test.js`: replace stale direct-stream assumptions with metadata, fallback, Range, HEAD, error, and cache-identity contracts.
- `Dockerfile`: copy the already-imported runtime modules and static assets; set the persistent video directory default.
- `ADR.md`, `ARCHITECTURE.md`, `METRICS.md`, `README.md`, `CLAUDE.md`: record the delivery contract, operational behavior, configuration, validation, rollback, and limitations.

## How to verify

Run from `/home/unix/tmp/ytfx-instant-shorts`:

```sh
rtk git rev-parse HEAD
# expected: request commit whose parent contains implementation head

rtk git cat-file -t 87ab445f8e0ad4300ee5b3a67867120ec1100e83
rtk git cat-file -t 00d85c78e1b125737de7fb2ca301fd92be85cff0
# expected: commit / commit

rtk npm test -- --run
# expected: 74 passed, 10 skipped, exit 0

rtk node --check index.js
rtk git diff --check 87ab445f8e0ad4300ee5b3a67867120ec1100e83..00d85c78e1b125737de7fb2ca301fd92be85cff0
# expected: both exit 0

rtk docker build -t ytfx-peer-review:001 .
# expected: build succeeds

rtk docker run --rm -d --name ytfx-peer-review-001 -p 127.0.0.1:3102:3000 -e BASE_URL=https://embed.example.test ytfx-peer-review:001
rtk curl -fsS http://127.0.0.1:3102/health
rtk curl -sS -A 'Discordbot/2.0' http://127.0.0.1:3102/shorts/Sp78zCdzhfA
# expected: 200 HTML; first og:image is oar2 at 1080x1920, second is maxresdefault at 1280x720, proxy URL ends ?shorts=1

rtk curl -sS --max-time 60 -H 'Range: bytes=0-1023' -o /dev/null -D - -w 'size=%{size_download} code=%{http_code}\n' 'http://127.0.0.1:3102/proxy/video/Sp78zCdzhfA?shorts=1'
# expected for the public fixture: 206, Content-Range bytes 0-1023/<total>, size 1024

rtk curl -sS --max-time 30 -I 'http://127.0.0.1:3102/proxy/video/Sp78zCdzhfA?shorts=1'
# expected: 200, Content-Type video/mp4, Content-Length present, no body

rtk docker stop ytfx-peer-review-001
```

## Author verification evidence

1. Tests: `rtk npm test -- --run` exited 0 — `Test Files 4 passed | 1 skipped (5)` and `Tests 74 passed | 10 skipped (84)`.
2. Build/lint: `rtk node --check index.js` and `rtk git diff --check` exited 0. `rtk docker build -t ytfx-instant-shorts-validation:local .` exited 0 and produced image `186aaf907b4b`.
3. Clean state: after implementation commit, `rtk git status --short --branch` showed only `perf/instant-shorts-embeds...origin/master [ahead 1]`.
4. Author diff review: reviewed `87ab445f8e0ad4300ee5b3a67867120ec1100e83..00d85c78e1b125737de7fb2ca301fd92be85cff0` end to end; no unstated runtime behavior was found.
5. Scope: the implementation commit contains only the nine files listed above. The separate original checkout remains unchanged with its pre-existing user-modified `Dockerfile`.
6. Authorship: `rtk git show -s --format=fuller 00d85c78e1b125737de7fb2ca301fd92be85cff0` shows `iasonS <sklavenitisi6@gmail.com>` for author and committer, with no trailer.
7. Architecture docs: `CLAUDE.md` was added and `ADR.md`, `ARCHITECTURE.md`, `METRICS.md`, and `README.md` were updated in the implementation commit.
8. Cycle allocation: `.peer-review/` did not exist, so protocol cycle `001` was selected and created without collision.
9. Browser crawler check: Playwright Chromium with JavaScript disabled and `Discordbot/2.0` loaded the public fixture metadata in 244 ms, asserted both thumbnail URLs/dimension pairs, portrait video dimensions, and the stable proxy URL. No yt-dlp extraction occurred on that route.
10. Runtime proxy check: the built container returned `206 Partial Content`, `Content-Range: bytes 0-1023/1939586`, and exactly 1024 bytes for a cold Range request. A warm HEAD returned `200`, `Content-Length: 1939586`, and zero body.

## Known limitations / open questions

- This has not been posted to or crawled by the real Discord service; crawler behavior is represented by Discordbot HTTP tests and a Playwright browser check.
- YouTube's `oar2.jpg` endpoint is empirically portrait for the tested Short but is not a documented public API. A conventional `maxresdefault.jpg` landscape image is advertised second as fallback.
- The first cold media request still pays yt-dlp extraction latency (2.45 seconds for the validation fixture); only crawler metadata is made fast.
- Fresh proxy streams are not persisted to disk. Restarts discard the in-memory stream URL cache, while completed files already on disk remain serveable.
- Ten opt-in network e2e tests remain skipped by the default suite. The real public fixture was separately exercised through the built container.
- The validation container did not use production YouTube cookies, so authenticated/age-restricted video behavior was not checked.
- `npm ci` reported 15 pre-existing dependency vulnerabilities (7 moderate, 7 high, 1 critical); no audit-fix or dependency expansion is in scope.
- No production deployment or public-domain verification has occurred.
