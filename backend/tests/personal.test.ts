import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Sqlite } from '../src/db/database.js';
import type { AiClient } from '../src/services/aiClient.js';
import { inQuietHours } from '../src/services/quietHours.js';
import { CapturingMailer } from '../src/services/mailer.js';
import { demoConfig } from './helpers.js';

const open: Array<{ close: () => void }> = [];
afterEach(() => { while (open.length) open.pop()?.close(); });

const recommendation = {
  reply: 'I found a forest video that is actually in the Pixabay results.',
  explanation: 'Selected because the request and the saved interest are nature.',
  intent: 'video_search',
  keywords: ['forest'],
  videos: [
    { id: '125', title: 'Forest', description: 'trees', category: 'nature', thumbnailUrl: 'https://cdn.example/t.jpg', videoUrl: 'https://cdn.example/a.mp4', duration: 12, width: 1280, height: 720 },
    { id: 'bad id', title: 'Invented', description: 'no', category: 'nature', thumbnailUrl: null, videoUrl: 'http://insecure.example/a.mp4', duration: null, width: null, height: null },
  ],
};

function hit(id = 125) {
  return {
    id, pageURL: `https://pixabay.com/videos/id-${id}/`, tags: 'forest, river', duration: 12,
    videos: { medium: { url: `https://cdn.pixabay.com/video/${id}.mp4`, width: 1280, height: 720, thumbnail: `https://cdn.pixabay.com/video/${id}.jpg` } },
    user_id: 10, user: 'Creator',
  };
}

function build(ai: AiClient = { recommend: async () => recommendation }) {
  const mailer = new CapturingMailer();
  const sqlite = Sqlite.open(':memory:');
  open.push(sqlite);
  const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ hits: [hit()] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const created = createApp({ config: demoConfig({ PIXABAY_API_KEY: 'pixabay-test-key' }), sqlite, mailer, ai, fetchImpl });
  return { app: created.app, mailer };
}

async function signIn(app: ReturnType<typeof build>['app'], mailer: CapturingMailer, email: string) {
  await request(app).post('/api/auth/otp/request').send({ email });
  const verified = await request(app).post('/api/auth/otp/verify').send({ email, code: mailer.sent.at(-1)?.code });
  return verified.body.token as string;
}

describe('personal library and AI', () => {
  it('keeps favorites, history, and notification settings on the signed-in user', async () => {
    const { app, mailer } = build();
    const denied = await request(app).get('/api/me/favorites');
    expect(denied.status).toBe(401);
    const token = await signIn(app, mailer, 'viewer@example.com');
    const saved = await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${token}`).send({ videoId: '125', title: 'Forest', thumbnailUrl: 'https://cdn.example/t.jpg', category: 'nature' });
    expect(saved.status).toBe(201);
    const again = await request(app).post('/api/me/favorites').set('Authorization', `Bearer ${token}`).send({ videoId: '125', title: 'Forest', thumbnailUrl: 'https://cdn.example/t.jpg', category: 'nature' });
    expect(again.body.favorites).toHaveLength(1);
    const history = await request(app).post('/api/me/history').set('Authorization', `Bearer ${token}`).send({ videoId: '125', title: 'Forest', thumbnailUrl: null, category: 'nature' });
    expect(history.body.history).toHaveLength(1);
    const prefs = await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${token}`).send({
      pushEnabled: true, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: false,
      frequency: 'daily', quietStart: '22:00', quietEnd: '07:00', categories: ['nature'],
    });
    expect(prefs.status).toBe(200);
    expect(prefs.body.preferences.frequency).toBe('daily');
    expect(inQuietHours('22:00', '07:00', 23 * 60)).toBe(true);
    expect(inQuietHours('22:00', '07:00', 12 * 60)).toBe(false);
  });

  it('drops invented videos and keeps conversation context for the same guest', async () => {
    const { app } = build();
    const first = await request(app).post('/api/ai/chat').send({ message: 'Find nature videos.' });
    expect(first.status).toBe(200);
    expect(first.body.videos.map((video: { id: string }) => video.id)).toEqual(['125']);
    const second = await request(app).post('/api/ai/chat').send({ message: 'Show me something more relaxing.', conversationId: first.body.conversationId, guestKey: first.body.guestKey });
    expect(second.status).toBe(200);
    expect(second.body.conversationId).toBe(first.body.conversationId);
  });

  it('accepts natural-language video requests when optional fields are missing, blank, or null', async () => {
    const { app } = build();
    const prompts = [
      'you can you give me some video about f1',
      'Show me Formula 1 videos',
      'I want to watch motorsport',
      'Find Grand Prix racing videos',
      'Recommend relaxing nature videos',
      'Show me food videos',
      'Show me origami videos',
    ];
    for (const message of prompts) {
      const response = await request(app).post('/api/ai/chat').send({ message, conversationId: '', guestKey: null });
      expect(response.status, message).toBe(200);
      expect(response.body.error).toBeUndefined();
    }
    const literalNull = await request(app).post('/api/ai/chat').send({ message: 'you can you give me some video about f1', guestKey: 'null' });
    expect(literalNull.status).toBe(200);
    expect(literalNull.body.guestKey.length).toBeGreaterThanOrEqual(8);
    const omitted = await request(app).post('/api/ai/chat').send({ message: 'Show me Formula 1 videos' });
    expect(omitted.status).toBe(200);
    const empty = await request(app).post('/api/ai/chat').send({ message: '   ' });
    expect(empty.status).toBe(400);
    expect(empty.body.error.code).toBe('VALIDATION_ERROR');
    expect(empty.body.error.message).toBe('Type a message before sending.');
    expect(empty.body.error.details).toBeNull();
    const invalid = await request(app).post('/api/ai/chat').set('Content-Type', 'application/json').send('{');
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('MALFORMED_JSON');
    expect(JSON.stringify(invalid.body)).not.toContain('Traceback');
    const badId = await request(app).post('/api/ai/chat').send({ message: 'Show me Formula 1 videos', conversationId: 'not-a-uuid' });
    expect(badId.status).toBe(400);
    expect(badId.body.error.message).not.toContain('uuid');
    expect(badId.body.error.details).toBeNull();
  });

  it('returns an honest empty recommendation and drops videos with invalid urls', async () => {
    const { app } = build({
      recommend: async () => ({
        reply: 'Pixabay did not return a playable video for that request. You can try Formula 1 racing.',
        explanation: 'Pixabay did not return a playable video for that request.',
        intent: 'video_search',
        keywords: ['Formula 1 racing'],
        videos: [
          { id: '1', title: 'Insecure', description: '', category: 'sports', thumbnailUrl: null, videoUrl: 'http://insecure.example/a.mp4', duration: 10, width: null, height: null },
          { id: '2', title: ' ', description: '', category: 'sports', thumbnailUrl: null, videoUrl: 'https://cdn.example/blank.mp4', duration: 10, width: null, height: null },
          { id: 'not a url', title: 'Broken', description: '', category: 'sports', thumbnailUrl: 'http://cdn.example/t.jpg', videoUrl: 'notaurl', duration: null, width: null, height: null },
        ],
      }),
    });
    const response = await request(app).post('/api/ai/chat').send({ message: 'you can you give me some video about f1' });
    expect(response.status).toBe(200);
    expect(response.body.videos).toEqual([]);
    expect(response.body.reply).toContain('did not return');
  });

  it('previews a published video and does not broadcast or contact EngageLab in demo mode', async () => {
    const { app, mailer } = build();
    const token = await signIn(app, mailer, 'nature@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${token}`).send({ categories: ['nature'] });
    await request(app).post('/api/devices/register').set('Authorization', `Bearer ${token}`).send({
      registrationId: 'regLibraryDevice01', platform: 'android', deviceType: 'phone', installationId: 'installLibrary01',
    });
    const added = await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ videoId: '125', category: 'nature', keywords: ['forest'], tags: ['water'] });
    expect(added.status).toBe(201);
    expect(added.body.entry.width).toBe(1280);
    const published = await request(app).post('/api/library/125/publish').set('Authorization', 'Bearer test-admin-key-123');
    expect(published.body.sent).toBe(false);
    const preview = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(preview.body.willQueue).toBe(0);
    expect(preview.body.willSend).toBe(1);
    expect(preview.body.matches[0].registrationId).not.toBe('regLibraryDevice01');
    const activated = await request(app).post(`/api/library/campaigns/${published.body.libraryCampaignId}/activate`).set('Authorization', 'Bearer test-admin-key-123').send({ confirm: true });
    expect(activated.status).toBe(200);
    expect(activated.body.simulated).toBe(true);
    expect(activated.body.deviceDeliveryVerified).toBe(false);
    const repeat = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(repeat.body.matches.some((match: { reason: string }) => match.reason === 'duplicate')).toBe(true);
    const outsider = await request(app).post('/api/library/125/preview');
    expect(outsider.status).toBe(401);
  });

  it('queues a daily match and does not release it before its deliver time', async () => {
    const { app, mailer } = build();
    const token = await signIn(app, mailer, 'daily@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${token}`).send({ categories: ['nature'] });
    await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${token}`).send({
      pushEnabled: true, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: true,
      frequency: 'daily', quietStart: null, quietEnd: null, categories: ['nature'],
    });
    await request(app).post('/api/devices/register').set('Authorization', `Bearer ${token}`).send({
      registrationId: 'regDigestDevice01', platform: 'android', deviceType: 'phone', installationId: 'installDigest01',
    });
    await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ videoId: '125', category: 'nature', keywords: ['forest'], tags: [] });
    const published = await request(app).post('/api/library/125/publish').set('Authorization', 'Bearer test-admin-key-123');
    const preview = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(preview.body.willSend).toBe(0);
    expect(preview.body.willQueue).toBe(1);
    const activated = await request(app).post(`/api/library/campaigns/${published.body.libraryCampaignId}/activate`).set('Authorization', 'Bearer test-admin-key-123').send({ confirm: true });
    expect(activated.body.sent).toBe(0);
    expect(activated.body.queued).toBe(1);
    const held = await request(app).post('/api/library/digest/run').set('Authorization', 'Bearer test-admin-key-123').send({});
    expect(held.status).toBe(400);
    const released = await request(app).post('/api/library/digest/run').set('Authorization', 'Bearer test-admin-key-123').send({ confirm: true });
    expect(released.body.processed).toBe(0);
    expect(released.body.deviceDeliveryVerified).toBe(false);
  });
});
