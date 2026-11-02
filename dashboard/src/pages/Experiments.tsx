import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';

interface Device { id: string; registrationId: string; }
interface Result {
  experiment: { id: string; name: string; status: string; primaryMetric: string; endsAt: string | null; startedAt: string | null };
  variants: { A: { sampleSize: number; successes: number; rate: number | null }; B: { sampleSize: number; successes: number; rate: number | null } };
  statistics: { preliminary: boolean; significant: boolean | null; pValue: number | null; reason: string };
  measurementWindow: { from: string | null; to: string | null };
  metricDefinition: string;
}

export function ExperimentsPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('Title experiment');
  const [titleA, setTitleA] = useState('Watch this technology clip');
  const [messageA, setMessageA] = useState('A new short video is ready.');
  const [titleB, setTitleB] = useState('Your next video is here');
  const [messageB, setMessageB] = useState('Tap to play the recommendation.');

  async function load() {
    const [deviceData, experimentData] = await Promise.all([
      api<{ devices: Device[] }>('/api/devices'),
      api<{ experiments: Result[] }>('/api/analytics/experiments'),
    ]);
    setDevices(deviceData.devices);
    setResults(experimentData.experiments);
  }
  useEffect(() => { load().catch((reason: Error) => setError(reason.message)); }, []);

  async function start(event: FormEvent) {
    event.preventDefault();
    setError('');
    try {
      const created = await api<{ experiment: { id: string } }>('/api/experiments', {
        method: 'POST',
        body: JSON.stringify({
          name,
          videoId: '1001',
          variantA: { title: titleA, message: messageA },
          variantB: { title: titleB, message: messageB },
          targeting: { mode: 'registration_ids', registrationIds: devices.map((device) => device.registrationId) },
          allocationA: 50,
          durationHours: 48,
          primaryMetric: 'notification_opened',
        }),
      });
      await api(`/api/experiments/${created.experiment.id}/start`, { method: 'POST', body: '{}' });
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Experiment failed');
    }
  }

  return (
    <section>
      <h1>A/B experiments</h1>
      <p className="muted">Each device is assigned to one variant with a SHA-256 bucket. Results stay preliminary until both variants have at least 30 devices.</p>
      {error ? <p className="error">{error}</p> : null}
      <form className="panel" onSubmit={start}>
        <label>Experiment name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <div className="split">
          <label>Variant A title<input value={titleA} onChange={(event) => setTitleA(event.target.value)} /></label>
          <label>Variant B title<input value={titleB} onChange={(event) => setTitleB(event.target.value)} /></label>
          <label>Variant A message<textarea value={messageA} onChange={(event) => setMessageA(event.target.value)} /></label>
          <label>Variant B message<textarea value={messageB} onChange={(event) => setMessageB(event.target.value)} /></label>
        </div>
        <p className="muted">Audience: {devices.length} stored devices. Video: 1001. Allocation: 50/50. Duration: 48 hours. Metric: notification opens.</p>
        <button className="primary" type="submit" disabled={devices.length < 2}>Start experiment</button>
      </form>
      <h2>Results</h2>
      {!results.length ? <div className="panel">No experiments yet.</div> : results.map((result) => (
        <article className="panel" key={result.experiment.id}>
          <h2>{result.experiment.name}</h2>
          <p><span className="badge">{result.experiment.status}</span> {result.metricDefinition}</p>
          <p>Window: {result.measurementWindow.from ?? 'not started'} → {result.measurementWindow.to ?? 'open'}</p>
          <div className="split">
            <div><strong>A</strong><p>Sample {result.variants.A.sampleSize}, successes {result.variants.A.successes}, rate {result.variants.A.rate ?? 'n/a'}</p></div>
            <div><strong>B</strong><p>Sample {result.variants.B.sampleSize}, successes {result.variants.B.successes}, rate {result.variants.B.rate ?? 'n/a'}</p></div>
          </div>
          <p className={result.statistics.preliminary ? 'banner' : 'banner live'}>{result.statistics.preliminary ? 'Preliminary' : result.statistics.significant ? 'Significant' : 'Not significant'}. {result.statistics.reason}</p>
        </article>
      ))}
    </section>
  );
}
