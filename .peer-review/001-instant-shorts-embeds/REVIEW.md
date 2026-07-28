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
