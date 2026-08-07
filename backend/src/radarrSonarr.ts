import { env } from './config.js';

type ArrService = 'radarr' | 'sonarr';

function baseUrlFor(service: ArrService): string {
  return service === 'radarr' ? env.radarrUrl : env.sonarrUrl;
}

function apiKeyFor(service: ArrService): string {
  return service === 'radarr' ? env.radarrApiKey : env.sonarrApiKey;
}

async function arrRequest<T>(
  service: ArrService,
  path: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; body: T | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${baseUrlFor(service)}${path}`, {
      ...init,
      headers: {
        'X-Api-Key': apiKeyFor(service),
        'Content-Type': 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as T) : null;
    return { ok: response.ok, status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

export async function arrGet<T>(service: ArrService, path: string): Promise<T | null> {
  const result = await arrRequest<T>(service, path, { method: 'GET' });
  return result.ok ? result.body : null;
}

export async function arrPost<T>(
  service: ArrService,
  path: string,
  body: unknown
): Promise<{ ok: boolean; status: number; body: T | null }> {
  return arrRequest<T>(service, path, { method: 'POST', body: JSON.stringify(body) });
}

export async function arrDelete(service: ArrService, path: string): Promise<boolean> {
  const result = await arrRequest(service, path, { method: 'DELETE' });
  return result.ok;
}

export async function arrPut<T>(
  service: ArrService,
  path: string,
  body: unknown
): Promise<{ ok: boolean; status: number; body: T | null }> {
  return arrRequest<T>(service, path, { method: 'PUT', body: JSON.stringify(body) });
}

export type RadarrLookupResult = Record<string, unknown> & { title?: string; tmdbId?: number };
export type SonarrLookupResult = Record<string, unknown> & {
  title?: string;
  tvdbId?: number;
  seasons?: Array<{ seasonNumber: number; monitored: boolean }>;
};

export async function radarrLookupByTmdb(tmdbId: number): Promise<RadarrLookupResult | null> {
  const results = await arrGet<RadarrLookupResult[]>('radarr', `/api/v3/movie/lookup?term=tmdb:${tmdbId}`);
  return results?.[0] ?? null;
}

export async function sonarrLookupByTvdb(tvdbId: number): Promise<SonarrLookupResult | null> {
  const results = await arrGet<SonarrLookupResult[]>('sonarr', `/api/v3/series/lookup?term=tvdb:${tvdbId}`);
  return results?.[0] ?? null;
}

export async function radarrFindExistingByTmdb(tmdbId: number): Promise<{ id: number } | null> {
  const results = await arrGet<Array<{ id: number; tmdbId: number }>>('radarr', `/api/v3/movie?tmdbId=${tmdbId}`);
  return results?.[0] ?? null;
}

export async function sonarrFindExistingByTvdb(tvdbId: number): Promise<{ id: number } | null> {
  const results = await arrGet<Array<{ id: number; tvdbId: number }>>('sonarr', '/api/v3/series');
  return results?.find((series) => series.tvdbId === tvdbId) ?? null;
}

export type SonarrEpisode = {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  monitored: boolean;
  hasFile: boolean;
};

/**
 * Season/episode-scoped requests (see routes/requests.ts, `scope` field) —
 * the shapes below match Sonarr v3's documented API as of this writing.
 * NOT verified against a live instance in this environment: if the
 * deployed Sonarr version's `/api/v3/docs` Swagger disagrees on the exact
 * route/body shape, this is the first place to check.
 */
export async function sonarrGetEpisodes(seriesId: number): Promise<SonarrEpisode[]> {
  const results = await arrGet<SonarrEpisode[]>('sonarr', `/api/v3/episode?seriesId=${seriesId}`);
  return results ?? [];
}

export async function sonarrMonitorEpisode(episodeIds: number[], monitored: boolean): Promise<boolean> {
  const result = await arrPut('sonarr', '/api/v3/episode/monitor', { episodeIds, monitored });
  return result.ok;
}

export async function sonarrTriggerCommand(
  name: 'EpisodeSearch' | 'SeasonSearch' | 'SeriesSearch',
  params: Record<string, unknown>
): Promise<boolean> {
  const result = await arrPost('sonarr', '/api/v3/command', { name, ...params });
  return result.ok;
}

export async function resolveTvdbId(tmdbId: number): Promise<number | null> {
  if (!env.tmdbApiKey) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(
      `https://api.themoviedb.org/3/tv/${tmdbId}/external_ids?api_key=${env.tmdbApiKey}`,
      { signal: controller.signal }
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { tvdb_id?: number | null };
    return data.tvdb_id ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
