# Performance Metrics Guide

ytfx now tracks detailed performance metrics for every operation. Use these to identify bottlenecks and understand why embeds take time to load.

## Quick Start

Check current performance metrics:

```bash
# Metrics for last 24 hours
curl http://localhost:3000/metrics

# Metrics for last 1 hour
curl http://localhost:3000/metrics?hours=1

# Raw operation history (for debugging)
curl http://localhost:3000/metrics/history

# Filter by operation type
curl "http://localhost:3000/metrics/history?operation=yt-dlp&limit=50"
```

## How It Works

ytfx tracks timing for these operations:

| Operation | What It Measures | Typical Duration |
|-----------|------------------|------------------|
| **oEmbed** | Fetching video title/metadata from YouTube API | 200-800ms |
| **yt-dlp** | Extracting stream URL using yt-dlp | 1000-5000ms |
| **cache-hit** | Returning cached data (fast!) | 1-10ms |
| **cache-miss** | Cache miss + full fetch (oEmbed + yt-dlp) | 3000-8000ms |

**Note:** oEmbed and yt-dlp run **in parallel**, so total time = max(oEmbed, yt-dlp)

## Understanding the Response

### Summary Response (`/metrics`)

```json
{
  "time_range_hours": 24,
  "total_operations": 1234,
  "operations": {
    "oEmbed": {
      "count": 456,
      "avg": 350,
      "min": 150,
      "max": 2100,
      "p50": 320,
      "p95": 650,
      "p99": 1200
    },
    "yt-dlp": {
      "count": 456,
      "avg": 2800,
      "min": 800,
      "max": 8500,
      "p50": 2400,
      "p95": 5100,
      "p99": 7200
    },
    "cache-hit": {
      "count": 320,
      "avg": 3,
      "min": 1,
      "max": 15,
      "p50": 2,
      "p95": 8,
      "p99": 12
    },
    "cache-miss": {
      "count": 456,
      "avg": 3200,
      "min": 1200,
      "max": 9000,
      "p50": 2900,
      "p95": 5800,
      "p99": 8100
    }
  },
  "request_flow": {
    "sample_count": 456,
    "avg_parallel_time": 2800,
    "max_parallel_time": 8500,
    "p95_parallel_time": 5100
  },
  "raw_recent": [...]
}
```

### Key Metrics Explained

**For each operation type:**
- **count**: How many times this operation ran
- **avg**: Average duration in milliseconds
- **min/max**: Fastest and slowest runs
- **p50**: Median (50th percentile) - "typical" performance
- **p95**: 95th percentile - "worst case" for most requests
- **p99**: 99th percentile - rare extreme cases

**request_flow (most important):**
- **avg_parallel_time**: Average time for oEmbed + yt-dlp running together
- **p95_parallel_time**: 95% of requests finish within this time
- **max_parallel_time**: Slowest request ever recorded

## Diagnosing the 9-Second Delay

If embeds take 9 seconds to load, check these metrics in order:

### 1. Is it yt-dlp? (Most likely)
```bash
curl http://localhost:3000/metrics | grep -A 8 '"yt-dlp"'
```
If **yt-dlp.p95 or yt-dlp.avg > 5000ms**, yt-dlp extraction is slow.

**Causes:**
- YouTube's servers are slow responding (network latency)
- yt-dlp is spending time probing formats
- Cookies are expired/invalid (requires re-extraction)

**Solutions:**
- Check YouTube cookie freshness
- Try reducing to format `22` or `18` (already optimized)
- Add retry logic for network timeouts

### 2. Is it oEmbed? (Less likely)
```bash
curl http://localhost:3000/metrics | grep -A 8 '"oEmbed"'
```
If **oEmbed.p95 > 2000ms**, YouTube's oEmbed endpoint is slow (rare).

**Solutions:**
- Cache oEmbed results longer
- Fall back to default title if oEmbed times out

### 3. Is the cache working?
```bash
curl http://localhost:3000/metrics | grep -A 3 '"cache-hit"'
```
If **cache-hit.count** is low, cache is not being used effectively.

**Causes:**
- TTL is too short (currently 2 hours)
- Same video not requested twice often

**Solutions:**
- Increase CACHE_TTL in index.js (currently 2 hours)
- Enable Redis if load increases

### 4. Check recent operations
```bash
curl http://localhost:3000/metrics/history?limit=20
```
Look at the **raw_recent** array to see last 20 operations and their timings.

## Tuning for Performance

### Reduce yt-dlp time:

1. **Refresh expired cookies** (requires re-export from browser)
   ```bash
   # Export fresh cookies, update YOUTUBE_COOKIES env var
   ```

2. **Lower quality format** (trades quality for speed)
   ```javascript
   // In index.js, change:
   format: '22',  // Lower quality, faster extraction
   ```

3. **Increase timeout gracefully**
   ```javascript
   // Allow longer timeout but track slow ones
   const result = await executeWithTimeout(
     youtubeDlExec(url, options),
     5000  // Increased from 2000ms
   );
   ```

### Improve cache hit rate:

1. **Increase TTL** (already at 2 hours, good)
   ```javascript
   const CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours
   ```

2. **Pre-populate cache** for popular videos
   ```javascript
   // On startup, warm cache for top videos
   ```

3. **Consider Redis** for distributed caching across instances

## Monitoring Over Time

Track metrics over 1-hour intervals to identify patterns:

```bash
# Every 5 minutes, log metrics to file
while true; do
  echo "=== $(date) ===" >> metrics.log
  curl http://localhost:3000/metrics | jq '.request_flow' >> metrics.log
  sleep 300
done
```

Then analyze:
```bash
# Find slowest request
grep "max_parallel_time" metrics.log | sort -t: -k2 -n | tail -1
```

## Slow Operation Logging

Operations slower than 2 seconds are automatically logged to stdout:

```
[SLOW] yt-dlp: 5234ms { videoId: 'dQw4w9WgXcQ', type: 'video', status: 'success' }
[SLOW] cache-miss: 4567ms { videoId: 'VIDEO_ID' }
```

Monitor these logs in production to catch degradation early.
