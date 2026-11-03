import type { AppEvent, Campaign, Device, Experiment, Video } from '../domain.js';
import { parseJson } from '../domain.js';

export interface VideoRow {
  id: string;
  title: string;
  description: string;
  category: Video['category'];
  source_type: 'remote' | 'asset';
  source: string;
  asset_filename: string | null;
  thumbnail_url: string | null;
  active: number;
  created_at: string;
  updated_at: string;
}

export interface DeviceRow {
  id: string;
  registration_id: string;
  platform: 'android';
  categories: string;
  device_token: string;
  app_version: string | null;
  registered_at: string;
  updated_at: string;
  last_seen_at: string;
  tag_sync_status: Device['tagSyncStatus'];
  tag_sync_error: string | null;
  tag_synced_at: string | null;
  engagelab_tags: string | null;
  device_type: Device['deviceType'];
  installation_id: string | null;
  user_id: string | null;
  notification_enabled: number | null;
}

export interface CampaignRow {
  id: string;
  name: string;
  video_id: string;
  title: string;
  message: string;
  targeting_mode: Campaign['targetingMode'];
  target_categories: string | null;
  target_registration_ids: string | null;
  resolved_registration_ids: string | null;
  confirm_broadcast: number;
  acknowledge_tag_scope: number;
  schedule_time: string | null;
  schedule_timezone: string | null;
  zone_type: number | null;
  status: Campaign['status'];
  provider_mode: Campaign['providerMode'];
  provider_msg_ids: string | null;
  provider_request_ids: string | null;
  provider_schedule_id: string | null;
  provider_response: string | null;
  error_kind: string | null;
  error_message: string | null;
  experiment_id: string | null;
  variant: 'A' | 'B' | null;
  created_at: string;
  updated_at: string;
  submitted_at: string | null;
}

export interface ExperimentRow {
  id: string;
  name: string;
  video_id: string;
  variant_a_title: string;
  variant_a_message: string;
  variant_b_title: string;
  variant_b_message: string;
  targeting_mode: Campaign['targetingMode'];
  target_categories: string | null;
  target_registration_ids: string | null;
  confirm_broadcast: number;
  acknowledge_tag_scope: number;
  allocation_a: number;
  duration_hours: number;
  primary_metric: Experiment['primaryMetric'];
  status: Experiment['status'];
  started_at: string | null;
  ends_at: string | null;
  campaign_a_id: string | null;
  campaign_b_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  event_type: AppEvent['eventType'];
  registration_id: string | null;
  campaign_id: string | null;
  video_id: string | null;
  experiment_id: string | null;
  variant: 'A' | 'B' | null;
  dedupe_key: string | null;
  source: AppEvent['source'];
  metadata: string | null;
  occurred_at: string;
  created_at: string;
  user_id: string | null;
}

export function mapVideo(row: VideoRow): Video {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    category: row.category,
    sourceType: row.source_type,
    source: row.source,
    assetFilename: row.asset_filename,
    thumbnailUrl: row.thumbnail_url,
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapDevice(row: DeviceRow): Device {
  return {
    id: row.id,
    registrationId: row.registration_id,
    platform: row.platform,
    deviceType: row.device_type ?? null,
    installationId: row.installation_id ?? null,
    userId: row.user_id ?? null,
    notificationEnabled: row.notification_enabled !== 0,
    categories: parseJson(row.categories, []),
    appVersion: row.app_version,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    tagSyncStatus: row.tag_sync_status,
    tagSyncError: row.tag_sync_error,
    tagSyncedAt: row.tag_synced_at,
    engagelabTags: row.engagelab_tags ? parseJson(row.engagelab_tags, []) : null,
  };
}

export function mapCampaign(row: CampaignRow): Campaign {
  return {
    id: row.id,
    name: row.name,
    videoId: row.video_id,
    title: row.title,
    message: row.message,
    targetingMode: row.targeting_mode,
    targetCategories: parseJson(row.target_categories, []),
    requestedRegistrationIds: parseJson(row.target_registration_ids, []),
    resolvedRegistrationIds: parseJson(row.resolved_registration_ids, []),
    confirmBroadcast: row.confirm_broadcast === 1,
    acknowledgeTagScope: row.acknowledge_tag_scope === 1,
    scheduleTime: row.schedule_time,
    scheduleTimeZone: row.schedule_timezone,
    zoneType: row.zone_type === 1 || row.zone_type === 2 ? row.zone_type : null,
    status: row.status,
    providerMode: row.provider_mode,
    providerMsgIds: parseJson(row.provider_msg_ids, []),
    providerRequestIds: parseJson(row.provider_request_ids, []),
    providerScheduleId: row.provider_schedule_id,
    providerResponse: row.provider_response ? parseJson(row.provider_response, null) : null,
    errorKind: row.error_kind,
    errorMessage: row.error_message,
    experimentId: row.experiment_id,
    variant: row.variant,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submittedAt: row.submitted_at,
    simulated: row.status === 'simulated' || row.provider_mode === 'simulated',
  };
}

export function mapExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    name: row.name,
    videoId: row.video_id,
    variantA: { title: row.variant_a_title, message: row.variant_a_message },
    variantB: { title: row.variant_b_title, message: row.variant_b_message },
    targetingMode: row.targeting_mode,
    targetCategories: parseJson(row.target_categories, []),
    requestedRegistrationIds: parseJson(row.target_registration_ids, []),
    confirmBroadcast: row.confirm_broadcast === 1,
    acknowledgeTagScope: row.acknowledge_tag_scope === 1,
    allocationA: row.allocation_a,
    durationHours: row.duration_hours,
    primaryMetric: row.primary_metric,
    status: row.status,
    startedAt: row.started_at,
    endsAt: row.ends_at,
    campaignAId: row.campaign_a_id,
    campaignBId: row.campaign_b_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function mapEvent(row: EventRow): AppEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    registrationId: row.registration_id,
    userId: row.user_id ?? null,
    campaignId: row.campaign_id,
    videoId: row.video_id,
    experimentId: row.experiment_id,
    variant: row.variant,
    dedupeKey: row.dedupe_key,
    source: row.source,
    metadata: row.metadata ? parseJson(row.metadata, null) : null,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
  };
}
