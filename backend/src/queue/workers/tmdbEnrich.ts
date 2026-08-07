import { resolveTmdbMatchByTitle } from '../../tmdb.js';

export type TmdbEnrichJobData = { title: string; type: 'movie' | 'tv'; year?: string };

/**
 * Background counterpart of the synchronous /api/tmdb/match lookup —
 * queued by POST /api/tmdb/match-batch on a cache miss so the batch
 * response never blocks on a live TMDB call. resolveTmdbMatchByTitle
 * already persists to tmdb_matches/Redis as a side effect; this worker
 * doesn't need to do anything with the return value itself, the next
 * batch/single lookup for the same title will simply find it cached.
 */
export async function processTmdbEnrich(data: TmdbEnrichJobData): Promise<void> {
  await resolveTmdbMatchByTitle(data.title, data.type, data.year);
}
