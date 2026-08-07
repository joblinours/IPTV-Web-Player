import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { queryAll } from '../db.js';
import { getProvider, loadSource } from '../sources/index.js';
import { filterAndPaginate, decodeCursor } from '../utils.js';

export function registerCatalogRoutes(app: FastifyInstance) {
  app.get('/api/iptv/categories', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      type: z.enum(['live', 'vod', 'series']),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
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
      accountId: z.coerce.number().int().positive(),
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

    const source = await loadSource(request.user.userId, parsed.data.accountId);
    if (!source) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const items = await getProvider(source.kind).listContent(source, parsed.data.type, parsed.data.categoryId);

    const favoriteIds = parsed.data.categoryId === 'favorites'
      ? new Set(
        (
          await queryAll<{ item_id: string }>(
            'SELECT item_id FROM favorites WHERE user_id = ? AND source_id = ? AND type = ?',
            [request.user.userId, source.id, parsed.data.type]
          )
        ).map((row) => row.item_id)
      )
      : null;

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
