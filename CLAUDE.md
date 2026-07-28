# ytfx Reference

## Architecture

`index.js` is the Express service on port 3000. Discord crawler routes return bounded oEmbed/thumbnail-derived metadata with local `/proxy/video/:id` media URLs; the proxy lazily invokes yt-dlp, caches stream URLs for two hours, and relays upstream bytes. `db.js` stores analytics, `metrics.js` tracks operation timing, and `public/` contains static assets.

## Configuration

- `PORT` (default `3000`)
- `VIDEOS_DIR` (Docker default `/data/videos`)
- `BASE_URL` (otherwise request host is used)
- `YOUTUBE_COOKIES_B64` or `YOUTUBE_COOKIES`
- `DB_PATH`
- `STATS_TOKEN`

## Validation

Run `npm test` for the full suite, or `npx vitest run tests/unit.test.js tests/mocked.test.js` for the focused metadata/proxy tests.

## Self-hosted Docker

Build with `docker build -t ytfx .` and run with a persistent host volume mounted at `/data`. Rebuild and restart only this service when deploying image changes; configure the public `BASE_URL` and required cookies through the runtime environment.
