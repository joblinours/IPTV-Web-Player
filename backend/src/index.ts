import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { z } from 'zod';

type ContentType = 'live' | 'vod' | 'series';

type XtreamCategory = {
  category_id: string;
  category_name: string;
  parent_id?: number;
};

type XtreamStream = {
  stream_id?: number;
  series_id?: number;
  category_id?: string;
  name?: string;
  title?: string;
  stream_icon?: string;
  cover?: string;
  container_extension?: string;
  rating?: string;
  genre?: string;
  plot?: string;
  year?: string;
  release_date?: string;
  added?: string;
  tv_archive?: number | string;
  tv_archive_duration?: number | string;
  epg_channel_id?: string;
  duration?: string;
  duration_secs?: number | string;
};

type XtreamSeriesEpisode = {
  id?: string;
  episode_num?: number;
  title?: string;
  container_extension?: string;
  season?: number;
  info?: {
    duration?: string;
    duration_secs?: number;
    movie_image?: string;
    rating?: number;
    air_date?: string;
  };
};

type XtreamSeriesInfoResponse = {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    rating?: string;
    rating_5based?: string;
    episode_run_time?: string;
    backdrop_path?: string[];
  };
  episodes?: Record<string, XtreamSeriesEpisode[]>;
};

type PlaybackTrace = {
  route: 'stream-url' | 'stream-proxy' | 'transcode';
  mode: 'direct' | 'proxy' | 'transcode';
  accountId: number;
  mediaType: ContentType;
  streamId: number;
  extension: string;
  mediaTitle?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  upstreamStatus?: number;
  fallbackWithoutRange?: boolean;
  note?: string;
};

const env = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DB_PATH ?? 'app.db',
  jwtSecret: process.env.JWT_SECRET ?? 'change-me',
  encryptionSecret: process.env.APP_ENCRYPTION_SECRET ?? 'change-me-32-char-minimum-secret',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 120),
  streamProxyTimeoutMs: Number(process.env.STREAM_PROXY_TIMEOUT_MS ?? 20000),
};

if (env.encryptionSecret.length < 32) {
  throw new Error('APP_ENCRYPTION_SECRET must be at least 32 characters long');
}

const app = Fastify({ logger: true });
const db = new Database(env.dbPath);

app.register(cors, { origin: env.corsOrigin, credentials: true });
app.register(jwt, { secret: env.jwtSecret });

app.decorate('authenticate', async function (request: any, reply: any) {
  try {
    await request.jwtVerify();
  } catch {
    return reply.code(401).send({ message: 'Unauthorized' });
  }
});

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: any, reply: any) => Promise<void>;
  }
}

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, originalHash] = stored.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(originalHash, 'hex'));
}

function encryptSecret(plainText: string): string {
  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(env.encryptionSecret).digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptSecret(payload: string): string {
  const [ivHex, tagHex, encryptedHex] = payload.split(':');
  const key = crypto.createHash('sha256').update(env.encryptionSecret).digest();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

function sanitizeLogText(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 180);
}

function logPlaybackTrace(trace: PlaybackTrace) {
  app.log.info({
    event: 'playback_trace',
    at: new Date().toISOString(),
    ...trace,
    mediaTitle: sanitizeLogText(trace.mediaTitle),
    seriesTitle: sanitizeLogText(trace.seriesTitle),
  });
}

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS iptv_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      server_url TEXT NOT NULL,
      username TEXT NOT NULL,
      password_enc TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS cache_entries (
      cache_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS favorites (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('live', 'vod', 'series')),
      item_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(account_id) REFERENCES iptv_accounts(id),
      UNIQUE(user_id, account_id, type, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_favorites_user_account_type
      ON favorites(user_id, account_id, type);

    CREATE INDEX IF NOT EXISTS idx_favorites_item
      ON favorites(item_id);

    CREATE TABLE IF NOT EXISTS watch_progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      account_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('vod', 'series_episode')),
      item_id TEXT NOT NULL,
      series_id TEXT,
      season_number INTEGER,
      episode_number INTEGER,
      current_time REAL NOT NULL DEFAULT 0,
      total_duration REAL NOT NULL DEFAULT 0,
      is_watched INTEGER NOT NULL DEFAULT 0,
      needs_transcode INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(account_id) REFERENCES iptv_accounts(id),
      UNIQUE(user_id, account_id, type, item_id)
    );

    CREATE INDEX IF NOT EXISTS idx_watch_progress_user_account_type
      ON watch_progress(user_id, account_id, type);

    CREATE INDEX IF NOT EXISTS idx_watch_progress_series
      ON watch_progress(user_id, account_id, series_id);

    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER PRIMARY KEY,
      autoplay INTEGER NOT NULL DEFAULT 1,
      language TEXT NOT NULL DEFAULT 'fr',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id)
    );
  `);
}

initDb();

// Migration: add needs_transcode column if it doesn't exist yet (safe on fresh DB too)
try {
  db.exec(`ALTER TABLE watch_progress ADD COLUMN needs_transcode INTEGER NOT NULL DEFAULT 0`);
} catch { /* column already exists */ }

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const loginSchema = registerSchema;

const addAccountSchema = z.object({
  name: z.string().min(1),
  serverUrl: z.string().url(),
  username: z.string().min(1),
  password: z.string().min(1),
});

function getCache<T>(key: string): T | null {
  const row = db.prepare('SELECT payload, expires_at FROM cache_entries WHERE cache_key = ?').get(key) as
    | { payload: string; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at <= nowEpoch()) {
    db.prepare('DELETE FROM cache_entries WHERE cache_key = ?').run(key);
    return null;
  }
  return JSON.parse(row.payload) as T;
}

function setCache<T>(key: string, value: T, ttlSeconds: number): void {
  db.prepare(
    'INSERT OR REPLACE INTO cache_entries(cache_key, payload, expires_at) VALUES(?, ?, ?)'
  ).run(key, JSON.stringify(value), nowEpoch() + ttlSeconds);
}

async function fetchXtream(
  account: { server_url: string; username: string; password_enc: string },
  action: string,
  params: Record<string, string> = {}
) {
  const password = decryptSecret(account.password_enc);
  const query = new URLSearchParams({
    username: account.username,
    password,
    action,
    ...params,
  });

  const url = `${normalizeServerUrl(account.server_url)}/player_api.php?${query.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 IPTV-Web-Player',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Xtream request failed: ${response.status}`);
  }

  return response.json();
}

function getActionForCategories(type: ContentType): string {
  if (type === 'live') return 'get_live_categories';
  if (type === 'vod') return 'get_vod_categories';
  return 'get_series_categories';
}

function getActionForContent(type: ContentType): string {
  if (type === 'live') return 'get_live_streams';
  if (type === 'vod') return 'get_vod_streams';
  return 'get_series';
}

function getXtreamItemId(type: ContentType, entry: XtreamStream): string | null {
  const rawId = type === 'series' ? entry.series_id : entry.stream_id;
  if (rawId === undefined || rawId === null) return null;
  return String(rawId);
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): number {
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: number };
    return Number(value.offset ?? 0);
  } catch {
    return 0;
  }
}

function computePagination(total: number, offset: number, limit: number) {
  const nextOffset = offset + limit;
  const hasMore = nextOffset < total;
  return {
    total,
    limit,
    offset,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    nextCursor: hasMore ? encodeCursor(nextOffset) : null,
  };
}

app.post('/api/auth/register', async (request, reply) => {
  const parsed = registerSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(parsed.data.email);
  if (existing) {
    return reply.code(409).send({ message: 'Email already exists' });
  }

  const passwordHash = hashPassword(parsed.data.password);
  const result = db
    .prepare('INSERT INTO users(email, password_hash, created_at) VALUES (?, ?, ?)')
    .run(parsed.data.email, passwordHash, nowEpoch());

  const token = await reply.jwtSign({ userId: result.lastInsertRowid, email: parsed.data.email });
  return { token };
});

app.post('/api/auth/login', async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const user = db
    .prepare('SELECT id, email, password_hash FROM users WHERE email = ?')
    .get(parsed.data.email) as { id: number; email: string; password_hash: string } | undefined;

  if (!user || !verifyPassword(parsed.data.password, user.password_hash)) {
    return reply.code(401).send({ message: 'Invalid credentials' });
  }

  const token = await reply.jwtSign({ userId: user.id, email: user.email });
  return { token };
});

app.get('/api/auth/me', { preHandler: [app.authenticate] }, async (request: any) => {
  return { user: { id: request.user.userId, email: request.user.email } };
});

app.post('/api/iptv/accounts', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const parsed = addAccountSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const result = db
    .prepare(
      `INSERT INTO iptv_accounts(user_id, name, server_url, username, password_enc, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      request.user.userId,
      parsed.data.name,
      normalizeServerUrl(parsed.data.serverUrl),
      parsed.data.username,
      encryptSecret(parsed.data.password),
      nowEpoch()
    );

  return { accountId: result.lastInsertRowid };
});

app.get('/api/iptv/accounts', { preHandler: [app.authenticate] }, async (request: any) => {
  const rows = db
    .prepare('SELECT id, name, server_url, username, created_at FROM iptv_accounts WHERE user_id = ? ORDER BY id DESC')
    .all(request.user.userId);
  return { items: rows };
});

app.get('/api/favorites', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const rows = db
    .prepare('SELECT item_id FROM favorites WHERE user_id = ? AND account_id = ? AND type = ? ORDER BY id DESC')
    .all(request.user.userId, parsed.data.accountId, parsed.data.type) as { item_id: string }[];

  return { items: rows.map((row) => row.item_id) };
});

app.post('/api/favorites', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const bodySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
    itemId: z.string().min(1),
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  db.prepare(
    `INSERT OR IGNORE INTO favorites(user_id, account_id, type, item_id, created_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(request.user.userId, parsed.data.accountId, parsed.data.type, parsed.data.itemId, nowEpoch());

  return { ok: true };
});

app.delete('/api/favorites', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const bodySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
    itemId: z.string().min(1),
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  db.prepare('DELETE FROM favorites WHERE user_id = ? AND account_id = ? AND type = ? AND item_id = ?').run(
    request.user.userId,
    parsed.data.accountId,
    parsed.data.type,
    parsed.data.itemId
  );

  return { ok: true };
});

// ── Watch Progress ──────────────────────────────────────────────────────────

app.post('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const bodySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['vod', 'series_episode']),
    itemId: z.string().min(1),
    seriesId: z.string().optional(),
    seasonNumber: z.coerce.number().int().min(1).optional(),
    episodeNumber: z.coerce.number().int().min(1).optional(),
    currentTime: z.coerce.number().min(0),
    totalDuration: z.coerce.number().min(0),
    isWatched: z.boolean().optional(),
    needsTranscode: z.boolean().optional(),
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const remaining =
    parsed.data.totalDuration > 0 ? parsed.data.totalDuration - parsed.data.currentTime : Infinity;
  const autoWatched = parsed.data.totalDuration > 0 && remaining <= 10 ? 1 : 0;
  const isWatched = parsed.data.isWatched === true ? 1 : autoWatched;
  const needsTranscode = parsed.data.needsTranscode === true ? 1 : 0;

  db.prepare(`
    INSERT INTO watch_progress(user_id, account_id, type, item_id, series_id, season_number, episode_number, current_time, total_duration, is_watched, needs_transcode, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, account_id, type, item_id) DO UPDATE SET
      current_time = excluded.current_time,
      total_duration = CASE
        WHEN excluded.total_duration > 0 THEN excluded.total_duration
        ELSE watch_progress.total_duration
      END,
      is_watched = MAX(watch_progress.is_watched, excluded.is_watched),
      needs_transcode = MAX(watch_progress.needs_transcode, excluded.needs_transcode),
      series_id = COALESCE(excluded.series_id, watch_progress.series_id),
      season_number = COALESCE(excluded.season_number, watch_progress.season_number),
      episode_number = COALESCE(excluded.episode_number, watch_progress.episode_number),
      updated_at = excluded.updated_at
  `).run(
    request.user.userId,
    parsed.data.accountId,
    parsed.data.type,
    parsed.data.itemId,
    parsed.data.seriesId ?? null,
    parsed.data.seasonNumber ?? null,
    parsed.data.episodeNumber ?? null,
    parsed.data.currentTime,
    parsed.data.totalDuration,
    isWatched,
    needsTranscode,
    nowEpoch()
  );

  return { ok: true };
});

app.get('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['vod', 'series_episode']),
    itemIds: z.string().optional(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const itemIds = parsed.data.itemIds
    ? parsed.data.itemIds.split(',').map((id) => id.trim()).filter(Boolean).slice(0, 200)
    : [];

  if (itemIds.length === 0) {
    return { items: [] };
  }

  const placeholders = itemIds.map(() => '?').join(',');
  const rows = db
    .prepare(
      `SELECT item_id, current_time, total_duration, is_watched, needs_transcode, updated_at
       FROM watch_progress
       WHERE user_id = ? AND account_id = ? AND type = ? AND item_id IN (${placeholders})`
    )
    .all(request.user.userId, parsed.data.accountId, parsed.data.type, ...itemIds) as Array<{
      item_id: string;
      current_time: number;
      total_duration: number;
      is_watched: number;
      needs_transcode: number;
      updated_at: number;
    }>;

  return {
    items: rows.map((row) => ({
      itemId: row.item_id,
      currentTime: row.current_time,
      totalDuration: row.total_duration,
      isWatched: row.is_watched === 1,
      needsTranscode: row.needs_transcode === 1,
      updatedAt: row.updated_at,
    })),
  };
});

app.get('/api/progress/series', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    seriesId: z.string().min(1),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const rows = db
    .prepare(
      `SELECT item_id, current_time, total_duration, is_watched, needs_transcode, season_number, episode_number, updated_at
       FROM watch_progress
       WHERE user_id = ? AND account_id = ? AND series_id = ?
       ORDER BY updated_at DESC`
    )
    .all(request.user.userId, parsed.data.accountId, parsed.data.seriesId) as Array<{
      item_id: string;
      current_time: number;
      total_duration: number;
      is_watched: number;
      needs_transcode: number;
      season_number: number | null;
      episode_number: number | null;
      updated_at: number;
    }>;

  if (rows.length === 0) {
    return { lastEpisode: null, watchedEpisodeIds: [] };
  }

  const lastRow = rows[0];
  const watchedEpisodeIds = rows.filter((row) => row.is_watched === 1).map((row) => row.item_id);

  return {
    lastEpisode: {
      episodeId: lastRow.item_id,
      seasonNumber: lastRow.season_number,
      episodeNumber: lastRow.episode_number,
      currentTime: lastRow.current_time,
      totalDuration: lastRow.total_duration,
      isWatched: lastRow.is_watched === 1,
      needsTranscode: lastRow.needs_transcode === 1,
    },
    watchedEpisodeIds,
  };
});

app.delete('/api/progress', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const bodySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['vod', 'series_episode']),
    itemId: z.string().min(1),
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const account = db
    .prepare('SELECT id FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as { id: number } | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  db.prepare(
    'DELETE FROM watch_progress WHERE user_id = ? AND account_id = ? AND type = ? AND item_id = ?'
  ).run(request.user.userId, parsed.data.accountId, parsed.data.type, parsed.data.itemId);

  return { ok: true };
});

// ── User Preferences ─────────────────────────────────────────────────────────

app.get('/api/preferences', { preHandler: [app.authenticate] }, async (request: any) => {
  const row = db
    .prepare('SELECT autoplay, language FROM user_preferences WHERE user_id = ?')
    .get(request.user.userId) as { autoplay: number; language: string } | undefined;

  return {
    autoplay: row ? row.autoplay === 1 : true,
    language: row?.language ?? 'fr',
  };
});

app.put('/api/preferences', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const bodySchema = z.object({
    autoplay: z.boolean().optional(),
    language: z.string().min(2).max(5).optional(),
  });

  const parsed = bodySchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid payload' });
  }

  const existing = db
    .prepare('SELECT autoplay, language FROM user_preferences WHERE user_id = ?')
    .get(request.user.userId) as { autoplay: number; language: string } | undefined;

  const autoplay =
    parsed.data.autoplay !== undefined
      ? parsed.data.autoplay ? 1 : 0
      : (existing?.autoplay ?? 1);
  const language = parsed.data.language ?? existing?.language ?? 'fr';

  db.prepare(`
    INSERT INTO user_preferences(user_id, autoplay, language, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      autoplay = excluded.autoplay,
      language = excluded.language,
      updated_at = excluded.updated_at
  `).run(request.user.userId, autoplay, language, nowEpoch());

  return { ok: true };
});

// ── IPTV ─────────────────────────────────────────────────────────────────────

app.get('/api/iptv/categories', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const cacheKey = `cat:${account.id}:${parsed.data.type}`;
  let categories = getCache<XtreamCategory[]>(cacheKey);

  if (!categories) {
    const action = getActionForCategories(parsed.data.type);
    categories = (await fetchXtream(account, action)) as XtreamCategory[];
    setCache(cacheKey, categories, env.cacheTtlSeconds);
  }

  const mapped = [
    { id: 'favorites', name: 'Favoris' },
    { id: 'all', name: 'Tous' },
    ...categories.map((item) => ({ id: item.category_id, name: item.category_name })),
  ];

  return { items: mapped };
});

app.get('/api/iptv/content', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
    categoryId: z.string().optional().default('all'),
    search: z.string().optional().default(''),
    limit: z.coerce.number().int().min(1).max(100).optional().default(50),
    offset: z.coerce.number().int().min(0).optional().default(0),
    cursor: z.string().optional(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const scopedCategory = parsed.data.categoryId === 'all' || parsed.data.categoryId === 'favorites'
    ? 'all'
    : parsed.data.categoryId;
  const cacheKey = `cnt:${account.id}:${parsed.data.type}:${scopedCategory}`;
  let items = getCache<XtreamStream[]>(cacheKey);

  if (!items) {
    const action = getActionForContent(parsed.data.type);
    const actionParams: Record<string, string> = {};
    if (parsed.data.categoryId !== 'all' && parsed.data.categoryId !== 'favorites') {
      actionParams.category_id = parsed.data.categoryId;
    }

    items = (await fetchXtream(account, action, actionParams)) as XtreamStream[];
    setCache(cacheKey, items, env.cacheTtlSeconds);
  }

  const search = parsed.data.search.trim().toLowerCase();
  const categoryId = parsed.data.categoryId;
  const favoriteIds = categoryId === 'favorites'
    ? new Set(
      (
        db
          .prepare('SELECT item_id FROM favorites WHERE user_id = ? AND account_id = ? AND type = ?')
          .all(request.user.userId, account.id, parsed.data.type) as { item_id: string }[]
      ).map((row) => row.item_id)
    )
    : null;

  const filtered = items.filter((entry) => {
    const entryCategory = String(entry.category_id ?? '');
    const itemId = getXtreamItemId(parsed.data.type, entry);
    const categoryMatch = categoryId === 'favorites'
      ? !!itemId && favoriteIds?.has(itemId)
      : categoryId === 'all' || entryCategory === categoryId;
    if (!categoryMatch) return false;

    if (!search) return true;
    const title = (entry.name ?? entry.title ?? '').toLowerCase();
    return title.includes(search);
  });

  const resolvedOffset = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : parsed.data.offset;
  const paged = filtered.slice(resolvedOffset, resolvedOffset + parsed.data.limit);
  const pagination = computePagination(filtered.length, resolvedOffset, parsed.data.limit);

  const mapped = paged.map((entry) => ({
    id: String(entry.stream_id ?? entry.series_id ?? ''),
    title: entry.name ?? entry.title ?? 'Untitled',
    categoryId: String(entry.category_id ?? ''),
    poster: entry.stream_icon ?? entry.cover ?? null,
    description: entry.plot ?? null,
    genre: (entry as any).genre ?? null,
    year: entry.year ?? (entry.release_date ? String(entry.release_date).slice(0, 4) : null),
    epgChannelId: entry.epg_channel_id ?? null,
    hasArchive:
      String(entry.tv_archive ?? '0') === '1' || Number(entry.tv_archive_duration ?? 0) > 0,
    archiveDurationHours: Number(entry.tv_archive_duration ?? 0) || null,
    rating: entry.rating ?? null,
    duration: entry.duration ?? null,
    durationSeconds: Number(entry.duration_secs ?? 0) > 0 ? Number(entry.duration_secs) : null,
    containerExtension: entry.container_extension ?? null,
    streamId: entry.stream_id ?? null,
    seriesId: entry.series_id ?? null,
  }));

  return {
    items: mapped,
    pagination,
  };
});

app.get('/api/iptv/epg', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    streamId: z.coerce.number().int().positive(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const data = (await fetchXtream(account, 'get_simple_data_table', {
    stream_id: String(parsed.data.streamId),
  })) as {
    epg_listings?: Array<{
      title?: string;
      description?: string;
      start?: string;
      end?: string;
      start_timestamp?: number;
      stop_timestamp?: number;
    }>;
  };

  const items = (data.epg_listings ?? []).map((entry) => ({
    title: entry.title ? Buffer.from(entry.title, 'base64').toString('utf8') : '',
    description: entry.description ? Buffer.from(entry.description, 'base64').toString('utf8') : '',
    start: entry.start,
    end: entry.end,
    startTimestamp: entry.start_timestamp,
    stopTimestamp: entry.stop_timestamp,
  }));

  return { items };
});

app.get('/api/iptv/series-info', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    seriesId: z.coerce.number().int().positive(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const cacheKey = `series:${account.id}:${parsed.data.seriesId}`;
  let seriesData = getCache<XtreamSeriesInfoResponse>(cacheKey);

  if (!seriesData) {
    seriesData = (await fetchXtream(account, 'get_series_info', {
      series_id: String(parsed.data.seriesId),
    })) as XtreamSeriesInfoResponse;
    setCache(cacheKey, seriesData, env.cacheTtlSeconds);
  }

  const seasonsMap = seriesData.episodes ?? {};
  const seasons = Object.keys(seasonsMap)
    .map((seasonKey) => Number(seasonKey))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)
    .map((seasonNumber) => ({
      seasonNumber,
      episodeCount: (seasonsMap[String(seasonNumber)] ?? []).length,
    }));

  const episodesBySeason: Record<string, Array<{
    id: number;
    title: string;
    episodeNumber: number;
    seasonNumber: number;
    containerExtension: string;
    duration: string | null;
    durationSeconds: number | null;
    poster: string | null;
    rating: number | null;
    airDate: string | null;
  }>> = {};

  for (const [seasonKey, episodes] of Object.entries(seasonsMap)) {
    episodesBySeason[seasonKey] = (episodes ?? []).map((episode) => ({
      id: Number(episode.id ?? 0),
      title: episode.title ?? `Episode ${episode.episode_num ?? '?'}`,
      episodeNumber: Number(episode.episode_num ?? 0),
      seasonNumber: Number(episode.season ?? seasonKey),
      containerExtension: episode.container_extension ?? 'mp4',
      duration: episode.info?.duration ?? null,
      durationSeconds: episode.info?.duration_secs ?? null,
      poster: episode.info?.movie_image ?? null,
      rating: typeof episode.info?.rating === 'number' ? episode.info.rating : null,
      airDate: episode.info?.air_date ?? null,
    }));
  }

  return {
    info: {
      name: seriesData.info?.name ?? 'Série',
      cover: seriesData.info?.cover ?? null,
      plot: seriesData.info?.plot ?? null,
      cast: seriesData.info?.cast ?? null,
      director: seriesData.info?.director ?? null,
      genre: seriesData.info?.genre ?? null,
      releaseDate: seriesData.info?.releaseDate ?? null,
      rating: seriesData.info?.rating ?? null,
      rating5Based: seriesData.info?.rating_5based ?? null,
      episodeRunTime: seriesData.info?.episode_run_time ?? null,
      backdropPath: seriesData.info?.backdrop_path ?? [],
    },
    seasons,
    episodesBySeason,
  };
});

app.get('/api/iptv/stream-url', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
    streamId: z.coerce.number().int().positive(),
    containerExtension: z.string().min(2).max(8).optional(),
    mediaTitle: z.string().max(180).optional(),
    seriesTitle: z.string().max(180).optional(),
    seasonNumber: z.coerce.number().int().min(1).max(100).optional(),
    episodeNumber: z.coerce.number().int().min(1).max(10000).optional(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const password = decryptSecret(account.password_enc);
  const extension =
    parsed.data.containerExtension ?? (parsed.data.type === 'live' ? 'm3u8' : 'mp4');
  const pathType = parsed.data.type === 'live' ? 'live' : parsed.data.type === 'vod' ? 'movie' : 'series';
  const url = `${normalizeServerUrl(account.server_url)}/${pathType}/${account.username}/${password}/${parsed.data.streamId}.${extension}`;

  logPlaybackTrace({
    route: 'stream-url',
    mode: 'direct',
    accountId: parsed.data.accountId,
    mediaType: parsed.data.type,
    streamId: parsed.data.streamId,
    extension,
    mediaTitle: parsed.data.mediaTitle,
    seriesTitle: parsed.data.seriesTitle,
    seasonNumber: parsed.data.seasonNumber,
    episodeNumber: parsed.data.episodeNumber,
    note: 'url_generated',
  });

  return { url };
});

app.get('/api/iptv/stream-proxy', async (request: any, reply) => {
  const querySchema = z.object({
    token: z.string().min(10),
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
    streamId: z.coerce.number().int().positive(),
    containerExtension: z.string().min(2).max(8).optional(),
    mediaTitle: z.string().max(180).optional(),
    seriesTitle: z.string().max(180).optional(),
    seasonNumber: z.coerce.number().int().min(1).max(100).optional(),
    episodeNumber: z.coerce.number().int().min(1).max(10000).optional(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  let payload: { userId?: number };
  try {
    payload = (await app.jwt.verify(parsed.data.token)) as { userId?: number };
  } catch {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  const userId = Number(payload.userId ?? 0);
  if (!userId) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const password = decryptSecret(account.password_enc);
  const extension = parsed.data.containerExtension ?? (parsed.data.type === 'live' ? 'm3u8' : 'mp4');
  const pathType = parsed.data.type === 'live' ? 'live' : parsed.data.type === 'vod' ? 'movie' : 'series';
  const sourceUrl = `${normalizeServerUrl(account.server_url)}/${pathType}/${account.username}/${password}/${parsed.data.streamId}.${extension}`;

  const incomingRange = request.headers.range;
  const buildHeaders = (includeRange: boolean) => ({
    'User-Agent': 'Mozilla/5.0 IPTV-Web-Player',
    Referer: normalizeServerUrl(account.server_url),
    ...(includeRange && incomingRange ? { Range: String(incomingRange) } : {}),
  });

  const fetchWithTimeout = async (includeRange: boolean) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), env.streamProxyTimeoutMs);
    try {
      return await fetch(sourceUrl, {
        headers: buildHeaders(includeRange),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let upstream: Response;
  try {
    upstream = await fetchWithTimeout(true);
  } catch (error: any) {
    const note = error?.name === 'AbortError' ? 'proxy_timeout' : 'proxy_network_error';
    logPlaybackTrace({
      route: 'stream-proxy',
      mode: 'proxy',
      accountId: parsed.data.accountId,
      mediaType: parsed.data.type,
      streamId: parsed.data.streamId,
      extension,
      mediaTitle: parsed.data.mediaTitle,
      seriesTitle: parsed.data.seriesTitle,
      seasonNumber: parsed.data.seasonNumber,
      episodeNumber: parsed.data.episodeNumber,
      note,
    });
    return reply.code(504).send({ message: 'Upstream stream timeout' });
  }

  let fallbackWithoutRange = false;

  if ((upstream.status === 405 || upstream.status === 416) && incomingRange) {
    fallbackWithoutRange = true;
    try {
      upstream = await fetchWithTimeout(false);
    } catch (error: any) {
      const note = error?.name === 'AbortError' ? 'proxy_timeout_after_range_fallback' : 'proxy_network_error_after_range_fallback';
      logPlaybackTrace({
        route: 'stream-proxy',
        mode: 'proxy',
        accountId: parsed.data.accountId,
        mediaType: parsed.data.type,
        streamId: parsed.data.streamId,
        extension,
        mediaTitle: parsed.data.mediaTitle,
        seriesTitle: parsed.data.seriesTitle,
        seasonNumber: parsed.data.seasonNumber,
        episodeNumber: parsed.data.episodeNumber,
        fallbackWithoutRange,
        note,
      });
      return reply.code(504).send({ message: 'Upstream stream timeout' });
    }
  }

  logPlaybackTrace({
    route: 'stream-proxy',
    mode: 'proxy',
    accountId: parsed.data.accountId,
    mediaType: parsed.data.type,
    streamId: parsed.data.streamId,
    extension,
    mediaTitle: parsed.data.mediaTitle,
    seriesTitle: parsed.data.seriesTitle,
    seasonNumber: parsed.data.seasonNumber,
    episodeNumber: parsed.data.episodeNumber,
    upstreamStatus: upstream.status,
    fallbackWithoutRange,
    note: incomingRange ? 'range_request' : 'plain_request',
  });

  if (!upstream.ok && upstream.status !== 206) {
    return reply.code(upstream.status || 502).send({ message: 'Upstream stream rejected' });
  }

  const contentType = upstream.headers.get('content-type') ?? 'video/mp4';
  const contentLength = upstream.headers.get('content-length');
  const contentRange = upstream.headers.get('content-range');
  const acceptRanges = upstream.headers.get('accept-ranges');

  reply.hijack();
  reply.raw.statusCode = upstream.status;
  reply.raw.setHeader('Content-Type', contentType);
  reply.raw.setHeader('Cache-Control', 'no-store');

  if (contentLength) reply.raw.setHeader('Content-Length', contentLength);
  if (contentRange) reply.raw.setHeader('Content-Range', contentRange);
  if (acceptRanges) reply.raw.setHeader('Accept-Ranges', acceptRanges);

  if (!upstream.body) {
    reply.raw.end();
    return;
  }

  const nodeStream = Readable.fromWeb(upstream.body as any);
  request.raw.on('close', () => {
    nodeStream.destroy();
  });
  nodeStream.pipe(reply.raw);
});

app.get('/api/iptv/replay-url', { preHandler: [app.authenticate] }, async (request: any, reply) => {
  const querySchema = z.object({
    accountId: z.coerce.number().int().positive(),
    streamId: z.coerce.number().int().positive(),
    start: z.string().min(10),
    durationMinutes: z.coerce.number().int().min(1).max(24 * 60),
    containerExtension: z.string().min(2).max(8).optional().default('ts'),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, request.user.userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const password = decryptSecret(account.password_enc);

  const parseDate = (raw: string): Date | null => {
    const direct = new Date(raw);
    if (!Number.isNaN(direct.getTime())) return direct;

    const isoCandidate = raw.includes(' ') ? raw.replace(' ', 'T') : raw;
    const iso = new Date(isoCandidate);
    if (!Number.isNaN(iso.getTime())) return iso;

    return null;
  };

  const dt = parseDate(parsed.data.start);
  const normalizedStart = (() => {
    if (!dt) {
      return parsed.data.start;
    }

    const year = dt.getFullYear();
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    const hour = String(dt.getHours()).padStart(2, '0');
    const minute = String(dt.getMinutes()).padStart(2, '0');
    const second = String(dt.getSeconds()).padStart(2, '0');

    return `${year}-${month}-${day}:${hour}-${minute}-${second}`;
  })();

  const url = `${normalizeServerUrl(account.server_url)}/timeshift/${account.username}/${password}/${parsed.data.durationMinutes}/${normalizedStart}/${parsed.data.streamId}.${parsed.data.containerExtension}`;

  return { url };
});

app.get('/api/iptv/transcode', async (request: any, reply) => {
  const querySchema = z.object({
    token: z.string().min(10),
    accountId: z.coerce.number().int().positive(),
    type: z.enum(['live', 'vod', 'series']),
    streamId: z.coerce.number().int().positive(),
    seekSeconds: z.coerce.number().min(0).optional(),
    containerExtension: z.string().min(2).max(8).optional().default('mkv'),
    mediaTitle: z.string().max(180).optional(),
    seriesTitle: z.string().max(180).optional(),
    seasonNumber: z.coerce.number().int().min(1).max(100).optional(),
    episodeNumber: z.coerce.number().int().min(1).max(10000).optional(),
  });

  const parsed = querySchema.safeParse(request.query);
  if (!parsed.success) {
    return reply.code(400).send({ message: 'Invalid query' });
  }

  let payload: { userId?: number };
  try {
    payload = (await app.jwt.verify(parsed.data.token)) as { userId?: number };
  } catch {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  const userId = Number(payload.userId ?? 0);
  if (!userId) {
    return reply.code(401).send({ message: 'Unauthorized' });
  }

  const account = db
    .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
    .get(parsed.data.accountId, userId) as
    | { id: number; server_url: string; username: string; password_enc: string }
    | undefined;

  if (!account) {
    return reply.code(404).send({ message: 'Account not found' });
  }

  const password = decryptSecret(account.password_enc);
  const pathType = parsed.data.type === 'live' ? 'live' : parsed.data.type === 'vod' ? 'movie' : 'series';
  const sourceUrl = `${normalizeServerUrl(account.server_url)}/${pathType}/${account.username}/${password}/${parsed.data.streamId}.${parsed.data.containerExtension}`;
  const seekSeconds =
    typeof parsed.data.seekSeconds === 'number' && Number.isFinite(parsed.data.seekSeconds)
      ? Math.max(0, parsed.data.seekSeconds)
      : 0;

  const ffmpegArgs = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-fflags',
    '+genpts',
  ];

  if (seekSeconds > 0) {
    ffmpegArgs.push('-ss', seekSeconds.toFixed(3));
  }

  ffmpegArgs.push(
    '-i',
    sourceUrl,
    '-map',
    '0:v:0?',
    '-map',
    '0:a:0?',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '23',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ac',
    '2',
    '-b:a',
    '160k',
    '-movflags',
    'frag_keyframe+empty_moov+faststart',
    '-f',
    'mp4',
    'pipe:1',
  );

  const ffmpeg = spawn('ffmpeg', ffmpegArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  logPlaybackTrace({
    route: 'transcode',
    mode: 'transcode',
    accountId: parsed.data.accountId,
    mediaType: parsed.data.type,
    streamId: parsed.data.streamId,
    extension: parsed.data.containerExtension,
    mediaTitle: parsed.data.mediaTitle,
    seriesTitle: parsed.data.seriesTitle,
    seasonNumber: parsed.data.seasonNumber,
    episodeNumber: parsed.data.episodeNumber,
    note: seekSeconds > 0 ? `ffmpeg_start_seek_${seekSeconds.toFixed(3)}` : 'ffmpeg_start',
  });

  let started = false;

  ffmpeg.stdout.once('data', () => {
    started = true;
  });

  ffmpeg.stderr.on('data', (chunk) => {
    const message = String(chunk).trim();
    if (message) {
      app.log.warn({ message }, 'ffmpeg transcode');
    }
  });

  ffmpeg.on('error', () => {
    if (!reply.raw.headersSent) {
      reply.code(500).send({ message: 'FFmpeg not available on server' });
      return;
    }

    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  });

  ffmpeg.on('close', (code) => {
    logPlaybackTrace({
      route: 'transcode',
      mode: 'transcode',
      accountId: parsed.data.accountId,
      mediaType: parsed.data.type,
      streamId: parsed.data.streamId,
      extension: parsed.data.containerExtension,
      mediaTitle: parsed.data.mediaTitle,
      seriesTitle: parsed.data.seriesTitle,
      seasonNumber: parsed.data.seasonNumber,
      episodeNumber: parsed.data.episodeNumber,
      note: `ffmpeg_close_${code ?? 'unknown'}`,
    });

    if (!started && !reply.raw.headersSent) {
      reply.code(502).send({ message: `Transcoding failed (${code ?? 'unknown'})` });
      return;
    }

    if (!reply.raw.writableEnded) {
      reply.raw.end();
    }
  });

  request.raw.on('close', () => {
    if (!ffmpeg.killed) {
      ffmpeg.kill('SIGKILL');
    }
  });

  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader('Content-Type', 'video/mp4');
  reply.raw.setHeader('Cache-Control', 'no-store');
  ffmpeg.stdout.pipe(reply.raw);
});

app.get('/health', async () => ({ ok: true }));

app.listen({ host: env.host, port: env.port }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
