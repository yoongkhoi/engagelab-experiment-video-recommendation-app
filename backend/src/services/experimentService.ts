import type { Experiment, ExperimentSimulation, ExperimentTestSend } from '../domain.js';
import { nowIso } from '../domain.js';
import { HttpError } from '../errors.js';
import type { Store } from '../repositories/store.js';
import { assignVariant, newId, resolveAudience, type TargetingInput } from './audience.js';
import type { CampaignService } from './campaignService.js';
import type { VideoService } from './videoService.js';

export interface ExperimentInput {
  name: string;
  videoId: string;
  variantA: { title: string; message: string };
  variantB: { title: string; message: string };
  targeting: TargetingInput;
  allocationA: number;
  durationHours: number;
  primaryMetric: Experiment['primaryMetric'];
}

export class ExperimentService {
  constructor(
    private readonly store: Store,
    private readonly videos: VideoService,
    private readonly campaigns: CampaignService,
  ) {}

  list(): Experiment[] {
    return this.store.listExperiments().map((experiment) => this.withEffectiveStatus(experiment));
  }

  get(id: string): Experiment {
    const experiment = this.store.getExperiment(id);
    if (!experiment) throw new HttpError(404, 'EXPERIMENT_NOT_FOUND', `Experiment ${id} was not found.`);
    return this.withEffectiveStatus(experiment);
  }

  create(input: ExperimentInput): Experiment {
    if (input.variantA.title === input.variantB.title && input.variantA.message === input.variantB.message) {
      throw new HttpError(400, 'EXPERIMENT_VARIANTS_IDENTICAL', 'Variant A and variant B need different title or message text. The experiment was not created.');
    }
    const video = this.videos.get(input.videoId);
    if (!video.active) throw new HttpError(409, 'VIDEO_INACTIVE', `Video ${input.videoId} is inactive.`);
    const now = nowIso();
    const experiment: Experiment = {
      id: newId(),
      name: input.name,
      videoId: input.videoId,
      variantA: input.variantA,
      variantB: input.variantB,
      targetingMode: input.targeting.mode,
      targetCategories: input.targeting.categories ?? [],
      requestedRegistrationIds: input.targeting.registrationIds ?? (input.targeting.registrationId ? [input.targeting.registrationId] : []),
      confirmBroadcast: Boolean(input.targeting.confirmBroadcast),
      acknowledgeTagScope: Boolean(input.targeting.acknowledgeTagScope),
      allocationA: input.allocationA,
      durationHours: input.durationHours,
      primaryMetric: input.primaryMetric,
      status: 'draft',
      startedAt: null,
      endsAt: null,
      campaignAId: null,
      campaignBId: null,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    this.store.insertExperiment(experiment);
    return experiment;
  }

  preview(id: string) {
    const experiment = this.get(id);
    let registrationIds: string[] = [];
    try {
      registrationIds = this.audienceFor(experiment).registrationIds;
    } catch (error) {
      if (!(error instanceof HttpError) || (error.code !== 'TARGET_EMPTY' && error.code !== 'INSUFFICIENT_AUDIENCE')) throw error;
    }
    const audience = { registrationIds };
    const groups: Record<'A' | 'B', string[]> = { A: [], B: [] };
    for (const registrationId of audience.registrationIds) {
      groups[assignVariant(experiment.id, registrationId, experiment.allocationA)].push(hint(registrationId));
    }
    const realDevices = audience.registrationIds.length;
    return {
      engageLabCalled: false,
      sent: false,
      realDevices,
      sufficientForStart: realDevices >= 2 && groups.A.length > 0 && groups.B.length > 0,
      sufficientForSignificance: groups.A.length >= 30 && groups.B.length >= 30,
      warning: realDevices < 2
        ? `This database has ${realDevices} real device${realDevices === 1 ? '' : 's'}. One real device cannot fill both variants, so Start will not send. Use the labelled simulation, or send one variant to the stored device as a separate test.`
        : groups.A.length < 30 || groups.B.length < 30
          ? 'Both variants need at least 30 real devices before a result can leave preliminary. A smaller audience does not identify a winner.'
          : 'The real audience is large enough for the project significance rule. Provider acceptance is still not device delivery.',
      variants: {
        A: { title: experiment.variantA.title, message: experiment.variantA.message, recipients: groups.A.length },
        B: { title: experiment.variantB.title, message: experiment.variantB.message, recipients: groups.B.length },
      },
      allocationA: experiment.allocationA,
      durationHours: experiment.durationHours,
    };
  }

  simulate(id: string, syntheticUsers = 60): ExperimentSimulation {
    const experiment = this.get(id);
    const count = Math.min(200, Math.max(2, Math.floor(syntheticUsers)));
    const groups = { A: 0, B: 0 };
    for (let index = 0; index < count; index += 1) {
      groups[assignVariant(experiment.id, `synthetic-${index}`, experiment.allocationA)] += 1;
    }
    if (!groups.A || !groups.B) {
      throw new HttpError(422, 'SIMULATION_VARIANT_EMPTY', 'The synthetic split put every simulated user in one variant. Increase the synthetic audience. No push was sent.');
    }
    const row: ExperimentSimulation = {
      id: newId(),
      experimentId: experiment.id,
      syntheticUsers: count,
      variantA: groups.A,
      variantB: groups.B,
      note: 'Synthetic users only. They are not real recipients, not delivered notifications, and not a click-through rate.',
      createdAt: nowIso(),
    };
    this.store.insertSimulation(row);
    return row;
  }

  async testSend(id: string, variant: 'A' | 'B', registrationId: string, confirm: boolean): Promise<ExperimentTestSend> {
    if (!confirm) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Set confirm=true to send one variant to one stored device. Nothing was sent.');
    const experiment = this.get(id);
    const device = this.store.getDeviceByRegistration(registrationId);
    if (!device) throw new HttpError(404, 'DEVICE_NOT_FOUND', 'That Registration ID is not stored. Nothing was sent.');
    const copy = variant === 'A' ? experiment.variantA : experiment.variantB;
    const draft = await this.campaigns.createDraft({
      name: `${experiment.name} single-device ${variant}`.slice(0, 120),
      videoId: experiment.videoId,
      title: copy.title,
      message: copy.message,
      targeting: { mode: 'registration_ids', registrationIds: [device.registrationId] },
    });
    const sent = await this.campaigns.send(draft.id);
    const row: ExperimentTestSend = {
      id: newId(),
      experimentId: experiment.id,
      variant,
      registrationHint: hint(device.registrationId),
      campaignId: sent.id,
      simulated: sent.simulated,
      providerStatus: sent.status,
      deviceDeliveryVerified: false,
      createdAt: nowIso(),
    };
    this.store.insertTestSend(row);
    return row;
  }

  async start(id: string): Promise<{ experiment: Experiment; simulated: boolean }> {
    const experiment = this.store.getExperiment(id);
    if (!experiment) throw new HttpError(404, 'EXPERIMENT_NOT_FOUND', `Experiment ${id} was not found.`);
    if (experiment.status === 'running' || experiment.status === 'completed') {
      throw new HttpError(409, 'EXPERIMENT_ALREADY_STARTED', `Experiment ${id} is ${experiment.status}. No additional push was sent.`);
    }
    if (this.store.listAssignments(experiment.id).length) {
      throw new HttpError(409, 'EXPERIMENT_ALREADY_STARTED', 'Devices are already assigned for this experiment. No additional push was sent.');
    }
    const audience = this.audienceFor(experiment);
    if (audience.registrationIds.length < 2) {
      throw new HttpError(
        422,
        'INSUFFICIENT_AUDIENCE',
        `Start needs at least two real stored devices so both variants receive one. This audience has ${audience.registrationIds.length}. No push was sent. A labelled simulation is separate and is not a real delivery.`,
      );
    }

    const startedAt = nowIso();
    const groups: Record<'A' | 'B', string[]> = { A: [], B: [] };
    for (const registrationId of audience.registrationIds) {
      groups[assignVariant(experiment.id, registrationId, experiment.allocationA)].push(registrationId);
    }
    if (!groups.A.length || !groups.B.length) {
      throw new HttpError(
        422,
        'EXPERIMENT_VARIANT_EMPTY',
        'The deterministic split put every eligible device in one variant. Add more devices or change the allocation. No push was sent.',
      );
    }
    for (const variant of ['A', 'B'] as const) {
      for (const registrationId of groups[variant]) {
        this.store.insertAssignment({ experimentId: experiment.id, registrationId, variant, assignedAt: startedAt });
      }
    }

    const endsAt = new Date(Date.now() + experiment.durationHours * 3600_000).toISOString();
    try {
      const campaignA = await this.sendVariant(experiment, 'A', groups.A);
      const campaignB = await this.sendVariant(experiment, 'B', groups.B);
      const running: Experiment = {
        ...experiment,
        status: 'running',
        startedAt,
        endsAt,
        campaignAId: campaignA.id,
        campaignBId: campaignB.id,
        errorMessage: null,
        updatedAt: nowIso(),
      };
      this.store.updateExperiment(running);
      return { experiment: running, simulated: campaignA.simulated && campaignB.simulated };
    } catch (error) {
      const failed: Experiment = {
        ...experiment,
        status: 'failed',
        startedAt,
        endsAt,
        errorMessage: error instanceof Error ? error.message : 'Experiment start failed',
        updatedAt: nowIso(),
      };
      this.store.updateExperiment(failed);
      throw error;
    }
  }

  private audienceFor(experiment: Experiment) {
    const audience = resolveAudience({
      mode: experiment.targetingMode,
      registrationId: experiment.requestedRegistrationIds[0],
      registrationIds: experiment.requestedRegistrationIds,
      categories: experiment.targetCategories,
      confirmBroadcast: experiment.confirmBroadcast,
      acknowledgeTagScope: experiment.acknowledgeTagScope,
    }, this.store.listDevices(), this.savedInterests());
    if (audience.broadcast) {
      throw new HttpError(400, 'EXPERIMENT_BROADCAST_UNSUPPORTED', 'A/B experiments require an explicit device list or category so each device stays in one variant.');
    }
    return audience;
  }

  private savedInterests(): Map<string, string[]> {
    const interests = new Map<string, string[]>();
    for (const user of this.store.listUsers()) {
      const categories = this.store.getPreferences(user.id)?.categories ?? [];
      if (categories.length) interests.set(user.id, [...categories]);
    }
    return interests;
  }

  private async sendVariant(experiment: Experiment, variant: 'A' | 'B', registrationIds: string[]) {
    const copy = variant === 'A' ? experiment.variantA : experiment.variantB;
    const draft = await this.campaigns.createDraft({
      name: `${experiment.name} variant ${variant}`,
      videoId: experiment.videoId,
      title: copy.title,
      message: copy.message,
      targeting: { mode: 'registration_ids', registrationIds },
      experimentId: experiment.id,
      variant,
    });
    return this.campaigns.send(draft.id);
  }

  private withEffectiveStatus(experiment: Experiment): Experiment {
    if (experiment.status === 'running' && experiment.endsAt && experiment.endsAt < nowIso()) {
      return { ...experiment, status: 'completed' };
    }
    return experiment;
  }
}

function hint(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
