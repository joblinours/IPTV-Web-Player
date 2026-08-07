import type { ContentProvider } from './index.js';
import type { CategoryItem, ContentItem, ContentType, MediaSourceRow, PlaybackTarget, SeriesInfoResponse } from '../types.js';
import { decryptSecret } from '../crypto.js';
import { env } from '../config.js';
import { cacheKey, getCache, getOrSet, setCache } from '../redis.js';

type JellyfinItem = {
  Id: string;
  Name?: string;
  ParentId?: string;
  Overview?: string;
  Genres?: string[];
  ProductionYear?: number;
  CommunityRating?: number;
  RunTimeTicks?: number;
  ImageTags?: { Primary?: string; Backdrop?: string };
  MediaSources?: Array<{ Container?: string; TranscodingUrl?: string }>;
  ProviderIds?: { Tmdb?: string };
};

type JellyfinItemsResponse = { Items: JellyfinItem[]; TotalRecordCount: number; StartIndex: number };
type JellyfinView = { Id: string; Name: string; CollectionType?: string };

async function jellyfinFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${env.jellyfinUrl}${path}${path.includes('?') ? '&' : '?'}api_key=${encodeURIComponent(env.jellyfinApiKey)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Jellyfin request failed: ${response.status} ${path}`);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveUserId(): Promise<string> {
  if (env.jellyfinUserId) return env.jellyfinUserId;

  const key = cacheKey('jf', 'userid');
  const cached = await getCache<string>(key);
  if (cached) return cached;

  const users = await jellyfinFetch<Array<{ Id: string; Policy?: { IsAdministrator?: boolean } }>>('/Users');
  const admin = users.find((user) => user.Policy?.IsAdministrator) ?? users[0];
  if (!admin) throw new Error('Jellyfin has no users configured yet');

  await setCache(key, admin.Id, 3600);
  return admin.Id;
}

function itemTypeFor(type: ContentType): 'Movie' | 'Series' | null {
  if (type === 'vod') return 'Movie';
  if (type === 'series') return 'Series';
  return null; // Jellyfin has no tuner in this stack; Live TV is Xtream-only.
}

function mapItem(src: MediaSourceRow, libraryId: string, item: JellyfinItem): ContentItem {
  const durationSeconds = item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : null;
  const duration = durationSeconds
    ? new Date(durationSeconds * 1000).toISOString().substring(11, 19)
    : null;

  return {
    id: item.Id,
    title: item.Name ?? 'Untitled',
    categoryId: item.ParentId ?? libraryId,
    poster: item.ImageTags?.Primary
      ? `/api/jellyfin/image/${item.Id}/Primary?tag=${item.ImageTags.Primary}`
      : null,
    description: item.Overview ?? null,
    genre: item.Genres?.length ? item.Genres.join(', ') : null,
    year: item.ProductionYear ? String(item.ProductionYear) : null,
    epgChannelId: null,
    hasArchive: false,
    archiveDurationHours: null,
    rating: typeof item.CommunityRating === 'number' ? item.CommunityRating.toFixed(1) : null,
    duration,
    durationSeconds,
    containerExtension: item.MediaSources?.[0]?.Container ?? null,
    streamId: null,
    seriesId: null,
    source: 'jellyfin',
    sourceId: src.id,
    itemId: item.Id,
    tmdbId: item.ProviderIds?.Tmdb ? Number(item.ProviderIds.Tmdb) : null,
  };
}

async function listLibraries(src: MediaSourceRow): Promise<JellyfinView[]> {
  const key = cacheKey('jf', 'libs', src.id);
  return getOrSet(key, 3600, async () => {
    const userId = await resolveUserId();
    const data = await jellyfinFetch<{ Items: JellyfinView[] }>(`/Users/${userId}/Views`);
    return data.Items ?? [];
  });
}

async function listAllItems(src: MediaSourceRow, type: ContentType): Promise<ContentItem[]> {
  const includeType = itemTypeFor(type);
  if (!includeType) return [];

  const key = cacheKey('jf', 'items', src.id, type);
  return getOrSet(key, env.jellyfinSyncIntervalMs / 1000, async () => {
    const userId = await resolveUserId();
    const libraries = await listLibraries(src);
    const wantedCollection = type === 'vod' ? 'movies' : 'tvshows';
    const targetLibraries = libraries.filter((lib) => lib.CollectionType === wantedCollection);

    const items: ContentItem[] = [];
    for (const library of targetLibraries) {
      let startIndex = 0;
      const limit = 200;
      for (;;) {
        const page = await jellyfinFetch<JellyfinItemsResponse>(
          `/Users/${userId}/Items?ParentId=${library.Id}&IncludeItemTypes=${includeType}&Recursive=true` +
          `&StartIndex=${startIndex}&Limit=${limit}&SortBy=SortName&SortOrder=Ascending` +
          `&EnableImageTypes=Primary,Backdrop&ImageTypeLimit=1` +
          `&Fields=Overview,Genres,ProductionYear,ProviderIds,RunTimeTicks,CommunityRating,MediaSources`
        );
        items.push(...page.Items.map((item) => mapItem(src, library.Id, item)));
        startIndex += limit;
        if (startIndex >= page.TotalRecordCount || page.Items.length === 0) break;
      }
    }
    return items;
  });
}

export const jellyfinProvider: ContentProvider = {
  supportsTimeshift: false,

  async listCategories(src, type): Promise<CategoryItem[]> {
    const includeType = itemTypeFor(type);
    if (!includeType) return [{ id: 'favorites', name: 'Favoris' }, { id: 'all', name: 'Tous' }];

    const libraries = await listLibraries(src);
    const wantedCollection = type === 'vod' ? 'movies' : 'tvshows';
    const matching = libraries.filter((lib) => lib.CollectionType === wantedCollection);

    return [
      { id: 'favorites', name: 'Favoris' },
      { id: 'all', name: 'Tous' },
      ...matching.map((lib) => ({ id: lib.Id, name: lib.Name })),
    ];
  },

  async listContent(src, type, categoryId): Promise<ContentItem[]> {
    const items = await listAllItems(src, type);
    if (categoryId === 'all' || categoryId === 'favorites') return items;
    return items.filter((item) => item.categoryId === categoryId);
  },

  async getSeriesInfo(src, seriesId): Promise<SeriesInfoResponse> {
    const userId = await resolveUserId();
    const [detail, seasons] = await Promise.all([
      jellyfinFetch<JellyfinItem>(`/Users/${userId}/Items/${seriesId}`),
      jellyfinFetch<{ Items: Array<{ Id: string; IndexNumber?: number }> }>(
        `/Shows/${seriesId}/Seasons?userId=${userId}`
      ),
    ]);

    const episodesBySeason: SeriesInfoResponse['episodesBySeason'] = {};
    const seasonSummaries: SeriesInfoResponse['seasons'] = [];

    for (const season of seasons.Items) {
      const seasonNumber = season.IndexNumber ?? 0;
      const episodes = await jellyfinFetch<{ Items: JellyfinItem[] }>(
        `/Shows/${seriesId}/Episodes?seasonId=${season.Id}&userId=${userId}` +
        `&Fields=Overview,RunTimeTicks,MediaSources`
      );

      episodesBySeason[String(seasonNumber)] = episodes.Items.map((episode, index) => ({
        id: 0, // Jellyfin episode ids are GUID strings; numeric id kept null-ish for parity with Xtream shape.
        title: episode.Name ?? `Episode ${index + 1}`,
        episodeNumber: index + 1,
        seasonNumber,
        containerExtension: episode.MediaSources?.[0]?.Container ?? 'mp4',
        duration: null,
        durationSeconds: episode.RunTimeTicks ? Math.round(episode.RunTimeTicks / 10_000_000) : null,
        poster: episode.ImageTags?.Primary ? `/api/jellyfin/image/${episode.Id}/Primary?tag=${episode.ImageTags.Primary}` : null,
        rating: null,
        airDate: null,
      }));
      seasonSummaries.push({ seasonNumber, episodeCount: episodes.Items.length });
    }

    return {
      info: {
        name: detail.Name ?? 'Série',
        cover: detail.ImageTags?.Primary ? `/api/jellyfin/image/${detail.Id}/Primary?tag=${detail.ImageTags.Primary}` : null,
        plot: detail.Overview ?? null,
        cast: null,
        director: null,
        genre: detail.Genres?.length ? detail.Genres.join(', ') : null,
        releaseDate: detail.ProductionYear ? String(detail.ProductionYear) : null,
        rating: typeof detail.CommunityRating === 'number' ? detail.CommunityRating.toFixed(1) : null,
        rating5Based: null,
        episodeRunTime: null,
        backdropPath: detail.ImageTags?.Backdrop ? [`/api/jellyfin/image/${detail.Id}/Backdrop?tag=${detail.ImageTags.Backdrop}`] : [],
      },
      seasons: seasonSummaries,
      episodesBySeason,
    };
  },

  async buildPlayback(src, { itemId }): Promise<PlaybackTarget[]> {
    const apiKey = decryptSecret(src.secret_enc);
    const targets: PlaybackTarget[] = [
      { url: `${env.jellyfinUrl}/Items/${itemId}/Download?api_key=${encodeURIComponent(apiKey)}`, hint: 'direct' },
    ];

    try {
      const userId = await resolveUserId();
      const playbackInfo = await jellyfinFetch<{ MediaSources?: Array<{ TranscodingUrl?: string }> }>(
        `/Items/${itemId}/PlaybackInfo?userId=${userId}`,
        { method: 'POST' }
      );
      const transcodingUrl = playbackInfo.MediaSources?.[0]?.TranscodingUrl;
      if (transcodingUrl) {
        targets.push({
          url: `${env.jellyfinUrl}${transcodingUrl}&api_key=${encodeURIComponent(apiKey)}`,
          hint: 'hls',
        });
      }
    } catch {
      // Direct download candidate above is still a valid fallback.
    }

    return targets;
  },
};
