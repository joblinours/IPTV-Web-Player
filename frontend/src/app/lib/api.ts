export type SectionType = 'live' | 'films' | 'series';
export type BackendType = 'live' | 'vod' | 'series';

export interface PlaybackDebugContext {
  mediaTitle?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AddIptvAccountPayload {
  name: string;
  serverUrl: string;
  username: string;
  password: string;
}

export interface CategoryItem {
  id: string;
  name: string;
}

export interface ContentItem {
  id: string;
  title: string;
  categoryId: string;
  poster: string | null;
  description?: string | null;
  genre?: string | null;
  year?: string | null;
  epgChannelId?: string | null;
  hasArchive?: boolean;
  archiveDurationHours?: number | null;
  seasonsCount?: number | null;
  episodesCount?: number | null;
  rating: string | null;
  containerExtension?: string | null;
  streamId: number | null;
  seriesId: number | null;
}

export interface IptvAccount {
  id: number;
  name: string;
  server_url: string;
  username: string;
  created_at: number;
}

export interface EpgItem {
  title: string;
  description: string;
  start?: string;
  end?: string;
  startTimestamp?: number;
  stopTimestamp?: number;
}

export interface SeriesSeason {
  seasonNumber: number;
  episodeCount: number;
}

export interface SeriesEpisode {
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
}

export interface SeriesInfoResponse {
  info: {
    name: string;
    cover: string | null;
    plot: string | null;
    cast: string | null;
    director: string | null;
    genre: string | null;
    releaseDate: string | null;
    rating: string | null;
    rating5Based: string | null;
    episodeRunTime: string | null;
    backdropPath: string[];
  };
  seasons: SeriesSeason[];
  episodesBySeason: Record<string, SeriesEpisode[]>;
}

interface Pagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  nextOffset: number | null;
  nextCursor: string | null;
}

interface ContentResponse {
  items: ContentItem[];
  pagination: Pagination;
}

interface FavoritesResponse {
  items: string[];
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

function sectionToBackendType(section: SectionType): BackendType {
  if (section === 'films') return 'vod';
  return section;
}

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.message ?? 'Request failed');
  }

  return response.json() as Promise<T>;
}

export async function register(payload: LoginPayload) {
  return request<{ token: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function login(payload: LoginPayload) {
  return request<{ token: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function listIptvAccounts(token: string) {
  return request<{ items: IptvAccount[] }>(
    '/api/iptv/accounts',
    { method: 'GET' },
    token
  );
}

export async function addIptvAccount(token: string, payload: AddIptvAccountPayload) {
  return request<{ accountId: number }>('/api/iptv/accounts', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, token);
}

export async function fetchCategories(token: string, accountId: number, section: SectionType) {
  const type = sectionToBackendType(section);
  const query = new URLSearchParams({ accountId: String(accountId), type });
  return request<{ items: CategoryItem[] }>(`/api/iptv/categories?${query.toString()}`, { method: 'GET' }, token);
}

export async function fetchFavorites(token: string, accountId: number, section: SectionType): Promise<FavoritesResponse> {
  const type = sectionToBackendType(section);
  const query = new URLSearchParams({ accountId: String(accountId), type });
  return request<FavoritesResponse>(`/api/favorites?${query.toString()}`, { method: 'GET' }, token);
}

export async function addFavorite(token: string, params: { accountId: number; section: SectionType; itemId: string }) {
  const type = sectionToBackendType(params.section);
  return request<{ ok: boolean }>(
    '/api/favorites',
    {
      method: 'POST',
      body: JSON.stringify({ accountId: params.accountId, type, itemId: params.itemId }),
    },
    token
  );
}

export async function removeFavorite(token: string, params: { accountId: number; section: SectionType; itemId: string }) {
  const type = sectionToBackendType(params.section);
  return request<{ ok: boolean }>(
    '/api/favorites',
    {
      method: 'DELETE',
      body: JSON.stringify({ accountId: params.accountId, type, itemId: params.itemId }),
    },
    token
  );
}

export async function fetchContentPage(
  token: string,
  params: {
    accountId: number;
    section: SectionType;
    categoryId: string;
    searchQuery: string;
    offset: number;
    limit?: number;
  }
): Promise<ContentResponse> {
  const type = sectionToBackendType(params.section);
  const query = new URLSearchParams({
    accountId: String(params.accountId),
    type,
    categoryId: params.categoryId,
    search: params.searchQuery,
    offset: String(params.offset),
    limit: String(params.limit ?? 50),
  });

  return request<ContentResponse>(`/api/iptv/content?${query.toString()}`, { method: 'GET' }, token);
}

export async function fetchStreamUrl(
  token: string,
  params: {
    accountId: number;
    section: SectionType;
    streamId: number;
    containerExtension?: string;
    debugContext?: PlaybackDebugContext;
  }
) {
  const type = sectionToBackendType(params.section);
  const query = new URLSearchParams({
    accountId: String(params.accountId),
    type,
    streamId: String(params.streamId),
    containerExtension: params.containerExtension ?? 'm3u8',
  });

  if (params.debugContext?.mediaTitle) query.set('mediaTitle', params.debugContext.mediaTitle);
  if (params.debugContext?.seriesTitle) query.set('seriesTitle', params.debugContext.seriesTitle);
  if (typeof params.debugContext?.seasonNumber === 'number') query.set('seasonNumber', String(params.debugContext.seasonNumber));
  if (typeof params.debugContext?.episodeNumber === 'number') query.set('episodeNumber', String(params.debugContext.episodeNumber));

  return request<{ url: string }>(`/api/iptv/stream-url?${query.toString()}`, { method: 'GET' }, token);
}

export async function fetchSeriesInfo(token: string, accountId: number, seriesId: number) {
  const query = new URLSearchParams({
    accountId: String(accountId),
    seriesId: String(seriesId),
  });

  return request<SeriesInfoResponse>(`/api/iptv/series-info?${query.toString()}`, { method: 'GET' }, token);
}

export async function fetchEpg(token: string, accountId: number, streamId: number) {
  const query = new URLSearchParams({
    accountId: String(accountId),
    streamId: String(streamId),
  });

  return request<{ items: EpgItem[] }>(`/api/iptv/epg?${query.toString()}`, { method: 'GET' }, token);
}

export async function fetchReplayUrl(
  token: string,
  params: {
    accountId: number;
    streamId: number;
    start: string;
    durationMinutes: number;
    containerExtension?: string;
  }
) {
  const query = new URLSearchParams({
    accountId: String(params.accountId),
    streamId: String(params.streamId),
    start: params.start,
    durationMinutes: String(params.durationMinutes),
    containerExtension: params.containerExtension ?? 'ts',
  });

  return request<{ url: string }>(`/api/iptv/replay-url?${query.toString()}`, { method: 'GET' }, token);
}

export function buildTranscodeUrl(params: {
  token: string;
  accountId: number;
  section: SectionType;
  streamId: number;
  containerExtension?: string;
  debugContext?: PlaybackDebugContext;
}) {
  const type = sectionToBackendType(params.section);
  const query = new URLSearchParams({
    token: params.token,
    accountId: String(params.accountId),
    type,
    streamId: String(params.streamId),
    containerExtension: params.containerExtension ?? 'mkv',
  });

  if (params.debugContext?.mediaTitle) query.set('mediaTitle', params.debugContext.mediaTitle);
  if (params.debugContext?.seriesTitle) query.set('seriesTitle', params.debugContext.seriesTitle);
  if (typeof params.debugContext?.seasonNumber === 'number') query.set('seasonNumber', String(params.debugContext.seasonNumber));
  if (typeof params.debugContext?.episodeNumber === 'number') query.set('episodeNumber', String(params.debugContext.episodeNumber));

  return `${API_BASE_URL}/api/iptv/transcode?${query.toString()}`;
}

export function buildStreamProxyUrl(params: {
  token: string;
  accountId: number;
  section: SectionType;
  streamId: number;
  containerExtension?: string;
  debugContext?: PlaybackDebugContext;
}) {
  const type = sectionToBackendType(params.section);
  const query = new URLSearchParams({
    token: params.token,
    accountId: String(params.accountId),
    type,
    streamId: String(params.streamId),
    containerExtension: params.containerExtension ?? (type === 'live' ? 'm3u8' : 'mp4'),
  });

  if (params.debugContext?.mediaTitle) query.set('mediaTitle', params.debugContext.mediaTitle);
  if (params.debugContext?.seriesTitle) query.set('seriesTitle', params.debugContext.seriesTitle);
  if (typeof params.debugContext?.seasonNumber === 'number') query.set('seasonNumber', String(params.debugContext.seasonNumber));
  if (typeof params.debugContext?.episodeNumber === 'number') query.set('episodeNumber', String(params.debugContext.episodeNumber));

  return `${API_BASE_URL}/api/iptv/stream-proxy?${query.toString()}`;
}

// ── Watch Progress ────────────────────────────────────────────────────────────

export interface ProgressEntry {
  itemId: string;
  currentTime: number;
  totalDuration: number;
  isWatched: boolean;
  updatedAt: number;
}

export interface SeriesProgressSummary {
  lastEpisode: {
    episodeId: string;
    seasonNumber: number | null;
    episodeNumber: number | null;
    currentTime: number;
    totalDuration: number;
    isWatched: boolean;
  } | null;
  watchedEpisodeIds: string[];
}

export interface UserPreferences {
  autoplay: boolean;
  language: string;
}

export async function fetchProgress(
  token: string,
  accountId: number,
  type: 'vod' | 'series_episode',
  itemIds: string[]
): Promise<{ items: ProgressEntry[] }> {
  const query = new URLSearchParams({
    accountId: String(accountId),
    type,
    itemIds: itemIds.join(','),
  });
  return request<{ items: ProgressEntry[] }>(`/api/progress?${query.toString()}`, { method: 'GET' }, token);
}

export async function fetchSeriesProgress(
  token: string,
  accountId: number,
  seriesId: string
): Promise<SeriesProgressSummary> {
  const query = new URLSearchParams({ accountId: String(accountId), seriesId });
  return request<SeriesProgressSummary>(`/api/progress/series?${query.toString()}`, { method: 'GET' }, token);
}

export async function updateProgress(
  token: string,
  params: {
    accountId: number;
    type: 'vod' | 'series_episode';
    itemId: string;
    seriesId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
    currentTime: number;
    totalDuration: number;
    isWatched?: boolean;
  }
) {
  return request<{ ok: boolean }>(
    '/api/progress',
    { method: 'POST', body: JSON.stringify(params) },
    token
  );
}

export async function clearProgress(
  token: string,
  params: { accountId: number; type: 'vod' | 'series_episode'; itemId: string }
) {
  return request<{ ok: boolean }>(
    '/api/progress',
    { method: 'DELETE', body: JSON.stringify(params) },
    token
  );
}

export async function fetchPreferences(token: string): Promise<UserPreferences> {
  return request<UserPreferences>('/api/preferences', { method: 'GET' }, token);
}

export async function updatePreferences(token: string, prefs: Partial<UserPreferences>) {
  return request<{ ok: boolean }>(
    '/api/preferences',
    { method: 'PUT', body: JSON.stringify(prefs) },
    token
  );
}
