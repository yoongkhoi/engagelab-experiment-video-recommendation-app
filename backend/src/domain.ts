export const CATEGORIES = ['tech', 'funny', 'lifestyle'] as const;
export type Category = (typeof CATEGORIES)[number];

export const EVENT_TYPES = [
  'device_registered',
  'push_submitted',
  'notification_opened',
  'video_opened',
  'video_play_started',
  'video_play_completed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export type CampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'submitted'
  | 'accepted_by_provider'
  | 'simulated'
  | 'failed'
  | 'unknown';

export interface Video {
  id: string;
  title: string;
  description: string;
  category: string;
  sourceType: 'remote' | 'asset';
  source: string;
  assetFilename: string | null;
  thumbnailUrl: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: string;
  registrationId: string;
  platform: 'android';
  deviceType: 'emulator' | 'phone' | 'tablet' | null;
  installationId: string | null;
  categories: Category[];
  appVersion: string | null;
  registeredAt: string;
  updatedAt: string;
  lastSeenAt: string;
  tagSyncStatus: 'pending' | 'synced' | 'failed' | 'skipped' | 'unknown';
  tagSyncError: string | null;
  tagSyncedAt: string | null;
  engagelabTags: string[] | null;
}

export interface Campaign {
  id: string;
  name: string;
  videoId: string;
  title: string;
  message: string;
  targetingMode: 'registration_id' | 'registration_ids' | 'category' | 'tag' | 'broadcast';
  targetCategories: Category[];
  requestedRegistrationIds: string[];
  resolvedRegistrationIds: string[];
  confirmBroadcast: boolean;
  acknowledgeTagScope: boolean;
  scheduleTime: string | null;
  scheduleTimeZone: string | null;
  zoneType: 1 | 2 | null;
  status: CampaignStatus;
  providerMode: 'live' | 'simulated' | 'not_sent';
  providerMsgIds: string[];
  providerRequestIds: string[];
  providerScheduleId: string | null;
  providerResponse: unknown;
  errorKind: string | null;
  errorMessage: string | null;
  experimentId: string | null;
  variant: 'A' | 'B' | null;
  createdAt: string;
  updatedAt: string;
  submittedAt: string | null;
  simulated: boolean;
}

export interface Experiment {
  id: string;
  name: string;
  videoId: string;
  variantA: { title: string; message: string };
  variantB: { title: string; message: string };
  targetingMode: Campaign['targetingMode'];
  targetCategories: Category[];
  requestedRegistrationIds: string[];
  confirmBroadcast: boolean;
  acknowledgeTagScope: boolean;
  allocationA: number;
  durationHours: number;
  primaryMetric: 'notification_opened' | 'video_play_started';
  status: 'draft' | 'running' | 'failed' | 'completed';
  startedAt: string | null;
  endsAt: string | null;
  campaignAId: string | null;
  campaignBId: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Assignment {
  experimentId: string;
  registrationId: string;
  variant: 'A' | 'B';
  assignedAt: string;
}

export interface AppEvent {
  id: string;
  eventType: EventType;
  registrationId: string | null;
  campaignId: string | null;
  videoId: string | null;
  experimentId: string | null;
  variant: 'A' | 'B' | null;
  dedupeKey: string | null;
  source: 'device' | 'server' | 'simulation';
  metadata: unknown;
  occurredAt: string;
  createdAt: string;
  duplicate?: boolean;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  return JSON.parse(value) as T;
}
