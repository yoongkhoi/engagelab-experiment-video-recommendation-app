import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | null;

export class Sqlite {
  constructor(private readonly db: DatabaseSync) {}

  static open(filename: string): Sqlite {
    if (filename !== ':memory:') {
      fs.mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    }
    const db = new DatabaseSync(filename);
    db.exec('PRAGMA foreign_keys = ON');
    if (filename !== ':memory:') {
      db.prepare('PRAGMA journal_mode = WAL').get();
    }
    return new Sqlite(db);
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, ...params: SqlValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  get<T>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: SqlValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  transaction<T>(fn: () => T): T {
    this.exec('BEGIN');
    try {
      const result = fn();
      this.exec('COMMIT');
      return result;
    } catch (error) {
      this.exec('ROLLBACK');
      throw error;
    }
  }

  close(): void {
    this.db.close();
  }
}

export function migrate(db: Sqlite): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source TEXT NOT NULL,
      asset_filename TEXT,
      thumbnail_url TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      registration_id TEXT NOT NULL UNIQUE,
      platform TEXT NOT NULL,
      categories TEXT NOT NULL,
      device_token TEXT NOT NULL,
      app_version TEXT,
      registered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      tag_sync_status TEXT NOT NULL,
      tag_sync_error TEXT,
      tag_synced_at TEXT,
      engagelab_tags TEXT,
      device_type TEXT,
      installation_id TEXT,
      user_id TEXT,
      notification_enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      targeting_mode TEXT NOT NULL,
      target_categories TEXT,
      target_registration_ids TEXT,
      resolved_registration_ids TEXT,
      confirm_broadcast INTEGER NOT NULL DEFAULT 0,
      acknowledge_tag_scope INTEGER NOT NULL DEFAULT 0,
      schedule_time TEXT,
      schedule_timezone TEXT,
      zone_type INTEGER,
      status TEXT NOT NULL,
      provider_mode TEXT NOT NULL,
      provider_msg_ids TEXT,
      provider_request_ids TEXT,
      provider_schedule_id TEXT,
      provider_response TEXT,
      error_kind TEXT,
      error_message TEXT,
      experiment_id TEXT,
      variant TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      submitted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      video_id TEXT NOT NULL,
      variant_a_title TEXT NOT NULL,
      variant_a_message TEXT NOT NULL,
      variant_b_title TEXT NOT NULL,
      variant_b_message TEXT NOT NULL,
      targeting_mode TEXT NOT NULL,
      target_categories TEXT,
      target_registration_ids TEXT,
      confirm_broadcast INTEGER NOT NULL DEFAULT 0,
      acknowledge_tag_scope INTEGER NOT NULL DEFAULT 0,
      allocation_a INTEGER NOT NULL,
      duration_hours INTEGER NOT NULL,
      primary_metric TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT,
      ends_at TEXT,
      campaign_a_id TEXT,
      campaign_b_id TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiment_assignments (
      experiment_id TEXT NOT NULL,
      registration_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      assigned_at TEXT NOT NULL,
      PRIMARY KEY (experiment_id, registration_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      registration_id TEXT,
      campaign_id TEXT,
      video_id TEXT,
      experiment_id TEXT,
      variant TEXT,
      dedupe_key TEXT,
      source TEXT NOT NULL,
      metadata TEXT,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      user_id TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      normalized_email TEXT NOT NULL UNIQUE,
      display_name TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_login_at TEXT,
      account_status TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      normalized_email TEXT NOT NULL,
      otp_hash TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL,
      consumed_at TEXT,
      request_ip TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      categories TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_idx
      ON events(event_type, dedupe_key) WHERE dedupe_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS events_campaign_idx ON events(campaign_id, event_type);
    CREATE INDEX IF NOT EXISTS events_video_idx ON events(video_id, event_type);

    CREATE TABLE IF NOT EXISTS favorites (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail_url TEXT,
      category TEXT,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, video_id)
    );

    CREATE TABLE IF NOT EXISTS watch_history (
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      title TEXT NOT NULL,
      thumbnail_url TEXT,
      category TEXT,
      watched_at TEXT NOT NULL,
      PRIMARY KEY (user_id, video_id)
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      guest_key TEXT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ai_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recommendation_feedback (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      conversation_id TEXT,
      video_id TEXT NOT NULL,
      sentiment TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_preferences (
      user_id TEXT PRIMARY KEY,
      push_enabled INTEGER NOT NULL DEFAULT 1,
      new_in_interests INTEGER NOT NULL DEFAULT 1,
      ai_recommendations INTEGER NOT NULL DEFAULT 0,
      trending INTEGER NOT NULL DEFAULT 0,
      daily_digest INTEGER NOT NULL DEFAULT 0,
      frequency TEXT NOT NULL DEFAULT 'instant',
      quiet_start TEXT,
      quiet_end TEXT,
      categories TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_entries (
      video_id TEXT PRIMARY KEY,
      library_state TEXT NOT NULL,
      keywords TEXT NOT NULL,
      tags TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      duration_seconds INTEGER,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS library_campaigns (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      campaign_id TEXT,
      status TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_deliveries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      video_id TEXT NOT NULL,
      registration_id TEXT NOT NULL,
      campaign_id TEXT,
      status TEXT NOT NULL,
      reason TEXT,
      dedupe_key TEXT NOT NULL UNIQUE,
      deliver_after TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS favorites_user_idx ON favorites(user_id, created_at);
    CREATE INDEX IF NOT EXISTS watch_history_user_idx ON watch_history(user_id, watched_at);
    CREATE INDEX IF NOT EXISTS ai_conversations_user_idx ON ai_conversations(user_id, updated_at);
    CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx ON ai_messages(conversation_id, created_at);
    CREATE INDEX IF NOT EXISTS recommendation_feedback_user_idx ON recommendation_feedback(user_id, video_id);
    CREATE INDEX IF NOT EXISTS notification_deliveries_user_idx ON notification_deliveries(user_id, created_at);
    CREATE INDEX IF NOT EXISTS library_campaigns_video_idx ON library_campaigns(video_id, created_at);

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      gender TEXT,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      video_length TEXT,
      content_style TEXT,
      energy TEXT,
      discovery TEXT,
      recommendation_cadence TEXT,
      subcategories TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_traces (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      intent TEXT NOT NULL,
      queries TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notification_policy (
      id TEXT PRIMARY KEY,
      max_per_day INTEGER NOT NULL,
      min_interval_hours INTEGER NOT NULL,
      recent_exclusion_hours INTEGER NOT NULL,
      automatic_campaigns INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiment_simulations (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      synthetic_users INTEGER NOT NULL,
      variant_a INTEGER NOT NULL,
      variant_b INTEGER NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS experiment_test_sends (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      variant TEXT NOT NULL,
      registration_hint TEXT NOT NULL,
      campaign_id TEXT,
      simulated INTEGER NOT NULL,
      provider_status TEXT,
      device_delivery_verified INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS push_decisions (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      library_campaign_id TEXT,
      stage TEXT NOT NULL,
      topics TEXT NOT NULL,
      user_id TEXT,
      action TEXT,
      reason TEXT,
      engage_lab_called INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const columns = db.all<{ name: string }>('PRAGMA table_info(devices)').map((column) => column.name);
  if (!columns.includes('device_type')) db.exec('ALTER TABLE devices ADD COLUMN device_type TEXT');
  if (!columns.includes('installation_id')) db.exec('ALTER TABLE devices ADD COLUMN installation_id TEXT');
  if (!columns.includes('user_id')) db.exec('ALTER TABLE devices ADD COLUMN user_id TEXT');
  if (!columns.includes('notification_enabled')) db.exec('ALTER TABLE devices ADD COLUMN notification_enabled INTEGER NOT NULL DEFAULT 1');
  const eventColumns = db.all<{ name: string }>('PRAGMA table_info(events)').map((column) => column.name);
  if (!eventColumns.includes('user_id')) db.exec('ALTER TABLE events ADD COLUMN user_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS devices_installation_idx ON devices(installation_id)');
  db.exec('CREATE INDEX IF NOT EXISTS auth_challenges_email_idx ON auth_challenges(normalized_email, created_at)');
  const userColumns = db.all<{ name: string }>('PRAGMA table_info(users)').map((column) => column.name);
  if (!userColumns.includes('password_hash')) db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
  const conversationColumns = db.all<{ name: string }>('PRAGMA table_info(ai_conversations)').map((column) => column.name);
  if (!conversationColumns.includes('summary')) db.exec('ALTER TABLE ai_conversations ADD COLUMN summary TEXT');
  db.exec(`INSERT OR IGNORE INTO user_profiles (user_id, onboarding_completed, subcategories, updated_at)
    SELECT id, 1, '[]', updated_at FROM users`);
  db.exec(`INSERT OR IGNORE INTO notification_policy (id, max_per_day, min_interval_hours, recent_exclusion_hours, automatic_campaigns, updated_at)
    VALUES ('default', 3, 4, 24, 0, '1970-01-01T00:00:00.000Z')`);
}

export interface SeedVideo {
  id: string;
  title: string;
  description: string;
  category: string;
  sourceType: 'remote' | 'asset';
  source: string;
  assetFilename: string;
  thumbnailUrl: string;
}

export const SEED_VIDEOS: SeedVideo[] = [];

export function seedVideos(db: Sqlite, now = new Date().toISOString()): void {
  const existing = db.get<{ count: number }>('SELECT COUNT(*) AS count FROM videos');
  if (existing && existing.count > 0) return;
  for (const video of SEED_VIDEOS) {
    db.run(
      `INSERT INTO videos
        (id, title, description, category, source_type, source, asset_filename, thumbnail_url, active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      video.id,
      video.title,
      video.description,
      video.category,
      video.sourceType,
      video.source,
      video.assetFilename,
      video.thumbnailUrl,
      now,
      now,
    );
  }
}
