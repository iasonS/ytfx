import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

// Mock youtubei.js
vi.mock('youtubei.js', () => ({
  Innertube: {
    create: vi.fn().mockResolvedValue({
      getBasicInfo: vi.fn().mockResolvedValue({
        streaming_data: {
          formats: [{ itag: 18, url: 'https://example.com/video.mp4', width: 360, height: 640, mime_type: 'video/mp4' }],
        },
      }),
      session: { player: {} },
    }),
  },
}));

// Mock fetch for oEmbed
global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({
    title: 'Test Video Title',
    thumbnail_url: 'https://example.com/thumb.jpg',
  }),
});

import { app } from '../index.js';

describe('Shorts URL Query Parameters', () => {
  describe('URL variants', () => {
    it('should work with clean shorts URL: /shorts/ID', async () => {
      const res = await request(app)
        .get('/shorts/abc123xyz')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      expect(res.text).toContain('og:type');
      expect(res.text).toContain('video.other');
    });

    it('should work with si parameter: /shorts/ID?si=VALUE', async () => {
      const res = await request(app)
        .get('/shorts/abc123xyz?si=5-totzqShpid4D8g')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      expect(res.text).toContain('og:type');
      expect(res.text).toContain('video.other');
    });

    it('should work with multiple query params', async () => {
      const res = await request(app)
        .get('/shorts/abc123xyz?si=VALUE&other=param')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      expect(res.text).toContain('og:type');
    });

    it('should use same video ID regardless of query params', async () => {
      const res1 = await request(app)
        .get('/shorts/testID123')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      const res2 = await request(app)
        .get('/shorts/testID123?si=anything')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      // Both should return 200
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);

      // Both should have same video ID in URL
      expect(res1.text).toContain('testID123');
      expect(res2.text).toContain('testID123');
    });

    it('should extract correct video ID with query params', async () => {
      const res = await request(app)
        .get('/shorts/X9rzB-HGWE4?si=5-totzqShpid4D8g')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      // Verify the ID is in the YouTube URL
      expect(res.text).toContain('X9rzB-HGWE4');
    });

    it('should reject invalid IDs even with query params', async () => {
      const res = await request(app)
        .get('/shorts/invalid<script>?si=value')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(400);
    });
  });

  describe('Query parameter handling', () => {
    it('should ignore si parameter when extracting video ID', async () => {
      // This tests that the video ID extraction works correctly
      // even when si parameter is present
      const res = await request(app)
        .get('/shorts/abc123?si=ignored')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      // The returned HTML should reference the correct video ID
      expect(res.text).toContain('abc123');
      expect(res.text).not.toContain('si=');
    });

    it('should handle encoded query parameters', async () => {
      const res = await request(app)
        .get('/shorts/abc123?si=5-totzqShpid4D8g&utm_source=share')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      expect(res.text).toContain('abc123');
    });

    it('should not include query params in og:title or og:description', async () => {
      const res = await request(app)
        .get('/shorts/abc123?si=value')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      // og:title should not contain the query string
      expect(res.text).not.toMatch(/og:title.*\?/);
    });

    it('should have correct og:url format for shorts', async () => {
      const res = await request(app)
        .get('/shorts/X9rzB-HGWE4?si=value')
        .set('User-Agent', 'Mozilla/5.0 (compatible; Discordbot/2.0)');

      expect(res.status).toBe(200);
      // og:url should have correct format: https://www.youtube.com/shorts/ID
      expect(res.text).toContain('og:url" content="https://www.youtube.com/shorts/X9rzB-HGWE4');
      // Should NOT be missing the slash (shortsX9rzB-HGWE4 is wrong)
      expect(res.text).not.toContain('shortsX9rzB-HGWE4');
    });

    it('should have correct youtube URL in redirect', async () => {
      const res = await request(app)
        .get('/shorts/abc123?si=value')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0)'); // Non-Discord browser

      // Should redirect to correct URL
      expect(res.status).toBe(302);
      expect(res.text).toContain('https://www.youtube.com/shorts/abc123');
    });
  });
});
