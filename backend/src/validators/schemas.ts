import { z } from 'zod';
import { CATEGORIES, EVENT_TYPES } from '../domain.js';

const category = z.enum(CATEGORIES);
const registrationId = z.string().trim().min(5).max(128).regex(/^[A-Za-z0-9_:\-]+$/, 'Registration ID contains unsupported characters');
const videoId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9_\-]+$/);

export const videoSchema = z.object({
  id: videoId.optional(),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(2000),
  category,
  sourceType: z.enum(['remote', 'asset']),
  source: z.string().trim().min(1).max(2000),
  assetFilename: z.string().trim().min(1).max(120).nullable().optional(),
  thumbnailUrl: z.string().trim().url().nullable().optional(),
  active: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.sourceType === 'remote' && !/^https:\/\//.test(value.source)) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Remote videos must use an https URL.' });
  }
  if (value.sourceType === 'asset' && value.source.includes('..')) {
    context.addIssue({ code: 'custom', path: ['source'], message: 'Asset names cannot contain parent path segments.' });
  }
});

export const registerDeviceSchema = z.preprocess((input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const body = input as Record<string, unknown>;
  return {
    ...body,
    registrationId: body.registrationId ?? body.registration_id,
    deviceType: body.deviceType ?? body.device_type,
    installationId: body.installationId ?? body.device_id ?? body.deviceId,
  };
}, z.object({
  registrationId,
  platform: z.literal('android'),
  categories: z.array(category).min(1).max(3).optional(),
  appVersion: z.string().trim().max(40).optional(),
  deviceType: z.enum(['emulator', 'phone', 'tablet']).optional(),
  installationId: z.string().trim().min(8).max(64).regex(/^[A-Za-z0-9_\-]+$/).optional(),
}));

export const preferencesSchema = z.object({
  categories: z.array(category).min(1).max(3),
});

export const targetingSchema = z.object({
  mode: z.enum(['registration_id', 'registration_ids', 'category', 'tag', 'broadcast']),
  registrationId: registrationId.optional(),
  registrationIds: z.array(registrationId).max(5000).optional(),
  categories: z.array(category).max(3).optional(),
  confirmBroadcast: z.boolean().optional(),
  acknowledgeTagScope: z.boolean().optional(),
});

export const campaignSchema = z.object({
  name: z.string().trim().min(1).max(120),
  videoId,
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(300),
  targeting: targetingSchema,
  delivery: z.enum(['draft', 'immediate', 'scheduled']).default('draft'),
  scheduleTime: z.string().trim().optional(),
  timeZone: z.string().trim().optional(),
  zoneType: z.union([z.literal(1), z.literal(2)]).optional(),
});

export const scheduleSchema = z.object({
  scheduleTime: z.string().trim(),
  timeZone: z.string().trim().min(1),
  zoneType: z.union([z.literal(1), z.literal(2)]).default(1),
  confirmBroadcast: z.boolean().optional(),
  acknowledgeTagScope: z.boolean().optional(),
});

export const sendSchema = z.object({
  confirmBroadcast: z.boolean().optional(),
  acknowledgeTagScope: z.boolean().optional(),
}).default({});

export const experimentSchema = z.object({
  name: z.string().trim().min(1).max(120),
  videoId,
  variantA: z.object({ title: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(300) }),
  variantB: z.object({ title: z.string().trim().min(1).max(100), message: z.string().trim().min(1).max(300) }),
  targeting: targetingSchema,
  allocationA: z.number().int().min(1).max(99),
  durationHours: z.number().int().min(1).max(24 * 30),
  primaryMetric: z.enum(['notification_opened', 'video_play_started']),
});

export const eventSchema = z.object({
  eventType: z.enum(EVENT_TYPES),
  registrationId,
  campaignId: z.string().uuid().optional(),
  videoId: videoId.optional(),
  experimentId: z.string().uuid().optional(),
  variant: z.enum(['A', 'B']).optional(),
  dedupeKey: z.string().trim().min(1).max(200).optional(),
  occurredAt: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const testPushSchema = z.object({
  registrationId,
  videoId: videoId.optional(),
});
