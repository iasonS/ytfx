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

---

## How to use this file

1. **Before changing yt-dlp options**: Read ADR-001 through ADR-004 and ADR-008
2. **Before changing cookie handling**: Read ADR-005 and ADR-006
3. **Before changing cache**: Read ADR-007
4. **Before committing**: Read ADR-009
5. **After making an architectural change**: Add a new ADR entry here
