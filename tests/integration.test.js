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

  describe('404 handler', () => {
    it('should return 404 for unknown paths', async () => {
      const res = await request(app).get('/unknown/path');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
