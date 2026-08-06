import { decryptSecret } from './crypto.js';
import type { ContentType, XtreamStream } from './types.js';

export function normalizeServerUrl(serverUrl: string): string {
  return serverUrl.replace(/\/+$/, '');
}

export async function fetchXtream(
  account: { server_url: string; username: string; password_enc: string },
  action: string,
  params: Record<string, string> = {}
) {
  const password = decryptSecret(account.password_enc);
  const query = new URLSearchParams({
    username: account.username,
    password,
    action,
    ...params,
  });

  const url = `${normalizeServerUrl(account.server_url)}/player_api.php?${query.toString()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 IPTV-Web-Player',
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Xtream request failed: ${response.status}`);
  }

  return response.json();
}

export function getActionForCategories(type: ContentType): string {
  if (type === 'live') return 'get_live_categories';
  if (type === 'vod') return 'get_vod_categories';
  return 'get_series_categories';
}

export function getActionForContent(type: ContentType): string {
  if (type === 'live') return 'get_live_streams';
  if (type === 'vod') return 'get_vod_streams';
  return 'get_series';
}

export function getXtreamItemId(type: ContentType, entry: XtreamStream): string | null {
  const rawId = type === 'series' ? entry.series_id : entry.stream_id;
  if (rawId === undefined || rawId === null) return null;
  return String(rawId);
}
