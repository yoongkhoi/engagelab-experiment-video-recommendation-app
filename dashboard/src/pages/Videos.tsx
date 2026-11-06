import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ApiError, api, uploadMedia } from '../api';

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
  const fileInput = useRef<HTMLInputElement>(null);
  const [videos, setVideos] = useState<Video[]>([]);
  const [form, setForm] = useState<VideoForm>(empty);
  const [pickedName, setPickedName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  async function load() {
    const data = await api<{ videos: Video[] }>('/api/videos?all=1');
    setVideos(data.videos);
  }
  useEffect(() => { load().catch((reason: Error) => setError(reason.message)); }, []);

  function resetForm() {
    setForm(empty);
    setEditing(null);
    setPickedName('');
  }

  async function chooseFile(file: File) {
    setError('');
    setUploading(true);
    try {
      const uploaded = await uploadMedia(file);
      setForm((current) => ({ ...current, sourceType: 'remote', source: uploaded.source, assetFilename: '' }));
      setPickedName(file.name);
      setMessage(`${file.name} is ready to save.`);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : 'Could not read the selected video');
    } finally {
      setUploading(false);
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!form.source.startsWith('/media/') && !form.source.startsWith('https://')) {
      setError('Choose a video file, or enter a URL that starts with https://.');
      return;
    }
    const body = {
      ...form,
      id: form.id || undefined,
      sourceType: 'remote' as const,
      assetFilename: null,
      thumbnailUrl: form.thumbnailUrl || null,
    };
    try {
      if (editing) await api(`/api/videos/${editing}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/videos', { method: 'POST', body: JSON.stringify(body) });
      resetForm();
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
                    <button className="ghost" type="button" onClick={() => { setEditing(video.id); setPickedName(video.source.startsWith('/media/') ? video.source.split('/').pop() ?? '' : ''); setForm({ ...video, assetFilename: video.assetFilename ?? '', thumbnailUrl: video.thumbnailUrl ?? '' }); }}>Edit</button>
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
        </div>
        <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} required /></label>
        <label>Video URL<input value={form.source.startsWith('/media/') ? '' : form.source} onChange={(event) => { setPickedName(''); setForm({ ...form, source: event.target.value, sourceType: 'remote' }); }} placeholder="https://  (leave empty if you choose a file)" /></label>
        <div>
          <input
            ref={fileInput}
            type="file"
            accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) void chooseFile(file);
            }}
          />
          <button className="primary" type="button" onClick={() => fileInput.current?.click()} disabled={uploading}>
            {uploading ? 'Reading file…' : 'Choose video file'}
          </button>
          <p className="muted">{pickedName ? `Selected: ${pickedName}` : 'Opens your files so you can select an mp4, webm, mov, or m4v.'}</p>
        </div>
        <label>Thumbnail URL<input value={form.thumbnailUrl} onChange={(event) => setForm({ ...form, thumbnailUrl: event.target.value })} /></label>
        <label className="row"><input type="checkbox" checked={form.active} onChange={(event) => setForm({ ...form, active: event.target.checked })} /> Active</label>
        <button className="primary" type="submit" disabled={uploading}>{editing ? 'Save changes' : 'Create video'}</button>
      </form>
      {form.source.startsWith('https://') || form.source.startsWith('/media/') ? (
        <div className="panel"><h2>Preview</h2><video src={form.source} controls width="360" /></div>
      ) : null}
    </section>
  );
}
