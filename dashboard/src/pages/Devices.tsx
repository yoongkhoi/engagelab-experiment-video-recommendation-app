import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { maskRegistrationId } from '../lib/rules';

interface Device {
  id: string;
  registrationId: string;
  platform: string;
  deviceType?: 'emulator' | 'phone' | 'tablet' | null;
  categories: string[];
  registeredAt: string;
  lastSeenAt: string;
  tagSyncStatus: string;
  tagSyncError: string | null;
  appVersion: string | null;
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Device | null>(null);

  async function load() {
    const data = await api<{ devices: Device[] }>('/api/devices');
    setDevices(data.devices);
  }
  useEffect(() => { load().catch((reason: Error) => setError(reason.message)); }, []);

  async function saveCategories(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = new FormData(event.currentTarget as HTMLFormElement);
    const categories = ['tech', 'funny', 'lifestyle'].filter((category) => form.get(category) === 'on');
    await api(`/api/devices/${selected.id}/preferences`, { method: 'PUT', body: JSON.stringify({ categories }) });
    setSelected(null);
    await load();
  }

  return (
    <section>
      <h1>Devices</h1>
      <p className="muted">A stored Registration ID came from the Android SDK. Tag sync status is the only server-side EngageLab device result.</p>
      {error ? <p className="error">{error}</p> : null}
      {!devices.length && !error ? <div className="panel">No devices have registered yet. Open the Android app after the SDK connects.</div> : null}
      {devices.length ? (
        <div className="panel">
          <table>
            <thead><tr><th>Registration ID</th><th>Platform</th><th>Device</th><th>Preferences</th><th>Registered</th><th>Last activity</th><th>Tag sync</th><th></th></tr></thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td><code>{revealed === device.id ? device.registrationId : maskRegistrationId(device.registrationId)}</code></td>
                  <td>{device.platform}</td>
                  <td>{device.deviceType ?? '—'}</td>
                  <td>{device.categories.join(', ')}</td>
                  <td>{new Date(device.registeredAt).toLocaleString()}</td>
                  <td>{new Date(device.lastSeenAt).toLocaleString()}</td>
                  <td><span className={`badge ${device.tagSyncStatus === 'synced' ? 'good' : device.tagSyncStatus === 'failed' ? 'bad' : 'warn'}`}>{device.tagSyncStatus}</span>
                    {device.tagSyncError ? <div className="muted">{device.tagSyncError}</div> : null}</td>
                  <td className="row">
                    <button className="ghost" type="button" onClick={() => setRevealed(revealed === device.id ? null : device.id)}>Reveal</button>
                    <button className="ghost" type="button" onClick={() => setSelected(device)}>Edit</button>
                    <button className="ghost" type="button" onClick={() => api(`/api/devices/${device.id}/sync-tags`, { method: 'POST' }).then(load)}>Sync tags</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {selected ? (
        <form className="panel" onSubmit={saveCategories}>
          <h2>Preferences for {maskRegistrationId(selected.registrationId)}</h2>
          {['tech', 'funny', 'lifestyle'].map((category) => (
            <label key={category} className="row"><input type="checkbox" name={category} defaultChecked={selected.categories.includes(category)} /> {category}</label>
          ))}
          <button className="primary" type="submit">Save and synchronize</button>
        </form>
      ) : null}
    </section>
  );
}
