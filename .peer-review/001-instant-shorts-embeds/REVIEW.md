# Review: Instant Shorts crawler metadata and range streaming
- **Reviewer**: Claude
- **Verdict**: REQUEST_CHANGES

## Verification performed

All commands run from `/home/unix/tmp/ytfx-instant-shorts` (clean handed-off worktree; only untracked `.peer-review/001-instant-shorts-embeds/REVIEW.md` and `.serena/`).

**Commit / branch state (checked at start and re-checked immediately before writing this review):**
```
$ rtk git cat-file -t 87ab445f8e0ad4300ee5b3a67867120ec1100e83   → commit
$ rtk git cat-file -t 00d85c78e1b125737de7fb2ca301fd92be85cff0   → commit
$ rtk git rev-parse HEAD^                                        → 00d85c78e1b125737de7fb2ca301fd92be85cff0
$ rtk git ls-remote origin refs/heads/perf/instant-shorts-embeds
b7ec70d9d266061e3e6d0882d9eb5ecc8b93c60a	refs/heads/perf/instant-shorts-embeds
$ rtk git ls-remote origin refs/heads/master
87ab445f8e0ad4300ee5b3a67867120ec1100e83	refs/heads/master
$ rtk gh pr list --head perf/instant-shorts-embeds --state all --json number,state → []
$ rtk git branch -r --contains 00d85c7                           → origin/perf/instant-shorts-embeds
```
Remote branch head == local HEAD == the REQUEST.md commit; implementation head is its parent and is unchanged between the start and the end of this review. Branch is not merged into `master` and no PR exists (matches `PR: N/A`). `b7ec70d` touches only `.peer-review/001-instant-shorts-embeds/REQUEST.md` (88 insertions), so the handoff is clean.

**Authorship / scope:**
```
$ rtk git show -s --format='%an <%ae> | %cn <%ce>' 00d85c7
iasonS <sklavenitisi6@gmail.com> | iasonS <sklavenitisi6@gmail.com>   (no trailer)
$ rtk git diff --stat 87ab445..00d85c7
ADR.md 7+ | ARCHITECTURE.md 49± | CLAUDE.md 22+ | Dockerfile 6± | METRICS.md 11±
README.md 36± | index.js 260± | tests/mocked.test.js 214± | tests/unit.test.js 4±
9 files changed, 290 insertions(+), 319 deletions(-)
```
Nine files, matching REQUEST.md; no drive-by changes found reading the diff end to end.

**Static checks:**
```
$ rtk npm test -- --run
 Test Files  4 passed | 1 skipped (5)
      Tests  74 passed | 10 skipped (84)
npm test exit=0
$ rtk node --check index.js       → exit 0
$ rtk git diff --check 87ab445..00d85c7 → exit 0
```
Matches the author's claimed `74 passed, 10 skipped`.

**Docker build + live container (Level 3 full verification run):**
```
$ rtk docker build -t ytfx-peer-review:001 .   → exit 0, Successfully built 186aaf907b4b
$ rtk docker run --rm -d --name ytfx-peer-review-001 -p 127.0.0.1:3102:3000 \
    -e BASE_URL=https://embed.example.test ytfx-peer-review:001
$ rtk curl -fsS http://127.0.0.1:3102/health
{"status":"ok","version":"unknown","uptime":4,"cache":{"size":0,"ttl_ms":7200000},...}
```
Container log confirms `[Videos] Directory ready: /data/videos` (criterion 5) and startup with `emoticons.js`/`metrics.js`/`public/` present.

**AC1 — crawler metadata without yt-dlp:**
```
$ rtk curl -sS -A 'Discordbot/2.0' -o /dev/null -w '%{time_total} %{http_code}' /shorts/Sp78zCdzhfA → 0.046921 200
$ ... '/watch?v=Sp78zCdzhfA'                                                                       → 0.057275 200
```
Container log shows no `[yt-dlp]` line for either request. Mocked suite asserts `expect(youtubeDlExec).not.toHaveBeenCalled()` including the oEmbed-503 fallback path; `fetchOEmbed` (`index.js:185-193`) swallows all errors and returns `{title:'YouTube Video'}`, so `fetchEmbedMetadata` cannot reject. **Met.**

**AC2 — Shorts metadata (fixture Sp78zCdzhfA):**
```
og:image  https://i.ytimg.com/vi/Sp78zCdzhfA/oar2.jpg          1080 x 1920
og:image  https://i.ytimg.com/vi/Sp78zCdzhfA/maxresdefault.jpg 1280 x 720
og:video  https://embed.example.test/proxy/video/Sp78zCdzhfA?shorts=1   1080 x 1920
```
I independently downloaded both images and parsed their SOF markers: `oar2.jpg` = 1080x1920, `maxresdefault.jpg` = 1280x720. Truthful **for this fixture**; see MAJOR-1 for the general case.

**AC3 — lazy proxy, Range, HEAD, 502:**
```
$ rtk curl -H 'Range: bytes=0-1023' -D - .../proxy/video/Sp78zCdzhfA?shorts=1   (cold)
HTTP/1.1 206 Partial Content
content-type: video/mp4 | content-length: 1024
content-range: bytes 0-1023/1939586 | accept-ranges: bytes
size=1024 code=206 time=2.650392
$ rtk curl -I .../proxy/video/Sp78zCdzhfA?shorts=1   (warm)
HTTP/1.1 200 OK | content-type: video/mp4 | content-length: 1939586 | body_size=0 time=0.026
$ rtk curl .../proxy/video/zzzzzzzzzzz   → HTTP/1.1 502 {"error":"Failed to download video"}
```
Container log: `[Cache] Miss ... extracting stream` once, then `[Cache] Hit for Sp78zCdzhfA (0ms)` on subsequent requests. Cache-identity separation is covered by the mocked test asserting yt-dlp is called with `/watch?v=shared123` and `/shorts/shared123` for the two cache keys. Partially met — see MAJOR-2.

**AC4 — pre-existing disk files:**
```
$ rtk docker cp full.mp4 ytfx-peer-review-001:/data/videos/testDisk_1.mp4
$ rtk curl -H 'Range: bytes=0-99' .../proxy/video/testDisk_1
HTTP/1.1 206 | Content-Range: bytes 0-99/1939586 | Accept-Ranges: bytes | size=100
$ rtk curl -I .../proxy/video/testDisk_1  → HTTP/1.1 200 | Content-Length: 1939586 | body=0
```
**Met.**

**AC6 — unrelated endpoints:**
```
/                                             200
/health                                       200
/videos/testDisk_1.mp4                        200
/go?url=https://www.youtube.com/shorts/...    302
/proxy/video/../etc/passwd                    404   (path traversal rejected)
$ rtk curl -A 'Mozilla/5.0' /shorts/Sp78zCdzhfA
HTTP/1.1 302 Found → Location: https://www.youtube.com/shorts/Sp78zCdzhfA
```
**Met.**

Validation container stopped and removed (`rtk docker stop ytfx-peer-review-001` → exit 0; `docker ps -a --filter name=ytfx-peer-review-001` → empty).

## Findings

### [MAJOR-1] Shorts embeds hardcode 1080x1920, but `oar2.jpg` is the *original*-aspect-ratio thumbnail, not a portrait one
- File: `index.js:199-210` (and `index.js:384-385` consuming it)
- Problem: `fetchEmbedMetadata` unconditionally sets `width: 1080, height: 1920` for every `/shorts/:id` request and advertises `oar2.jpg` as the primary image at those dimensions. REQUEST.md's stated assumption — "`oar2.jpg` is empirically portrait for the tested Short" — is false in general: `oar2` = **o**riginal **a**spect **r**atio, so it returns whatever the source ratio is. Because the pre-change code took `width`/`height` from yt-dlp (`getVideoInfo`, `index.js:271-272`), this is a regression in dimension accuracy, not just a new limitation. The declared `og:video:width/height` are affected identically.
- Evidence: I downloaded `oar2.jpg` for three IDs and parsed the JPEG SOF marker:
  ```
  Sp78zCdzhfA (portrait Short) oar2 → 1080x1920   code=200
  dQw4w9WgXcQ (landscape)      oar2 → 1920x1080   code=200
  jNQXAC9IVRw (landscape 4:3)  oar2 →  320x240    code=200
  ```
  Reproduced end-to-end against the built container:
  ```
  $ rtk curl -sS -A 'Discordbot/2.0' http://127.0.0.1:3102/shorts/dQw4w9WgXcQ
  <meta property="og:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/oar2.jpg">
  <meta property="og:image:width" content="1080">
  <meta property="og:image:height" content="1920">
  <meta property="og:video:width" content="1080">
  <meta property="og:video:height" content="1920">
  ```
  The served image is 1920x1080; the page declares 1080x1920.
- Failure scenario: a user shares a landscape (or 4:3, or 720x1280-but-non-9:16) video via a `youtube.com/shorts/<id>` URL — `/go` routes any `youtube.com/shorts/` link to `/shorts/:id` (`index.js:490-495`). Discord sizes the embed box from the declared 9:16 ratio and receives a 16:9 image and a 16:9 stream, producing exactly the letterboxed/cropped "thumbnail and embed fight each other" symptom this change was written to fix. Before this commit, yt-dlp-derived dimensions rendered that case correctly. Container log for the tested Short also shows the real stream is `360x640`, so the declared numbers are already decoupled from reality — harmless only while the ratio happens to match.
- Suggestion: either advertise the landscape `maxresdefault` (1280x720) as primary and keep `oar2` unadvertised, or key the portrait dimensions off something that reflects the actual video (e.g. only claim 9:16 when the aspect can be confirmed, otherwise fall back to 1280x720). If the hardcoded values are kept deliberately, the tradeoff and its landscape-Shorts failure mode belong in `ADR-010` and REQUEST.md's known limitations, since the current text asserts the opposite.

### [MAJOR-2] Unsatisfiable Range on the upstream path returns 502 instead of forwarding 416
- File: `index.js:595-597`
- Problem: `if (!upstream.ok) throw new Error(...)` treats every non-2xx upstream status as a gateway failure. `416 Range Not Satisfiable` is a normal, client-caused response for a range probe and must be forwarded (RFC 9110 §15.5.17), not converted to `502`. The same endpoint behaves correctly on the disk-backed branch, so `/proxy/video/:id` now answers the identical request two different ways depending on whether a file happens to exist.
- Evidence: same container, same video, same header:
  ```
  # upstream (lazy) path
  $ rtk curl -H 'Range: bytes=99999999-100000000' -D - .../proxy/video/Sp78zCdzhfA?shorts=1
  HTTP/1.1 502 Bad Gateway
  {"error":"Failed to download video"}
  # container log: [Proxy] Download failed for Sp78zCdzhfA: Upstream returned 416

  # disk path, identical request shape
  $ rtk curl -H 'Range: bytes=99999999-' -D - .../proxy/video/testDisk_1
  HTTP/1.1 416 Range Not Satisfiable
  Content-Range: bytes */1939586
  ```
- Failure scenario: a media client (Discord's proxy, Safari, or any player doing an open-ended/speculative tail probe) sends a range past EOF, receives `502`, and treats it as a hard server error rather than retrying without the range — the embed shows as broken even though the stream is fine and cached. On a Level 3 public media contract this is a behavior the tests do not cover (`tests/mocked.test.js` only exercises the 403→502 case, which is correct).
- Suggestion: forward client-caused statuses (at minimum 416, arguably the whole 4xx range plus `304`) with their headers, and reserve 502 for 5xx/transport failures.

### [MINOR-1] `ENV VIDEOS_DIR=/data/videos` reverses the immediately preceding commit's Render fix without saying so
- File: `Dockerfile:28`
- Problem: base commit `87ab445` ("fix: use /tmp for videos on Render (ephemeral filesystem)") deliberately changed the code default to `/tmp/ytfx_videos`, stating "Render doesn't have persistent /data volume like home server." This commit re-pins the deployed default back to `/data/videos`, and `render.yaml` builds from this same `Dockerfile` (`dockerfilePath: ./Dockerfile`). REQUEST.md lists this only as acceptance criterion 5 and never mentions that it overrides the previous commit's deployment decision.
- Evidence: `rtk git show 87ab445 -- index.js` shows `const VIDEOS_DIR = process.env.VIDEOS_DIR || '/tmp/ytfx_videos';`; `render.yaml` declares `disk: {name: ytfx-data, mountPath: /data}` — so the mount does exist and the container started fine (`[Videos] Directory ready: /data/videos`), but the two commits' stated premises contradict each other.
- Failure scenario: on the next Render deploy, any video already written under `/tmp/ytfx_videos` by the running instance stops being found by the proxy disk fast path and by `/videos` static, so those requests silently fall through to fresh yt-dlp extraction. Low impact now that nothing writes to `VIDEOS_DIR`, but it is an undocumented deployment-config change inside a Level 3 review.
- Suggestion: state the reasoning in `ADR-010` or drop the `ENV` line and let `render.yaml`/compose supply the value per environment.

### [MINOR-2] Express 4 async route handlers lost their try/catch, relying on an undocumented invariant
- File: `index.js:541-544`, `index.js:562-565`, `index.js:747-750`
- Problem: the three crawler branches were converted from `try { await getCachedOrFetch(...) } catch { res.status(500) }` to a bare `await fetchEmbedMetadata(...)`. `express@^4.18.2` (`package.json`) does not catch rejected promises from async handlers, so the routes are safe only because `fetchOEmbed` currently swallows every error (`index.js:185-193`). Nothing states or tests that invariant.
- Failure scenario: any future change that lets `fetchEmbedMetadata` reject — adding a second network call, tightening `fetchOEmbed` to rethrow, or an `AbortController`/`fetch` throwing synchronously — produces an unhandled rejection and a request that hangs until the client times out, with no 500 and no analytics row, instead of the previous explicit 500.
- Suggestion: keep a `try/catch` (or wrap the handlers) so the failure mode stays an explicit status code rather than a hang.

### [NIT-1] `recordOperation('proxy', 0, ...)` records a hardcoded 0ms on all four proxy exits
- File: `index.js:582`, `index.js:607`, `index.js:615`, `index.js:618`
- The pattern is pre-existing, but this commit adds three more call sites and `METRICS.md` was updated in the same commit to describe proxy-side timing. `/stats` will report proxy latency as uniformly 0. Not worth blocking on.

## What I did NOT check

- **Real Discord.** No link was posted to Discord and no Discord crawler touched the service. All crawler behavior is inferred from `User-Agent: Discordbot/2.0` HTTP responses and OpenGraph tag inspection. Whether Discord actually honors the second `og:image` as a fallback, and how it reacts to a declared-vs-actual dimension mismatch (MAJOR-1), is unverified — I reason from the OG spec, not from observed Discord rendering.
- **The author's Playwright browser check** (evidence item 9) was not reproduced; I used `curl` only.
- **Authenticated / age-restricted / cookie-gated videos.** The container ran with `[Cookies] DISABLED`, so `YOUTUBE_COOKIES_B64` paths, cookie-dependent extraction, and the `fetchStreamUrl` code path (which remains in `index.js:292-348` and appears unreferenced) were not exercised.
- **Concurrency.** I did not fire simultaneous cold `/proxy/video` requests, so the `pendingExtractions` dedupe (`index.js:365-378`) is verified only by code reading — including its rejection path and the `.finally()` delete ordering. No test covers it either.
- **Stream-abort behavior.** I did not test a client disconnecting mid-stream, so the `res.destroy(error)` branch (`index.js:621-622`), `pipeline` cleanup, and socket/upstream leak behavior are unverified.
- **The 10 skipped e2e tests** (`tests/e2e.test.js`, network opt-in) were left skipped.
- **Long-lived cache behavior.** The 2-hour stream-URL TTL versus actual googlevideo URL expiry was not tested; I only observed cache hits within seconds.
- **Sustained/large transfers and rate limiting.** Only a 1.9 MB fixture was streamed. The 60 req/min limiter (`index.js:103-115`) applied to `/proxy/video/:id` was not tested against a realistic multi-range player session, which could plausibly exhaust it — I flag this as unverified, not as a finding.
- **Production deployment, real `BASE_URL` domain, CI.** No PR exists, so no CI has run on this branch; I did not deploy anything. Per protocol §7 the work is not done until CI passes on the final head.
- **Dependency vulnerabilities.** I did not run `npm audit`; I take the author's "15 pre-existing" note at face value and consider it out of scope for this diff.
- **`.serena/`** appeared as an untracked directory in the worktree; I did not create, modify, or investigate it, and it is not part of the reviewed commit.

## Round 2

- **Reviewer**: Claude
- **Reviewed implementation head**: `702b06d829c34e7c8eaede5c9501839b9464e239` ("fix: preserve measured Shorts aspect and range errors")
- **Delta reviewed**: `28d4cb6eb8574269dbc28eb68679fdc037c55df6..702b06d829c34e7c8eaede5c9501839b9464e239`
- **Verdict**: APPROVE

### Round-2 state verification

Re-checked immediately before writing this section, after `rtk git fetch origin`:

```
local HEAD:      7bdca17cf29b22ca035821d98264ec96d2f0e58a   (RESPONSE.md commit)
impl head HEAD^: 702b06d829c34e7c8eaede5c9501839b9464e239
remote branch:   7bdca17cf29b22ca035821d98264ec96d2f0e58a
remote master:   87ab445f8e0ad4300ee5b3a67867120ec1100e83
NOT merged into master
PR: []
git status: * perf/instant-shorts-embeds...origin/perf/instant-shorts-embeds
            ?? .serena/
```

Remote feature branch is current (== local HEAD), not merged into `master`, and no PR exists (open or closed) — consistent with `PR: N/A`. `rtk git diff --name-only 702b06d..7bdca17` → `.peer-review/001-instant-shorts-embeds/RESPONSE.md` only, and `rtk git diff --name-only 702b06d -- . ':(exclude).peer-review'` is empty, so the worktree I built and ran is byte-identical to the implementation head for all non-review files.

Authorship and scope of the delta:

```
$ rtk git show -s --format='%an <%ae> | %cn <%ce> | %s' 702b06d
iasonS <sklavenitisi6@gmail.com> | iasonS <sklavenitisi6@gmail.com> | fix: preserve measured Shorts aspect and range errors
(commit body empty — no Co-Authored-By trailer)

$ rtk git diff --stat 28d4cb6..702b06d
 ADR.md 4± | ARCHITECTURE.md 23± | CLAUDE.md 2± | METRICS.md 4± | README.md 6±
 index.js 202± | tests/mocked.test.js 113± | tests/shorts-query-params.test.js 36±
 8 files changed, 337 insertions(+), 53 deletions(-)
```

No implementation files outside the five findings' surface were touched. (One incidental doc cleanup: `ARCHITECTURE.md` drops the stale `**Size:** ~650 lines` line. Not worth a finding.)

### Verification performed (round 2)

**Static checks:**
```
$ rtk npm test -- --run
 Test Files  4 passed | 1 skipped (5)
      Tests  78 passed | 10 skipped (88)
exit 0
$ rtk node --check index.js            → exit 0
$ rtk git diff --check 28d4cb6..702b06d → exit 0
```
78 passed matches RESPONSE.md's claim (up from 74 in round 1: +4 new mocked regressions).

**Docker build + live container (Level 3 full verification run, rebuilt from the reviewed tree):**
```
$ rtk docker build -t ytfx-peer-review:001r2 .      → Successfully built d7f20845b1b7
$ rtk docker run --rm -d --name ytfx-peer-review-001r2 -p 127.0.0.1:3103:3000 \
    -e BASE_URL=https://embed.example.test ytfx-peer-review:001r2
$ rtk curl -fsS http://127.0.0.1:3103/health
{"status":"ok","version":"unknown","uptime":4,"cache":{"size":0,"ttl_ms":7200000},...}
Container log: [Cookies] DISABLED ... / [Videos] Directory ready: /data/videos
```

**Independent ground truth for the three aspect fixtures** (my own measurement, `file(1)` on the bytes I downloaded directly from `i.ytimg.com`, not the service's parser):
```
Sp78zCdzhfA oar2 http=200  JPEG ... 1080x1920
dQw4w9WgXcQ oar2 http=200  JPEG ... 1920x1080
jNQXAC9IVRw oar2 http=200  JPEG ...  320x240
```

**Measured portrait / landscape / 4:3 metadata through the container:**
```
$ rtk curl -sS -A 'Discordbot/2.0' http://127.0.0.1:3103/shorts/Sp78zCdzhfA
og:image .../oar2.jpg  og:image:width 1080  og:image:height 1920
og:video:width 1080    og:video:height 1920
twitter:player:width 1080  twitter:player:height 1920      [time_total=0.125993 code=200]

$ ... /shorts/dQw4w9WgXcQ
og:image .../oar2.jpg  og:image:width 1920  og:image:height 1080
og:video:width 1920    og:video:height 1080
twitter:player:width 1920  twitter:player:height 1080      [time_total=0.055706 code=200]

$ ... /shorts/jNQXAC9IVRw
og:image .../oar2.jpg  og:image:width 320   og:image:height 240
og:video:width 320     og:video:height 240
twitter:player:width 320   twitter:player:height 240       [time_total=0.041534 code=200]
```
Every declared pair equals the independently measured pair. The landscape and 4:3 cases are exactly the MAJOR-1 repro that previously emitted `1080x1920`.

**Probe-failure path (dimension omission rather than invention):**
```
$ rtk curl -sS -o /dev/null -w '%{http_code}' https://i.ytimg.com/vi/zzzzzzzzzzz/oar2.jpg → 404
$ rtk curl -sS -A 'Discordbot/2.0' http://127.0.0.1:3103/shorts/zzzzzzzzzzz
  <meta property="og:image" content="https://i.ytimg.com/vi/zzzzzzzzzzz/oar2.jpg">
  <meta property="og:image:type" content="image/jpeg">          ← no og:image:width/height
  ... no og:video:width, no twitter:player:width ...            [time_total=0.072092 code=200]
container log: [Error] fetchThumbnailDimensions for zzzzzzzzzzz: thumbnail HTTP 404
```

**Bounded, no-yt-dlp crawler path (AC1 re-verified after the probe was added):**
```
$ rtk proxy docker logs ytfx-peer-review-001r2 | grep -c 'yt-dlp'   → 0
```
Zero yt-dlp invocations across all seven crawler requests above. Crawler TTFB stayed 0.04–0.13 s; the probe is issued in parallel with oEmbed (`index.js:309-314`) and capped at 750 ms (`THUMBNAIL_PROBE_TIMEOUT`, `index.js:96`) with a 64 KiB byte cap, so worst-case metadata latency remains bounded by the 1.5 s oEmbed timeout. Measured probe cost:
```
$ rtk curl -sS '.../metrics/history?operation=thumbnail-probe&limit=10'
98ms success Sp78zCdzhfA | 53ms success dQw4w9WgXcQ | 35ms success jNQXAC9IVRw
51ms error   zzzzzzzzzzz ("thumbnail HTTP 404")
```

**Satisfiable Range (cold, upstream path):**
```
$ rtk curl -H 'Range: bytes=0-1023' -D - '.../proxy/video/Sp78zCdzhfA?shorts=1'
HTTP/1.1 206 Partial Content
content-type: video/mp4 | content-length: 1024
content-range: bytes 0-1023/1939586 | accept-ranges: bytes
size=1024 code=206 time=1.985950
```

**Unsatisfiable Range → 416 (the MAJOR-2 repro, upstream path):**
```
$ rtk curl -H 'Range: bytes=99999999-' -D - '.../proxy/video/Sp78zCdzhfA?shorts=1'
HTTP/1.1 416 Range Not Satisfiable
content-type: text/plain | content-length: 0 | content-range: bytes */1939586
size=0 code=416 time=0.025787   (body bytes on disk: 0)
container log: no [Proxy] Download failed line
```
Same request shape on the disk-backed branch, for comparison:
```
$ rtk docker cp full.mp4 ytfx-peer-review-001r2:/data/videos/testDisk_2.mp4
$ rtk curl -H 'Range: bytes=0-99' .../proxy/video/testDisk_2      → 206, Content-Range bytes 0-99/1939586, size=100
$ rtk curl -H 'Range: bytes=99999999-' .../proxy/video/testDisk_2 → 416, Content-Range bytes */1939586
$ rtk curl -I .../proxy/video/testDisk_2                          → 200, Content-Length 1939586, size=0
```
Disk and upstream branches now answer the identical request identically.

**HEAD (warm) and upstream failure:**
```
$ rtk curl -I '.../proxy/video/Sp78zCdzhfA?shorts=1'
HTTP/1.1 200 OK | content-type: video/mp4 | content-length: 1939586 | accept-ranges: bytes
size=0 code=200 time=0.023670
$ rtk curl '.../proxy/video/zzzzzzzzzzz'
HTTP/1.1 502 → {"error":"Failed to download video"}
```

Validation container stopped and removed (`rtk docker stop ytfx-peer-review-001r2` → ok; `docker ps -a --filter name=ytfx-peer-review-001r2` → empty). Temporary fixtures under `/tmp` deleted. No repository file was modified, committed, or pushed by this review.

### Finding resolutions

#### [MAJOR-1] Shorts embeds hardcode 1080x1920, but `oar2.jpg` is the original-aspect-ratio thumbnail — **RESOLVED**
`fetchEmbedMetadata` (`index.js:305-324`) now runs `fetchThumbnailDimensions` in parallel with oEmbed for Shorts, reading at most 64 KiB via `Range: bytes=0-65535` and parsing the JPEG SOF marker (`parseJpegDimensions`, `index.js:198-238`). `buildEmbedHtml` (`index.js:494-504`) emits `og:image:width/height`, `og:video:width/height`, and `twitter:player:width/height` only when `Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0`. Verified against my own independent measurement of all three fixtures: the landscape case now declares 1920x1080 (was 1080x1920) and the 4:3 case 320x240 — the exact failure I reproduced in round 1 is gone. Probe failure omits the dimensions instead of inventing them (`/shorts/zzzzzzzzzzz` above), and the 750 ms / 64 KiB bounds keep AC1 intact (0 yt-dlp calls, 0.04–0.13 s TTFB). The parser handles the standalone-marker and truncated-prefix cases correctly on read; four new mocked regressions cover portrait, landscape, 4:3, the `Range: bytes=0-65535` probe contract, and omission-on-failure. ADR-010 and ARCHITECTURE.md now describe the probe and the omit-rather-than-invent degradation step.

Two residuals I want on the record, neither of them a delta regression and neither blocking:
- The `/watch` and `/:id` routes still hardcode `{width: 1280, height: 720}` without probing (`index.js:313`). For a portrait video shared as `/watch?v=Sp78zCdzhfA`, `og:image:width/height` is truthful (the served `maxresdefault.jpg` really is 1280x720, pillarboxed — I measured it), but `og:video:width/height` claims 16:9 for a 9:16 stream. This is byte-identical to the round-1 head (`rtk git show 28d4cb6:index.js` line 206-207 had the same `isShorts ? 1080 : 1280`), so it is outside this delta and was not raised in round 1; I am not converting it into a new blocker at round 2. Iason may want it as a follow-up cycle.
- The landscape fallback `og:image` is still emitted at a hardcoded `1280x720` even when `maxresdefault.jpg` does not exist (`jNQXAC9IVRw` → HTTP 404, `zzzzzzzzzzz` → HTTP 404). Also unchanged from the round-1 head; a 404 image simply won't render, and the truthful primary `oar2` image precedes it.

#### [MAJOR-2] Unsatisfiable Range on the upstream path returns 502 instead of forwarding 416 — **RESOLVED**
`index.js:727-746` special-cases `upstream.status === 416` before the `!upstream.ok` throw, copies `content-type`/`content-length`/`content-range`/`accept-ranges`, sets the upstream status, and ends the response without a body for HEAD. Reproduced live: the exact round-1 repro now returns `416 Range Not Satisfiable` with `Content-Range: bytes */1939586` and a 0-byte body, and the container logs no `[Proxy] Download failed` line. Disk and upstream paths are now consistent (both 416 with `bytes */1939586`). 5xx/transport failures still map to 502 (`/proxy/video/zzzzzzzzzzz` → 502), and the pre-existing 403→502 mocked test still passes. New mocked regression asserts status 416, `content-range: bytes */100`, and that the client `Range: bytes=999-` was forwarded upstream.

#### [MINOR-1] `ENV VIDEOS_DIR=/data/videos` reverses the preceding commit's Render fix without saying so — **RESOLVED (documentation)**
ADR-010's Consequences now reads: "Docker defaults `VIDEOS_DIR` to the `/data` volume shared by the home-server and Render configurations, while direct local runs retain the `/tmp/ytfx_videos` fallback." I confirmed the premise holds: `render.yaml` declares `disk: {name: ytfx-data, mountPath: /data, sizeGB: 1}` and `dockerfilePath: ./Dockerfile`, and `Dockerfile:28` still sets `ENV VIDEOS_DIR=/data/videos`. The container logged `[Videos] Directory ready: /data/videos`; the local (non-Docker) run I did for MINOR-2 logged `[Videos] Directory ready: /tmp/ytfx_videos`, so both documented paths are real. The behavior is unchanged — the finding was that the deployment-config decision was undocumented, and it is now documented in the right place.

#### [MINOR-2] Express 4 async route handlers lost their try/catch — **RESOLVED**
All three crawler branches now call `sendEmbedResponse` (`index.js:565-576`), which wraps the awaited `fetchEmbedMetadata` **and** `buildEmbedHtml` in an explicit try/catch returning `500 {"error":"Failed to build embed metadata"}`. I verified this at runtime rather than by reading: I imported the exported `app` in a throwaway script outside the repo, stubbed `globalThis.fetch` so oEmbed returned a non-string title (making `escapeHtml` throw inside the handler), and hit all three routes:
```
[Error] /watch embed handler: text.replace is not a function
/watch?v=minor2check  -> 500 {"error":"Failed to build embed metadata"}
[Error] /shorts/minor2check embed handler: text.replace is not a function
/shorts/minor2check   -> 500 {"error":"Failed to build embed metadata"}
[Error] /minor2check embed handler: text.replace is not a function
/minor2check          -> 500 {"error":"Failed to build embed metadata"}
```
An in-handler failure is now a deterministic status code on every crawler route instead of an unhandled rejection and a hang. (The script was deleted; nothing in the repo was touched.)

#### [NIT-1] `recordOperation('proxy', 0, ...)` records a hardcoded 0ms — **RESOLVED**
`proxyVideo` captures `startTime` and defers the success record to `res.once('finish')` with real elapsed wall time (`index.js:697-704`); the error path records elapsed time at failure (`index.js:762-766`). Live `/metrics/history?operation=proxy`:
```
1984ms success upstream       Sp78zCdzhfA
  25ms range-not-satisfiable  Sp78zCdzhfA
  22ms success upstream-head  Sp78zCdzhfA
1291ms error   (yt-dlp "Video unavailable")  zzzzzzzzzzz
 677ms success upstream       Sp78zCdzhfA
   3ms success disk           testDisk_2
```
Non-zero and plausible on all exits, and the new `range-not-satisfiable` status is distinguishable from `success`/`error`. One residual, non-blocking: an unsatisfiable Range on the *disk* branch is still recorded as `status: 'success', source: 'disk'` (the outcome is set before `res.sendFile`, `index.js:713-714`, so Express's own 416 isn't reflected). That mislabeling predates this delta — the round-1 head recorded the same `status: 'success'` unconditionally — and `/metrics` is internal diagnostics only.

### What I did NOT check (round 2)

- **Real Discord.** Still nothing was posted to Discord. Whether Discord actually honors the second `og:image` as a fallback, and whether it re-lays out an embed from a *non*-9:16 `og:video:width/height` pair (the very thing MAJOR-1's fix now emits truthfully), is inferred from the OG spec, not observed. This remains the single largest residual risk on the acceptance criteria.
- **The `/watch` and `/:id` portrait-video case** described under MAJOR-1 — I confirmed the mismatch exists but did not investigate its Discord-side impact or propose a fix; it is outside this delta.
- **`parseJpegDimensions` beyond the three real fixtures plus the synthetic test JPEGs.** I did not fuzz it, and I did not test: progressive JPEG (`0xc2`) from a real YouTube thumbnail, an SOF that straddles a stream-chunk boundary, a JPEG whose SOF sits beyond 64 KiB (would silently omit dimensions), a WebP/PNG served with a `.jpg` name, or an upstream that ignores `Range` and returns the full body with `200`. The synthetic test fixtures are single-chunk 23-byte JPEGs, so the multi-chunk accumulate-and-retry loop in `readJpegDimensions` (`index.js:245-261`) is exercised only by the real network fixtures.
- **Probe timeout behavior under a slow/hanging `i.ytimg.com`.** All four probes I observed completed in 35–98 ms. The 750 ms `AbortController` path, and whether an aborted probe leaks the reader/socket, are verified by code reading only.
- **Concurrency.** No simultaneous cold `/proxy/video` requests; `pendingExtractions` dedupe (`index.js:365-378`) is still unverified, as in round 1. Likewise, concurrent crawler requests for the same ID each issue their own thumbnail probe (no dedupe or cache on the probe) — I did not measure that under load.
- **Stream-abort behavior.** No client disconnect mid-stream, so `res.destroy(error)` (`index.js:769-771`), `pipeline` cleanup, and the interaction between a mid-stream failure and the new `finish`-based metric (where `proxyOutcome` is nulled in the catch) are unverified.
- **Authenticated / age-restricted / cookie-gated videos.** Container ran with `[Cookies] DISABLED`; `YOUTUBE_COOKIES_B64` paths untested. `fetchStreamUrl` (`index.js:292-348` at round-1 numbering) still appears unreferenced and was not exercised.
- **The 10 opt-in e2e tests** (`tests/e2e.test.js`) were left skipped, as in round 1.
- **Long-lived cache behavior**, sustained/large transfers, and the 60 req/min limiter under a realistic multi-range player session — unchanged blind spots from round 1. I consumed 5–6 of the 60/min budget in this review, so the limiter question is still open.
- **The author's Playwright checks** (RESPONSE.md evidence for MAJOR-1) were not reproduced; I used `curl` plus my own `file(1)` measurement of the raw thumbnails, which I consider independent of their method.
- **CI, PR, deployment.** No PR exists and no CI has run on this branch. Per protocol §7 the work is not done until CI passes on the final head; this APPROVE covers `702b06d829c34e7c8eaede5c9501839b9464e239` only, and any further implementation commit invalidates it.
- **`npm audit` / the 15 reported pre-existing dependency vulnerabilities** — not run, out of scope for this delta.
- **`.serena/`** remains untracked in the worktree; I did not create, modify, or inspect it, and it is not part of either reviewed commit.
