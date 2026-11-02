import { z } from 'zod';

const OFFICIAL_PUSH_HOSTS = new Set([
  'pushapi-sgp.engagelab.com',
  'pushapi-usva.engagelab.com',
  'pushapi-defra.engagelab.com',
  'pushapi-hk.engagelab.com',
  'pushapi-jpn.engagelab.com',
  'pushapi-bra.engagelab.com',
]);

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).default('./data/engage.sqlite'),
  ADMIN_API_KEY: z.string().min(12, 'ADMIN_API_KEY must be at least 12 characters'),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
  LOG_LEVEL: z.string().default('info'),
  ENGAGELAB_APPKEY: z.string().optional().default(''),
  ENGAGELAB_MASTER_SECRET: z.string().optional().default(''),
  ENGAGELAB_BASE_URL: z.string().optional().default(''),
  ENGAGELAB_TIMEOUT_MS: z.coerce.number().int().positive().max(60000).default(15000),
  ENGAGELAB_SITE_TIMEZONE: z.string().optional().default(''),
  ANDROID_PACKAGE_NAME: z.string().min(1).default('com.example.engagevideopush'),
  DEMO_MODE: z.enum(['auto', 'true', 'false']).default('auto'),
  PIXABAY_API_KEY: z.string().optional().default(''),
});

export interface EngageLabConfig {
  configured: boolean;
  appKey: string;
  masterSecret: string;
  baseUrl: string;
  timeoutMs: number;
  siteTimeZone: string;
  knownDataCenter: boolean;
}

export interface AppConfig {
  port: number;
  databaseUrl: string;
  adminApiKey: string;
  corsOrigins: string[];
  logLevel: string;
  androidPackageName: string;
  mode: 'live' | 'demo';
  engagelab: EngageLabConfig;
  pixabayApiKey: string;
}

export function loadConfig(source: NodeJS.ProcessEnv): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment configuration.\n${details.join('\n')}`);
  }

  const env = parsed.data;
  const pixabayApiKey = env.PIXABAY_API_KEY.trim();
  if (pixabayApiKey && pixabayApiKey.length < 10) {
    throw new Error('PIXABAY_API_KEY is too short. Copy the key from the Pixabay API page, or leave it empty.');
  }
  const appKey = env.ENGAGELAB_APPKEY.trim();
  const masterSecret = env.ENGAGELAB_MASTER_SECRET.trim();
  const baseUrl = env.ENGAGELAB_BASE_URL.trim().replace(/\/+$/, '');
  const hasAny = Boolean(appKey || masterSecret || baseUrl);
  const hasAll = Boolean(appKey && masterSecret && baseUrl);

  if (hasAny && !hasAll) {
    throw new Error(
      'Incomplete EngageLab configuration. Set ENGAGELAB_APPKEY, ENGAGELAB_MASTER_SECRET, and ENGAGELAB_BASE_URL together, or leave all three empty for labeled demo mode. The server will not pretend the provider is connected.',
    );
  }

  let knownDataCenter = false;
  if (hasAll) {
    if (!/^[A-Za-z0-9]{24}$/.test(appKey)) {
      throw new Error('ENGAGELAB_APPKEY must be the 24-character AppKey from the EngageLab App Information page.');
    }
    if (masterSecret.length < 8) {
      throw new Error('ENGAGELAB_MASTER_SECRET is missing or too short. Copy it from the console. Do not commit it.');
    }
    let url: URL;
    try {
      url = new URL(baseUrl);
    } catch {
      throw new Error('ENGAGELAB_BASE_URL is not a valid URL. Use the Service Endpoint base URL for the application data center.');
    }
    if (url.protocol !== 'https:') {
      throw new Error('ENGAGELAB_BASE_URL must use HTTPS.');
    }
    knownDataCenter = OFFICIAL_PUSH_HOSTS.has(url.host);
    if (env.ENGAGELAB_SITE_TIMEZONE) {
      assertTimeZone(env.ENGAGELAB_SITE_TIMEZONE);
    }
  } else if (env.DEMO_MODE === 'false') {
    throw new Error(
      'EngageLab credentials are missing and DEMO_MODE=false. Add the AppKey, Master Secret, and data-center base URL, or set DEMO_MODE=auto.',
    );
  }

  return {
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    adminApiKey: env.ADMIN_API_KEY,
    corsOrigins: env.CORS_ORIGIN.split(',').map((item) => item.trim()).filter(Boolean),
    logLevel: env.LOG_LEVEL,
    androidPackageName: env.ANDROID_PACKAGE_NAME,
    mode: hasAll ? 'live' : 'demo',
    pixabayApiKey,
    engagelab: {
      configured: hasAll,
      appKey,
      masterSecret,
      baseUrl,
      timeoutMs: env.ENGAGELAB_TIMEOUT_MS,
      siteTimeZone: env.ENGAGELAB_SITE_TIMEZONE.trim(),
      knownDataCenter,
    },
  };
}

export function assertTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
  } catch {
    throw new Error(`Timezone "${timeZone}" is not a valid IANA timezone. Example for the Singapore data center: Asia/Singapore.`);
  }
}

export const OFFICIAL_DATA_CENTERS = OFFICIAL_PUSH_HOSTS;
