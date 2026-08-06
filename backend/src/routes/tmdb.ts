import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { getCache, setCache } from '../db.js';

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

/**
 * Optional enrichment: matches an Xtream VOD/series title against TMDB to get
 * a cleaner poster/overview/rating. Inactive (returns { enabled: false })
 * unless TMDB_API_KEY is configured — no other route depends on this.
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
    const cacheKey = `tmdb:${tmdbType}:${parsed.data.title.toLowerCase()}:${parsed.data.year ?? ''}`;
    const cached = getCache<TmdbMatch | { enabled: false }>(cacheKey);
    if (cached) {
      return cached;
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
      const best = data.results?.[0];

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
      // Don't cache transient failures — only cache real "no match" results.
      return { enabled: false };
    }

    setCache(cacheKey, result, env.cacheTtlSeconds * 12);
    return result;
  });
}
