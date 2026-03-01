import express from 'express';
import ytdl from 'ytdl-core';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// In-memory cache for video data with TTL
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

// Start cleanup interval
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > CACHE_TTL) {
      cache.delete(key);
    }
  }
  console.log(`[Cache] Cleaned up expired entries. Current size: ${cache.size}`);
}, CLEANUP_INTERVAL);

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

  // Validate: alphanumeric + dash + underscore only
  if (!videoId || !/^[a-zA-Z0-9_-]+$/.test(videoId)) {
    return null;
  }

  return videoId;
}

// Fetch video data from YouTube oEmbed + ytdl-core
async function fetchVideoData(videoId) {
  try {
    // Parallel: oEmbed + ytdl-core extraction
    const [oembedData, streamUrl] = await Promise.all([
      fetchOEmbed(videoId),
      fetchStreamUrl(videoId),
    ]);

    if (!streamUrl) {
      throw new Error('Could not extract stream URL');
    }

    // Determine thumbnail
    let thumbnail = `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`;

    return {
      title: oembedData.title || 'YouTube Video',
      thumbnail,
      streamUrl,
      width: 1280,
      height: 720,
    };
  } catch (error) {
    console.error(`[Error] fetchVideoData for ${videoId}:`, error.message);
    throw error;
  }
}

// Fetch oEmbed metadata from YouTube
async function fetchOEmbed(videoId) {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`oEmbed HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Error] fetchOEmbed for ${videoId}:`, error.message);
    // Return minimal fallback data
    return { title: 'YouTube Video' };
  }
}

// Fetch stream URL from ytdl-core
async function fetchStreamUrl(videoId) {
  try {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`[ytdl-core] Fetching ${url}`);

    const info = await ytdl.getInfo(url);
    const formats = ytdl.filterFormats(info.formats, { quality: '18' }); // 720p

    if (!formats || formats.length === 0) {
      throw new Error('No suitable format found');
    }

    const format = formats[0];
    console.log(`[ytdl-core] Got format: ${format.qualityLabel || format.quality}`);

    return format.url;
  } catch (error) {
    console.error(`[Error] fetchStreamUrl for ${videoId}:`, error.message);
    throw error;
  }
}

// Get cached data or fetch fresh
async function getCachedOrFetch(videoId) {
  if (cache.has(videoId)) {
    const cached = cache.get(videoId);
    if (Date.now() - cached.timestamp < CACHE_TTL) {
      console.log(`[Cache] Hit for ${videoId}`);
      return cached.data;
    }
    cache.delete(videoId);
  }

  console.log(`[Cache] Miss for ${videoId}, fetching...`);
  const data = await fetchVideoData(videoId);
  cache.set(videoId, { data, timestamp: Date.now() });
  return data;
}

// Build HTML embed response
function buildEmbedHtml(data, videoId) {
  const { title, thumbnail, streamUrl } = data;
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>

  <!-- OpenGraph (required) -->
  <meta property="og:type" content="video.other">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:image" content="${escapeHtml(thumbnail)}">
  <meta property="og:video:url" content="${escapeHtml(streamUrl)}">
  <meta property="og:video:secure_url" content="${escapeHtml(streamUrl)}">
  <meta property="og:video:type" content="video/mp4">
  <meta property="og:video:width" content="1280">
  <meta property="og:video:height" content="720">

  <!-- Twitter Card (also required for Discord) -->
  <meta name="twitter:card" content="player">
  <meta name="twitter:player:stream" content="${escapeHtml(streamUrl)}">
  <meta name="twitter:player:stream:content_type" content="video/mp4">
  <meta name="twitter:player:width" content="1280">
  <meta name="twitter:player:height" content="720">
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
  res.json({ status: 'ok' });
});

// Watch handler (standard YouTube URLs)
app.get('/watch', async (req, res) => {
  const videoId = extractVideoId(req, 'watch');

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

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
app.get('/shorts/:id', async (req, res) => {
  const videoId = extractVideoId(req, 'shorts');

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

  if (isDiscordBot(req)) {
    try {
      const data = await getCachedOrFetch(videoId);
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

// Short-form catch-all handler (youtu.be style URLs) - MUST BE LAST
app.get('/:id', async (req, res) => {
  const videoId = extractVideoId(req, 'short-form');

  if (!videoId) {
    return res.status(400).json({ error: 'Invalid video ID' });
  }

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

// Start server
app.listen(PORT, () => {
  console.log(`[Server] ytfx listening on http://localhost:${PORT}`);
});
