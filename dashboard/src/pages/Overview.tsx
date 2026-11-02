import { useEffect, useState } from 'react';
import { api } from '../api';

interface Overview {
  devices: { total: number; byCategory: Record<string, number> };
  campaigns: { total: number; byStatus: Record<string, number>; recent: Array<{ id: string; name: string; status: string; simulated: boolean }> };
  videos: { total: number; active: number };
  events: { notificationOpened: number; videoPlayStarted: number; videoPlayCompleted: number; pushSubmittedToProvider: number };
  provider: { mode: string; configured: boolean; deliveryMetricsAvailable: boolean };
  sources: { devices: string; events: string; providerDelivery: string };
}

export function OverviewPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<Overview>('/api/analytics/overview').then(setData).catch((reason: Error) => setError(reason.message));
  }, []);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p>Loading overview…</p>;
  const max = Math.max(1, ...Object.values(data.devices.byCategory));
  return (
    <section>
      <h1>Overview</h1>
      <p className="muted">{data.sources.devices}</p>
      <div className="grid">
        <article className="card"><span>Registered devices</span><strong>{data.devices.total}</strong><span className="muted">SQLite</span></article>
        <article className="card"><span>Campaigns</span><strong>{data.campaigns.total}</strong><span className="muted">Local campaign records</span></article>
        <article className="card"><span>Active videos</span><strong>{data.videos.active}</strong><span className="muted">{data.videos.total} in the catalogue</span></article>
        <article className="card"><span>Notification opens</span><strong>{data.events.notificationOpened}</strong><span className="muted">Device-reported events</span></article>
        <article className="card"><span>Play starts</span><strong>{data.events.videoPlayStarted}</strong><span className="muted">{data.events.videoPlayCompleted} completions</span></article>
        <article className="card"><span>Provider deliveries</span><strong>{data.provider.deliveryMetricsAvailable ? '—' : 'n/a'}</strong><span className="muted">{data.sources.providerDelivery}</span></article>
      </div>
      <h2>Devices by category</h2>
      <div className="panel bars">
        {Object.entries(data.devices.byCategory).map(([category, count]) => (
          <div className="bar" key={category}><span>{category}</span><i style={{ width: `${(count / max) * 100}%` }} /><b>{count}</b></div>
        ))}
      </div>
      <h2>Recent campaigns</h2>
      <div className="panel">
        {data.campaigns.recent.length === 0 ? <p>No campaigns yet.</p> : (
          <table>
            <thead><tr><th>Name</th><th>Status</th><th>Source</th></tr></thead>
            <tbody>
              {data.campaigns.recent.map((campaign) => (
                <tr key={campaign.id}>
                  <td>{campaign.name}</td>
                  <td><span className={`badge ${campaign.status === 'failed' ? 'bad' : campaign.simulated ? 'warn' : 'good'}`}>{campaign.status}</span></td>
                  <td>{campaign.simulated ? 'Simulated. Not sent to EngageLab.' : 'Local record. Provider acceptance is the status, not delivery.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="muted">Provider pushes accepted by API: {data.events.pushSubmittedToProvider}. Mode: {data.provider.mode}. Configured: {String(data.provider.configured)}.</p>
    </section>
  );
}
