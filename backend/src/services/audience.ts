import { createHash, randomUUID } from 'node:crypto';
import type { Category, Device } from '../domain.js';
import { HttpError } from '../errors.js';

export interface TargetingInput {
  mode: 'registration_id' | 'registration_ids' | 'category' | 'tag' | 'broadcast';
  registrationId?: string;
  registrationIds?: string[];
  categories?: Category[];
  confirmBroadcast?: boolean;
  acknowledgeTagScope?: boolean;
}

export interface ResolvedAudience {
  registrationIds: string[];
  tags: string[];
  broadcast: boolean;
}

export function resolveAudience(targeting: TargetingInput, devices: Device[]): ResolvedAudience {
  if (targeting.mode === 'broadcast') {
    if (!targeting.confirmBroadcast) {
      throw new HttpError(
        400,
        'BROADCAST_CONFIRMATION_REQUIRED',
        'Broadcast pushes require confirmBroadcast=true. The audience was not widened automatically.',
      );
    }
    return { registrationIds: [], tags: [], broadcast: true };
  }

  if (targeting.mode === 'registration_id') {
    const registrationId = targeting.registrationId?.trim() ?? '';
    if (!registrationId) {
      throw new HttpError(400, 'TARGET_EMPTY', 'A registrationId is required for this targeting mode.');
    }
    return { registrationIds: [registrationId], tags: [], broadcast: false };
  }

  if (targeting.mode === 'registration_ids') {
    const ids = unique(targeting.registrationIds ?? []);
    if (!ids.length) {
      throw new HttpError(400, 'TARGET_EMPTY', 'registrationIds must contain at least one device. The push was not sent to all users.');
    }
    return { registrationIds: ids, tags: [], broadcast: false };
  }

  const categories = unique(targeting.categories ?? []);
  if (!categories.length) {
    throw new HttpError(400, 'TARGET_EMPTY', 'Select at least one category. The push was not sent to all users.');
  }
  const matched = devices
    .filter((device) => device.platform === 'android' && device.categories.some((category) => categories.includes(category)))
    .map((device) => device.registrationId);
  const registrationIds = unique(matched);
  if (!registrationIds.length) {
    throw new HttpError(
      422,
      'TARGET_EMPTY',
      'No stored Android devices match the selected categories. The push was not widened to all users.',
    );
  }
  if (targeting.mode === 'tag' && !targeting.acknowledgeTagScope) {
    throw new HttpError(
      400,
      'TAG_SCOPE_CONFIRMATION_REQUIRED',
      'Tag targeting uses the EngageLab tag audience, which can include devices outside this local database. Set acknowledgeTagScope=true to continue.',
    );
  }
  return { registrationIds, tags: categories, broadcast: false };
}

export function assignVariant(experimentId: string, registrationId: string, allocationA: number): 'A' | 'B' {
  const digest = createHash('sha256').update(`${experimentId}:${registrationId}`).digest();
  const bucket = digest.readUInt32BE(0) % 100;
  return bucket < allocationA ? 'A' : 'B';
}

export function newId(): string {
  return randomUUID();
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
