# Review Response: Instant Shorts crawler metadata and range streaming
- **Author**: Codex
- **Responding to**: 28d4cb6eb8574269dbc28eb68679fdc037c55df6 — REQUEST_CHANGES
- **New implementation head**: 702b06d829c34e7c8eaede5c9501839b9464e239

## [MAJOR-1] Shorts embeds hardcode 1080x1920, but `oar2.jpg` is the original-aspect-ratio thumbnail
- **Disposition**: fixed
- **Evidence**: Shorts metadata now probes at most 64 KiB of `oar2.jpg` with a 750 ms timeout, in parallel with oEmbed, parses its JPEG SOF dimensions, and emits dimension tags only when the probe succeeds. Mocked regressions cover portrait `1080x1920`, landscape `1920x1080`, 4:3 `320x240`, the `Range: bytes=0-65535` probe contract, and dimension omission on probe failure. Playwright Chromium independently loaded those three public fixtures in 132 ms, 46 ms, and 76 ms respectively and observed the matching primary-image/video dimensions. yt-dlp remains absent from the crawler path.
- **Commit**: 702b06d829c34e7c8eaede5c9501839b9464e239

## [MAJOR-2] Unsatisfiable Range on the upstream path returns 502 instead of forwarding 416
- **Disposition**: fixed
- **Evidence**: The proxy now treats upstream 416 as a client range result, copies the existing response headers, preserves status/body semantics, and reserves 502 for other upstream failures. The new mocked regression asserts `416`, `Content-Range: bytes */100`, and forwarded Range. The rebuilt container returned `416 Range Not Satisfiable`, `Content-Range: bytes */1939586`, zero body, and did not log a proxy failure for `Range: bytes=99999999-`.
- **Commit**: 702b06d829c34e7c8eaede5c9501839b9464e239

## [MINOR-1] `ENV VIDEOS_DIR=/data/videos` reverses the immediately preceding commit's Render fix without saying so
- **Disposition**: fixed
- **Evidence**: ADR-010 now states that Docker uses `/data/videos` because both the home-server and checked-in Render configuration mount `/data`, while direct local runs keep the `/tmp/ytfx_videos` fallback. It also records that fresh streams are no longer persisted, so this path applies only to completed pre-existing files.
- **Commit**: 702b06d829c34e7c8eaede5c9501839b9464e239

## [MINOR-2] Express 4 async route handlers lost their try/catch
- **Disposition**: fixed
- **Evidence**: All three crawler routes now delegate to `sendEmbedResponse()`, which contains the awaited metadata/build path in an explicit try/catch and returns a deterministic 500 JSON response if a future metadata dependency rejects.
- **Commit**: 702b06d829c34e7c8eaede5c9501839b9464e239

## [NIT-1] Proxy metrics record a hardcoded 0ms
- **Disposition**: fixed
- **Evidence**: Proxy success records are now emitted from the response `finish` event using elapsed wall time; error records use elapsed time at failure. Built-container history recorded 2013 ms for the cold partial stream, 283 ms for the unsatisfiable Range, and 27 ms for warm HEAD instead of zero.
- **Commit**: 702b06d829c34e7c8eaede5c9501839b9464e239

## Final delivery evidence

Pending round-two approval. `rtk npm test -- --run` passes with 78 passed and 10 opt-in e2e tests skipped; `rtk node --check index.js` and `rtk git diff --check` pass. No PR, CI run, merge, or deployment has occurred yet.
