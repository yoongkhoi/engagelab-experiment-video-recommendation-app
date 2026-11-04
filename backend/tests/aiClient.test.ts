import { describe, expect, it } from 'vitest';
import { HttpError } from '../src/errors.js';
import { HttpAiClient } from '../src/services/aiClient.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('AI client errors', () => {
  it('turns provider failures into distinct user-facing messages', async () => {
    const cases: Array<{ status: number; code: string; expected: string; http: number }> = [
      { status: 422, code: 'VALIDATION_ERROR', expected: 'The chat request was not accepted. Send the message again.', http: 400 },
      { status: 503, code: 'PIXABAY_UNAVAILABLE', expected: 'Video search is unavailable right now.', http: 503 },
      { status: 503, code: 'LLM_NOT_CONFIGURED', expected: 'The video assistant is not available right now.', http: 503 },
      { status: 502, code: 'LLM_UNAVAILABLE', expected: 'The video assistant could not answer. Try again.', http: 502 },
      { status: 504, code: 'AI_TIMEOUT', expected: 'The video assistant timed out. Try again.', http: 504 },
    ];
    for (const item of cases) {
      const client = new HttpAiClient('http://ai.example', 1000, async () => jsonResponse(item.status, {
        error: { code: item.code, message: 'Traceback (most recent call last): secret' },
      }));
      await expect(client.recommend({ message: 'f1' })).rejects.toMatchObject({
        status: item.http,
        code: item.code === 'VALIDATION_ERROR' ? 'VALIDATION_ERROR' : item.code,
        message: item.expected,
      });
    }
  });

  it('reports a timeout when the AI request is aborted', async () => {
    const client = new HttpAiClient('http://ai.example', 1000, async () => {
      const error = new Error('The operation was aborted');
      error.name = 'AbortError';
      throw error;
    });
    await expect(client.recommend({ message: 'f1' })).rejects.toBeInstanceOf(HttpError);
    await expect(client.recommend({ message: 'f1' })).rejects.toMatchObject({ status: 504, code: 'AI_TIMEOUT' });
  });
});
