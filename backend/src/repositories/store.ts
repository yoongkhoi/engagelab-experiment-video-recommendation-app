import type { Sqlite } from '../db/database.js';
import type { AppEvent, Assignment, Campaign, Device, Experiment, Video } from '../domain.js';
import {
  mapCampaign,
  mapDevice,
  mapEvent,
  mapExperiment,
  mapVideo,
  type CampaignRow,
  type DeviceRow,
  type EventRow,
  type ExperimentRow,
  type VideoRow,
} from './mappers.js';

export class Store {
  constructor(private readonly db: Sqlite) {}

  listVideos(activeOnly: boolean): Video[] {
    const sql = activeOnly
      ? 'SELECT * FROM videos WHERE active = 1 ORDER BY created_at ASC'
      : 'SELECT * FROM videos ORDER BY created_at ASC';
    return this.db.all<VideoRow>(sql).map(mapVideo);
  }

  getVideo(id: string): Video | undefined {
    const row = this.db.get<VideoRow>('SELECT * FROM videos WHERE id = ?', id);
    return row ? mapVideo(row) : undefined;
  }

  insertVideo(video: Video): void {
    this.db.run(
      `INSERT INTO videos
        (id, title, description, category, source_type, source, asset_filename, thumbnail_url, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      video.id,
      video.title,
      video.description,
      video.category,
      video.sourceType,
      video.source,
      video.assetFilename,
      video.thumbnailUrl,
      video.active ? 1 : 0,
      video.createdAt,
      video.updatedAt,
    );
  }

  updateVideo(video: Video): void {
    this.db.run(
      `UPDATE videos SET title=?, description=?, category=?, source_type=?, source=?, asset_filename=?, thumbnail_url=?, active=?, updated_at=? WHERE id=?`,
      video.title,
      video.description,
      video.category,
      video.sourceType,
      video.source,
      video.assetFilename,
      video.thumbnailUrl,
      video.active ? 1 : 0,
      video.updatedAt,
      video.id,
    );
  }

  deleteVideo(id: string): void {
    this.db.run('DELETE FROM videos WHERE id = ?', id);
  }

  countCampaignsForVideo(id: string): number {
    return this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM campaigns WHERE video_id = ?', id)?.count ?? 0;
  }

  getDeviceByRegistration(registrationId: string): (Device & { deviceToken: string }) | undefined {
    const row = this.db.get<DeviceRow>('SELECT * FROM devices WHERE registration_id = ?', registrationId);
    return row ? { ...mapDevice(row), deviceToken: row.device_token } : undefined;
  }

  getDeviceByInstallation(installationId: string): (Device & { deviceToken: string }) | undefined {
    const row = this.db.get<DeviceRow>(
      'SELECT * FROM devices WHERE installation_id = ? AND installation_id IS NOT NULL',
      installationId,
    );
    return row ? { ...mapDevice(row), deviceToken: row.device_token } : undefined;
  }

  getDeviceById(id: string): (Device & { deviceToken: string }) | undefined {
    const row = this.db.get<DeviceRow>('SELECT * FROM devices WHERE id = ? OR registration_id = ?', id, id);
    return row ? { ...mapDevice(row), deviceToken: row.device_token } : undefined;
  }

  listDevices(): Device[] {
    return this.db.all<DeviceRow>('SELECT * FROM devices ORDER BY registered_at DESC').map(mapDevice);
  }

  insertDevice(input: Device & { deviceToken: string }): void {
    this.db.run(
      `INSERT INTO devices
        (id, registration_id, platform, categories, device_token, app_version, registered_at, updated_at, last_seen_at, tag_sync_status, tag_sync_error, tag_synced_at, engagelab_tags, device_type, installation_id, user_id, notification_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.id,
      input.registrationId,
      input.platform,
      JSON.stringify(input.categories),
      input.deviceToken,
      input.appVersion,
      input.registeredAt,
      input.updatedAt,
      input.lastSeenAt,
      input.tagSyncStatus,
      input.tagSyncError,
      input.tagSyncedAt,
      input.engagelabTags ? JSON.stringify(input.engagelabTags) : null,
      input.deviceType,
      input.installationId,
      input.userId,
      input.notificationEnabled ? 1 : 0,
    );
  }

  updateDevice(input: Device): void {
    this.db.run(
      `UPDATE devices SET registration_id=?, platform=?, categories=?, app_version=?, updated_at=?, last_seen_at=?, tag_sync_status=?, tag_sync_error=?, tag_synced_at=?, engagelab_tags=?, device_type=?, installation_id=?, user_id=?, notification_enabled=? WHERE id=?`,
      input.registrationId,
      input.platform,
      JSON.stringify(input.categories),
      input.appVersion,
      input.updatedAt,
      input.lastSeenAt,
      input.tagSyncStatus,
      input.tagSyncError,
      input.tagSyncedAt,
      input.engagelabTags ? JSON.stringify(input.engagelabTags) : null,
      input.deviceType,
      input.installationId,
      input.userId,
      input.notificationEnabled ? 1 : 0,
      input.id,
    );
  }

  touchDevice(registrationId: string, seenAt: string): void {
    this.db.run('UPDATE devices SET last_seen_at = ? WHERE registration_id = ?', seenAt, registrationId);
  }

  insertCampaign(campaign: Campaign): void {
    this.writeCampaign(campaign, true);
  }

  updateCampaign(campaign: Campaign): void {
    this.writeCampaign(campaign, false);
  }

  private writeCampaign(campaign: Campaign, insert: boolean): void {
    const values = [
      campaign.name,
      campaign.videoId,
      campaign.title,
      campaign.message,
      campaign.targetingMode,
      JSON.stringify(campaign.targetCategories),
      JSON.stringify(campaign.requestedRegistrationIds),
      JSON.stringify(campaign.resolvedRegistrationIds),
      campaign.confirmBroadcast ? 1 : 0,
      campaign.acknowledgeTagScope ? 1 : 0,
      campaign.scheduleTime,
      campaign.scheduleTimeZone,
      campaign.zoneType,
      campaign.status,
      campaign.providerMode,
      JSON.stringify(campaign.providerMsgIds),
      JSON.stringify(campaign.providerRequestIds),
      campaign.providerScheduleId,
      campaign.providerResponse === null ? null : JSON.stringify(campaign.providerResponse),
      campaign.errorKind,
      campaign.errorMessage,
      campaign.experimentId,
      campaign.variant,
      campaign.updatedAt,
      campaign.submittedAt,
    ];
    if (insert) {
      this.db.run(
        `INSERT INTO campaigns
          (name, video_id, title, message, targeting_mode, target_categories, target_registration_ids, resolved_registration_ids,
           confirm_broadcast, acknowledge_tag_scope, schedule_time, schedule_timezone, zone_type, status, provider_mode,
           provider_msg_ids, provider_request_ids, provider_schedule_id, provider_response, error_kind, error_message,
           experiment_id, variant, updated_at, submitted_at, id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...values,
        campaign.id,
        campaign.createdAt,
      );
      return;
    }
    this.db.run(
      `UPDATE campaigns SET
        name=?, video_id=?, title=?, message=?, targeting_mode=?, target_categories=?, target_registration_ids=?,
        resolved_registration_ids=?, confirm_broadcast=?, acknowledge_tag_scope=?, schedule_time=?, schedule_timezone=?,
        zone_type=?, status=?, provider_mode=?, provider_msg_ids=?, provider_request_ids=?, provider_schedule_id=?,
        provider_response=?, error_kind=?, error_message=?, experiment_id=?, variant=?, updated_at=?, submitted_at=?
       WHERE id=?`,
      ...values,
      campaign.id,
    );
  }

  getCampaign(id: string): Campaign | undefined {
    const row = this.db.get<CampaignRow>('SELECT * FROM campaigns WHERE id = ?', id);
    return row ? mapCampaign(row) : undefined;
  }

  listCampaigns(): Campaign[] {
    return this.db.all<CampaignRow>('SELECT * FROM campaigns ORDER BY created_at DESC').map(mapCampaign);
  }

  insertExperiment(experiment: Experiment): void {
    this.db.run(
      `INSERT INTO experiments
        (id, name, video_id, variant_a_title, variant_a_message, variant_b_title, variant_b_message, targeting_mode,
         target_categories, target_registration_ids, confirm_broadcast, acknowledge_tag_scope, allocation_a, duration_hours,
         primary_metric, status, started_at, ends_at, campaign_a_id, campaign_b_id, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      experiment.id,
      experiment.name,
      experiment.videoId,
      experiment.variantA.title,
      experiment.variantA.message,
      experiment.variantB.title,
      experiment.variantB.message,
      experiment.targetingMode,
      JSON.stringify(experiment.targetCategories),
      JSON.stringify(experiment.requestedRegistrationIds),
      experiment.confirmBroadcast ? 1 : 0,
      experiment.acknowledgeTagScope ? 1 : 0,
      experiment.allocationA,
      experiment.durationHours,
      experiment.primaryMetric,
      experiment.status,
      experiment.startedAt,
      experiment.endsAt,
      experiment.campaignAId,
      experiment.campaignBId,
      experiment.errorMessage,
      experiment.createdAt,
      experiment.updatedAt,
    );
  }

  updateExperiment(experiment: Experiment): void {
    this.db.run(
      `UPDATE experiments SET status=?, started_at=?, ends_at=?, campaign_a_id=?, campaign_b_id=?, error_message=?, updated_at=? WHERE id=?`,
      experiment.status,
      experiment.startedAt,
      experiment.endsAt,
      experiment.campaignAId,
      experiment.campaignBId,
      experiment.errorMessage,
      experiment.updatedAt,
      experiment.id,
    );
  }

  getExperiment(id: string): Experiment | undefined {
    const row = this.db.get<ExperimentRow>('SELECT * FROM experiments WHERE id = ?', id);
    return row ? mapExperiment(row) : undefined;
  }

  listExperiments(): Experiment[] {
    return this.db.all<ExperimentRow>('SELECT * FROM experiments ORDER BY created_at DESC').map(mapExperiment);
  }

  insertAssignment(assignment: Assignment): void {
    this.db.run(
      `INSERT INTO experiment_assignments (experiment_id, registration_id, variant, assigned_at) VALUES (?, ?, ?, ?)`,
      assignment.experimentId,
      assignment.registrationId,
      assignment.variant,
      assignment.assignedAt,
    );
  }

  getAssignment(experimentId: string, registrationId: string): Assignment | undefined {
    return this.db.get<Assignment>(
      `SELECT experiment_id AS experimentId, registration_id AS registrationId, variant, assigned_at AS assignedAt
       FROM experiment_assignments WHERE experiment_id = ? AND registration_id = ?`,
      experimentId,
      registrationId,
    );
  }

  listAssignments(experimentId: string): Assignment[] {
    return this.db.all<Assignment>(
      `SELECT experiment_id AS experimentId, registration_id AS registrationId, variant, assigned_at AS assignedAt
       FROM experiment_assignments WHERE experiment_id = ? ORDER BY registration_id`,
      experimentId,
    );
  }

  insertSimulation(row: import('../domain.js').ExperimentSimulation): void {
    this.db.run(
      `INSERT INTO experiment_simulations (id, experiment_id, synthetic_users, variant_a, variant_b, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.experimentId, row.syntheticUsers, row.variantA, row.variantB, row.note, row.createdAt,
    );
  }

  listSimulations(experimentId: string): import('../domain.js').ExperimentSimulation[] {
    return this.db.all(
      `SELECT id, experiment_id AS experimentId, synthetic_users AS syntheticUsers, variant_a AS variantA,
              variant_b AS variantB, note, created_at AS createdAt
       FROM experiment_simulations WHERE experiment_id = ? ORDER BY created_at DESC`,
      experimentId,
    );
  }

  insertTestSend(row: import('../domain.js').ExperimentTestSend): void {
    this.db.run(
      `INSERT INTO experiment_test_sends
        (id, experiment_id, variant, registration_hint, campaign_id, simulated, provider_status, device_delivery_verified, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      row.id, row.experimentId, row.variant, row.registrationHint, row.campaignId, row.simulated ? 1 : 0, row.providerStatus, row.createdAt,
    );
  }

  listTestSends(experimentId: string): import('../domain.js').ExperimentTestSend[] {
    const rows = this.db.all<{
      id: string; experimentId: string; variant: 'A' | 'B'; registrationHint: string; campaignId: string | null;
      simulated: number; providerStatus: string | null; createdAt: string;
    }>(
      `SELECT id, experiment_id AS experimentId, variant, registration_hint AS registrationHint, campaign_id AS campaignId,
              simulated, provider_status AS providerStatus, created_at AS createdAt
       FROM experiment_test_sends WHERE experiment_id = ? ORDER BY created_at DESC`,
      experimentId,
    );
    return rows.map((row) => ({ ...row, simulated: row.simulated === 1, deviceDeliveryVerified: false as const }));
  }

  insertEvent(event: AppEvent): void {
    this.db.run(
      `INSERT INTO events
        (id, event_type, registration_id, campaign_id, video_id, experiment_id, variant, dedupe_key, source, metadata, occurred_at, created_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.id,
      event.eventType,
      event.registrationId,
      event.campaignId,
      event.videoId,
      event.experimentId,
      event.variant,
      event.dedupeKey,
      event.source,
      event.metadata === null || event.metadata === undefined ? null : JSON.stringify(event.metadata),
      event.occurredAt,
      event.createdAt,
      event.userId,
    );
  }

  findEventByDedupe(eventType: string, dedupeKey: string): AppEvent | undefined {
    const row = this.db.get<EventRow>('SELECT * FROM events WHERE event_type = ? AND dedupe_key = ?', eventType, dedupeKey);
    return row ? mapEvent(row) : undefined;
  }

  listEvents(): AppEvent[] {
    return this.db.all<EventRow>('SELECT * FROM events ORDER BY occurred_at DESC').map(mapEvent);
  }

  countEvents(filters: { eventType?: string; source?: string; campaignId?: string; videoId?: string; experimentId?: string; variant?: string; from?: string; to?: string }): number {
    const where: string[] = [];
    const params: Array<string | number | null> = [];
    if (filters.eventType) {
      where.push('event_type = ?');
      params.push(filters.eventType);
    }
    if (filters.source) {
      where.push('source = ?');
      params.push(filters.source);
    }
    if (filters.campaignId) {
      where.push('campaign_id = ?');
      params.push(filters.campaignId);
    }
    if (filters.videoId) {
      where.push('video_id = ?');
      params.push(filters.videoId);
    }
    if (filters.experimentId) {
      where.push('experiment_id = ?');
      params.push(filters.experimentId);
    }
    if (filters.variant) {
      where.push('variant = ?');
      params.push(filters.variant);
    }
    if (filters.from) {
      where.push('occurred_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      where.push('occurred_at <= ?');
      params.push(filters.to);
    }
    const sql = `SELECT COUNT(*) AS count FROM events${where.length ? ` WHERE ${where.join(' AND ')}` : ''}`;
    return this.db.get<{ count: number }>(sql, ...params)?.count ?? 0;
  }

  insertUser(user: import('../domain.js').AppUser): void {
    this.db.run(
      `INSERT INTO users (id, normalized_email, display_name, created_at, updated_at, last_login_at, account_status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      user.id, user.normalizedEmail, user.displayName, user.createdAt, user.updatedAt, user.lastLoginAt, user.accountStatus,
    );
  }

  getUserByEmail(email: string): import('../domain.js').AppUser | undefined {
    return this.db.get(
      `SELECT id, normalized_email AS normalizedEmail, display_name AS displayName, created_at AS createdAt,
              updated_at AS updatedAt, last_login_at AS lastLoginAt, account_status AS accountStatus
       FROM users WHERE normalized_email = ?`,
      email,
    );
  }

  getUser(id: string): import('../domain.js').AppUser | undefined {
    return this.db.get(
      `SELECT id, normalized_email AS normalizedEmail, display_name AS displayName, created_at AS createdAt,
              updated_at AS updatedAt, last_login_at AS lastLoginAt, account_status AS accountStatus
       FROM users WHERE id = ?`,
      id,
    );
  }

  touchUserLogin(id: string, at: string): void {
    this.db.run('UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?', at, at, id);
  }

  updateDisplayName(id: string, displayName: string, at: string): void {
    this.db.run('UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?', displayName, at, id);
  }

  insertChallenge(row: { id: string; email: string; otpHash: string; expiresAt: string; createdAt: string; requestIp: string | null }): void {
    this.db.run(
      `INSERT INTO auth_challenges (id, normalized_email, otp_hash, expires_at, attempts, consumed_at, request_ip, created_at)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?)`,
      row.id, row.email, row.otpHash, row.expiresAt, row.requestIp, row.createdAt,
    );
  }

  latestChallenge(email: string): { id: string; otpHash: string; expiresAt: string; attempts: number; consumedAt: string | null; createdAt: string } | undefined {
    return this.db.get(
      `SELECT id, otp_hash AS otpHash, expires_at AS expiresAt, attempts, consumed_at AS consumedAt, created_at AS createdAt
       FROM auth_challenges WHERE normalized_email = ? ORDER BY created_at DESC LIMIT 1`,
      email,
    );
  }

  countChallengesSince(email: string, since: string): number {
    return this.db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM auth_challenges WHERE normalized_email = ? AND created_at >= ?',
      email, since,
    )?.count ?? 0;
  }

  countChallengesByIpSince(ip: string, since: string): number {
    return this.db.get<{ count: number }>(
      'SELECT COUNT(*) AS count FROM auth_challenges WHERE request_ip = ? AND created_at >= ?',
      ip, since,
    )?.count ?? 0;
  }

  markChallengeAttempt(id: string, attempts: number, consumedAt: string | null): void {
    this.db.run('UPDATE auth_challenges SET attempts = ?, consumed_at = ? WHERE id = ?', attempts, consumedAt, id);
  }

  insertSession(row: { id: string; userId: string; tokenHash: string; expiresAt: string; createdAt: string }): void {
    this.db.run(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?, ?, ?, ?, NULL, ?)`,
      row.id, row.userId, row.tokenHash, row.expiresAt, row.createdAt,
    );
  }

  getSessionByHash(tokenHash: string): { id: string; userId: string; expiresAt: string; revokedAt: string | null } | undefined {
    return this.db.get(
      `SELECT id, user_id AS userId, expires_at AS expiresAt, revoked_at AS revokedAt FROM sessions WHERE token_hash = ?`,
      tokenHash,
    );
  }

  revokeSession(tokenHash: string, at: string): void {
    this.db.run('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL', at, tokenHash);
  }

  revokeUserSessions(userId: string, at: string): void {
    this.db.run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', at, userId);
  }

  setPasswordHash(id: string, passwordHash: string, at: string): void {
    this.db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', passwordHash, at, id);
  }

  passwordHash(id: string): string | null {
    return this.db.get<{ password_hash: string | null }>('SELECT password_hash FROM users WHERE id = ?', id)?.password_hash ?? null;
  }

  setAccountStatus(id: string, status: 'active' | 'deleted', at: string): void {
    this.db.run('UPDATE users SET account_status = ?, updated_at = ? WHERE id = ?', status, at, id);
  }

  getPreferences(userId: string): import('../domain.js').UserPreferenceRecord | undefined {
    const row = this.db.get<{ userId: string; categories: string; createdAt: string; updatedAt: string }>(
      `SELECT user_id AS userId, categories, created_at AS createdAt, updated_at AS updatedAt FROM user_preferences WHERE user_id = ?`,
      userId,
    );
    if (!row) return undefined;
    return { ...row, categories: JSON.parse(row.categories) };
  }

  savePreferences(record: import('../domain.js').UserPreferenceRecord): void {
    this.db.run(
      `INSERT INTO user_preferences (user_id, categories, created_at, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET categories = excluded.categories, updated_at = excluded.updated_at`,
      record.userId, JSON.stringify(record.categories), record.createdAt, record.updatedAt,
    );
  }

  clearDeviceUser(installationId: string, userId: string): void {
    this.db.run(
      'UPDATE devices SET user_id = NULL, updated_at = ? WHERE installation_id = ? AND user_id = ?',
      new Date().toISOString(), installationId, userId,
    );
  }

  disassociateDevice(id: string): void {
    this.db.run('UPDATE devices SET user_id = NULL, updated_at = ? WHERE id = ?', new Date().toISOString(), id);
  }

  devicesForUser(userId: string): Device[] {
    return this.db.all<DeviceRow>('SELECT * FROM devices WHERE user_id = ? ORDER BY updated_at DESC', userId).map(mapDevice);
  }

  listUsers(): import('../domain.js').AppUser[] {
    return this.db.all(
      `SELECT id, normalized_email AS normalizedEmail, display_name AS displayName, created_at AS createdAt,
              updated_at AS updatedAt, last_login_at AS lastLoginAt, account_status AS accountStatus
       FROM users ORDER BY created_at DESC`,
    );
  }
}
