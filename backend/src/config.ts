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
  dbPath: process.env.DB_PATH ?? 'app.db',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  encryptionSecret: process.env.APP_ENCRYPTION_SECRET ?? 'change-me-32-char-minimum-secret',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 120),
  streamProxyTimeoutMs: Number(process.env.STREAM_PROXY_TIMEOUT_MS ?? 20000),
  appVersion: process.env.APP_VERSION?.trim() || readPackageVersion(),
  gitCommit: process.env.GIT_COMMIT?.trim() || 'unknown',
  // Optional: enables GET /api/tmdb/match when set. Feature degrades to
  // { enabled: false } when absent — no other behavior depends on it.
  tmdbApiKey: process.env.TMDB_API_KEY?.trim() || '',
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
