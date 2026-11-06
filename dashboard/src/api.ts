const base = import.meta.env.VITE_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export function adminKey(): string {
  return sessionStorage.getItem('evp-admin-key') ?? '';
}

export function setAdminKey(value: string): void {
  sessionStorage.setItem('evp-admin-key', value.trim());
}

export function clearAdminKey(): void {
  sessionStorage.removeItem('evp-admin-key');
}

export async function uploadMedia(file: File): Promise<{ filename: string; source: string; bytes: number }> {
  const headers = new Headers();
  const key = adminKey();
  if (key) headers.set('Authorization', `Bearer ${key}`);
  headers.set('Content-Type', file.type || 'application/octet-stream');
  const response = await fetch(`${base}/api/videos/upload?name=${encodeURIComponent(file.name)}`, {
    method: 'POST',
    headers,
    body: file,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as { error?: { message?: string; code?: string }; filename?: string; source?: string; bytes?: number } : {};
  if (!response.ok || !payload.source || !payload.filename) {
    throw new ApiError(payload.error?.message ?? `Upload failed (${response.status})`, response.status, payload.error?.code);
  }
  return { filename: payload.filename, source: payload.source, bytes: payload.bytes ?? file.size };
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  const key = adminKey();
  if (key) headers.set('Authorization', `Bearer ${key}`);
  const response = await fetch(`${base}${path}`, { ...options, headers });
  const text = await response.text();
  const payload = text ? JSON.parse(text) as { error?: { message?: string; code?: string } } : {};
  if (!response.ok) {
    throw new ApiError(payload.error?.message ?? `Request failed (${response.status})`, response.status, payload.error?.code);
  }
  return payload as T;
}
