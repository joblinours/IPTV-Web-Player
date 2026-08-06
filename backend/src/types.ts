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

export type IptvAccountRow = {
  id: number;
  server_url: string;
  username: string;
  password_enc: string;
};
