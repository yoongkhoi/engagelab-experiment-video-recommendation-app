import type { AppConfig } from '../config/env.js';
import type { Campaign, Category, Video } from '../domain.js';
import { nowIso } from '../domain.js';
import { HttpError, ProviderError } from '../errors.js';
import { EngageLabClient } from '../integrations/engagelabClient.js';
import { buildPushBody, buildSingleScheduleBody, newRequestId } from '../integrations/pushPayload.js';
import type { Store } from '../repositories/store.js';
import { newId, resolveAudience, type TargetingInput } from './audience.js';
import type { DeviceService } from './deviceService.js';
import type { EventService } from './eventService.js';
import { isScheduleTime, sanitizeScheduleName, wallTimeToUtc } from './time.js';
import type { VideoService } from './videoService.js';

export interface CampaignDraftInput {
  name: string;
  videoId: string;
  title: string;
  message: string;
  targeting: TargetingInput;
  experimentId?: string;
  variant?: 'A' | 'B';
}

export interface ScheduleInput {
  scheduleTime: string;
  timeZone: string;
  zoneType: 1 | 2;
}

const TERMINAL = new Set(['accepted_by_provider', 'scheduled', 'simulated']);

export class CampaignService {
  constructor(
    private readonly store: Store,
    private readonly videos: VideoService,
    private readonly devices: DeviceService,
    private readonly events: EventService,
    private readonly client: EngageLabClient,
    private readonly config: AppConfig,
  ) {}

  list(): Campaign[] {
    return this.store.listCampaigns();
  }

  get(id: string): Campaign {
    const campaign = this.store.getCampaign(id);
    if (!campaign) throw new HttpError(404, 'CAMPAIGN_NOT_FOUND', `Campaign ${id} was not found.`);
    return campaign;
  }

  async createDraft(input: CampaignDraftInput): Promise<Campaign> {
    const video = await this.requireActiveVideo(input.videoId);
    const now = nowIso();
    const campaign: Campaign = {
      id: newId(),
      name: input.name,
      videoId: video.id,
      title: input.title,
      message: input.message,
      targetingMode: input.targeting.mode,
      targetCategories: input.targeting.categories ?? [],
      requestedRegistrationIds: requestedIds(input.targeting),
      resolvedRegistrationIds: [],
      confirmBroadcast: Boolean(input.targeting.confirmBroadcast),
      acknowledgeTagScope: Boolean(input.targeting.acknowledgeTagScope),
      scheduleTime: null,
      scheduleTimeZone: null,
      zoneType: null,
      status: 'draft',
      providerMode: 'not_sent',
      providerMsgIds: [],
      providerRequestIds: [],
      providerScheduleId: null,
      providerResponse: null,
      errorKind: null,
      errorMessage: null,
      experimentId: input.experimentId ?? null,
      variant: input.variant ?? null,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      simulated: false,
    };
    this.store.insertCampaign(campaign);
    return campaign;
  }

  async send(id: string, confirmation?: { confirmBroadcast?: boolean; acknowledgeTagScope?: boolean }): Promise<Campaign> {
    const campaign = this.applyConfirmation(this.get(id), confirmation);
    this.assertSendable(campaign);
    const video = await this.requireActiveVideo(campaign.videoId);
    const audience = this.retarget(campaign);
    this.assertKnownTargets(campaign, audience);
    return this.dispatch(campaign, video, audience, null);
  }

  async schedule(
    id: string,
    schedule: ScheduleInput,
    confirmation?: { confirmBroadcast?: boolean; acknowledgeTagScope?: boolean },
  ): Promise<Campaign> {
    const campaign = this.applyConfirmation(this.get(id), confirmation);
    this.assertSendable(campaign);
    const video = await this.requireActiveVideo(campaign.videoId);
    const audience = this.retarget(campaign);
    this.assertKnownTargets(campaign, audience);
    const normalized = this.validateSchedule(schedule);
    return this.dispatch(campaign, video, audience, normalized);
  }

  async refreshProvider(id: string): Promise<Campaign> {
    const campaign = this.get(id);
    if (!campaign.providerScheduleId || !this.config.engagelab.configured) return campaign;
    try {
      const raw = await this.client.getSchedule(campaign.providerScheduleId);
      const updated: Campaign = { ...campaign, providerResponse: raw, updatedAt: nowIso() };
      this.store.updateCampaign(updated);
      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Provider lookup failed';
      return { ...campaign, errorMessage: message };
    }
  }

  private async dispatch(
    campaign: Campaign,
    video: Video,
    audience: ReturnType<CampaignService['retarget']>,
    schedule: { scheduleTime: string; timeZone: string; zoneType: 1 | 2 } | null,
  ): Promise<Campaign> {
    const working: Campaign = {
      ...campaign,
      resolvedRegistrationIds: audience.registrationIds,
      scheduleTime: schedule?.scheduleTime ?? null,
      scheduleTimeZone: schedule?.timeZone ?? null,
      zoneType: schedule?.zoneType ?? null,
      updatedAt: nowIso(),
      submittedAt: nowIso(),
      status: 'submitted',
      errorKind: null,
      errorMessage: null,
    };

    if (!this.config.engagelab.configured) {
      const simulated: Campaign = {
        ...working,
        status: 'simulated',
        providerMode: 'simulated',
        simulated: true,
        providerMsgIds: [],
        providerRequestIds: [],
        providerScheduleId: null,
        providerResponse: {
          simulated: true,
          message: 'SIMULATED RESULT. EngageLab credentials are not configured, so no notification was submitted to the provider and nothing was delivered.',
        },
      };
      this.store.updateCampaign(simulated);
      return simulated;
    }

    try {
      if (campaign.targetingMode === 'tag') {
        await this.ensureTags(audience.registrationIds, audience.tags);
      }
      const chunks = campaign.targetingMode === 'tag' || audience.broadcast
        ? [audience.registrationIds]
        : chunk(audience.registrationIds, 1000);
      const msgIds: string[] = [];
      const requestIds: string[] = [];
      const responses: unknown[] = [];
      let scheduleId: string | null = null;

      for (const registrationIds of chunks) {
        const requestId = newRequestId();
        const push = buildPushBody({
          title: campaign.title,
          alert: campaign.message,
          videoId: video.id,
          campaignId: campaign.id,
          category: video.category,
          requestId,
          packageName: this.config.androidPackageName,
          broadcast: audience.broadcast,
          tags: campaign.targetingMode === 'tag' ? audience.tags : undefined,
          registrationIds: campaign.targetingMode === 'tag' || audience.broadcast ? undefined : registrationIds,
        });
        if (schedule) {
          const created = await this.client.createSchedule(buildSingleScheduleBody({
            name: sanitizeScheduleName(`${campaign.name}_${campaign.id.slice(0, 8)}`),
            time: schedule.scheduleTime,
            zoneType: schedule.zoneType,
            push,
          }));
          scheduleId = created.scheduleId;
          requestIds.push(requestId);
          responses.push(created.raw);
        } else {
          const created = await this.client.createPush(push);
          msgIds.push(created.msgId);
          requestIds.push(created.requestId || requestId);
          responses.push(created.raw);
        }
      }

      const accepted: Campaign = {
        ...working,
        status: schedule ? 'scheduled' : 'accepted_by_provider',
        providerMode: 'live',
        simulated: false,
        providerMsgIds: msgIds,
        providerRequestIds: requestIds,
        providerScheduleId: scheduleId,
        providerResponse: responses.length === 1 ? responses[0] : responses,
      };
      this.store.updateCampaign(accepted);
      if (!schedule) {
        this.events.record({
          eventType: 'push_submitted',
          campaignId: accepted.id,
          videoId: accepted.videoId,
          experimentId: accepted.experimentId,
          variant: accepted.variant,
          source: 'server',
          dedupeKey: `push_submitted:${accepted.id}`,
          metadata: {
            providerMsgIds: msgIds,
            note: 'API submission accepted by EngageLab. This is not a device delivery, display, or click.',
          },
        });
      }
      return accepted;
    } catch (error) {
      const providerError = error instanceof ProviderError ? error : null;
      const failed: Campaign = {
        ...working,
        status: 'failed',
        providerMode: 'live',
        simulated: false,
        errorKind: providerError?.kind ?? 'provider',
        errorMessage: error instanceof Error ? error.message : 'Push submission failed',
        providerResponse: providerError?.providerBody ?? null,
      };
      this.store.updateCampaign(failed);
      throw new HttpError(502, 'PROVIDER_REQUEST_FAILED', failed.errorMessage ?? 'Push submission failed', {
        campaign: failed,
        kind: failed.errorKind,
      });
    }
  }

  private async ensureTags(registrationIds: string[], tags: string[]): Promise<void> {
    for (const registrationId of registrationIds) {
      const device = this.store.getDeviceByRegistration(registrationId);
      if (!device) continue;
      const synced = await this.devices.syncTags(device.id);
      if (synced.tagSyncStatus !== 'synced') {
        throw new ProviderError(
          `Tag synchronization for ${registrationId} is ${synced.tagSyncStatus}. ${synced.tagSyncError ?? ''}`.trim(),
          'provider',
        );
      }
      const missing = tags.filter((tag) => !(synced.engagelabTags ?? []).includes(tag));
      if (missing.length) {
        throw new ProviderError(
          `Device ${registrationId} is missing EngageLab tags: ${missing.join(', ')}. The tag push was not sent.`,
          'validation',
        );
      }
    }
  }

  describeTarget(targeting: TargetingInput) {
    const audience = resolveAudience(targeting, this.store.listDevices(), this.savedInterests());
    const missing = audience.broadcast
      ? []
      : audience.registrationIds.filter((id) => !id.trim() || !this.store.getDeviceByRegistration(id));
    return {
      mode: targeting.mode,
      registrationIds: audience.registrationIds,
      broadcast: audience.broadcast,
      missing,
      note: audience.broadcast
        ? 'Broadcast can reach EngageLab devices that are not in this database. It is not used when a specific target is invalid.'
        : 'The push stays on these Registration IDs. An unknown ID is rejected instead of being widened to a broadcast.',
    };
  }

  private assertKnownTargets(campaign: Campaign, audience: ReturnType<typeof resolveAudience>): void {
    if (audience.broadcast || campaign.targetingMode === 'tag') return;
    const missing = audience.registrationIds.filter((id) => !id.trim() || !this.store.getDeviceByRegistration(id));
    if (!audience.registrationIds.length || missing.length) {
      throw new HttpError(
        400,
        'TARGET_UNKNOWN',
        'The Registration ID is empty or is not stored for this backend. EngageLab returns HTTP 400 "Cannot find sending target" when the ID was never issued for this AppKey. The push was not sent and was not changed to a broadcast.',
      );
    }
  }

  private retarget(campaign: Campaign): ReturnType<typeof resolveAudience> {
    return resolveAudience({
      mode: campaign.targetingMode,
      registrationId: campaign.requestedRegistrationIds[0],
      registrationIds: campaign.requestedRegistrationIds,
      categories: campaign.targetCategories,
      confirmBroadcast: campaign.confirmBroadcast,
      acknowledgeTagScope: campaign.acknowledgeTagScope,
    }, this.store.listDevices(), this.savedInterests());
  }

  private savedInterests(): Map<string, string[]> {
    const interests = new Map<string, string[]>();
    for (const user of this.store.listUsers()) {
      const categories = this.store.getPreferences(user.id)?.categories ?? [];
      if (categories.length) interests.set(user.id, [...categories]);
    }
    return interests;
  }

  private applyConfirmation(
    campaign: Campaign,
    confirmation?: { confirmBroadcast?: boolean; acknowledgeTagScope?: boolean },
  ): Campaign {
    const next: Campaign = {
      ...campaign,
      confirmBroadcast: campaign.confirmBroadcast || Boolean(confirmation?.confirmBroadcast),
      acknowledgeTagScope: campaign.acknowledgeTagScope || Boolean(confirmation?.acknowledgeTagScope),
    };
    if (next.confirmBroadcast !== campaign.confirmBroadcast || next.acknowledgeTagScope !== campaign.acknowledgeTagScope) {
      this.store.updateCampaign({ ...next, updatedAt: nowIso() });
    }
    return next;
  }

  private assertSendable(campaign: Campaign): void {
    if (TERMINAL.has(campaign.status)) {
      throw new HttpError(409, 'CAMPAIGN_ALREADY_SUBMITTED', `Campaign ${campaign.id} is already ${campaign.status}.`);
    }
  }

  private requireActiveVideo(id: string): Promise<Video> {
    return this.videos.resolve(id);
  }

  private validateSchedule(schedule: ScheduleInput): { scheduleTime: string; timeZone: string; zoneType: 1 | 2 } {
    if (!isScheduleTime(schedule.scheduleTime)) {
      throw new HttpError(400, 'INVALID_SCHEDULE_TIME', 'scheduleTime must be yyyy-MM-dd HH:mm:ss.');
    }
    if (schedule.zoneType !== 1 && schedule.zoneType !== 2) {
      throw new HttpError(400, 'INVALID_ZONE_TYPE', 'zoneType must be 1 (EngageLab main-site timezone) or 2 (device timezone).');
    }
    const instant = wallTimeToUtc(schedule.scheduleTime, schedule.timeZone);
    if (schedule.zoneType === 1 && instant.getTime() < Date.now() + 30_000) {
      throw new HttpError(
        400,
        'SCHEDULE_IN_THE_PAST',
        `scheduleTime is not in the future for timezone ${schedule.timeZone}. For zoneType 1, enter the wall-clock time of the EngageLab main site.`,
      );
    }
    return schedule;
  }
}

function requestedIds(targeting: TargetingInput): string[] {
  if (targeting.mode === 'registration_id' && targeting.registrationId) return [targeting.registrationId];
  if (targeting.mode === 'registration_ids') return targeting.registrationIds ?? [];
  return [];
}

function chunk<T>(values: T[], size: number): T[][] {
  if (!values.length) return [[]];
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
  return chunks;
}
