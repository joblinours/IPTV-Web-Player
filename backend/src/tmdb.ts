// TMDB service layer (as opposed to routes/tmdb.ts, the HTTP handlers) —
// mirrors the radarrSonarr.ts pattern of keeping reusable service logic at
// the top level so non-route modules (sources/jellyfin.ts in particular)
// can depend on it without importing from routes/, which only ever flows
// the other way in this codebase.
import crypto from 'node:crypto';
import { env } from './config.js';
import { getCache, setCache, cacheKey } from './redis.js';
import { queryOne, execute, nowEpoch } from './db.js';
import { canonicalGenreSlug, genreNameForSlug, type CanonicalGenre } from './lib/genres.js';

export const TMDB_API_BASE = 'https://api.themoviedb.org/3';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

export function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

type TmdbDetails = {
  genres?: Array<{ id: number; name: string }>;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  title?: string;
  name?: string;
};

export type TmdbGenreResult = { genres: CanonicalGenre[] };

export type TmdbMatch = {
  enabled: true;
  id: number;
  title: string;
  overview: string | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  rating: number | null;
  releaseDate: string | null;
};

type TmdbMatchRow = {
  matched: number;
  tmdb_id: number | null;
  title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  rating: number | null;
  release_date: string | null;
};

type TmdbSearchResult = {
  id: number;
  title?: string;
  name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
};

function rowToMatch(row: TmdbMatchRow): TmdbMatch | { enabled: false } {
  if (!row.matched || !row.tmdb_id) return { enabled: false };
  return {
    enabled: true,
    id: row.tmdb_id,
    title: row.title ?? '',
    overview: row.overview,
    posterUrl: row.poster_path ? `${TMDB_IMAGE_BASE}${row.poster_path}` : null,
    backdropUrl: row.backdrop_path ? `${TMDB_IMAGE_BASE}${row.backdrop_path}` : null,
    rating: row.rating,
    releaseDate: row.release_date,
  };
}

// Same lookup_key namespace `/api/tmdb/match` has always used — exported so
// the batch endpoint (cache-only) and the background enrichment job (does
// the actual TMDB call) agree on the exact same key without duplicating the
// hashing logic.
export function titleMatchLookupKey(title: string, tmdbType: 'movie' | 'tv', year?: string): string {
  return sha256hex(`${tmdbType}|${title.trim().toLowerCase()}|${year ?? ''}`);
}

/**
 * Cache-only (Redis, then MySQL) lookup — never calls TMDB. Returns `null`
 * when nothing is cached yet, which callers (the match-batch endpoint) must
 * treat as "queue background resolution", never block a request on it.
 */
export async function getCachedTmdbMatch(lookupKey: string): Promise<TmdbMatch | { enabled: false } | null> {
  const redisKey = cacheKey('tmdb', 'match', lookupKey);
  const cached = await getCache<TmdbMatch | { enabled: false }>(redisKey);
  if (cached) return cached;

  const persisted = await queryOne<TmdbMatchRow>(
    'SELECT matched, tmdb_id, title, overview, poster_path, backdrop_path, rating, release_date FROM tmdb_matches WHERE lookup_key = ?',
    [lookupKey]
  );
  if (!persisted) return null;

  const result = rowToMatch(persisted);
  await setCache(redisKey, result, env.tmdbCacheTtlSeconds);
  return result;
}

/**
 * Full resolution by title: cache/DB first, then a live TMDB search as a
 * last resort — the only function in this module that actually calls
 * TMDB's `/search` endpoint. Used by the synchronous `/api/tmdb/match`
 * route (a single title, fine to block on) and by the background
 * enrichment job for `/api/tmdb/match-batch` cache misses (never called
 * from a request-handling code path directly).
 */
export async function resolveTmdbMatchByTitle(
  title: string,
  tmdbType: 'movie' | 'tv',
  year?: string
): Promise<TmdbMatch | { enabled: false }> {
  if (!env.tmdbApiKey) return { enabled: false };

  const lookupKey = titleMatchLookupKey(title, tmdbType, year);
  const cached = await getCachedTmdbMatch(lookupKey);
  if (cached) return cached;

  const searchParams = new URLSearchParams({
    api_key: env.tmdbApiKey,
    query: title,
    language: 'fr-FR',
    include_adult: 'false',
  });
  if (year) {
    searchParams.set(tmdbType === 'movie' ? 'primary_release_year' : 'first_air_date_year', year);
  }

  let result: TmdbMatch | { enabled: false };
  let best: TmdbSearchResult | undefined;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(`${TMDB_API_BASE}/search/${tmdbType}?${searchParams.toString()}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`TMDB request failed: ${response.status}`);

    const data = (await response.json()) as { results?: TmdbSearchResult[] };
    best = data.results?.[0];

    result = best
      ? {
          enabled: true,
          id: best.id,
          title: best.title ?? best.name ?? title,
          overview: best.overview || null,
          posterUrl: best.poster_path ? `${TMDB_IMAGE_BASE}${best.poster_path}` : null,
          backdropUrl: best.backdrop_path ? `${TMDB_IMAGE_BASE}${best.backdrop_path}` : null,
          rating: typeof best.vote_average === 'number' ? best.vote_average : null,
          releaseDate: best.release_date ?? best.first_air_date ?? null,
        }
      : { enabled: false };
  } catch {
    // Don't persist transient failures — only persist real "no match" results.
    return { enabled: false };
  }

  await execute(
    `INSERT INTO tmdb_matches(lookup_key, media_type, matched, tmdb_id, title, overview, poster_path, backdrop_path, rating, release_date, fetched_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
     ON DUPLICATE KEY UPDATE
       matched = new.matched, tmdb_id = new.tmdb_id, title = new.title, overview = new.overview,
       poster_path = new.poster_path, backdrop_path = new.backdrop_path, rating = new.rating,
       release_date = new.release_date, fetched_at = new.fetched_at`,
    [
      lookupKey,
      tmdbType,
      best ? 1 : 0,
      best?.id ?? null,
      best ? (best.title ?? best.name ?? title) : null,
      best?.overview ?? null,
      best?.poster_path ?? null,
      best?.backdrop_path ?? null,
      typeof best?.vote_average === 'number' ? best.vote_average : null,
      best?.release_date ?? best?.first_air_date ?? null,
      nowEpoch(),
    ]
  );

  const redisKey = cacheKey('tmdb', 'match', lookupKey);
  await setCache(redisKey, result, env.tmdbCacheTtlSeconds);
  return result;
}

/**
 * Resolves a Jellyfin/Xtream item's TMDB genres by tmdb id directly (no
 * fuzzy title matching needed — Jellyfin already knows the exact id via
 * ProviderIds.Tmdb). Used to categorize content by genre instead of
 * Jellyfin's own library name / Xtream's raw category (see
 * sources/jellyfin.ts, lib/genres.ts). Cached in the same `tmdb_matches`
 * table as the title-based `/api/tmdb/match` lookups, but under a distinct
 * `id|<type>|<tmdbId>` lookup_key namespace so the two never collide — and
 * the row it writes also carries poster/overview/rating, letting a later
 * enrichment pass reuse it without a second TMDB call.
 * Always resolves (never throws) — an unmatched/unavailable id resolves to
 * `{ genres: [] }`, which callers must treat as "keep the existing
 * category", never as an error.
 */
export async function resolveTmdbGenresById(tmdbId: number, mediaType: 'movie' | 'tv'): Promise<TmdbGenreResult> {
  const empty: TmdbGenreResult = { genres: [] };
  if (!env.tmdbApiKey || !tmdbId) return empty;

  const lookupKey = sha256hex(`id|${mediaType}|${tmdbId}`);
  const redisKey = cacheKey('tmdb', 'genres', lookupKey);

  const cached = await getCache<TmdbGenreResult>(redisKey);
  if (cached) return cached;

  const persisted = await queryOne<{ genres: string | null }>(
    'SELECT genres FROM tmdb_matches WHERE lookup_key = ?',
    [lookupKey]
  );
  if (persisted) {
    const result: TmdbGenreResult = {
      genres: (persisted.genres ?? '')
        .split(',')
        .filter(Boolean)
        .map((slug) => ({ slug, name: genreNameForSlug(slug) ?? slug })),
    };
    await setCache(redisKey, result, env.tmdbCacheTtlSeconds);
    return result;
  }

  try {
    const searchParams = new URLSearchParams({ api_key: env.tmdbApiKey, language: 'fr-FR' });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let response: Response;
    try {
      response = await fetch(`${TMDB_API_BASE}/${mediaType}/${tmdbId}?${searchParams.toString()}`, {
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`TMDB details request failed: ${response.status}`);

    const details = (await response.json()) as TmdbDetails;
    const matchedSlugs = new Set<string>();
    for (const genre of details.genres ?? []) {
      const slug = canonicalGenreSlug(genre.name);
      if (slug) matchedSlugs.add(slug);
    }
    const genres = [...matchedSlugs].map((slug) => ({ slug, name: genreNameForSlug(slug) ?? slug }));
    const result: TmdbGenreResult = { genres };

    // Reuse this row for future enrichment (WS6) too — same data shape as
    // the title-matched rows, just keyed differently and always "matched".
    await execute(
      `INSERT INTO tmdb_matches(lookup_key, media_type, matched, tmdb_id, title, overview, poster_path, backdrop_path, rating, release_date, genres, fetched_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE
         title = new.title, overview = new.overview, poster_path = new.poster_path, backdrop_path = new.backdrop_path,
         rating = new.rating, release_date = new.release_date, genres = new.genres, fetched_at = new.fetched_at`,
      [
        lookupKey,
        mediaType,
        tmdbId,
        details.title ?? details.name ?? null,
        details.overview ?? null,
        details.poster_path ?? null,
        details.backdrop_path ?? null,
        typeof details.vote_average === 'number' ? details.vote_average : null,
        details.release_date ?? details.first_air_date ?? null,
        genres.map((g) => g.slug).join(','),
        nowEpoch(),
      ]
    );

    await setCache(redisKey, result, env.tmdbCacheTtlSeconds);
    return result;
  } catch {
    // Fail closed to "no genres" — never let a TMDB hiccup break Jellyfin
    // catalog listing.
    return empty;
  }
}
