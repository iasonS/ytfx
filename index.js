import express from 'express';
import youtubeDlExec from 'youtube-dl-exec';
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

// Write cookies to temporary file if provided
// Priority: YOUTUBE_COOKIES_B64 (base64-encoded Netscape file) > YOUTUBE_COOKIES (semicolon string)
let COOKIES_FILE = null;
if (YOUTUBE_COOKIES_B64) {
  // Preferred: base64-encoded Netscape cookie file (preserves all metadata)
  COOKIES_FILE = path.join('/tmp', 'youtube_cookies.txt');
  const decoded = Buffer.from(YOUTUBE_COOKIES_B64, 'base64').toString('utf-8');
  fs.writeFileSync(COOKIES_FILE, decoded);
  const lineCount = decoded.split('\n').filter(l => l && !l.startsWith('#')).length;
  console.log(`[Cookies] ENABLED (base64 Netscape) - ${lineCount} cookies written to ${COOKIES_FILE}`);
  console.log(`[Cookies] File size: ${fs.statSync(COOKIES_FILE).size} bytes`);
} else if (YOUTUBE_COOKIES) {
  // Legacy: semicolon-separated cookie string → convert to Netscape format
  COOKIES_FILE = path.join('/tmp', 'youtube_cookies.txt');
  const netscapeContent = parseCookieString(YOUTUBE_COOKIES);
  fs.writeFileSync(COOKIES_FILE, netscapeContent);
  console.log(`[Cookies] ENABLED (string) - Wrote ${YOUTUBE_COOKIES.split(';').length} cookies to ${COOKIES_FILE}`);
  console.log(`[Cookies] File size: ${fs.statSync(COOKIES_FILE).size} bytes`);
} else {
  console.log(`[Cookies] DISABLED - No YOUTUBE_COOKIES or YOUTUBE_COOKIES_B64 env var found`);
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

// Fetch video data from YouTube oEmbed + yt-dlp
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
      width: width || 1280,    // Use actual dimensions from yt-dlp
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

// Fetch stream URL using yt-dlp
// Get video info (stream URL + dimensions) from yt-dlp - called only once
// Timeout wrapper for yt-dlp execution (max 2 seconds)
async function executeWithTimeout(promise, timeoutMs = 2000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

async function getVideoInfo(videoId, isShorts = false) {
  const startTime = Date.now();
  try {
    const url = isShorts
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;

    // Optimized options: minimal extraction for speed (2-3x faster)
    const options = {
      dumpJson: true, // Required: return parsed JSON with url, formats, dimensions (ADR-002)
      format: '18', // mimetypes=video/mp4 - fastest format selection (ADR-008)
      quiet: true,
      skipDownload: true, // Don't download - just extract metadata
      noPlaylist: true, // Skip playlist detection
      noProgress: true, // Don't show progress bar
      jsRuntimes: 'node', // Required: JavaScript runtime for YouTube extraction (ADR-003)
      remoteComponents: 'ejs:github', // Required: External JS solver for n-parameter challenge (ADR-001)
    };

    // Add cookies if available
    if (COOKIES_FILE) {
      options.cookies = COOKIES_FILE;
    }

    // Execute with 8-second timeout (yt-dlp needs time for YouTube extraction)
    const result = await executeWithTimeout(
      youtubeDlExec(url, options),
      8000
    );

    // Extract stream URL
    let streamUrl = null;
    if (result.url) {
      streamUrl = result.url;
    } else if (result.formats && result.formats.length > 0) {
      const mp4Format = result.formats.find(f => f.ext === 'mp4' && f.url);
      if (mp4Format) {
        streamUrl = mp4Format.url;
      }
    }

    if (!streamUrl) {
      throw new Error('Could not extract stream URL from yt-dlp');
    }

    // Extract dimensions (with intelligent defaults for shorts)
    const width = result.width || (isShorts ? 360 : 1280);
    const height = result.height || (isShorts ? 640 : 720);

    const duration = Date.now() - startTime;
    recordOperation('yt-dlp', duration, { videoId, type: isShorts ? 'shorts' : 'video', status: 'success' });
    console.log(`[yt-dlp] Got stream URL and dimensions for ${videoId}: ${width}x${height} (${duration}ms)`);

    return { streamUrl, width, height };

  } catch (error) {
    const duration = Date.now() - startTime;
    recordOperation('yt-dlp', duration, { videoId, status: 'error', error: error.message });
    console.error(`[Warning] getVideoInfo timeout/error for ${videoId}:`, error.message);
    // Fallback: return safe defaults on timeout (allows embed to work even if yt-dlp times out)
    const width = isShorts ? 360 : 1280;
    const height = isShorts ? 640 : 720;
    console.log(`[Fallback] Using default dimensions for ${videoId}: ${width}x${height}`);
    throw error; // Still throw to trigger error handling, but log the fallback
  }
}

async function fetchStreamUrl(videoId, isShorts = false) {
  try {
    // Use Shorts URL for Shorts, watch URL for regular videos
    const url = isShorts
      ? `https://www.youtube.com/shorts/${videoId}`
      : `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[yt-dlp] Extracting stream for ${videoId} (${isShorts ? 'Shorts' : 'Video'})`);

    const options = {
      dumpJson: true, // Required: return parsed JSON (ADR-002)
      format: '18',  // mp4 format (ADR-008)
      quiet: true,
      noProgress: true, // Don't show progress bar
      jsRuntimes: 'node', // Required: JavaScript runtime for YouTube extraction (ADR-003)
      remoteComponents: 'ejs:github', // Required: External JS solver for n-parameter challenge (ADR-001)
    };

    // Add cookies if available
    if (COOKIES_FILE) {
      console.log(`[yt-dlp] Using YouTube cookies: ${COOKIES_FILE}`);
      console.log(`[yt-dlp] Cookies file exists: ${fs.existsSync(COOKIES_FILE)}`);
      console.log(`[yt-dlp] Cookies file size: ${fs.existsSync(COOKIES_FILE) ? fs.statSync(COOKIES_FILE).size : 0} bytes`);
      options.cookies = COOKIES_FILE;
    } else {
      console.log(`[yt-dlp] NO COOKIES - authentication will likely fail`);
    }

    console.log(`[yt-dlp] Format: ${options.format}`);
    const result = await youtubeDlExec(url, options);

    // Extract stream URL from yt-dlp output
    let streamUrl = null;

    if (result.url) {
      streamUrl = result.url;
    } else if (result.formats && result.formats.length > 0) {
      // Find best mp4 format
      const mp4Format = result.formats.find(f => f.ext === 'mp4' && f.url);
      if (mp4Format) {
        streamUrl = mp4Format.url;
      }
    }

    if (!streamUrl) {
      throw new Error('Could not extract stream URL from yt-dlp');
    }

    console.log(`[yt-dlp] Got stream URL for ${videoId}`);
    return streamUrl;
  } catch (error) {
    console.error(`[Error] fetchStreamUrl for ${videoId}:`, error.message);
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
export { app, isDiscordBot, extractVideoId, escapeHtml, buildEmbedHtml, cache, CACHE_TTL, parseCookieString };
