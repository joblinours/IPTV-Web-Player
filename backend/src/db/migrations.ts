export interface Migration {
  version: string;
  up: string;
}

// TS-embedded migrations (not .sql files): the Dockerfile only `COPY src
// ./src`, so keeping everything inside the compiled TS tree avoids touching
// the Dockerfile/.dockerignore for a migrations/ directory.
export const migrations: Migration[] = [
  {
    version: '001_init',
    up: `
      CREATE TABLE users (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        email         VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        created_at    BIGINT       NOT NULL,
        UNIQUE KEY uq_users_email (email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE media_sources (
        id          INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id     INT UNSIGNED NOT NULL,
        kind        ENUM('xtream','jellyfin') NOT NULL DEFAULT 'xtream',
        name        VARCHAR(190) NOT NULL,
        server_url  VARCHAR(512) NOT NULL,
        username    VARCHAR(190) NOT NULL DEFAULT '',
        secret_enc  VARCHAR(1024) NOT NULL DEFAULT '',
        source_key  CHAR(64)     NOT NULL,
        created_at  BIGINT       NOT NULL,
        updated_at  BIGINT       NOT NULL,
        UNIQUE KEY uq_source_dedupe (user_id, source_key),
        KEY idx_source_user_kind (user_id, kind),
        CONSTRAINT fk_source_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE favorites (
        id         INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id    INT UNSIGNED NOT NULL,
        source_id  INT UNSIGNED NOT NULL,
        type       ENUM('live','vod','series') NOT NULL,
        item_id    VARCHAR(128) NOT NULL,
        created_at BIGINT       NOT NULL,
        UNIQUE KEY uq_fav (user_id, source_id, type, item_id),
        KEY idx_fav_scope (user_id, source_id, type),
        CONSTRAINT fk_fav_user   FOREIGN KEY (user_id)   REFERENCES users(id)         ON DELETE CASCADE,
        CONSTRAINT fk_fav_source FOREIGN KEY (source_id) REFERENCES media_sources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE watch_progress (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id          INT UNSIGNED NOT NULL,
        source_id        INT UNSIGNED NOT NULL,
        type             ENUM('vod','series_episode') NOT NULL,
        item_id          VARCHAR(128) NOT NULL,
        series_id        VARCHAR(128) NULL,
        season_number    INT NULL,
        episode_number   INT NULL,
        position_seconds DOUBLE   NOT NULL DEFAULT 0,
        total_duration   DOUBLE   NOT NULL DEFAULT 0,
        is_watched       TINYINT(1) NOT NULL DEFAULT 0,
        needs_transcode  TINYINT(1) NOT NULL DEFAULT 0,
        updated_at       BIGINT   NOT NULL,
        UNIQUE KEY uq_progress (user_id, source_id, type, item_id),
        KEY idx_progress_scope  (user_id, source_id, type),
        KEY idx_progress_series (user_id, source_id, series_id),
        CONSTRAINT fk_wp_user   FOREIGN KEY (user_id)   REFERENCES users(id)         ON DELETE CASCADE,
        CONSTRAINT fk_wp_source FOREIGN KEY (source_id) REFERENCES media_sources(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE user_preferences (
        user_id    INT UNSIGNED NOT NULL PRIMARY KEY,
        autoplay   TINYINT(1)  NOT NULL DEFAULT 1,
        language   VARCHAR(8)  NOT NULL DEFAULT 'fr',
        updated_at BIGINT      NOT NULL,
        CONSTRAINT fk_prefs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },
  {
    version: '002_requests',
    up: `
      CREATE TABLE tmdb_matches (
        id            INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        lookup_key    CHAR(64)     NOT NULL,
        media_type    ENUM('movie','tv') NOT NULL,
        matched       TINYINT(1)   NOT NULL DEFAULT 0,
        tmdb_id       INT UNSIGNED NULL,
        tvdb_id       INT UNSIGNED NULL,
        title         VARCHAR(512) NULL,
        overview      TEXT         NULL,
        poster_path   VARCHAR(255) NULL,
        backdrop_path VARCHAR(255) NULL,
        rating        DOUBLE       NULL,
        release_date  VARCHAR(10)  NULL,
        fetched_at    BIGINT       NOT NULL,
        UNIQUE KEY uq_tmdb_lookup (lookup_key),
        KEY idx_tmdb_id (media_type, tmdb_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE media_requests (
        id               INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        user_id          INT UNSIGNED NOT NULL,
        tmdb_id          INT UNSIGNED NOT NULL,
        tvdb_id          INT UNSIGNED NULL,
        media_type       ENUM('movie','tv') NOT NULL,
        title            VARCHAR(512) NOT NULL,
        year             SMALLINT UNSIGNED NULL,
        poster_path      VARCHAR(255) NULL,
        status           ENUM('pending','added','downloading','imported','available','failed','rejected')
                           NOT NULL DEFAULT 'pending',
        service          ENUM('radarr','sonarr') NOT NULL,
        service_item_id  INT UNSIGNED NULL,
        jellyfin_item_id VARCHAR(64) NULL,
        error_message    VARCHAR(512) NULL,
        requested_at     BIGINT NOT NULL,
        updated_at       BIGINT NOT NULL,
        UNIQUE KEY uq_request_per_user (user_id, media_type, tmdb_id),
        KEY idx_request_service (service, service_item_id),
        KEY idx_request_open (status, updated_at),
        KEY idx_request_tmdb (media_type, tmdb_id),
        CONSTRAINT fk_req_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

      CREATE TABLE webhook_events (
        id           INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        service      ENUM('radarr','sonarr') NOT NULL,
        event_type   VARCHAR(64)  NOT NULL,
        external_id  INT UNSIGNED NULL,
        payload_hash CHAR(64)     NOT NULL,
        received_at  BIGINT       NOT NULL,
        UNIQUE KEY uq_webhook_dedupe (payload_hash),
        KEY idx_webhook_received (received_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `,
  },
  {
    // Genre-based categorization (Jellyfin content categorized by its TMDB
    // genre instead of Jellyfin's own library name, and Xtream categories
    // folded into the same tab when their name matches — see lib/genres.ts)
    // reuses `tmdb_matches` as its cache, keyed by a distinct
    // `id|<type>|<tmdbId>` lookup_key namespace (direct id lookups, as
    // opposed to the existing title/year fuzzy-match lookup_key namespace)
    // so a Jellyfin item with a known tmdbId never needs fuzzy title
    // matching just to learn its genres.
    version: '003_genres',
    up: `
      ALTER TABLE tmdb_matches ADD COLUMN genres VARCHAR(255) NULL AFTER release_date;
    `,
  },
  {
    // Season/episode-level requests — a series request no longer always
    // means "the whole series". `season_number`/`episode_number` are
    // NOT NULL DEFAULT 0 ("not applicable to this scope") rather than
    // nullable: MySQL treats NULL as distinct in a unique key, which would
    // silently defeat the dedupe this key exists for. The old
    // (user_id, media_type, tmdb_id)-only key is dropped and replaced —
    // keeping both would still block "season 2" once "the whole series"
    // was already requested.
    version: '004_request_scope',
    up: `
      ALTER TABLE media_requests
        ADD COLUMN scope ENUM('series','season','episode') NOT NULL DEFAULT 'series' AFTER media_type,
        ADD COLUMN season_number SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER year,
        ADD COLUMN episode_number SMALLINT UNSIGNED NOT NULL DEFAULT 0 AFTER season_number,
        DROP INDEX uq_request_per_user,
        ADD UNIQUE KEY uq_request_per_user (user_id, media_type, tmdb_id, season_number, episode_number);
    `,
  },
];
