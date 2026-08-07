import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { env } from '../config.js';
import { getCache, setCache, cacheKey } from '../redis.js';
import { queryOne, execute, nowEpoch } from '../db.js';

const TMDB_API_BASE = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

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

type TmdbMatch = {
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

function sha256hex(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

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

/**
 * Optional enrichment: matches an Xtream/Jellyfin title against TMDB to get
 * a cleaner poster/overview/rating, and — via the `tmdb_matches` MySQL table
 * — the TMDB-ID linkage that lets a completed Radarr/Sonarr request be
 * recognized as "available" once it shows up in Jellyfin (see routes/requests.ts).
 * Inactive (returns { enabled: false }) unless TMDB_API_KEY is configured.
 */
export function registerTmdbRoutes(app: FastifyInstance) {
  app.get('/api/tmdb/match', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    if (!env.tmdbApiKey) {
      return { enabled: false };
    }

    const querySchema = z.object({
      title: z.string().min(1),
      type: z.enum(['movie', 'series']),
      year: z.string().regex(/^\d{4}$/).optional(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const tmdbType = parsed.data.type === 'series' ? 'tv' : 'movie';
    const lookupKey = sha256hex(`${tmdbType}|${parsed.data.title.trim().toLowerCase()}|${parsed.data.year ?? ''}`);
    const redisKey = cacheKey('tmdb', 'match', lookupKey);

    const cached = await getCache<TmdbMatch | { enabled: false }>(redisKey);
    if (cached) return cached;

    const persisted = await queryOne<TmdbMatchRow>(
      'SELECT matched, tmdb_id, title, overview, poster_path, backdrop_path, rating, release_date FROM tmdb_matches WHERE lookup_key = ?',
      [lookupKey]
    );
    if (persisted) {
      const result = rowToMatch(persisted);
      await setCache(redisKey, result, env.tmdbCacheTtlSeconds);
      return result;
    }

    const searchParams = new URLSearchParams({
      api_key: env.tmdbApiKey,
      query: parsed.data.title,
      language: 'fr-FR',
      include_adult: 'false',
    });
    if (parsed.data.year) {
      searchParams.set(tmdbType === 'movie' ? 'primary_release_year' : 'first_air_date_year', parsed.data.year);
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

      if (!response.ok) {
        throw new Error(`TMDB request failed: ${response.status}`);
      }

      const data = (await response.json()) as { results?: TmdbSearchResult[] };
      best = data.results?.[0];

      result = best
        ? {
            enabled: true,
            id: best.id,
            title: best.title ?? best.name ?? parsed.data.title,
            overview: best.overview || null,
            posterUrl: best.poster_path ? `${TMDB_IMAGE_BASE}${best.poster_path}` : null,
            backdropUrl: best.backdrop_path ? `${TMDB_IMAGE_BASE}${best.backdrop_path}` : null,
            rating: typeof best.vote_average === 'number' ? best.vote_average : null,
            releaseDate: best.release_date ?? best.first_air_date ?? null,
          }
        : { enabled: false };
    } catch (error) {
      app.log.warn({ error, title: parsed.data.title }, 'tmdb_match_failed');
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
        tmdbType === 'tv' ? 'tv' : 'movie',
        best ? 1 : 0,
        best?.id ?? null,
        best ? (best.title ?? best.name ?? parsed.data.title) : null,
        best?.overview ?? null,
        best?.poster_path ?? null,
        best?.backdrop_path ?? null,
        typeof best?.vote_average === 'number' ? best.vote_average : null,
        best?.release_date ?? best?.first_air_date ?? null,
        nowEpoch(),
      ]
    );

    await setCache(redisKey, result, env.tmdbCacheTtlSeconds);
    return result;
  });

  app.get('/api/tmdb/search', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    if (!env.tmdbApiKey) {
      return { enabled: false, page: 1, totalPages: 0, results: [] };
    }

    const querySchema = z.object({
      query: z.string().min(1),
      type: z.enum(['movie', 'series']),
      page: z.coerce.number().int().min(1).max(500).optional().default(1),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const tmdbType = parsed.data.type === 'series' ? 'tv' : 'movie';
    const queryHash = sha256hex(parsed.data.query.trim().toLowerCase());
    const redisKey = cacheKey('tmdb', 'search', tmdbType, queryHash, parsed.data.page);

    const cached = await getCache<any>(redisKey);
    if (cached) return cached;

    const searchParams = new URLSearchParams({
      api_key: env.tmdbApiKey,
      query: parsed.data.query,
      language: 'fr-FR',
      include_adult: 'false',
      page: String(parsed.data.page),
    });

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

      if (!response.ok) {
        throw new Error(`TMDB request failed: ${response.status}`);
      }

      const data = (await response.json()) as { results?: TmdbSearchResult[]; total_pages?: number };
      const result = {
        enabled: true,
        page: parsed.data.page,
        totalPages: data.total_pages ?? 1,
        results: (data.results ?? []).map((entry) => ({
          tmdbId: entry.id,
          mediaType: parsed.data.type,
          title: entry.title ?? entry.name ?? 'Untitled',
          year: (entry.release_date ?? entry.first_air_date ?? '').slice(0, 4) || null,
          overview: entry.overview || null,
          posterUrl: entry.poster_path ? `${TMDB_IMAGE_BASE}${entry.poster_path}` : null,
          backdropUrl: entry.backdrop_path ? `${TMDB_IMAGE_BASE}${entry.backdrop_path}` : null,
          rating: typeof entry.vote_average === 'number' ? entry.vote_average : null,
        })),
      };

      await setCache(redisKey, result, 3600);
      return result;
    } catch (error) {
      app.log.warn({ error, query: parsed.data.query }, 'tmdb_search_failed');
      return reply.code(502).send({ message: 'TMDB search failed' });
    }
  });
}
