import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Reads backend/package.json regardless of whether this module runs from
// src/ (tsx dev) or dist/ (compiled build) — both sit one level below the
// package root.
function readPackageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  encryptionSecret: process.env.APP_ENCRYPTION_SECRET ?? 'change-me-32-char-minimum-secret',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  streamProxyTimeoutMs: Number(process.env.STREAM_PROXY_TIMEOUT_MS ?? 20000),
  appVersion: process.env.APP_VERSION?.trim() || readPackageVersion(),
  gitCommit: process.env.GIT_COMMIT?.trim() || 'unknown',
  // Optional: enables GET /api/tmdb/match + /api/tmdb/search when set.
  // Everything degrades to { enabled: false } when absent.
  tmdbApiKey: process.env.TMDB_API_KEY?.trim() || '',

  // ── MySQL (StreamHub's own data — not Jellyfin/Radarr/Sonarr's) ────────────
  mysqlHost: process.env.MYSQL_HOST ?? 'mysql',
  mysqlPort: Number(process.env.MYSQL_PORT ?? 3306),
  mysqlDatabase: process.env.MYSQL_DATABASE ?? 'streamhub',
  mysqlUser: process.env.MYSQL_USER ?? 'streamhub',
  mysqlPassword: process.env.MYSQL_PASSWORD ?? '',
  mysqlPoolSize: Number(process.env.MYSQL_POOL_SIZE ?? 10),
  // Only read by dist/scripts/migrate-sqlite-to-mysql.js during the one-off cutover.
  legacySqlitePath: process.env.LEGACY_SQLITE_PATH ?? '/data-legacy/app.db',

  // ── Redis (cache db0 + BullMQ db1) ──────────────────────────────────────────
  redisHost: process.env.REDIS_HOST ?? 'redis',
  redisPort: Number(process.env.REDIS_PORT ?? 6379),
  redisPassword: process.env.REDIS_PASSWORD || undefined,
  redisCacheDb: Number(process.env.REDIS_CACHE_DB ?? 0),
  redisQueueDb: Number(process.env.REDIS_QUEUE_DB ?? 1),

  // ── Caching TTLs (seconds) ──────────────────────────────────────────────────
  xtreamCatalogTtlSeconds: Number(process.env.XTREAM_CATALOG_TTL_SECONDS ?? 900),
  xtreamSeriesTtlSeconds: Number(process.env.XTREAM_SERIES_TTL_SECONDS ?? 3600),
  tmdbCacheTtlSeconds: Number(process.env.TMDB_CACHE_TTL_SECONDS ?? 2_592_000),

  // ── Background workers (BullMQ) ─────────────────────────────────────────────
  runWorkers: (process.env.RUN_WORKERS ?? 'true') !== 'false',
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY ?? 2),

  // ── Jellyfin ─────────────────────────────────────────────────────────────────
  jellyfinUrl: process.env.JELLYFIN_URL?.trim() || '',
  jellyfinApiKey: process.env.JELLYFIN_API_KEY?.trim() || '',
  jellyfinUserId: process.env.JELLYFIN_USER_ID?.trim() || '',
  jellyfinSyncIntervalMs: Number(process.env.JELLYFIN_SYNC_INTERVAL_MS ?? 900_000),

  // ── Radarr ───────────────────────────────────────────────────────────────────
  radarrUrl: process.env.RADARR_URL?.trim() || '',
  radarrApiKey: process.env.RADARR_API_KEY?.trim() || '',
  radarrRootFolder: process.env.RADARR_ROOT_FOLDER?.trim() || '',
  radarrQualityProfileId: Number(process.env.RADARR_QUALITY_PROFILE_ID ?? 0),

  // ── Sonarr ───────────────────────────────────────────────────────────────────
  sonarrUrl: process.env.SONARR_URL?.trim() || '',
  sonarrApiKey: process.env.SONARR_API_KEY?.trim() || '',
  sonarrRootFolder: process.env.SONARR_ROOT_FOLDER?.trim() || '',
  sonarrQualityProfileId: Number(process.env.SONARR_QUALITY_PROFILE_ID ?? 0),

  // ── Webhooks (Radarr/Sonarr "Connect" -> Webhook; secret lives in the URL) ──
  requestsWebhookSecret: process.env.REQUESTS_WEBHOOK_SECRET?.trim() || '',
};

if (env.encryptionSecret.length < 32) {
  throw new Error('APP_ENCRYPTION_SECRET must be at least 32 characters long');
}

if (env.jwtSecret === 'change-me') {
  // Non-fatal on purpose: the running dev deployment may not have this set
  // yet and we don't want a config gap to take down the only instance.
  console.warn(
    '[security] JWT_SECRET is using its default value. Set JWT_SECRET in the environment before exposing this service beyond local/dev use.'
  );
}

// ── Feature-gate flags ────────────────────────────────────────────────────────
// Every integration below is optional and must degrade gracefully (never
// throw at boot) when unconfigured — the IPTV player is the core product and
// must keep working even if Jellyfin/Radarr/Sonarr were never set up.

export const jellyfinConfigured = !!(env.jellyfinUrl && env.jellyfinApiKey);
if (env.jellyfinUrl && !env.jellyfinApiKey) {
  console.warn('[jellyfin] JELLYFIN_URL is set but JELLYFIN_API_KEY is missing — Jellyfin integration stays disabled.');
}

export const radarrConfigured = !!(
  env.radarrUrl && env.radarrApiKey && env.radarrRootFolder && env.radarrQualityProfileId > 0
);
if (env.radarrUrl && !radarrConfigured) {
  console.warn(
    '[requests] Radarr is partially configured. RADARR_API_KEY / RADARR_ROOT_FOLDER / RADARR_QUALITY_PROFILE_ID ' +
    'come from the one-time Radarr web UI setup (Settings > General > API Key, Settings > Media Management > Root ' +
    'Folders, Settings > Profiles). Movie requests will return 503 until all are set.'
  );
}

export const sonarrConfigured = !!(
  env.sonarrUrl && env.sonarrApiKey && env.sonarrRootFolder && env.sonarrQualityProfileId > 0
);
if (env.sonarrUrl && !sonarrConfigured) {
  console.warn(
    '[requests] Sonarr is partially configured. SONARR_API_KEY / SONARR_ROOT_FOLDER / SONARR_QUALITY_PROFILE_ID ' +
    'come from the one-time Sonarr web UI setup. Series requests will return 503 until all are set.'
  );
}

export const requestsConfigured = radarrConfigured || sonarrConfigured;
if (requestsConfigured && !env.requestsWebhookSecret) {
  console.warn(
    '[requests] REQUESTS_WEBHOOK_SECRET is not set — generate one with `openssl rand -hex 32` so Radarr/Sonarr ' +
    'webhooks can be verified. Requests will still work via the 5-minute status-polling fallback.'
  );
}
