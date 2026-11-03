import nodemailer from 'nodemailer';
import type { Logger } from 'pino';
import type { AppConfig } from '../config/env.js';

export interface Mailer {
  sendOtp(to: string, code: string): Promise<void>;
}

export class CapturingMailer implements Mailer {
  readonly sent: Array<{ to: string; code: string }> = [];

  async sendOtp(to: string, code: string): Promise<void> {
    this.sent.push({ to, code });
  }
}

export class SkipMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async sendOtp(to: string): Promise<void> {
    this.logger.info({ to }, 'OTP email was not sent because AUTH_EMAIL_MODE=test');
  }
}

export function createMailer(config: AppConfig, logger: Logger): Mailer {
  if (config.email.mode !== 'smtp') return new SkipMailer(logger);
  const transport = nodemailer.createTransport({
    host: config.email.host,
    port: config.email.port,
    secure: false,
    requireTLS: true,
    auth: { user: config.email.username, pass: config.email.password },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  return {
    async sendOtp(to: string, code: string): Promise<void> {
      await transport.sendMail({
        from: config.email.from,
        to,
        subject: 'Your EngageVideoPush sign-in code',
        text: `Your verification code is ${code}. It expires in 5 minutes. If you did not request it, ignore this message.`,
      });
    },
  };
}
