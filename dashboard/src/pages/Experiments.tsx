import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';

interface Device { id: string; registrationId: string; }
interface Video { id: string; title: string; active: boolean; }
interface Result {
  experiment: { id: string; name: string; status: string; primaryMetric: string; endsAt: string | null; startedAt: string | null; errorMessage?: string | null };
  variants: { A: { sampleSize: number; successes: number; rate: number | null }; B: { sampleSize: number; successes: number; rate: number | null } };
  statistics: { preliminary: boolean; significant: boolean | null; pValue: number | null; reason: string };
  measurementWindow: { from: string | null; to: string | null };
  metricDefinition: string;
  realAudienceWarning?: string | null;
  simulation?: { runs: Array<{ id: string; syntheticUsers: number; variantA: number; variantB: number; note: string }>; countedAsRealRecipients: boolean };
  testSends?: Array<{ id: string; variant: string; registrationHint: string; simulated: boolean; providerStatus: string | null; deviceDeliveryVerified: false }>;
}
interface Preview {
  realDevices: number;
  sufficientForStart: boolean;
  sufficientForSignificance: boolean;
  warning: string;
  variants: { A: { title: string; message: string; recipients: number }; B: { title: string; message: string; recipients: number } };
  engageLabCalled: boolean;
}

function hint(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export function ExperimentsPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [videos, setVideos] = useState<Video[]>([]);
  const [videoId, setVideoId] = useState('');
  const [live, setLive] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [experimentId, setExperimentId] = useState('');
  const [name, setName] = useState('Title experiment');
  const [titleA, setTitleA] = useState('Watch this clip');
  const [messageA, setMessageA] = useState('A new short video is ready.');
  const [titleB, setTitleB] = useState('Your next video is here');
  const [messageB, setMessageB] = useState('Tap to play the recommendation.');
  const [allocationA, setAllocationA] = useState(50);
  const [durationHours, setDurationHours] = useState(48);
  const [testDevice, setTestDevice] = useState('');
  const [testConfirm, setTestConfirm] = useState(false);

  async function load() {
    const [deviceData, experimentData, videoData, status] = await Promise.all([
      api<{ devices: Device[] }>('/api/devices'),
      api<{ experiments: Result[] }>('/api/analytics/experiments'),
      api<{ videos: Video[] }>('/api/videos?all=1'),
      api<{ mode: 'live' | 'demo' }>('/api/config/status'),
    ]);
    const active = videoData.videos.filter((video) => video.active);
    setDevices(deviceData.devices);
    setResults(experimentData.experiments);
    setVideos(active);
    setVideoId((current) => active.some((video) => video.id === current) ? current : (active[0]?.id ?? ''));
    setTestDevice((current) => deviceData.devices.some((device) => device.registrationId === current) ? current : (deviceData.devices[0]?.registrationId ?? ''));
    setLive(status.mode === 'live');
  }
  useEffect(() => { load().catch((reason: Error) => setError(reason.message)); }, []);

  function validationError(): string {
    if (!name.trim()) return 'Enter an experiment name. Nothing was sent.';
    if (!videoId) return 'Choose an active video. Nothing was sent.';
    if (!titleA.trim() || !messageA.trim() || !titleB.trim() || !messageB.trim()) return 'Both variants need a title and a message. Nothing was sent.';
    if (titleA.trim() === titleB.trim() && messageA.trim() === messageB.trim()) return 'Variant A and variant B need different text. Nothing was sent.';
    if (!Number.isInteger(allocationA) || allocationA < 1 || allocationA > 99) return 'Allocation for variant A must be a whole number from 1 to 99. Nothing was sent.';
    if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720) return 'Duration must be from 1 to 720 hours. Nothing was sent.';
    return '';
  }

  function payload() {
    return {
      name: name.trim(),
      videoId,
      variantA: { title: titleA.trim(), message: messageA.trim() },
      variantB: { title: titleB.trim(), message: messageB.trim() },
      targeting: { mode: 'registration_ids', registrationIds: devices.map((device) => device.registrationId) },
      allocationA,
      durationHours,
      primaryMetric: 'notification_opened',
    };
  }

  async function ensureDraft(): Promise<string> {
    if (experimentId) return experimentId;
    const created = await api<{ experiment: { id: string } }>('/api/experiments', { method: 'POST', body: JSON.stringify(payload()) });
    setExperimentId(created.experiment.id);
    return created.experiment.id;
  }

  async function run(action: string, work: () => Promise<void>) {
    setError('');
    setNotice('');
    const invalid = validationError();
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(action);
    try {
      await work();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The request failed. Nothing further was sent.');
    } finally {
      setBusy('');
    }
  }

  async function start(event: FormEvent) {
    event.preventDefault();
    const invalid = validationError();
    if (invalid) {
      setNotice('');
      setError(invalid);
      return;
    }
    if (devices.length < 2) {
      setNotice('');
      setError(`Start needs at least two real stored devices so variant A and variant B each receive one. This database has ${devices.length}. No push was sent. Use Run labelled simulation, or send one variant below. One real device cannot validate a statistically meaningful A/B test.`);
      return;
    }
    await run('start', async () => {
      const created = await api<{ experiment: { id: string } }>('/api/experiments', { method: 'POST', body: JSON.stringify(payload()) });
      setExperimentId(created.experiment.id);
      const started = await api<{ message: string; simulated: boolean; deviceDeliveryVerified: boolean }>(`/api/experiments/${created.experiment.id}/start`, { method: 'POST', body: '{}' });
      setNotice(`${started.message} Device delivery verified=${started.deviceDeliveryVerified}.`);
      await load();
    });
  }

  return (
    <section>
      <h1>A/B experiments</h1>
      <p className="banner">One real device cannot validate a statistically meaningful A/B test. Results stay preliminary until both variants have at least 30 real devices. Simulated users are never counted as recipients, deliveries, or click-through.</p>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="banner live">{notice}</p> : null}
      <form className="panel" onSubmit={start}>
        <label>Experiment name<input value={name} onChange={(event) => { setName(event.target.value); setExperimentId(''); }} required /></label>
        <label>Video
          <select value={videoId} onChange={(event) => { setVideoId(event.target.value); setExperimentId(''); }}>
            {videos.map((video) => <option key={video.id} value={video.id}>{video.id} · {video.title}</option>)}
          </select>
        </label>
        <div className="split">
          <label>Variant A title<input value={titleA} onChange={(event) => { setTitleA(event.target.value); setExperimentId(''); }} /></label>
          <label>Variant B title<input value={titleB} onChange={(event) => { setTitleB(event.target.value); setExperimentId(''); }} /></label>
          <label>Variant A message<textarea value={messageA} onChange={(event) => { setMessageA(event.target.value); setExperimentId(''); }} /></label>
          <label>Variant B message<textarea value={messageB} onChange={(event) => { setMessageB(event.target.value); setExperimentId(''); }} /></label>
          <label>Variant A allocation %<input type="number" min={1} max={99} value={allocationA} onChange={(event) => { setAllocationA(Number(event.target.value)); setExperimentId(''); }} /></label>
          <label>Duration hours<input type="number" min={1} max={720} value={durationHours} onChange={(event) => { setDurationHours(Number(event.target.value)); setExperimentId(''); }} /></label>
        </div>
        <p className="muted">Real audience: {devices.length} stored device{devices.length === 1 ? '' : 's'}. Metric: notification opens reported by the app.</p>
        {live ? <p className="banner">Live mode is on. Start experiment submits two real EngageLab campaigns when at least two devices are stored. Provider acceptance is not device delivery.</p> : <p className="banner">Demo mode records a real-device split locally and does not call EngageLab.</p>}
        <div className="row">
          <button className="primary" type="submit" disabled={Boolean(busy)}>{busy === 'start' ? 'Starting…' : 'Start experiment'}</button>
          <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => run('preview', async () => {
            const id = await ensureDraft();
            const result = await api<Preview>(`/api/experiments/${id}/preview`, { method: 'POST', body: '{}' });
            setPreview(result);
            setNotice(result.warning);
          })}>{busy === 'preview' ? 'Checking…' : 'Preview split'}</button>
          <button className="ghost" type="button" disabled={Boolean(busy)} onClick={() => run('simulate', async () => {
            const id = await ensureDraft();
            const result = await api<{ simulation: { syntheticUsers: number; variantA: number; variantB: number; note: string }; engageLabCalled: boolean }>(`/api/experiments/${id}/simulate`, { method: 'POST', body: JSON.stringify({ syntheticUsers: 60 }) });
            setNotice(`Simulation only. ${result.simulation.syntheticUsers} synthetic users split ${result.simulation.variantA}/${result.simulation.variantB}. ${result.simulation.note} EngageLab called=${result.engageLabCalled}.`);
            await load();
          })}>{busy === 'simulate' ? 'Simulating…' : 'Run labelled simulation'}</button>
        </div>
      </form>
      {preview ? (
        <div className="panel">
          <h2>Variant preview</h2>
          <p>{preview.warning}</p>
          <p>Real devices in this split: {preview.realDevices}. EngageLab called={String(preview.engageLabCalled)}. Significant sample={String(preview.sufficientForSignificance)}.</p>
          <div className="split">
            <div><strong>A · {preview.variants.A.recipients} real</strong><p>{preview.variants.A.title}</p><p>{preview.variants.A.message}</p></div>
            <div><strong>B · {preview.variants.B.recipients} real</strong><p>{preview.variants.B.title}</p><p>{preview.variants.B.message}</p></div>
          </div>
        </div>
      ) : null}
      <div className="panel">
        <h2>Single-device test send</h2>
        <p className="muted">Sends one variant to one stored device. It is not an A/B sample and it does not prove the notification arrived.</p>
        <label>Stored device
          <select value={testDevice} onChange={(event) => setTestDevice(event.target.value)}>
            {devices.map((device) => <option key={device.id} value={device.registrationId}>{hint(device.registrationId)}</option>)}
          </select>
        </label>
        <label className="row"><input type="checkbox" checked={testConfirm} onChange={(event) => setTestConfirm(event.target.checked)} /> I understand this sends one notification to that stored device.</label>
        <div className="row">
          {(['A', 'B'] as const).map((variant) => (
            <button key={variant} className="ghost" type="button" disabled={Boolean(busy)} onClick={() => {
              if (!testConfirm) {
                setNotice('');
                setError('Check the confirmation box before a single-device test send. Nothing was sent.');
                return;
              }
              if (!testDevice) {
                setError('No stored device is available. Nothing was sent.');
                return;
              }
              void run(`test-${variant}`, async () => {
                const id = await ensureDraft();
                const result = await api<{ message: string; deviceDeliveryVerified: boolean; testSend: { simulated: boolean; providerStatus: string | null; registrationHint: string } }>(`/api/experiments/${id}/test-send`, {
                  method: 'POST',
                  body: JSON.stringify({ variant, registrationId: testDevice, confirm: true }),
                });
                setNotice(`${result.message} Variant ${variant}, device ${result.testSend.registrationHint}, simulated=${result.testSend.simulated}, provider status=${result.testSend.providerStatus}. Device delivery verified=${result.deviceDeliveryVerified}.`);
                await load();
              });
            }}>{busy === `test-${variant}` ? 'Sending…' : `Send variant ${variant} to this device`}</button>
          ))}
        </div>
      </div>
      <h2>Real results</h2>
      <p className="muted">Sample sizes below count stored real assignments only. Simulation rows and single-device test sends stay out of the rate.</p>
      {!results.length ? <div className="panel">No experiments yet.</div> : results.map((result) => (
        <article className="panel" key={result.experiment.id}>
          <h2>{result.experiment.name}</h2>
          <p><span className="badge">{result.experiment.status}</span> {result.metricDefinition}</p>
          {result.experiment.errorMessage ? <p className="error">{result.experiment.errorMessage}</p> : null}
          <p>Window: {result.measurementWindow.from ?? 'not started'} → {result.measurementWindow.to ?? 'open'}</p>
          <div className="split">
            <div><strong>A real</strong><p>Sample {result.variants.A.sampleSize}, successes {result.variants.A.successes}, rate {result.variants.A.rate ?? 'n/a'}</p></div>
            <div><strong>B real</strong><p>Sample {result.variants.B.sampleSize}, successes {result.variants.B.successes}, rate {result.variants.B.rate ?? 'n/a'}</p></div>
          </div>
          <p className={result.statistics.preliminary ? 'banner' : 'banner live'}>{result.statistics.preliminary ? 'Preliminary' : result.statistics.significant ? 'Significant' : 'Not significant'}. {result.statistics.reason}</p>
          {result.realAudienceWarning ? <p className="muted">{result.realAudienceWarning}</p> : null}
          {result.simulation?.runs.length ? result.simulation.runs.map((run) => (
            <p className="banner" key={run.id}>Simulation, not real. Synthetic users {run.syntheticUsers}, split {run.variantA}/{run.variantB}. Counted as real recipients={String(result.simulation?.countedAsRealRecipients)}. {run.note}</p>
          )) : null}
          {result.testSends?.map((send) => (
            <p key={send.id}>Single-device test {send.variant} for {send.registrationHint}. Simulated={String(send.simulated)}. Provider status={send.providerStatus}. Device delivery verified={String(send.deviceDeliveryVerified)}.</p>
          ))}
        </article>
      ))}
    </section>
  );
}
