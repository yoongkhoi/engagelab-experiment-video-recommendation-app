import type { Video } from '../domain.js';
import { nowIso } from '../domain.js';
import { HttpError } from '../errors.js';
import { toStoredVideo, type PixabayCatalog, type PublicVideo } from '../integrations/pixabay.js';
import type { Store } from '../repositories/store.js';
import { newId } from './audience.js';

export interface VideoInput {
  id?: string;
  title: string;
  description: string;
  category: string;
  sourceType: 'remote' | 'asset';
  source: string;
  assetFilename?: string | null;
  thumbnailUrl?: string | null;
  active?: boolean;
}

export class VideoService {
  constructor(
    private readonly store: Store,
    private readonly pixabay?: PixabayCatalog,
  ) {}

  list(activeOnly: boolean): Video[] {
    return this.store.listVideos(activeOnly);
  }

  get(id: string): Video {
    const video = this.store.getVideo(id);
    if (!video) throw new HttpError(404, 'VIDEO_NOT_FOUND', `Video ${id} was not found.`);
    return video;
  }

  /**
   * Catalog rows stay authoritative. A numeric id that is not in the catalog is loaded
   * from Pixabay and stored as playback metadata only. The MP4 remains on Pixabay.
   */
  async resolve(id: string): Promise<Video> {
    const existing = this.store.getVideo(id);
    if (existing) {
      if (!existing.active) throw new HttpError(409, 'VIDEO_INACTIVE', `Video ${id} is inactive.`);
      return existing;
    }
    const remote = await this.loadRemote(id);
    return this.remember(remote);
  }

  async resolvePlayback(id: string): Promise<Video | (Video & PublicVideo)> {
    const existing = this.store.getVideo(id);
    if (existing) {
      if (!existing.active) throw new HttpError(409, 'VIDEO_INACTIVE', `Video ${id} is inactive.`);
      return existing;
    }
    const remote = await this.loadRemote(id);
    const stored = this.remember(remote);
    return { ...stored, ...remote, createdAt: stored.createdAt, updatedAt: stored.updatedAt };
  }

  private async loadRemote(id: string): Promise<PublicVideo> {
    if (!this.pixabay?.configured() || !/^\d{1,12}$/.test(id)) {
      throw new HttpError(404, 'VIDEO_NOT_FOUND', `Video ${id} was not found.`);
    }
    return this.pixabay.video(id);
  }

  remember(remote: PublicVideo): Video {
    const current = this.store.getVideo(remote.id);
    if (current) return current;
    const video = toStoredVideo(remote);
    this.store.insertVideo(video);
    return video;
  }

  create(input: VideoInput): Video {
    const id = input.id?.trim() || `vid_${newId().slice(0, 8)}`;
    if (this.store.getVideo(id)) {
      throw new HttpError(409, 'DUPLICATE_VIDEO_ID', `Video id ${id} already exists.`);
    }
    const now = nowIso();
    const video: Video = {
      id,
      title: input.title,
      description: input.description,
      category: input.category,
      sourceType: input.sourceType,
      source: input.source,
      assetFilename: input.assetFilename ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      active: input.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertVideo(video);
    return video;
  }

  update(id: string, input: VideoInput): Video {
    const current = this.get(id);
    const video: Video = {
      ...current,
      title: input.title,
      description: input.description,
      category: input.category,
      sourceType: input.sourceType,
      source: input.source,
      assetFilename: input.assetFilename ?? null,
      thumbnailUrl: input.thumbnailUrl ?? null,
      active: input.active ?? current.active,
      updatedAt: nowIso(),
    };
    this.store.updateVideo(video);
    return video;
  }

  remove(id: string): { deleted: boolean; deactivated: boolean; video?: Video } {
    const video = this.get(id);
    if (this.store.countCampaignsForVideo(id) > 0) {
      const inactive = { ...video, active: false, updatedAt: nowIso() };
      this.store.updateVideo(inactive);
      return { deleted: false, deactivated: true, video: inactive };
    }
    this.store.deleteVideo(id);
    return { deleted: true, deactivated: false };
  }
}
