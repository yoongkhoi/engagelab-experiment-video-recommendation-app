import { randomUUID } from 'node:crypto';
import type { AppEvent, EventType } from '../domain.js';
import { nowIso } from '../domain.js';
import type { Store } from '../repositories/store.js';

export class EventService {
  constructor(private readonly store: Store) {}

  record(input: {
    eventType: EventType;
    registrationId?: string | null;
    campaignId?: string | null;
    videoId?: string | null;
    experimentId?: string | null;
    variant?: 'A' | 'B' | null;
    dedupeKey?: string | null;
    source: AppEvent['source'];
    metadata?: unknown;
    occurredAt?: string;
  }): AppEvent {
    if (input.dedupeKey) {
      const existing = this.store.findEventByDedupe(input.eventType, input.dedupeKey);
      if (existing) return { ...existing, duplicate: true };
    }
    const now = nowIso();
    const event: AppEvent = {
      id: randomUUID(),
      eventType: input.eventType,
      registrationId: input.registrationId ?? null,
      campaignId: input.campaignId ?? null,
      videoId: input.videoId ?? null,
      experimentId: input.experimentId ?? null,
      variant: input.variant ?? null,
      dedupeKey: input.dedupeKey ?? null,
      source: input.source,
      metadata: input.metadata ?? null,
      occurredAt: input.occurredAt ?? now,
      createdAt: now,
    };
    this.store.insertEvent(event);
    if (event.registrationId) this.store.touchDevice(event.registrationId, event.occurredAt);
    return event;
  }
}
