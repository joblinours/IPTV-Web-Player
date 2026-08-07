import crypto from 'node:crypto';
import { queryOne, queryAll, execute, nowEpoch } from '../db.js';
import { encryptSecret } from '../crypto.js';
import { env, jellyfinConfigured } from '../config.js';
import type { CategoryItem, ContentType, EpgItem, SeriesInfoResponse } from '../types.js';
import type { ContentItem, MediaSourceRow, PlaybackTarget, SourceKind } from '../types.js';
import { xtreamProvider } from './xtream.js';
import { jellyfinProvider } from './jellyfin.js';

export type { ContentItem, MediaSourceRow, PlaybackTarget, SourceKind };

export interface ContentProvider {
  listCategories(src: MediaSourceRow, type: ContentType): Promise<CategoryItem[]>;
  listContent(src: MediaSourceRow, type: ContentType, categoryId: string): Promise<ContentItem[]>;
  getSeriesInfo(src: MediaSourceRow, seriesId: string): Promise<SeriesInfoResponse>;
  getEpg?(src: MediaSourceRow, itemId: string): Promise<EpgItem[]>;
  buildPlayback(
    src: MediaSourceRow,
    req: { type: ContentType; itemId: string; containerExtension?: string }
  ): Promise<PlaybackTarget[]>;
  supportsTimeshift: boolean;
}

const providers: Record<SourceKind, ContentProvider> = {
  xtream: xtreamProvider,
  jellyfin: jellyfinProvider,
};

export function getProvider(kind: SourceKind): ContentProvider {
  return providers[kind];
}

export async function loadSource(userId: number, sourceId: number): Promise<MediaSourceRow | undefined> {
  return queryOne<MediaSourceRow>(
    'SELECT id, user_id, kind, name, server_url, username, secret_enc FROM media_sources WHERE id = ? AND user_id = ?',
    [sourceId, userId]
  );
}

/**
 * Every media_sources row a user owns — the fan-out base for the merged
 * catalog view (routes/catalog.ts) that folds Xtream and Jellyfin content
 * into a single browsing surface instead of requiring an account switch.
 */
export async function loadAllSources(userId: number): Promise<MediaSourceRow[]> {
  return queryAll<MediaSourceRow>(
    'SELECT id, user_id, kind, name, server_url, username, secret_enc FROM media_sources WHERE user_id = ? ORDER BY id ASC',
    [userId]
  );
}

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Auto-provisions a single "Jellyfin" media_sources row per user, so a
 * Jellyfin library can be browsed through the exact same accountId-based
 * routes as an Xtream account. No-op when JELLYFIN_URL/JELLYFIN_API_KEY
 * aren't set — this is what feature-gates the whole integration.
 */
export async function ensureJellyfinSource(userId: number): Promise<void> {
  if (!jellyfinConfigured) return;

  const sourceKey = sha256hex('jellyfin');
  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM media_sources WHERE user_id = ? AND source_key = ?',
    [userId, sourceKey]
  );
  if (existing) return;

  const now = nowEpoch();
  await execute(
    `INSERT INTO media_sources(user_id, kind, name, server_url, username, secret_enc, source_key, created_at, updated_at)
     VALUES (?, 'jellyfin', 'Jellyfin', ?, '', ?, ?, ?, ?)`,
    [userId, env.jellyfinUrl, encryptSecret(env.jellyfinApiKey), sourceKey, now, now]
  );
}
