import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';

export function newOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export function hashOtp(code: string, pepper: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(`${pepper}:${code}`, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

export function otpMatches(code: string, stored: string, pepper: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash || hash.length !== 64) return false;
  const next = scryptSync(`${pepper}:${code}`, salt, 32);
  const previous = Buffer.from(hash, 'hex');
  if (next.length !== previous.length) return false;
  return timingSafeEqual(next, previous);
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
