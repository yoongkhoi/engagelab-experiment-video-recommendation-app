import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors.js';
import { PixabayCatalog, selectMp4 } from '../src/integrations/pixabay.js';
import { admin, buildApp, demoConfig } from './helpers.js';

const KEY = 'pixabay-test-key';

function hit(id = 125) {
  return {
    id,
    pageURL: `https://pixabay.com/videos/id-${id}/`,
    tags: 'flowers, yellow, blossom',
    duration: 12,
    videos: {
      large: { url: '', width: 3840, height: 2160, size: 0, thumbnail: '' },
      medium: {
        url: `https://cdn.pixabay.com/video/2015/08/08/${id}-135736646_medium.mp4`,
        width: 1280,
        height: 720,
        size: 3562083,
        thumbnail: `https://cdn.pixabay.com/video/2015/08/08/${id}-135736646_medium.jpg`,
      },
      small: {
        url: `https://cdn.pixabay.com/video/2015/08/08/${id}-135736646_small.mp4`,
        width: 640,
        height: 360,
        size: 1030736,
        thumbnail: `https://cdn.pixabay.com/video/2015/08/08/${id}-135736646_small.jpg`,
      },
      tiny: {
        url: `https://cdn.pixabay.com/video/2015/08/08/${id}-135736646_tiny.mp4`,
        width: 480,
        height: 270,
        size: 426799,
        thumbnail: `https://cdn.pixabay.com/video/2015/08/08/${id}-135736646_tiny.jpg`,
      },
    },
    user_id: 1281706,
    user: 'Coverr-Free-Footage',
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Pixabay video catalog', () => {
  it('selects the medium MP4 and skips an empty large rendition', () => {
    expect(selectMp4(hit().videos)?.url).toBe('https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4');
    expect(selectMp4({ large: { url: '', size: 0 }, medium: { url: '' } })).toBeUndefined();
  });

  it('searches, pages, and serves the second identical request from the 24 hour cache', async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      expect(url.searchParams.get('key')).toBe(KEY);
      expect(url.origin).toBe('https://pixabay.com');
      return jsonResponse({ total: 42, totalHits: 42, hits: [hit()] });
    };
    const { app } = buildApp(demoConfig({ PIXABAY_API_KEY: KEY }), fetchImpl);
    const first = await request(app).get('/api/videos').query({ query: 'nature', page: 2 });
    const second = await request(app).get('/api/videos').query({ query: 'nature', page: 2 });
    expect(first.status).toBe(200);
    expect(urls).toHaveLength(1);
    expect(urls[0]?.searchParams.get('q')).toBe('nature');
    expect(urls[0]?.searchParams.get('page')).toBe('2');
    expect(urls[0]?.searchParams.get('safesearch')).toBe('true');
    expect(urls[0]?.pathname).toBe('/api/videos/');
    expect(second.body).toEqual(first.body);
    expect(first.body).toMatchObject({
      page: 2,
      perPage: 10,
      totalResults: 42,
      source: 'pixabay',
      attribution: { text: 'Videos provided by Pixabay', url: 'https://pixabay.com' },
    });
    expect(first.body.videos[0]).toMatchObject({
      video_id: '125',
      category: 'nature',
      video_url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4',
      thumbnail_url: 'https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg',
      duration: 12,
      creator_name: 'Coverr-Free-Footage',
      creator_profile_url: 'https://pixabay.com/users/Coverr-Free-Footage-1281706/',
      source_url: 'https://pixabay.com/videos/id-125/',
    });
    expect(JSON.stringify(first.body)).not.toContain(KEY);
  });

  it('loads popular videos and one video by id without exposing the key', async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      if (url.searchParams.has('id')) return jsonResponse({ totalHits: 1, hits: [hit(2499611)] });
      return jsonResponse({ totalHits: 1, hits: [hit(125)] });
    };
    const { app } = buildApp(demoConfig({ PIXABAY_API_KEY: KEY }), fetchImpl);
    const popular = await request(app).get('/api/videos/popular');
    expect(popular.status).toBe(200);
    expect(popular.body.videos[0].video_id).toBe('125');
    expect(popular.body.videos[0].category).toBe('popular');
    expect(urls[0]?.searchParams.has('q')).toBe(false);
    expect(urls[0]?.searchParams.get('order')).toBe('popular');
    const one = await request(app).get('/api/videos/2499611');
    expect(one.status).toBe(200);
    expect(one.body.video.creator_name).toBe('Coverr-Free-Footage');
    expect(one.body.video.source).toContain('.mp4');
    expect(urls[1]?.searchParams.get('id')).toBe('2499611');
    const catalog = await request(app).get('/api/videos');
    expect(catalog.body.videos.map((video: { id: string }) => video.id)).toContain('2499611');
    expect(JSON.stringify(one.body)).not.toContain(KEY);
  });

  it('keeps the bundled catalogue and rejects a missing Pixabay key, a bad page, and an unknown id', async () => {
    const { app } = buildApp(demoConfig());
    const list = await request(app).get('/api/videos');
    expect(list.body.videos.map((video: { id: string }) => video.id)).toEqual(['1001', '1002', '1003']);
    const search = await request(app).get('/api/videos').query({ query: 'nature' });
    expect(search.status).toBe(503);
    expect(search.body.error.code).toBe('PIXABAY_NOT_CONFIGURED');
    const page = await request(app).get('/api/videos/popular').query({ page: '0' });
    expect(page.status).toBe(400);
    const missing = await admin(app).post('/api/campaigns').send({
      name: 'Missing',
      videoId: '9999',
      title: 'Nope',
      message: 'No video',
      targeting: { mode: 'broadcast', confirmBroadcast: true },
      delivery: 'immediate',
    });
    expect(missing.status).toBe(404);
  });

  it('reports provider auth failure, an unexpected body, and a rate limit without calling EngageLab', async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.host.includes('pushapi')) throw new Error('EngageLab must not be called');
      if (url.searchParams.get('id') === '2499611') return jsonResponse({ unexpected: true });
      if (url.searchParams.get('q') === 'limited') return new Response('API rate limit exceeded', { status: 429 });
      return new Response('Invalid API key', { status: 400 });
    };
    const { app } = buildApp(demoConfig({ PIXABAY_API_KEY: KEY }), fetchImpl);
    const auth = await request(app).get('/api/videos').query({ query: 'nature' });
    expect(auth.status).toBe(503);
    expect(auth.body.error.code).toBe('PIXABAY_AUTH_FAILED');
    expect(JSON.stringify(auth.body)).not.toContain(KEY);
    const weird = await request(app).get('/api/videos/2499611');
    expect(weird.status).toBe(502);
    expect(weird.body.error.code).toBe('PIXABAY_RESPONSE');
    const limited = await request(app).get('/api/videos').query({ query: 'limited' });
    expect(limited.status).toBe(429);

    let now = 1_000;
    let calls = 0;
    const catalog = new PixabayCatalog(KEY, async () => {
      calls += 1;
      return jsonResponse({ hits: [hit()], totalHits: 1 });
    }, () => now, 1);
    await catalog.search('ocean', 1);
    await expect(catalog.search('forest', 1)).rejects.toMatchObject({ status: 429, code: 'PIXABAY_RATE_LIMIT' } satisfies Partial<HttpError>);
    now += 60_000;
    await catalog.search('ocean', 1);
    expect(calls).toBe(1);
  });

  it('can target a Pixabay video from a campaign without sending a push', async () => {
    const urls: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(String(input));
      urls.push(url);
      return jsonResponse({ totalHits: 1, hits: [hit(2499611)] });
    };
    const { app } = buildApp(demoConfig({ PIXABAY_API_KEY: KEY }), fetchImpl);
    const created = await admin(app).post('/api/campaigns').send({
      name: 'Pixabay clip',
      videoId: '2499611',
      title: 'Watch',
      message: 'Tap to play',
      targeting: { mode: 'broadcast', confirmBroadcast: true },
      delivery: 'draft',
    });
    expect(created.status).toBe(201);
    expect(created.body.campaign.videoId).toBe('2499611');
    expect(created.body.campaign.status).toBe('draft');
    expect(created.body.campaign.providerMode).toBe('not_sent');
    expect(urls).toHaveLength(1);
    expect(urls[0]?.searchParams.get('id')).toBe('2499611');
    expect(urls[0]?.host).toBe('pixabay.com');
  });

  it('rejects a short Pixabay key during startup', () => {
    expect(() => demoConfig({ PIXABAY_API_KEY: 'short' })).toThrow(/PIXABAY_API_KEY/);
  });
});
