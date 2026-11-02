import type { Store } from '../repositories/store.js';

export interface ExperimentAttribution {
  experimentId: string | null;
  variant: 'A' | 'B' | null;
}

/**
 * Device events are attributed only from the campaign row and the stored assignment.
 * Client-supplied experimentId and variant are ignored.
 * A mismatch, a missing assignment, or a video id that is not the campaign video
 * leaves the event unattributed so it is not an experiment conversion.
 */
export function resolveDeviceExperiment(
  store: Store,
  input: { registrationId: string; campaignId?: string | null; videoId?: string | null },
): ExperimentAttribution {
  const none: ExperimentAttribution = { experimentId: null, variant: null };
  if (!input.campaignId) return none;
  const campaign = store.getCampaign(input.campaignId);
  if (!campaign?.experimentId || (campaign.variant !== 'A' && campaign.variant !== 'B')) return none;
  if (input.videoId && input.videoId !== campaign.videoId) return none;
  const assignment = store.getAssignment(campaign.experimentId, input.registrationId);
  if (!assignment || assignment.variant !== campaign.variant) return none;
  return { experimentId: campaign.experimentId, variant: campaign.variant };
}
