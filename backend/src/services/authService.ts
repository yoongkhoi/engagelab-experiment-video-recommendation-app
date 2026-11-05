import { HttpError } from '../errors.js';
import type { AppUser, UserPreferenceRecord, VideoPreference } from '../domain.js';
import { nowIso } from '../domain.js';
import type { Store } from '../repositories/store.js';
import { newId } from './audience.js';
import type { Mailer } from './mailer.js';
import { hashOtp, hashSessionToken, newOtpCode, newSessionToken, normalizeEmail, otpMatches } from './secrets.js';

const OTP_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const COOLDOWN_MS = 30 * 1000;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_EMAIL = 5;
const MAX_PER_IP = 10;
const MAX_ATTEMPTS = 5;

export class AuthService {
  constructor(
    private readonly store: Store,
    private readonly mailer: Mailer,
    private readonly pepper: string,
  ) {}

  async requestOtp(emailInput: string, ip: string | null): Promise<void> {
    const email = normalizeEmail(emailInput);
    const now = Date.now();
    const since = new Date(now - WINDOW_MS).toISOString();
    if (this.store.countChallengesSince(email, since) >= MAX_PER_EMAIL) {
      throw new HttpError(429, 'OTP_RATE_LIMIT', 'Too many verification requests. Wait before trying again.');
    }
    if (ip && this.store.countChallengesByIpSince(ip, since) >= MAX_PER_IP) {
      throw new HttpError(429, 'OTP_RATE_LIMIT', 'Too many verification requests. Wait before trying again.');
    }
    const latest = this.store.latestChallenge(email);
    if (latest && now - Date.parse(latest.createdAt) < COOLDOWN_MS) {
      throw new HttpError(429, 'OTP_COOLDOWN', 'Please wait 30 seconds before requesting another code.');
    }
    const code = newOtpCode();
    const row = {
      id: newId(),
      email,
      otpHash: hashOtp(code, this.pepper),
      expiresAt: new Date(now + OTP_TTL_MS).toISOString(),
      createdAt: new Date(now).toISOString(),
      requestIp: ip,
    };
    this.store.insertChallenge(row);
    try {
      await this.mailer.sendOtp(email, code);
    } catch {
      this.store.markChallengeAttempt(row.id, MAX_ATTEMPTS, new Date(now).toISOString());
      throw new HttpError(503, 'EMAIL_FAILED', 'The verification email could not be sent. Try again later.');
    }
  }

  verify(emailInput: string, code: string): { token: string; expiresAt: string; user: AppUser; created: boolean } {
    const email = normalizeEmail(emailInput);
    const challenge = this.store.latestChallenge(email);
    if (!challenge || challenge.consumedAt || challenge.attempts >= MAX_ATTEMPTS) {
      throw new HttpError(401, 'OTP_INVALID', 'The verification code is invalid or has already been used.');
    }
    if (Date.parse(challenge.expiresAt) <= Date.now()) {
      this.store.markChallengeAttempt(challenge.id, challenge.attempts + 1, nowIso());
      throw new HttpError(401, 'OTP_EXPIRED', 'The verification code has expired. Request a new one.');
    }
    if (!otpMatches(code, challenge.otpHash, this.pepper)) {
      const attempts = challenge.attempts + 1;
      this.store.markChallengeAttempt(challenge.id, attempts, attempts >= MAX_ATTEMPTS ? nowIso() : null);
      throw new HttpError(401, 'OTP_INVALID', 'The verification code is invalid or has already been used.');
    }
    this.store.markChallengeAttempt(challenge.id, challenge.attempts + 1, nowIso());
    const now = nowIso();
    const existing = this.store.getUserByEmail(email);
    const created = !existing;
    const user = existing ?? {
      id: newId(),
      normalizedEmail: email,
      displayName: null,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
      accountStatus: 'active' as const,
    };
    if (created) this.store.insertUser(user);
    else this.store.touchUserLogin(user.id, now);
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.store.insertSession({ id: newId(), userId: user.id, tokenHash: hashSessionToken(token), expiresAt, createdAt: now });
    return { token, expiresAt, user: { ...user, lastLoginAt: now }, created };
  }

  userForToken(token: string): AppUser {
    const session = this.store.getSessionByHash(hashSessionToken(token));
    if (!session || session.revokedAt || Date.parse(session.expiresAt) <= Date.now()) {
      throw new HttpError(401, 'SESSION_EXPIRED', 'Sign in again.');
    }
    const user = this.store.getUser(session.userId);
    if (!user || user.accountStatus !== 'active') throw new HttpError(401, 'SESSION_EXPIRED', 'Sign in again.');
    return user;
  }

  logout(token: string): void {
    this.store.revokeSession(hashSessionToken(token), nowIso());
  }

  preferences(userId: string): UserPreferenceRecord {
    return this.store.getPreferences(userId) ?? {
      userId,
      categories: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
  }

  updateDisplayName(userId: string, displayName: string): AppUser {
    const user = this.store.getUser(userId);
    if (!user || user.accountStatus !== 'active') throw new HttpError(401, 'SESSION_EXPIRED', 'Sign in again.');
    const now = nowIso();
    this.store.updateDisplayName(userId, displayName, now);
    return { ...user, displayName, updatedAt: now };
  }

  savePreferences(userId: string, categories: VideoPreference[]): UserPreferenceRecord {
    const existing = this.store.getPreferences(userId);
    const now = nowIso();
    const record: UserPreferenceRecord = {
      userId,
      categories,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.store.savePreferences(record);
    return record;
  }

  setPassword(userId: string, password: string): void {
    this.assertPassword(password);
    this.store.setPasswordHash(userId, hashOtp(password, this.pepper), nowIso());
  }

  loginWithPassword(emailInput: string, password: string): { token: string; expiresAt: string; user: AppUser; created: boolean } {
    const email = normalizeEmail(emailInput);
    const user = this.store.getUserByEmail(email);
    const hash = user ? this.store.passwordHash(user.id) : null;
    if (!user || user.accountStatus !== 'active' || !hash || !otpMatches(password, hash, this.pepper)) {
      throw new HttpError(401, 'PASSWORD_INVALID', 'The email or password was not accepted.');
    }
    const now = nowIso();
    this.store.touchUserLogin(user.id, now);
    const token = newSessionToken();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    this.store.insertSession({ id: newId(), userId: user.id, tokenHash: hashSessionToken(token), expiresAt, createdAt: now });
    return { token, expiresAt, user: { ...user, lastLoginAt: now }, created: false };
  }

  resetPassword(emailInput: string, code: string, password: string): { token: string; expiresAt: string; user: AppUser; created: boolean } {
    this.assertPassword(password);
    const verified = this.verify(emailInput, code);
    this.store.setPasswordHash(verified.user.id, hashOtp(password, this.pepper), nowIso());
    return verified;
  }

  deleteAccount(userId: string): void {
    const now = nowIso();
    this.store.revokeUserSessions(userId, now);
    this.store.setAccountStatus(userId, 'deleted', now);
  }

  private assertPassword(password: string): void {
    if (password.length < 8 || password.length > 72) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Use a password between 8 and 72 characters.');
    }
  }
}
