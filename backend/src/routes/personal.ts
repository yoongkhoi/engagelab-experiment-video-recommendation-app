import type { Express, RequestHandler } from 'express';
import type { AppConfig } from '../config/env.js';
import type { AppUser } from '../domain.js';
import { VIDEO_PREFERENCE_CATEGORIES, nowIso } from '../domain.js';
import { HttpError } from '../errors.js';
import { logger } from '../logger.js';
import type { AuthedRequest } from '../middleware/auth.js';
import { PersonalStore } from '../repositories/personalStore.js';
import type { Store } from '../repositories/store.js';
import type { AiClient } from '../services/aiClient.js';
import { trustedVideos } from '../services/aiClient.js';
import { newId } from '../services/audience.js';
import type { CampaignService } from '../services/campaignService.js';
import { activateLibraryCampaign, assertPreferenceCategory, maskRegistration, previewMatches, recordDecisions, runDueDigests } from '../services/libraryFlow.js';
import { groundedTopics, guestFeed, recommendationSections } from '../services/personalization.js';
import type { PixabayCatalog } from '../integrations/pixabay.js';
import type { VideoService } from '../services/videoService.js';
import { z } from 'zod';

const hits = new Map<string, number[]>();
const categories = z.enum(VIDEO_PREFERENCE_CATEGORIES);

const savedVideo = z.object({
  videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
  title: z.string().trim().min(1).max(200),
  thumbnailUrl: z.string().trim().url().nullable().optional(),
  category: z.string().trim().max(40).nullable().optional(),
});

const notificationSchema = z.object({
  pushEnabled: z.boolean(),
  newInInterests: z.boolean(),
  aiRecommendations: z.boolean(),
  trending: z.boolean(),
  dailyDigest: z.boolean(),
  frequency: z.enum(['instant', 'daily', 'weekly']),
  quietStart: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  quietEnd: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable(),
  categories: z.array(categories).max(categories.options.length),
});

function omitted(value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string' && value.trim() === '') return undefined;
  return value;
}

function omittedGuest(value: unknown): unknown {
  const next = omitted(value);
  if (typeof next !== 'string') return undefined;
  const trimmed = next.trim();
  if (trimmed.length < 8 || trimmed.length > 64) return undefined;
  return trimmed;
}

const chatSchema = z.object({
  message: z.string().trim().min(1).max(1000),
  conversationId: z.preprocess(omitted, z.string().uuid().optional()),
  guestKey: z.preprocess(omittedGuest, z.string().trim().min(8).max(64).optional()),
});

export function attachPersonalRoutes(app: Express, deps: {
  store: Store;
  personal: PersonalStore;
  requireUser: (req: AuthedRequest) => AppUser;
  optionalUser: (req: AuthedRequest) => AppUser | null;
  requireAdmin: RequestHandler;
  ai: AiClient;
  pixabay: PixabayCatalog;
  videos: VideoService;
  campaigns: CampaignService;
  config: AppConfig;
}): void {
  const { personal, store } = deps;

  app.get('/api/me/favorites', (req, res, next) => {
    try {
      res.json({ favorites: personal.listFavorites(deps.requireUser(req).id) });
    } catch (error) { next(error); }
  });

  app.post('/api/me/favorites', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const body = savedVideo.parse(req.body);
      personal.saveFavorite(user.id, { videoId: body.videoId, title: body.title, thumbnailUrl: body.thumbnailUrl ?? null, category: body.category ?? null, at: nowIso() });
      res.status(201).json({ favorites: personal.listFavorites(user.id) });
    } catch (error) { next(error); }
  });

  app.delete('/api/me/favorites/:videoId', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      personal.deleteFavorite(user.id, req.params.videoId);
      res.json({ favorites: personal.listFavorites(user.id) });
    } catch (error) { next(error); }
  });

  app.get('/api/me/history', (req, res, next) => {
    try {
      res.json({ history: personal.listHistory(deps.requireUser(req).id) });
    } catch (error) { next(error); }
  });

  app.post('/api/me/history', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const body = savedVideo.parse(req.body);
      personal.saveHistory(user.id, { videoId: body.videoId, title: body.title, thumbnailUrl: body.thumbnailUrl ?? null, category: body.category ?? null, at: nowIso() });
      res.status(201).json({ history: personal.listHistory(user.id) });
    } catch (error) { next(error); }
  });

  app.get('/api/me/notifications/preferences', (req, res, next) => {
    try {
      res.json({ preferences: personal.notificationPreference(deps.requireUser(req).id), timezone: deps.config.engagelab.siteTimeZone || 'UTC' });
    } catch (error) { next(error); }
  });

  app.put('/api/me/notifications/preferences', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const body = notificationSchema.parse(req.body);
      personal.saveNotificationPreference(user.id, { ...body, updatedAt: nowIso() });
      res.json({ preferences: personal.notificationPreference(user.id) });
    } catch (error) { next(error); }
  });

  app.post('/api/me/recommendation-feedback', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const body = z.object({
        videoId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,64}$/),
        sentiment: z.enum(['positive', 'negative']),
        conversationId: z.string().uuid().optional(),
      }).parse(req.body);
      personal.feedback({ id: newId(), userId: user.id, conversationId: body.conversationId ?? null, videoId: body.videoId, sentiment: body.sentiment, at: nowIso() });
      res.status(201).json({ ok: true });
    } catch (error) { next(error); }
  });

  app.post('/api/ai/chat', async (req, res, next) => {
    try {
      limitAi(req);
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) {
        logger.warn({
          issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || 'body', issueCode: issue.code })),
        }, 'AI chat request was rejected');
        const missingMessage = parsed.error.issues.some((issue) => issue.path[0] === 'message');
        throw new HttpError(400, 'VALIDATION_ERROR', missingMessage
          ? 'Type a message before sending.'
          : 'The chat request was not accepted. Send the message again.');
      }
      const body = parsed.data;
      const user = deps.optionalUser(req);
      const guestKey = user ? null : (body.guestKey ?? newId().replace(/-/g, ''));
      const conversation = openConversation(personal, user, guestKey, body.conversationId, body.message);
      const history = personal.recentMessages(conversation.id, 6).map((message) => ({ role: message.role, content: message.content.slice(0, 500) }));
      const preferences = user ? (store.getPreferences(user.id)?.categories ?? []) : [];
      const feedback = user ? personal.feedbackForUser(user.id) : [];
      personal.insertMessage({ id: newId(), conversationId: conversation.id, role: 'user', content: body.message, metadata: null, at: nowIso() });
      const recommendation = await deps.ai.recommend({ message: body.message, history, preferences, feedback, limit: 6 });
      const videos = trustedVideos(recommendation);
      const at = nowIso();
      personal.insertMessage({
        id: newId(), conversationId: conversation.id, role: 'assistant', content: recommendation.reply,
        metadata: JSON.stringify({ videos, intent: recommendation.intent, keywords: recommendation.keywords }), at,
      });
      personal.touchConversation(conversation.id, at);
      const summary = personal.summary(conversation.id);
      if (personal.messageCount(conversation.id) >= 8 && !summary) {
        personal.updateSummary(conversation.id, body.message);
      }
      personal.insertTrace({
        id: newId(),
        conversationId: conversation.id,
        intent: recommendation.intent,
        queries: recommendation.keywords,
        resultCount: videos.length,
        outcome: videos.length ? 'results' : recommendation.intent,
        at,
      });
      res.json({
        conversationId: conversation.id,
        ...(guestKey ? { guestKey } : {}),
        reply: recommendation.reply,
        explanation: recommendation.explanation,
        videos,
        intent: recommendation.intent,
        keywords: recommendation.keywords,
        suggestions: recommendation.suggestions ?? [],
      });
    } catch (error) { next(error); }
  });

  app.get('/api/ai/conversations', (req, res, next) => {
    try {
      const user = deps.optionalUser(req);
      const guestKey = typeof req.query.guestKey === 'string' ? req.query.guestKey : '';
      if (!user && !guestKey) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in or continue a guest session.');
      res.json({ conversations: personal.listConversations(user ? { userId: user.id } : { guestKey }) });
    } catch (error) { next(error); }
  });

  app.get('/api/library', deps.requireAdmin, (_req, res) => {
    const entries = personal.listLibrary().map((entry) => ({ ...entry, video: store.getVideo(entry.videoId) ?? null }));
    const campaigns = personal.libraryCampaigns().map((row) => {
      const item = row as { id: string; video_id: string; campaign_id: string | null; status: string; note: string | null };
      return { id: item.id, videoId: item.video_id, campaignId: item.campaign_id, status: item.status, note: item.note };
    });
    res.json({
      entries,
      campaigns,
      states: {
        draft: 'Saved or waiting. No push has been sent.',
        published: 'The library video is published. Publishing itself does not send a push.',
        active: 'Activation submitted a targeted campaign. This is not proof a device displayed it.',
        paused: 'Further sends for this library campaign are blocked.',
        completed: 'Activation found no further immediate recipient.',
      },
    });
  });

  app.post('/api/library', deps.requireAdmin, async (req, res, next) => {
    try {
      const body = z.object({
        videoId: z.string().trim().regex(/^\d{1,12}$/),
        category: categories,
        keywords: z.array(z.string().trim().min(1).max(40)).max(8),
        tags: z.array(z.string().trim().min(1).max(40)).max(8).default([]),
      }).parse(req.body);
      assertPreferenceCategory(body.category);
      if (personal.library(body.videoId)) throw new HttpError(409, 'LIBRARY_DUPLICATE', 'That Pixabay video is already in the library.');
      const remote = await deps.pixabay.video(body.videoId);
      const stored = deps.videos.remember({ ...remote, category: body.category });
      const now = nowIso();
      const existing = personal.library(stored.id);
      const topics = groundedTopics(body.category, body.keywords, body.tags);
      personal.upsertLibrary({
        videoId: stored.id,
        libraryState: existing?.libraryState === 'published' ? 'published' : 'draft',
        keywords: [...new Set([...body.keywords, ...topics])],
        tags: body.tags,
        width: remote.width,
        height: remote.height,
        durationSeconds: remote.duration,
        publishedAt: existing?.publishedAt ?? null,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      });
      res.status(201).json({ entry: personal.library(stored.id), video: store.getVideo(stored.id) });
    } catch (error) { next(error); }
  });

  app.post('/api/library/:id/publish', deps.requireAdmin, (req, res, next) => {
    try {
      const entry = requireLibrary(personal, req.params.id);
      const now = nowIso();
      personal.upsertLibrary({ ...entry, libraryState: 'published', publishedAt: now, updatedAt: now });
      const campaignId = newId();
      const existing = personal.libraryCampaigns(entry.videoId).find((row) => {
        const status = (row as { status: string }).status;
        return status === 'draft' || status === 'active';
      }) as { id: string } | undefined;
      if (existing && entry.libraryState === 'published') {
        res.json({ entry: personal.library(entry.videoId), libraryCampaignId: existing.id, sent: false, created: false });
        return;
      }
      personal.insertLibraryCampaign({ id: campaignId, videoId: entry.videoId, status: 'draft', note: 'Created when the video was published. No push has been sent.', at: now });
      const video = store.getVideo(entry.videoId);
      recordDecisions(personal, entry.videoId, campaignId, 'published', groundedTopics(video?.category ?? '', entry.keywords, entry.tags), [], false);
      res.json({ entry: personal.library(entry.videoId), libraryCampaignId: campaignId, sent: false, created: true, engageLabCalled: false });
    } catch (error) { next(error); }
  });

  app.post('/api/library/:id/preview', deps.requireAdmin, (req, res, next) => {
    try {
      const result = previewMatches(store, personal, deps.config, req.params.id);
      const users = new Set(result.matches.map((match) => match.userId));
      const devices = result.matches.filter((match) => match.registrationId);
      res.json({
        timezone: result.timezone,
        quietHours: 'Quiet hours use the EngageLab site timezone, or UTC when that value is empty. Overnight ranges are supported.',
        matchedUsers: users.size,
        registeredDevices: devices.length,
        matched: users.size,
        eligible: result.matches.filter((match) => match.action === 'send').length,
        excluded: result.matches.filter((match) => match.action === 'skip').length,
        willSend: result.matches.filter((match) => match.action === 'send').length,
        willQueue: result.matches.filter((match) => match.action === 'queue').length,
        skipped: result.matches.filter((match) => match.action === 'skip').length,
        matches: result.matches.map((match) => ({ ...match, registrationId: match.registrationId ? maskRegistration(match.registrationId) : '' })),
        sent: false,
      });
    } catch (error) { next(error); }
  });

  app.post('/api/library/campaigns/:id/activate', deps.requireAdmin, async (req, res, next) => {
    try {
      const body = z.object({ confirm: z.literal(true) }).parse(req.body);
      const result = await activateLibraryCampaign(store, personal, deps.campaigns, deps.config, req.params.id, body.confirm);
      res.json({ ...result, deviceDeliveryVerified: false });
    } catch (error) { next(error); }
  });

  app.post('/api/library/digest/run', deps.requireAdmin, async (req, res, next) => {
    try {
      const body = z.object({ confirm: z.literal(true) }).parse(req.body);
      const result = await runDueDigests(store, personal, deps.campaigns, body.confirm);
      res.json({ ...result, deviceDeliveryVerified: false });
    } catch (error) { next(error); }
  });

  app.post('/api/library/campaigns/:id/pause', deps.requireAdmin, (req, res, next) => {
    try {
      personal.updateLibraryCampaign(req.params.id, 'paused', null, nowIso());
      res.json({ status: 'paused', sent: false });
    } catch (error) { next(error); }
  });

  app.get('/api/analytics/ai', deps.requireAdmin, (_req, res) => {
    res.json(personal.aiStats());
  });

  app.get('/api/admin/users', deps.requireAdmin, (_req, res) => {
    const users = store.listUsers().map((user) => {
      const devices = store.devicesForUser(user.id);
      return {
        id: user.id,
        email: user.normalizedEmail,
        displayName: user.displayName,
        preferences: store.getPreferences(user.id)?.categories ?? [],
        notifications: personal.notificationPreference(user.id),
        deviceCount: devices.length,
        registrationIds: devices.map((device) => maskRegistration(device.registrationId)),
      };
    });
    res.json({ users });
  });

  app.get('/api/me/profile', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      res.json({ profile: personal.profile(user.id), displayName: user.displayName, email: user.normalizedEmail });
    } catch (error) { next(error); }
  });

  app.put('/api/me/onboarding', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const body = z.object({
        displayName: z.string().trim().max(40).optional(),
        gender: z.enum(['male', 'female', 'unspecified']).nullable().optional(),
        categories: z.array(categories).max(categories.options.length).default([]),
        subcategories: z.array(z.string().trim().min(1).max(40)).max(24).default([]),
        videoLength: z.enum(['short', 'long']).nullable().optional(),
        contentStyle: z.enum(['educational', 'entertainment']).nullable().optional(),
        energy: z.enum(['relaxing', 'exciting']).nullable().optional(),
        discovery: z.enum(['trending', 'niche']).nullable().optional(),
        recommendationCadence: z.enum(['instant', 'daily', 'weekly']).nullable().optional(),
        completed: z.boolean().default(true),
      }).parse(req.body);
      if (body.displayName) deps.store.updateDisplayName(user.id, body.displayName, nowIso());
      if (body.categories.length) deps.store.savePreferences({
        userId: user.id,
        categories: body.categories,
        createdAt: deps.store.getPreferences(user.id)?.createdAt ?? nowIso(),
        updatedAt: nowIso(),
      });
      personal.saveProfile(user.id, {
        gender: body.gender ?? null,
        onboardingCompleted: body.completed,
        videoLength: body.videoLength ?? null,
        contentStyle: body.contentStyle ?? null,
        energy: body.energy ?? null,
        discovery: body.discovery ?? null,
        recommendationCadence: body.recommendationCadence ?? null,
        subcategories: body.subcategories,
      }, nowIso());
      res.json({ profile: personal.profile(user.id), onboardingCompleted: body.completed });
    } catch (error) { next(error); }
  });

  app.post('/api/me/delete', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const body = z.object({ confirm: z.literal('DELETE') }).parse(req.body);
      if (body.confirm !== 'DELETE') throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Type DELETE to remove the account.');
      personal.clearConversations({ userId: user.id });
      deps.store.revokeUserSessions(user.id, nowIso());
      deps.store.setAccountStatus(user.id, 'deleted', nowIso());
      res.json({ deleted: true });
    } catch (error) { next(error); }
  });

  app.delete('/api/ai/conversations/:id', (req, res, next) => {
    try {
      const user = deps.optionalUser(req);
      const guestKey = typeof req.query.guestKey === 'string' ? req.query.guestKey : '';
      const removed = personal.deleteConversation(req.params.id, user ? { userId: user.id } : { guestKey });
      if (!removed) throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'That conversation was not found.');
      res.json({ deleted: true });
    } catch (error) { next(error); }
  });

  app.delete('/api/ai/conversations', (req, res, next) => {
    try {
      const user = deps.optionalUser(req);
      const guestKey = typeof req.query.guestKey === 'string' ? req.query.guestKey : '';
      if (!user && !guestKey) throw new HttpError(401, 'UNAUTHORIZED', 'Sign in or continue a guest session.');
      res.json({ deleted: personal.clearConversations(user ? { userId: user.id } : { guestKey }) });
    } catch (error) { next(error); }
  });

  app.get('/api/recommendations', async (_req, res, next) => {
    try {
      const page = await deps.pixabay.popular(1);
      const feed = guestFeed(page.videos.map((video) => ({
        id: video.id, title: video.title, category: video.category, tags: [], videoUrl: video.video_url,
      })));
      res.json({ personalized: false, sections: [{ title: 'Popular', videos: page.videos.filter((video) => feed.videos.some((item) => item.id === video.id)) }] });
    } catch (error) { next(error); }
  });

  app.get('/api/me/recommendations', async (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const interests = deps.store.getPreferences(user.id)?.categories ?? [];
      const watched = personal.listHistory(user.id).map((item) => item.videoId);
      const favorites = personal.listFavorites(user.id).map((item) => item.videoId);
      const feedback = personal.feedbackForUser(user.id);
      const profile = personal.profile(user.id);
      const collected = [];
      const queries = interests.length ? interests.slice(0, 4) : ['nature'];
      for (const interest of queries) {
        const page = await deps.pixabay.search(searchFor(interest), 1);
        for (const video of page.videos) {
          if (!video.video_url.startsWith('https://') || !video.title.trim()) continue;
          collected.push({
            id: video.id,
            title: video.title,
            category: interest,
            tags: [video.category, interest],
            videoUrl: video.video_url,
            publishedAt: null,
            source: video,
          });
        }
      }
      const unique = [...new Map(collected.map((video) => [video.id, video])).values()];
      const sections = recommendationSections(unique, {
        interests,
        watched,
        favorites,
        positive: feedback.filter((item) => item.sentiment === 'positive').map((item) => item.video_id),
        negative: feedback.filter((item) => item.sentiment === 'negative').map((item) => item.video_id),
        dismissedCategories: [],
      }).map((section) => ({
        title: section.title,
        videos: section.videos.map((video) => unique.find((item) => item.id === video.id)?.source).filter(Boolean),
      })).filter((section) => section.videos.length);
      const category = typeof req.query.category === 'string' ? req.query.category : '';
      res.json({
        personalized: interests.length > 0,
        genderUsed: false,
        viewing: profile,
        sections: category ? sections.filter((section) => section.title.toLowerCase().includes(category.toLowerCase())) : sections,
      });
    } catch (error) { next(error); }
  });

  app.post('/api/library/:id/unpublish', deps.requireAdmin, (req, res, next) => {
    try {
      const entry = requireLibrary(personal, req.params.id);
      personal.upsertLibrary({ ...entry, libraryState: 'draft', updatedAt: nowIso() });
      res.json({ entry: personal.library(entry.videoId), sent: false });
    } catch (error) { next(error); }
  });

  app.post('/api/library/:id/dry-run', deps.requireAdmin, (req, res, next) => {
    try {
      const result = previewMatches(store, personal, deps.config, req.params.id);
      const video = store.getVideo(req.params.id);
      recordDecisions(personal, req.params.id, null, 'dry_run', result.topics, result.matches, false);
      res.json({
        sent: false,
        engageLabCalled: false,
        matched: new Set(result.matches.map((match) => match.userId)).size,
        eligible: result.matches.filter((match) => match.action === 'send').length,
        excluded: result.matches.filter((match) => match.action === 'skip').length,
        queued: result.matches.filter((match) => match.action === 'queue').length,
        decisionsRecorded: true,
        automaticCampaigns: result.automaticCampaigns,
        topics: result.topics,
        timezone: result.timezone,
        matches: result.matches.map((match) => ({ ...match, registrationId: match.registrationId ? maskRegistration(match.registrationId) : '' })),
        payload: {
          campaignId: null,
          videoId: req.params.id,
          deepLink: `engagevideopush://video/${req.params.id}`,
          type: 'video',
          title: video?.title ?? 'Video',
          body: 'A video matching saved interests is ready.',
        },
      });
    } catch (error) { next(error); }
  });

  app.get('/api/admin/notification-policy', deps.requireAdmin, (_req, res) => {
    res.json({ policy: personal.notificationPolicy(), automaticDefault: false });
  });

  app.put('/api/admin/notification-policy', deps.requireAdmin, (req, res, next) => {
    try {
      const body = z.object({
        maxPerDay: z.number().int().min(0).max(10),
        minIntervalHours: z.number().int().min(0).max(48),
        recentExclusionHours: z.number().int().min(0).max(168),
        automaticCampaigns: z.boolean(),
      }).parse(req.body);
      personal.saveNotificationPolicy(body, nowIso());
      res.json({ policy: personal.notificationPolicy(), sent: false });
    } catch (error) { next(error); }
  });

  app.get('/api/analytics/notifications', deps.requireAdmin, (_req, res) => {
    res.json({ deliveries: personal.deliveryCounts(), deliveryConfirmed: false });
  });

  app.get('/api/analytics/preferences', deps.requireAdmin, (_req, res) => {
    const users = store.listUsers();
    const enabled = users.filter((user) => personal.notificationPreference(user.id).pushEnabled).length;
    res.json({
      interests: personal.preferenceCounts(),
      accounts: users.length,
      pushEnabled: enabled,
      pushOptInRate: users.length ? enabled / users.length : 0,
    });
  });

  app.get('/api/me/notifications', (req, res, next) => {
    try {
      const user = deps.requireUser(req);
      const rows = personal.deliveriesForUser(user.id);
      res.json({ notifications: rows });
    } catch (error) { next(error); }
  });
}

function searchFor(interest: string): string {
  const queries: Record<string, string> = {
    motorsport: 'Formula 1 racing',
    nature: 'nature waterfall',
    food: 'street food',
    technology: 'technology',
    travel: 'travel',
    sports: 'sports',
    animals: 'wildlife',
    entertainment: 'movie',
  };
  return queries[interest] ?? interest;
}

function openConversation(personal: PersonalStore, user: AppUser | null, guestKey: string | null, conversationId: string | undefined, message: string) {
  if (!conversationId) {
    const id = newId();
    personal.insertConversation({ id, userId: user?.id ?? null, guestKey, title: message.slice(0, 80), at: nowIso() });
    return { id, user_id: user?.id ?? null, guest_key: guestKey };
  }
  const existing = personal.conversation(conversationId);
  if (!existing) throw new HttpError(404, 'CONVERSATION_NOT_FOUND', 'That conversation was not found.');
  if (user && existing.user_id !== user.id) throw new HttpError(403, 'FORBIDDEN', 'That conversation belongs to another account.');
  if (!user && existing.guest_key !== guestKey) throw new HttpError(403, 'FORBIDDEN', 'That guest conversation does not match this device.');
  return existing;
}

function requireLibrary(personal: PersonalStore, videoId: string) {
  const entry = personal.library(videoId);
  if (!entry) throw new HttpError(404, 'LIBRARY_NOT_FOUND', 'That video is not in the library.');
  return entry;
}

function limitAi(req: AuthedRequest): void {
  const key = req.ip || 'local';
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < 15 * 60 * 1000);
  if (recent.length >= 30) throw new HttpError(429, 'AI_RATE_LIMIT', 'Too many AI requests. Wait before trying again.');
  recent.push(now);
  hits.set(key, recent);
}

