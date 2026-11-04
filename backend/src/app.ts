import cors from 'cors';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AppConfig } from './config/env.js';
import { migrate, seedVideos, Sqlite } from './db/database.js';
import { EngageLabClient } from './integrations/engagelabClient.js';
import { PixabayCatalog } from './integrations/pixabay.js';
import { logger } from './logger.js';
import { adminAuth, readDeviceToken, type AuthedRequest } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import type { Device } from './domain.js';
import { Store } from './repositories/store.js';
import { AnalyticsService } from './services/analyticsService.js';
import { resolveDeviceExperiment } from './services/attribution.js';
import { CampaignService } from './services/campaignService.js';
import { DeviceService } from './services/deviceService.js';
import { EventService } from './services/eventService.js';
import { ExperimentService } from './services/experimentService.js';
import { AuthService } from './services/authService.js';
import { createMailer, type Mailer } from './services/mailer.js';
import { VideoService } from './services/videoService.js';
import { HttpError } from './errors.js';
import { HttpAiClient, type AiClient } from './services/aiClient.js';
import { PersonalStore } from './repositories/personalStore.js';
import { attachPersonalRoutes } from './routes/personal.js';
import {
  campaignSchema,
  eventSchema,
  experimentSchema,
  detachDeviceSchema,
  otpRequestSchema,
  otpVerifySchema,
  profileSchema,
  preferencesSchema,
  pushPreviewSchema,
  registerDeviceSchema,
  scheduleSchema,
  sendSchema,
  testPushSchema,
  videoPreferencesSchema,
  videoSchema,
} from './validators/schemas.js';

export interface AppOptions {
  config: AppConfig;
  sqlite?: Sqlite;
  fetchImpl?: typeof fetch;
  mailer?: Mailer;
  ai?: AiClient;
}

export function createApp(options: AppOptions) {
  const sqlite = options.sqlite ?? Sqlite.open(options.config.databaseUrl);
  migrate(sqlite);
  seedVideos(sqlite);
  const store = new Store(sqlite);
  const client = new EngageLabClient(options.config.engagelab, options.fetchImpl ?? fetch, logger);
  const pixabay = new PixabayCatalog(options.config.pixabayApiKey, options.fetchImpl ?? fetch);
  const videos = new VideoService(store, pixabay);
  const events = new EventService(store);
  const devices = new DeviceService(store, client, options.config, events);
  const campaigns = new CampaignService(store, videos, devices, events, client, options.config);
  const experiments = new ExperimentService(store, videos, campaigns);
  const analytics = new AnalyticsService(store, experiments, options.config);
  const auth = new AuthService(store, options.mailer ?? createMailer(options.config, logger), options.config.sessionPepper);
  const requireAdmin = adminAuth(options.config);

  function bearerToken(req: AuthedRequest): string {
    const header = req.header('authorization') ?? '';
    return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  }

  function publicUser(user: { id: string; normalizedEmail: string; displayName: string | null; createdAt: string; lastLoginAt: string | null; accountStatus: string }) {
    return {
      id: user.id,
      email: user.normalizedEmail,
      displayName: user.displayName,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      accountStatus: user.accountStatus,
    };
  }

  function requireUser(req: AuthedRequest) {
    const token = bearerToken(req);
    if (!token || token === options.config.adminApiKey) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Sign in again.');
    }
    return auth.userForToken(token);
  }

  function optionalUser(req: AuthedRequest) {
    const token = bearerToken(req);
    if (!token || token === options.config.adminApiKey) return null;
    return auth.userForToken(token);
  }

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: options.config.corsOrigins, allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '1mb' }));
  app.use(readDeviceToken);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, database: 'up', service: 'engagevideopush-backend', port: options.config.port });
  });

  app.post('/api/auth/otp/request', async (req, res, next) => {
    try {
      const body = otpRequestSchema.parse(req.body);
      await auth.requestOtp(body.email, req.ip ?? null);
      res.json({ status: 'accepted', message: 'If the address can receive mail, a verification code is on its way.' });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/otp/verify', (req, res, next) => {
    try {
      const body = otpVerifySchema.parse(req.body);
      const result = auth.verify(body.email, body.code);
      res.json({
        token: result.token,
        expiresAt: result.expiresAt,
        created: result.created,
        user: { id: result.user.id, email: result.user.normalizedEmail, accountStatus: result.user.accountStatus },
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/auth/logout', (req, res, next) => {
    try {
      const token = bearerToken(req);
      if (!token) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in again.');
      auth.logout(token);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me', (req, res, next) => {
    try {
      res.json({ user: publicUser(requireUser(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/me', (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = profileSchema.parse(req.body);
      res.json({ user: publicUser(auth.updateDisplayName(user.id, body.displayName)) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/me/preferences', (req, res, next) => {
    try {
      const user = requireUser(req);
      res.json({ preferences: auth.preferences(user.id) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/me/preferences', (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = videoPreferencesSchema.parse(req.body);
      res.json({ preferences: auth.savePreferences(user.id, body.categories) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/devices/detach', (req, res, next) => {
    try {
      const user = requireUser(req);
      const body = detachDeviceSchema.parse(req.body);
      store.clearDeviceUser(body.installationId, user.id);
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/config/status', (_req, res) => {
    res.json({
      service: 'engagevideopush-backend',
      mode: options.config.mode,
      engagelabConfigured: options.config.engagelab.configured,
      knownDataCenter: options.config.engagelab.knownDataCenter,
      adminAuthRequired: true,
      deliveryMetricsAvailable: false,
      pixabayConfigured: pixabay.configured(),
      port: options.config.port,
      emailMode: options.config.email.mode,
      androidPackageName: options.config.androidPackageName,
      note: options.config.mode === 'demo'
        ? 'Demo mode is active. Provider results are simulated and are not EngageLab deliveries.'
        : 'Live mode is active. Pushes are sent only after an explicit operator action.',
    });
  });

  app.get('/api/openapi.yaml', (_req, res) => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../openapi.yaml');
    const devFile = path.resolve(process.cwd(), 'openapi.yaml');
    const target = fs.existsSync(file) ? file : devFile;
    res.type('text/yaml').send(fs.readFileSync(target, 'utf8'));
  });

  app.get('/api/videos', async (req: AuthedRequest, res, next) => {
    try {
      const query = typeof req.query.query === 'string' ? req.query.query : '';
      if (query.trim()) {
        res.json(await pixabay.search(query, readPage(req.query.page)));
        return;
      }
      const includeInactive = req.admin === true || (req.header('authorization') ?? '').startsWith('Bearer ');
      const all = req.query.all === '1';
      if (all && includeInactive) {
        const header = req.header('authorization') ?? '';
        const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
        if (token !== options.config.adminApiKey) {
          res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Admin authentication is required to list inactive videos.' } });
          return;
        }
      }
      res.json({ videos: videos.list(!(all && includeInactive)) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/videos/popular', async (req, res, next) => {
    try {
      res.json(await pixabay.popular(readPage(req.query.page)));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/videos/:id', async (req, res, next) => {
    try {
      const video = await videos.resolvePlayback(req.params.id);
      res.json({ video });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/videos', requireAdmin, (req, res, next) => {
    try {
      res.status(201).json({ video: videos.create(videoSchema.parse(req.body)) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/videos/:id', requireAdmin, (req, res, next) => {
    try {
      res.json({ video: videos.update(req.params.id, videoSchema.parse(req.body)) });
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/videos/:id', requireAdmin, (req, res, next) => {
    try {
      res.json(videos.remove(req.params.id));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/devices/register', async (req, res, next) => {
    try {
      const body = registerDeviceSchema.parse(req.body);
      const user = optionalUser(req);
      res.status(201).json(await devices.register({
        ...body,
        ...(user ? { userId: user.id } : {}),
        notificationEnabled: body.notificationEnabled,
      }));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/devices', requireAdmin, (_req, res) => {
    res.json({
      devices: devices.list().map((device) => accountView(device, store, options.config)),
    });
  });

  app.get('/api/devices/:id', requireAdmin, (req, res, next) => {
    try {
      const device = devices.get(req.params.id);
      res.json({ device: accountView(device, store, options.config) });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/devices/:id/preferences', async (req: AuthedRequest, res, next) => {
    try {
      const body = preferencesSchema.parse(req.body);
      const admin = (req.header('authorization') ?? '').startsWith('Bearer ')
        && req.header('authorization')?.slice(7).trim() === options.config.adminApiKey;
      if (!admin) devices.requireDeviceToken(req.params.id, req.deviceToken);
      res.json({ device: await devices.updatePreferences(req.params.id, body.categories, admin ? 'admin' : 'device') });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/devices/:id/disassociate', requireAdmin, (req, res, next) => {
    try {
      devices.get(req.params.id);
      store.disassociateDevice(req.params.id);
      res.json({ device: accountView(devices.get(req.params.id), store, options.config) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/devices/:id/sync-tags', requireAdmin, async (req, res, next) => {
    try {
      res.json({ device: await devices.syncTags(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/campaigns', requireAdmin, async (req, res, next) => {
    try {
      const body = campaignSchema.parse(req.body);
      const draft = await campaigns.createDraft(body);
      if (body.delivery === 'draft') {
        res.status(201).json({ campaign: draft });
        return;
      }
      if (body.delivery === 'scheduled') {
        if (!body.scheduleTime || !body.timeZone) {
          throw new HttpError(400, 'SCHEDULE_REQUIRED', 'Scheduled delivery requires scheduleTime and timeZone.');
        }
        const campaign = await campaigns.schedule(draft.id, {
          scheduleTime: body.scheduleTime,
          timeZone: body.timeZone,
          zoneType: body.zoneType ?? 1,
        });
        res.status(201).json({ campaign, simulated: campaign.simulated });
        return;
      }
      const campaign = await campaigns.send(draft.id);
      res.status(201).json({ campaign, simulated: campaign.simulated });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/campaigns', requireAdmin, (_req, res) => {
    res.json({ campaigns: campaigns.list() });
  });

  app.get('/api/campaigns/:id', requireAdmin, async (req, res, next) => {
    try {
      const campaign = req.query.refresh === '1' ? await campaigns.refreshProvider(req.params.id) : campaigns.get(req.params.id);
      res.json({ campaign });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/campaigns/:id/send', requireAdmin, async (req, res, next) => {
    try {
      const body = sendSchema.parse(req.body ?? {});
      const campaign = await campaigns.send(req.params.id, body);
      res.json({ campaign, simulated: campaign.simulated });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/campaigns/:id/schedule', requireAdmin, async (req, res, next) => {
    try {
      const body = scheduleSchema.parse(req.body);
      const campaign = await campaigns.schedule(req.params.id, body, body);
      res.json({ campaign, simulated: campaign.simulated });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/experiments', requireAdmin, (req, res, next) => {
    try {
      res.status(201).json({ experiment: experiments.create(experimentSchema.parse(req.body)) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/experiments', requireAdmin, (_req, res) => {
    res.json({ experiments: experiments.list() });
  });

  app.get('/api/experiments/:id', requireAdmin, (req, res, next) => {
    try {
      res.json({ experiment: experiments.get(req.params.id), results: analytics.experimentResult(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/experiments/:id/start', requireAdmin, async (req, res, next) => {
    try {
      const experiment = await experiments.start(req.params.id);
      res.json({ experiment, results: analytics.experimentResult(experiment.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/events', (req: AuthedRequest, res, next) => {
    try {
      const body = eventSchema.parse(req.body);
      if (!req.deviceToken) {
        throw new HttpError(401, 'UNAUTHORIZED', 'Events require Authorization: Device <deviceToken> from device registration.');
      }
      const device = devices.requireDeviceToken(body.registrationId ?? '', req.deviceToken);
      if (body.registrationId && body.registrationId !== device.registrationId && body.registrationId !== device.id) {
        throw new HttpError(403, 'DEVICE_MISMATCH', 'The device token does not match the registrationId.');
      }
      const attribution = resolveDeviceExperiment(store, {
        registrationId: device.registrationId,
        campaignId: body.campaignId,
        videoId: body.videoId,
      });
      const event = events.record({
        ...body,
        registrationId: device.registrationId,
        userId: device.userId,
        experimentId: attribution.experimentId,
        variant: attribution.variant,
        source: 'device',
      });
      res.status(event.duplicate ? 200 : 201).json({ event, duplicate: Boolean(event.duplicate) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/analytics/overview', requireAdmin, (_req, res) => res.json(analytics.overview()));
  app.get('/api/analytics/campaigns', requireAdmin, (_req, res) => res.json({ campaigns: analytics.campaigns() }));
  app.get('/api/analytics/videos', requireAdmin, (_req, res) => res.json({ videos: analytics.videos() }));
  app.get('/api/analytics/experiments', requireAdmin, (_req, res) => res.json({ experiments: analytics.experiments() }));

  app.get('/api/engagelab/status', requireAdmin, async (_req, res, next) => {
    try {
      if (!options.config.engagelab.configured) {
        res.json({
          configured: false,
          mode: 'demo',
          connected: false,
          deliveryMetricsAvailable: false,
          message: 'Credentials are missing. The provider is not connected. Demo results must not be read as deliveries.',
        });
        return;
      }
      const tags = await client.listTags();
      res.json({
        configured: true,
        mode: 'live',
        connected: true,
        baseUrlHost: new URL(options.config.engagelab.baseUrl).host,
        knownDataCenter: options.config.engagelab.knownDataCenter,
        appKeyHint: `${options.config.engagelab.appKey.slice(0, 4)}…${options.config.engagelab.appKey.slice(-4)}`,
        deliveryMetricsAvailable: false,
        tagProbe: tags,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/push/preview', requireAdmin, (req, res, next) => {
    try {
      const body = pushPreviewSchema.parse(req.body);
      const target = campaigns.describeTarget(body.targeting);
      res.json({ ...target, videoId: body.videoId ?? null, willSend: target.missing.length === 0 });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/engagelab/test-push', requireAdmin, async (req, res, next) => {
    try {
      const body = testPushSchema.parse(req.body);
      const videoId = body.videoId ?? '1001';
      const draft = await campaigns.createDraft({
        name: 'Operator test push',
        videoId,
        title: 'EngageVideoPush test',
        message: 'This is an explicit operator test notification.',
        targeting: { mode: 'registration_id', registrationId: body.registrationId },
      });
      const campaign = await campaigns.send(draft.id);
      res.status(campaign.simulated ? 200 : 201).json({
        campaign,
        simulated: campaign.simulated,
        message: campaign.simulated
          ? 'Simulated test. No EngageLab request was made.'
          : 'EngageLab accepted the test push request. Device delivery is a separate step.',
      });
    } catch (error) {
      next(error);
    }
  });

  const personal = new PersonalStore(sqlite);
  const ai = options.ai ?? new HttpAiClient(options.config.aiServiceUrl, options.config.aiTimeoutMs, options.fetchImpl ?? fetch);
  attachPersonalRoutes(app, {
    store, personal, requireUser, optionalUser, requireAdmin, ai, pixabay, videos, campaigns, config: options.config,
  });

  app.use(notFound);
  app.use(errorHandler);
  return { app, sqlite, store, client };
}

function readPage(value: unknown): number {
  if (value === undefined || value === '') return 1;
  const page = Number(value);
  if (!Number.isInteger(page)) {
    throw new HttpError(400, 'INVALID_PAGE', 'page must be an integer from 1 to 50.');
  }
  return page;
}

function accountView(device: Device, store: Store, config: AppConfig) {
  const user = device.userId ? store.getUser(device.userId) : undefined;
  const preferences = user ? store.getPreferences(user.id) : undefined;
  return {
    ...device,
    registrationIdMasked: maskId(device.registrationId),
    email: user?.normalizedEmail ?? null,
    accountCreatedAt: user?.createdAt ?? null,
    accountStatus: user?.accountStatus ?? null,
    preferenceCategories: preferences?.categories ?? [],
    preferencesUpdatedAt: preferences?.updatedAt ?? null,
    appName: 'EngageVideoPush',
    sdkVersion: '5.4.0',
    environment: config.mode,
  };
}

function maskId(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
