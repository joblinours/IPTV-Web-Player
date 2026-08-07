export type ContentType = 'live' | 'vod' | 'series';

export type XtreamCategory = {
  category_id: string;
  category_name: string;
  parent_id?: number;
};

export type XtreamStream = {
  stream_id?: number;
  series_id?: number;
  category_id?: string;
  name?: string;
  title?: string;
  stream_icon?: string;
  cover?: string;
  container_extension?: string;
  rating?: string;
  genre?: string;
  plot?: string;
  year?: string;
  release_date?: string;
  added?: string;
  tv_archive?: number | string;
  tv_archive_duration?: number | string;
  epg_channel_id?: string;
  duration?: string;
  duration_secs?: number | string;
};

export type XtreamSeriesEpisode = {
  id?: string;
  episode_num?: number;
  title?: string;
  container_extension?: string;
  season?: number;
  info?: {
    duration?: string;
    duration_secs?: number;
    movie_image?: string;
    rating?: number;
    air_date?: string;
  };
};

export type XtreamSeriesInfoResponse = {
  info?: {
    name?: string;
    cover?: string;
    plot?: string;
    cast?: string;
    director?: string;
    genre?: string;
    releaseDate?: string;
    rating?: string;
    rating_5based?: string;
    episode_run_time?: string;
    backdrop_path?: string[];
  };
  episodes?: Record<string, XtreamSeriesEpisode[]>;
};

export type PlaybackTrace = {
  route: 'stream-url' | 'stream-proxy' | 'transcode';
  mode: 'direct' | 'proxy' | 'transcode';
  accountId: number;
  mediaType: ContentType;
  streamId: number;
  extension: string;
  mediaTitle?: string;
  seriesTitle?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  upstreamStatus?: number;
  fallbackWithoutRange?: boolean;
  note?: string;
};

export type SourceKind = 'xtream' | 'jellyfin';

export type MediaSourceRow = {
  id: number;
  user_id: number;
  kind: SourceKind;
  name: string;
  server_url: string;
  username: string;
  secret_enc: string;
};

/** Normalized content item shape returned by every provider (Xtream, Jellyfin, ...). */
export type ContentItem = {
  id: string;
  title: string;
  categoryId: string;
  poster: string | null;
  description: string | null;
  genre: string | null;
  year: string | null;
  epgChannelId: string | null;
  hasArchive: boolean;
  archiveDurationHours: number | null;
  rating: string | null;
  duration: string | null;
  durationSeconds: number | null;
  containerExtension: string | null;
  streamId: number | null;
  seriesId: number | null;
  // Added for the multi-source (Xtream + Jellyfin) abstraction.
  source: SourceKind;
  sourceId: number;
  itemId: string;
  tmdbId?: number | null;
};

export type PlaybackTarget = {
  url: string;
  headers?: Record<string, string>;
  hint: 'direct' | 'hls' | 'transcode';
};

export type CategoryItem = { id: string; name: string };

export type EpgItem = {
  title: string;
  description: string;
  start?: string;
  end?: string;
  startTimestamp?: number;
  stopTimestamp?: number;
};

export type SeriesEpisode = {
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
};

export type SeriesInfoResponse = {
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
  seasons: Array<{ seasonNumber: number; episodeCount: number }>;
  episodesBySeason: Record<string, SeriesEpisode[]>;
};
