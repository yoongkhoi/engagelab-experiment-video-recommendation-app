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
  userId: string | null;
  notificationEnabled: boolean;
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
  targetCategories: string[];
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
  targetCategories: string[];
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

export interface ExperimentSimulation {
  id: string;
  experimentId: string;
  syntheticUsers: number;
  variantA: number;
  variantB: number;
  note: string;
  createdAt: string;
}

export interface ExperimentTestSend {
  id: string;
  experimentId: string;
  variant: 'A' | 'B';
  registrationHint: string;
  campaignId: string | null;
  simulated: boolean;
  providerStatus: string | null;
  deviceDeliveryVerified: false;
  createdAt: string;
}

export const VIDEO_PREFERENCE_CATEGORIES = [
  'travel', 'nature', 'food', 'technology', 'sports', 'motorsport', 'animals', 'entertainment',
  'music', 'fashion', 'design', 'gaming', 'science', 'lifestyle', 'fitness', 'photography', 'architecture',
] as const;

export const INTEREST_CATALOG = [
  { id: 'nature', label: 'Nature', suggestions: ['Waterfalls', 'Mountains', 'Wildlife', 'Ocean'] },
  { id: 'travel', label: 'Travel', suggestions: ['Cities', 'Road trips', 'Beaches'] },
  { id: 'food', label: 'Food', suggestions: ['Street Food', 'Cooking', 'Desserts', 'Restaurants'] },
  { id: 'technology', label: 'Technology', suggestions: ['Gadgets', 'Software', 'Engineering'] },
  { id: 'sports', label: 'Sports', suggestions: ['Football', 'Basketball', 'Outdoor sports'] },
  { id: 'motorsport', label: 'Motorsport & Cars', suggestions: ['Formula 1', 'Motorsport', 'Supercars', 'Automotive Technology'] },
  { id: 'animals', label: 'Animals', suggestions: ['Pets', 'Wildlife', 'Ocean life'] },
  { id: 'entertainment', label: 'Movies & Entertainment', suggestions: ['Film', 'Stories', 'Performance'] },
  { id: 'music', label: 'Music', suggestions: ['Performance', 'Instruments', 'Concerts'] },
  { id: 'fashion', label: 'Fashion & Beauty', suggestions: ['Fashion', 'Skincare', 'Makeup', 'Design'] },
  { id: 'design', label: 'Design & Art', suggestions: ['Illustration', 'Interiors', 'Graphic design'] },
  { id: 'gaming', label: 'Gaming', suggestions: ['Gameplay', 'Esports'] },
  { id: 'science', label: 'Science & Education', suggestions: ['Experiments', 'Space', 'Learning'] },
  { id: 'lifestyle', label: 'Lifestyle', suggestions: ['Daily life', 'Home'] },
  { id: 'fitness', label: 'Fitness', suggestions: ['Training', 'Wellness'] },
  { id: 'photography', label: 'Photography', suggestions: ['Cameras', 'Landscapes'] },
  { id: 'architecture', label: 'Architecture', suggestions: ['Buildings', 'Cities'] },
] as const;
export type VideoPreference = (typeof VIDEO_PREFERENCE_CATEGORIES)[number];

export interface AppUser {
  id: string;
  normalizedEmail: string;
  displayName: string | null;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  accountStatus: 'active' | 'deleted';
}

export interface UserPreferenceRecord {
  userId: string;
  categories: VideoPreference[];
  createdAt: string;
  updatedAt: string;
}

export interface AppEvent {
  id: string;
  eventType: EventType;
  registrationId: string | null;
  userId: string | null;
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
