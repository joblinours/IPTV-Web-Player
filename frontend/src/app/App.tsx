import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Header } from './components/Header';
import { Hero } from './components/Hero';
import { CategoryTabs } from './components/CategoryTabs';
import { LoginPage } from './components/LoginPage';
import { IptvCredentialsDialog } from './components/IptvCredentialsDialog';
import { PaginatedContentGrid } from './components/PaginatedContentGrid';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { SeriesDetailModal } from './components/SeriesDetailModal';
import { LiveRecordingsDialog } from './components/LiveRecordingsDialog';
import { LiveScheduleDialog } from './components/LiveScheduleDialog';
import {
    addIptvAccount,
    addFavorite,
    fetchCategories,
    fetchContentPage,
    fetchEpg,
    fetchFavorites,
    fetchProgress,
    fetchSeriesInfo,
    fetchSeriesProgress,
    fetchPreferences,
    fetchReplayUrl,
    fetchStreamUrl,
    buildStreamProxyUrl,
    buildTranscodeUrl,
    listIptvAccounts,
    login,
    register,
    removeFavorite,
    updateProgress,
    updatePreferences,
    type CategoryItem,
    type ContentItem,
    type EpgItem,
    type IptvAccount,
    type ProgressEntry,
    type SeriesEpisode,
    type SeriesInfoResponse,
    type SeriesProgressSummary,
    type UserPreferences,
    type PlaybackDebugContext,
    type SectionType,
} from './lib/api';

type CategoryMap = Record<SectionType, CategoryItem[]>;
type SelectedCategoryMap = Record<SectionType, string>;
type SeriesStatsMap = Record<number, { seasonsCount: number; episodesCount: number }>;
type FavoriteIdMap = Record<SectionType, Set<string>>;
type VodProgressMap = Record<string, ProgressEntry>;
type SeriesProgressMap = Record<string, SeriesProgressSummary>;
type EpisodeProgressMap = Record<string, { currentTime: number; totalDuration: number; isWatched: boolean; needsTranscode: boolean }>;

type CurrentlyPlayingMeta = {
    type: 'vod' | 'series_episode';
    itemId: string;
    accountId: number;
    seriesId?: string;
    seasonNumber?: number;
    episodeNumber?: number;
};

function findNextEpisode(
    seriesData: SeriesInfoResponse,
    seasonNumber: number,
    episodeNumber: number
): SeriesEpisode | null {
    const seasonKey = String(seasonNumber);
    const currentSeasonEps = seriesData.episodesBySeason[seasonKey] ?? [];
    const currentIdx = currentSeasonEps.findIndex((ep) => ep.episodeNumber === episodeNumber);
    if (currentIdx >= 0 && currentIdx < currentSeasonEps.length - 1) {
        return currentSeasonEps[currentIdx + 1];
    }

    // Try next seasons in order
    const orderedSeasons = seriesData.seasons.map((s) => s.seasonNumber).sort((a, b) => a - b);
    const currentSeasonIdx = orderedSeasons.indexOf(seasonNumber);
    if (currentSeasonIdx >= 0) {
        for (let i = currentSeasonIdx + 1; i < orderedSeasons.length; i++) {
            const nextEps = seriesData.episodesBySeason[String(orderedSeasons[i])] ?? [];
            if (nextEps.length > 0) return nextEps[0];
        }
    }
    return null;
}

function findPreviousEpisode(
    seriesData: SeriesInfoResponse,
    seasonNumber: number,
    episodeNumber: number
): SeriesEpisode | null {
    const seasonKey = String(seasonNumber);
    const currentSeasonEps = seriesData.episodesBySeason[seasonKey] ?? [];
    const currentIdx = currentSeasonEps.findIndex((ep) => ep.episodeNumber === episodeNumber);
    if (currentIdx > 0) {
        return currentSeasonEps[currentIdx - 1];
    }

    // Try previous seasons in reverse order.
    const orderedSeasons = seriesData.seasons.map((s) => s.seasonNumber).sort((a, b) => a - b);
    const currentSeasonIdx = orderedSeasons.indexOf(seasonNumber);
    if (currentSeasonIdx > 0) {
        for (let i = currentSeasonIdx - 1; i >= 0; i--) {
            const prevEps = seriesData.episodesBySeason[String(orderedSeasons[i])] ?? [];
            if (prevEps.length > 0) return prevEps[prevEps.length - 1];
        }
    }

    return null;
}

function reorderWithTranscodeFirst(sources: string[]): string[] {
    const idx = sources.findIndex((s) => s.includes('/api/iptv/transcode'));
    if (idx <= 0) return sources;
    return [sources[idx], ...sources.filter((_, i) => i !== idx)];
}

function addSeekToTranscodeSources(sources: string[], seekSeconds?: number): string[] {
    if (!seekSeconds || seekSeconds <= 0) return sources;

    return sources.map((source) => {
        if (!source.includes('/api/iptv/transcode')) return source;

        try {
            const isAbsolute = /^https?:\/\//i.test(source);
            const url = isAbsolute
                ? new URL(source)
                : new URL(source, window.location.origin);
            url.searchParams.set('seekSeconds', seekSeconds.toFixed(3));

            if (isAbsolute) return url.toString();
            return `${url.pathname}${url.search}${url.hash}`;
        } catch {
            // Keep the original source instead of breaking playback.
            return source;
        }
    });
}

const PAGE_SIZE = 50;

const defaultCategories: CategoryMap = {
    live: [{ id: 'favorites', name: 'Favoris' }, { id: 'all', name: 'Tous' }],
    films: [{ id: 'favorites', name: 'Favoris' }, { id: 'all', name: 'Tous' }],
    series: [{ id: 'favorites', name: 'Favoris' }, { id: 'all', name: 'Tous' }],
};

const defaultSelectedCategories: SelectedCategoryMap = {
    live: 'all',
    films: 'all',
    series: 'all',
};

function createDefaultFavoriteMap(): FavoriteIdMap {
    return {
        live: new Set<string>(),
        films: new Set<string>(),
        series: new Set<string>(),
    };
}

function uniqueExtensions(extensions: string[]): string[] {
    const seen = new Set<string>();
    const output: string[] = [];
    for (const extension of extensions) {
        const normalized = extension.toLowerCase();
        if (!seen.has(normalized)) {
            seen.add(normalized);
            output.push(normalized);
        }
    }
    return output;
}

function toEpochSeconds(item: EpgItem, useStop: boolean): number | null {
    const timestamp = useStop ? item.stopTimestamp : item.startTimestamp;
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
        return timestamp;
    }

    const raw = useStop ? item.end : item.start;
    if (!raw) return null;

    const parsed = Date.parse(raw.replace(' ', 'T'));
    if (Number.isNaN(parsed)) return null;
    return Math.floor(parsed / 1000);
}

export default function App() {
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('iptv_token'));
    const [accounts, setAccounts] = useState<IptvAccount[]>([]);
    const [accountId, setAccountId] = useState<number | null>(null);
    const [activeSection, setActiveSection] = useState<SectionType>('live');
    const [categoriesBySection, setCategoriesBySection] = useState<CategoryMap>(defaultCategories);
    const [selectedCategories, setSelectedCategories] = useState<SelectedCategoryMap>(defaultSelectedCategories);
    const [searchQuery, setSearchQuery] = useState('');
    const [isDarkMode, setIsDarkMode] = useState(true);

    const [items, setItems] = useState<ContentItem[]>([]);
    const [nextOffset, setNextOffset] = useState(0);
    const [hasMore, setHasMore] = useState(true);
    const [isLoadingContent, setIsLoadingContent] = useState(false);
    const [isLoadingAuth, setIsLoadingAuth] = useState(false);
    const [isLoadingIptvSetup, setIsLoadingIptvSetup] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const [iptvSetupError, setIptvSetupError] = useState<string | null>(null);

    const [showIptvDialog, setShowIptvDialog] = useState(false);

    const [playerOpen, setPlayerOpen] = useState(false);
    const [playerTitle, setPlayerTitle] = useState('');
    const [playerUrl, setPlayerUrl] = useState<string | null>(null);
    const [playerSources, setPlayerSources] = useState<string[]>([]);

    const [seriesDetailOpen, setSeriesDetailOpen] = useState(false);
    const [seriesDetailData, setSeriesDetailData] = useState<SeriesInfoResponse | null>(null);
    const [seriesDetailLoading, setSeriesDetailLoading] = useState(false);
    const [seriesStatsMap, setSeriesStatsMap] = useState<SeriesStatsMap>({});
    const [favoritesBySection, setFavoritesBySection] = useState<FavoriteIdMap>(() => createDefaultFavoriteMap());

    const [recordingsOpen, setRecordingsOpen] = useState(false);
    const [recordingsTitle, setRecordingsTitle] = useState('');
    const [recordingsLoading, setRecordingsLoading] = useState(false);
    const [recordingsItems, setRecordingsItems] = useState<EpgItem[]>([]);
    const [recordingsStreamId, setRecordingsStreamId] = useState<number | null>(null);

    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleTitle, setScheduleTitle] = useState('');
    const [scheduleLoading, setScheduleLoading] = useState(false);
    const [scheduleItems, setScheduleItems] = useState<EpgItem[]>([]);

    // ── Watch progress & preferences ─────────────────────────────────────────
    const [preferences, setPreferences] = useState<UserPreferences>({ autoplay: true, language: 'fr' });
    const [vodProgressMap, setVodProgressMap] = useState<VodProgressMap>({});
    const [seriesProgressMap, setSeriesProgressMap] = useState<SeriesProgressMap>({});
    const [episodeProgressMap, setEpisodeProgressMap] = useState<EpisodeProgressMap>({});
    const [playerStartTime, setPlayerStartTime] = useState<number | undefined>(undefined);
    const [playerRealDuration, setPlayerRealDuration] = useState<number | undefined>(undefined);
    const [seriesDetailItemId, setSeriesDetailItemId] = useState<number | null>(null);
    const [currentSeriesPlayContext, setCurrentSeriesPlayContext] = useState<{
        seriesData: SeriesInfoResponse;
        currentEpisode: SeriesEpisode;
    } | null>(null);
    const currentlyPlayingRef = useRef<CurrentlyPlayingMeta | null>(null);
    // Set to true when the player falls back to ffmpeg transcode; piggybacked onto next updateProgress call
    const needsTranscodeFlagRef = useRef(false);

    const currentCategory = selectedCategories[activeSection];
    const featuredItem = useMemo(() => items[0] ?? null, [items]);

    const enrichedItems = useMemo(() => {
        if (activeSection !== 'series') return items;

        return items.map((item) => {
            if (!item.seriesId) return item;
            const stats = seriesStatsMap[item.seriesId];
            if (!stats) return item;

            return {
                ...item,
                seasonsCount: stats.seasonsCount,
                episodesCount: stats.episodesCount,
            };
        });
    }, [activeSection, items, seriesStatsMap]);

    const refreshAccounts = useCallback(async () => {
        if (!token) return;

        const response = await listIptvAccounts(token);
        setAccounts(response.items);

        if (!accountId) {
            setAccountId(response.items[0]?.id ?? null);
            return;
        }

        const stillExists = response.items.some((account) => account.id === accountId);
        if (!stillExists) {
            setAccountId(response.items[0]?.id ?? null);
        }
    }, [token, accountId]);

    useEffect(() => {
        if (!token) return;
        refreshAccounts().catch(() => {
            localStorage.removeItem('iptv_token');
            setToken(null);
            setAccountId(null);
            setAccounts([]);
        });
    }, [token, refreshAccounts]);

    useEffect(() => {
        setShowIptvDialog(!!token && !accountId);
    }, [token, accountId]);

    useEffect(() => {
        if (!token || !accountId) return;

        let cancelled = false;

        const loadCategories = async () => {
            try {
                const result = await fetchCategories(token, accountId, activeSection);
                if (cancelled) return;

                setCategoriesBySection((prev) => ({ ...prev, [activeSection]: result.items }));

                const selectedValue = selectedCategories[activeSection];
                const hasCurrentCategory = result.items.some((item) => item.id === selectedValue);

                if (!hasCurrentCategory) {
                    setSelectedCategories((prev) => ({ ...prev, [activeSection]: 'all' }));
                    return;
                }

            } catch {
                if (!cancelled) {
                    setCategoriesBySection((prev) => ({
                        ...prev,
                        [activeSection]: [{ id: 'favorites', name: 'Favoris' }, { id: 'all', name: 'Tous' }],
                    }));
                    setSelectedCategories((prev) => ({ ...prev, [activeSection]: 'all' }));
                }
            }
        };

        loadCategories();

        return () => {
            cancelled = true;
        };
    }, [activeSection, accountId, selectedCategories, token]);

    useEffect(() => {
        if (!token || !accountId) return;

        let cancelled = false;

        const loadFavorites = async () => {
            try {
                const result = await fetchFavorites(token, accountId, activeSection);
                if (cancelled) return;

                setFavoritesBySection((prev) => ({
                    ...prev,
                    [activeSection]: new Set(result.items),
                }));
            } catch {
                if (!cancelled) {
                    setFavoritesBySection((prev) => ({
                        ...prev,
                        [activeSection]: new Set<string>(),
                    }));
                }
            }
        };

        loadFavorites();

        return () => {
            cancelled = true;
        };
    }, [token, accountId, activeSection]);

    useEffect(() => {
        if (!token || !accountId) return;

        let cancelled = false;

        const loadFirstPage = async () => {
            setIsLoadingContent(true);
            try {
                const result = await fetchContentPage(token, {
                    accountId,
                    section: activeSection,
                    categoryId: currentCategory,
                    searchQuery,
                    offset: 0,
                    limit: PAGE_SIZE,
                });

                if (cancelled) return;

                setItems(result.items);
                setHasMore(result.pagination.hasMore);
                setNextOffset(result.pagination.nextOffset ?? 0);
            } catch {
                if (!cancelled) {
                    setItems([]);
                    setHasMore(false);
                    setNextOffset(0);
                }
            } finally {
                if (!cancelled) {
                    setIsLoadingContent(false);
                }
            }
        };

        loadFirstPage();

        return () => {
            cancelled = true;
        };
    }, [token, accountId, activeSection, currentCategory, searchQuery]);

    // Load user preferences when authenticated
    useEffect(() => {
        if (!token) return;
        fetchPreferences(token)
            .then((prefs) => setPreferences(prefs))
            .catch(() => {});
    }, [token]);

    // Prefetch series stats (seasons/episodes count)
    useEffect(() => {

        const targets = items
            .filter((item) => !!item.seriesId && !seriesStatsMap[item.seriesId])
            .slice(0, 8);

        if (targets.length === 0) return;

        let cancelled = false;

        const prefetch = async () => {
            for (const target of targets) {
                if (cancelled || !target.seriesId) break;
                try {
                    const details = await fetchSeriesInfo(token, accountId, target.seriesId);
                    if (cancelled) break;

                    const seasonsCount = details.seasons.length;
                    const episodesCount = Object.values(details.episodesBySeason).reduce((total, list) => total + list.length, 0);

                    setSeriesStatsMap((prev) => ({
                        ...prev,
                        [target.seriesId as number]: { seasonsCount, episodesCount },
                    }));
                } catch {
                    // ignore
                }
            }
        };

        prefetch();

        return () => {
            cancelled = true;
        };
    }, [token, accountId, activeSection, items, seriesStatsMap]);

    // Prefetch series progress summaries (for smart play button on tiles)
    useEffect(() => {
        if (!token || !accountId || activeSection !== 'series' || items.length === 0) return;

        const targets = items.filter((item) => !!item.seriesId).slice(0, 8);
        if (targets.length === 0) return;

        let cancelled = false;

        const load = async () => {
            for (const target of targets) {
                if (cancelled || !target.seriesId) break;
                try {
                    const prog = await fetchSeriesProgress(token, accountId, String(target.seriesId));
                    if (cancelled) break;
                    setSeriesProgressMap((prev) => ({
                        ...prev,
                        [`${accountId}:${target.seriesId}`]: prog,
                    }));
                } catch {
                    // ignore
                }
            }
        };

        load();
        return () => { cancelled = true; };
    }, [token, accountId, activeSection, items]);

    // Prefetch VOD progress for current page
    useEffect(() => {
        if (!token || !accountId || activeSection !== 'films' || items.length === 0) return;

        const itemIds = items.slice(0, 50).map((item) => item.id).filter(Boolean);
        if (itemIds.length === 0) return;

        let cancelled = false;

        fetchProgress(token, accountId, 'vod', itemIds)
            .then((result) => {
                if (cancelled) return;
                const map: VodProgressMap = {};
                for (const entry of result.items) {
                    map[`${accountId}:${entry.itemId}`] = entry;
                }
                setVodProgressMap((prev) => ({ ...prev, ...map }));
            })
            .catch(() => {});

        return () => { cancelled = true; };
    }, [token, accountId, activeSection, items]);

    const handleLoadMore = useCallback(async () => {
        if (!token || !accountId || isLoadingContent || !hasMore) {
            return;
        }

        setIsLoadingContent(true);
        try {
            const result = await fetchContentPage(token, {
                accountId,
                section: activeSection,
                categoryId: currentCategory,
                searchQuery,
                offset: nextOffset,
                limit: PAGE_SIZE,
            });

            setItems((prev) => [...prev, ...result.items]);
            setHasMore(result.pagination.hasMore);
            setNextOffset(result.pagination.nextOffset ?? nextOffset);
        } finally {
            setIsLoadingContent(false);
        }
    }, [token, accountId, isLoadingContent, hasMore, activeSection, currentCategory, searchQuery, nextOffset]);

    const handleLogin = async (payload: { appEmail: string; appPassword: string }) => {
        setAuthError(null);
        setIsLoadingAuth(true);

        try {
            const auth = await login({ email: payload.appEmail, password: payload.appPassword });
            localStorage.setItem('iptv_token', auth.token);
            setToken(auth.token);
            await refreshAccounts();
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Connexion impossible');
            localStorage.removeItem('iptv_token');
            setToken(null);
            setAccountId(null);
            setAccounts([]);
        } finally {
            setIsLoadingAuth(false);
        }
    };

    const handleRegister = async (payload: { appEmail: string; appPassword: string }) => {
        setAuthError(null);
        setIsLoadingAuth(true);

        try {
            await register({ email: payload.appEmail, password: payload.appPassword });
            const auth = await login({ email: payload.appEmail, password: payload.appPassword });
            localStorage.setItem('iptv_token', auth.token);
            setToken(auth.token);
            setAccountId(null);
            setAccounts([]);
        } catch (error) {
            setAuthError(error instanceof Error ? error.message : 'Création de compte impossible');
            localStorage.removeItem('iptv_token');
            setToken(null);
            setAccountId(null);
            setAccounts([]);
        } finally {
            setIsLoadingAuth(false);
        }
    };

    const handleAddIptvAccount = async (payload: {
        name: string;
        serverUrl: string;
        username: string;
        password: string;
    }) => {
        if (!token) return;

        setIptvSetupError(null);
        setIsLoadingIptvSetup(true);
        try {
            const created = await addIptvAccount(token, {
                name: payload.name,
                serverUrl: payload.serverUrl,
                username: payload.username,
                password: payload.password,
            });
            await refreshAccounts();
            setAccountId(Number(created.accountId));
            setShowIptvDialog(false);
        } catch (error) {
            setIptvSetupError(error instanceof Error ? error.message : 'Impossible d\'ajouter le compte IPTV');
        } finally {
            setIsLoadingIptvSetup(false);
        }
    };

    const handleSwitchAccount = (newAccountId: number) => {
        setAccountId(newAccountId);
        setItems([]);
        setNextOffset(0);
        setHasMore(true);
        setRecordingsOpen(false);
        setScheduleOpen(false);
        setSeriesDetailOpen(false);
        setFavoritesBySection(createDefaultFavoriteMap());
        setVodProgressMap({});
        setSeriesProgressMap({});
        setEpisodeProgressMap({});
        setCurrentSeriesPlayContext(null);
        setPlayerStartTime(undefined);
        setPlayerRealDuration(undefined);
        needsTranscodeFlagRef.current = false;
        currentlyPlayingRef.current = null;
    };

    const handleLogout = () => {
        localStorage.removeItem('iptv_token');
        setToken(null);
        setAccountId(null);
        setAccounts([]);
        setActiveSection('live');
        setSearchQuery('');
        setItems([]);
        setNextOffset(0);
        setHasMore(true);
        setPlayerOpen(false);
        setPlayerUrl(null);
        setPlayerSources([]);
        setSeriesDetailOpen(false);
        setSeriesDetailData(null);
        setIptvSetupError(null);
        setRecordingsOpen(false);
        setScheduleOpen(false);
        setFavoritesBySection(createDefaultFavoriteMap());
        setPreferences({ autoplay: true, language: 'fr' });
        setVodProgressMap({});
        setSeriesProgressMap({});
        setEpisodeProgressMap({});
        setCurrentSeriesPlayContext(null);
        setPlayerStartTime(undefined);
        setPlayerRealDuration(undefined);
        needsTranscodeFlagRef.current = false;
        currentlyPlayingRef.current = null;
    };

    const handleToggleFavorite = useCallback(
        async (item: ContentItem) => {
            if (!token || !accountId || !item.id) return;

            const itemId = item.id;
            const wasFavorite = favoritesBySection[activeSection]?.has(itemId) ?? false;

            setFavoritesBySection((prev) => {
                const nextSet = new Set(prev[activeSection]);
                if (nextSet.has(itemId)) {
                    nextSet.delete(itemId);
                } else {
                    nextSet.add(itemId);
                }

                return {
                    ...prev,
                    [activeSection]: nextSet,
                };
            });

            try {
                if (wasFavorite) {
                    await removeFavorite(token, { accountId, section: activeSection, itemId });
                } else {
                    await addFavorite(token, { accountId, section: activeSection, itemId });
                }
            } catch {
                setFavoritesBySection((prev) => {
                    const rollbackSet = new Set(prev[activeSection]);
                    if (wasFavorite) {
                        rollbackSet.add(itemId);
                    } else {
                        rollbackSet.delete(itemId);
                    }

                    return {
                        ...prev,
                        [activeSection]: rollbackSet,
                    };
                });
            }
        },
        [token, accountId, activeSection, favoritesBySection]
    );

    const resolvePlaybackSources = useCallback(
        async (
            item: ContentItem,
            section: SectionType,
            streamId: number,
            debugContext?: PlaybackDebugContext
        ) => {
            if (!token || !accountId) return [];

            const normalizedContainer = (item.containerExtension ?? '').toLowerCase();
            const base =
                section === 'live'
                    // Prefer TS first for better compatibility with proxied live streams,
                    // then try m3u8 and the provider-declared extension.
                    ? ['ts', 'm3u8', normalizedContainer || 'ts']
                    : [normalizedContainer || 'mp4', 'mp4', 'ts', 'm3u8'];

            const candidates = uniqueExtensions(base);
            const urls = await Promise.all(
                candidates.map(async (extension) => {
                    try {
                        if (section === 'live') {
                            const response = await fetchStreamUrl(token, {
                                accountId,
                                section,
                                streamId,
                                containerExtension: extension,
                                debugContext,
                            });
                            return response.url;
                        }

                        return buildStreamProxyUrl({
                            token,
                            accountId,
                            section,
                            streamId,
                            containerExtension: extension,
                            debugContext,
                        });
                    } catch {
                        return null;
                    }
                })
            );

            if ((section === 'films' || section === 'series') && normalizedContainer === 'mkv') {
                urls.splice(
                    1,
                    0,
                    buildTranscodeUrl({
                        token,
                        accountId,
                        section,
                        streamId,
                        containerExtension: 'mkv',
                        debugContext,
                    })
                );
            }

            if (section === 'live') {
                urls.push(
                    buildTranscodeUrl({
                        token,
                        accountId,
                        section,
                        streamId,
                        containerExtension: normalizedContainer || 'ts',
                        debugContext,
                    })
                );
            }

            return urls.filter((url): url is string => !!url);
        },
        [token, accountId]
    );

    const openPlayer = (title: string, sources: string[]) => {
        if (sources.length === 0) return;
        setPlayerTitle(title);
        setPlayerUrl(sources[0]);
        setPlayerSources(sources);
        setPlayerOpen(true);
    };

    const handlePlayerProgress = useCallback(
        (currentTime: number, duration: number) => {
            if (!token || !accountId) return;
            const ctx = currentlyPlayingRef.current;
            if (!ctx) return;

            const needsTranscode = needsTranscodeFlagRef.current || undefined;

            updateProgress(token, {
                accountId: ctx.accountId,
                type: ctx.type,
                itemId: ctx.itemId,
                seriesId: ctx.seriesId,
                seasonNumber: ctx.seasonNumber,
                episodeNumber: ctx.episodeNumber,
                currentTime,
                totalDuration: duration,
                needsTranscode,
            }).catch(() => {});

            const isWatched = duration > 0 && duration - currentTime <= 10;

            if (ctx.type === 'vod') {
                setVodProgressMap((prev) => ({
                    ...prev,
                    [`${accountId}:${ctx.itemId}`]: {
                        itemId: ctx.itemId,
                        currentTime,
                        totalDuration: duration,
                        isWatched,
                        needsTranscode: needsTranscode ?? false,
                        updatedAt: Math.floor(Date.now() / 1000),
                    },
                }));
            } else if (ctx.type === 'series_episode' && ctx.seriesId) {
                setEpisodeProgressMap((prev) => ({
                    ...prev,
                    [ctx.itemId]: { currentTime, totalDuration: duration, isWatched, needsTranscode: needsTranscode ?? false },
                }));
                setSeriesProgressMap((prev) => {
                    const key = `${accountId}:${ctx.seriesId}`;
                    const existing = prev[key];
                    return {
                        ...prev,
                        [key]: {
                            lastEpisode: {
                                episodeId: ctx.itemId,
                                seasonNumber: ctx.seasonNumber ?? null,
                                episodeNumber: ctx.episodeNumber ?? null,
                                currentTime,
                                totalDuration: duration,
                                isWatched,
                                needsTranscode: needsTranscode ?? false,
                            },
                            watchedEpisodeIds: existing?.watchedEpisodeIds ?? [],
                        },
                    };
                });
            }
        },
        [token, accountId]
    );

    const handlePlayerEnded = useCallback(
        (currentTime: number, duration: number) => {
            if (!token || !accountId) return;
            const ctx = currentlyPlayingRef.current;
            if (!ctx) return;

            const needsTranscode = needsTranscodeFlagRef.current || undefined;

            updateProgress(token, {
                accountId: ctx.accountId,
                type: ctx.type,
                itemId: ctx.itemId,
                seriesId: ctx.seriesId,
                seasonNumber: ctx.seasonNumber,
                episodeNumber: ctx.episodeNumber,
                currentTime,
                totalDuration: duration,
                isWatched: true,
                needsTranscode,
            }).catch(() => {});

            if (ctx.type === 'vod') {
                setVodProgressMap((prev) => ({
                    ...prev,
                    [`${accountId}:${ctx.itemId}`]: {
                        itemId: ctx.itemId,
                        currentTime,
                        totalDuration: duration,
                        isWatched: true,
                        needsTranscode: needsTranscode ?? false,
                        updatedAt: Math.floor(Date.now() / 1000),
                    },
                }));
            } else if (ctx.type === 'series_episode' && ctx.seriesId) {
                setEpisodeProgressMap((prev) => ({
                    ...prev,
                    [ctx.itemId]: { currentTime, totalDuration: duration, isWatched: true, needsTranscode: needsTranscode ?? false },
                }));
                setSeriesProgressMap((prev) => {
                    const key = `${accountId}:${ctx.seriesId}`;
                    const existing = prev[key];
                    const newWatched = new Set(existing?.watchedEpisodeIds ?? []);
                    newWatched.add(ctx.itemId);
                    return {
                        ...prev,
                        [key]: {
                            lastEpisode: {
                                episodeId: ctx.itemId,
                                seasonNumber: ctx.seasonNumber ?? null,
                                episodeNumber: ctx.episodeNumber ?? null,
                                currentTime,
                                totalDuration: duration,
                                isWatched: true,
                                needsTranscode: needsTranscode ?? false,
                            },
                            watchedEpisodeIds: [...newWatched],
                        },
                    };
                });
            }
        },
        [token, accountId]
    );

    const handleTranscodeFallback = useCallback(() => {
        needsTranscodeFlagRef.current = true;
    }, []);

    const handleNextEpisode = useCallback(async () => {
        if (!token || !accountId || !currentSeriesPlayContext) return;
        const { seriesData, currentEpisode } = currentSeriesPlayContext;
        const currentSeriesId = currentlyPlayingRef.current?.seriesId;

        const next = findNextEpisode(seriesData, currentEpisode.seasonNumber, currentEpisode.episodeNumber);
        if (!next) return;

        const rawSources = await resolvePlaybackSources(
            {
                id: String(next.id),
                title: next.title,
                categoryId: '',
                poster: next.poster,
                description: null,
                genre: null,
                year: null,
                rating: next.rating ? String(next.rating) : null,
                containerExtension: next.containerExtension,
                streamId: null,
                seriesId: next.id,
            },
            'series',
            next.id,
            {
                mediaTitle: next.title,
                seriesTitle: seriesData.info.name,
                seasonNumber: next.seasonNumber,
                episodeNumber: next.episodeNumber,
            }
        );

        if (rawSources.length === 0) return;

        const nextEpProg = episodeProgressMap[String(next.id)];
        const sources = nextEpProg?.needsTranscode ? reorderWithTranscodeFirst(rawSources) : rawSources;

        currentlyPlayingRef.current = {
            type: 'series_episode',
            itemId: String(next.id),
            accountId,
            seriesId: currentSeriesId,
            seasonNumber: next.seasonNumber,
            episodeNumber: next.episodeNumber,
        };
        setCurrentSeriesPlayContext({ seriesData, currentEpisode: next });
        setPlayerStartTime(undefined);
        setPlayerRealDuration(next.durationSeconds ?? undefined);
        needsTranscodeFlagRef.current = false;
        setPlayerTitle(next.title);
        setPlayerUrl(sources[0]);
        setPlayerSources(sources);
    }, [token, accountId, currentSeriesPlayContext, resolvePlaybackSources, episodeProgressMap]);

    const handlePreviousEpisode = useCallback(async () => {
        if (!token || !accountId || !currentSeriesPlayContext) return;
        const { seriesData, currentEpisode } = currentSeriesPlayContext;
        const currentSeriesId = currentlyPlayingRef.current?.seriesId;

        const previous = findPreviousEpisode(
            seriesData,
            currentEpisode.seasonNumber,
            currentEpisode.episodeNumber
        );
        // At the very first available episode: no-op by design.
        if (!previous) return;

        const rawSources = await resolvePlaybackSources(
            {
                id: String(previous.id),
                title: previous.title,
                categoryId: '',
                poster: previous.poster,
                description: null,
                genre: null,
                year: null,
                rating: previous.rating ? String(previous.rating) : null,
                containerExtension: previous.containerExtension,
                streamId: null,
                seriesId: previous.id,
            },
            'series',
            previous.id,
            {
                mediaTitle: previous.title,
                seriesTitle: seriesData.info.name,
                seasonNumber: previous.seasonNumber,
                episodeNumber: previous.episodeNumber,
            }
        );

        if (rawSources.length === 0) return;

        const previousEpProg = episodeProgressMap[String(previous.id)];
        const sources = previousEpProg?.needsTranscode
            ? reorderWithTranscodeFirst(rawSources)
            : rawSources;

        currentlyPlayingRef.current = {
            type: 'series_episode',
            itemId: String(previous.id),
            accountId,
            seriesId: currentSeriesId,
            seasonNumber: previous.seasonNumber,
            episodeNumber: previous.episodeNumber,
        };
        setCurrentSeriesPlayContext({ seriesData, currentEpisode: previous });
        setPlayerStartTime(undefined);
        setPlayerRealDuration(previous.durationSeconds ?? undefined);
        needsTranscodeFlagRef.current = false;
        setPlayerTitle(previous.title);
        setPlayerUrl(sources[0]);
        setPlayerSources(sources);
    }, [token, accountId, currentSeriesPlayContext, resolvePlaybackSources, episodeProgressMap]);

    const handleOpenSeriesDetails = useCallback(
        async (item: ContentItem) => {
            if (!token || !accountId || !item.seriesId) return;

            setSeriesDetailLoading(true);
            setSeriesDetailOpen(true);
            setSeriesDetailItemId(item.seriesId);

            try {
                const data = await fetchSeriesInfo(token, accountId, item.seriesId);
                setSeriesDetailData(data);

                const seasonsCount = data.seasons.length;
                const episodesCount = Object.values(data.episodesBySeason).reduce((total, list) => total + list.length, 0);
                setSeriesStatsMap((prev) => ({
                    ...prev,
                    [item.seriesId as number]: { seasonsCount, episodesCount },
                }));

                // Load episode-level progress for the series detail modal
                const allEpisodeIds = Object.values(data.episodesBySeason)
                    .flat()
                    .map((ep) => String(ep.id));
                if (allEpisodeIds.length > 0) {
                    fetchProgress(token, accountId, 'series_episode', allEpisodeIds)
                        .then((result) => {
                            const map: EpisodeProgressMap = {};
                            for (const entry of result.items) {
                                map[entry.itemId] = {
                                    currentTime: entry.currentTime,
                                    totalDuration: entry.totalDuration,
                                    isWatched: entry.isWatched,
                                    needsTranscode: entry.needsTranscode,
                                };
                            }
                            setEpisodeProgressMap(map);
                        })
                        .catch(() => {});
                }
            } catch {
                setSeriesDetailData(null);
            } finally {
                setSeriesDetailLoading(false);
            }
        },
        [token, accountId]
    );

    const handlePlay = useCallback(
        async (item: ContentItem) => {
            if (!token || !accountId) return;
            try {
                if (activeSection === 'series') {
                    if (!item.seriesId) {
                        await handleOpenSeriesDetails(item);
                        return;
                    }

                    const progressKey = `${accountId}:${item.seriesId}`;
                    const prog = seriesProgressMap[progressKey];

                    if (!prog?.lastEpisode) {
                        // No progress yet -> open detail modal (default behaviour)
                        await handleOpenSeriesDetails(item);
                        return;
                    }

                    const { lastEpisode } = prog;
                    const remaining =
                        lastEpisode.totalDuration > 0
                            ? lastEpisode.totalDuration - lastEpisode.currentTime
                            : Infinity;

                    setSeriesDetailLoading(false);
                    let seriesData: SeriesInfoResponse;
                    try {
                        setSeriesDetailLoading(true);
                        seriesData = await fetchSeriesInfo(token, accountId, item.seriesId);
                    } catch {
                        setSeriesDetailLoading(false);
                        await handleOpenSeriesDetails(item);
                        return;
                    }
                    setSeriesDetailLoading(false);

                    let targetEpisode: SeriesEpisode | null = null;
                    let startTimeSec: number | undefined = undefined;

                    if (lastEpisode.isWatched || remaining <= 10) {
                        // Find and play next episode
                        targetEpisode = findNextEpisode(
                            seriesData,
                            lastEpisode.seasonNumber ?? 1,
                            lastEpisode.episodeNumber ?? 1
                        );
                        if (!targetEpisode) {
                            // Series finished -> open modal
                            await handleOpenSeriesDetails(item);
                            return;
                        }
                    } else {
                        // Resume the in-progress episode
                        const episodeIdNum = Number(lastEpisode.episodeId);
                        for (const episodes of Object.values(seriesData.episodesBySeason)) {
                            const found = episodes.find((ep) => ep.id === episodeIdNum);
                            if (found) {
                                targetEpisode = found;
                                break;
                            }
                        }
                        if (!targetEpisode) {
                            await handleOpenSeriesDetails(item);
                            return;
                        }
                        startTimeSec = lastEpisode.currentTime > 0 ? lastEpisode.currentTime : undefined;
                    }

                    const rawSources = await resolvePlaybackSources(
                        {
                            id: String(targetEpisode.id),
                            title: targetEpisode.title,
                            categoryId: '',
                            poster: targetEpisode.poster,
                            description: null,
                            genre: null,
                            year: null,
                            rating: targetEpisode.rating ? String(targetEpisode.rating) : null,
                            containerExtension: targetEpisode.containerExtension,
                            streamId: null,
                            seriesId: targetEpisode.id,
                        },
                        'series',
                        targetEpisode.id,
                        {
                            mediaTitle: targetEpisode.title,
                            seriesTitle: seriesData.info.name,
                            seasonNumber: targetEpisode.seasonNumber,
                            episodeNumber: targetEpisode.episodeNumber,
                        }
                    );

                    // If this episode previously needed transcode, skip straight to it.
                    const epNeedsTranscode =
                        lastEpisode.needsTranscode ||
                        (episodeProgressMap[lastEpisode.episodeId]?.needsTranscode ?? false);
                    const sources = epNeedsTranscode
                        ? addSeekToTranscodeSources(reorderWithTranscodeFirst(rawSources), startTimeSec)
                        : rawSources;

                    currentlyPlayingRef.current = {
                        type: 'series_episode',
                        itemId: String(targetEpisode.id),
                        accountId,
                        seriesId: String(item.seriesId),
                        seasonNumber: targetEpisode.seasonNumber,
                        episodeNumber: targetEpisode.episodeNumber,
                    };
                    setCurrentSeriesPlayContext({ seriesData, currentEpisode: targetEpisode });
                    setPlayerStartTime(startTimeSec);
                    setPlayerRealDuration(targetEpisode.durationSeconds ?? undefined);
                    needsTranscodeFlagRef.current = false;
                    openPlayer(targetEpisode.title, sources);
                    return;
                }

                const streamId = item.streamId;
                if (!streamId) return;

                const vodProg = vodProgressMap[`${accountId}:${item.id}`];
                const vodStartTimeSec =
                    vodProg && !vodProg.isWatched && vodProg.currentTime > 0
                        ? vodProg.currentTime
                        : undefined;
                const rawVodSources = await resolvePlaybackSources(item, activeSection, streamId, {
                    mediaTitle: item.title,
                });
                const vodSources = vodProg?.needsTranscode
                    ? addSeekToTranscodeSources(reorderWithTranscodeFirst(rawVodSources), vodStartTimeSec)
                    : rawVodSources;
                currentlyPlayingRef.current = {
                    type: 'vod',
                    itemId: item.id,
                    accountId,
                };
                setCurrentSeriesPlayContext(null);
                setPlayerStartTime(vodStartTimeSec);
                const providerDuration = item.durationSeconds && item.durationSeconds > 0 ? item.durationSeconds : undefined;
                setPlayerRealDuration(providerDuration ?? (vodProg?.totalDuration && vodProg.totalDuration > 0 ? vodProg.totalDuration : undefined));
                needsTranscodeFlagRef.current = false;
                openPlayer(item.title, vodSources);
            } catch (error) {
                console.error('Playback start failed', error);
            }
        },
        [token, accountId, activeSection, resolvePlaybackSources, handleOpenSeriesDetails, seriesProgressMap, episodeProgressMap, vodProgressMap]
    );

    const handlePlayEpisode = useCallback(
        async (episode: SeriesEpisode) => {
            if (!token || !accountId) return;

            try {
                // Resume from saved position if episode is in progress
                const epProg = episodeProgressMap[String(episode.id)];
                const startTimeSec =
                    epProg && !epProg.isWatched && epProg.currentTime > 0
                        ? epProg.currentTime
                        : undefined;

                const rawSources = await resolvePlaybackSources(
                    {
                        id: String(episode.id),
                        title: episode.title,
                        categoryId: '',
                        poster: episode.poster,
                        description: null,
                        genre: null,
                        year: null,
                        rating: episode.rating ? String(episode.rating) : null,
                        containerExtension: episode.containerExtension,
                        streamId: null,
                        seriesId: episode.id,
                    },
                    'series',
                    episode.id,
                    {
                        mediaTitle: episode.title,
                        seriesTitle: seriesDetailData?.info.name ?? undefined,
                        seasonNumber: episode.seasonNumber,
                        episodeNumber: episode.episodeNumber,
                    }
                );

                const sources = epProg?.needsTranscode
                    ? addSeekToTranscodeSources(reorderWithTranscodeFirst(rawSources), startTimeSec)
                    : rawSources;

                currentlyPlayingRef.current = {
                    type: 'series_episode',
                    itemId: String(episode.id),
                    accountId,
                    seriesId: seriesDetailItemId !== null ? String(seriesDetailItemId) : undefined,
                    seasonNumber: episode.seasonNumber,
                    episodeNumber: episode.episodeNumber,
                };
                setCurrentSeriesPlayContext(
                    seriesDetailData ? { seriesData: seriesDetailData, currentEpisode: episode } : null
                );
                setPlayerStartTime(startTimeSec);
                setPlayerRealDuration(episode.durationSeconds ?? undefined);
                needsTranscodeFlagRef.current = false;
                setSeriesDetailOpen(false);
                openPlayer(episode.title, sources);
            } catch (error) {
                console.error('Episode playback start failed', error);
            }
        },
        [token, accountId, resolvePlaybackSources, seriesDetailData, seriesDetailItemId, episodeProgressMap]
    );

    const handleOpenRecordings = useCallback(
        async (item: ContentItem) => {
            if (!token || !accountId || activeSection !== 'live' || !item.streamId) return;

            setRecordingsTitle(item.title);
            setRecordingsItems([]);
            setRecordingsStreamId(item.streamId);
            setRecordingsOpen(true);
            setRecordingsLoading(true);

            try {
                const epg = await fetchEpg(token, accountId, item.streamId);
                const now = Math.floor(Date.now() / 1000);
                const pastItems = epg.items.filter((epgItem) => {
                    const stop = toEpochSeconds(epgItem, true);
                    return stop !== null ? stop < now : true;
                });

                setRecordingsItems(pastItems);
            } catch {
                setRecordingsItems([]);
            } finally {
                setRecordingsLoading(false);
            }
        },
        [token, accountId, activeSection]
    );

    const handleOpenSchedule = useCallback(
        async (item: ContentItem) => {
            if (!token || !accountId || activeSection !== 'live' || !item.streamId) return;

            setScheduleTitle(item.title);
            setScheduleItems([]);
            setScheduleOpen(true);
            setScheduleLoading(true);

            try {
                const epg = await fetchEpg(token, accountId, item.streamId);
                const now = Math.floor(Date.now() / 1000);
                const upcoming = epg.items.filter((epgItem) => {
                    const start = toEpochSeconds(epgItem, false);
                    return start !== null ? start > now : false;
                });

                setScheduleItems(upcoming);
            } catch {
                setScheduleItems([]);
            } finally {
                setScheduleLoading(false);
            }
        },
        [token, accountId, activeSection]
    );

    const handlePlayRecording = useCallback(
        async (epgItem: EpgItem) => {
            if (!token || !accountId || !recordingsStreamId || !epgItem.start) return;
            const recordingStart = epgItem.start;

            const duration =
                epgItem.startTimestamp && epgItem.stopTimestamp
                    ? Math.max(1, Math.round((epgItem.stopTimestamp - epgItem.startTimestamp) / 60))
                    : 60;

            try {
                const replayExtensions = ['ts', 'm3u8', 'mp4'];
                const replayUrls = await Promise.all(
                    replayExtensions.map(async (extension) => {
                        try {
                            const replay = await fetchReplayUrl(token, {
                                accountId,
                                streamId: recordingsStreamId,
                                start: recordingStart,
                                durationMinutes: duration,
                                containerExtension: extension,
                            });
                            return replay.url;
                        } catch {
                            return null;
                        }
                    })
                );

                const sources = replayUrls.filter((url): url is string => !!url);
                openPlayer(epgItem.title || recordingsTitle, sources);
            } catch {
                // noop
            }
        },
        [token, accountId, recordingsStreamId, recordingsTitle]
    );

    const currentCategories = useMemo(() => {
        const source = categoriesBySection[activeSection] ?? [];
        const rest = source.filter((category) => category.id !== 'favorites' && category.id !== 'all');
        return [{ id: 'favorites', name: 'Favoris' }, { id: 'all', name: 'Tous' }, ...rest];
    }, [activeSection, categoriesBySection]);

    const handleCategoryChange = (categoryId: string) => {
        setSelectedCategories((prev) => ({ ...prev, [activeSection]: categoryId }));
    };

    const playerKeyboardEnabled =
        playerOpen && !showIptvDialog && !seriesDetailOpen && !recordingsOpen && !scheduleOpen;

    if (!token) {
        return <LoginPage onLogin={handleLogin} onRegister={handleRegister} isLoading={isLoadingAuth} error={authError} />;
    }

    return (
        <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-black text-white' : 'bg-gray-50 text-gray-900'}`}>
            <div
                className={`fixed inset-0 pointer-events-none transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-br from-red-900/20 via-black to-orange-900/20' : 'bg-gradient-to-br from-red-50 via-white to-orange-50'
                    }`}
            />

            <Header
                activeSection={activeSection}
                onSectionChange={setActiveSection}
                searchQuery={searchQuery}
                onSearchChange={setSearchQuery}
                onLogout={handleLogout}
                isDarkMode={isDarkMode}
                onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
                accounts={accounts}
                activeAccountId={accountId}
                onSwitchAccount={handleSwitchAccount}
                onAddAccount={() => setShowIptvDialog(true)}
                preferences={preferences}
                onUpdatePreferences={(prefs) => {
                    if (!token) return;
                    const previous = preferences;
                    setPreferences((prev) => ({ ...prev, ...prefs }));
                    updatePreferences(token, prefs).catch(() => {
                        // rollback on error
                        setPreferences(previous);
                    });
                }}
            />

            <main className="relative">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeSection}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.3 }}
                    >
                        <Hero
                            type={activeSection}
                            isDarkMode={isDarkMode}
                            featuredItem={featuredItem}
                            onPlay={() => {
                                if (featuredItem) handlePlay(featuredItem);
                            }}
                            onInfo={() => {
                                if (activeSection === 'series' && featuredItem) {
                                    handleOpenSeriesDetails(featuredItem);
                                }
                            }}
                        />

                        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 mt-8">
                            <CategoryTabs
                                categories={currentCategories}
                                selectedCategory={currentCategory}
                                onCategoryChange={handleCategoryChange}
                                isDarkMode={isDarkMode}
                            />
                        </div>

                        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 py-12">
                            <PaginatedContentGrid
                                section={activeSection}
                                items={enrichedItems}
                                isDarkMode={isDarkMode}
                                isLoading={isLoadingContent}
                                hasMore={hasMore}
                                onLoadMore={handleLoadMore}
                                onPlay={handlePlay}
                                onOpenDetails={activeSection === 'series' ? handleOpenSeriesDetails : undefined}
                                onOpenSchedule={activeSection === 'live' ? handleOpenSchedule : undefined}
                                onOpenRecordings={activeSection === 'live' ? handleOpenRecordings : undefined}
                                isFavoritesView={currentCategory === 'favorites'}
                                favoriteIds={favoritesBySection[activeSection]}
                                onToggleFavorite={handleToggleFavorite}
                                vodProgressMap={vodProgressMap}
                                seriesProgressMap={seriesProgressMap}
                                accountId={accountId}
                            />
                        </div>
                    </motion.div>
                </AnimatePresence>
            </main>

            <VideoPlayerModal
                open={playerOpen}
                title={playerTitle}
                streamUrl={playerUrl}
                streamSources={playerSources}
                startTime={playerStartTime}
                onProgress={handlePlayerProgress}
                onEnded={handlePlayerEnded}
                autoplay={preferences.autoplay}
                nextEpisodeTitle={
                    currentSeriesPlayContext
                        ? (() => {
                              const next = findNextEpisode(
                                  currentSeriesPlayContext.seriesData,
                                  currentSeriesPlayContext.currentEpisode.seasonNumber,
                                  currentSeriesPlayContext.currentEpisode.episodeNumber
                              );
                              return next
                                  ? `S${String(next.seasonNumber).padStart(2, '0')}E${String(next.episodeNumber).padStart(2, '0')} • ${next.title}`
                                  : undefined;
                          })()
                        : undefined
                }
                onNextEpisode={handleNextEpisode}
                onPreviousEpisode={handlePreviousEpisode}
                realDuration={playerRealDuration}
                onTranscodeFallback={handleTranscodeFallback}
                keyboardEnabled={playerKeyboardEnabled}
                onClose={() => {
                    setPlayerOpen(false);
                    setPlayerUrl(null);
                    setPlayerSources([]);
                    setPlayerStartTime(undefined);
                    setPlayerRealDuration(undefined);
                    needsTranscodeFlagRef.current = false;
                    currentlyPlayingRef.current = null;
                }}
            />

            <SeriesDetailModal
                open={seriesDetailOpen}
                isDarkMode={isDarkMode}
                data={seriesDetailData}
                episodeProgress={episodeProgressMap}
                onClose={() => {
                    setSeriesDetailOpen(false);
                    setSeriesDetailData(null);
                    setSeriesDetailItemId(null);
                }}
                onPlayEpisode={handlePlayEpisode}
            />

            <LiveScheduleDialog
                open={scheduleOpen}
                title={scheduleTitle}
                items={scheduleItems}
                isLoading={scheduleLoading}
                onClose={() => setScheduleOpen(false)}
            />

            <LiveRecordingsDialog
                open={recordingsOpen}
                title={recordingsTitle}
                items={recordingsItems}
                isLoading={recordingsLoading}
                onClose={() => setRecordingsOpen(false)}
                onPlayRecording={handlePlayRecording}
            />

            {seriesDetailOpen && seriesDetailLoading && (
                <div className="fixed inset-0 z-[111] pointer-events-none flex items-center justify-center">
                    <div className="px-4 py-2 rounded-lg bg-black/80 text-white text-sm">Chargement des détails de la série...</div>
                </div>
            )}

            <IptvCredentialsDialog
                open={showIptvDialog}
                isLoading={isLoadingIptvSetup}
                error={iptvSetupError}
                onClose={accountId ? () => setShowIptvDialog(false) : undefined}
                onSubmit={handleAddIptvAccount}
            />
        </div>
    );
}
