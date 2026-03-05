import express from 'express';
import { Innertube } from 'youtubei.js';
import fs from 'fs';
import path from 'path';
import rateLimit from 'express-rate-limit';
import { initDb, logRequest, getStats } from './db.js';
import { CUTE_EMOTICONS } from './emoticons.js';
import { recordOperation, getMetricsSummary, getOperationHistory } from './metrics.js';
import { execSync } from 'child_process';

// Load .env file for local development
if (process.env.NODE_ENV !== 'production' && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf-8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && !key.startsWith('#') && key.trim()) {
      process.env[key.trim()] = valueParts.join('=').trim();
    }
  });
}

const app = express();

// Get current git commit hash for version tracking
let COMMIT_HASH = 'unknown';
try {
  COMMIT_HASH = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
} catch (error) {
  try {
    // Fallback: read from .git/HEAD if git command fails
    const gitDir = path.join(process.cwd(), '.git');
    if (fs.existsSync(gitDir)) {
      const headContent = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf-8').trim();
      if (headContent.startsWith('ref:')) {
        const refPath = headContent.split(' ')[1];
        COMMIT_HASH = fs.readFileSync(path.join(gitDir, refPath), 'utf-8').trim().slice(0, 7);
      }
    }
  } catch (e) {
    console.log('[Warning] Could not determine git commit hash');
  }
}
console.log(`[Server] ytfx commit: ${COMMIT_HASH}`);

// Trust proxy for accurate IP detection behind reverse proxy (Render, Caddy, etc.)
app.set('trust proxy', 1);

// Serve static files from public directory
app.use(express.static('public'));

// Get credentials from env vars
const YOUTUBE_COOKIES = process.env.YOUTUBE_COOKIES;
const YOUTUBE_COOKIES_B64 = process.env.YOUTUBE_COOKIES_B64;
const PORT = process.env.PORT || 3000;

// Parse cookies into a header string for youtubei.js
// Priority: YOUTUBE_COOKIES_B64 (base64-encoded Netscape file) > YOUTUBE_COOKIES (semicolon string)
let COOKIE_STRING = null;
if (YOUTUBE_COOKIES_B64) {
  // Preferred: base64-encoded Netscape cookie file → extract name=value pairs
  const decoded = Buffer.from(YOUTUBE_COOKIES_B64, 'base64').toString('utf-8');
  const pairs = decoded.split('\n')
    .filter(l => l && !l.startsWith('#'))
    .map(l => {
      const fields = l.split('\t');
      if (fields.length >= 7) return `${fields[5]}=${fields[6]}`;
      return null;
    })
    .filter(Boolean);
  COOKIE_STRING = pairs.join('; ');
  console.log(`[Cookies] ENABLED (base64 Netscape) - ${pairs.length} cookies parsed for InnerTube`);
} else if (YOUTUBE_COOKIES) {
  // Legacy: already semicolon-separated — use directly
  COOKIE_STRING = YOUTUBE_COOKIES;
  console.log(`[Cookies] ENABLED (string) - ${YOUTUBE_COOKIES.split(';').length} cookies for InnerTube`);
} else {
  console.log(`[Cookies] DISABLED - No YOUTUBE_COOKIES or YOUTUBE_COOKIES_B64 env var found`);
}

// Lazy-initialized Innertube singleton
let innertubeInstance = null;
async function getInnertube() {
  if (!innertubeInstance) {
    const options = {};
    if (COOKIE_STRING) {
      options.cookie = COOKIE_STRING;
    }
    innertubeInstance = await Innertube.create(options);
    console.log(`[InnerTube] Client initialized${COOKIE_STRING ? ' (with cookies)' : ''}`);
  }
  return innertubeInstance;
}

// Reset Innertube instance on errors (auto-recovery)
function resetInnertube() {
  innertubeInstance = null;
  console.log('[InnerTube] Instance reset for recovery');
}

// In-memory cache for video data with TTL
const cache = new Map();
const CACHE_TTL = 2 * 60 * 60 * 1000; // 2 hours (increased from 30 min for performance)
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Rate limiter: 60 requests/minute per IP
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per windowMs
  handler: (req, res) => res.status(429).json({ error: 'Rate limit exceeded. Max 60 requests/minute.' }),
  skip: (req) => {
    // Skip rate limiting for health and stats endpoints
    return req.path === '/health' || req.path === '/stats';
  },
  // Use X-Forwarded-For for accurate IP detection behind proxy
  keyGenerator: (req) => {
    return req.ip; // Express will use X-Forwarded-For since trust proxy is set
  },
});

// Analytics middleware
function analyticsMiddleware(req, res, next) {
  const startTime = Date.now();

  // Capture original send
  const originalSend = res.send;
  res.send = function(data) {
    const responseMs = Date.now() - startTime;
    const videoId = req.videoId || null;
    const type = req.routeType || null;
    const success = res.statusCode >= 200 && res.statusCode < 400 ? 1 : 0;

    logRequest(req, videoId, type, success, responseMs);

    originalSend.call(this, data);
  };

  next();
}

// Check if request is from Discord bot
function isDiscordBot(req) {
  const userAgent = req.get('user-agent') || '';
  return userAgent.toLowerCase().includes('discordbot');
}

// Extract video ID from various YouTube URL formats
function extractVideoId(req, type) {
  let videoId;

  if (type === 'watch') {
    videoId = req.query.v;
  } else if (type === 'shorts') {
    videoId = req.params.id;
  } else if (type === 'short-form') {
    videoId = req.params.id;
  }

  // Strip query parameters if accidentally included (e.g., ?si=...)
  if (videoId && videoId.includes('?')) {
    videoId = videoId.split('?')[0];
  }

  // Validate: alphanumeric + dash + underscore only
  if (!videoId || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return null;
  }

  return videoId;
}

// Fetch video data from YouTube oEmbed + InnerTube
async function fetchVideoData(videoId, isShorts = false) {
  try {
    // Parallel: oEmbed + yt-dlp extraction
    const [oembedData, result] = await Promise.all([
      fetchOEmbed(videoId),
      getVideoInfo(videoId, isShorts),
    ]);

    const { streamUrl, width, height } = result;

    if (!streamUrl) {
      throw new Error('Could not extract stream URL');
    }

    // Use high quality 16:9 thumbnail (guaranteed aspect ratio for Discord)
    // maxresdefault may not exist, fall back to hq720 (1280x720)
    let thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    return {
      title: oembedData.title || 'YouTube Video',
      thumbnail,
      streamUrl,
      width: width || 1280,    // Use actual dimensions from InnerTube
      height: height || 720,   // Falls back to 16:9 if unavailable
      isShorts,
    };
  } catch (error) {
    console.error(`[Error] fetchVideoData for ${videoId}:`, error.message);
    throw error;
  }
}

// Fetch oEmbed metadata from YouTube
async function fetchOEmbed(videoId) {
  const startTime = Date.now();
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`oEmbed HTTP ${response.status}`);
    }

    const data = await response.json();
    const duration = Date.now() - startTime;
    recordOperation('oEmbed', duration, { videoId, status: 'success' });
    return data;
  } catch (error) {
    const duration = Date.now() - startTime;
    recordOperation('oEmbed', duration, { videoId, status: 'error', error: error.message });
    console.error(`[Error] fetchOEmbed for ${videoId}:`, error.message);
    // Return minimal fallback data
    return { title: 'YouTube Video' };
  }
}

// Timeout wrapper for InnerTube requests (ADR-004: reduced from 30s to 15s — no EJS cold start)
async function executeWithTimeout(promise, timeoutMs = 15000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

// Get video info (stream URL + dimensions) from InnerTube API
async function getVideoInfo(videoId, isShorts = false) {
  const startTime = Date.now();
  try {
    const yt = await getInnertube();
    const info = await executeWithTimeout(yt.getBasicInfo(videoId), 15000);

    if (!info.streaming_data) {
      throw new Error('No streaming data available');
    }

    // Find itag 18 (360p pre-muxed MP4) — matches ADR-008
    const formats = info.streaming_data.formats || [];
    let format = formats.find(f => f.itag === 18);

    // Fallback: any pre-muxed MP4 format
    if (!format) {
      format = formats.find(f => f.mime_type?.startsWith('video/mp4'));
    }

    if (!format) {
      throw new Error('No suitable MP4 format found');
    }

    // Get stream URL — use direct URL if available, otherwise decipher
    let streamUrl = format.url;
    if (!streamUrl && format.decipher) {
      streamUrl = await format.decipher(yt.session.player);
    }

    if (!streamUrl) {
      throw new Error('Could not extract stream URL from InnerTube');
    }

    // Extract dimensions (with intelligent defaults for shorts)
    const width = format.width || (isShorts ? 360 : 640);
    const height = format.height || (isShorts ? 640 : 360);

    const duration = Date.now() - startTime;
    recordOperation('innertube', duration, { videoId, type: isShorts ? 'shorts' : 'video', status: 'success' });
    console.log(`[InnerTube] Got stream URL for ${videoId}: ${width}x${height} (${duration}ms)`);

    return { streamUrl, width, height };

  } catch (error) {
    const duration = Date.now() - startTime;
    recordOperation('innertube', duration, { videoId, status: 'error', error: error.message });
    console.error(`[InnerTube] FAILED for ${videoId} (${duration}ms):`, error.message);

    // Reset instance on session/player errors for auto-recovery
    if (error.message?.includes('session') || error.message?.includes('player')) {
      resetInnertube();
    }

    throw error;
  }
}

// Get cached data or fetch fresh
async function getCachedOrFetch(videoId, isShorts = false) {
  const startTime = Date.now();
  const cacheKey = isShorts ? `${videoId}-shorts` : videoId;
  if (cache.has(cacheKey)) {
    const cached = cache.get(cacheKey);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      const duration = Date.now() - startTime;
      recordOperation('cache-hit', duration, { videoId });
      console.log(`[Cache] Hit for ${videoId} (${duration}ms)`);
      return cached.data;
    }
    cache.delete(cacheKey);
  }

  console.log(`[Cache] Miss for ${videoId}, fetching...`);
  const data = await fetchVideoData(videoId, isShorts);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  const totalDuration = Date.now() - startTime;
  recordOperation('cache-miss', totalDuration, { videoId });
  return data;
}

// Build HTML embed response
function buildEmbedHtml(data, videoId) {
  const { title, thumbnail, streamUrl, width, height, isShorts } = data;
  const youtubeUrl = `https://www.youtube.com/${isShorts ? 'shorts/' : 'watch?v='}${videoId}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escapeHtml(title)}</title>

  <!-- OpenGraph (Discord native embed support) -->
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="Watch on YouTube">
  <meta property="og:url" content="${youtubeUrl}">
  <meta property="og:site_name" content="YouTube">

  <!-- Image (thumbnail) - actual aspect ratio -->
  <meta property="og:image" content="${escapeHtml(thumbnail)}">
  <meta property="og:image:width" content="${width}">
  <meta property="og:image:height" content="${height}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:alt" content="${escapeHtml(title)}">

  <!-- Video metadata - matching actual dimensions -->
  <meta property="og:video" content="${escapeHtml(streamUrl)}">
  <meta property="og:video:url" content="${escapeHtml(streamUrl)}">
  <meta property="og:video:secure_url" content="${escapeHtml(streamUrl)}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="${width}">
  <meta property="og:video:height" content="${height}">
  <meta property="og:video:tag" content="video">

  <!-- Twitter Card (Discord uses Twitter card metadata as fallback) -->
  <meta name="twitter:card" content="player">
  <meta name="twitter:site" content="@YouTube">
  <meta name="twitter:title" content="${escapeHtml(title)}">
  <meta name="twitter:description" content="Watch on YouTube">
  <meta name="twitter:player" content="${youtubeUrl}">
  <meta name="twitter:player:stream" content="${escapeHtml(streamUrl)}">
  <meta name="twitter:player:stream:content_type" content="video/mp4">
  <meta name="twitter:player:width" content="${width}">
  <meta name="twitter:player:height" content="${height}">
  <meta name="twitter:image" content="${escapeHtml(thumbnail)}">
  <meta name="twitter:image:alt" content="${escapeHtml(title)}">
</head>
<body>
  <p>Redirecting to YouTube...</p>
  <script>
    window.location.replace('${youtubeUrl}');
  </script>
</body>
</html>`;
}

// HTML escape helper
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (m) => map[m]);
}

// Health check endpoint
app.get('/health', (req, res) => {
  const uptime = process.uptime();
  const cacheSize = cache.size;

  res.json({
    status: 'ok',
    version: COMMIT_HASH,
    uptime: Math.floor(uptime),
    cache: { size: cacheSize, ttl_ms: CACHE_TTL },
    timestamp: new Date().toISOString(),
  });
});

// URL converter endpoint - accepts full YouTube URL and redirects to proxy
app.get('/go', limiter, analyticsMiddleware, (req, res) => {
  const youtubeUrl = req.query.url;

  if (!youtubeUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  // Extract video ID from various YouTube formats
  let videoId = null;
  let proxyPath = null;
  let type = null;

  // Match YouTube Shorts
  if (youtubeUrl.includes('youtube.com/shorts/')) {
    const match = youtubeUrl.match(/shorts\/([a-zA-Z0-9_-]+)/);
    if (match) {
      videoId = match[1];
      proxyPath = `/shorts/${videoId}`;
      type = 'shorts';
    }
  }
  // Match standard YouTube watch URL
  else if (youtubeUrl.includes('youtube.com/watch?v=') || youtubeUrl.includes('www.youtube.com/watch?v=')) {
    const match = youtubeUrl.match(/v=([a-zA-Z0-9_-]+)/);
    if (match) {
      videoId = match[1];
      proxyPath = `/watch?v=${videoId}`;
      type = 'watch';
    }
  }
  // Match youtu.be short URL
  else if (youtubeUrl.includes('youtu.be/')) {
    const match = youtubeUrl.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (match) {
      videoId = match[1];
      proxyPath = `/${videoId}`;
      type = 'short-form';
    }
  }

  if (!videoId || !proxyPath) {
    return res.status(400).json({ error: 'Could not extract video ID from URL' });
  }

  // Set for analytics
  req.videoId = videoId;
  req.routeType = type;

  console.log(`[go] Redirecting ${youtubeUrl} → ${proxyPath}`);
  res.redirect(302, proxyPath);
});

// Watch handler (standard YouTube URLs)
app.get('/watch', limiter, analyticsMiddleware, async (req, res) => {
  const videoId = extractVideoId(req, 'watch');

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  // Set for analytics
  req.videoId = videoId;
  req.routeType = 'watch';

  if (isDiscordBot(req)) {
    try {
      const data = await getCachedOrFetch(videoId);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildEmbedHtml(data, videoId));
    } catch (error) {
      console.error(`[Error] /watch handler:`, error.message);
      res.status(500).json({ error: 'Failed to fetch video data' });
    }
  } else {
    res.redirect(302, `https://www.youtube.com/watch?v=${videoId}`);
  }
});

// Shorts handler
app.get('/shorts/:id', limiter, analyticsMiddleware, async (req, res) => {
  const videoId = extractVideoId(req, 'shorts');

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  // Set for analytics
  req.videoId = videoId;
  req.routeType = 'shorts';

  if (isDiscordBot(req)) {
    try {
      const data = await getCachedOrFetch(videoId, true);  // isShorts = true
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildEmbedHtml(data, videoId));
    } catch (error) {
      console.error(`[Error] /shorts handler:`, error.message);
      res.status(500).json({ error: 'Failed to fetch video data' });
    }
  } else {
    res.redirect(302, `https://www.youtube.com/shorts/${videoId}`);
  }
});

// Root easter egg - rotating emoticons for human browsers
app.get('/', (req, res) => {
  const userAgent = req.get('user-agent') || '';
  const isBot = userAgent.toLowerCase().includes('bot');
  const protocol = req.protocol || 'https';
  const host = req.get('host') || 'localhost:3000';
  const baseUrl = `${protocol}://${host}`;

  const facesJson = JSON.stringify(CUTE_EMOTICONS);
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ytfx - Cute Emoticons</title>

  <!-- Discord Embed Metadata -->
  <meta property="og:type" content="website">
  <meta property="og:title" content="ytfx">
  <meta property="og:description" content="You should not be here.">
  <meta property="og:image" content="${baseUrl}/emoticons.gif">
  <meta property="og:image:width" content="480">
  <meta property="og:image:height" content="240">
  <meta property="og:image:type" content="image/gif">
  <meta property="og:url" content="${baseUrl}/">

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="ytfx">
  <meta name="twitter:description" content="You should not be here.">
  <meta name="twitter:image" content="${baseUrl}/emoticons.gif">

  <style>
    body { background: #0d0d0d; color: #00ff41; font-family: 'Courier New', monospace; margin: 0; padding: 20px; }
    pre { white-space: pre-wrap; word-wrap: break-word; }
    .face { min-height: 1.5em; }
  </style>
</head>
<body>
  <pre><div class="face" id="face"></div>
  You should not be here.</pre>
  <script>
    const faces = ${facesJson};
    let currentIndex = 0;

    function updateFace() {
      document.getElementById('face').textContent = faces[currentIndex];
      currentIndex = (currentIndex + 1) % faces.length;
    }

    updateFace();
    setInterval(updateFace, 500);
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Performance metrics endpoint - no auth required (internal diagnostics)
app.get('/metrics', (req, res) => {
  const hours = parseInt(req.query.hours || '24', 10);
  const metrics = getMetricsSummary(hours);
  res.json(metrics);
});

// Detailed operation history endpoint - for debugging
app.get('/metrics/history', (req, res) => {
  const operation = req.query.operation || null;
  const limit = parseInt(req.query.limit || '100', 10);
  const history = getOperationHistory(operation, Math.min(limit, 500)); // Max 500 records
  res.json({
    filter: operation || 'all',
    records: history.length,
    data: history,
  });
});

// Stats endpoint - requires STATS_TOKEN
app.get('/stats', (req, res) => {
  const STATS_TOKEN = process.env.STATS_TOKEN;

  if (!STATS_TOKEN) {
    return res.status(500).json({ error: 'Stats token not configured' });
  }

  // Get token from query or Authorization header
  const queryToken = req.query.token;
  const authToken = req.get('authorization')?.replace('Bearer ', '');
  const providedToken = queryToken || authToken;

  if (!providedToken || providedToken !== STATS_TOKEN) {
    return res.status(401).json({ error: 'Invalid or missing stats token' });
  }

  const stats = getStats();
  if (!stats) {
    return res.status(500).json({ error: 'Failed to fetch statistics' });
  }

  res.json(stats);
});

// Short-form catch-all handler (youtu.be style URLs) - MUST BE LAST
app.get('/:id', limiter, analyticsMiddleware, async (req, res) => {
  const videoId = extractVideoId(req, 'short-form');

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  // Set for analytics
  req.videoId = videoId;
  req.routeType = 'short-form';

  if (isDiscordBot(req)) {
    try {
      const data = await getCachedOrFetch(videoId);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(buildEmbedHtml(data, videoId));
    } catch (error) {
      console.error(`[Error] /:id handler:`, error.message);
      res.status(500).json({ error: 'Failed to fetch video data' });
    }
  } else {
    res.redirect(302, `https://www.youtube.com/watch?v=${videoId}`);
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server and cleanup only if this is the entry point
if (process.argv[1] === new URL(import.meta.url).pathname) {
  (async () => {
    // Initialize database
    await initDb();

    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of cache.entries()) {
        if (now - value.timestamp > CACHE_TTL) {
          cache.delete(key);
        }
      }
      console.log(`[Cache] Cleaned up expired entries. Current size: ${cache.size}`);
    }, CLEANUP_INTERVAL);

    app.listen(PORT, () => {
      console.log(`[Server] ytfx listening on http://localhost:${PORT}`);
    });
  })();
}

// Parse semicolon-separated cookie string to Netscape format (exported for testing)
function parseCookieString(cookieStr) {
  const cookieHeader = `# Netscape HTTP Cookie File\n# This is a generated file!  Do not edit.\n\n`;
  const cookieLines = cookieStr.split(';')
    .map(c => c.trim())
    .filter(c => c)
    .map(c => {
      const eqIndex = c.indexOf('=');
      if (eqIndex === -1) return null;
      const name = c.substring(0, eqIndex).trim();
      const value = c.substring(eqIndex + 1);
      const isSecure = name.startsWith('__Secure-') || ['YSC', 'SSID', 'SAPISID', 'PREF', 'SOCS', 'VISITOR_PRIVACY_METADATA', 'VISITOR_INFO1_LIVE', 'LOGIN_INFO'].includes(name);
      return `.youtube.com\tTRUE\t/\t${isSecure ? 'TRUE' : 'FALSE'}\t0\t${name}\t${value}`;
    })
    .filter(Boolean)
    .join('\n');
  return cookieHeader + cookieLines;
}

// Export functions for testing
export { app, isDiscordBot, extractVideoId, escapeHtml, buildEmbedHtml, cache, CACHE_TTL, parseCookieString, getInnertube, resetInnertube };
