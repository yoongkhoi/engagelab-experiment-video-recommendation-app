const WALL_TIME = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/;

export function assertIanaTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error(`Timezone "${timeZone}" is not a valid IANA timezone.`);
  }
}

export function isScheduleTime(value: string): boolean {
  if (!WALL_TIME.test(value)) return false;
  const date = wallTimeToUtc(value, 'UTC');
  return !Number.isNaN(date.getTime());
}

export function formatInstantInTimeZone(date: Date, timeZone: string): string {
  assertIanaTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const hour = map.hour === '24' ? '00' : map.hour;
  return `${map.year}-${map.month}-${map.day} ${hour}:${map.minute}:${map.second}`;
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  if (hour === 24) hour = 0;
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour, Number(map.minute), Number(map.second));
  return asUtc - instant.getTime();
}

export function wallTimeToUtc(scheduleTime: string, timeZone: string): Date {
  const match = WALL_TIME.exec(scheduleTime);
  if (!match) {
    throw new Error('Scheduled time must use yyyy-MM-dd HH:mm:ss.');
  }
  assertIanaTimeZone(timeZone);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = new Date(wallAsUtc - timeZoneOffsetMs(new Date(wallAsUtc), timeZone));
  guess = new Date(wallAsUtc - timeZoneOffsetMs(guess, timeZone));
  return guess;
}

export function sanitizeScheduleName(name: string): string {
  const cleaned = name
    .replace(/[^\w\u4e00-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  const base = cleaned || 'video_campaign';
  return Buffer.byteLength(base) <= 255 ? base : base.slice(0, 80);
}
