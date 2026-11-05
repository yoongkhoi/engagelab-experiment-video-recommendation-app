import { describe, expect, it } from 'vitest';
import { admin, buildApp, registerDevice } from './helpers.js';

function experimentBody(registrationIds: string[]) {
  return {
    name: 'QA title test',
    videoId: '1001',
    variantA: { title: 'Title A', message: 'Message A' },
    variantB: { title: 'Title B', message: 'Message B' },
    targeting: { mode: 'registration_ids', registrationIds },
    allocationA: 50,
    durationHours: 48,
    primaryMetric: 'notification_opened',
  };
}

describe('admin experiment and library safeguards', () => {
  it('refuses to start a one-device experiment and keeps the draft unsent', async () => {
    const { app } = buildApp();
    await registerDevice(app, 'regQaSingle0001', ['tech']);
    const created = await admin(app).post('/api/experiments').send(experimentBody(['regQaSingle0001']));
    expect(created.status).toBe(201);
    const started = await admin(app).post(`/api/experiments/${created.body.experiment.id}/start`).send({});
    expect(started.status).toBe(422);
    expect(started.body.error.code).toBe('INSUFFICIENT_AUDIENCE');
    expect(started.body.error.message).toMatch(/No push was sent/);
    const campaigns = await admin(app).get('/api/campaigns');
    expect(campaigns.body.campaigns).toHaveLength(0);
    const loaded = await admin(app).get(`/api/experiments/${created.body.experiment.id}`);
    expect(loaded.body.experiment.status).toBe('draft');
    expect(loaded.body.results.variants.A.sampleSize).toBe(0);
    expect(loaded.body.results.variants.B.sampleSize).toBe(0);
  });

  it('keeps a labelled simulation out of the real sample and does not call EngageLab', async () => {
    const { app } = buildApp();
    await registerDevice(app, 'regQaSim000001', ['tech']);
    const created = await admin(app).post('/api/experiments').send(experimentBody(['regQaSim000001']));
    const simulated = await admin(app).post(`/api/experiments/${created.body.experiment.id}/simulate`).send({ syntheticUsers: 60 });
    expect(simulated.status).toBe(200);
    expect(simulated.body.engageLabCalled).toBe(false);
    expect(simulated.body.countedAsRealRecipients).toBe(false);
    expect(simulated.body.countedAsCtr).toBe(false);
    expect(simulated.body.simulation.variantA).toBeGreaterThan(0);
    expect(simulated.body.simulation.variantB).toBeGreaterThan(0);
    const loaded = await admin(app).get(`/api/experiments/${created.body.experiment.id}`);
    expect(loaded.body.results.variants.A.sampleSize).toBe(0);
    expect(loaded.body.results.variants.B.sampleSize).toBe(0);
    expect(loaded.body.results.simulation.countedAsRealRecipients).toBe(false);
    expect(loaded.body.experiment.status).toBe('draft');
  });

  it('previews one real device without sending and keeps a test send out of the A/B sample', async () => {
    const { app } = buildApp();
    await registerDevice(app, 'regQaTest000001', ['tech']);
    const created = await admin(app).post('/api/experiments').send(experimentBody(['regQaTest000001']));
    const id = created.body.experiment.id as string;
    const preview = await admin(app).post(`/api/experiments/${id}/preview`).send({});
    expect(preview.status).toBe(200);
    expect(preview.body.engageLabCalled).toBe(false);
    expect(preview.body.realDevices).toBe(1);
    expect(preview.body.sufficientForSignificance).toBe(false);
    expect(preview.body.variants.A.recipients + preview.body.variants.B.recipients).toBe(1);
    const refused = await admin(app).post(`/api/experiments/${id}/test-send`).send({ variant: 'A', registrationId: 'regQaTest000001', confirm: false });
    expect(refused.status).toBe(400);
    const sent = await admin(app).post(`/api/experiments/${id}/test-send`).send({ variant: 'A', registrationId: 'regQaTest000001', confirm: true });
    expect(sent.status).toBe(200);
    expect(sent.body.testSend.simulated).toBe(true);
    expect(sent.body.testSend.deviceDeliveryVerified).toBe(false);
    expect(sent.body.testSend.registrationHint).not.toBe('regQaTest000001');
    expect(sent.body.countedAsExperimentSample).toBe(false);
    const loaded = await admin(app).get(`/api/experiments/${id}`);
    expect(loaded.body.experiment.status).toBe('draft');
    expect(loaded.body.results.variants.A.sampleSize).toBe(0);
    expect(loaded.body.results.variants.B.sampleSize).toBe(0);
  });

  it('rejects identical variants before creating an experiment', async () => {
    const { app } = buildApp();
    const created = await admin(app).post('/api/experiments').send({
      ...experimentBody(['regQaMissing0001']),
      variantB: { title: 'Title A', message: 'Message A' },
    });
    expect(created.status).toBe(400);
    expect(created.body.error.code).toBe('EXPERIMENT_VARIANTS_IDENTICAL');
  });
});
