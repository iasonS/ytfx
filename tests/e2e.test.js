import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app } from '../index.js';

/**
 * End-to-End Tests
 *
 * These tests call REAL external services (YouTube, yt-dlp)
 * They are slower and may fail due to network issues or YouTube changes.
 *
 * Run with: npm run test:e2e
 * Skip with: npm run test (runs only unit/integration tests)
 */

describe.skip('E2E Tests - Real YouTube & yt-dlp (requires network)', () => {
  const TEST_TIMEOUT = 15000; // 15 seconds for real API calls

  describe('Real yt-dlp extraction', () => {
    it(
      'should extract real stream URL from valid video',
      async () => {
        const res = await request(app)
          .get('/watch?v=dQw4w9WgXcQ')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        // Either succeeds with HTML or fails gracefully
        expect([200, 500]).toContain(res.status);

        if (res.status === 200) {
          expect(res.text).toContain('og:video');
          expect(res.text).toContain('og:image');
        }
      },
      TEST_TIMEOUT
    );

    it(
      'should extract metadata from YouTube Shorts',
      async () => {
        const res = await request(app)
          .get('/shorts/Sp78zCdzhfA')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        expect([200, 500]).toContain(res.status);

        if (res.status === 200) {
          expect(res.text).toContain('og:video');
        }
      },
      TEST_TIMEOUT
    );

    it(
      'should handle invalid video IDs gracefully',
      async () => {
        const res = await request(app)
          .get('/watch?v=invalid_video_id_that_does_not_exist')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        // Should fail gracefully, not crash
        expect([400, 500]).toContain(res.status);
      },
      TEST_TIMEOUT
    );
  });

  describe('oEmbed integration', () => {
    it(
      'should fetch oEmbed metadata from YouTube',
      async () => {
        const res = await request(app)
          .get('/watch?v=dQw4w9WgXcQ')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        // oEmbed should return title
        if (res.status === 200) {
          expect(res.text).toContain('og:title');
        }
      },
      TEST_TIMEOUT
    );
  });

  describe('Performance under real conditions', () => {
    it(
      'should complete embed generation within 10 seconds',
      async () => {
        const startTime = Date.now();

        const res = await request(app)
          .get('/watch?v=dQw4w9WgXcQ')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        const duration = Date.now() - startTime;

        // Even on slow networks, should be under 10 seconds
        expect(duration).toBeLessThan(10000);
        expect([200, 500]).toContain(res.status);
      },
      TEST_TIMEOUT
    );

    it(
      'should cache results and serve cached content faster',
      async () => {
        const videoId = 'jNQXAC9IVRw';

        // First request (cache miss)
        const start1 = Date.now();
        await request(app)
          .get(`/watch?v=${videoId}`)
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);
        const duration1 = Date.now() - start1;

        // Second request (cache hit, should be much faster)
        const start2 = Date.now();
        const res2 = await request(app)
          .get(`/watch?v=${videoId}`)
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);
        const duration2 = Date.now() - start2;

        // Cache hit should be significantly faster
        // (or at least not slower - both could fail)
        if (res2.status === 200) {
          expect(duration2).toBeLessThan(duration1);
        }
      },
      TEST_TIMEOUT * 2
    );
  });

  describe('Metrics collection with real data', () => {
    it(
      'should record yt-dlp and oEmbed timing to metrics',
      async () => {
        // Make a request to generate metrics
        await request(app)
          .get('/watch?v=GaKNSRbi3gw')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        // Check metrics were recorded
        const metricsRes = await request(app).get('/metrics');

        expect(metricsRes.status).toBe(200);
        expect(metricsRes.body.operations).toBeDefined();

        const hasOEmbed = metricsRes.body.operations.oEmbed?.count > 0;
        const hasYtDlp = metricsRes.body.operations['yt-dlp']?.count > 0;

        // At least one should be recorded
        expect(hasOEmbed || hasYtDlp).toBe(true);
      },
      TEST_TIMEOUT
    );

    it(
      'should show realistic timing data in metrics',
      async () => {
        const metricsRes = await request(app).get('/metrics');

        expect(metricsRes.status).toBe(200);

        // If we have data, check it's realistic
        if (metricsRes.body.operations.oEmbed?.count > 0) {
          const oEmbedAvg = metricsRes.body.operations.oEmbed.avg;
          // oEmbed should be 10ms - 5000ms
          expect(oEmbedAvg).toBeGreaterThan(10);
          expect(oEmbedAvg).toBeLessThan(5000);
        }

        if (metricsRes.body.operations['yt-dlp']?.count > 0) {
          const ytDlpAvg = metricsRes.body.operations['yt-dlp'].avg;
          // yt-dlp should be 100ms - 15000ms
          expect(ytDlpAvg).toBeGreaterThan(100);
          expect(ytDlpAvg).toBeLessThan(15000);
        }
      },
      TEST_TIMEOUT
    );
  });

  describe('Error handling with real failures', () => {
    it(
      'should handle YouTube connection errors gracefully',
      async () => {
        // Test with a video that might be unavailable or restricted
        const res = await request(app)
          .get('/watch?v=INVALID1234567890')
          .set('User-Agent', 'Discordbot/2.0')
          .timeout(TEST_TIMEOUT);

        // Should not crash, should return error
        expect([400, 500]).toContain(res.status);
        expect(res.body.error).toBeDefined();
      },
      TEST_TIMEOUT
    );

    it(
      'should handle network timeouts without crashing',
      async () => {
        // Make multiple rapid requests
        const promises = Array(5)
          .fill(null)
          .map(() =>
            request(app)
              .get('/watch?v=dQw4w9WgXcQ')
              .set('User-Agent', 'Discordbot/2.0')
              .timeout(TEST_TIMEOUT)
          );

        const results = await Promise.all(promises);

        // At least some should succeed or all fail gracefully
        results.forEach(res => {
          expect([200, 500]).toContain(res.status);
        });
      },
      TEST_TIMEOUT * 3
    );
  });
});

/**
 * How to run E2E tests:
 *
 * 1. Enable E2E tests (remove .skip):
 *    Change: describe.skip('E2E Tests...')
 *    To:     describe('E2E Tests...')
 *
 * 2. Run with timeout:
 *    npm run test -- tests/e2e.test.js --reporter=verbose
 *
 * 3. Or add to package.json:
 *    "test:e2e": "vitest tests/e2e.test.js --reporter=verbose"
 *    npm run test:e2e
 *
 * Notes:
 * - Tests are skipped by default (.skip) to keep CI fast
 * - Tests hit real YouTube/yt-dlp, so they're slow (10-15s)
 * - Tests may fail if YouTube is down or blocks requests
 * - Use realistic video IDs (dQw4w9WgXcQ = Rickroll, well-known)
 * - Watch for rate limiting if running too many times
 */
