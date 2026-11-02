import dotenv from 'dotenv';
import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { logger } from './logger.js';

dotenv.config();

const config = loadConfig(process.env);
logger.level = config.logLevel;
const { app } = createApp({ config });

const server = app.listen(config.port, '0.0.0.0', () => {
  logger.info(
    {
      host: '0.0.0.0',
      port: config.port,
      mode: config.mode,
      engagelabConfigured: config.engagelab.configured,
      baseUrlHost: config.engagelab.configured ? new URL(config.engagelab.baseUrl).host : null,
      knownDataCenter: config.engagelab.knownDataCenter,
    },
    'EngageVideoPush backend is listening. No push is sent at startup.',
  );
  if (!config.engagelab.knownDataCenter && config.engagelab.configured) {
    logger.warn('ENGAGELAB_BASE_URL is not one of the documented data-center hosts. Confirm the console Service Endpoint.');
  }
  if (config.mode === 'demo') {
    logger.warn('DEMO MODE: EngageLab credentials are absent. Results are simulated and are not deliveries.');
  }
});

function shutdown(): void {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
