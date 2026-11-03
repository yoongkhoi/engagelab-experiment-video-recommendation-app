import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { CapturingMailer } from '../src/services/mailer.js';
import { createApp } from '../src/app.js';
import { Sqlite } from '../src/db/database.js';
import { demoConfig } from './helpers.js';

const open: Array<{ close: () => void }> = [];
afterEach(() => { while (open.length) open.pop()?.close(); });

function appWithMail() {
  const mailer = new CapturingMailer();
  const sqlite = Sqlite.open(':memory:');
  open.push(sqlite);
  const created = createApp({ config: demoConfig(), sqlite, mailer });
  return { app: created.app, mailer, sqlite };
}

describe('email OTP', () => {
  it('creates a session without returning the code and rejects reuse, expiry, and bad codes', async () => {
    const { app, mailer } = appWithMail();
    const requested = await request(app).post('/api/auth/otp/request').send({ email: 'Person@Example.com' });
    expect(requested.status).toBe(200);
    expect(JSON.stringify(requested.body)).not.toMatch(/\d{6}/);
    expect(mailer.sent).toHaveLength(1);
    const code = mailer.sent[0].code;

    const wrong = await request(app).post('/api/auth/otp/verify').send({ email: 'person@example.com', code: '000000' });
    expect(wrong.status).toBe(401);

    const verified = await request(app).post('/api/auth/otp/verify').send({ email: 'person@example.com', code });
    expect(verified.status).toBe(200);
    expect(verified.body.created).toBe(true);
    expect(verified.body.token).toBeTruthy();

    const again = await request(app).post('/api/auth/otp/verify').send({ email: 'person@example.com', code });
    expect(again.status).toBe(401);

    const me = await request(app).get('/api/me').set('Authorization', `Bearer ${verified.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('person@example.com');

    const other = await request(app).get('/api/me/preferences').set('Authorization', 'Bearer not-a-session');
    expect(other.status).toBe(401);
  });

  it('rejects an expired code', async () => {
    const { app, mailer, sqlite } = appWithMail();
    await request(app).post('/api/auth/otp/request').send({ email: 'old@example.com' });
    sqlite.run('UPDATE auth_challenges SET expires_at = ?', '2000-01-01T00:00:00.000Z');
    const expired = await request(app).post('/api/auth/otp/verify').send({ email: 'old@example.com', code: mailer.sent[0].code });
    expect(expired.status).toBe(401);
    expect(expired.body.error.code).toBe('OTP_EXPIRED');
  });

  it('rate-limits a second immediate request and keeps preferences on the signed-in user', async () => {
    const { app, mailer } = appWithMail();
    await request(app).post('/api/auth/otp/request').send({ email: 'viewer@example.com' });
    const limited = await request(app).post('/api/auth/otp/request').send({ email: 'viewer@example.com' });
    expect(limited.status).toBe(429);
    const code = mailer.sent[0].code;
    const verified = await request(app).post('/api/auth/otp/verify').send({ email: 'viewer@example.com', code });
    const token = verified.body.token as string;
    const saved = await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${token}`).send({ categories: ['nature', 'animals'] });
    expect(saved.status).toBe(200);
    const loaded = await request(app).get('/api/me/preferences').set('Authorization', `Bearer ${token}`);
    expect(loaded.body.preferences.categories).toEqual(['nature', 'animals']);
    const rejected = await request(app).put('/api/me/preferences').set('Authorization', `Bearer ${token}`).send({ categories: ['tech'] });
    expect(rejected.status).toBe(400);
  });

  it('links a device to the user and does not broadcast an unknown Registration ID', async () => {
    const { app, mailer } = appWithMail();
    await request(app).post('/api/auth/otp/request').send({ email: 'device@example.com' });
    const verified = await request(app).post('/api/auth/otp/verify').send({ email: 'device@example.com', code: mailer.sent[0].code });
    const token = verified.body.token as string;
    const registered = await request(app).post('/api/devices/register').set('Authorization', `Bearer ${token}`).send({
      registrationId: 'regUserDevice01',
      platform: 'android',
      deviceType: 'phone',
      installationId: 'install-user-0001',
      categories: ['tech'],
      notificationEnabled: true,
    });
    expect(registered.status).toBe(201);
    expect(registered.body.device.userId).toBe(verified.body.user.id);
    const listed = await request(app).get('/api/devices').set('Authorization', 'Bearer test-admin-key-123');
    expect(listed.body.devices[0].email).toBe('device@example.com');
    const removed = await request(app).post(`/api/devices/${registered.body.device.id}/disassociate`).set('Authorization', 'Bearer test-admin-key-123');
    expect(removed.status).toBe(200);
    expect(removed.body.device.userId).toBeNull();
    expect(removed.body.device.registrationId).toBe('regUserDevice01');

    const { app: adminApp } = appWithMail();
    const preview = await request(adminApp).post('/api/push/preview').set('Authorization', 'Bearer test-admin-key-123').send({
      videoId: '1001',
      targeting: { mode: 'registration_id', registrationId: 'regMissing0001' },
    });
    expect(preview.status).toBe(200);
    expect(preview.body.willSend).toBe(false);
    expect(preview.body.broadcast).toBe(false);
  });
});
