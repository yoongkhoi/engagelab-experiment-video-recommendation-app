import type { EngageLabConfig } from '../config/env.js';
import { ProviderError } from '../errors.js';
import type { Logger } from 'pino';

export interface EngageLabCall {
  method: string;
  path: string;
  body?: unknown;
}

export function basicAuthHeader(appKey: string, masterSecret: string): string {
  return `Basic ${Buffer.from(`${appKey}:${masterSecret}`, 'utf8').toString('base64')}`;
}

export function scrubSecrets(value: string, appKey: string, masterSecret: string): string {
  let output = value;
  if (masterSecret) output = output.split(masterSecret).join('[redacted]');
  if (appKey && masterSecret) {
    output = output.split(Buffer.from(`${appKey}:${masterSecret}`, 'utf8').toString('base64')).join('[redacted]');
  }
  return output;
}

interface ProviderFailureBody {
  error?: { code?: number; message?: string; data?: unknown };
}

export class EngageLabClient {
  constructor(
    private readonly config: EngageLabConfig,
    private readonly fetchImpl: typeof fetch,
    private readonly log: Logger,
  ) {}

  assertConfigured(): void {
    if (!this.config.configured) {
      throw new ProviderError(
        'EngageLab is not configured. Set ENGAGELAB_APPKEY, ENGAGELAB_MASTER_SECRET, and ENGAGELAB_BASE_URL. Demo mode does not call the provider.',
        'configuration',
      );
    }
  }

  async createPush(body: Record<string, unknown>): Promise<{ msgId: string; requestId: string; raw: unknown }> {
    const raw = await this.request('POST', '/v4/push', body);
    const record = asRecord(raw);
    const msgId = stringField(record, 'msg_id');
    const requestId = stringField(record, 'request_id');
    if (!msgId) {
      throw new ProviderError(
        'EngageLab accepted the HTTP call but did not return msg_id. The push is not marked as accepted.',
        'provider',
        200,
        undefined,
        raw,
      );
    }
    return { msgId, requestId, raw };
  }

  async setDeviceTags(registrationId: string, add: string[], remove: string[]): Promise<unknown> {
    const tags: Record<string, string[]> = {};
    if (add.length) tags.add = add;
    if (remove.length) tags.remove = remove;
    return this.request('POST', `/v4/devices/${encodeURIComponent(registrationId)}`, { tags });
  }

  async addRegistrationIdsToTag(tag: string, registrationIds: string[]): Promise<unknown> {
    return this.request('POST', `/v4/tags/${encodeURIComponent(tag)}`, {
      registration_ids: { add: registrationIds },
    });
  }

  async getDevice(registrationId: string): Promise<{ tags: string[]; alias: string | null; raw: unknown }> {
    const raw = await this.request('GET', `/v4/devices/${encodeURIComponent(registrationId)}`);
    const record = asRecord(raw);
    const tags = Array.isArray(record.tags) ? record.tags.filter((item): item is string => typeof item === 'string') : [];
    const alias = typeof record.alias === 'string' ? record.alias : null;
    return { tags, alias, raw };
  }

  async createSchedule(body: Record<string, unknown>): Promise<{ scheduleId: string; name: string; raw: unknown }> {
    const raw = await this.request('POST', '/v4/schedules', body);
    const record = asRecord(raw);
    const scheduleId = stringField(record, 'schedule_id');
    if (!scheduleId) {
      throw new ProviderError(
        'EngageLab did not return schedule_id. The task is not marked as scheduled.',
        'provider',
        200,
        undefined,
        raw,
      );
    }
    return { scheduleId, name: stringField(record, 'name'), raw };
  }

  async getSchedule(scheduleId: string): Promise<unknown> {
    return this.request('GET', `/v4/schedules/${encodeURIComponent(scheduleId)}`);
  }

  async listTags(): Promise<unknown> {
    return this.request('GET', '/v4/tags/');
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    this.assertConfigured();
    const url = `${this.config.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Authorization: basicAuthHeader(this.config.appKey, this.config.masterSecret),
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      const message = error instanceof Error ? error.message : 'Network request failed';
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new ProviderError(
          `EngageLab request timed out after ${this.config.timeoutMs}ms (${method} ${path}).`,
          'timeout',
        );
      }
      this.log.warn({ method, path, errorName: name }, 'EngageLab network failure');
      throw new ProviderError(`EngageLab network request failed: ${scrubSecrets(message, this.config.appKey, this.config.masterSecret)}`, 'network');
    }

    const text = await response.text();
    const parsed = parseBody(text);
    const scrubbed = scrubParsed(parsed, this.config.appKey, this.config.masterSecret);

    if (!response.ok) {
      throw classifyHttpFailure(response.status, scrubbed, method, path);
    }

    const record = asRecord(scrubbed);
    if (record.error && typeof record.error === 'object') {
      throw classifyHttpFailure(response.status || 400, scrubbed, method, path);
    }
    return scrubbed;
  }
}

function parseBody(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return trimmed;
  }
}

function scrubParsed(value: unknown, appKey: string, masterSecret: string): unknown {
  if (typeof value === 'string') return scrubSecrets(value, appKey, masterSecret);
  if (!value || typeof value !== 'object') return value;
  return JSON.parse(scrubSecrets(JSON.stringify(value), appKey, masterSecret)) as unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

function classifyHttpFailure(status: number, body: unknown, method: string, path: string): ProviderError {
  const record = asRecord(body);
  const error = (record.error ?? {}) as ProviderFailureBody['error'];
  const providerCode = typeof error?.code === 'number' ? error.code : undefined;
  const providerMessage = typeof error?.message === 'string' ? error.message : '';
  const suffix = providerMessage ? ` ${providerMessage}` : '';
  const base = `EngageLab ${method} ${path} failed with HTTP ${status}.${suffix}`.trim();

  if (status === 401 || status === 403 || providerCode === 21003 || providerCode === 2002) {
    return new ProviderError(`${base} Authentication failed. Check the AppKey, Master Secret, and that the base URL matches the application's data center.`, 'authentication', status, providerCode, body);
  }
  if (providerCode === 21008) {
    return new ProviderError(`${base} The AppKey format was rejected.`, 'authentication', status, providerCode, body);
  }
  if (status === 400 || status === 404 || status === 422) {
    return new ProviderError(base, 'validation', status, providerCode, body);
  }
  if (status >= 500) {
    return new ProviderError(base, 'provider', status, providerCode, body);
  }
  return new ProviderError(base, 'provider', status, providerCode, body);
}
