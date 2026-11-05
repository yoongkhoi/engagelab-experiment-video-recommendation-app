import { HttpError } from '../errors.js';
import { logger } from '../logger.js';

export interface AiVideo {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  duration: number | null;
  width: number | null;
  height: number | null;
}

export interface AiRecommendation {
  reply: string;
  explanation: string;
  intent: string;
  keywords: string[];
  videos: AiVideo[];
  suggestions?: string[];
}

export interface AiClient {
  recommend(input: Record<string, unknown>): Promise<AiRecommendation>;
}

export class HttpAiClient implements AiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async recommend(input: Record<string, unknown>): Promise<AiRecommendation> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/api/ai/recommend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      const text = await response.text();
      const body = text ? JSON.parse(text) as { error?: { code?: string; message?: string }; recommendation?: AiRecommendation } : {};
      if (!response.ok) {
        const code = body.error?.code ?? '';
        logger.warn({ status: response.status, errorCode: code || null }, 'AI service rejected a recommendation');
        throw aiFailure(response.status, code);
      }
      if (!body.recommendation) throw new HttpError(502, 'AI_INVALID', 'The video assistant could not answer. Try again.');
      return body.recommendation;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new HttpError(504, 'AI_TIMEOUT', 'The video assistant timed out. Try again.');
      }
      logger.warn({ type: error instanceof Error ? error.name : 'Error' }, 'AI service request failed');
      throw new HttpError(503, 'AI_UNAVAILABLE', 'The AI service is offline. Video search and browsing still work.');
    } finally {
      clearTimeout(timer);
    }
  }
}

function aiFailure(status: number, code: string): HttpError {
  if (code === 'VALIDATION_ERROR' || status === 400 || status === 422) {
    return new HttpError(400, 'VALIDATION_ERROR', 'The chat request was not accepted. Send the message again.');
  }
  if (code === 'PIXABAY_UNAVAILABLE') {
    return new HttpError(503, 'PIXABAY_UNAVAILABLE', 'Video search is unavailable right now.');
  }
  if (code === 'LLM_NOT_CONFIGURED') {
    return new HttpError(503, 'LLM_NOT_CONFIGURED', 'The video assistant is not available right now.');
  }
  if (code === 'AI_TIMEOUT' || status === 504) {
    return new HttpError(504, 'AI_TIMEOUT', 'The video assistant timed out. Try again.');
  }
  if (code === 'LLM_UNAVAILABLE' || code === 'LLM_INVALID') {
    return new HttpError(502, 'LLM_UNAVAILABLE', 'The video assistant could not answer. Try again.');
  }
  return new HttpError(status === 503 ? 503 : 502, 'AI_UNAVAILABLE', 'The video assistant could not answer. Try again.');
}

export function trustedVideos(recommendation: AiRecommendation): AiVideo[] {
  const seen = new Set<string>();
  return recommendation.videos.filter((video) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(video.id) || seen.has(video.id)) return false;
    if (!video.videoUrl.startsWith('https://') || !video.title.trim()) return false;
    if (video.thumbnailUrl && !video.thumbnailUrl.startsWith('https://')) return false;
    seen.add(video.id);
    return true;
  });
}
