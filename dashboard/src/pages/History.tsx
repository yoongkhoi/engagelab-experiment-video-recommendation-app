import { useEffect, useState } from 'react';
import { api } from '../api';

interface Campaign {
  id: string;
  name: string;
  status: string;
  simulated: boolean;
  providerMode: string;
  providerMsgIds: string[];
  providerScheduleId: string | null;
  scheduleTime: string | null;
  scheduleTimeZone: string | null;
  errorMessage: string | null;
  errorKind: string | null;
  targetingMode: string;
  createdAt: string;
}
interface CampaignAnalytics {
  campaignId: string;
  notificationOpened: number;
  videoPlayStarted: number;
  videoPlayCompleted: number;
}

export function HistoryPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [metrics, setMetrics] = useState<Record<string, CampaignAnalytics>>({});
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api<{ campaigns: Campaign[] }>('/api/campaigns'),
      api<{ campaigns: CampaignAnalytics[] }>('/api/analytics/campaigns'),
    ]).then(([campaignData, metricData]) => {
      setCampaigns(campaignData.campaigns);
      setMetrics(Object.fromEntries(metricData.campaigns.map((item) => [item.campaignId, item])));
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const scheduled = campaigns.filter((campaign) => campaign.status === 'scheduled' || campaign.scheduleTime);
  return (
    <section>
      <h1>Scheduling and history</h1>
      {error ? <p className="error">{error}</p> : null}
      <h2>Scheduled</h2>
      {!scheduled.length ? <div className="panel">No scheduled campaigns.</div> : (
        <div className="panel">
          <table>
            <thead><tr><th>Name</th><th>When</th><th>Provider task</th><th>Status</th></tr></thead>
            <tbody>
              {scheduled.map((campaign) => (
                <tr key={campaign.id}>
                  <td>{campaign.name}</td>
                  <td>{campaign.scheduleTime} {campaign.scheduleTimeZone}</td>
                  <td>{campaign.providerScheduleId ?? 'none'}</td>
                  <td>{campaign.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>All submissions</h2>
      {!campaigns.length && !error ? <div className="panel">No campaigns have been created.</div> : null}
      {campaigns.length ? (
        <div className="panel">
          <table>
            <thead><tr><th>Name</th><th>Target</th><th>Status</th><th>Provider IDs</th><th>Device events</th><th>Error</th></tr></thead>
            <tbody>
              {campaigns.map((campaign) => {
                const metric = metrics[campaign.id];
                return (
                  <tr key={campaign.id}>
                    <td>{campaign.name}<div className="muted">{new Date(campaign.createdAt).toLocaleString()}</div></td>
                    <td>{campaign.targetingMode}</td>
                    <td><span className={`badge ${campaign.status === 'failed' ? 'bad' : campaign.simulated ? 'warn' : 'good'}`}>{campaign.status}</span>
                      <div className="muted">{campaign.simulated ? 'Simulated' : campaign.providerMode}</div></td>
                    <td>{campaign.providerMsgIds.join(', ') || campaign.providerScheduleId || '—'}</td>
                    <td>{metric ? `${metric.notificationOpened} opens, ${metric.videoPlayStarted} plays, ${metric.videoPlayCompleted} completions` : '—'}</td>
                    <td>{campaign.errorMessage ? `${campaign.errorKind}: ${campaign.errorMessage}` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
