import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app, cache } from '../index.js';

// Mock youtube-dl-exec
vi.mock('youtube-dl-exec', () => ({
  default: vi.fn(),
}));

// Mock global fetch
global.fetch = vi.fn();

import youtubeDlExec from 'youtube-dl-exec';

describe('Mocked Tests - Full Embed Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('should successfully embed video for Discord bot with yt-dlp mocked', async () => {
    // Mock yt-dlp response
    youtubeDlExec.mockResolvedValueOnce({
      url: 'https://example.com/video.mp4',
      formats: [],
    });

    // Mock oEmbed response
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Test Video Title' }),
    });

    const res = await request(app)
      .get('/watch?v=dQw4w9WgXcQ')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.type).toContain('text/html');
    expect(res.text).toContain('og:video:url');
    expect(res.text).toContain('https://example.com/video.mp4');
    expect(res.text).toContain('Test Video Title');
  });

  it('should cache video data after first fetch', async () => {
    youtubeDlExec.mockResolvedValueOnce({
      url: 'https://example.com/video.mp4',
      formats: [],
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Cached Video' }),
    });

    // First request
    const res1 = await request(app)
      .get('/watch?v=abc123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res1.status).toBe(200);
    expect(youtubeDlExec).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second request should use cache
    const res2 = await request(app)
      .get('/watch?v=abc123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res2.status).toBe(200);
    expect(res2.text).toContain('Cached Video');
    // yt-dlp and fetch should still be called only once total (from first request)
    expect(youtubeDlExec).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should return 500 when yt-dlp fails', async () => {
    youtubeDlExec.mockRejectedValueOnce(new Error('yt-dlp error'));

    const res = await request(app)
      .get('/watch?v=badVideoId')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to fetch');
  });

  it('should handle oEmbed failure gracefully', async () => {
    youtubeDlExec.mockResolvedValueOnce({
      url: 'https://example.com/video.mp4',
      formats: [],
    });

    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const res = await request(app)
      .get('/watch?v=xyz789')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('og:video:url');
    expect(res.text).toContain('YouTube Video'); // Fallback title
  });

  it('should embed Shorts correctly', async () => {
    youtubeDlExec.mockResolvedValueOnce({
      url: 'https://example.com/shorts.mp4',
      formats: [],
    });

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Short Video' }),
    });

    const res = await request(app)
      .get('/shorts/shortId123')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('og:video:url');
    expect(res.text).toContain('Short Video');
  });

  it('should use different cache keys for watch vs shorts', async () => {
    // Mock responses
    youtubeDlExec.mockResolvedValueOnce({
      url: 'https://example.com/watch.mp4',
      formats: [],
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Watch Video' }),
    });

    // Request watch
    const res1 = await request(app)
      .get('/watch?v=same123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res1.text).toContain('Watch Video');

    // Mock second set of responses
    youtubeDlExec.mockResolvedValueOnce({
      url: 'https://example.com/shorts.mp4',
      formats: [],
    });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Shorts Video' }),
    });

    // Request shorts with same ID should fetch fresh (different cache key)
    const res2 = await request(app)
      .get('/shorts/same123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res2.text).toContain('Shorts Video');

    // Both yt-dlp calls should have been made
    expect(youtubeDlExec).toHaveBeenCalledTimes(2);
  });
});
