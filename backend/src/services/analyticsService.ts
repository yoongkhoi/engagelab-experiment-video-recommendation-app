import type { AppConfig } from '../config/env.js';
import { CATEGORIES } from '../domain.js';
import type { Store } from '../repositories/store.js';
import type { ExperimentService } from './experimentService.js';

export class AnalyticsService {
  constructor(
    private readonly store: Store,
    private readonly experimentService: ExperimentService,
    private readonly config: AppConfig,
  ) {}

  overview() {
    const devices = this.store.listDevices();
    const campaigns = this.store.listCampaigns();
    const videos = this.store.listVideos(false);
    const byCategory: Record<string, number> = {};
    for (const category of CATEGORIES) {
      byCategory[category] = devices.filter((device) => device.categories.includes(category)).length;
    }
    const byStatus: Record<string, number> = {};
    for (const campaign of campaigns) byStatus[campaign.status] = (byStatus[campaign.status] ?? 0) + 1;
    return {
      sources: {
        devices: 'SQLite devices table. A row means this backend stored a Registration ID reported by the app.',
        events: 'SQLite events table. Device events are recorded only when the app posts them.',
        providerDelivery: 'Unavailable. This API does not invent EngageLab delivery or click-through rates.',
      },
      devices: { total: devices.length, byCategory },
      campaigns: { total: campaigns.length, byStatus, recent: campaigns.slice(0, 8) },
      videos: { total: videos.length, active: videos.filter((video) => video.active).length, byCategory: countVideos(videos) },
      events: {
        notificationOpened: this.store.countEvents({ eventType: 'notification_opened', source: 'device' }),
        videoOpened: this.store.countEvents({ eventType: 'video_opened', source: 'device' }),
        videoPlayStarted: this.store.countEvents({ eventType: 'video_play_started', source: 'device' }),
        videoPlayCompleted: this.store.countEvents({ eventType: 'video_play_completed', source: 'device' }),
        pushSubmittedToProvider: this.store.countEvents({ eventType: 'push_submitted', source: 'server' }),
      },
      provider: {
        mode: this.config.mode,
        configured: this.config.engagelab.configured,
        knownDataCenter: this.config.engagelab.knownDataCenter,
        deliveryMetricsAvailable: false,
      },
    };
  }

  campaigns() {
    return this.store.listCampaigns().map((campaign) => ({
      campaignId: campaign.id,
      name: campaign.name,
      status: campaign.status,
      providerMode: campaign.providerMode,
      simulated: campaign.simulated,
      providerMsgIds: campaign.providerMsgIds,
      providerScheduleId: campaign.providerScheduleId,
      definitions: {
        providerAccepted: 'accepted_by_provider means EngageLab returned msg_id. It does not mean the device displayed the notification.',
        notificationOpened: 'Count of notification_opened events posted by the Android app for this campaign.',
      },
      notificationOpened: this.store.countEvents({ eventType: 'notification_opened', campaignId: campaign.id, source: 'device' }),
      videoPlayStarted: this.store.countEvents({ eventType: 'video_play_started', campaignId: campaign.id, source: 'device' }),
      videoPlayCompleted: this.store.countEvents({ eventType: 'video_play_completed', campaignId: campaign.id, source: 'device' }),
    }));
  }

  videos() {
    return this.store.listVideos(false).map((video) => ({
      videoId: video.id,
      title: video.title,
      category: video.category,
      active: video.active,
      videoOpened: this.store.countEvents({ eventType: 'video_opened', videoId: video.id, source: 'device' }),
      videoPlayStarted: this.store.countEvents({ eventType: 'video_play_started', videoId: video.id, source: 'device' }),
      videoPlayCompleted: this.store.countEvents({ eventType: 'video_play_completed', videoId: video.id, source: 'device' }),
    }));
  }

  experiments() {
    return this.experimentService.list().map((experiment) => this.experimentResult(experiment.id));
  }

  experimentResult(id: string) {
    const experiment = this.experimentService.get(id);
    const assignments = this.store.listAssignments(experiment.id);
    const sampleA = assignments.filter((item) => item.variant === 'A').length;
    const sampleB = assignments.filter((item) => item.variant === 'B').length;
    const from = experiment.startedAt ?? undefined;
    const to = experiment.endsAt ?? undefined;
    const metric = experiment.primaryMetric;
    const successesA = this.store.countEvents({ eventType: metric, experimentId: experiment.id, variant: 'A', source: 'device', from, to });
    const successesB = this.store.countEvents({ eventType: metric, experimentId: experiment.id, variant: 'B', source: 'device', from, to });
    const stats = twoProportion(successesA, sampleA, successesB, sampleB);
    return {
      experiment,
      measurementWindow: { from: experiment.startedAt, to: experiment.endsAt },
      primaryMetric: metric,
      metricDefinition: metric === 'notification_opened'
        ? 'Device-reported notification_opened events inside the measurement window. Not an EngageLab delivery count.'
        : 'Device-reported video_play_started events inside the measurement window.',
      variants: {
        A: { sampleSize: sampleA, successes: successesA, rate: rate(successesA, sampleA), realRecipients: true },
        B: { sampleSize: sampleB, successes: successesB, rate: rate(successesB, sampleB), realRecipients: true },
      },
      statistics: stats,
      simulation: {
        runs: this.store.listSimulations(experiment.id),
        countedAsRealRecipients: false,
        countedAsDelivered: false,
        countedAsCtr: false,
      },
      testSends: this.store.listTestSends(experiment.id),
      realAudienceWarning: sampleA < 30 || sampleB < 30
        ? 'Real sample is below 30 devices per variant. Significance stays unavailable. Simulated users are not included in this sample.'
        : null,
    };
  }
}

function countVideos(videos: { category: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const video of videos) counts[video.category] = (counts[video.category] ?? 0) + 1;
  return counts;
}

function rate(successes: number, sample: number): number | null {
  if (!sample) return null;
  return Number((successes / sample).toFixed(4));
}

function twoProportion(successA: number, sampleA: number, successB: number, sampleB: number) {
  if (sampleA < 30 || sampleB < 30) {
    return {
      test: 'two-proportion z-test',
      preliminary: true,
      significant: null,
      pValue: null,
      reason: 'Insufficient sample size. At least 30 assigned devices per variant are required before this project reports statistical significance.',
    };
  }
  const pooled = (successA + successB) / (sampleA + sampleB);
  const variance = pooled * (1 - pooled) * (1 / sampleA + 1 / sampleB);
  if (variance <= 0) {
    return {
      test: 'two-proportion z-test',
      preliminary: true,
      significant: null,
      pValue: null,
      reason: 'The pooled variance is zero, so a z-test is not informative.',
    };
  }
  const z = (successA / sampleA - successB / sampleB) / Math.sqrt(variance);
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return {
    test: 'two-sided two-proportion z-test, alpha 0.05',
    preliminary: false,
    significant: pValue < 0.05,
    pValue: Number(pValue.toFixed(4)),
    z: Number(z.toFixed(3)),
    reason: pValue < 0.05
      ? 'The difference is statistically significant at alpha 0.05 under the two-proportion z-test assumptions.'
      : 'The difference is not statistically significant at alpha 0.05.',
  };
}

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}
