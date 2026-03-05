# Architecture Decision Records (ADR)

**Purpose**: Track WHY things are the way they are. Before changing any of these, understand the reasoning first. If you make a change that affects architecture, ADD AN ENTRY HERE.

---

## ADR-001: yt-dlp requires `remoteComponents: 'ejs:github'`
**Date**: 2026-03-04
**Status**: Superseded by ADR-010 (on feature/youtubei branch)
**Context**: yt-dlp 2026.02.21+ requires the External JavaScript Solver (EJS) to solve YouTube's n-parameter challenge. Without it, YouTube returns zero video formats and extraction silently fails with empty error messages.
**Decision**: Always pass `remoteComponents: 'ejs:github'` in yt-dlp options.
**Consequence**: First run on a fresh deploy may be slightly slower as EJS is downloaded. Requires network access to GitHub from the server.
**Symptoms if removed**: `WARNING: [youtube] n challenge solving failed`, `Only images are available for download`, empty error strings in logs.

## ADR-002: yt-dlp requires `dumpJson: true`
**Date**: 2026-03-04
**Status**: Superseded by ADR-010 (on feature/youtubei branch)
**Context**: `youtube-dl-exec` (the Node.js wrapper) returns a raw stdout string by default. The code accesses `result.url`, `result.formats`, `result.width`, `result.height` — all of which require parsed JSON.
**Decision**: Always pass `dumpJson: true` in yt-dlp options when we need structured data back.
**Consequence**: Response includes full JSON metadata (large output), but we only use a few fields.
**Symptoms if removed**: `result.url` is `undefined`, stream URL extraction always fails, error message is empty/misleading.

## ADR-003: yt-dlp requires `jsRuntimes: 'node'`
**Date**: 2026-03-03
**Status**: Superseded by ADR-010 (on feature/youtubei branch)
**Context**: YouTube uses JavaScript challenges for bot detection. yt-dlp needs a JS runtime to solve them. Node.js is already available in our runtime.
**Decision**: Always pass `jsRuntimes: 'node'`.
**Consequence**: Depends on Node.js being available in the container/server environment.
**Symptoms if removed**: `WARNING: [youtube] No supported JavaScript runtime could be found`.

## ADR-004: InnerTube timeout is 15 seconds
**Date**: 2026-03-04 (updated: reduced from 30s/8s — no EJS cold start with InnerTube)
**Status**: Active
**Context**: InnerTube API calls typically complete in 1-2 seconds (no Python spawn, no EJS download). 15-second timeout provides generous margin for cold starts and slow networks.
**Decision**: 15-second timeout in `executeWithTimeout()`.
**Consequence**: Slow requests take up to 15 seconds before failing. Cache mitigates this for repeated requests (2-hour TTL).
**Symptoms if too low**: `Timeout after Xms` errors on valid videos.

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

## ADR-008: itag 18 (360p MP4)
**Date**: 2026-03-02 (updated: now used with InnerTube instead of yt-dlp)
**Status**: Active
**Context**: itag 18 is YouTube's pre-muxed 360p MP4 (video+audio). It's the fastest to use because it doesn't require separate audio/video stream merging or DASH manifest parsing.
**Decision**: Prefer itag 18 from `streaming_data.formats`, fallback to any pre-muxed MP4.
**Consequence**: Video quality is 360p. Sufficient for Discord embeds which auto-play at low quality anyway.

## ADR-009: Git authorship — always `iasonS`
**Date**: 2026-03-02
**Status**: Active
**Context**: All commits across all projects must be authored by `iasonS <sklavenitisi6@gmail.com>`. No Co-Authored-By lines. No Claude/Anthropic attribution.
**Decision**: Always set `git config user.name "iasonS"` and `git config user.email "sklavenitisi6@gmail.com"` before committing.
**Consequence**: Must verify authorship before every commit.

## ADR-010: Switch from yt-dlp to youtubei.js (feature/youtubei branch)
**Date**: 2026-03-04
**Status**: Active
**Context**: yt-dlp (Python CLI via `youtube-dl-exec`) required spawning a Python process for every cold request, plus downloading the EJS solver and solving the n-parameter challenge. This added ~7s per cold request on Render. youtubei.js is a pure Node.js library that uses YouTube's InnerTube API directly, eliminating the Python dependency entirely.
**Decision**: Replace `youtube-dl-exec` with `youtubei.js` on the `feature/youtubei` branch. Use `Innertube.create()` with a lazy-initialized singleton and `getBasicInfo(videoId)` for extraction. Look for itag 18 in `streaming_data.formats` (same 360p MP4 as ADR-008). Use `format.url` directly when available, fall back to `format.decipher(player)` for ciphered streams.
**Consequence**:
- ~7s → ~1-2s per cold request (no Python spawn, no EJS download, no n-param solving)
- ~100MB smaller Docker image (no Python/yt-dlp layer)
- Cookies passed as header string to `Innertube.create({ cookie })` instead of Netscape file
- Supersedes ADR-001 (EJS), ADR-002 (dumpJson), ADR-003 (jsRuntimes) — all yt-dlp-specific
- master branch retains yt-dlp approach as stable fallback
**Risk**: youtubei.js depends on reverse-engineering YouTube's InnerTube API. API changes may require library updates.

---

## How to use this file

1. **Before changing InnerTube extraction**: Read ADR-008, ADR-010, and ADR-004
2. **Before changing cookie handling**: Read ADR-005 and ADR-006
3. **Before changing cache**: Read ADR-007
4. **Before committing**: Read ADR-009
5. **After making an architectural change**: Add a new ADR entry here
6. **yt-dlp specific (master branch only)**: ADR-001 through ADR-003
