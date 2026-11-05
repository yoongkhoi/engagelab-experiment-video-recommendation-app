import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AiClient } from '../src/services/aiClient.js';
import { migrate, Sqlite } from '../src/db/database.js';
import { guestFeed, rankCandidates, recommendationSections, schedulerGate, type Candidate } from '../src/services/personalization.js';
import { CapturingMailer } from '../src/services/mailer.js';
import { demoConfig } from './helpers.js';

const open: Sqlite[] = [];
afterEach(() => { while (open.length) open.pop()?.close(); });

function hit(id: string) {
  return {
    id: Number(id), pageURL: `https://pixabay.com/videos/id-${id}/`, tags: 'forest, river', duration: 12,
    videos: { medium: { url: `https://cdn.pixabay.com/video/${id}.mp4`, width: 1280, height: 720, thumbnail: `https://cdn.pixabay.com/video/${id}.jpg` } },
    user_id: 10, user: 'Creator',
  };
}

const ai: AiClient = {
  recommend: async () => ({
    reply: 'I found a forest video that is actually in the Pixabay results.',
    explanation: 'Selected because the request matched a retrieved video.',
    intent: 'VIDEO_SEARCH',
    keywords: ['forest'],
    videos: [{ id: '125', title: 'Forest', description: 'trees', category: 'nature', thumbnailUrl: 'https://cdn.example/t.jpg', videoUrl: 'https://cdn.example/a.mp4', duration: 12, width: 1280, height: 720 }],
    suggestions: ['More like these'],
  }),
};

function build() {
  const mailer = new CapturingMailer();
  const sqlite = Sqlite.open(':memory:');
  open.push(sqlite);
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const query = url.searchParams.get('q') ?? '';
    const id = url.searchParams.get('id') ?? (query.includes('food') ? '222' : query.includes('Formula') ? '333' : '125');
    return new Response(JSON.stringify({ hits: [hit(id)] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const created = createApp({ config: demoConfig({ PIXABAY_API_KEY: 'pixabay-test-key' }), sqlite, mailer, ai, fetchImpl });
  return { app: created.app, mailer, sqlite };
}

async function signIn(app: ReturnType<typeof build>['app'], mailer: CapturingMailer, email: string) {
  await request(app).post('/api/auth/otp/request').send({ email });
  const verified = await request(app).post('/api/auth/otp/verify').send({ email, code: mailer.sent.at(-1)?.code });
  return verified;
}

async function register(app: ReturnType<typeof build>['app'], token: string, registrationId: string) {
  await request(app).post('/api/devices/register').set('Authorization', `Bearer ${token}`).send({
    registrationId, platform: 'android', deviceType: 'phone', installationId: registrationId,
  });
}

const nature: Candidate = { id: 'n1', title: 'Forest', category: 'nature', tags: ['forest'], videoUrl: 'https://cdn.example/n.mp4', publishedAt: '2026-11-01T00:00:00.000Z' };
const food: Candidate = { id: 'f1', title: 'Cooking', category: 'food', tags: ['cooking'], videoUrl: 'https://cdn.example/f.mp4', publishedAt: '2026-11-01T00:00:00.000Z' };
const race: Candidate = { id: 'r1', title: 'Race', category: 'sports', tags: ['formula 1', 'racing'], videoUrl: 'https://cdn.example/r.mp4', publishedAt: '2026-11-01T00:00:00.000Z' };
const catalog = [nature, food, race];

describe('personalized recommendations', () => {
  const now = '2026-11-04T00:00:00.000Z';

  it('matches nature, food, and motorsport without collapsing to one category', () => {
    const natureOnly = recommendationSections(catalog, { interests: ['nature'], watched: [], favorites: [], positive: [], negative: [], dismissedCategories: [], now });
    const natureSection = natureOnly.find((section) => section.title.includes('Nature'));
    expect(natureSection?.videos.map((video) => video.id)).toContain('n1');
    expect(natureSection?.videos.map((video) => video.id)).not.toContain('f1');
    const foodOnly = recommendationSections(catalog, { interests: ['food'], watched: [], favorites: [], positive: [], negative: [], dismissedCategories: [], now });
    expect(foodOnly.some((section) => section.videos.some((video) => video.id === 'f1'))).toBe(true);
    const racing = recommendationSections(catalog, { interests: ['motorsport'], watched: [], favorites: [], positive: [], negative: [], dismissedCategories: [], now });
    expect(racing.some((section) => section.videos.some((video) => video.id === 'r1'))).toBe(true);
    const both = recommendationSections(catalog, { interests: ['nature', 'food'], watched: [], favorites: [], positive: [], negative: [], dismissedCategories: [], now });
    const titles = both.map((section) => section.title);
    expect(titles.some((title) => title.includes('Nature'))).toBe(true);
    expect(titles.some((title) => title.includes('Food'))).toBe(true);
    const ranked = rankCandidates(catalog, { interests: ['nature', 'food', 'motorsport'], watched: [], favorites: [], positive: [], negative: [], dismissedCategories: [], now });
    expect(new Set(ranked.map((video) => video.category)).size).toBeGreaterThan(1);
  });

  it('drops watched and invalid videos and down-ranks a dismissed category', () => {
    const ranked = rankCandidates([...catalog, { id: 'bad', title: 'Nope', category: 'nature', tags: ['forest'], videoUrl: 'http://insecure.example/a.mp4' }], {
      interests: ['nature', 'food'], watched: ['n1'], favorites: [], positive: [], negative: [], dismissedCategories: ['food'], now,
    });
    expect(ranked.map((video) => video.id)).not.toContain('n1');
    expect(ranked.map((video) => video.id)).not.toContain('bad');
    const foodScore = ranked.find((video) => video.id === 'f1')?.score ?? 1;
    const freshNature = rankCandidates([nature], { interests: ['nature'], watched: [], favorites: [], positive: [], negative: [], dismissedCategories: [], now })[0]?.score ?? 0;
    expect(foodScore).toBeLessThan(freshNature);
  });

  it('keeps guest recommendations unpersonalized', () => {
    expect(guestFeed(catalog).personalized).toBe(false);
  });
});

describe('accounts, onboarding, and audience matching', () => {
  it('completes onboarding without gender and does not reopen it for an existing profile', async () => {
    const { app, mailer, sqlite } = build();
    const created = await signIn(app, mailer, 'new@example.com');
    expect(created.body.created).toBe(true);
    expect(created.body.onboardingCompleted).toBe(false);
    const saved = await request(app).put('/api/me/onboarding').set('Authorization', `Bearer ${created.body.token}`).send({
      categories: ['nature', 'motorsport'], subcategories: ['Formula 1'], completed: true,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.profile.gender).toBeNull();
    expect(saved.body.profile.onboardingCompleted).toBe(true);
    const cooldown = await request(app).post('/api/auth/otp/request').send({ email: 'new@example.com' });
    expect(cooldown.status).toBe(429);
    expect(cooldown.body.error.message).toContain('30 seconds');
    sqlite.run(`UPDATE auth_challenges SET created_at = ? WHERE normalized_email = ?`, '2020-01-01T00:00:00.000Z', 'new@example.com');
    migrate(sqlite);
    const again = await signIn(app, mailer, 'new@example.com');
    expect(again.body.onboardingCompleted).toBe(true);
  });

  it('marks a pre-existing account complete during migration', () => {
    const sqlite = Sqlite.open(':memory:');
    open.push(sqlite);
    migrate(sqlite);
    sqlite.run(
      `INSERT INTO users (id, normalized_email, display_name, created_at, updated_at, last_login_at, account_status)
       VALUES ('old-user', 'old@example.com', NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', NULL, 'active')`,
    );
    sqlite.run('DELETE FROM user_profiles WHERE user_id = ?', 'old-user');
    migrate(sqlite);
    const row = sqlite.get<{ onboarding_completed: number }>('SELECT onboarding_completed FROM user_profiles WHERE user_id = ?', 'old-user');
    expect(row?.onboarding_completed).toBe(1);
  });

  it('supports password login and reset without printing the password', async () => {
    const { app, mailer, sqlite } = build();
    const created = await signIn(app, mailer, 'pass@example.com');
    const saved = await request(app).post('/api/auth/password').set('Authorization', `Bearer ${created.body.token}`).send({ password: 'correct-horse' });
    expect(saved.status).toBe(200);
    expect(JSON.stringify(saved.body)).not.toContain('correct-horse');
    const login = await request(app).post('/api/auth/password/login').send({ email: 'pass@example.com', password: 'correct-horse' });
    expect(login.status).toBe(200);
    expect(login.body.token).toBeTruthy();
    sqlite.run(`UPDATE auth_challenges SET created_at = ? WHERE normalized_email = ?`, '2020-01-01T00:00:00.000Z', 'pass@example.com');
    await request(app).post('/api/auth/otp/request').send({ email: 'pass@example.com' });
    const reset = await request(app).post('/api/auth/password/reset').send({ email: 'pass@example.com', code: mailer.sent.at(-1)?.code, password: 'correct-horse-2' });
    expect(reset.status).toBe(200);
    const next = await request(app).post('/api/auth/password/login').send({ email: 'pass@example.com', password: 'correct-horse-2' });
    expect(next.status).toBe(200);
  });

  it('matches published videos to interests and keeps the other accounts out', async () => {
    const { app, mailer } = build();
    const first = await signIn(app, mailer, 'a@example.com');
    const second = await signIn(app, mailer, 'b@example.com');
    const third = await signIn(app, mailer, 'c@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${first.body.token}`).send({ categories: ['nature', 'food'] });
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${second.body.token}`).send({ categories: ['motorsport'] });
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${third.body.token}`).send({ categories: ['technology'] });
    await register(app, first.body.token, 'regAudienceA0001');
    await register(app, second.body.token, 'regAudienceB0001');
    await register(app, third.body.token, 'regAudienceC0001');
    await request(app).post('/api/devices/register').set('Authorization', `Bearer ${second.body.token}`).send({
      registrationId: 'regAudienceB0002', platform: 'android', deviceType: 'phone', installationId: 'installAudienceB2',
    });
    for (const video of [
      { videoId: '125', category: 'nature', keywords: ['forest'] },
      { videoId: '126', category: 'food', keywords: ['cooking'] },
      { videoId: '127', category: 'sports', keywords: ['formula 1', 'racing'] },
    ]) {
      const added = await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ ...video, tags: [] });
      expect(added.status).toBe(201);
      const published = await request(app).post(`/api/library/${video.videoId}/publish`).set('Authorization', 'Bearer test-admin-key-123');
      expect(published.body.sent).toBe(false);
    }
    const naturePreview = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(naturePreview.body.matches.filter((match: { action: string }) => match.action === 'send').map((match: { email: string }) => match.email)).toEqual(['a@example.com']);
    const foodPreview = await request(app).post('/api/library/126/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(foodPreview.body.matches.filter((match: { action: string }) => match.action === 'send').map((match: { email: string }) => match.email)).toEqual(['a@example.com']);
    const racePreview = await request(app).post('/api/library/127/preview').set('Authorization', 'Bearer test-admin-key-123');
    const raceSends = racePreview.body.matches.filter((match: { action: string }) => match.action === 'send');
    expect(raceSends).toHaveLength(1);
    expect(raceSends[0].email).toBe('b@example.com');
    expect(raceSends[0].registrationId).not.toBe('regAudienceB0001');
    expect(racePreview.body.matches.some((match: { email: string; action: string }) => match.email === 'c@example.com' && match.action === 'send')).toBe(false);
    const dry = await request(app).post('/api/library/127/dry-run').set('Authorization', 'Bearer test-admin-key-123');
    expect(dry.body.engageLabCalled).toBe(false);
    expect(dry.body.sent).toBe(false);
    expect(dry.body.payload.videoId).toBe('127');
    const still = await request(app).post('/api/library/127/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(still.body.willSend).toBe(1);
    const published = await request(app).post('/api/library/127/publish').set('Authorization', 'Bearer test-admin-key-123');
    const activated = await request(app).post(`/api/library/campaigns/${published.body.libraryCampaignId}/activate`).set('Authorization', 'Bearer test-admin-key-123').send({ confirm: true });
    expect(activated.body.sent).toBe(1);
    expect(activated.body.deviceDeliveryVerified).toBe(false);
    const again = await request(app).post(`/api/library/campaigns/${published.body.libraryCampaignId}/activate`).set('Authorization', 'Bearer test-admin-key-123').send({ confirm: true });
    expect(again.status).toBe(200);
    expect(again.body.sent).toBe(0);
    expect(again.body.duplicatePrevented).toBe(true);
    expect(again.body.engageLabCalled).toBe(false);
    const afterSend = await request(app).post('/api/library/127/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(afterSend.body.willSend).toBe(0);
    expect(afterSend.body.matches.some((match: { reason: string }) => match.reason === 'duplicate')).toBe(true);
  });

  it('applies opt-out, missing device, quiet hours, caps, watch history, and dismissal', async () => {
    const { app, mailer } = build();
    const created = await signIn(app, mailer, 'limits@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${created.body.token}`).send({ categories: ['nature'] });
    await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ videoId: '125', category: 'nature', keywords: ['forest'], tags: [] });
    await request(app).post('/api/library/125/publish').set('Authorization', 'Bearer test-admin-key-123');
    const missing = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(missing.body.matches.some((match: { reason: string }) => match.reason === 'no_registered_device')).toBe(true);
    await register(app, created.body.token, 'regLimitsDevice01');
    await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${created.body.token}`).send({
      pushEnabled: false, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: false,
      frequency: 'instant', quietStart: null, quietEnd: null, categories: [],
    });
    const opted = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(opted.body.matches.some((match: { reason: string }) => match.reason === 'opted_out')).toBe(true);
    await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${created.body.token}`).send({
      pushEnabled: true, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: false,
      frequency: 'instant', quietStart: '00:00', quietEnd: '23:59', categories: [],
    });
    const quiet = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(quiet.body.matches.some((match: { reason: string }) => match.reason === 'quiet_hours')).toBe(true);
    await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${created.body.token}`).send({
      pushEnabled: true, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: false,
      frequency: 'weekly', quietStart: null, quietEnd: null, categories: [],
    });
    const weekly = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(weekly.body.willQueue).toBe(1);
    await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${created.body.token}`).send({
      pushEnabled: true, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: true,
      frequency: 'daily', quietStart: null, quietEnd: null, categories: [],
    });
    const daily = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(daily.body.willQueue).toBe(1);
    await request(app).put('/api/me/notifications/preferences').set('Authorization', `Bearer ${created.body.token}`).send({
      pushEnabled: true, newInInterests: true, aiRecommendations: false, trending: false, dailyDigest: false,
      frequency: 'instant', quietStart: null, quietEnd: null, categories: [],
    });
    await request(app).post('/api/me/history').set('Authorization', `Bearer ${created.body.token}`).send({ videoId: '125', title: 'Forest', thumbnailUrl: null, category: 'nature' });
    const watched = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(watched.body.matches.some((match: { reason: string }) => match.reason === 'watched')).toBe(true);
    await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ videoId: '126', category: 'nature', keywords: ['forest'], tags: [] });
    await request(app).post('/api/library/126/publish').set('Authorization', 'Bearer test-admin-key-123');
    await request(app).post('/api/me/recommendation-feedback').set('Authorization', `Bearer ${created.body.token}`).send({ videoId: '126', sentiment: 'negative' });
    const dismissed = await request(app).post('/api/library/126/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(dismissed.body.matches.some((match: { reason: string }) => match.reason === 'dismissed')).toBe(true);
    const policy = await request(app).get('/api/admin/notification-policy').set('Authorization', 'Bearer test-admin-key-123');
    expect(policy.body.policy.automaticCampaigns).toBe(false);
    expect(schedulerGate({}).willSend).toBe(false);
    const guest = await request(app).get('/api/recommendations');
    expect(guest.body.personalized).toBe(false);
  });

  it('caps repeated promotional videos and keeps a second device from duplicating one video', async () => {
    const { app, mailer } = build();
    const created = await signIn(app, mailer, 'cap@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${created.body.token}`).send({ categories: ['nature'] });
    await register(app, created.body.token, 'regCapDevice0001');
    await request(app).post('/api/devices/register').set('Authorization', `Bearer ${created.body.token}`).send({
      registrationId: 'regCapDevice0002', platform: 'android', deviceType: 'phone', installationId: 'installCap02',
    });
    await request(app).put('/api/admin/notification-policy').set('Authorization', 'Bearer test-admin-key-123').send({
      maxPerDay: 1, minIntervalHours: 0, recentExclusionHours: 24, automaticCampaigns: false,
    });
    await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ videoId: '125', category: 'nature', keywords: ['forest'], tags: [] });
    const first = await request(app).post('/api/library/125/publish').set('Authorization', 'Bearer test-admin-key-123');
    const before = await request(app).post('/api/library/125/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(before.body.willSend).toBe(1);
    const sent = await request(app).post(`/api/library/campaigns/${first.body.libraryCampaignId}/activate`).set('Authorization', 'Bearer test-admin-key-123').send({ confirm: true });
    expect(sent.body.sent).toBe(1);
    await request(app).post('/api/library').set('Authorization', 'Bearer test-admin-key-123').send({ videoId: '126', category: 'nature', keywords: ['forest'], tags: [] });
    await request(app).post('/api/library/126/publish').set('Authorization', 'Bearer test-admin-key-123');
    const capped = await request(app).post('/api/library/126/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(capped.body.matches.some((match: { reason: string }) => match.reason === 'frequency_cap')).toBe(true);
    await request(app).put('/api/admin/notification-policy').set('Authorization', 'Bearer test-admin-key-123').send({
      maxPerDay: 3, minIntervalHours: 4, recentExclusionHours: 24, automaticCampaigns: false,
    });
    const interval = await request(app).post('/api/library/126/preview').set('Authorization', 'Bearer test-admin-key-123');
    expect(interval.body.matches.some((match: { reason: string }) => match.reason === 'interval')).toBe(true);
  });

  it('keeps a guest conversation away from an account and allows deletion', async () => {
    const { app, mailer } = build();
    const guest = await request(app).post('/api/ai/chat').send({ message: 'Find nature videos.' });
    expect(guest.status).toBe(200);
    const user = await signIn(app, mailer, 'owner@example.com');
    const stolen = await request(app).post('/api/ai/chat').set('Authorization', `Bearer ${user.body.token}`).send({
      message: 'Find nature videos.', conversationId: guest.body.conversationId,
    });
    expect(stolen.status).toBe(403);
    const removed = await request(app).delete(`/api/ai/conversations/${guest.body.conversationId}`).query({ guestKey: guest.body.guestKey });
    expect(removed.status).toBe(200);
    const deleted = await request(app).post('/api/me/delete').set('Authorization', `Bearer ${user.body.token}`).send({ confirm: 'DELETE' });
    expect(deleted.status).toBe(200);
    const gone = await request(app).get('/api/me').set('Authorization', `Bearer ${user.body.token}`);
    expect(gone.status).toBe(401);
  });

  it('resolves a category to the device of the account that saved that interest', async () => {
    const { app, mailer } = build();
    const natureUser = await signIn(app, mailer, 'nature@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${natureUser.body.token}`).send({ categories: ['nature', 'food'] });
    await register(app, natureUser.body.token, 'regNatureUser0001');
    const other = await signIn(app, mailer, 'motorsport@example.com');
    await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${other.body.token}`).send({ categories: ['motorsport'] });
    await register(app, other.body.token, 'regMotorUser0001');
    const preview = await request(app).post('/api/push/preview').set('Authorization', 'Bearer test-admin-key-123').send({
      targeting: { mode: 'category', categories: ['nature'] },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.registrationIds).toEqual(['regNatureUser0001']);
    const tag = await request(app).post('/api/push/preview').set('Authorization', 'Bearer test-admin-key-123').send({
      targeting: { mode: 'tag', categories: ['nature'], acknowledgeTagScope: true },
    });
    expect(tag.status).toBe(422);
    expect(tag.body.error.code).toBe('TARGET_EMPTY');
  });
});
