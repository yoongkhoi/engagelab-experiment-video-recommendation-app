import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';
import { broadcastReady, tagReady } from '../lib/rules';

const INTERESTS = [
  { id: 'nature', label: 'Nature' },
  { id: 'travel', label: 'Travel' },
  { id: 'food', label: 'Food' },
  { id: 'technology', label: 'Technology' },
  { id: 'sports', label: 'Sports' },
  { id: 'motorsport', label: 'Motorsport & Cars' },
  { id: 'animals', label: 'Animals' },
  { id: 'entertainment', label: 'Movies & Entertainment' },
  { id: 'music', label: 'Music' },
  { id: 'fashion', label: 'Fashion & Beauty' },
  { id: 'design', label: 'Design & Art' },
  { id: 'gaming', label: 'Gaming' },
  { id: 'science', label: 'Science & Education' },
  { id: 'lifestyle', label: 'Lifestyle' },
  { id: 'fitness', label: 'Fitness' },
  { id: 'photography', label: 'Photography' },
  { id: 'architecture', label: 'Architecture' },
];

interface Video { id: string; title: string; category: string; source: string; sourceType: string; thumbnailUrl?: string | null; active: boolean; }
interface Device { id: string; registrationId: string; categories: string[]; }
interface Campaign {
  id: string;
  status: string;
  simulated: boolean;
  providerMsgIds: string[];
  providerScheduleId: string | null;
  errorMessage: string | null;
  providerMode: string;
}

export function ComposerPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [name, setName] = useState('Evening recommendation');
  const [videoId, setVideoId] = useState('');
  const [pixabayId, setPixabayId] = useState('');
  const [title, setTitle] = useState('A short video for you');
  const [message, setMessage] = useState('Tap to watch the recommended clip.');
  const [mode, setMode] = useState('registration_id');
  const [registrationId, setRegistrationId] = useState('');
  const [interests, setInterests] = useState<string[]>([]);
  const [tags, setTags] = useState<string[]>(['tech']);
  const [delivery, setDelivery] = useState('immediate');
  const [scheduleTime, setScheduleTime] = useState('2030-01-15 09:30:00');
  const [timeZone, setTimeZone] = useState('Asia/Singapore');
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const [tagScope, setTagScope] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ campaign: Campaign; simulated: boolean; message?: string } | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ videos: Video[] }>('/api/videos?all=1'),
      api<{ devices: Device[] }>('/api/devices'),
    ]).then(([videoData, deviceData]) => {
      const active = videoData.videos.filter((video) => video.active);
      setVideos(active);
      setVideoId((current) => active.some((item) => item.id === current) ? current : (active[0]?.id ?? ''));
      setDevices(deviceData.devices);
      if (deviceData.devices[0]) setRegistrationId(deviceData.devices[0].registrationId);
    }).catch((reason: Error) => setError(reason.message));
  }, []);

  const chosenVideoId = pixabayId.trim() || videoId;
  const video = videos.find((item) => item.id === chosenVideoId);
  const ready = broadcastReady(mode, confirm, typed) && tagReady(mode, tagScope);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setResult(null);
    if (!ready) {
      setError(mode === 'broadcast' ? 'Broadcast requires the confirmation checkbox and the word SEND.' : 'Confirm the EngageLab tag scope before sending.');
      return;
    }
    const selected = mode === 'category' ? interests : tags;
    if ((mode === 'category' || mode === 'tag') && !selected.length) {
      setError(mode === 'category' ? 'Select at least one interest. Nothing was sent.' : 'Select at least one device tag. Nothing was sent.');
      return;
    }
    const targeting = {
      mode,
      registrationId: mode === 'registration_id' ? registrationId : undefined,
      registrationIds: mode === 'registration_ids' ? devices.map((device) => device.registrationId) : undefined,
      categories: mode === 'category' || mode === 'tag' ? selected : undefined,
      confirmBroadcast: mode === 'broadcast' ? true : undefined,
      acknowledgeTagScope: mode === 'tag' ? true : undefined,
    };
    try {
      const preview = await api<{ willSend: boolean; registrationIds: string[]; broadcast: boolean; note: string; missing: string[] }>('/api/push/preview', {
        method: 'POST',
        body: JSON.stringify({ videoId: chosenVideoId, targeting }),
      });
      if (!preview.willSend) {
        setError(`${preview.note} Missing target: ${preview.missing.join(', ') || 'none resolved'}. Nothing was sent.`);
        return;
      }
      const response = await api<{ campaign: Campaign; simulated: boolean }>('/api/campaigns', {
        method: 'POST',
        body: JSON.stringify({
          name, videoId: chosenVideoId, title, message, targeting, delivery,
          scheduleTime: delivery === 'scheduled' ? scheduleTime : undefined,
          timeZone: delivery === 'scheduled' ? timeZone : undefined,
          zoneType: delivery === 'scheduled' ? 1 : undefined,
        }),
      });
      setResult(response);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'The campaign could not be submitted.');
    }
  }

  return (
    <section>
      <h1>Push composer</h1>
      {error ? <p className="error">{error}</p> : null}
      <form className="preview" onSubmit={submit}>
        <div className="preview-side">
          <div className="phone">
            <small>Android notification preview</small>
            <h2>{title || 'Title'}</h2>
            <p>{message || 'Message'}</p>
            <p className="muted">{video ? `${video.title} · ${video.category}` : (chosenVideoId ? `Video ${chosenVideoId}` : 'No video selected')}</p>
          </div>
          {video?.source?.startsWith('https://') ? (
            <video key={video.id} src={video.source} poster={video.thumbnailUrl ?? undefined} controls />
          ) : (
            <p className="muted">This video has no playable file.</p>
          )}
        </div>
        <div className="panel">
          <label>Campaign name<input value={name} onChange={(event) => setName(event.target.value)} required /></label>
          <label>Video
            <select value={videoId} onChange={(event) => setVideoId(event.target.value)}>
              {videos.map((item) => <option key={item.id} value={item.id}>{item.id} · {item.title}</option>)}
            </select>
          </label>
          <label>Pixabay video id
            <input value={pixabayId} onChange={(event) => setPixabayId(event.target.value)} placeholder="Optional. Overrides the list above." />
          </label>
          <label>Notification title<input value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
          <label>Notification message<textarea value={message} onChange={(event) => setMessage(event.target.value)} required /></label>
          <label>Targeting
            <select value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="registration_id">One Registration ID</option>
              <option value="registration_ids">Every stored device</option>
              <option value="category">Interests, resolved to stored Registration IDs</option>
              <option value="tag">EngageLab tag</option>
              <option value="broadcast">Broadcast to the Android app</option>
            </select>
          </label>
          {mode === 'registration_id' ? (
            <label>Device
              <select value={registrationId} onChange={(event) => setRegistrationId(event.target.value)}>
                {devices.map((device) => <option key={device.id} value={device.registrationId}>{device.registrationId}</option>)}
              </select>
            </label>
          ) : null}
          {mode === 'category' ? (
            <div>
              <p className="muted">These are the interests saved in the app. The push goes only to stored Registration IDs whose signed-in account saved one of the selected interests.</p>
              <div className="row">
                {INTERESTS.map((category) => (
                  <label key={category.id} className="row">
                    <input type="checkbox" checked={interests.includes(category.id)} onChange={(event) => {
                      setInterests(event.target.checked ? [...interests, category.id] : interests.filter((item) => item !== category.id));
                    }} /> {category.label}
                  </label>
                ))}
              </div>
            </div>
          ) : null}
          {mode === 'tag' ? (
            <div className="row">
              {['tech', 'funny', 'lifestyle'].map((category) => (
                <label key={category} className="row">
                  <input type="checkbox" checked={tags.includes(category)} onChange={(event) => {
                    setTags(event.target.checked ? [...tags, category] : tags.filter((item) => item !== category));
                  }} /> {category}
                </label>
              ))}
            </div>
          ) : null}
          {mode === 'broadcast' ? (
            <div className="banner">
              <strong>Broadcast confirmation</strong>
              <p>This sends to every Android device of this EngageLab application, not only devices stored in SQLite.</p>
              <label className="row"><input type="checkbox" checked={confirm} onChange={(event) => setConfirm(event.target.checked)} /> I understand the targeting mode is broadcast.</label>
              <label>Type SEND<input value={typed} onChange={(event) => setTyped(event.target.value)} /></label>
            </div>
          ) : null}
          {mode === 'tag' ? (
            <label className="row"><input type="checkbox" checked={tagScope} onChange={(event) => setTagScope(event.target.checked)} /> I understand an EngageLab tag can include devices outside this database.</label>
          ) : null}
          <label>Delivery
            <select value={delivery} onChange={(event) => setDelivery(event.target.value)}>
              <option value="immediate">Send now</option>
              <option value="scheduled">Schedule once</option>
              <option value="draft">Save draft</option>
            </select>
          </label>
          {delivery === 'scheduled' ? (
            <div className="split">
              <label>Main-site time yyyy-MM-dd HH:mm:ss<input value={scheduleTime} onChange={(event) => setScheduleTime(event.target.value)} /></label>
              <label>IANA timezone for that wall clock<input value={timeZone} onChange={(event) => setTimeZone(event.target.value)} /></label>
            </div>
          ) : null}
          <button className="primary" type="submit" disabled={!ready}>Submit</button>
        </div>
      </form>
      {result ? (
        <div className={result.campaign.status === 'draft' || result.simulated ? 'banner' : 'banner live'}>
          <strong>{result.campaign.status === 'draft' ? 'Draft saved. EngageLab was not called.' : result.simulated ? 'Simulated result' : `Provider status: ${result.campaign.status}`}</strong>
          <p>{result.campaign.status === 'draft' ? 'Saving a draft does not send a notification.' : result.simulated ? 'No EngageLab request was made.' : 'API acceptance is not device delivery.'}</p>
          <p>Message IDs: {result.campaign.providerMsgIds.join(', ') || 'none returned'}</p>
          <p>Schedule ID: {result.campaign.providerScheduleId ?? 'none'}</p>
          {result.campaign.errorMessage ? <p>{result.campaign.errorMessage}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
