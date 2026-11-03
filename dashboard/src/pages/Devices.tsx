import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { maskRegistrationId } from '../lib/rules';

interface Device {
  id: string;
  registrationId: string;
  registrationIdMasked?: string;
  platform: string;
  deviceType?: 'emulator' | 'phone' | 'tablet' | null;
  userId?: string | null;
  installationId?: string | null;
  categories: string[];
  registeredAt: string;
  lastSeenAt: string;
  tagSyncStatus: string;
  tagSyncError: string | null;
  appVersion: string | null;
  email?: string | null;
  accountCreatedAt?: string | null;
  accountStatus?: string | null;
  preferenceCategories?: string[];
  preferencesUpdatedAt?: string | null;
  notificationEnabled?: boolean;
  appName?: string;
  sdkVersion?: string;
  environment?: string;
}

export function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState<string | null>(null);
  const [selected, setSelected] = useState<Device | null>(null);
  const [notice, setNotice] = useState('');

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
      <p className="muted">Accounts, installations, and EngageLab registration. A Registration ID does not by itself prove a notification was delivered.</p>
      {error ? <p className="error">{error}</p> : null}
      {!devices.length && !error ? <div className="panel">No devices have registered yet. Open the Android app after the SDK connects.</div> : null}
      {devices.length ? (
        <div className="panel">
          <table>
            <thead><tr><th>Account</th><th>Registration ID</th><th>Platform</th><th>Device</th><th>Push tags</th><th>Registered</th><th>Last activity</th><th>Tag sync</th><th></th></tr></thead>
            <tbody>
              {devices.map((device) => (
                <tr key={device.id}>
                  <td>{device.email ?? 'Not signed in'}<div className="muted">{device.accountStatus ?? 'no account'}</div></td>
                  <td><code>{revealed === device.id ? device.registrationId : (device.registrationIdMasked ?? maskRegistrationId(device.registrationId))}</code></td>
                  <td>{device.platform}</td>
                  <td>{device.deviceType ?? '—'}</td>
                  <td>{device.categories.join(', ')}</td>
                  <td>{new Date(device.registeredAt).toLocaleString()}</td>
                  <td>{new Date(device.lastSeenAt).toLocaleString()}</td>
                  <td><span className={`badge ${device.tagSyncStatus === 'synced' ? 'good' : device.tagSyncStatus === 'failed' ? 'bad' : 'warn'}`}>{device.tagSyncStatus}</span>
                    {device.tagSyncError ? <div className="muted">{device.tagSyncError}</div> : null}</td>
                  <td className="row">
                    <button className="ghost" type="button" onClick={() => setRevealed(revealed === device.id ? null : device.id)}>Reveal</button>
                    <button className="ghost" type="button" onClick={() => { setSelected(device); setNotice(''); }}>Details</button>
                    <button className="ghost" type="button" onClick={() => api(`/api/devices/${device.id}/sync-tags`, { method: 'POST' }).then(load)}>Sync tags</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {selected ? (
        <div className="panel" style={{ marginTop: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Installation</h2>
            <div className="row">
              <button className="ghost" type="button" onClick={() => load().then(() => setNotice('Status refreshed.')).catch((reason: Error) => setError(reason.message))}>Refresh</button>
              <button className="ghost" type="button" onClick={() => { void navigator.clipboard.writeText(selected.installationId || selected.id); setNotice('Copied the installation id.'); }}>Copy installation id</button>
              <button className="ghost" type="button" onClick={() => {
                if (!selected.userId) { setNotice('This installation is not linked to an account.'); return; }
                api(`/api/devices/${selected.id}/disassociate`, { method: 'POST' })
                  .then(() => load())
                  .then(() => { setSelected({ ...selected, userId: null, email: null, accountStatus: null }); setNotice('The account was unlinked. The device row was kept.'); })
                  .catch((reason: Error) => setError(reason.message));
              }}>Unlink account</button>
            </div>
          </div>
          {notice ? <p className="muted">{notice}</p> : null}
          <div className="grid">
            <div className="card"><span className="muted">Profile</span><strong style={{ fontSize: 16 }}>{selected.email ?? 'No account'}</strong><div className="muted">User {selected.userId ?? '—'} · {selected.accountStatus ?? 'no account'}</div><div className="muted">Created {selected.accountCreatedAt ? new Date(selected.accountCreatedAt).toLocaleString() : '—'}</div></div>
            <div className="card"><span className="muted">Device</span><strong style={{ fontSize: 16 }}>{selected.deviceType ?? 'unknown'} · {selected.platform}</strong><div className="muted">Registration {selected.tagSyncStatus} · last activity {new Date(selected.lastSeenAt).toLocaleString()}</div><div className="muted">Notifications {selected.notificationEnabled ? 'reported enabled' : 'reported off'}</div></div>
            <div className="card"><span className="muted">Video preferences</span><strong style={{ fontSize: 16 }}>{selected.preferenceCategories?.length ? selected.preferenceCategories.join(', ') : 'None saved'}</strong><div className="muted">{selected.preferencesUpdatedAt ? new Date(selected.preferencesUpdatedAt).toLocaleString() : 'No saved update'}</div></div>
            <div className="card"><span className="muted">Software</span><strong style={{ fontSize: 16 }}>{selected.appName ?? 'EngageVideoPush'}</strong><div className="muted">App {selected.appVersion ?? 'not reported'} · declared SDK {selected.sdkVersion ?? '5.4.0'} · {selected.environment ?? 'unknown'}</div></div>
          </div>
        </div>
      ) : null}
      {selected ? (
        <form className="panel" onSubmit={saveCategories}>
          <h2>Push tags for {maskRegistrationId(selected.registrationId)}</h2>
          {['tech', 'funny', 'lifestyle'].map((category) => (
            <label key={category} className="row"><input type="checkbox" name={category} defaultChecked={selected.categories.includes(category)} /> {category}</label>
          ))}
          <button className="primary" type="submit">Save and synchronize</button>
        </form>
      ) : null}
    </section>
  );
}
