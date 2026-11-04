import type { AppConfig } from '../config/env.js';
import { VIDEO_PREFERENCE_CATEGORIES } from '../domain.js';
import { nowIso } from '../domain.js';
import { HttpError } from '../errors.js';
import type { PersonalStore } from '../repositories/personalStore.js';
import type { Store } from '../repositories/store.js';
import type { CampaignService } from './campaignService.js';
import { inQuietHours, zonedMinutes } from './quietHours.js';
import { newId } from './audience.js';

const DAILY_CAP = 3;
const preferences = new Set<string>(VIDEO_PREFERENCE_CATEGORIES);

export interface MatchRow {
  userId: string;
  email: string;
  registrationId: string;
  action: 'send' | 'queue' | 'skip';
  reason: string;
}

export function maskRegistration(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function previewMatches(store: Store, personal: PersonalStore, config: AppConfig, videoId: string, at = new Date()): { timezone: string; matches: MatchRow[] } {
  const video = store.getVideo(videoId);
  const entry = personal.library(videoId);
  if (!video || !entry || entry.libraryState !== 'published') {
    throw new HttpError(409, 'LIBRARY_UNPUBLISHED', 'Only a published library video can be matched. Nothing was sent.');
  }
  const timezone = config.engagelab.siteTimeZone || 'UTC';
  const nowMinutes = zonedMinutes(timezone, at);
  const since = new Date(at.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const category = video.category.toLowerCase();
  const matches: MatchRow[] = [];
  for (const user of store.listUsers()) {
    const interests = store.getPreferences(user.id)?.categories ?? [];
    if (!interests.some((item) => item === category || entry.keywords.includes(item))) continue;
    const prefs = personal.notificationPreference(user.id);
    const devices = store.devicesForUser(user.id).filter((device) => device.notificationEnabled && device.registrationId.trim());
    if (!prefs.pushEnabled || !prefs.newInInterests) {
      matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: '', action: 'skip', reason: 'opted_out' });
      continue;
    }
    if (prefs.categories.length && !prefs.categories.includes(category)) {
      matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: '', action: 'skip', reason: 'category_filter' });
      continue;
    }
    if (!devices.length) {
      matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: '', action: 'skip', reason: 'no_registered_device' });
      continue;
    }
    for (const device of devices) {
      const dedupe = `${user.id}:${videoId}:${device.registrationId}`;
      if (personal.deliveryExists(dedupe)) {
        matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: device.registrationId, action: 'skip', reason: 'duplicate' });
        continue;
      }
      if (inQuietHours(prefs.quietStart, prefs.quietEnd, nowMinutes)) {
        matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: device.registrationId, action: 'skip', reason: 'quiet_hours' });
        continue;
      }
      if (prefs.frequency !== 'instant') {
        matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: device.registrationId, action: 'queue', reason: prefs.frequency });
        continue;
      }
      if (personal.countDeliveriesSince(user.id, since) >= DAILY_CAP) {
        matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: device.registrationId, action: 'skip', reason: 'frequency_cap' });
        continue;
      }
      matches.push({ userId: user.id, email: user.normalizedEmail, registrationId: device.registrationId, action: 'send', reason: 'instant' });
    }
  }
  return { timezone, matches };
}

export function assertPreferenceCategory(value: string): void {
  if (!preferences.has(value)) {
    throw new HttpError(400, 'UNKNOWN_CATEGORY', 'Use an existing preference category. A new category was not invented.');
  }
}

export async function activateLibraryCampaign(
  store: Store,
  personal: PersonalStore,
  campaigns: CampaignService,
  config: AppConfig,
  libraryCampaignId: string,
  confirm: boolean,
): Promise<{ status: string; campaignId: string | null; simulated: boolean; sent: number; queued: number; skipped: number }> {
  if (!confirm) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Set confirm=true to activate. Nothing was sent.');
  const row = personal.libraryCampaigns().find((item) => (item as { id: string }).id === libraryCampaignId) as { id: string; video_id: string; status: string } | undefined;
  if (!row) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', 'Library campaign was not found.');
  if (row.status === 'paused') throw new HttpError(409, 'CAMPAIGN_PAUSED', 'A paused campaign is not sent.');
  const { matches } = previewMatches(store, personal, config, row.video_id);
  const now = nowIso();
  const sendIds: string[] = [];
  let queued = 0;
  let skipped = 0;
  for (const match of matches) {
    if (!match.registrationId) {
      skipped += 1;
      continue;
    }
    const dedupe = `${match.userId}:${row.video_id}:${match.registrationId}`;
    if (match.action === 'skip') {
      skipped += 1;
      continue;
    }
    if (match.action === 'queue') {
      const after = new Date(Date.now() + (match.reason === 'weekly' ? 7 : 1) * 24 * 60 * 60 * 1000).toISOString();
      personal.insertDelivery({
        id: newId(), userId: match.userId, videoId: row.video_id, registrationId: match.registrationId,
        campaignId: null, status: 'queued', reason: match.reason, dedupeKey: dedupe, deliverAfter: after, at: now,
      });
      queued += 1;
      continue;
    }
    sendIds.push(match.registrationId);
  }
  let campaignId: string | null = null;
  let simulated = false;
  if (sendIds.length) {
    const video = store.getVideo(row.video_id);
    const draft = await campaigns.createDraft({
      name: `Library ${video?.title ?? row.video_id}`.slice(0, 120),
      videoId: row.video_id,
      title: (video?.title ?? 'New video').slice(0, 100),
      message: `A video matching your interests is ready.`.slice(0, 300),
      targeting: { mode: 'registration_ids', registrationIds: sendIds },
    });
    const sent = await campaigns.send(draft.id, {});
    campaignId = sent.id;
    simulated = sent.status === 'simulated';
    for (const match of matches.filter((item) => item.action === 'send')) {
      personal.insertDelivery({
        id: newId(), userId: match.userId, videoId: row.video_id, registrationId: match.registrationId,
        campaignId, status: simulated ? 'simulated' : 'accepted_by_provider', reason: simulated ? 'demo_not_delivered' : 'provider_accepted_not_device_delivery',
        dedupeKey: `${match.userId}:${row.video_id}:${match.registrationId}`, deliverAfter: null, at: now,
      });
    }
  }
  const status = sendIds.length || queued ? 'active' : 'completed';
  personal.updateLibraryCampaign(row.id, status, campaignId, now);
  return { status, campaignId, simulated, sent: sendIds.length, queued, skipped };
}

export async function runDueDigests(
  store: Store,
  personal: PersonalStore,
  campaigns: CampaignService,
  confirm: boolean,
): Promise<{ processed: number; simulated: boolean }> {
  if (!confirm) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Set confirm=true to release queued digests. Nothing was sent.');
  const due = personal.dueQueued(nowIso());
  const grouped = new Map<string, typeof due>();
  for (const row of due) {
    const paused = personal.libraryCampaigns(row.video_id).some((item) => (item as { status: string }).status === 'paused');
    if (paused) continue;
    grouped.set(row.video_id, [...(grouped.get(row.video_id) ?? []), row]);
  }
  let processed = 0;
  let simulated = false;
  for (const [videoId, rows] of grouped) {
    const ids = rows.map((row) => row.registration_id);
    const video = store.getVideo(videoId);
    const draft = await campaigns.createDraft({
      name: `Digest ${video?.title ?? videoId}`.slice(0, 120),
      videoId,
      title: (video?.title ?? 'New video').slice(0, 100),
      message: 'A queued recommendation is ready.',
      targeting: { mode: 'registration_ids', registrationIds: ids },
    });
    const sent = await campaigns.send(draft.id, {});
    simulated = sent.status === 'simulated';
    for (const row of rows) {
      personal.markDelivery(row.id, simulated ? 'simulated' : 'accepted_by_provider', sent.id);
      processed += 1;
    }
  }
  return { processed, simulated };
}
