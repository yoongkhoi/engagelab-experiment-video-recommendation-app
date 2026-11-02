import dotenv from 'dotenv';
import { loadConfig } from '../src/config/env.js';
import { EngageLabClient } from '../src/integrations/engagelabClient.js';
import { logger } from '../src/logger.js';
import { ProviderError } from '../src/errors.js';

dotenv.config();
const config = loadConfig(process.env);
const client = new EngageLabClient(config.engagelab, fetch, logger);

try {
  const tags = await client.listTags();
  const text = JSON.stringify(tags);
  console.log(`PROBE_OK host=${new URL(config.engagelab.baseUrl).host} bytes=${text.length}`);
} catch (error) {
  if (error instanceof ProviderError) {
    console.log(`PROBE_FAIL kind=${error.kind} status=${error.status ?? ''} code=${error.providerCode ?? ''} message=${error.message}`);
  } else {
    console.log(`PROBE_FAIL kind=unexpected message=${error instanceof Error ? error.message : 'unknown'}`);
  }
  process.exitCode = 1;
}
