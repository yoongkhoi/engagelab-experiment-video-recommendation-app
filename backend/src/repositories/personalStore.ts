import type { Sqlite } from '../db/database.js';

export interface SavedVideo {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  category: string | null;
  at: string;
}

export interface NotificationPreference {
  pushEnabled: boolean;
  newInInterests: boolean;
  aiRecommendations: boolean;
  trending: boolean;
  dailyDigest: boolean;
  frequency: 'instant' | 'daily' | 'weekly';
  quietStart: string | null;
  quietEnd: string | null;
  categories: string[];
  updatedAt: string;
}

export interface LibraryEntry {
  videoId: string;
  libraryState: 'discovered' | 'draft' | 'published' | 'archived';
  keywords: string[];
  tags: string[];
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_PREFS = {
  pushEnabled: true,
  newInInterests: true,
  aiRecommendations: false,
  trending: false,
  dailyDigest: false,
  frequency: 'instant' as const,
  quietStart: null,
  quietEnd: null,
  categories: [] as string[],
};

export class PersonalStore {
  constructor(private readonly db: Sqlite) {}

  listFavorites(userId: string): SavedVideo[] {
    return this.db.all(
      `SELECT video_id AS videoId, title, thumbnail_url AS thumbnailUrl, category, created_at AS at
       FROM favorites WHERE user_id = ? ORDER BY created_at DESC`,
      userId,
    );
  }

  saveFavorite(userId: string, video: SavedVideo): void {
    this.db.run(
      `INSERT INTO favorites (user_id, video_id, title, thumbnail_url, category, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, video_id) DO UPDATE SET title = excluded.title, thumbnail_url = excluded.thumbnail_url, category = excluded.category`,
      userId, video.videoId, video.title, video.thumbnailUrl, video.category, video.at,
    );
  }

  deleteFavorite(userId: string, videoId: string): void {
    this.db.run('DELETE FROM favorites WHERE user_id = ? AND video_id = ?', userId, videoId);
  }

  listHistory(userId: string): SavedVideo[] {
    return this.db.all(
      `SELECT video_id AS videoId, title, thumbnail_url AS thumbnailUrl, category, watched_at AS at
       FROM watch_history WHERE user_id = ? ORDER BY watched_at DESC LIMIT 50`,
      userId,
    );
  }

  saveHistory(userId: string, video: SavedVideo): void {
    this.db.run(
      `INSERT INTO watch_history (user_id, video_id, title, thumbnail_url, category, watched_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, video_id) DO UPDATE SET title = excluded.title, thumbnail_url = excluded.thumbnail_url, watched_at = excluded.watched_at`,
      userId, video.videoId, video.title, video.thumbnailUrl, video.category, video.at,
    );
  }

  notificationPreference(userId: string): NotificationPreference {
    const row = this.db.get<{
      push_enabled: number; new_in_interests: number; ai_recommendations: number; trending: number; daily_digest: number;
      frequency: NotificationPreference['frequency']; quiet_start: string | null; quiet_end: string | null; categories: string; updated_at: string;
    }>('SELECT * FROM notification_preferences WHERE user_id = ?', userId);
    if (!row) return { ...DEFAULT_PREFS, updatedAt: '' };
    return {
      pushEnabled: row.push_enabled !== 0,
      newInInterests: row.new_in_interests !== 0,
      aiRecommendations: row.ai_recommendations !== 0,
      trending: row.trending !== 0,
      dailyDigest: row.daily_digest !== 0,
      frequency: row.frequency,
      quietStart: row.quiet_start,
      quietEnd: row.quiet_end,
      categories: JSON.parse(row.categories) as string[],
      updatedAt: row.updated_at,
    };
  }

  saveNotificationPreference(userId: string, pref: NotificationPreference): void {
    this.db.run(
      `INSERT INTO notification_preferences
        (user_id, push_enabled, new_in_interests, ai_recommendations, trending, daily_digest, frequency, quiet_start, quiet_end, categories, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
        push_enabled = excluded.push_enabled, new_in_interests = excluded.new_in_interests,
        ai_recommendations = excluded.ai_recommendations, trending = excluded.trending, daily_digest = excluded.daily_digest,
        frequency = excluded.frequency, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end,
        categories = excluded.categories, updated_at = excluded.updated_at`,
      userId, pref.pushEnabled ? 1 : 0, pref.newInInterests ? 1 : 0, pref.aiRecommendations ? 1 : 0, pref.trending ? 1 : 0,
      pref.dailyDigest ? 1 : 0, pref.frequency, pref.quietStart, pref.quietEnd, JSON.stringify(pref.categories), pref.updatedAt,
    );
  }

  conversation(id: string) {
    return this.db.get<{ id: string; user_id: string | null; guest_key: string | null; title: string }>(
      'SELECT id, user_id, guest_key, title FROM ai_conversations WHERE id = ?',
      id,
    );
  }

  insertConversation(row: { id: string; userId: string | null; guestKey: string | null; title: string; at: string }): void {
    this.db.run(
      `INSERT INTO ai_conversations (id, user_id, guest_key, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      row.id, row.userId, row.guestKey, row.title, row.at, row.at,
    );
  }

  touchConversation(id: string, at: string): void {
    this.db.run('UPDATE ai_conversations SET updated_at = ? WHERE id = ?', at, id);
  }

  recentMessages(conversationId: string, limit: number) {
    const rows = this.db.all<{ role: string; content: string; metadata: string | null; created_at: string }>(
      `SELECT role, content, metadata, created_at FROM ai_messages WHERE conversation_id = ? ORDER BY created_at DESC LIMIT ?`,
      conversationId, limit,
    );
    return rows.reverse();
  }

  insertMessage(row: { id: string; conversationId: string; role: string; content: string; metadata: string | null; at: string }): void {
    this.db.run(
      `INSERT INTO ai_messages (id, conversation_id, role, content, metadata, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      row.id, row.conversationId, row.role, row.content, row.metadata, row.at,
    );
  }

  listConversations(owner: { userId?: string; guestKey?: string }) {
    if (owner.userId) {
      return this.db.all('SELECT id, title, updated_at AS updatedAt FROM ai_conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 30', owner.userId);
    }
    return this.db.all('SELECT id, title, updated_at AS updatedAt FROM ai_conversations WHERE user_id IS NULL AND guest_key = ? ORDER BY updated_at DESC LIMIT 30', owner.guestKey ?? '');
  }

  feedback(row: { id: string; userId: string | null; conversationId: string | null; videoId: string; sentiment: string; at: string }): void {
    this.db.run(
      `INSERT INTO recommendation_feedback (id, user_id, conversation_id, video_id, sentiment, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      row.id, row.userId, row.conversationId, row.videoId, row.sentiment, row.at,
    );
  }

  feedbackForUser(userId: string) {
    return this.db.all<{ video_id: string; sentiment: string }>(
      'SELECT video_id, sentiment FROM recommendation_feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 40',
      userId,
    );
  }

  upsertLibrary(entry: LibraryEntry): void {
    this.db.run(
      `INSERT INTO library_entries
        (video_id, library_state, keywords, tags, width, height, duration_seconds, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO UPDATE SET
        library_state = excluded.library_state, keywords = excluded.keywords, tags = excluded.tags,
        width = excluded.width, height = excluded.height, duration_seconds = excluded.duration_seconds,
        published_at = excluded.published_at, updated_at = excluded.updated_at`,
      entry.videoId, entry.libraryState, JSON.stringify(entry.keywords), JSON.stringify(entry.tags),
      entry.width, entry.height, entry.durationSeconds, entry.publishedAt, entry.createdAt, entry.updatedAt,
    );
  }

  library(videoId: string): LibraryEntry | undefined {
    const row = this.db.get<LibraryRow>('SELECT * FROM library_entries WHERE video_id = ?', videoId);
    return row ? mapLibrary(row) : undefined;
  }

  listLibrary(): LibraryEntry[] {
    return this.db.all<LibraryRow>('SELECT * FROM library_entries ORDER BY updated_at DESC').map(mapLibrary);
  }

  insertLibraryCampaign(row: { id: string; videoId: string; status: string; note: string; at: string }): void {
    this.db.run(
      `INSERT INTO library_campaigns (id, video_id, campaign_id, status, note, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?, ?)`,
      row.id, row.videoId, row.status, row.note, row.at, row.at,
    );
  }

  libraryCampaigns(videoId?: string) {
    const sql = videoId
      ? 'SELECT * FROM library_campaigns WHERE video_id = ? ORDER BY created_at DESC'
      : 'SELECT * FROM library_campaigns ORDER BY created_at DESC';
    return videoId ? this.db.all(sql, videoId) : this.db.all(sql);
  }

  updateLibraryCampaign(id: string, status: string, campaignId: string | null, at: string): void {
    this.db.run('UPDATE library_campaigns SET status = ?, campaign_id = COALESCE(?, campaign_id), updated_at = ? WHERE id = ?', status, campaignId, at, id);
  }

  deliveryExists(dedupeKey: string): boolean {
    return Boolean(this.db.get('SELECT id FROM notification_deliveries WHERE dedupe_key = ?', dedupeKey));
  }

  countDeliveriesSince(userId: string, since: string): number {
    return this.db.get<{ count: number }>(
      `SELECT COUNT(*) AS count FROM notification_deliveries WHERE user_id = ? AND created_at >= ? AND status IN ('simulated', 'accepted_by_provider', 'queued')`,
      userId, since,
    )?.count ?? 0;
  }

  insertPushDecision(row: { id: string; videoId: string; libraryCampaignId: string | null; stage: string; topics: string[]; userId: string | null; action: string; reason: string; engageLabCalled: boolean; at: string }): void {
    this.db.run(
      `INSERT INTO push_decisions
        (id, video_id, library_campaign_id, stage, topics, user_id, action, reason, engage_lab_called, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.videoId, row.libraryCampaignId, row.stage, JSON.stringify(row.topics), row.userId, row.action, row.reason, row.engageLabCalled ? 1 : 0, row.at,
    );
  }

  insertDelivery(row: { id: string; userId: string; videoId: string; registrationId: string; campaignId: string | null; status: string; reason: string | null; dedupeKey: string; deliverAfter: string | null; at: string }): void {
    this.db.run(
      `INSERT INTO notification_deliveries
        (id, user_id, video_id, registration_id, campaign_id, status, reason, dedupe_key, deliver_after, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.userId, row.videoId, row.registrationId, row.campaignId, row.status, row.reason, row.dedupeKey, row.deliverAfter, row.at,
    );
  }

  dueQueued(now: string) {
    return this.db.all<{ id: string; user_id: string; video_id: string; registration_id: string }>(
      `SELECT id, user_id, video_id, registration_id FROM notification_deliveries WHERE status = 'queued' AND deliver_after <= ?`,
      now,
    );
  }

  markDelivery(id: string, status: string, campaignId: string | null): void {
    this.db.run('UPDATE notification_deliveries SET status = ?, campaign_id = ? WHERE id = ?', status, campaignId, id);
  }

  deliveriesForUser(userId: string) {
    return this.db.all<{ videoId: string; status: string; reason: string | null; createdAt: string }>(
      `SELECT video_id AS videoId, status, reason, created_at AS createdAt
       FROM notification_deliveries WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      userId,
    );
  }

  userHasVideo(userId: string, videoId: string): boolean {
    return Boolean(this.db.get(
      `SELECT id FROM notification_deliveries WHERE user_id = ? AND video_id = ? AND status IN ('simulated', 'accepted_by_provider', 'queued', 'sent_to_provider', 'provider_accepted')`,
      userId, videoId,
    ));
  }

  latestDeliveryAt(userId: string): string | null {
    return this.db.get<{ created_at: string }>(
      `SELECT created_at FROM notification_deliveries WHERE user_id = ? AND status IN ('simulated', 'accepted_by_provider', 'queued', 'sent_to_provider', 'provider_accepted') ORDER BY created_at DESC LIMIT 1`,
      userId,
    )?.created_at ?? null;
  }

  notificationPolicy(): { maxPerDay: number; minIntervalHours: number; recentExclusionHours: number; automaticCampaigns: boolean } {
    const row = this.db.get<{ max_per_day: number; min_interval_hours: number; recent_exclusion_hours: number; automatic_campaigns: number }>(
      'SELECT max_per_day, min_interval_hours, recent_exclusion_hours, automatic_campaigns FROM notification_policy WHERE id = ?',
      'default',
    );
    return {
      maxPerDay: row?.max_per_day ?? 3,
      minIntervalHours: row?.min_interval_hours ?? 4,
      recentExclusionHours: row?.recent_exclusion_hours ?? 24,
      automaticCampaigns: row?.automatic_campaigns === 1,
    };
  }

  saveNotificationPolicy(policy: { maxPerDay: number; minIntervalHours: number; recentExclusionHours: number; automaticCampaigns: boolean }, at: string): void {
    this.db.run(
      `INSERT INTO notification_policy (id, max_per_day, min_interval_hours, recent_exclusion_hours, automatic_campaigns, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET max_per_day = excluded.max_per_day, min_interval_hours = excluded.min_interval_hours,
         recent_exclusion_hours = excluded.recent_exclusion_hours, automatic_campaigns = excluded.automatic_campaigns, updated_at = excluded.updated_at`,
      policy.maxPerDay, policy.minIntervalHours, policy.recentExclusionHours, policy.automaticCampaigns ? 1 : 0, at,
    );
  }

  ensureProfile(userId: string, completed: boolean, at: string): void {
    this.db.run(
      `INSERT OR IGNORE INTO user_profiles (user_id, gender, onboarding_completed, subcategories, updated_at) VALUES (?, NULL, ?, '[]', ?)`,
      userId, completed ? 1 : 0, at,
    );
  }

  profile(userId: string) {
    const row = this.db.get<{
      gender: string | null; onboarding_completed: number; video_length: string | null; content_style: string | null;
      energy: string | null; discovery: string | null; recommendation_cadence: string | null; subcategories: string; updated_at: string;
    }>('SELECT * FROM user_profiles WHERE user_id = ?', userId);
    if (!row) return null;
    return {
      gender: row.gender,
      onboardingCompleted: row.onboarding_completed !== 0,
      videoLength: row.video_length,
      contentStyle: row.content_style,
      energy: row.energy,
      discovery: row.discovery,
      recommendationCadence: row.recommendation_cadence,
      subcategories: JSON.parse(row.subcategories) as string[],
      updatedAt: row.updated_at,
    };
  }

  saveProfile(userId: string, profile: {
    gender: string | null; onboardingCompleted: boolean; videoLength: string | null; contentStyle: string | null;
    energy: string | null; discovery: string | null; recommendationCadence: string | null; subcategories: string[];
  }, at: string): void {
    this.db.run(
      `INSERT INTO user_profiles
        (user_id, gender, onboarding_completed, video_length, content_style, energy, discovery, recommendation_cadence, subcategories, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET gender = excluded.gender, onboarding_completed = excluded.onboarding_completed,
         video_length = excluded.video_length, content_style = excluded.content_style, energy = excluded.energy,
         discovery = excluded.discovery, recommendation_cadence = excluded.recommendation_cadence,
         subcategories = excluded.subcategories, updated_at = excluded.updated_at`,
      userId, profile.gender, profile.onboardingCompleted ? 1 : 0, profile.videoLength, profile.contentStyle,
      profile.energy, profile.discovery, profile.recommendationCadence, JSON.stringify(profile.subcategories), at,
    );
  }

  insertTrace(row: { id: string; conversationId: string | null; intent: string; queries: string[]; resultCount: number; outcome: string; at: string }): void {
    this.db.run(
      `INSERT INTO agent_traces (id, conversation_id, intent, queries, result_count, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      row.id, row.conversationId, row.intent, JSON.stringify(row.queries), row.resultCount, row.outcome, row.at,
    );
  }

  messageCount(conversationId: string): number {
    return this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM ai_messages WHERE conversation_id = ?', conversationId)?.count ?? 0;
  }

  updateSummary(conversationId: string, summary: string): void {
    this.db.run('UPDATE ai_conversations SET summary = ? WHERE id = ?', summary.slice(0, 280), conversationId);
  }

  summary(conversationId: string): string | null {
    return this.db.get<{ summary: string | null }>('SELECT summary FROM ai_conversations WHERE id = ?', conversationId)?.summary ?? null;
  }

  deleteConversation(id: string, owner: { userId?: string; guestKey?: string }): boolean {
    const existing = this.conversation(id);
    if (!existing) return false;
    if (owner.userId && existing.user_id !== owner.userId) return false;
    if (owner.guestKey && existing.guest_key !== owner.guestKey) return false;
    this.db.run('DELETE FROM ai_messages WHERE conversation_id = ?', id);
    this.db.run('DELETE FROM ai_conversations WHERE id = ?', id);
    return true;
  }

  clearConversations(owner: { userId?: string; guestKey?: string }): number {
    const rows = this.listConversations(owner) as Array<{ id: string }>;
    for (const row of rows) this.deleteConversation(row.id, owner);
    return rows.length;
  }

  deliveryCounts() {
    const rows = this.db.all<{ status: string; count: number }>('SELECT status, COUNT(*) AS count FROM notification_deliveries GROUP BY status');
    return rows;
  }

  preferenceCounts() {
    const rows = this.db.all<{ categories: string }>('SELECT categories FROM user_preferences');
    const counts = new Map<string, number>();
    for (const row of rows) {
      const categories = JSON.parse(row.categories) as string[];
      for (const category of categories) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return [...counts.entries()].map(([category, count]) => ({ category, count })).sort((left, right) => right.count - left.count);
  }

  aiStats() {
    const conversations = this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM ai_conversations')?.count ?? 0;
    const recommendations = this.db.get<{ count: number }>("SELECT COUNT(*) AS count FROM ai_messages WHERE role = 'assistant'")?.count ?? 0;
    const feedback = this.db.get<{ count: number }>('SELECT COUNT(*) AS count FROM recommendation_feedback')?.count ?? 0;
    return { conversations, recommendations, feedback };
  }
}

interface LibraryRow {
  video_id: string;
  library_state: LibraryEntry['libraryState'];
  keywords: string;
  tags: string;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapLibrary(row: LibraryRow): LibraryEntry {
  return {
    videoId: row.video_id,
    libraryState: row.library_state,
    keywords: JSON.parse(row.keywords) as string[],
    tags: JSON.parse(row.tags) as string[],
    width: row.width,
    height: row.height,
    durationSeconds: row.duration_seconds,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
