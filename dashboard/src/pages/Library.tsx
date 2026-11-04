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

const categories = ['travel', 'nature', 'food', 'technology', 'sports', 'animals', 'entertainment'];

export function LibraryPage() {
  const [query, setQuery] = useState('nature');
  const [results, setResults] = useState<RemoteVideo[]>([]);
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState('');
  const [campaignId, setCampaignId] = useState('');

  async function load() {
    const data = await api<{ entries: LibraryEntry[] }>('/api/library');
    setEntries(data.entries);
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

  async function publish(videoId: string) {
    const result = await api<{ libraryCampaignId: string; sent: boolean }>(`/api/library/${videoId}/publish`, { method: 'POST', body: '{}' });
    setMessage(result.sent ? 'Unexpected send.' : `Published ${videoId}. Campaign ${result.libraryCampaignId} is a draft.`);
    await load();
  }

  async function previewVideo(videoId: string) {
    const result = await api<{ willSend: number; matchedUsers: number; registeredDevices: number; timezone: string }>(`/api/library/${videoId}/preview`, { method: 'POST', body: '{}' });
    const gate = targetedPreview(result.willSend, false);
    setPreview(`${result.matchedUsers} users, ${result.registeredDevices} devices, ${result.willSend} would be targeted (${gate}). Timezone ${result.timezone}. Nothing was sent.`);
  }

  async function activate(campaignId: string) {
    const result = await api<{ simulated: boolean; sent: number; deviceDeliveryVerified: boolean }>(`/api/library/campaigns/${campaignId}/activate`, { method: 'POST', body: JSON.stringify({ confirm: true }) });
    setMessage(`Activation recorded. Simulated=${result.simulated}. Targeted devices=${result.sent}. Device delivery verified=${result.deviceDeliveryVerified}.`);
  }

  return (
    <section>
      <h1>Video library</h1>
      <p className="muted">Search Pixabay, save a result, then publish it. Publishing does not send a push. Activation is a separate confirmation and never falls back to broadcast.</p>
      <div className="row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Pixabay search" />
        <button className="primary" type="button" onClick={() => search().catch((reason) => setError(reason.message))}>Search Pixabay</button>
      </div>
      {error ? <p>{error}</p> : null}
      {message ? <p>{message}</p> : null}
      {preview ? <p>{preview}</p> : null}
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
                {entry.libraryState !== 'published' ? <button className="ghost" type="button" onClick={() => publish(entry.videoId)}>Publish</button> : null}
                {entry.libraryState === 'published' ? <button className="ghost" type="button" onClick={() => previewVideo(entry.videoId)}>Preview</button> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Use Preview before activation. Activation targets matched Registration IDs only. A provider acceptance is not device delivery.</p>
      <div className="row">
        <input value={campaignId} onChange={(event) => setCampaignId(event.target.value)} placeholder="Library campaign id" aria-label="Library campaign id" />
        <button className="primary" type="button" disabled={!campaignId} onClick={() => activate(campaignId).catch((reason) => setError(reason.message))}>Activate</button>
      </div>
    </section>
  );
}

export function AiAnalyticsPage() {
  const [stats, setStats] = useState<{ conversations: number; recommendations: number; feedback: number } | null>(null);
  const [users, setUsers] = useState<Array<{ email: string; displayName: string | null; deviceCount: number; preferences: string[] }>>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api<{ conversations: number; recommendations: number; feedback: number }>('/api/analytics/ai'),
      api<{ users: Array<{ email: string; displayName: string | null; deviceCount: number; preferences: string[] }> }>('/api/admin/users'),
    ]).then(([ai, people]) => {
      setStats(ai);
      setUsers(people.users);
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
