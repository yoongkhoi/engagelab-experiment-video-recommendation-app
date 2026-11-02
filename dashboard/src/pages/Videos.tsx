import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, api } from '../api';

interface Video {
  id: string;
  title: string;
  description: string;
  category: 'tech' | 'funny' | 'lifestyle';
  sourceType: 'remote' | 'asset';
  source: string;
  assetFilename: string | null;
  thumbnailUrl: string | null;
  active: boolean;
}

interface VideoForm {
  id: string;
  title: string;
  description: string;
  category: Video['category'];
  sourceType: Video['sourceType'];
  source: string;
  assetFilename: string;
  thumbnailUrl: string;
  active: boolean;
}

const empty: VideoForm = { id: '', title: '', description: '', category: 'tech', sourceType: 'remote', source: '', assetFilename: '', thumbnailUrl: '', active: true };

export function VideosPage() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [form, setForm] = useState<VideoForm>(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api<{ videos: Video[] }>('/api/videos?all=1');
    setVideos(data.videos);
  }
  useEffect(() => { load().catch((reason: Error) => setError(reason.message)); }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    const body = {
      ...form,
      id: form.id || undefined,
      assetFilename: form.assetFilename || null,
      thumbnailUrl: form.thumbnailUrl || null,
    };
    try {
      if (editing) await api(`/api/videos/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/videos', { method: 'POST', body: JSON.stringify(body) });
      setForm(empty);
      setEditing(null);
      setMessage('Video saved.');
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Save failed');
    }
  }

  return (
    <section>
      <h1>Videos</h1>
      {error ? <p className="error">{error}</p> : null}
      {message ? <p className="banner live">{message}</p> : null}
      <div className="panel">
        {videos.length === 0 ? <p>No videos.</p> : (
          <table>
            <thead><tr><th>ID</th><th>Title</th><th>Category</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {videos.map((video) => (
                <tr key={video.id}>
                  <td>{video.id}</td>
                  <td>{video.title}<div className="muted">{video.description}</div></td>
                  <td>{video.category}</td>
                  <td><span className={`badge ${video.active ? 'good' : 'warn'}`}>{video.active ? 'active' : 'inactive'}</span></td>
                  <td className="row">
                    <button className="ghost" type="button" onClick={() => { setEditing(video.id); setForm({ ...video, assetFilename: video.assetFilename ?? '', thumbnailUrl: video.thumbnailUrl ?? '' }); }}>Edit</button>
                    <button className="ghost" type="button" onClick={() => api(`/api/videos/${video.id}`, { method: 'DELETE' }).then(load)}>Deactivate</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <h2>{editing ? `Edit ${editing}` : 'Create a video'}</h2>
      <form className="panel" onSubmit={save}>
        <div className="split">
          <label>ID (optional)<input value={form.id} onChange={(event) => setForm({ ...form, id: event.target.value })} disabled={Boolean(editing)} /></label>
          <label>Title<input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} required /></label>
          <label>Category
            <select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value as Video['category'] })}>
              <option value="tech">tech</option><option value="funny">funny</option><option value="lifestyle">lifestyle</option>
            </select>
          </label>
          <label>Source type
            <select value={form.sourceType} onChange={(event) => setForm({ ...form, sourceType: event.target.value as Video['sourceType'] })}>
              <option value="remote">remote https</option><option value="asset">local asset</option>
            </select>
          </label>
        </div>
        <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></label>
        <label>Source URL or asset name<input value={form.source} onChange={(event) => setForm({ ...form, source: event.target.value })} required /></label>
        <label>Optional local filename<input value={form.assetFilename} onChange={(event) => setForm({ ...form, assetFilename: event.target.value })} placeholder="tech.mp4" /></label>
        <label>Thumbnail URL<input value={form.thumbnailUrl} onChange={(event) => setForm({ ...form, thumbnailUrl: event.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active</label>
        <button className="primary" type="submit">{editing ? 'Save changes' : 'Create video'}</button>
      </form>
      {form.sourceType === 'remote' && form.source.startsWith('https://') ? (
        <div className="panel"><h2>Preview</h2><video src={form.source} controls width="360" /></div>
      ) : null}
    </section>
  );
}
