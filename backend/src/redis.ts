import { gunzipSync, gzipSync } from 'node:zlib';
import crypto from 'node:crypto';
import { Redis } from 'ioredis';
import { env } from './config.js';

// Cache (db 0) and BullMQ (db 1) are separate logical DBs on the SAME Redis
// instance/policy — `maxmemory-policy` is server-wide, not per-db, so the
// server MUST be started with `noeviction` (see docker-compose.yml) or
// BullMQ's internal keys can be evicted, silently corrupting the queue.
export const redis = new Redis({
  host: env.redisHost,
  port: env.redisPort,
  password: env.redisPassword,
  db: env.redisCacheDb,
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

// BullMQ requires maxRetriesPerRequest: null on its own connection.
export const bullConnection = new Redis({
  host: env.redisHost,
  port: env.redisPort,
  password: env.redisPassword,
  db: env.redisQueueDb,
  maxRetriesPerRequest: null,
  lazyConnect: false,
});

redis.on('error', (error: Error) => console.warn('[redis] cache connection error', error.message));
bullConnection.on('error', (error: Error) => console.warn('[redis] queue connection error', error.message));

const GZIP_THRESHOLD_BYTES = 64 * 1024;
const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

export function cacheKey(...parts: (string | number)[]): string {
  return ['sh:v1', ...parts].join(':');
}

export async function waitForRedis(timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeoutMs) {
    try {
      await redis.ping();
      await bullConnection.ping();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Could not reach Redis within ${timeoutMs}ms: ${String(lastError)}`);
}

/**
 * Generic TTL cache, API-compatible with the old SQLite-backed getCache/setCache
 * (see db.ts in the pre-MySQL revision) so call sites barely change.
 * Fail-open: any Redis error degrades to "cache miss", never a hard failure —
 * a Redis outage must make the app slower, not down.
 */
export async function getCache<T>(key: string): Promise<T | null> {
  try {
    const raw = await redis.getBuffer(key);
    if (!raw) return null;
    const isGzipped = raw.length >= 2 && raw[0] === GZIP_MAGIC[0] && raw[1] === GZIP_MAGIC[1];
    const json = (isGzipped ? gunzipSync(raw) : raw).toString('utf8');
    return JSON.parse(json) as T;
  } catch (error) {
    console.warn('[redis] getCache failed, treating as miss', (error as Error).message);
    return null;
  }
}

export async function setCache<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  try {
    const json = Buffer.from(JSON.stringify(value), 'utf8');
    const payload = json.length > GZIP_THRESHOLD_BYTES ? gzipSync(json) : json;
    await redis.set(key, payload, 'EX', ttlSeconds);
  } catch (error) {
    console.warn('[redis] setCache failed, continuing without cache', (error as Error).message);
  }
}

export async function delCache(key: string): Promise<void> {
  try {
    await redis.unlink(key);
  } catch (error) {
    console.warn('[redis] delCache failed', (error as Error).message);
  }
}

export async function delCachePrefix(prefix: string): Promise<number> {
  let cursor = '0';
  let deleted = 0;
  try {
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = nextCursor;
      if (keys.length > 0) {
        await redis.unlink(...keys);
        deleted += keys.length;
      }
    } while (cursor !== '0');
  } catch (error) {
    console.warn('[redis] delCachePrefix failed', (error as Error).message);
  }
  return deleted;
}

/**
 * Single-flight cache-aside: under concurrent cold-cache requests for the
 * same key, only one caller actually runs `loader()` — the rest poll for the
 * result. Avoids N concurrent multi-MB Xtream catalog fetches for N users
 * hitting an expired cache key at the same time.
 */
export async function getOrSet<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const cached = await getCache<T>(key);
  if (cached !== null) return cached;

  const lockKey = cacheKey('lock', key);
  const nonce = crypto.randomBytes(8).toString('hex');
  const lockTtlMs = 30_000;

  let haveLock = false;
  try {
    const result = await redis.set(lockKey, nonce, 'PX', lockTtlMs, 'NX');
    haveLock = result === 'OK';
  } catch {
    haveLock = false; // Redis unavailable: fall through and load directly.
  }

  if (!haveLock) {
    const deadline = Date.now() + lockTtlMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const value = await getCache<T>(key);
      if (value !== null) return value;
    }
    // Lock never released in time — load anyway rather than fail the request.
    const value = await loader();
    await setCache(key, value, ttlSeconds);
    return value;
  }

  try {
    const value = await loader();
    await setCache(key, value, ttlSeconds);
    return value;
  } finally {
    try {
      // Compare-and-delete: only release the lock if we still own it.
      const releaseScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        end
        return 0
      `;
      await redis.eval(releaseScript, 1, lockKey, nonce);
    } catch {
      // Lock will simply expire via its TTL.
    }
  }
}
