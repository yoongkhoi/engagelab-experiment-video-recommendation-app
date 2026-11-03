import request from 'supertest';
import type { Express } from 'express';
import { loadConfig, type AppConfig } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { Sqlite } from '../src/db/database.js';

export const ADMIN = 'test-admin-key-123';

export function demoConfig(overrides: NodeJS.ProcessEnv = {}): AppConfig {
  return loadConfig({
    ADMIN_API_KEY: ADMIN,
    DATABASE_URL: ':memory:',
    DEMO_MODE: 'auto',
    ENGAGELAB_APPKEY: '',
    ENGAGELAB_MASTER_SECRET: '',
    ENGAGELAB_BASE_URL: '',
    PORT: '3000',
    SESSION_PEPPER: 'test-session-pepper-value',
    AUTH_EMAIL_MODE: 'test',
    ...overrides,
  });
}

export function liveConfig(): AppConfig {
  return demoConfig({
    ENGAGELAB_APPKEY: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    ENGAGELAB_MASTER_SECRET: 'bbbbbbbbbbbbbbbbbbbbbbbb',
    ENGAGELAB_BASE_URL: 'https://pushapi-sgp.engagelab.com',
    ENGAGELAB_SITE_TIMEZONE: 'Asia/Singapore',
    ENGAGELAB_TIMEOUT_MS: '1000',
  });
}

export function buildApp(config = demoConfig(), fetchImpl?: typeof fetch) {
  const sqlite = Sqlite.open(':memory:');
  const created = createApp({ config, sqlite, fetchImpl });
  const now = new Date().toISOString();
  for (const video of [
    { id: '1001', title: 'Signal Path', category: 'tech' },
    { id: '1002', title: 'Cut to the Punchline', category: 'funny' },
    { id: '1003', title: 'Weekend Drift', category: 'lifestyle' },
  ]) {
    created.store.insertVideo({
      id: video.id,
      title: video.title,
      description: 'Test fixture. This file is not shipped to the app.',
      category: video.category,
      sourceType: 'remote',
      source: 'https://example.com/video.mp4',
      assetFilename: null,
      thumbnailUrl: null,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
  }
  return { ...created, config };
}

export function admin(app: Express) {
  const client = request(app);
  const header = `Bearer ${ADMIN}`;
  return {
    get: (url: string) => client.get(url).set('Authorization', header),
    post: (url: string) => client.post(url).set('Authorization', header),
    put: (url: string) => client.put(url).set('Authorization', header),
    delete: (url: string) => client.delete(url).set('Authorization', header),
  };
}

export async function registerDevice(app: Express, registrationId: string, categories = ['tech']) {
  const response = await request(app).post('/api/devices/register').send({
    registrationId,
    platform: 'android',
    categories,
    appVersion: '1.0.0',
  });
  return response;
}
