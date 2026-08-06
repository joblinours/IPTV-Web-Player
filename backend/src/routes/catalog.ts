import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { env } from '../config.js';
import { getCache, setCache } from '../db.js';
import { fetchXtream, getActionForCategories, getActionForContent, getXtreamItemId } from '../xtream.js';
import { computePagination, decodeCursor } from '../utils.js';
import type { IptvAccountRow, XtreamCategory, XtreamSeriesInfoResponse, XtreamStream } from '../types.js';

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

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const cacheKey = `cat:${account.id}:${parsed.data.type}`;
    let categories = getCache<XtreamCategory[]>(cacheKey);

    if (!categories) {
      const action = getActionForCategories(parsed.data.type);
      categories = (await fetchXtream(account, action)) as XtreamCategory[];
      setCache(cacheKey, categories, env.cacheTtlSeconds);
    }

    const mapped = [
      { id: 'favorites', name: 'Favoris' },
      { id: 'all', name: 'Tous' },
      ...categories.map((item) => ({ id: item.category_id, name: item.category_name })),
    ];

    return { items: mapped };
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

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const scopedCategory = parsed.data.categoryId === 'all' || parsed.data.categoryId === 'favorites'
      ? 'all'
      : parsed.data.categoryId;
    const cacheKey = `cnt:${account.id}:${parsed.data.type}:${scopedCategory}`;
    let items = getCache<XtreamStream[]>(cacheKey);

    if (!items) {
      const action = getActionForContent(parsed.data.type);
      const actionParams: Record<string, string> = {};
      if (parsed.data.categoryId !== 'all' && parsed.data.categoryId !== 'favorites') {
        actionParams.category_id = parsed.data.categoryId;
      }

      items = (await fetchXtream(account, action, actionParams)) as XtreamStream[];
      setCache(cacheKey, items, env.cacheTtlSeconds);
    }

    const search = parsed.data.search.trim().toLowerCase();
    const categoryId = parsed.data.categoryId;
    const favoriteIds = categoryId === 'favorites'
      ? new Set(
        (
          db
            .prepare('SELECT item_id FROM favorites WHERE user_id = ? AND account_id = ? AND type = ?')
            .all(request.user.userId, account.id, parsed.data.type) as { item_id: string }[]
        ).map((row) => row.item_id)
      )
      : null;

    const filtered = items.filter((entry) => {
      const entryCategory = String(entry.category_id ?? '');
      const itemId = getXtreamItemId(parsed.data.type, entry);
      const categoryMatch = categoryId === 'favorites'
        ? !!itemId && favoriteIds?.has(itemId)
        : categoryId === 'all' || entryCategory === categoryId;
      if (!categoryMatch) return false;

      if (!search) return true;
      const title = (entry.name ?? entry.title ?? '').toLowerCase();
      return title.includes(search);
    });

    const resolvedOffset = parsed.data.cursor ? decodeCursor(parsed.data.cursor) : parsed.data.offset;
    const paged = filtered.slice(resolvedOffset, resolvedOffset + parsed.data.limit);
    const pagination = computePagination(filtered.length, resolvedOffset, parsed.data.limit);

    const mapped = paged.map((entry) => ({
      id: String(entry.stream_id ?? entry.series_id ?? ''),
      title: entry.name ?? entry.title ?? 'Untitled',
      categoryId: String(entry.category_id ?? ''),
      poster: entry.stream_icon ?? entry.cover ?? null,
      description: entry.plot ?? null,
      genre: (entry as any).genre ?? null,
      year: entry.year ?? (entry.release_date ? String(entry.release_date).slice(0, 4) : null),
      epgChannelId: entry.epg_channel_id ?? null,
      hasArchive:
        String(entry.tv_archive ?? '0') === '1' || Number(entry.tv_archive_duration ?? 0) > 0,
      archiveDurationHours: Number(entry.tv_archive_duration ?? 0) || null,
      rating: entry.rating ?? null,
      duration: entry.duration ?? null,
      durationSeconds: Number(entry.duration_secs ?? 0) > 0 ? Number(entry.duration_secs) : null,
      containerExtension: entry.container_extension ?? null,
      streamId: entry.stream_id ?? null,
      seriesId: entry.series_id ?? null,
    }));

    return {
      items: mapped,
      pagination,
    };
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

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const data = (await fetchXtream(account, 'get_simple_data_table', {
      stream_id: String(parsed.data.streamId),
    })) as {
      epg_listings?: Array<{
        title?: string;
        description?: string;
        start?: string;
        end?: string;
        start_timestamp?: number;
        stop_timestamp?: number;
      }>;
    };

    const items = (data.epg_listings ?? []).map((entry) => ({
      title: entry.title ? Buffer.from(entry.title, 'base64').toString('utf8') : '',
      description: entry.description ? Buffer.from(entry.description, 'base64').toString('utf8') : '',
      start: entry.start,
      end: entry.end,
      startTimestamp: entry.start_timestamp,
      stopTimestamp: entry.stop_timestamp,
    }));

    return { items };
  });

  app.get('/api/iptv/series-info', { preHandler: [app.authenticate] }, async (request: any, reply) => {
    const querySchema = z.object({
      accountId: z.coerce.number().int().positive(),
      seriesId: z.coerce.number().int().positive(),
    });

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ message: 'Invalid query' });
    }

    const account = db
      .prepare('SELECT id, server_url, username, password_enc FROM iptv_accounts WHERE id = ? AND user_id = ?')
      .get(parsed.data.accountId, request.user.userId) as IptvAccountRow | undefined;

    if (!account) {
      return reply.code(404).send({ message: 'Account not found' });
    }

    const cacheKey = `series:${account.id}:${parsed.data.seriesId}`;
    let seriesData = getCache<XtreamSeriesInfoResponse>(cacheKey);

    if (!seriesData) {
      seriesData = (await fetchXtream(account, 'get_series_info', {
        series_id: String(parsed.data.seriesId),
      })) as XtreamSeriesInfoResponse;
      setCache(cacheKey, seriesData, env.cacheTtlSeconds);
    }

    const seasonsMap = seriesData.episodes ?? {};
    const seasons = Object.keys(seasonsMap)
      .map((seasonKey) => Number(seasonKey))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((seasonNumber) => ({
        seasonNumber,
        episodeCount: (seasonsMap[String(seasonNumber)] ?? []).length,
      }));

    const episodesBySeason: Record<string, Array<{
      id: number;
      title: string;
      episodeNumber: number;
      seasonNumber: number;
      containerExtension: string;
      duration: string | null;
      durationSeconds: number | null;
      poster: string | null;
      rating: number | null;
      airDate: string | null;
    }>> = {};

    for (const [seasonKey, episodes] of Object.entries(seasonsMap)) {
      episodesBySeason[seasonKey] = (episodes ?? []).map((episode) => ({
        id: Number(episode.id ?? 0),
        title: episode.title ?? `Episode ${episode.episode_num ?? '?'}`,
        episodeNumber: Number(episode.episode_num ?? 0),
        seasonNumber: Number(episode.season ?? seasonKey),
        containerExtension: episode.container_extension ?? 'mp4',
        duration: episode.info?.duration ?? null,
        durationSeconds: episode.info?.duration_secs ?? null,
        poster: episode.info?.movie_image ?? null,
        rating: typeof episode.info?.rating === 'number' ? episode.info.rating : null,
        airDate: episode.info?.air_date ?? null,
      }));
    }

    return {
      info: {
        name: seriesData.info?.name ?? 'Série',
        cover: seriesData.info?.cover ?? null,
        plot: seriesData.info?.plot ?? null,
        cast: seriesData.info?.cast ?? null,
        director: seriesData.info?.director ?? null,
        genre: seriesData.info?.genre ?? null,
        releaseDate: seriesData.info?.releaseDate ?? null,
        rating: seriesData.info?.rating ?? null,
        rating5Based: seriesData.info?.rating_5based ?? null,
        episodeRunTime: seriesData.info?.episode_run_time ?? null,
        backdropPath: seriesData.info?.backdrop_path ?? [],
      },
      seasons,
      episodesBySeason,
    };
  });
}
