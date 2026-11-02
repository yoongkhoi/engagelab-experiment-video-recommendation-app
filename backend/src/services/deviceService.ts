import type { AppConfig } from '../config/env.js';
import { CATEGORIES, type Category, type Device } from '../domain.js';
import { nowIso } from '../domain.js';
import { HttpError, ProviderError } from '../errors.js';
import { EngageLabClient } from '../integrations/engagelabClient.js';
import type { Store } from '../repositories/store.js';
import { newId } from './audience.js';
import type { EventService } from './eventService.js';

export class DeviceService {
  constructor(
    private readonly store: Store,
    private readonly client: EngageLabClient,
    private readonly config: AppConfig,
    private readonly events: EventService,
  ) {}

  list(): Device[] {
    return this.store.listDevices();
  }

  get(id: string): Device {
    const device = this.store.getDeviceById(id);
    if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${id} was not found.`);
    return device;
  }

  async register(input: {
    registrationId: string;
    platform: 'android';
    categories?: Category[];
    appVersion?: string;
    deviceType?: Device['deviceType'];
    installationId?: string;
  }): Promise<{ device: Device; deviceToken: string; created: boolean; note: string }> {
    const registrationId = input.registrationId.trim();
    if (!registrationId) {
      throw new HttpError(400, 'REGISTRATION_REQUIRED', 'A Registration ID is required. An empty value was not stored.');
    }
    const installationId = input.installationId?.trim() || null;
    const byInstallation = installationId ? this.store.getDeviceByInstallation(installationId) : undefined;
    const byRegistration = this.store.getDeviceByRegistration(registrationId);
    if (byInstallation && byRegistration && byInstallation.id !== byRegistration.id) {
      throw new HttpError(409, 'DEVICE_CONFLICT', 'This installation and Registration ID are already stored as different devices.');
    }
    const existing = byInstallation ?? byRegistration;
    const categories = input.categories ?? existing?.categories ?? ['tech', 'funny', 'lifestyle'];
    const now = nowIso();
    if (!existing) {
      const deviceToken = newId().replace(/-/g, '') + newId().replace(/-/g, '');
      const device: Device & { deviceToken: string } = {
        id: newId(),
        registrationId,
        platform: input.platform,
        deviceType: input.deviceType ?? null,
        installationId,
        categories,
        appVersion: input.appVersion ?? null,
        registeredAt: now,
        updatedAt: now,
        lastSeenAt: now,
        tagSyncStatus: 'pending',
        tagSyncError: null,
        tagSyncedAt: null,
        engagelabTags: null,
        deviceToken,
      };
      this.store.insertDevice(device);
      this.events.record({
        eventType: 'device_registered',
        registrationId: device.registrationId,
        source: 'server',
        dedupeKey: `device_registered:${device.registrationId}`,
        metadata: { platform: device.platform },
      });
      const synced = await this.syncTags(device.id);
      return {
        device: synced,
        deviceToken,
        created: true,
        note: 'The Registration ID was stored by this backend after the Android SDK reported it. This response does not mean EngageLab issued a new Registration ID. Tag synchronization is reported separately in tagSyncStatus.',
      };
    }

    const updated: Device = {
      ...existing,
      registrationId,
      platform: input.platform,
      deviceType: input.deviceType ?? existing.deviceType,
      installationId: installationId ?? existing.installationId,
      categories,
      appVersion: input.appVersion ?? existing.appVersion,
      updatedAt: now,
      lastSeenAt: now,
    };
    try {
      this.store.updateDevice(updated);
    } catch (error) {
      if (error instanceof Error && /UNIQUE/i.test(error.message)) {
        throw new HttpError(409, 'REGISTRATION_IN_USE', 'That Registration ID is already stored for a different installation.');
      }
      throw error;
    }
    const synced = await this.syncTags(updated.id);
    return {
      device: synced,
      deviceToken: existing.deviceToken,
      created: false,
      note: 'Existing device updated. The same device token was returned so a reinstall that still has this Registration ID can keep calling the API.',
    };
  }

  async updatePreferences(id: string, categories: Category[], actor: 'admin' | 'device'): Promise<Device> {
    const current = this.store.getDeviceById(id);
    if (!current) throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${id} was not found.`);
    if (actor !== 'admin' && actor !== 'device') {
      throw new HttpError(401, 'UNAUTHORIZED', 'Device preferences require the device token or an admin key.');
    }
    const updated: Device = { ...current, categories, updatedAt: nowIso(), lastSeenAt: nowIso() };
    this.store.updateDevice(updated);
    return this.syncTags(updated.id);
  }

  async syncTags(id: string): Promise<Device> {
    const current = this.store.getDeviceById(id);
    if (!current) throw new HttpError(404, 'DEVICE_NOT_FOUND', `Device ${id} was not found.`);
    const desired = current.categories;
    const remove = CATEGORIES.filter((category) => !desired.includes(category));

    if (!this.config.engagelab.configured) {
      const skipped: Device = {
        ...current,
        tagSyncStatus: 'skipped',
        tagSyncError: 'EngageLab credentials are not configured. Categories were saved locally only. This is not a successful tag synchronization.',
        tagSyncedAt: null,
        updatedAt: nowIso(),
      };
      this.store.updateDevice(skipped);
      return skipped;
    }

    try {
      if (desired.length || remove.length) {
        try {
          await this.client.setDeviceTags(current.registrationId, desired, remove);
        } catch (error) {
          if (!(error instanceof ProviderError) || error.providerCode !== 27012) throw error;
          for (const tag of desired) {
            await this.client.addRegistrationIdsToTag(tag, [current.registrationId]);
          }
        }
      }
      const remote = await this.client.getDevice(current.registrationId);
      const missing = desired.filter((tag) => !remote.tags.includes(tag));
      const synced: Device = {
        ...current,
        engagelabTags: remote.tags,
        tagSyncedAt: nowIso(),
        updatedAt: nowIso(),
        tagSyncStatus: missing.length ? 'unknown' : 'synced',
        tagSyncError: missing.length
          ? `EngageLab device query did not include expected tags: ${missing.join(', ')}. Synchronization is not marked successful.`
          : null,
      };
      this.store.updateDevice(synced);
      return synced;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tag synchronization failed';
      const failed: Device = {
        ...current,
        tagSyncStatus: 'failed',
        tagSyncError: message,
        updatedAt: nowIso(),
      };
      this.store.updateDevice(failed);
      return failed;
    }
  }

  requireDeviceToken(id: string, token: string | undefined): Device {
    const device = this.store.getDeviceById(id);
    if (!device || !token || token !== device.deviceToken) {
      throw new HttpError(401, 'UNAUTHORIZED', 'A valid device token is required.');
    }
    return device;
  }
}
