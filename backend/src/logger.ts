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
    ],
    censor: '[redacted]',
  },
});
