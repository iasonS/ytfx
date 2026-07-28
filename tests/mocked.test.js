import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { app, cache } from '../index.js';

vi.mock('youtube-dl-exec', () => ({ default: vi.fn() }));
global.fetch = vi.fn();

import youtubeDlExec from 'youtube-dl-exec';

const oembed = (title = 'Test Video Title') => ({
  ok: true,
  json: async () => ({ title }),
});

const jpegResponse = (width, height) => {
  const bytes = new Uint8Array([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);

  return {
    ok: true,
    status: 206,
    headers: new Headers({ 'content-type': 'image/jpeg' }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  };
};

function mockShortsMetadata(title, width, height) {
  global.fetch.mockImplementation((url) => {
    if (url.includes('/oembed?')) return Promise.resolve(oembed(title));
    return Promise.resolve(jpegResponse(width, height));
  });
}

describe('Mocked Tests - Embed and lazy proxy flow', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    cache.clear();
  });

  it('returns crawler metadata with a stable proxy URL without invoking yt-dlp', async () => {
    global.fetch.mockResolvedValueOnce(oembed());

    const res = await request(app)
      .get('/watch?v=dQw4w9WgXcQ')
      .set('Host', 'embed.example.test')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('https://embed.example.test/proxy/video/dQw4w9WgXcQ');
    expect(res.text).toContain('Test Video Title');
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('keeps metadata available when yt-dlp would fail', async () => {
    youtubeDlExec.mockRejectedValueOnce(new Error('yt-dlp error'));
    global.fetch.mockResolvedValueOnce(oembed('Fallback-safe metadata'));

    const res = await request(app)
      .get('/watch?v=badVideoId')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Fallback-safe metadata');
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('uses the fallback title when oEmbed fails', async () => {
    global.fetch.mockResolvedValueOnce({ ok: false, status: 503 });

    const res = await request(app)
      .get('/watch?v=oembedFailure')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta property="og:title" content="YouTube Video">');
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('advertises portrait Shorts metadata and a truthful landscape fallback', async () => {
    mockShortsMetadata('Short Video', 1080, 1920);

    const res = await request(app)
      .get('/shorts/shortId123')
      .set('Host', 'embed.example.test')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta property="og:image" content="https://i.ytimg.com/vi/shortId123/oar2.jpg">\n  <meta property="og:image:width" content="1080">\n  <meta property="og:image:height" content="1920">');
    expect(res.text).toContain('<meta property="og:image" content="https://i.ytimg.com/vi/shortId123/maxresdefault.jpg">\n  <meta property="og:image:width" content="1280">\n  <meta property="og:image:height" content="720">');
    expect(res.text).toContain('https://embed.example.test/proxy/video/shortId123?shorts=1');
    expect(res.text).toContain('<meta property="og:video:width" content="1080">\n  <meta property="og:video:height" content="1920">');
    expect(res.text).toContain('twitter:player:width" content="1080"');
    expect(res.text).toContain('twitter:player:height" content="1920"');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://i.ytimg.com/vi/shortId123/oar2.jpg',
      expect.objectContaining({ headers: { Range: 'bytes=0-65535' } }),
    );
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('uses probed landscape dimensions for a landscape ID routed through Shorts', async () => {
    mockShortsMetadata('Landscape Video', 1920, 1080);

    const res = await request(app)
      .get('/shorts/dQw4w9WgXcQ')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta property="og:image" content="https://i.ytimg.com/vi/dQw4w9WgXcQ/oar2.jpg">\n  <meta property="og:image:width" content="1920">\n  <meta property="og:image:height" content="1080">');
    expect(res.text).toContain('<meta property="og:video:width" content="1920">\n  <meta property="og:video:height" content="1080">');
    expect(res.text).toContain('twitter:player:width" content="1920"');
    expect(res.text).toContain('twitter:player:height" content="1080"');
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('preserves a probed 4:3 aspect instead of assuming every Shorts URL is portrait', async () => {
    mockShortsMetadata('4:3 Video', 320, 240);

    const res = await request(app)
      .get('/shorts/jNQXAC9IVRw')
      .set('User-Agent', 'Discordbot/2.0');

    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta property="og:video:width" content="320">\n  <meta property="og:video:height" content="240">');
    expect(res.text).toContain('twitter:player:width" content="320"');
    expect(res.text).toContain('twitter:player:height" content="240"');
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('omits primary and player dimensions when the bounded thumbnail probe fails', async () => {
    global.fetch.mockImplementation((url) => {
      if (url.includes('/oembed?')) return Promise.resolve(oembed('Probe Failure'));
      return Promise.resolve({ ok: false, status: 404, body: null });
    });

    const res = await request(app)
      .get('/shorts/noThumbnail')
      .set('User-Agent', 'Discordbot/2.0');

    const primaryImageMetadata = res.text.split(
      '<meta property="og:image" content="https://i.ytimg.com/vi/noThumbnail/maxresdefault.jpg">',
    )[0];
    expect(res.status).toBe(200);
    expect(primaryImageMetadata).toContain(
      '<meta property="og:image" content="https://i.ytimg.com/vi/noThumbnail/oar2.jpg">',
    );
    expect(primaryImageMetadata).not.toContain('<meta property="og:image:width"');
    expect(res.text).not.toContain('<meta property="og:video:width"');
    expect(res.text).not.toContain('<meta name="twitter:player:width"');
    expect(youtubeDlExec).not.toHaveBeenCalled();
  });

  it('forwards Range and streams a partial upstream response', async () => {
    youtubeDlExec.mockResolvedValueOnce({ url: 'https://stream.example/video.mp4', formats: [] });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 206,
      headers: new Headers({
        'content-type': 'video/mp4',
        'content-length': '4',
        'content-range': 'bytes 10-13/100',
        'accept-ranges': 'bytes',
      }),
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('test'));
          controller.close();
        },
      }),
    });

    const res = await request(app)
      .get('/proxy/video/stream123')
      .set('Range', 'bytes=10-13');

    expect(res.status).toBe(206);
    expect(res.headers['content-range']).toBe('bytes 10-13/100');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(res.body.toString()).toBe('test');
    expect(global.fetch).toHaveBeenCalledWith('https://stream.example/video.mp4', expect.objectContaining({
      method: 'GET',
      headers: { Range: 'bytes=10-13' },
    }));
  });

  it('uses an upstream HEAD request and sends no response body', async () => {
    youtubeDlExec.mockResolvedValueOnce({ url: 'https://stream.example/video.mp4', formats: [] });
    global.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '100' }),
      body: null,
    });

    const res = await request(app).head('/proxy/video/head123');

    expect(res.status).toBe(200);
    expect(res.headers['content-length']).toBe('100');
    expect(res.text).toBeUndefined();
    expect(global.fetch).toHaveBeenCalledWith('https://stream.example/video.mp4', expect.objectContaining({ method: 'HEAD' }));
  });

  it('returns 502 instead of forwarding an upstream media failure', async () => {
    youtubeDlExec.mockResolvedValueOnce({ url: 'https://stream.example/forbidden.mp4', formats: [] });
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: new Headers({ 'content-type': 'text/html' }),
      body: null,
    });

    const res = await request(app).get('/proxy/video/forbidden123');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Failed to download video');
  });

  it('forwards an upstream 416 response for an unsatisfiable Range', async () => {
    youtubeDlExec.mockResolvedValueOnce({ url: 'https://stream.example/video.mp4', formats: [] });
    global.fetch.mockResolvedValueOnce({
      ok: false,
      status: 416,
      headers: new Headers({
        'content-range': 'bytes */100',
        'accept-ranges': 'bytes',
      }),
      body: null,
    });

    const res = await request(app)
      .get('/proxy/video/rangePastEnd')
      .set('Range', 'bytes=999-');

    expect(res.status).toBe(416);
    expect(res.headers['content-range']).toBe('bytes */100');
    expect(res.headers['accept-ranges']).toBe('bytes');
    expect(global.fetch).toHaveBeenCalledWith('https://stream.example/video.mp4', expect.objectContaining({
      method: 'GET',
      headers: { Range: 'bytes=999-' },
    }));
  });

  it('keeps regular and Shorts stream caches separate for the same ID', async () => {
    youtubeDlExec
      .mockResolvedValueOnce({ url: 'https://stream.example/watch.mp4', formats: [] })
      .mockResolvedValueOnce({ url: 'https://stream.example/shorts.mp4', formats: [] });
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '1' }),
        body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '1' }),
        body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([2])); controller.close(); } }),
      });

    await request(app).get('/proxy/video/shared123').expect(200);
    await request(app).get('/proxy/video/shared123?shorts=1').expect(200);

    expect(youtubeDlExec).toHaveBeenCalledTimes(2);
    expect(youtubeDlExec.mock.calls[0][0]).toContain('/watch?v=shared123');
    expect(youtubeDlExec.mock.calls[1][0]).toContain('/shorts/shared123');
  });
});
