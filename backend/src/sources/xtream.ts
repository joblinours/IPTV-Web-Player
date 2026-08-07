import type { ContentProvider } from './index.js';
import type { CategoryItem, ContentType, EpgItem, MediaSourceRow, PlaybackTarget, SeriesInfoResponse } from '../types.js';
import type { XtreamCategory, XtreamSeriesInfoResponse, XtreamStream } from '../types.js';
import { decryptSecret } from '../crypto.js';
import { env } from '../config.js';
import { cacheKey, getOrSet } from '../redis.js';
import {
  fetchXtream,
  getActionForCategories,
  getActionForContent,
  normalizeServerUrl,
} from '../xtream.js';

function mapCategories(categories: XtreamCategory[]): CategoryItem[] {
  return [
    { id: 'favorites', name: 'Favoris' },
    { id: 'all', name: 'Tous' },
    ...categories.map((item) => ({ id: item.category_id, name: item.category_name })),
  ];
}

function mapContentItem(src: MediaSourceRow, type: ContentType, entry: XtreamStream): import('../types.js').ContentItem {
  const rawId = String(entry.stream_id ?? entry.series_id ?? '');
  return {
    id: rawId,
    title: entry.name ?? entry.title ?? 'Untitled',
    categoryId: String(entry.category_id ?? ''),
    poster: entry.stream_icon ?? entry.cover ?? null,
    description: entry.plot ?? null,
    genre: (entry as any).genre ?? null,
    year: entry.year ?? (entry.release_date ? String(entry.release_date).slice(0, 4) : null),
    epgChannelId: entry.epg_channel_id ?? null,
    hasArchive: String(entry.tv_archive ?? '0') === '1' || Number(entry.tv_archive_duration ?? 0) > 0,
    archiveDurationHours: Number(entry.tv_archive_duration ?? 0) || null,
    rating: entry.rating ?? null,
    duration: entry.duration ?? null,
    durationSeconds: Number(entry.duration_secs ?? 0) > 0 ? Number(entry.duration_secs) : null,
    containerExtension: entry.container_extension ?? null,
    streamId: entry.stream_id ?? null,
    seriesId: entry.series_id ?? null,
    source: 'xtream',
    sourceId: src.id,
    itemId: rawId,
    tmdbId: null,
  };
}

function accountFor(src: MediaSourceRow) {
  return { server_url: src.server_url, username: src.username, password_enc: src.secret_enc };
}

function pathTypeFor(type: ContentType): 'live' | 'movie' | 'series' {
  return type === 'live' ? 'live' : type === 'vod' ? 'movie' : 'series';
}

export const xtreamProvider: ContentProvider = {
  supportsTimeshift: true,

  async listCategories(src, type) {
    const key = cacheKey('xt', 'cat', src.id, type);
    const categories = await getOrSet(key, env.xtreamCatalogTtlSeconds, async () => {
      const action = getActionForCategories(type);
      return (await fetchXtream(accountFor(src), action)) as XtreamCategory[];
    });
    return mapCategories(categories);
  },

  async listContent(src, type, categoryId) {
    const scopedCategory = categoryId === 'all' || categoryId === 'favorites' ? 'all' : categoryId;
    const key = cacheKey('xt', 'cnt', src.id, type, scopedCategory);
    const items = await getOrSet(key, env.xtreamCatalogTtlSeconds, async () => {
      const action = getActionForContent(type);
      const actionParams: Record<string, string> = {};
      if (categoryId !== 'all' && categoryId !== 'favorites') {
        actionParams.category_id = categoryId;
      }
      return (await fetchXtream(accountFor(src), action, actionParams)) as XtreamStream[];
    });
    return items.map((entry) => mapContentItem(src, type, entry));
  },

  async getSeriesInfo(src, seriesId) {
    const key = cacheKey('xt', 'series', src.id, seriesId);
    const seriesData = await getOrSet(key, env.xtreamSeriesTtlSeconds, async () => {
      return (await fetchXtream(accountFor(src), 'get_series_info', { series_id: seriesId })) as XtreamSeriesInfoResponse;
    });

    const seasonsMap = seriesData.episodes ?? {};
    const seasons = Object.keys(seasonsMap)
      .map((seasonKey) => Number(seasonKey))
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
      .map((seasonNumber) => ({
        seasonNumber,
        episodeCount: (seasonsMap[String(seasonNumber)] ?? []).length,
      }));

    const episodesBySeason: SeriesInfoResponse['episodesBySeason'] = {};
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
  },

  async getEpg(src, itemId): Promise<EpgItem[]> {
    const data = (await fetchXtream(accountFor(src), 'get_simple_data_table', { stream_id: itemId })) as {
      epg_listings?: Array<{
        title?: string; description?: string; start?: string; end?: string;
        start_timestamp?: number; stop_timestamp?: number;
      }>;
    };

    return (data.epg_listings ?? []).map((entry) => ({
      title: entry.title ? Buffer.from(entry.title, 'base64').toString('utf8') : '',
      description: entry.description ? Buffer.from(entry.description, 'base64').toString('utf8') : '',
      start: entry.start,
      end: entry.end,
      startTimestamp: entry.start_timestamp,
      stopTimestamp: entry.stop_timestamp,
    }));
  },

  async buildPlayback(src, { type, itemId, containerExtension }): Promise<PlaybackTarget[]> {
    const password = decryptSecret(src.secret_enc);
    const extension = containerExtension ?? (type === 'live' ? 'm3u8' : 'mp4');
    const pathType = pathTypeFor(type);
    const url = `${normalizeServerUrl(src.server_url)}/${pathType}/${src.username}/${password}/${itemId}.${extension}`;

    return [
      {
        url,
        headers: { Referer: normalizeServerUrl(src.server_url) },
        hint: 'direct',
      },
    ];
  },
};
