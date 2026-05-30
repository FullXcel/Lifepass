import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

// Node.js does not load .env automatically. Load the project-local .env once,
// before any server-side configuration reads process.env.
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const DEFAULT_STORE_DIR = path.join(ROOT_DIR, 'server', 'data', 'policy_store');

export function envBool(name, fallback = false, env = process.env) {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

export function envNumber(name, fallback, env = process.env) {
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
}

export function envList(name, env = process.env) {
  return String(env[name] || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function getServerConfig(env = process.env) {
  return {
    rootDir: ROOT_DIR,
    storeDir: env.POLICY_STORE_DIR || DEFAULT_STORE_DIR,
    databaseUrl: env.DATABASE_URL || '',
    policyRefreshTtlHours: envNumber('POLICY_REFRESH_TTL_HOURS', 24, env),
    port: envNumber('LIFEPASS_API_PORT', 8787, env),
    host: env.LIFEPASS_API_HOST || '0.0.0.0',
    adminToken: env.LIFEPASS_ADMIN_TOKEN || '',
    requestTimeoutMs: envNumber('POLICY_FETCH_TIMEOUT_MS', 15000, env),
    schedulerIntervalMs: envNumber('POLICY_SCHEDULER_INTERVAL_MS', 6 * 60 * 60 * 1000, env),
    maxPagesPerSource: envNumber('POLICY_MAX_PAGES_PER_SOURCE', 3, env),
    maxDetailsPerSource: envNumber('POLICY_MAX_DETAILS_PER_SOURCE', 25, env),
    corsOrigin: env.LIFEPASS_CORS_ORIGIN || '*',
    allowCrawler: envBool('ENABLE_LOCAL_NOTICE_CRAWLER', false, env),
    dryRun: envBool('POLICY_INGEST_DRY_RUN', false, env),
  };
}

export function getPolicyApiConfig(env = process.env) {
  return {
    bokjiro: {
      serviceKey: env.BOKJIRO_SERVICE_KEY || '',
      centralListUrl: env.BOKJIRO_CENTRAL_API_URL || '',
      centralDetailUrl: env.BOKJIRO_CENTRAL_DETAIL_API_URL || '',
      localListUrl: env.BOKJIRO_LOCAL_API_URL || '',
    },
    gov24: {
      serviceKey: env.GOV24_SERVICE_KEY || '',
      listUrl: env.GOV24_BENEFIT_API_URL || '',
      detailUrl: env.GOV24_DETAIL_API_URL || '',
      supportConditionsUrl: env.GOV24_SUPPORT_CONDITIONS_API_URL || '',
    },
    youth: {
      serviceKey: env.YOUTH_POLICY_API_KEY || '',
      listUrl: env.YOUTH_POLICY_API_URL || '',
    },
    myhome: {
      serviceKey: env.MYHOME_SERVICE_KEY || '',
      publicHousingNoticeUrl: env.MYHOME_PUBLIC_HOUSING_NOTICE_API_URL || '',
      rentalHousingComplexUrl: env.MYHOME_RENTAL_HOUSING_COMPLEX_API_URL || '',
      waitingListUrl: env.MYHOME_WAITING_LIST_API_URL || '',
    },
    worknet: {
      serviceKey: env.WORKNET_SERVICE_KEY || '',
      jobUrl: env.WORKNET_JOB_API_URL || '',
    },
    law: {
      oc: env.LAW_OPEN_API_OC || '',
      searchUrl: env.LAW_SEARCH_API_URL || '',
      serviceUrl: env.LAW_SERVICE_API_URL || '',
      queries: envList('LAW_POLICY_QUERIES', env),
    },
    localNoticeUrls: envList('LOCAL_NOTICE_URLS', env),
  };
}

export function assertAdmin(req, config = getServerConfig()) {
  if (!config.adminToken) return true;
  const token = req.headers['x-admin-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return token === config.adminToken;
}