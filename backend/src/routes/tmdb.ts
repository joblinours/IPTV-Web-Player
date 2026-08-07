import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../config.js';
import { getCache, setCache, cacheKey } from '../redis.js';
import { TMDB_API_BASE, TMDB_IMAGE_BASE, sha256hex, resolveTmdbMatchByTitle, getCachedTmdbMatch, titleMatchLookupKey } from '../tmdb.js';
import { enqueueTmdbEnrich } from '../queue/index.js';

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
    return resolveTmdbMatchByTitle(parsed.data.title, tmdbType, parsed.data.year);
  });

  // Batch, cache-only counterpart of /api/tmdb/match: applying TMDB
  // enrichment to every card in a row/grid (not just the Hero) would mean
  // one live TMDB call per card if it reused the single-item endpoint — this
  // answers with whatever's already cached (a plain Redis/MySQL read, no
  // network call), and queues background resolution for the rest instead of
  // making the request wait on it.
  app.post('/api/tmdb/match-batch', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    if (!env.tmdbApiKey) {
      return { items: [] };
    }

    const bodySchema = z.object({
      items: z.array(z.object({
        title: z.string().min(1),
        type: z.enum(['movie', 'series']),
        year: z.string().regex(/^\d{4}$/).optional(),
      })).min(1).max(50),
    });

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid payload' });
    }

    const items = await Promise.all(
      parsed.data.items.map(async (entry) => {
        const tmdbType = entry.type === 'series' ? 'tv' : 'movie';
        const lookupKey = titleMatchLookupKey(entry.title, tmdbType, entry.year);
        const cached = await getCachedTmdbMatch(lookupKey);

        if (cached === null) {
          // Fire-and-forget: never let a queue hiccup break the batch
          // response, and never resolve it inline (that would defeat the
          // point of this endpoint being cache-only).
          enqueueTmdbEnrich({ title: entry.title, type: tmdbType, year: entry.year }).catch(() => {});
        }

        return {
          title: entry.title,
          type: entry.type,
          year: entry.year ?? null,
          match: cached ?? { enabled: false as const },
          pending: cached === null,
        };
      })
    );

    return { items };
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
