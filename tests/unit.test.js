import { describe, it, expect } from 'vitest';
import { isDiscordBot, extractVideoId, escapeHtml, buildEmbedHtml, CACHE_TTL, parseCookieString } from '../index.js';

describe('Unit Tests', () => {
  describe('isDiscordBot', () => {
    it('should return true for Discord bot user agent', () => {
      const req = { get: () => 'Mozilla/5.0 (compatible; Discordbot/2.0)' };
      expect(isDiscordBot(req)).toBe(true);
    });

    it('should return false for non-Discord user agent', () => {
      const req = { get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' };
      expect(isDiscordBot(req)).toBe(false);
    });

    it('should handle missing user-agent header', () => {
      const req = { get: () => undefined };
      expect(isDiscordBot(req)).toBe(false);
    });

    it('should be case insensitive', () => {
      const req = { get: () => 'DISCORDBOT' };
      expect(isDiscordBot(req)).toBe(true);
    });
  });

  describe('extractVideoId', () => {
    it('should extract video ID from watch query', () => {
      const req = { query: { v: 'dQw4w9WgXcQ' }, params: {} };
      expect(extractVideoId(req, 'watch')).toBe('dQw4w9WgXcQ');
    });

    it('should extract video ID from shorts params', () => {
      const req = { query: {}, params: { id: 'abc123' } };
      expect(extractVideoId(req, 'shorts')).toBe('abc123');
    });

    it('should handle shorts with query parameters (si=...)', () => {
      const req = { query: { si: 'rXcpqvRwHeQxEK5z' }, params: { id: 'Sp78zCdzhfA' } };
      expect(extractVideoId(req, 'shorts')).toBe('Sp78zCdzhfA');
    });

    it('should strip query parameters from id if present', () => {
      const req = { query: {}, params: { id: 'Sp78zCdzhfA?si=rXcpqvRwHeQxEK5z' } };
      expect(extractVideoId(req, 'shorts')).toBe('Sp78zCdzhfA');
    });

    it('should extract video ID from short-form params', () => {
      const req = { query: {}, params: { id: 'xyz789' } };
      expect(extractVideoId(req, 'short-form')).toBe('xyz789');
    });

    it('should validate alphanumeric + dash + underscore', () => {
      const req = { query: { v: 'dQw4w9WgXcQ' }, params: {} };
      expect(extractVideoId(req, 'watch')).toBe('dQw4w9WgXcQ');
    });

    it('should reject invalid characters', () => {
      const req = { query: { v: 'bad<script>' }, params: {} };
      expect(extractVideoId(req, 'watch')).toBeNull();
    });

    it('should reject missing video ID', () => {
      const req = { query: {}, params: {} };
      expect(extractVideoId(req, 'watch')).toBeNull();
    });

    it('should accept dashes and underscores', () => {
      const req = { query: { v: 'dQw-4w_9WgXcQ' }, params: {} };
      expect(extractVideoId(req, 'watch')).toBe('dQw-4w_9WgXcQ');
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersand', () => {
      expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
    });

    it('should escape less-than', () => {
      expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    });

    it('should escape greater-than', () => {
      expect(escapeHtml('2 > 1')).toBe('2 &gt; 1');
    });

    it('should escape double quotes', () => {
      expect(escapeHtml('He said "hi"')).toBe('He said &quot;hi&quot;');
    });

    it('should escape single quotes', () => {
      expect(escapeHtml("It's")).toBe('It&#039;s');
    });

    it('should handle multiple entities', () => {
      expect(escapeHtml('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
    });

    it('should leave safe text unchanged', () => {
      expect(escapeHtml('Hello World')).toBe('Hello World');
    });
  });

  describe('buildEmbedHtml', () => {
    it('should include og:video:url meta tag', () => {
      const data = {
        title: 'Test Video',
        thumbnail: 'https://img.youtube.com/vi/abc123/maxresdefault.jpg',
        streamUrl: 'https://example.com/video.mp4',
      };
      const html = buildEmbedHtml(data, 'abc123');
      expect(html).toContain('<meta property="og:video:url"');
      expect(html).toContain('https://example.com/video.mp4');
    });

    it('should escape title in meta tags', () => {
      const data = {
        title: 'Video with <script>',
        thumbnail: 'https://img.youtube.com/vi/abc123/maxresdefault.jpg',
        streamUrl: 'https://example.com/video.mp4',
      };
      const html = buildEmbedHtml(data, 'abc123');
      expect(html).toContain('og:title" content="Video with &lt;script&gt;');
      expect(html).toContain('<title>Video with &lt;script&gt;</title>');
    });

    it('should include title tag', () => {
      const data = {
        title: 'Test Video',
        thumbnail: 'https://img.youtube.com/vi/abc123/maxresdefault.jpg',
        streamUrl: 'https://example.com/video.mp4',
      };
      const html = buildEmbedHtml(data, 'abc123');
      expect(html).toContain('<title>Test Video</title>');
    });

    it('should have valid HTML structure', () => {
      const data = {
        title: 'Test',
        thumbnail: 'https://img.youtube.com/vi/abc/maxresdefault.jpg',
        streamUrl: 'https://example.com/video.mp4',
      };
      const html = buildEmbedHtml(data, 'abc');
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('</html>');
    });
  });

  describe('CACHE_TTL', () => {
    it('should be 2 hours in milliseconds (optimized for performance)', () => {
      expect(CACHE_TTL).toBe(2 * 60 * 60 * 1000);
    });
  });

  describe('parseCookieString', () => {
    it('should preserve values containing = characters', () => {
      const input = 'PREF=f6=40000080&tz=Europe.Zurich';
      const result = parseCookieString(input);
      expect(result).toContain('PREF\tf6=40000080&tz=Europe.Zurich');
    });

    it('should preserve base64 padding (==) in cookie values', () => {
      const input = 'LOGIN_INFO=AFmmF2sw...data==';
      const result = parseCookieString(input);
      expect(result).toContain('LOGIN_INFO\tAFmmF2sw...data==');
    });

    it('should set secure flag for __Secure- prefixed cookies', () => {
      const input = '__Secure-1PSID=testvalue';
      const result = parseCookieString(input);
      expect(result).toContain('.youtube.com\tTRUE\t/\tTRUE\t0\t__Secure-1PSID\ttestvalue');
    });

    it('should set secure=FALSE for non-secure cookies like HSID', () => {
      const input = 'HSID=testvalue';
      const result = parseCookieString(input);
      expect(result).toContain('.youtube.com\tTRUE\t/\tFALSE\t0\tHSID\ttestvalue');
    });

    it('should include Netscape header', () => {
      const result = parseCookieString('YSC=test');
      expect(result).toContain('# Netscape HTTP Cookie File');
    });

    it('should handle multiple cookies separated by semicolons', () => {
      const input = 'YSC=abc;HSID=def;__Secure-1PSID=ghi';
      const result = parseCookieString(input);
      expect(result).toContain('YSC\tabc');
      expect(result).toContain('HSID\tdef');
      expect(result).toContain('__Secure-1PSID\tghi');
    });

    it('should skip entries without = sign', () => {
      const input = 'YSC=abc;invalid;HSID=def';
      const result = parseCookieString(input);
      expect(result).toContain('YSC\tabc');
      expect(result).toContain('HSID\tdef');
      expect(result).not.toContain('invalid');
    });
  });
});
