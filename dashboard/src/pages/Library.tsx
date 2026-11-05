import { useEffect, useState } from 'react';
import { ApiError, api } from '../api';
import { targetedPreview } from '../lib/rules';

interface RemoteVideo {
  id: string;
  title: string;
  description: string;
  category: string;
  thumbnail_url?: string | null;
  video_url?: string;
  duration?: number;
  width?: number | null;
  height?: number | null;
}

interface LibraryEntry {
  videoId: string;
  libraryState: string;
  keywords: string[];
  tags: string[];
  video: { title: string; category: string; thumbnailUrl: string | null } | null;
}

interface LibraryCampaign {
  id: string;
  videoId: string;
  campaignId: string | null;
  status: string;
  note: string | null;
}

interface AudiencePreview {
  matched: number;
  eligible: number;
  excluded: number;
  queued: number;
  engageLabCalled: boolean;
  sent: boolean;
  reasons: string;
  topics?: string[];
}

const categories = ['travel', 'nature', 'food', 'technology', 'sports', 'animals', 'entertainment'];

export function LibraryPage() {
  const [query, setQuery] = useState('nature');
  const [results, setResults] = useState<RemoteVideo[]>([]);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [campaigns, setCampaigns] = useState<LibraryCampaign[]>([]);
  const [states, setStates] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState('');
  const [busy, setBusy] = useState('');

  async function load() {
    const data = await api<{ entries: LibraryEntry[]; campaigns?: LibraryCampaign[]; states?: Record<string, string> }>('/api/library');
    setEntries(data.entries);
    setCampaigns(data.campaigns ?? []);
    setStates(data.states ?? {});
  }

  useEffect(() => { load().catch((reason) => setError(reason instanceof Error ? reason.message : 'Library failed')); }, []);

  async function search() {
    setError('');
    const data = await api<{ videos: RemoteVideo[] }>(`/api/videos?query=${encodeURIComponent(query)}`);
    setResults(data.videos);
  }

  async function add(video: RemoteVideo) {
    setError('');
    try {
      await api('/api/library', { method: 'POST', body: JSON.stringify({ videoId: video.id, category: categories.includes(video.category) ? video.category : 'nature', keywords: query.split(/\s+/).slice(0, 3), tags: [] }) });
      setMessage(`Added ${video.id} as a draft. It is not published and no push was sent.`);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not add the video.');
    }
  }

  function audienceFrom(result: { matched?: number; matchedUsers?: number; eligible?: number; willSend?: number; excluded?: number; skipped?: number; queued?: number; willQueue?: number; engageLabCalled?: boolean; sent?: boolean; topics?: string[]; matches?: Array<{ action: string; reason: string }> }): AudiencePreview {
    return {
      matched: result.matched ?? result.matchedUsers ?? 0,
      eligible: result.eligible ?? result.willSend ?? 0,
      excluded: result.excluded ?? result.skipped ?? 0,
      queued: result.queued ?? result.willQueue ?? 0,
      engageLabCalled: result.engageLabCalled ?? false,
      sent: result.sent ?? false,
      topics: result.topics,
      reasons: (result.matches ?? []).map((match) => `${match.action}:${match.reason}`).join(', '),
    };
  }

  async function publish(videoId: string) {
    setBusy(`publish-${videoId}`);
    setError('');
    try {
      const result = await api<{ libraryCampaignId: string; sent: boolean }>(`/api/library/${videoId}/publish`, { method: 'POST', body: '{}' });
      setMessage(result.sent ? 'Unexpected send.' : `Published ${videoId}. Campaign is a draft and no push was sent.`);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Publish failed. Nothing was sent.');
    } finally {
      setBusy('');
    }
  }

  async function previewVideo(videoId: string) {
    setBusy(`preview-${videoId}`);
    setError('');
    try {
      const result = await api<{ willSend: number; matchedUsers: number; registeredDevices: number; timezone: string; matched?: number; eligible?: number; excluded?: number; willQueue?: number; matches?: Array<{ action: string; reason: string }> }>(`/api/library/${videoId}/preview`, { method: 'POST', body: '{}' });
      const gate = targetedPreview(result.willSend, false);
      const next = audienceFrom(result);
      setPreview(next);
      setMessage(`${next.matched} matched, ${next.eligible} eligible, ${next.excluded} excluded, ${next.queued} queued (${gate}). Timezone ${result.timezone}. Nothing was sent.`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Preview failed. Nothing was sent.');
    } finally {
      setBusy('');
    }
  }

  async function dryRun(videoId: string) {
    setBusy(`dry-${videoId}`);
    setError('');
    try {
      const result = await api<{ sent: boolean; engageLabCalled: boolean; topics: string[]; matched?: number; eligible?: number; excluded?: number; queued?: number; matches: Array<{ action: string; reason: string }> }>(`/api/library/${videoId}/dry-run`, { method: 'POST', body: '{}' });
      setPreview(audienceFrom(result));
      setMessage(`Dry run. EngageLab called=${result.engageLabCalled}. Sent=${result.sent}. Topics=${result.topics.join(', ') || 'none'}. Nothing was delivered.`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Dry run failed. Nothing was sent.');
    } finally {
      setBusy('');
    }
  }

  async function activate(id: string) {
    if (pendingId !== id) {
      setPendingId(id);
      setNoticeSafe(`Confirm activation for this campaign. It targets eligible matched devices only. It does not broadcast, and provider acceptance is not device delivery.`);
      return;
    }
    setBusy(`activate-${id}`);
    setError('');
    try {
      const result = await api<{ simulated: boolean; sent: number; queued: number; deviceDeliveryVerified: boolean; duplicatePrevented?: boolean; engageLabCalled?: boolean; status: string }>(`/api/library/campaigns/${id}/activate`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
      setPendingId('');
      setMessage(result.duplicatePrevented
        ? `Already activated. Status ${result.status}. Sent=${result.sent}. EngageLab called=${result.engageLabCalled}. No duplicate push was created.`
        : `Activation status ${result.status}. Simulated=${result.simulated}. Eligible devices submitted=${result.sent}. Queued=${result.queued}. EngageLab called=${result.engageLabCalled}. Device delivery verified=${result.deviceDeliveryVerified}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Activation failed.');
    } finally {
      setBusy('');
    }
  }

  function setNoticeSafe(value: string) {
    setMessage(value);
  }

  return (
    <section>
      <h1>Video library</h1>
      <p className="muted">Search Pixabay, save a result, then publish it. Publishing does not send a push. Activation is a separate confirmation and never falls back to broadcast.</p>
      <div className="row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Pixabay search" />
        <button className="primary" type="button" onClick={() => search().catch((reason) => setError(reason.message))}>Search Pixabay</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="banner">{message}</p> : null}
      {preview ? <p>Matched {preview.matched}. Eligible {preview.eligible}. Excluded {preview.excluded}. Queued {preview.queued}. EngageLab called={String(preview.engageLabCalled)}. Sent={String(preview.sent)}. {preview.topics?.length ? `Topics ${preview.topics.join(', ')}.` : ''} {preview.reasons}</p> : null}
      <div className="grid">
        {results.map((video) => (
          <article className="card" key={video.id}>
            {video.thumbnail_url ? <img src={video.thumbnail_url} alt="" width="100%" /> : null}
            <strong style={{ fontSize: 16 }}>{video.title}</strong>
            <div className="muted">{video.id} · {video.duration ?? '?'}s · {video.width ?? '?'}×{video.height ?? '?'}</div>
            {video.video_url ? <video src={video.video_url} controls poster={video.thumbnail_url ?? undefined} style={{ width: '100%' }} /> : null}
            <button className="ghost" type="button" onClick={() => add(video)}>Add to library</button>
          </article>
        ))}
      </div>
      <h2>Library entries</h2>
      <table>
        <thead><tr><th>Video</th><th>State</th><th>Keywords</th><th></th></tr></thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.videoId}>
              <td>{entry.video?.title ?? entry.videoId}</td>
              <td><span className="badge">{entry.libraryState}</span></td>
              <td>{entry.keywords.join(', ')}</td>
              <td className="row">
                {entry.libraryState !== 'published' ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => publish(entry.videoId)}>{busy === `publish-${entry.videoId}` ? 'Publishing…' : 'Publish'}</button> : null}
                {entry.libraryState === 'published' ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => previewVideo(entry.videoId)}>{busy === `preview-${entry.videoId}` ? 'Previewing…' : 'Preview'}</button> : null}
                {entry.libraryState === 'published' ? <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => dryRun(entry.videoId)}>{busy === `dry-${entry.videoId}` ? 'Running…' : 'Dry run'}</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Draft means saved and not sent. Published means the video can be matched and still has not been sent. Active means activation submitted a targeted campaign. Paused blocks further sends. Completed means that activation had no further immediate recipient. Saving automatic campaigns does not send a push. The scheduler releases queued digests only when both scheduler flags are on.</p>
      <PolicyControls onMessage={setMessage} onError={setError} />
      <h2>Campaigns</h2>
      {!campaigns.length ? <p className="muted">Publish a library video to create a draft campaign.</p> : (
        <table>
          <thead><tr><th>Video</th><th>Status</th><th>Meaning</th><th></th></tr></thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id}>
                <td>{campaign.videoId}</td>
                <td><span className="badge">{campaign.status}</span></td>
                <td>{states[campaign.status] ?? campaign.note ?? ''}</td>
                <td className="row">
                  {campaign.status === 'draft' || campaign.status === 'active' ? (
                    <button className="primary" type="button" disabled={Boolean(busy)} onClick={() => activate(campaign.id)}>
                      {busy === `activate-${campaign.id}` ? 'Activating…' : pendingId === campaign.id ? 'Confirm activate' : 'Activate'}
                    </button>
                  ) : null}
                  {pendingId === campaign.id ? <button className="ghost" type="button" onClick={() => { setPendingId(''); setMessage('Activation cancelled. Nothing was sent.'); }}>Cancel</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PolicyControls({ onMessage, onError }: { onMessage: (value: string) => void; onError: (value: string) => void }) {
  const [maxPerDay, setMaxPerDay] = useState(3);
  const [minIntervalHours, setMinIntervalHours] = useState(4);
  const [recentExclusionHours, setRecentExclusionHours] = useState(24);
  const [automaticCampaigns, setAutomaticCampaigns] = useState(false);
  useEffect(() => {
    api<{ policy: { maxPerDay: number; minIntervalHours: number; recentExclusionHours: number; automaticCampaigns: boolean } }>('/api/admin/notification-policy')
      .then((result) => {
        setMaxPerDay(result.policy.maxPerDay);
        setMinIntervalHours(result.policy.minIntervalHours);
        setRecentExclusionHours(result.policy.recentExclusionHours);
        setAutomaticCampaigns(result.policy.automaticCampaigns);
      })
      .catch(() => undefined);
  }, []);
  return (
    <div className="row">
      <label>Max daily <input aria-label="Max daily notifications" type="number" value={maxPerDay} onChange={(event) => setMaxPerDay(Number(event.target.value))} /></label>
      <label>Min hours <input aria-label="Minimum notification interval" type="number" value={minIntervalHours} onChange={(event) => setMinIntervalHours(Number(event.target.value))} /></label>
      <label>Recent hours <input aria-label="Recent content exclusion" type="number" value={recentExclusionHours} onChange={(event) => setRecentExclusionHours(Number(event.target.value))} /></label>
      <label><input type="checkbox" checked={automaticCampaigns} onChange={(event) => setAutomaticCampaigns(event.target.checked)} /> Automatic campaigns</label>
      <button className="ghost" type="button" onClick={() => api('/api/admin/notification-policy', { method: 'PUT', body: JSON.stringify({ maxPerDay, minIntervalHours, recentExclusionHours, automaticCampaigns }) }).then(() => onMessage('Notification policy saved. No push was sent.')).catch((reason) => onError(reason instanceof Error ? reason.message : 'Policy failed'))}>Save policy</button>
    </div>
  );
}

export function AiAnalyticsPage() {
  const [stats, setStats] = useState<{ conversations: number; recommendations: number; feedback: number } | null>(null);
  const [users, setUsers] = useState<Array<{ email: string; displayName: string | null; deviceCount: number; preferences: string[] }>>([]);
  const [interestSummary, setInterestSummary] = useState<Array<{ category: string; count: number }>>([]);
  const [pushRate, setPushRate] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api<{ conversations: number; recommendations: number; feedback: number }>('/api/analytics/ai'),
      api<{ users: Array<{ email: string; displayName: string | null; deviceCount: number; preferences: string[] }> }>('/api/admin/users'),
      api<{ interests: Array<{ category: string; count: number }>; pushOptInRate: number }>('/api/analytics/preferences'),
    ]).then(([ai, people, preferences]) => {
      setStats(ai);
      setUsers(people.users);
      setInterestSummary(preferences.interests);
      setPushRate(preferences.pushOptInRate);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : 'Analytics failed'));
  }, []);
  return (
    <section>
      <h1>AI analytics</h1>
      {error ? <p>{error}</p> : null}
      <div className="grid">
        <article className="card"><span>Conversations</span><strong>{stats?.conversations ?? '…'}</strong></article>
        <article className="card"><span>Recommendations</span><strong>{stats?.recommendations ?? '…'}</strong></article>
        <article className="card"><span>Feedback</span><strong>{stats?.feedback ?? '…'}</strong></article>
        <article className="card"><span>Push opt-in</span><strong>{pushRate === null ? '…' : `${Math.round(pushRate * 100)}%`}</strong></article>
        <article className="card"><span>Top interests</span><strong>{interestSummary.slice(0, 3).map((item) => `${item.category} ${item.count}`).join(', ') || '—'}</strong></article>
      </div>
      <h2>Accounts</h2>
      <table>
        <thead><tr><th>Nickname</th><th>Email</th><th>Interests</th><th>Devices</th></tr></thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.email}><td>{user.displayName ?? '—'}</td><td>{user.email}</td><td>{user.preferences.join(', ') || '—'}</td><td>{user.deviceCount}</td></tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
