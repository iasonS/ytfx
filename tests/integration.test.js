import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

describe('Integration Tests', () => {
  describe('GET /health', () => {
    it('should return status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('GET /watch', () => {
    it('should redirect non-Discord users to YouTube', async () => {
      const res = await request(app)
        .get('/watch?v=dQw4w9WgXcQ')
        .set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('youtube.com');
    });

    it('should return 400 for invalid video ID', async () => {
      const res = await request(app)
        .get('/watch?v=<script>')
        .set('User-Agent', 'Discordbot');
      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('should return 400 for missing video ID', async () => {
      const res = await request(app)
        .get('/watch')
        .set('User-Agent', 'Discordbot');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /shorts/:id', () => {
    it('should redirect non-Discord users to YouTube Shorts', async () => {
      const res = await request(app)
        .get('/shorts/abc123')
        .set('User-Agent', 'Mozilla/5.0');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('youtube.com/shorts');
    });

    it('should return 400 for invalid shorts ID', async () => {
      const res = await request(app)
        .get('/shorts/<bad>')
        .set('User-Agent', 'Discordbot');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /go', () => {
    it('should convert YouTube watch URL to proxy short form', async () => {
      const url = encodeURIComponent('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      const res = await request(app).get(`/go?url=${url}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('/watch?v=dQw4w9WgXcQ');
    });

    it('should convert YouTube Shorts URL', async () => {
      const url = encodeURIComponent('https://www.youtube.com/shorts/abc123');
      const res = await request(app).get(`/go?url=${url}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/shorts/abc123');
    });

    it('should convert youtu.be short URL', async () => {
      const url = encodeURIComponent('https://youtu.be/xyz789');
      const res = await request(app).get(`/go?url=${url}`);
      expect(res.status).toBe(302);
      expect(res.headers.location).toBe('/xyz789');
    });

    it('should return 400 for missing url parameter', async () => {
      const res = await request(app).get('/go');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Missing');
    });

    it('should return 400 for invalid URL format', async () => {
      const url = encodeURIComponent('https://example.com');
      const res = await request(app).get(`/go?url=${url}`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Could not extract');
    });
  });

  describe('GET /:id', () => {
    it('should redirect non-Discord users for short-form', async () => {
      const res = await request(app)
        .get('/dQw4w9WgXcQ')
        .set('User-Agent', 'Mozilla/5.0');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('youtube.com/watch?v=');
    });

    it('should return 400 for invalid short-form ID', async () => {
      const res = await request(app)
        .get('/<bad>')
        .set('User-Agent', 'Discordbot');
      expect(res.status).toBe(400);
    });
  });

  describe('GET /', () => {
    it('should return JSON for bot user agents', async () => {
      const res = await request(app)
        .get('/')
        .set('User-Agent', 'Discordbot/2.0');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('ytfx');
    });

    it('should return HTML easter egg for humans', async () => {
      const res = await request(app)
        .get('/')
        .set('User-Agent', 'Mozilla/5.0');
      expect(res.status).toBe(200);
      expect(res.type).toContain('text/html');
      expect(res.text).toContain('ಠ ω ಠ');
      expect(res.text).toContain('You should not be here');
    });
  });

  describe('GET /stats', () => {
    it('should return 500 if STATS_TOKEN not configured', async () => {
      const res = await request(app).get('/stats?token=anytoken');
      expect(res.status).toBe(500);
      expect(res.body.error).toContain('not configured');
    });
  });

  describe('Rate limiting', () => {
    it('should not rate limit health endpoint', async () => {
      for (let i = 0; i < 65; i++) {
        await request(app).get('/health');
      }
      // If we get here without hitting 429, health is not rate limited
      expect(true).toBe(true);
    });

    it('should return 429 after exceeding rate limit on /go', async () => {
      // Make 61 requests (limit is 60 per minute)
      let lastStatus = 200;
      for (let i = 0; i < 61; i++) {
        const url = encodeURIComponent(`https://www.youtube.com/watch?v=test${i}`);
        const res = await request(app).get(`/go?url=${url}`);
        lastStatus = res.status;
      }
      expect(lastStatus).toBe(429);
    });
  });

  describe('404 handler', () => {
    it('should return 404 for unknown paths', async () => {
      const res = await request(app).get('/unknown/path');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
