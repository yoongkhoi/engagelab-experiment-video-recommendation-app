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
      installation_id TEXT
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
      created_at TEXT NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS events_dedupe_idx
      ON events(event_type, dedupe_key) WHERE dedupe_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS events_campaign_idx ON events(campaign_id, event_type);
    CREATE INDEX IF NOT EXISTS events_video_idx ON events(video_id, event_type);
  `);
  const columns = db.all<{ name: string }>('PRAGMA table_info(devices)').map((column) => column.name);
  if (!columns.includes('device_type')) db.exec('ALTER TABLE devices ADD COLUMN device_type TEXT');
  if (!columns.includes('installation_id')) db.exec('ALTER TABLE devices ADD COLUMN installation_id TEXT');
  db.exec('CREATE INDEX IF NOT EXISTS devices_installation_idx ON devices(installation_id)');
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

export const SEED_VIDEOS: SeedVideo[] = [
  {
    id: '1001',
    title: 'Signal Path',
    description: 'Technology sample. Plays the Blender Foundation film Big Buck Bunny (CC BY 3.0) when the local asset is absent.',
    category: 'tech',
    sourceType: 'remote',
    source: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    assetFilename: 'tech.mp4',
    thumbnailUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/BigBuckBunny.jpg',
  },
  {
    id: '1002',
    title: 'Cut to the Punchline',
    description: 'Funny sample. Plays Elephants Dream (Blender Foundation, CC BY) when funny.mp4 is not bundled.',
    category: 'funny',
    sourceType: 'remote',
    source: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    assetFilename: 'funny.mp4',
    thumbnailUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ElephantsDream.jpg',
  },
  {
    id: '1003',
    title: 'Weekend Drift',
    description: 'Lifestyle sample. Remote fallback is a short Google-hosted developer sample clip.',
    category: 'lifestyle',
    sourceType: 'remote',
    source: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4',
    assetFilename: 'lifestyle.mp4',
    thumbnailUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/images/ForBiggerJoyrides.jpg',
  },
];

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
