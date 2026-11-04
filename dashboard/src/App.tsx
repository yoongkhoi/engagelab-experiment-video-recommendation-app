import { useEffect, useState, type FormEvent } from 'react';
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { api, adminKey, clearAdminKey, setAdminKey } from './api';
import { ComposerPage } from './pages/Composer';
import { DevicesPage } from './pages/Devices';
import { ExperimentsPage } from './pages/Experiments';
import { HistoryPage } from './pages/History';
import { OverviewPage } from './pages/Overview';
import { VideosPage } from './pages/Videos';
import { AiAnalyticsPage, LibraryPage } from './pages/Library';

interface Status {
  mode: 'live' | 'demo';
  note: string;
  deliveryMetricsAvailable: boolean;
}

export function App() {
  const [authed, setAuthed] = useState(Boolean(adminKey()));
  if (!authed) return <Login onSuccess={() => setAuthed(true)} />;
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">Engage<span>Video</span>Push</div>
        <NavLink to="/" end>Overview</NavLink>
        <NavLink to="/videos">Videos</NavLink>
        <NavLink to="/library">Library</NavLink>
        <NavLink to="/ai">AI analytics</NavLink>
        <NavLink to="/devices">Devices</NavLink>
        <NavLink to="/compose">Compose</NavLink>
        <NavLink to="/experiments">A/B tests</NavLink>
        <NavLink to="/history">History</NavLink>
        <button type="button" onClick={() => { clearAdminKey(); setAuthed(false); }}>Sign out</button>
      </nav>
      <main className="main">
        <StatusBanner />
        <Routes>
          <Route path="/" element={<OverviewPage />} />
          <Route path="/videos" element={<VideosPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/ai" element={<AiAnalyticsPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/compose" element={<ComposerPage />} />
          <Route path="/experiments" element={<ExperimentsPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

function StatusBanner() {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    api<Status>('/api/config/status').then(setStatus).catch(() => setStatus(null));
  }, []);
  if (!status) return null;
  return (
    <div className={status.mode === 'live' ? 'banner live' : 'banner'}>
      <strong>{status.mode === 'live' ? 'Live EngageLab mode' : 'Demo mode'}</strong>
      <div>{status.note} Provider delivery metrics are {status.deliveryMetricsAvailable ? 'available' : 'unavailable'}.</div>
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const navigate = useNavigate();
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setAdminKey(key);
    try {
      await api('/api/analytics/overview');
      onSuccess();
      navigate('/');
    } catch (reason) {
      clearAdminKey();
      setError(reason instanceof Error ? reason.message : 'Sign-in failed');
    }
  }
  return (
    <form className="panel login" onSubmit={submit}>
      <h1>Operator sign-in</h1>
      <p className="muted">Use the server-side ADMIN_API_KEY from backend/.env. The EngageLab Master Secret is not accepted here.</p>
      <label>Admin API key
        <input type="password" value={key} onChange={(event) => setKey(event.target.value)} autoFocus />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <button className="primary" type="submit">Continue</button>
    </form>
  );
}
