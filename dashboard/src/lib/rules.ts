export function broadcastReady(mode: string, confirmed: boolean, typed: string): boolean {
  if (mode !== 'broadcast') return true;
  return confirmed && typed.trim() === 'SEND';
}

export function tagReady(mode: string, acknowledged: boolean): boolean {
  if (mode !== 'tag') return true;
  return acknowledged;
}

export function maskRegistrationId(value: string): string {
  if (value.length <= 8) return '••••';
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
