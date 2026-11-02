export interface AndroidPushInput {
  title: string;
  alert: string;
  videoId: string;
  campaignId: string;
  category: string;
  requestId: string;
  packageName: string;
  registrationIds?: string[];
  tags?: string[];
  broadcast?: boolean;
  timeToLiveSeconds?: number;
}

export function buildAndroidIntentUrl(input: {
  packageName: string;
  videoId: string;
  campaignId: string;
  category: string;
}): string {
  for (const value of [input.videoId, input.campaignId, input.category, input.packageName]) {
    if (/[;\s]/.test(value)) {
      throw new Error('Intent values cannot contain spaces or semicolons.');
    }
  }
  const component = `${input.packageName}/${input.packageName}.MainActivity`;
  const action = `${input.packageName}.ACTION_OPEN`;
  return `intent:#Intent;action=${action};component=${component};S.video_id=${input.videoId};S.campaign_id=${input.campaignId};S.category=${input.category};end`;
}

export function buildPushBody(input: AndroidPushInput): Record<string, unknown> {
  if (input.broadcast && (input.registrationIds?.length || input.tags?.length)) {
    throw new Error('Broadcast targeting cannot be combined with registration IDs or tags.');
  }
  let to: string | Record<string, unknown>;
  if (input.broadcast) {
    to = 'all';
  } else if (input.tags?.length) {
    to = { tag: input.tags };
  } else if (input.registrationIds?.length) {
    to = { registration_id: input.registrationIds };
  } else {
    throw new Error('Push target is empty. Refusing to widen the audience.');
  }

  const customArgs = buildCustomArgs(input.campaignId);
  return {
    from: 'push',
    to,
    body: {
      platform: 'android',
      notification: {
        alert: input.alert,
        android: {
          alert: input.alert,
          title: input.title,
          channel_id: 'engage_video_push',
          extras: {
            video_id: input.videoId,
            campaign_id: input.campaignId,
            category: input.category,
          },
          intent: {
            url: buildAndroidIntentUrl(input),
          },
        },
      },
      options: {
        time_to_live: input.timeToLiveSeconds ?? 86400,
      },
    },
    request_id: input.requestId,
    ...(customArgs ? { custom_args: customArgs } : {}),
  };
}

/**
 * Create Push API: custom_args is an optional JSON object, at most 128 serialized characters.
 * It is returned on EngageLab callbacks. It is not the Android notification extras.
 * Strings are documented for Live Activity and VoIP examples, not for this notification body.
 */
export function buildCustomArgs(campaignId: string): Record<string, string> | undefined {
  const value = { campaign_id: campaignId };
  if (JSON.stringify(value).length > 128) return undefined;
  return value;
}

export function buildSingleScheduleBody(input: {
  name: string;
  time: string;
  zoneType: 1 | 2;
  push: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    name: input.name,
    enabled: true,
    trigger: {
      single: {
        time: input.time,
        zone_type: input.zoneType,
      },
    },
    push: input.push,
  };
}

export function newRequestId(): string {
  const random = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `${Date.now()}${random}`;
}
