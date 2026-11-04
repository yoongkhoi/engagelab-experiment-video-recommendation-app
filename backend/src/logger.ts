import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.Authorization',
      'authorization',
      'Authorization',
      'masterSecret',
      'ENGAGELAB_MASTER_SECRET',
      'password',
      'deviceToken',
      'smtpPassword',
      'SMTP_PASSWORD',
      'SESSION_PEPPER',
      'OPENAI_API_KEY',
      'apiKey',
      'SEARCHAPI_API_KEY',
      'otp',
      'code',
    ],
    censor: '[redacted]',
  },
});
