# ytfx — YouTube Discord Embed Proxy

Enable Discord to display **playable video embeds** for YouTube links. Share a YouTube video in Discord and viewers see an embedded player instead of a plain link.

![Status](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## What Is This?

When you share a YouTube link in Discord, Discord normally shows just a preview image and title. **ytfx** is a small proxy service that makes Discord display a **fully playable video embed** directly in chat.

**How?** Discord crawls certain domains looking for video metadata. ytfx sits between you and YouTube, extracts the video stream using yt-dlp, and returns proper OpenGraph + Twitter Card metadata that Discord's crawler recognizes—resulting in an embedded player.

## Features

- **Embedded Video Player**: Discord shows full video embed in chat
- **Request Analytics**: SQLite database tracks requests, videos, success rate, referrers
- **Rate Limiting**: 60 requests/minute per IP (protects against abuse)
- **Caching**: 30-minute TTL reduces API calls to YouTube
- **Fast**: Parallel oEmbed + yt-dlp metadata extraction
- **Docker Ready**: Containerized with persistent /data volume
- **Statistics API**: `/stats` endpoint with request analytics (token-protected)
- **Link Tracking**: Optional `?ref=` parameter for referral tracking

## Quick Start

### Local Development

**Prerequisites:**
- Node.js 22+
- Python 3 (for yt-dlp)

**Setup:**
```bash
npm install
cp .env.example .env
# Edit .env and add YOUTUBE_COOKIES
npm run dev
```

**Test:**
```bash
# Health check
curl http://localhost:3000/health

# With Discord user-agent
curl -H "User-Agent: Discordbot/2.0" \
  "http://localhost:3000/watch?v=dQw4w9WgXcQ"
```

### Docker Deployment

```bash
docker build -t ytfx .
docker run -p 3000:3000 \
  -e PORT=3000 \
  -e NODE_ENV=production \
  -e YOUTUBE_COOKIES="your_cookies_here" \
  -e STATS_TOKEN="your_token_here" \
  -v ytfx-data:/data \
  ytfx
```

### Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `YOUTUBE_COOKIES` | Yes* | — | Semicolon-separated auth cookies |
| `PORT` | No | 3000 | Server port |
| `NODE_ENV` | No | development | Set to `production` for deployment |
| `DB_PATH` | No | Auto | Database path (`/data/ytfx.db` in Docker) |
| `STATS_TOKEN` | No | — | Token required for `/stats` endpoint |

*Required for full functionality; age-restricted videos will fail without valid cookies.

## Usage

Replace YouTube domain with your proxy domain:

```
YouTube Shorts:
  Original:  https://youtube.com/shorts/VIDEO_ID
  Proxy:     https://your-domain.com/shorts/VIDEO_ID

Standard Video:
  Original:  https://www.youtube.com/watch?v=VIDEO_ID
  Proxy:     https://your-domain.com/watch?v=VIDEO_ID

Short URL:
  Original:  https://youtu.be/VIDEO_ID
  Proxy:     https://your-domain.com/VIDEO_ID
```

## API Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/` | GET | — | Easter egg (redirects to YouTube) |
| `/health` | GET | — | Health check + uptime + cache info |
| `/watch?v=ID` | GET | — | Standard YouTube videos |
| `/shorts/ID` | GET | — | YouTube Shorts |
| `/:ID` | GET | — | youtu.be short URLs |
| `/go?url=URL` | GET | — | URL converter |
| `/stats?token=TOKEN` | GET | Bearer | Request analytics |

**Stats Response Example:**
```json
{
  "requests": {
    "all_time": 1234,
    "today": 56,
    "last_hour": 3
  },
  "top_videos": [
    {"video_id": "dQw4w9WgXcQ", "count": 42}
  ],
  "by_type": [
    {"type": "watch", "count": 800},
    {"type": "shorts", "count": 434}
  ],
  "success_rate": 98.5,
  "top_refs": [
    {"ref": "alice", "count": 200}
  ]
}
```

## Testing

Run the full test suite:
```bash
npm test          # Run tests once
npm run test:watch # Watch mode
```

Tests include unit tests, integration tests, and mocked yt-dlp tests.

## How It Works

```
User shares proxy URL in Discord
         ↓
Discord bot crawler fetches URL (detects Discordbot user-agent)
         ↓
ytfx logs request to SQLite database
         ↓
ytfx extracts video ID and checks cache
         ↓
ytfx fetches metadata from YouTube (title, thumbnail, stream URL)
         ↓
ytfx returns HTML with OpenGraph + Twitter Card metadata
         ↓
Discord's crawler embeds video and shows playable player
         ↓
Viewer clicks embed and watches video ✓
```

**For regular users:** If someone visits the proxy URL in their browser (non-Discord), they're redirected to the original YouTube video.

## Link Tracking

Track referrals by adding `?ref=` query parameter:

```
https://your-domain.com/shorts/ID?ref=alice
https://your-domain.com/watch?v=ID?ref=twitter
```

The referrer is logged to the database and surfaced in `/stats` endpoint for analytics.

## Architecture

```
index.js (main application)
├── Express server + routing
├── Discord bot detection
├── Video ID extraction & validation
├── Rate limiting (express-rate-limit)
├── Analytics middleware
└── Cache management (30-min TTL)

db.js (SQLite analytics)
├── Database initialization
├── Request logging
├── Statistics aggregation
└── Persistent storage to /data/ytfx.db

Dockerfile (containerization)
├── Node 22 Alpine base
├── Python 3 + yt-dlp
└── Production-ready image
```

## Deployment

Currently deployed to **Render** with:
- Docker container
- 1GB persistent disk at `/data`
- Automatic deployment on GitHub push
- Custom domain support

See `infra/services.yaml` for infrastructure details.

For self-hosted deployment, use the provided `Dockerfile`:
```bash
docker build -t ytfx .
docker run -v /path/to/data:/data ytfx
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `yt-dlp: command not found` | Install: `pip install yt-dlp` |
| Videos don't extract | YouTube cookies expired—re-export from private browser |
| 429 Rate Limit errors | Too many requests (60/min limit). Implement backoff retry. |
| Database errors | Check `/data` directory has write permissions |
| Stats endpoint returns 500 | `STATS_TOKEN` env var not configured |

## License

MIT
