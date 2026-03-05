import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// Use vi.hoisted() so mockGetBasicInfo is available in the hoisted vi.mock factory
const { mockGetBasicInfo } = vi.hoisted(() => ({
  mockGetBasicInfo: vi.fn(),
}));

// Mock youtubei.js
vi.mock('youtubei.js', () => ({
  Innertube: {
    create: vi.fn().mockResolvedValue({
      getBasicInfo: mockGetBasicInfo,
      session: { player: {} },
    }),
  },
}));

// Mock global fetch
global.fetch = vi.fn();

import { app, cache } from '../index.js';

function mockInnertubeResponse(url, width = 640, height = 360) {
  mockGetBasicInfo.mockResolvedValueOnce({
    streaming_data: {
      formats: [{ itag: 18, url, width, height, mime_type: 'video/mp4' }],
    },
  });
}

describe('Mocked Tests - Full Embed Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cache.clear();
  });

  it('should successfully embed video for Discord bot with InnerTube mocked', async () => {
    mockInnertubeResponse('https://example.com/video.mp4');

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
    mockInnertubeResponse('https://example.com/video.mp4');

    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Cached Video' }),
    });

    // First request
    const res1 = await request(app)
      .get('/watch?v=abc123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res1.status).toBe(200);
    expect(mockGetBasicInfo).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    // Second request should use cache
    const res2 = await request(app)
      .get('/watch?v=abc123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res2.status).toBe(200);
    expect(res2.text).toContain('Cached Video');
    // InnerTube and fetch should still be called only once total (from first request)
    expect(mockGetBasicInfo).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('should return 500 when InnerTube fails', async () => {
    mockGetBasicInfo.mockRejectedValueOnce(new Error('InnerTube error'));

    const res = await request(app)
      .get('/watch?v=badVideoId')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(500);
    expect(res.body.error).toContain('Failed to fetch');
  });

  it('should handle oEmbed failure gracefully', async () => {
    mockInnertubeResponse('https://example.com/video.mp4');

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
    mockInnertubeResponse('https://example.com/shorts.mp4', 360, 640);

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
    mockInnertubeResponse('https://example.com/watch.mp4');
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
    mockInnertubeResponse('https://example.com/shorts.mp4', 360, 640);
    global.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ title: 'Shorts Video' }),
    });

    // Request shorts with same ID should fetch fresh (different cache key)
    const res2 = await request(app)
      .get('/shorts/same123')
      .set('User-Agent', 'Discordbot/2.0');
    expect(res2.text).toContain('Shorts Video');

    // Both InnerTube calls should have been made
    expect(mockGetBasicInfo).toHaveBeenCalledTimes(2);
  });
});
