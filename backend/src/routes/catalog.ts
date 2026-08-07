import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryAll } from '../db.js';
import { getProvider, loadSource, loadAllSources } from '../sources/index.js';
import { filterAndPaginate, decodeCursor, favoriteKey } from '../utils.js';
import { canonicalGenreSlug, genreNameForSlug } from '../lib/genres.js';
import type { CategoryItem, ContentItem, ContentType, MediaSourceRow } from '../types.js';

const GENRE_PREFIX = 'genre:';

// Maps one source's raw category onto the id every source's matching
// category should share once merged: Jellyfin's are already `genre:<slug>`
// (see sources/jellyfin.ts) and pass through unchanged; an Xtream category
// whose name best-effort-matches a canonical TMDB genre folds into that
// same `genre:<slug>` tab; anything else stays its own source-prefixed
// (and therefore never colliding) category, per the "safe fallback" rule.
function effectiveCategoryId(sourceId: number, category: CategoryItem): string {
  if (category.id === 'all' || category.id === 'favorites') return category.id;
  if (category.id.startsWith(GENRE_PREFIX)) return category.id;
  const slug = canonicalGenreSlug(category.name);
  return slug ? `${GENRE_PREFIX}${slug}` : `${sourceId}:${category.id}`;
}

function effectiveCategoryName(effectiveId: string, fallbackName: string): string {
  if (!effectiveId.startsWith(GENRE_PREFIX)) return fallbackName;
  return genreNameForSlug(effectiveId.slice(GENRE_PREFIX.length)) ?? fallbackName;
}

async function listCategoriesMerged(userId: number, type: ContentType): Promise<CategoryItem[]> {
  const sources = await loadAllSources(userId);
  const results = await Promise.allSettled(sources.map((src) => getProvider(src.kind).listCategories(src, type)));

  const merged = new Map<string, string>();
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const sourceId = sources[index].id;
    for (const category of result.value) {
      if (category.id === 'all' || category.id === 'favorites') continue;
      const effectiveId = effectiveCategoryId(sourceId, category);
      if (!merged.has(effectiveId)) {
        merged.set(effectiveId, effectiveCategoryName(effectiveId, category.name));
      }
    }
  });

  return [
    { id: 'favorites', name: 'Favoris' },
    { id: 'all', name: 'Tous' },
    ...[...merged.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  ];
}

// Always fetches each source's full ('all') item list rather than a
// specific category — simpler and correctness-safe (the caller's
// filterAndPaginate does the actual category filtering against the
// remapped ids below), and in practice no slower: it's the same
// already-cached payload "Tous" already primes for every source.
async function listContentMerged(userId: number, type: ContentType): Promise<ContentItem[]> {
  const sources = await loadAllSources(userId);
  if (sources.length === 0) return [];

  const [categoryResults, contentResults] = await Promise.all([
    Promise.allSettled(sources.map((src) => getProvider(src.kind).listCategories(src, type))),
    Promise.allSettled(sources.map((src) => getProvider(src.kind).listContent(src, type, 'all'))),
  ]);

  const items: ContentItem[] = [];
  sources.forEach((src: MediaSourceRow, index: number) => {
    const contentResult = contentResults[index];
    if (contentResult.status !== 'fulfilled') return;

    const categoryMap = new Map<string, string>();
    const categoryResult = categoryResults[index];
    if (categoryResult.status === 'fulfilled') {
      for (const category of categoryResult.value) {
        categoryMap.set(category.id, effectiveCategoryId(src.id, category));
      }
    }

    for (const item of contentResult.value) {
      const effectiveId = categoryMap.get(item.categoryId) ?? `${src.id}:${item.categoryId}`;
      items.push({ ...item, categoryId: effectiveId });
    }
  });

  return items;
}

export function registerCatalogRoutes(app: FastifyInstance) {
  app.get('/api/iptv/categories', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive().optional(),
      mode: z.enum(['single', 'merged']).optional().default('single'),
      type: z.enum(['live', 'vod', 'series']),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    // Live TV has no Jellyfin equivalent (no tuner) — always single-source,
    // silently ignoring an errant mode=merged rather than erroring.
    if (parsed.data.mode === 'merged' && parsed.data.type !== 'live') {
      const items = await listCategoriesMerged(request.user.userId, parsed.data.type);
      return { items };
    }

    if (!parsed.data.accountId) {
      return reply.code(400).send({ message: 'accountId is required outside merged mode' });
    }

    const source = await loadSource(request.user.userId, parsed.data.accountId);
    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const items = await getProvider(source.kind).listCategories(source, parsed.data.type);
    return { items };
  });

  app.get('/api/iptv/content', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive().optional(),
      mode: z.enum(['single', 'merged']).optional().default('single'),
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

    const useMerged = parsed.data.mode === 'merged' && parsed.data.type !== 'live';

    let items: ContentItem[];
    let favoriteIds: Set<string> | null = null;

    if (useMerged) {
      items = await listContentMerged(request.user.userId, parsed.data.type);

      if (parsed.data.categoryId === 'favorites') {
        const rows = await queryAll<{ source_id: number; item_id: string }>(
          'SELECT source_id, item_id FROM favorites WHERE user_id = ? AND type = ?',
          [request.user.userId, parsed.data.type]
        );
        favoriteIds = new Set(rows.map((row) => favoriteKey(row.source_id, row.item_id)));
      }
    } else {
      if (!parsed.data.accountId) {
        return reply.code(400).send({ message: 'accountId is required outside merged mode' });
      }

      const source = await loadSource(request.user.userId, parsed.data.accountId);
      if (!source) {
        return reply.code(404).send({ message: 'Account not found' });
      }

      items = await getProvider(source.kind).listContent(source, parsed.data.type, parsed.data.categoryId);

      if (parsed.data.categoryId === 'favorites') {
        const rows = await queryAll<{ item_id: string }>(
          'SELECT item_id FROM favorites WHERE user_id = ? AND source_id = ? AND type = ?',
          [request.user.userId, source.id, parsed.data.type]
        );
        favoriteIds = new Set(rows.map((row) => favoriteKey(source.id, row.item_id)));
      }
    }

    const resolvedOffset = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : parsed.data.offset;
    const { items: paged, pagination } = filterAndPaginate(items, {
      categoryId: parsed.data.categoryId,
      search: parsed.data.search,
      favoriteIds,
      offset: resolvedOffset,
      limit: parsed.data.limit,
    });

    return { items: paged, pagination };
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

    const source = await loadSource(request.user.userId, parsed.data.accountId);
    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const provider = getProvider(source.kind);
    if (!provider.getEpg) {
      return { items: [] };
    }

    const items = await provider.getEpg(source, String(parsed.data.streamId));
    return { items };
  });

  app.get('/api/iptv/series-info', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      seriesId: z.string().min(1),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const source = await loadSource(request.user.userId, parsed.data.accountId);
    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const info = await getProvider(source.kind).getSeriesInfo(source, parsed.data.seriesId);
    return info;
  });
}
