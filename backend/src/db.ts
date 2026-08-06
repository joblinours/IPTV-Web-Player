import Database from 'better-sqlite3';
import { env } from './config.js';

export const db = new Database(env.dbPath);

export function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

export function initDb() {
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

  // Migration: add needs_transcode column if it doesn't exist yet (safe on fresh DB too)
  try {
    db.exec(`ALTER TABLE watch_progress ADD COLUMN needs_transcode INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column already exists */
  }
}

/** Generic TTL-backed cache, shared by Xtream catalog lookups and TMDB matches. */
export function getCache<T>(key: string): T | null {
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

export function setCache<T>(key: string, value: T, ttlSeconds: number): void {
  db.prepare(
    'INSERT OR REPLACE INTO cache_entries(cache_key, payload, expires_at) VALUES(?, ?, ?)'
  ).run(key, JSON.stringify(value), nowEpoch() + ttlSeconds);
}
