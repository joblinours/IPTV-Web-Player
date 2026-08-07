import { queryAll, queryOne, execute, nowEpoch } from '../../db.js';
import { arrGet } from '../../radarrSonarr.js';
import { enqueueJellyfinSync } from '../index.js';

export type WebhookJobData = {
  service: 'radarr' | 'sonarr';
  body: Record<string, any>;
};

type MediaRequestRow = {
  id: number;
  service: 'radarr' | 'sonarr';
  service_item_id: number | null;
  tmdb_id: number;
  tvdb_id: number | null;
  status: string;
};

async function findRequest(service: 'radarr' | 'sonarr', body: Record<string, any>): Promise<MediaRequestRow | undefined> {
  const remoteId: number | undefined = body.movie?.id ?? body.series?.id;
  if (remoteId) {
    const byRemoteId = await queryOne<MediaRequestRow>(
      'SELECT id, service, service_item_id, tmdb_id, tvdb_id, status FROM media_requests WHERE service = ? AND service_item_id = ?',
      [service, remoteId]
    );
    if (byRemoteId) return byRemoteId;
  }

  // Fallback: a Grab can arrive before the POST /movie response finished
  // persisting service_item_id, so also try matching on the external id.
  if (service === 'radarr' && body.movie?.tmdbId) {
    return queryOne<MediaRequestRow>(
      "SELECT id, service, service_item_id, tmdb_id, tvdb_id, status FROM media_requests WHERE media_type = 'movie' AND tmdb_id = ?",
      [body.movie.tmdbId]
    );
  }
  if (service === 'sonarr' && body.series?.tvdbId) {
    return queryOne<MediaRequestRow>(
      "SELECT id, service, service_item_id, tmdb_id, tvdb_id, status FROM media_requests WHERE media_type = 'tv' AND tvdb_id = ?",
      [body.series.tvdbId]
    );
  }
  return undefined;
}

export async function processWebhook(data: WebhookJobData): Promise<void> {
  const { service, body } = data;
  const eventType = body.eventType as string | undefined;
  if (!eventType || eventType === 'Test') return;

  const request = await findRequest(service, body);
  if (!request) return;

  const remoteId: number | undefined = body.movie?.id ?? body.series?.id;

  let nextStatus: string | null = null;
  switch (eventType) {
    case 'MovieAdded':
      nextStatus = 'added';
      break;
    case 'Grab':
      nextStatus = 'downloading';
      break;
    case 'Download':
      nextStatus = 'imported';
      break;
    case 'MovieDelete':
    case 'MovieFileDelete':
    case 'SeriesDelete':
    case 'EpisodeFileDelete':
      nextStatus = 'added';
      break;
    default:
      return; // Health/ApplicationUpdate/Rename/etc — log-only, no state change.
  }

  await execute(
    'UPDATE media_requests SET status = ?, service_item_id = COALESCE(service_item_id, ?), updated_at = ? WHERE id = ?',
    [nextStatus, remoteId ?? null, nowEpoch(), request.id]
  );

  if (nextStatus === 'imported') {
    await enqueueJellyfinSync('import', 30_000);
  }
}

/** Safety net: reconciles every open request every 5 minutes, in case a webhook was never configured or was dropped. */
export async function processPollStatus(): Promise<void> {
  const openRequests = await queryAll<MediaRequestRow>(
    "SELECT id, service, service_item_id, tmdb_id, tvdb_id, status FROM media_requests WHERE status IN ('pending','added','downloading') LIMIT 100"
  );

  for (const request of openRequests) {
    if (!request.service_item_id) continue;

    if (request.service === 'radarr') {
      const movie = await arrGet<{ hasFile?: boolean; movieFile?: unknown }>(
        'radarr',
        `/api/v3/movie/${request.service_item_id}`
      );
      if (movie?.hasFile) {
        await execute('UPDATE media_requests SET status = ?, updated_at = ? WHERE id = ?', [
          'imported',
          nowEpoch(),
          request.id,
        ]);
      }
    } else {
      const series = await arrGet<{ statistics?: { episodeFileCount?: number } }>(
        'sonarr',
        `/api/v3/series/${request.service_item_id}`
      );
      if ((series?.statistics?.episodeFileCount ?? 0) > 0 && request.status !== 'imported') {
        await execute('UPDATE media_requests SET status = ?, updated_at = ? WHERE id = ?', [
          'imported',
          nowEpoch(),
          request.id,
        ]);
      }
    }
  }
}
