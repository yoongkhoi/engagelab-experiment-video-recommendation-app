import { HttpError } from '../errors.js';
import { nowIso } from '../domain.js';
import type { Video } from '../domain.js';

const PIXABAY_ORIGIN = 'https://pixabay.com';
const VIDEO_PATH = '/api/videos/';
const PER_PAGE = 10;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS = 60 * 1000;
const DEFAULT_UPSTREAM_LIMIT = 90;

export const PIXABAY_ATTRIBUTION = {
  text: 'Videos provided by Pixabay',
  url: 'https://pixabay.com',
};

export interface PixabayRendition {
  url?: string;
  width?: number;
  height?: number;
  size?: number;
  thumbnail?: string;
}

export interface PixabayStreams {
  large?: PixabayRendition;
  medium?: PixabayRendition;
  small?: PixabayRendition;
  tiny?: PixabayRendition;
}

export interface PublicVideo {
  id: string;
  video_id: string;
  title: string;
  description: string;
  category: string;
  sourceType: 'remote';
  source: string;
  video_url: string;
  assetFilename: null;
  thumbnailUrl: string | null;
  thumbnail_url: string | null;
  active: true;
  duration: number;
  creator_name: string;
  creator_profile_url: string;
  source_url: string;
}

export interface PixabayPage {
  videos: PublicVideo[];
  page: number;
  perPage: number;
  totalResults: number;
  source: 'pixabay';
  attribution: typeof PIXABAY_ATTRIBUTION;
}

interface CacheEntry<T> {
  expiresAt: number;
  value: T;
}

/**
 * Pixabay documents medium and smaller renditions for every video.
 * large can be an empty URL. Prefer medium, then small, then tiny, then a real large file.
 */
export function selectMp4(streams: PixabayStreams | undefined): { url: string; thumbnail: string | null } | undefined {
  for (const rendition of [streams?.medium, streams?.small, streams?.tiny, streams?.large]) {
    const url = rendition?.url ?? '';
    if (!url.startsWith('https://') || !url.includes('.mp4') || url.includes('.m3u8')) continue;
    const thumbnail = rendition?.thumbnail?.startsWith('https://') ? rendition.thumbnail : null;
    return { url, thumbnail };
  }
  return undefined;
}

export function categorySlug(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  return slug || 'pixabay';
}

export function creatorProfileUrl(name: string, userId: number): string {
  if (!Number.isInteger(userId) || userId <= 0) return '';
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return '';
  return `https://pixabay.com/users/${name}-${userId}/`;
}

export function normalizePixabayVideo(raw: unknown, category: string): PublicVideo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === 'number' && Number.isInteger(record.id) ? String(record.id) : '';
  if (!/^\d{1,12}$/.test(id)) return undefined;
  const streams = record.videos && typeof record.videos === 'object' ? record.videos as PixabayStreams : undefined;
  const selected = selectMp4(streams);
  if (!selected) return undefined;
  const creator = typeof record.user === 'string' && record.user.trim() ? record.user.trim().slice(0, 80) : 'Pixabay contributor';
  const userId = typeof record.user_id === 'number' ? record.user_id : 0;
  const profile = creatorProfileUrl(creator, userId);
  const pageUrl = typeof record.pageURL === 'string' && record.pageURL.startsWith('https://pixabay.com/')
    ? record.pageURL
    : `https://pixabay.com/videos/id-${id}/`;
  const tags = typeof record.tags === 'string' ? record.tags.trim() : '';
  const duration = typeof record.duration === 'number' && record.duration >= 0 ? Math.round(record.duration) : 0;
  const label = category === 'pixabay' ? 'Pixabay' : category.replace(/_/g, ' ');
  const title = (tags || `${label} · ${creator}`).slice(0, 120);
  return {
    id,
    video_id: id,
    title,
    description: `Video by ${creator} on Pixabay. ${duration}s.`,
    category,
    sourceType: 'remote',
    source: selected.url,
    video_url: selected.url,
    assetFilename: null,
    thumbnailUrl: selected.thumbnail,
    thumbnail_url: selected.thumbnail,
    active: true,
    duration,
    creator_name: creator,
    creator_profile_url: profile,
    source_url: pageUrl,
  };
}

export function toStoredVideo(video: PublicVideo): Video {
  const now = nowIso();
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    category: video.category,
    sourceType: 'remote',
    source: video.video_url,
    assetFilename: null,
    thumbnailUrl: video.thumbnail_url,
    active: true,
    createdAt: now,
    updatedAt: now,
  };
}

export class PixabayCatalog {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly calls: number[] = [];

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number = Date.now,
    private readonly upstreamLimit = DEFAULT_UPSTREAM_LIMIT,
  ) {}

  configured(): boolean {
    return this.apiKey.length > 0;
  }

  async search(query: string, page: number): Promise<PixabayPage> {
    const normalized = query.trim();
    if (!normalized || normalized.length > 100) {
      throw new HttpError(400, 'INVALID_QUERY', 'query must be 1 to 100 characters.');
    }
    assertPage(page);
    const slug = categorySlug(normalized);
    const url = new URL(VIDEO_PATH, PIXABAY_ORIGIN);
    url.searchParams.set('q', normalized);
    url.searchParams.set('order', 'popular');
    url.searchParams.set('safesearch', 'true');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));
    this.addKey(url);
    return this.withCache(`search:${slug}:${page}`, async () => {
      const pageResult = this.pageFromBody(await this.upstream(url), page, slug);
      for (const video of pageResult.videos) this.write(`video:${video.id}`, video);
      return pageResult;
    });
  }

  async popular(page: number): Promise<PixabayPage> {
    assertPage(page);
    const url = new URL(VIDEO_PATH, PIXABAY_ORIGIN);
    url.searchParams.set('order', 'popular');
    url.searchParams.set('safesearch', 'true');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));
    this.addKey(url);
    return this.withCache(`popular:${page}`, async () => {
      const pageResult = this.pageFromBody(await this.upstream(url), page, 'popular');
      for (const video of pageResult.videos) this.write(`video:${video.id}`, video);
      return pageResult;
    });
  }

  async video(id: string): Promise<PublicVideo> {
    if (!/^\d{1,12}$/.test(id)) {
      throw new HttpError(404, 'VIDEO_NOT_FOUND', `Video ${id} was not found.`);
    }
    const url = new URL(VIDEO_PATH, PIXABAY_ORIGIN);
    url.searchParams.set('id', id);
    this.addKey(url);
    return this.withCache(`video:${id}`, async () => {
      const body = await this.upstream(url);
      const hits = hitsOf(body);
      if (!hits) throw new HttpError(502, 'PIXABAY_RESPONSE', 'Pixabay returned an unexpected video.');
      if (hits.length === 0) throw new HttpError(404, 'VIDEO_NOT_FOUND', 'Pixabay has no video for that id.');
      const video = normalizePixabayVideo(hits[0], 'pixabay');
      if (!video || video.id !== id) {
        throw new HttpError(502, 'PIXABAY_RESPONSE', 'Pixabay returned a video without a playable MP4.');
      }
      return video;
    });
  }

  private addKey(url: URL): void {
    if (this.apiKey) url.searchParams.set('key', this.apiKey);
  }

  private pageFromBody(body: unknown, page: number, category: string): PixabayPage {
    const hits = hitsOf(body);
    if (!hits) throw new HttpError(502, 'PIXABAY_RESPONSE', 'Pixabay returned an unexpected video list.');
    const record = body as { totalHits?: unknown };
    const videos = hits
      .map((item) => normalizePixabayVideo(item, category))
      .filter((item): item is PublicVideo => Boolean(item));
    const total = typeof record.totalHits === 'number' ? record.totalHits : videos.length;
    return {
      videos,
      page,
      perPage: PER_PAGE,
      totalResults: total,
      source: 'pixabay',
      attribution: PIXABAY_ATTRIBUTION,
    };
  }

  private async upstream(url: URL): Promise<unknown> {
    if (!this.configured()) {
      throw new HttpError(503, 'PIXABAY_NOT_CONFIGURED', 'Set PIXABAY_API_KEY on the backend. The key is not stored in the Android app.');
    }
    if (url.origin !== PIXABAY_ORIGIN) {
      throw new HttpError(500, 'PIXABAY_URL', 'Refusing a non-Pixabay video request.');
    }
    const recent = this.calls.filter((at) => this.now() - at < WINDOW_MS);
    this.calls.length = 0;
    this.calls.push(...recent);
    if (this.calls.length >= this.upstreamLimit) {
      throw new HttpError(429, 'PIXABAY_RATE_LIMIT', 'The local Pixabay request budget for this minute is exhausted. Cached results are being served when they exist.');
    }
    this.calls.push(this.now());
    let response: Response;
    try {
      response = await this.fetchImpl(url, { signal: AbortSignal.timeout(10_000) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      throw new HttpError(
        502,
        timedOut ? 'PIXABAY_TIMEOUT' : 'PIXABAY_NETWORK',
        timedOut ? 'Pixabay did not respond in time.' : 'The Pixabay video request failed.',
      );
    }
    const text = await response.text();
    if (this.apiKey && text.includes(this.apiKey)) {
      throw new HttpError(502, 'PIXABAY_RESPONSE', 'Pixabay returned a response that was discarded.');
    }
    if (response.status === 404) {
      throw new HttpError(404, 'VIDEO_NOT_FOUND', 'Pixabay has no video for that id.');
    }
    if (response.status === 429) {
      throw new HttpError(429, 'PIXABAY_RATE_LIMIT', 'Pixabay rate limit reached. Try again later.');
    }
    if (response.status === 400 && /key/i.test(text)) {
      throw new HttpError(503, 'PIXABAY_AUTH_FAILED', 'Pixabay rejected the API key. Check PIXABAY_API_KEY on the backend.');
    }
    if (response.status === 401 || response.status === 403) {
      throw new HttpError(503, 'PIXABAY_AUTH_FAILED', 'Pixabay rejected the API key. Check PIXABAY_API_KEY on the backend.');
    }
    if (!response.ok) {
      throw new HttpError(502, 'PIXABAY_RESPONSE', `Pixabay returned HTTP ${response.status}.`);
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new HttpError(502, 'PIXABAY_RESPONSE', 'Pixabay returned a response that was not JSON.');
    }
  }

  private async withCache<T>(key: string, load: () => Promise<T>): Promise<T> {
    const fresh = this.read<T>(key);
    if (fresh) return fresh;
    try {
      const value = await load();
      this.write(key, value);
      return value;
    } catch (error) {
      const stale = this.cache.get(key);
      if (stale && error instanceof HttpError && (error.status === 429 || error.status === 502)) {
        return stale.value as T;
      }
      throw error;
    }
  }

  private read<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry || entry.expiresAt <= this.now()) return undefined;
    return entry.value as T;
  }

  private write(key: string, value: unknown): void {
    this.cache.set(key, { expiresAt: this.now() + CACHE_TTL_MS, value });
  }
}

function hitsOf(body: unknown): unknown[] | null {
  if (!body || typeof body !== 'object' || !Array.isArray((body as { hits?: unknown }).hits)) return null;
  return (body as { hits: unknown[] }).hits;
}

function assertPage(page: number): void {
  if (!Number.isInteger(page) || page < 1 || page > 50) {
    throw new HttpError(400, 'INVALID_PAGE', 'page must be an integer from 1 to 50.');
  }
}
