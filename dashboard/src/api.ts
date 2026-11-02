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
