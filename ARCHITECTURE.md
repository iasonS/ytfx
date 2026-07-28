# Architecture Guide

## System Overview

ytfx is a lightweight proxy service that enables Discord to display playable YouTube embeds. The system has three core responsibilities:

1. **Video Extraction** - Lazily get a stream URL from YouTube using yt-dlp when the local media proxy is requested
2. **Embed Generation** - Return bounded oEmbed-derived OpenGraph/Twitter Card metadata for Discord's crawler
3. **Analytics** - Track requests and performance for monitoring

## Request Flow

```
User shares proxy URL in Discord
         ↓
Discord bot crawler detects Discordbot user-agent
         ↓
ytfx receives request
         ↓
Fetch oEmbed with a short timeout
    ↓
Log analytics to SQLite
    ↓
Return HTML with a stable /proxy/video URL
    ↓
Discord's crawler embeds video
    ↓
Player requests /proxy/video, which resolves/caches yt-dlp stream metadata and relays bytes
```

## Code Structure

### `index.js` (Main Application)
**Responsibilities:**
- Express server setup
- Route handlers for `/watch`, `/shorts`, `/:id`
- Cache management
- Video ID extraction and validation
- Rate limiting
- Metrics collection

**Key Functions:**
- `fetchEmbedMetadata()` - Fetches bounded oEmbed metadata for crawler responses
- `fetchOEmbed()` - Calls YouTube's public oEmbed API for title/metadata
- `getVideoInfo()` - Calls yt-dlp to extract stream URL and video dimensions
- `getCachedOrFetch()` - Lazy stream URL cache with TTL and pending-extraction dedupe
- `buildEmbedHtml()` - Generates HTML response with metadata tags
- `isDiscordBot()` - Detects Discord crawler user-agent

**Size:** ~650 lines
**Dependencies:** express, youtube-dl-exec, express-rate-limit

### `db.js` (Analytics Database)
**Responsibilities:**
- SQLite database initialization
- Request logging and aggregation
- Statistics queries

**Key Functions:**
- `initDb()` - Create tables if needed
- `logRequest()` - Record request to database
- `getStats()` - Aggregate and return statistics

**Database Schema:**
```sql
CREATE TABLE requests (
  id INTEGER PRIMARY KEY,
  timestamp DATETIME,
  video_id TEXT,
  type TEXT,              -- 'watch', 'shorts', 'short-form'
  success INTEGER,        -- 1 or 0
  response_ms INTEGER,    -- Response time
  ip_address TEXT,
  user_agent TEXT
);
```

**Size:** ~150 lines
**Dependencies:** sql.js (in-memory SQLite)

### `metrics.js` (Performance Tracking)
**Responsibilities:**
- Track timing for each operation
- Calculate percentiles and aggregations
- Provide metrics API

**Key Functions:**
- `recordOperation()` - Record timing for one operation
- `getMetricsSummary()` - Get aggregated stats by operation type
- `getOperationHistory()` - Get raw timing records for debugging

**Size:** ~100 lines
**Dependencies:** None (pure JavaScript)

### `emoticons.js`
Easter egg: Rotating cute emoticons for the root path.

### Configuration Files

**`.env.example`**
```
YOUTUBE_COOKIES=...      # YouTube auth cookies (required for age-restricted)
PORT=3000                # Server port
STATS_TOKEN=...          # Token for /stats endpoint
DB_PATH=/data/ytfx.db    # Analytics database location
```

**`Dockerfile`**
Multi-stage build:
- Base: Node 22 Alpine
- Runtime: Includes Python 3 + pip for yt-dlp
- Volumes: `/data` for persistent SQLite database

**`vitest.config.js`**
Test configuration using vitest + supertest for HTTP testing.

## Performance Characteristics

### Request Timing (Cache Miss Scenario)

```
Total: bounded oEmbed latency plus HTML generation, normally well below stream extraction time.

yt-dlp extraction is deferred until the media proxy is requested.
```

### Cache Hit Performance
```
Total: ~1-10ms (cached data returned immediately)
```

### Factors Affecting Speed

**yt-dlp Extraction Time** (80% of latency)
- YouTube server response time (network latency)
- Format probing (trying different quality levels)
- YouTube cookie freshness (expired = slower)

**oEmbed Fetch Time** (10-20% of latency)
- YouTube API response time
- Network latency to YouTube

**Cache Hit Rate**
- Same video requested multiple times?
- TTL setting (currently 2 hours)
- Number of unique videos served

## Data Flow

### Request → Response

```javascript
// 1. Receive request (Discord bot or regular browser)
app.get('/watch', (req, res) => {

  // 2. Extract video ID
  const videoId = extractVideoId(req, 'watch');

  // 3. Check if Discord bot (if not, redirect to YouTube)
  if (isDiscordBot(req)) {

    // 4. Fetch bounded title metadata only
    const data = await fetchEmbedMetadata(videoId);

    // 5. Generate embed HTML
    const html = buildEmbedHtml(data, videoId);

    // 6. Return HTML with metadata tags
    res.send(html);
  }
});
```

### Caching Strategy

```javascript
const cache = new Map();              // In-memory cache
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours

// Check cache first
if (cache.has(videoId)) {
  if (Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;               // Cache hit!
  }
}

// Cache miss - extract a stream only for /proxy/video requests
const data = await getVideoInfo(videoId, isShorts);
cache.set(videoId, { data, timestamp: Date.now() });
```

**Benefits:**
- Fast responses for repeat requests
- Reduces load on YouTube
- Simple in-memory implementation

**Limitations:**
- Lost on server restart
- No distributed cache (single instance only)
- Memory grows with unique videos served

**Future improvements:**
- Redis for distributed caching
- File-based persistence
- LRU eviction for memory limits

## Rate Limiting

```javascript
const limiter = rateLimit({
  windowMs: 60 * 1000,    // 1 minute window
  max: 60,                // 60 requests per window
  keyGenerator: (req) => req.ip  // Per IP address
});
```

**Why:** Prevents abuse and excessive YouTube requests.

**Exceptions:** `/health` and `/stats` endpoints bypass rate limiting.

## Error Handling

### Levels of Degradation

1. **oEmbed succeeds** → Return its title and deterministic embed metadata
2. **oEmbed fails or times out** → Return the fallback title and deterministic metadata
3. **yt-dlp succeeds** → The proxy relays the stream
4. **yt-dlp or upstream media fails** → The proxy returns 502; already-issued metadata remains valid

This graceful degradation ensures embeds work even during YouTube issues.

## Metrics Architecture

Every operation is timed and recorded:

```javascript
const startTime = Date.now();
try {
  const result = await someOperation();
  const duration = Date.now() - startTime;
  recordOperation('operation-name', duration, { videoId, status: 'success' });
} catch (error) {
  const duration = Date.now() - startTime;
  recordOperation('operation-name', duration, { videoId, status: 'error' });
}
```

**Stored in-memory**, aggregated on request to `/metrics`:

- Operation counts
- Timing percentiles (p50, p95, p99)
- Recent operation history

See **METRICS.md** for detailed usage.

## Testing

**Test Framework:** Vitest + Supertest
**Test Files:** `tests/` directory

### Test Types

1. **Unit Tests** (`unit.test.js`)
   - `extractVideoId()` with various URL formats
   - `escapeHtml()` with special characters
   - Cache invalidation logic

2. **Integration Tests** (`integration.test.js`)
   - Full request/response flow
   - `/go` endpoint URL conversion
   - Rate limiting behavior

3. **Mocked Tests** (`mocked.test.js`)
   - yt-dlp mocking (no external YouTube calls)
   - Cache behavior
   - Error handling with fallbacks

4. **Format Tests** (`shorts-query-params.test.js`)
   - YouTube Shorts detection
   - Query parameter handling
   - URL normalization

**Run tests:**
```bash
npm test          # Run once
npm run test:watch # Watch mode
```

## Deployment

### Docker Deployment
```dockerfile
# Node 22 Alpine base
# Python 3 + yt-dlp
# Persistent /data volume for SQLite database
```

### Environment Configuration

```env
YOUTUBE_COOKIES=...    # Required for age-restricted videos
PORT=3000              # Optional, default 3000
STATS_TOKEN=...        # Required to access /stats endpoint
NODE_ENV=production    # Optimize for production
DB_PATH=/data/ytfx.db  # Persistent database location
```

### Monitoring Endpoints

- `/health` - Server status + cache size + uptime
- `/metrics` - Performance metrics (no auth)
- `/stats` - Analytics and request counts (requires STATS_TOKEN)
- `/metrics/history` - Raw operation timing records (no auth)

## Design Decisions

### Why Lazy yt-dlp?

Crawler metadata needs a title, thumbnail, dimensions, and a stable local media URL, not a resolved YouTube stream. Deferring yt-dlp keeps crawler response time independent of cold extraction while retaining proxy control over media delivery.

### Why In-Memory Cache?

- Simple, no external dependencies
- Good for typical usage (mostly repeat videos)
- Acceptable to lose on restart (metadata can be re-fetched)

For higher scale, upgrade to Redis.

### Why yt-dlp Over API?

- Handles age-restricted videos (with cookies)
- Extracts best stream URL automatically
- Works reliably despite YouTube API changes
- More flexible than oEmbed alone

### Why 2-Hour Cache TTL?

Balances:
- **Fast responses** (cache hit)
- **Fresh metadata** (video title, thumbnail changes)
- **Memory usage** (doesn't grow unbounded)

### Why No Database Persistence By Default?

- Simpler deployment (no schema migrations)
- SQLite in-memory works for moderate load
- Analytics can be reset/restarted without data loss

For production: Add persistent SQLite with backups.

## Future Improvements

1. **Redis Cache** - Distributed caching across instances
2. **Persistent Analytics** - Long-term metrics storage
3. **Webhook Notifications** - Alert on slow embeds
4. **Format Selection UI** - Let users choose video quality
5. **Metrics Export** - Prometheus/Grafana integration
6. **Stream Mirror** - Mirror streams to reduce YouTube load
