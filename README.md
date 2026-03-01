# ytfx - YouTube Discord Embed Proxy

A proxy service that enables Discord video embeds for YouTube links by providing proper OpenGraph and Twitter Card metadata with direct video stream URLs.

## How It Works

When a YouTube link is shared on Discord with this proxy:

1. **Discord bot fetches metadata**: Discord's crawler detects the `Discordbot` user agent and fetches the proxy URL
2. **Proxy returns embed HTML**: The service returns metadata with a direct MP4 stream URL
3. **Discord shows playable embed**: Users see a playable video player in the chat instead of a basic link preview

## URL Format

Replace `youtube.com` domain with your service domain:

```
YouTube Shorts:
  Original:  https://youtube.com/shorts/VIDEO_ID
  Proxy:     https://yourservice.com/shorts/VIDEO_ID

Standard Video:
  Original:  https://www.youtube.com/watch?v=VIDEO_ID
  Proxy:     https://yourservice.com/watch?v=VIDEO_ID

youtu.be Short:
  Original:  https://youtu.be/VIDEO_ID
  Proxy:     https://yourservice.com/VIDEO_ID
```

## Local Development

### Prerequisites
- Node.js >= 18
- Python 3.11+ (for yt-dlp)
- yt-dlp installed via pip: `pip install yt-dlp`

### Setup

```bash
cd ytfx
npm install
node index.js
```

Server runs on `http://localhost:3000`

### Testing

**Test with Discord bot user agent:**
```bash
curl -H "User-Agent: Discordbot/2.0" \
  http://localhost:3000/shorts/qOiL2V2PWHY
```
Returns: HTML with `og:video:url` containing direct MP4 stream URL

**Test human redirect:**
```bash
curl -L http://localhost:3000/shorts/qOiL2V2PWHY
```
Should land on `https://www.youtube.com/shorts/qOiL2V2PWHY`

**Health check:**
```bash
curl http://localhost:3000/health
```

## Deployment

### Railway.app

1. Push this repo to GitHub
2. Go to [Railway.app](https://railway.app) and create a new project
3. Select "Deploy from GitHub repo"
4. Choose this repository
5. Set environment variables:
   - `YTDL_PATH=yt-dlp`
   - `BASE_DOMAIN=yourservice.com` (optional, for logging)
6. Railway auto-detects the `Procfile` and builds with `nixpacks.toml`

### Custom Domain

In Railway dashboard:
- Go to Deployments → Settings
- Add custom domain (e.g., `ytfx.example.com`)
- Update DNS with CNAME record pointing to Railway's hostname

## How It Works (Technical)

- **Discord Detection**: Checks `user-agent` header for `Discordbot` string
- **Video Extraction**: Parses video ID from URL parameters
- **Metadata Fetching**:
  - YouTube oEmbed API for title/basic info
  - yt-dlp for video stream URLs (720p max)
- **HTML Response**: Returns page with OpenGraph + Twitter Card metadata pointing to direct MP4 stream
- **Caching**: 30-minute in-memory cache to reduce API calls
- **Human Redirect**: Non-bot users get temporary 302 redirect to original YouTube

## Architecture

```
index.js (single file)
├── isDiscordBot()       → Detect Discord crawler
├── extractVideoId()     → Parse video ID from URL
├── fetchVideoData()     → Parallel oEmbed + yt-dlp calls
├── getCachedOrFetch()   → Cache with TTL
├── buildEmbedHtml()     → Generate metadata HTML
└── Routes
    ├── /health         → Health check
    ├── /watch          → Standard YouTube videos
    ├── /shorts/:id     → YouTube Shorts
    └── /:id            → youtu.be style (catch-all)
```

## Environment Variables

- `PORT` - Server port (default: 3000)
- `YTDL_PATH` - Path to yt-dlp binary (default: `yt-dlp`)
- `BASE_DOMAIN` - Optional, for logging purposes

## Notes

- Stream URLs are valid for ~6 hours, cached for 30 minutes
- Maximum video quality: 720p (balances quality with extraction speed)
- Human users get temporary 302 redirects (no browser caching)
- No external dependencies on Redis or databases
- Runs on free tier hosting (single service, modest resource usage)

## License

MIT
