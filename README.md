# ytfx — YouTube Discord Embed Proxy

Enable Discord to display **playable video embeds** for YouTube links. Share a YouTube video in Discord and viewers see an embedded player instead of a plain link.

![Status](https://img.shields.io/badge/status-active-brightgreen) ![License](https://img.shields.io/badge/license-MIT-blue)

## What Is This?

When you share a YouTube link in Discord, Discord normally shows just a preview image and title. **ytfx** is a small proxy service that makes Discord display a **fully playable video embed** directly in chat.

**How?** Discord crawls certain domains looking for video metadata. ytfx sits between you and YouTube, extracts the video stream using yt-dlp, and returns proper OpenGraph + Twitter Card metadata that Discord's crawler recognizes—resulting in an embedded player.

## Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+ (for yt-dlp)
- YouTube account (for authentication)

### Setup

**1. Install dependencies:**
```bash
cd ~/ytfx
npm install
pip install yt-dlp
```

**2. Get YouTube cookies:**
This is critical—YouTube requires authentication to access videos, especially age-restricted content.

- Open a **new private/incognito browser window**
- Log into YouTube (in that window)
- Navigate to `https://www.youtube.com/robots.txt`
- Use a browser extension like [Cookie Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) to export cookies
- Copy the cookie string (semicolon-separated)
- **Close the incognito window immediately** (important!)

**3. Configure environment:**
```bash
cp .env.example .env
# Edit .env and paste your cookies:
# YOUTUBE_COOKIES=__Secure-3PSID=xxx;GPS=1;...
```

**4. Run:**
```bash
npm run dev
```

Server listens on `http://localhost:3000`

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

**URL Converter Endpoint:**
```bash
# Pass any YouTube URL and get redirected to proxy equivalent
curl "http://localhost:3000/go?url=https://youtube.com/watch?v=dQw4w9WgXcQ"
# → Redirects to /watch?v=dQw4w9WgXcQ
```

## How It Works

```
User shares proxy URL in Discord
         ↓
Discord's bot crawler fetches the URL (detects Discordbot user-agent)
         ↓
ytfx extracts video ID from URL
         ↓
ytfx fetches metadata from YouTube (title, thumbnail, stream URL)
         ↓
ytfx returns HTML page with OpenGraph + Twitter Card metadata
         ↓
Discord's crawler reads metadata and displays video embed
         ↓
Discord users see playable video in chat ✓
```

**For regular users:** If someone visits the proxy URL in their browser, they're redirected to the original YouTube video.

## Features

- **Self-contained**: Single 380-line Node.js service
- **Caching**: 30-minute TTL reduces API calls
- **Fast**: Parallel oEmbed + yt-dlp extraction
- **Video quality**: 720p MP4 (balances quality with speed)
- **Stateless**: No database or Redis required
- **Cheap to host**: Runs on free tier hosting (Railway, Render, etc.)

## Testing

**Health check:**
```bash
curl http://localhost:3000/health
```

**Test with Discord user-agent:**
```bash
curl -H "User-Agent: Discordbot/2.0" \
  http://localhost:3000/shorts/dQw4w9WgXcQ
```

Should return HTML with `og:video:url` containing an MP4 stream URL.

**Test regular user redirect:**
```bash
curl -L http://localhost:3000/shorts/dQw4w9WgXcQ
```

Should redirect to `https://www.youtube.com/shorts/dQw4w9WgXcQ`

## Deployment

### Railway.app (Recommended)

Railway auto-detects this repo's `Procfile` and `nixpacks.toml` for instant deployment:

1. Push repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project
3. Select "Deploy from GitHub repo"
4. Choose this repository
5. Set environment variables in Railway dashboard:
   - `YOUTUBE_COOKIES` — Paste your exported cookies
   - `PORT` — 3000 (or Railway's assigned port)
6. Deploy ✓

**Add custom domain:**
- In Railway dashboard → Domains
- Add your domain (e.g., `ytfx.example.com`)
- Update DNS with CNAME record pointing to Railway's hostname

### Other Platforms

Works anywhere Node.js 18+ runs:
- **Vercel**: Not recommended (serverless timeout issues)
- **Heroku**: Set `YOUTUBE_COOKIES` env var
- **Render**: Similar to Railway
- **Self-hosted**: `npm start`

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `yt-dlp: command not found` | Install: `pip install yt-dlp` or add to PATH |
| `[yt-dlp] NO COOKIES` in logs | Set `YOUTUBE_COOKIES` in `.env` or environment |
| Video extraction fails | Cookies may be expired—re-export from fresh private window |
| Age-restricted videos don't work | Must use valid YouTube auth cookies |
| Cache isn't clearing | Check logs for `[Cache] Cleaned up` messages (runs every 5 min) |

## Environment Variables

| Variable | Required | Default | Notes |
|----------|----------|---------|-------|
| `YOUTUBE_COOKIES` | Yes* | — | Semicolon-separated YouTube auth cookies |
| `PORT` | No | 3000 | Server port |

*Required for full functionality; will partially work without but age-restricted videos will fail.

## Architecture

```
index.js
├── Express server + routing
├── Discord bot detection (user-agent check)
├── Video ID extraction & validation
├── Parallel metadata fetching
│   ├── YouTube oEmbed API (title, thumbnail)
│   └── yt-dlp (stream URL extraction)
├── In-memory cache (30-minute TTL)
└── HTML response generation (OpenGraph + Twitter Card)
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/watch?v=ID` | GET | Standard YouTube videos |
| `/shorts/ID` | GET | YouTube Shorts |
| `/:ID` | GET | youtu.be short URLs (catch-all) |
| `/go?url=...` | GET | URL converter |

## Notes

- Stream URLs expire after ~6 hours; cache prevents re-extraction
- Maximum quality capped at 720p for speed (balance)
- Caching reduces bandwidth and improves Discord embed loading
- No external databases—everything in-memory
- Human users (non-Discord bots) always redirect to original YouTube

## License

MIT
