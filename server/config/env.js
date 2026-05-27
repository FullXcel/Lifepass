import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');
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

export function getServerConfig(env = process.env) {
  return {
    rootDir: ROOT_DIR,
    storeDir: env.POLICY_STORE_DIR || DEFAULT_STORE_DIR,
    port: envNumber('LIFEPASS_API_PORT', 8787, env),
    host: env.LIFEPASS_API_HOST || '0.0.0.0',
    adminToken: env.LIFEPASS_ADMIN_TOKEN || '',
    requestTimeoutMs: envNumber('POLICY_FETCH_TIMEOUT_MS', 15000, env),
    schedulerIntervalMs: envNumber('POLICY_SCHEDULER_INTERVAL_MS', 6 * 60 * 60 * 1000, env),
    corsOrigin: env.LIFEPASS_CORS_ORIGIN || '*',
    allowCrawler: envBool('ENABLE_LOCAL_NOTICE_CRAWLER', false, env),
    dryRun: envBool('POLICY_INGEST_DRY_RUN', false, env),
  };
}

export function assertAdmin(req, config = getServerConfig()) {
  if (!config.adminToken) return true;
  const token = req.headers['x-admin-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
  return token === config.adminToken;
}
