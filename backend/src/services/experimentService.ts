import type { Experiment } from '../domain.js';
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

  async start(id: string): Promise<Experiment> {
    const experiment = this.store.getExperiment(id);
    if (!experiment) throw new HttpError(404, 'EXPERIMENT_NOT_FOUND', `Experiment ${id} was not found.`);
    if (experiment.status === 'running' || experiment.status === 'completed') {
      throw new HttpError(409, 'EXPERIMENT_ALREADY_STARTED', `Experiment ${id} is ${experiment.status}.`);
    }
    const audience = resolveAudience({
      mode: experiment.targetingMode,
      registrationId: experiment.requestedRegistrationIds[0],
      registrationIds: experiment.requestedRegistrationIds,
      categories: experiment.targetCategories,
      confirmBroadcast: experiment.confirmBroadcast,
      acknowledgeTagScope: experiment.acknowledgeTagScope,
    }, this.store.listDevices());
    if (audience.broadcast) {
      throw new HttpError(400, 'EXPERIMENT_BROADCAST_UNSUPPORTED', 'A/B experiments require an explicit device list or category so each device stays in one variant.');
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
      return running;
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
