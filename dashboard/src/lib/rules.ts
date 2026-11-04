export function broadcastReady(mode: string, confirmed: boolean, typed: string): boolean {
  if (mode !== 'broadcast') return true;
  return confirmed && typed.trim() === 'SEND';
}

export function tagReady(mode: string, acknowledged: boolean): boolean {
  if (mode !== 'tag') return true;
  return acknowledged;
}

export function targetedPreview(willSend: number, broadcast: boolean): 'blocked' | 'ready' | 'no-targets' {
  if (broadcast) return 'blocked';
  if (willSend > 0) return 'ready';
  return 'no-targets';
}

export function maskRegistrationId(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
