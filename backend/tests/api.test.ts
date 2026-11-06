import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { mediaDirectory } from '../src/app.js';
import { loadConfig } from '../src/config/env.js';
import { basicAuthHeader } from '../src/integrations/engagelabClient.js';
import { buildPushBody, buildSingleScheduleBody } from '../src/integrations/pushPayload.js';
import { assignVariant } from '../src/services/audience.js';
import { wallTimeToUtc } from '../src/services/time.js';
import { ADMIN, admin, buildApp, demoConfig, liveConfig, registerDevice } from './helpers.js';

const open: Array<{ close: () => void }> = [];

afterEach(() => {
  while (open.length) open.pop()?.close();
});

function useApp(config = demoConfig(), fetchImpl?: typeof fetch) {
  const created = buildApp(config, fetchImpl);
  open.push(created.sqlite);
  return created;
}

describe('configuration', () => {
  it('rejects partial EngageLab credentials', () => {
    expect(() => demoConfig({ ENGAGELAB_APPKEY: 'aaaaaaaaaaaaaaaaaaaaaaaa' })).toThrow(/Incomplete EngageLab/);
  });

  it('rejects a short admin key', () => {
    expect(() => loadConfig({ ADMIN_API_KEY: 'short', DEMO_MODE: 'auto' })).toThrow(/ADMIN_API_KEY/);
  });

  it('stays in demo mode when credentials are absent', () => {
    expect(demoConfig().mode).toBe('demo');
    expect(demoConfig().engagelab.configured).toBe(false);
  });

  it('uses live mode when the AppKey, Master Secret, and base URL are all set', () => {
    const config = liveConfig();
    expect(config.mode).toBe('live');
    expect(config.engagelab.knownDataCenter).toBe(true);
  });

  it('refuses demo mode when DEMO_MODE=false and credentials are missing', () => {
    expect(() => demoConfig({ DEMO_MODE: 'false' })).toThrow(/DEMO_MODE=false/);
  });
});

describe('videos, devices, and auth', () => {
  it('seeds videos and rejects a duplicate id', async () => {
    const { app } = useApp();
    const list = await request(app).get('/api/videos');
    expect(list.status).toBe(200);
    expect(list.body.videos.map((video: { id: string }) => video.id)).toEqual(['1001', '1002', '1003']);

    const created = await admin(app).post('/api/videos').send({
      id: '1001',
      title: 'Duplicate',
      description: 'Should fail',
      category: 'tech',
      sourceType: 'remote',
      source: 'https://example.com/video.mp4',
    });
    expect(created.status).toBe(409);
    expect(created.body.error.code).toBe('DUPLICATE_VIDEO_ID');
  });

  it('stores a video chosen from the operator computer', async () => {
    const { app, config } = useApp();
    const bytes = Buffer.from('sample-video-bytes');
    const uploaded = await admin(app)
      .post('/api/videos/upload')
      .query({ name: 'clip.mp4' })
      .set('Content-Type', 'video/mp4')
      .send(bytes);
    expect(uploaded.status).toBe(201);
    expect(uploaded.body.source).toMatch(/^\/media\/[a-z0-9]{16}\.mp4$/);
    const stored = path.join(mediaDirectory(config.databaseUrl), uploaded.body.filename as string);
    expect(fs.readFileSync(stored).equals(bytes)).toBe(true);

    const fetched = await request(app).get(uploaded.body.source);
    expect(fetched.status).toBe(200);
    expect(Buffer.from(fetched.body).equals(bytes)).toBe(true);

    const created = await admin(app).post('/api/videos').send({
      title: 'Chosen clip',
      description: 'Selected from the operator computer.',
      category: 'tech',
      sourceType: 'remote',
      source: uploaded.body.source,
    });
    expect(created.status).toBe(201);
    expect(created.body.video.source).toBe(uploaded.body.source);

    const rejected = await admin(app).post('/api/videos/upload').query({ name: 'notes.txt' }).set('Content-Type', 'text/plain').send(bytes);
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe('UNSUPPORTED_VIDEO');
    const unsigned = await request(app).post('/api/videos/upload').query({ name: 'clip.mp4' }).set('Content-Type', 'video/mp4').send(bytes);
    expect(unsigned.status).toBe(401);
    fs.unlinkSync(stored);
  });

  it('updates and deactivates a video that is referenced by a campaign', async () => {
    const { app } = useApp();
    const updated = await admin(app).put('/api/videos/1001').send({
      title: 'Signal Path revised',
      description: 'Updated description for the technology sample.',
      category: 'tech',
      sourceType: 'remote',
      source: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
      active: true,
    });
    expect(updated.status).toBe(200);
    await registerDevice(app, 'regAndroid1001');
    const campaign = await admin(app).post('/api/campaigns').send({
      name: 'Keep video',
      videoId: '1001',
      title: 'Watch',
      message: 'Open the technology clip',
      targeting: { mode: 'registration_id', registrationId: 'regAndroid1001' },
    });
    expect(campaign.status).toBe(201);
    const removed = await admin(app).delete('/api/videos/1001');
    expect(removed.body.deactivated).toBe(true);
  });

  it('registers a device once and updates categories on the same Registration ID', async () => {
    const { app } = useApp();
    const first = await registerDevice(app, 'regDevice0001', ['tech']);
    expect(first.status).toBe(201);
    expect(first.body.created).toBe(true);
    expect(first.body.device.tagSyncStatus).toBe('skipped');
    expect(first.body.note).toMatch(/does not mean EngageLab issued/i);

    const second = await registerDevice(app, 'regDevice0001', ['funny', 'lifestyle']);
    expect(second.body.created).toBe(false);
    expect(second.body.device.categories).toEqual(['funny', 'lifestyle']);
    expect(second.body.deviceToken).toBe(first.body.deviceToken);

    const missing = await request(app).get('/api/devices');
    expect(missing.status).toBe(401);
    const list = await admin(app).get('/api/devices');
    expect(list.status).toBe(200);
    expect(list.body.devices).toHaveLength(1);
  });

  it('stores a phone and a tablet separately and updates the same installation', async () => {
    const { app } = useApp();
    const phone = await request(app).post('/api/devices/register').send({
      registration_id: 'regPhone00001',
      platform: 'android',
      device_type: 'phone',
      device_id: 'install-phone-0001',
    });
    expect(phone.status).toBe(201);
    expect(phone.body.created).toBe(true);
    expect(phone.body.device.deviceType).toBe('phone');
    expect(phone.body.device.installationId).toBe('install-phone-0001');
    expect(phone.body.device.registrationId).toBe('regPhone00001');

    const tablet = await request(app).post('/api/devices/register').send({
      registrationId: 'regTablet0001',
      platform: 'android',
      deviceType: 'tablet',
      installationId: 'install-tablet-001',
      categories: ['tech'],
    });
    expect(tablet.status).toBe(201);
    expect(tablet.body.device.id).not.toBe(phone.body.device.id);

    const again = await request(app).post('/api/devices/register').send({
      registration_id: 'regPhone00002',
      platform: 'android',
      device_type: 'phone',
      device_id: 'install-phone-0001',
    });
    expect(again.status).toBe(201);
    expect(again.body.created).toBe(false);
    expect(again.body.device.id).toBe(phone.body.device.id);
    expect(again.body.device.registrationId).toBe('regPhone00002');
    expect(again.body.deviceToken).toBe(phone.body.deviceToken);

    const empty = await request(app).post('/api/devices/register').send({
      registration_id: '',
      platform: 'android',
      device_type: 'emulator',
      device_id: 'install-empty-0001',
    });
    expect(empty.status).toBe(400);
    const stored = await admin(app).get('/api/devices');
    expect(stored.body.devices).toHaveLength(2);
  });

  it('rejects a push to a Registration ID that was never stored', async () => {
    const { app } = useApp();
    const draft = await admin(app).post('/api/campaigns').send({
      name: 'Missing target',
      videoId: '1001',
      title: 'Hello',
      message: 'This must not be broadcast.',
      targeting: { mode: 'registration_id', registrationId: 'regNotStored01' },
      delivery: 'immediate',
    });
    expect(draft.status).toBe(400);
    expect(draft.body.error.message).toMatch(/Cannot find sending target|not stored/i);
  });

  it('rejects malformed JSON and unauthenticated admin calls', async () => {
    const { app } = useApp();
    const malformed = await request(app)
      .post('/api/devices/register')
      .set('Content-Type', 'application/json')
      .send('{"registrationId":');
    expect(malformed.status).toBe(400);
    const denied = await request(app).post('/api/campaigns').send({});
    expect(denied.status).toBe(401);
  });
});

describe('campaigns and scheduling', () => {
  it('rejects an unknown video and an empty category audience', async () => {
    const { app } = useApp();
    const missingVideo = await admin(app).post('/api/campaigns').send({
      name: 'Missing',
      videoId: '9999',
      title: 'Nope',
      message: 'No video',
      targeting: { mode: 'broadcast', confirmBroadcast: true },
      delivery: 'immediate',
    });
    expect(missingVideo.status).toBe(404);

    const empty = await admin(app).post('/api/campaigns').send({
      name: 'Nobody',
      videoId: '1001',
      title: 'Hi',
      message: 'No devices',
      targeting: { mode: 'category', categories: ['tech'] },
      delivery: 'immediate',
    });
    expect(empty.status).toBe(422);
    expect(empty.body.error.code).toBe('TARGET_EMPTY');
  });

  it('requires explicit broadcast confirmation and does not call EngageLab in demo mode', async () => {
    const calls: string[] = [];
    const { app } = useApp(demoConfig(), async (input) => {
      calls.push(String(input));
      return new Response('{}', { status: 200 });
    });
    await registerDevice(app, 'regBroadcast01', ['tech']);
    const unconfirmed = await admin(app).post('/api/campaigns').send({
      name: 'Everyone',
      videoId: '1002',
      title: 'Hello',
      message: 'This should not send',
      targeting: { mode: 'broadcast' },
      delivery: 'immediate',
    });
    expect(unconfirmed.status).toBe(400);
    expect(unconfirmed.body.error.code).toBe('BROADCAST_CONFIRMATION_REQUIRED');

    const simulated = await admin(app).post('/api/campaigns').send({
      name: 'Everyone confirmed',
      videoId: '1002',
      title: 'Hello',
      message: 'Simulated broadcast',
      targeting: { mode: 'broadcast', confirmBroadcast: true },
      delivery: 'immediate',
    });
    expect(simulated.status).toBe(201);
    expect(simulated.body.simulated).toBe(true);
    expect(simulated.body.campaign.status).toBe('simulated');
    expect(simulated.body.campaign.status).not.toBe('accepted_by_provider');
    expect(calls).toHaveLength(0);
  });

  it('targets only stored devices in the selected categories', async () => {
    const seen: unknown[] = [];
    const { app } = useApp(liveConfig(), async (_input, init) => {
      if (init?.body) seen.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ msg_id: '555', request_id: 'req-1' }), { status: 200 });
    });
    await registerDevice(app, 'regTechDevice1', ['tech']);
    await registerDevice(app, 'regFunDevice01', ['funny']);
    const response = await admin(app).post('/api/campaigns').send({
      name: 'Tech only',
      videoId: '1001',
      title: 'New technology clip',
      message: 'Open the recommended video',
      targeting: { mode: 'category', categories: ['tech'] },
      delivery: 'immediate',
    });
    expect(response.status).toBe(201);
    expect(response.body.campaign.status).toBe('accepted_by_provider');
    expect(response.body.campaign.resolvedRegistrationIds).toEqual(['regTechDevice1']);
    const body = seen.find((item) => (item as { from?: string }).from === 'push') as { to: { registration_id: string[] }; body: { notification: { android: { extras: { video_id: string } } } } };
    expect(body.to.registration_id).toEqual(['regTechDevice1']);
    expect(body.body.notification.android.extras.video_id).toBe('1001');
  });

  it('rejects a scheduled time in the past and submits a future schedule', async () => {
    const seen: unknown[] = [];
    const { app } = useApp(liveConfig(), async (_input, init) => {
      if (init?.body) seen.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ schedule_id: 'sched-1', name: 'ok' }), { status: 200 });
    });
    await registerDevice(app, 'regSchedule001');
    const past = await admin(app).post('/api/campaigns').send({
      name: 'Too soon',
      videoId: '1003',
      title: 'Later',
      message: 'This time has passed',
      targeting: { mode: 'registration_id', registrationId: 'regSchedule001' },
      delivery: 'scheduled',
      scheduleTime: '2020-01-01 00:00:00',
      timeZone: 'Asia/Singapore',
      zoneType: 1,
    });
    expect(past.status).toBe(400);

    const future = await admin(app).post('/api/campaigns').send({
      name: 'Tomorrow clip',
      videoId: '1003',
      title: 'Scheduled',
      message: 'Your video is ready',
      targeting: { mode: 'registration_id', registrationId: 'regSchedule001' },
      delivery: 'scheduled',
      scheduleTime: '2030-01-15 09:30:00',
      timeZone: 'Asia/Singapore',
      zoneType: 1,
    });
    expect(future.status).toBe(201);
    expect(future.body.campaign.status).toBe('scheduled');
    expect(future.body.campaign.providerScheduleId).toBe('sched-1');
    const payload = seen.find((item) => (item as { trigger?: unknown }).trigger) as { enabled: boolean; trigger: { single: { time: string; zone_type: number } }; push: { from: string } };
    expect(payload.enabled).toBe(true);
    expect(payload.trigger.single).toEqual({ time: '2030-01-15 09:30:00', zone_type: 1 });
    expect(payload.push.from).toBe('push');
  });
});

describe('events, analytics, and experiments', () => {
  it('deduplicates device events and aggregates them without inventing delivery', async () => {
    const { app } = useApp();
    const registered = await registerDevice(app, 'regEvents0001', ['lifestyle']);
    const token = registered.body.deviceToken as string;
    const campaign = await admin(app).post('/api/campaigns').send({
      name: 'Play',
      videoId: '1003',
      title: 'Watch',
      message: 'Lifestyle clip',
      targeting: { mode: 'registration_id', registrationId: 'regEvents0001' },
    });
    const campaignId = campaign.body.campaign.id as string;
    const payload = {
      eventType: 'notification_opened',
      registrationId: 'regEvents0001',
      campaignId,
      videoId: '1003',
      dedupeKey: `open:${campaignId}`,
    };
    const first = await request(app).post('/api/events').set('Authorization', `Device ${token}`).send(payload);
    const second = await request(app).post('/api/events').set('Authorization', `Device ${token}`).send(payload);
    expect(first.status).toBe(201);
    expect(second.body.duplicate).toBe(true);

    const overview = await admin(app).get('/api/analytics/overview');
    expect(overview.body.events.notificationOpened).toBe(1);
    expect(overview.body.provider.deliveryMetricsAvailable).toBe(false);
    expect(overview.body.sources.providerDelivery).toMatch(/Unavailable/);
  });

  it('keeps a device in one experiment variant', async () => {
    const { app } = useApp();
    const ids = Array.from({ length: 12 }, (_, index) => `regSplit${String(index + 1).padStart(6, '0')}`);
    for (const id of ids) await registerDevice(app, id, ['tech', 'funny']);
    const created = await admin(app).post('/api/experiments').send({
      name: 'Title test',
      videoId: '1001',
      variantA: { title: 'Title A', message: 'Message A' },
      variantB: { title: 'Title B', message: 'Message B' },
      targeting: { mode: 'registration_ids', registrationIds: ids },
      allocationA: 50,
      durationHours: 24,
      primaryMetric: 'notification_opened',
    });
    expect(created.status).toBe(201);
    const started = await admin(app).post(`/api/experiments/${created.body.experiment.id}/start`).send({});
    expect(started.status).toBe(200);
    const assignments = started.body.results.experiment ? started.body.results : started.body.results;
    const variants = started.body.results.variants as { A: { sampleSize: number }; B: { sampleSize: number } };
    expect(variants.A.sampleSize + variants.B.sampleSize).toBe(12);
    expect(variants.A.sampleSize).toBeGreaterThan(0);
    expect(variants.B.sampleSize).toBeGreaterThan(0);
    expect(started.body.results.statistics.preliminary).toBe(true);
    expect(started.body.results.statistics.significant).toBeNull();
    expect(assignments).toBeTruthy();

    const again = assignVariant(created.body.experiment.id, ids[0], 50);
    expect(again).toBe(assignVariant(created.body.experiment.id, ids[0], 50));
  });

  it('attributes opens from the stored assignment and ignores client experiment fields', async () => {
    const { app } = useApp();
    const ids = Array.from({ length: 12 }, (_, index) => `regAttr${String(index + 1).padStart(6, '0')}`);
    const tokens = new Map<string, string>();
    for (const id of ids) {
      const registered = await registerDevice(app, id, ['tech']);
      tokens.set(id, registered.body.deviceToken as string);
    }
    const created = await admin(app).post('/api/experiments').send({
      name: 'Attribution',
      videoId: '1001',
      variantA: { title: 'A', message: 'Message A' },
      variantB: { title: 'B', message: 'Message B' },
      targeting: { mode: 'registration_ids', registrationIds: ids },
      allocationA: 50,
      durationHours: 24,
      primaryMetric: 'notification_opened',
    });
    const started = await admin(app).post(`/api/experiments/${created.body.experiment.id}/start`).send({});
    expect(started.status).toBe(200);
    const experiment = started.body.experiment as { id: string; campaignAId: string; campaignBId: string };
    const variantOf = (registrationId: string) => assignVariant(experiment.id, registrationId, 50);
    const campaignFor = (registrationId: string) => variantOf(registrationId) === 'A' ? experiment.campaignAId : experiment.campaignBId;
    const firstId = ids.find((id) => variantOf(id) === 'A');
    const secondId = ids.find((id) => variantOf(id) === 'B');
    expect(firstId).toBeTruthy();
    expect(secondId).toBeTruthy();

    async function open(registrationId: string, campaignId: string, dedupeKey: string, extra: Record<string, string> = {}) {
      return request(app).post('/api/events').set('Authorization', `Device ${tokens.get(registrationId)}`).send({
        eventType: 'notification_opened',
        registrationId,
        campaignId,
        videoId: '1001',
        dedupeKey,
        experimentId: '00000000-0000-0000-0000-000000000099',
        variant: variantOf(registrationId) === 'A' ? 'B' : 'A',
        ...extra,
      });
    }

    const first = await open(firstId!, campaignFor(firstId!), 'attr-first');
    expect(first.status).toBe(201);
    expect(first.body.event.experimentId).toBe(experiment.id);
    expect(first.body.event.variant).toBe(variantOf(firstId));
    const duplicate = await open(firstId, campaignFor(firstId), 'attr-first');
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.event.variant).toBe(variantOf(firstId));

    const second = await open(secondId, campaignFor(secondId), 'attr-second');
    expect(second.body.event.variant).toBe(variantOf(secondId));

    const wrongDevice = await open(secondId, campaignFor(firstId), 'attr-wrong-device');
    expect(wrongDevice.status).toBe(201);
    expect(wrongDevice.body.event.experimentId).toBeNull();
    expect(wrongDevice.body.event.variant).toBeNull();

    const wrongVideo = await request(app).post('/api/events').set('Authorization', `Device ${tokens.get(firstId)}`).send({
      eventType: 'video_play_started',
      registrationId: firstId,
      campaignId: campaignFor(firstId),
      videoId: '1002',
      dedupeKey: 'attr-wrong-video',
    });
    expect(wrongVideo.body.event.experimentId).toBeNull();

    const ordinary = await admin(app).post('/api/campaigns').send({
      name: 'Ordinary',
      videoId: '1001',
      title: 'Plain',
      message: 'Not an experiment',
      targeting: { mode: 'registration_id', registrationId: firstId },
    });
    const plain = await request(app).post('/api/events').set('Authorization', `Device ${tokens.get(firstId)}`).send({
      eventType: 'notification_opened',
      registrationId: firstId,
      campaignId: ordinary.body.campaign.id,
      videoId: '1001',
      dedupeKey: 'attr-plain',
      experimentId: experiment.id,
      variant: 'A',
    });
    expect(plain.body.event.experimentId).toBeNull();
    expect(plain.body.event.variant).toBeNull();

    const results = await admin(app).get(`/api/experiments/${experiment.id}`);
    const counted = results.body.results.variants as { A: { successes: number }; B: { successes: number } };
    expect(counted[variantOf(firstId)].successes).toBe(1);
    expect(counted[variantOf(secondId)].successes).toBe(1);
  });
});

describe('EngageLab request construction and failures', () => {
  it('builds Basic auth and the v4 push body without logging the secret', () => {
    const header = basicAuthHeader('appkeyappkeyappkeyappkey', 'secretsecretsecretsecret');
    expect(header.startsWith('Basic ')).toBe(true);
    expect(header).not.toContain('secretsecretsecretsecret');
    const body = buildPushBody({
      title: 'Title',
      alert: 'Alert',
      videoId: '1001',
      campaignId: '11111111-1111-1111-1111-111111111111',
      category: 'tech',
      requestId: '123',
      packageName: 'com.example.engagevideopush',
      registrationIds: ['regAndroid1001'],
    });
    expect(body.from).toBe('push');
    expect((body.to as { registration_id: string[] }).registration_id).toEqual(['regAndroid1001']);
    const android = (body.body as { notification: { android: { extras: Record<string, string>; intent: { url: string } } } }).notification.android;
    expect(android.extras).toEqual({
      video_id: '1001',
      campaign_id: '11111111-1111-1111-1111-111111111111',
      category: 'tech',
    });
    expect(android.intent.url).toContain('component=com.example.engagevideopush/com.example.engagevideopush.MainActivity');
    const schedule = buildSingleScheduleBody({ name: 'task', time: '2030-01-01 00:00:00', zoneType: 1, push: body });
    expect(schedule.enabled).toBe(true);
    expect(JSON.stringify(body)).toBe(JSON.stringify({
      from: 'push',
      to: { registration_id: ['regAndroid1001'] },
      body: {
        platform: 'android',
        notification: {
          alert: 'Alert',
          android: {
            alert: 'Alert',
            title: 'Title',
            channel_id: 'engage_video_push',
            extras: {
              video_id: '1001',
              campaign_id: '11111111-1111-1111-1111-111111111111',
              category: 'tech',
            },
            intent: { url: android.intent.url },
          },
        },
        options: { time_to_live: 86400 },
      },
      request_id: '123',
      custom_args: { campaign_id: '11111111-1111-1111-1111-111111111111' },
    }));
    expect(JSON.stringify(body.custom_args).length).toBeLessThanOrEqual(128);
    const oversized = buildPushBody({
      title: 'Title',
      alert: 'Alert',
      videoId: '1001',
      campaignId: 'c'.repeat(120),
      category: 'tech',
      requestId: '123',
      packageName: 'com.example.engagevideopush',
      registrationIds: ['regAndroid1001'],
    });
    expect(oversized.custom_args).toBeUndefined();
    expect(() => buildPushBody({
      title: 'Title',
      alert: 'Alert',
      videoId: '1001',
      campaignId: '11111111-1111-1111-1111-111111111111',
      category: 'tech',
      requestId: '123',
      packageName: 'com.example.engagevideopush',
    })).toThrow(/empty/);
  });

  it('classifies authentication failure, validation failure, and timeout', async () => {
    const authApp = useApp(liveConfig(), async () => new Response(JSON.stringify({ error: { code: 21003, message: 'auth failed' } }), { status: 401 }));
    await registerDevice(authApp.app, 'regAuthFail001');
    const auth = await admin(authApp.app).post('/api/campaigns').send({
      name: 'Auth',
      videoId: '1001',
      title: 'T',
      message: 'M',
      targeting: { mode: 'registration_id', registrationId: 'regAuthFail001' },
      delivery: 'immediate',
    });
    expect(auth.status).toBe(502);
    expect(auth.body.error.details.kind).toBe('authentication');
    expect(JSON.stringify(auth.body)).not.toContain('bbbbbbbbbbbbbbbbbbbbbbbb');

    const validationApp = useApp(liveConfig(), async () => new Response(JSON.stringify({ error: { code: 21016, message: 'bad payload' } }), { status: 400 }));
    await registerDevice(validationApp.app, 'regValidFail01');
    const validation = await admin(validationApp.app).post('/api/campaigns').send({
      name: 'Bad',
      videoId: '1001',
      title: 'T',
      message: 'M',
      targeting: { mode: 'registration_id', registrationId: 'regValidFail01' },
      delivery: 'immediate',
    });
    expect(validation.body.error.details.kind).toBe('validation');

    const timeoutApp = useApp(liveConfig(), async () => {
      const error = new Error('timed out');
      error.name = 'TimeoutError';
      throw error;
    });
    await registerDevice(timeoutApp.app, 'regTimeout0001');
    const timeout = await admin(timeoutApp.app).post('/api/campaigns').send({
      name: 'Slow',
      videoId: '1001',
      title: 'T',
      message: 'M',
      targeting: { mode: 'registration_id', registrationId: 'regTimeout0001' },
      delivery: 'immediate',
    });
    expect(timeout.body.error.details.kind).toBe('timeout');
    expect(timeout.body.error.details.campaign.status).toBe('failed');
  });

  it('sends the tag audience only after a confirmed tag sync', async () => {
    const calls: Array<{ url: string; body?: unknown; auth?: string }> = [];
    const { app } = useApp(liveConfig(), async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, body, auth: (init?.headers as Record<string, string>).Authorization });
      if (url.endsWith('/v4/push')) return new Response(JSON.stringify({ msg_id: '77', request_id: '9' }), { status: 200 });
      if (url.includes('/v4/devices/')) return new Response(JSON.stringify({ tags: ['tech'], alias: null }), { status: 200 });
      return new Response('success', { status: 200 });
    });
    await registerDevice(app, 'regTagDevice01', ['tech']);
    const response = await admin(app).post('/api/campaigns').send({
      name: 'Tag tech',
      videoId: '1001',
      title: 'Tagged',
      message: 'For tech devices',
      targeting: { mode: 'tag', categories: ['tech'], acknowledgeTagScope: true },
      delivery: 'immediate',
    });
    expect(response.status).toBe(201);
    const push = calls.find((call) => call.url.endsWith('/v4/push'));
    expect(push?.body).toMatchObject({ to: { tag: ['tech'] } });
    expect(push?.auth?.startsWith('Basic ')).toBe(true);
    expect(calls.some((call) => call.url.includes('/v4/devices/'))).toBe(true);
  });

  it('does not mark a tag sync successful when the device read is missing the tag', async () => {
    const calls: string[] = [];
    const { app } = useApp(liveConfig(), async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${url}`);
      if (url.includes('/v4/devices/') && method === 'GET') {
        return new Response(JSON.stringify({ tags: [], alias: null }), { status: 200 });
      }
      if (url.includes('/v4/devices/') || url.includes('/v4/tags/')) return new Response('success', { status: 200 });
      if (url.endsWith('/v4/push')) return new Response(JSON.stringify({ msg_id: 'should-not-send', request_id: '1' }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const registered = await registerDevice(app, 'regTagUnknown1', ['tech']);
    expect(registered.body.device.tagSyncStatus).toBe('unknown');
    const response = await admin(app).post('/api/campaigns').send({
      name: 'Tag before sync',
      videoId: '1001',
      title: 'Tagged',
      message: 'Should not send',
      targeting: { mode: 'tag', categories: ['tech'], acknowledgeTagScope: true },
      delivery: 'immediate',
    });
    expect(response.status).toBe(502);
    expect(response.body.error.details.campaign.status).toBe('failed');
    expect(calls.some((call) => call.includes('/v4/push'))).toBe(false);
  });

  it('records a provider error and an unexpected success body as failure', async () => {
    const errorApp = useApp(liveConfig(), async (input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      if (url.includes('/v4/devices/') && method === 'POST') {
        return new Response(JSON.stringify({ error: { code: 5000, message: 'tag write failed' } }), { status: 500 });
      }
      if (url.includes('/v4/devices/')) return new Response(JSON.stringify({ tags: ['tech'], alias: null }), { status: 200 });
      return new Response(JSON.stringify({ request_id: '9' }), { status: 200 });
    });
    const registered = await registerDevice(errorApp.app, 'regTagFail0001', ['tech']);
    expect(registered.body.device.tagSyncStatus).toBe('failed');
    const push = await admin(errorApp.app).post('/api/campaigns').send({
      name: 'No message id',
      videoId: '1001',
      title: 'T',
      message: 'M',
      targeting: { mode: 'registration_id', registrationId: 'regTagFail0001' },
      delivery: 'immediate',
    });
    expect(push.status).toBe(502);
    expect(push.body.error.details.campaign.status).toBe('failed');
    expect(push.body.error.details.campaign.status).not.toBe('accepted_by_provider');

    const scheduleApp = useApp(liveConfig(), async (input) => {
      const url = String(input);
      if (url.endsWith('/v4/schedules')) return new Response(JSON.stringify({ name: 'task-only' }), { status: 200 });
      if (url.includes('/v4/devices/')) return new Response(JSON.stringify({ tags: ['tech'], alias: null }), { status: 200 });
      return new Response('success', { status: 200 });
    });
    await registerDevice(scheduleApp.app, 'regSchedNoId01');
    const schedule = await admin(scheduleApp.app).post('/api/campaigns').send({
      name: 'Missing schedule id',
      videoId: '1001',
      title: 'Later',
      message: 'Not accepted',
      targeting: { mode: 'registration_id', registrationId: 'regSchedNoId01' },
      delivery: 'scheduled',
      scheduleTime: '2030-01-15 09:30:00',
      timeZone: 'Asia/Singapore',
      zoneType: 1,
    });
    expect(schedule.status).toBe(502);
    expect(schedule.body.error.details.campaign.status).toBe('failed');
    expect(schedule.body.error.details.campaign.providerScheduleId).toBeNull();
  });
});

describe('time', () => {
  it('converts a Singapore wall-clock time to UTC', () => {
    expect(wallTimeToUtc('2026-11-02 16:00:00', 'Asia/Singapore').toISOString()).toBe('2026-11-02T08:00:00.000Z');
  });
});

describe('admin key is required', () => {
  it('does not accept the admin key from a query string', async () => {
    const { app } = useApp();
    const response = await request(app).get(`/api/analytics/overview?apiKey=${ADMIN}`);
    expect(response.status).toBe(401);
  });
});
