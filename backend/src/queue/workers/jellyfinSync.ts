import { env, jellyfinConfigured } from '../../config.js';
import { queryAll, queryOne, execute, nowEpoch } from '../../db.js';
import { delCachePrefix, cacheKey } from '../../redis.js';
import { getProvider } from '../../sources/index.js';
import type { MediaSourceRow, ContentItem } from '../../types.js';

export type JellyfinSyncJobData = { reason: 'periodic' | 'import' | 'manual' };

async function refreshJellyfinLibrary(): Promise<void> {
  try {
    await fetch(`${env.jellyfinUrl}/Library/Refresh?api_key=${encodeURIComponent(env.jellyfinApiKey)}`, {
      method: 'POST',
    });
  } catch (error) {
    console.warn('[jellyfin-sync] Library/Refresh call failed', (error as Error).message);
  }
}

/** Reconciles open media_requests against a freshly-synced Jellyfin catalog by TMDB id. */
async function reconcileRequests(items: ContentItem[]): Promise<void> {
  const byTmdbId = new Map<number, string>();
  for (const item of items) {
    if (item.tmdbId) byTmdbId.set(item.tmdbId, item.itemId);
  }
  if (byTmdbId.size === 0) return;

  const openRequests = await queryAll<{ id: number; tmdb_id: number }>(
    "SELECT id, tmdb_id FROM media_requests WHERE status IN ('added','downloading','imported')"
  );

  for (const request of openRequests) {
    const jellyfinItemId = byTmdbId.get(request.tmdb_id);
    if (!jellyfinItemId) continue;

    await execute(
      'UPDATE media_requests SET status = ?, jellyfin_item_id = ?, updated_at = ? WHERE id = ?',
      ['available', jellyfinItemId, nowEpoch(), request.id]
    );
  }
}

export async function processJellyfinSync(data: JellyfinSyncJobData): Promise<void> {
  if (!jellyfinConfigured) return;

  if (data.reason === 'import') {
    await refreshJellyfinLibrary();
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }

  const sources = await queryAll<MediaSourceRow>(
    "SELECT id, user_id, kind, name, server_url, username, secret_enc FROM media_sources WHERE kind = 'jellyfin'"
  );

  const provider = getProvider('jellyfin');
  const allItems: ContentItem[] = [];

  for (const source of sources) {
    // Force a re-fetch instead of trusting whatever's still cached.
    await delCachePrefix(cacheKey('jf', 'items', source.id));
    await delCachePrefix(cacheKey('jf', 'libs', source.id));

    for (const type of ['vod', 'series'] as const) {
      const items = await provider.listContent(source, type, 'all');
      allItems.push(...items);
    }
  }

  await reconcileRequests(allItems);
}
