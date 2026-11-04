export function clockMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export function inQuietHours(start: string | null, end: string | null, nowMinutes: number): boolean {
  if (!start || !end) return false;
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null || from === to) return false;
  if (from < to) return nowMinutes >= from && nowMinutes < to;
  return nowMinutes >= from || nowMinutes < to;
}

export function zonedMinutes(timeZone: string, date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timeZone || 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}
