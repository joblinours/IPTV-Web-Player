import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router';
import { motion, AnimatePresence, MotionConfig } from 'motion/react';
import { Toaster, toast } from 'sonner';
import { usePerformanceMode } from './hooks/usePerformanceMode';
import { useFavorites } from './hooks/useFavorites';
import { usePreferences } from './hooks/usePreferences';
import { AppContext, type AppContextValue, type SeriesStatsMap, type VodProgressMap, type SeriesProgressMap, type EpisodeProgressMap } from './AppContext';
import { Header } from './components/Header';
import { LoginPage } from './components/LoginPage';
import { AppFooter } from './components/AppFooter';
import { IptvCredentialsDialog } from './components/IptvCredentialsDialog';
import { VideoPlayerModal } from './components/VideoPlayerModal';
import { LiveRecordingsDialog } from './components/LiveRecordingsDialog';
import { LiveScheduleDialog } from './components/LiveScheduleDialog';
import {
    addIptvAccount,
    clearWatchHistory,
    fetchCategories,
    fetchContentPage,
    fetchEpg,
    fetchIntegrations,
    fetchProgress,
    fetchProgressMerged,
    fetchSeriesInfo,
    fetchSeriesProgress,
    fetchReplayUrl,
    fetchStreamUrl,
    buildStreamProxyUrl,
    buildTranscodeUrl,
    listIptvAccounts,
    login,
    register,
    updateProgress,
    type CategoryItem,
    type ContentItem,
    type EpgItem,
    type IntegrationsStatus,
    type IptvAccount,
    type SeriesEpisode,
    type SeriesInfoResponse,
    type PlaybackDebugContext,
    type SectionType,
} from './lib/api';

type CategoryMap = Record<SectionType, CategoryItem[]>;
type SelectedCategoryMap = Record<SectionType, string>;

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
            const url = isAbsolute ? new URL(source) : new URL(source, window.location.origin);
            url.searchParams.set('seekSeconds', seekSeconds.toFixed(3));

            if (isAbsolute) return url.toString();
            return `${url.pathname}${url.search}${url.hash}`;
        } catch {
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

/**
 * Owns every piece of session/catalog/player/progress state the app needs —
 * exactly what App.tsx used to own directly before routing existed — and
 * exposes it via AppContext so routed pages (HomePage, DetailsPage,
 * SearchPage, RequestsPage) can consume it without prop-drilling. Renders
 * the persistent chrome (Header, player, dialogs, footer) around an
 * <Outlet/> for the active route.
 */
export default function AppShell() {
    const navigate = useNavigate();
    const location = useLocation();

    const { reducedMotion, setReducedMotion, isWeakDevice } = usePerformanceMode();
    const [token, setToken] = useState<string | null>(() => localStorage.getItem('iptv_token'));
    const [accounts, setAccounts] = useState<IptvAccount[]>([]);
    const [accountId, setAccountId] = useState<number | null>(null);
    const [activeSection, setActiveSection] = useState<SectionType>('live');
    const [categoriesBySection, setCategoriesBySection] = useState<CategoryMap>(defaultCategories);
    const [selectedCategories, setSelectedCategories] = useState<SelectedCategoryMap>(defaultSelectedCategories);
    const [searchQuery, setSearchQuery] = useState('');
    const [deferredSearchQuery, setDeferredSearchQuery] = useState('');
    useEffect(() => {
        const timer = setTimeout(() => setDeferredSearchQuery(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);
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
    const [playerIsLive, setPlayerIsLive] = useState(false);

    const [seriesDetailOpen, setSeriesDetailOpen] = useState(false);
    const [seriesDetailData, setSeriesDetailData] = useState<SeriesInfoResponse | null>(null);
    const [seriesDetailLoading, setSeriesDetailLoading] = useState(false);
    const [seriesStatsMap, setSeriesStatsMap] = useState<SeriesStatsMap>({});
    const { favoritesBySection, toggleFavorite, resetFavorites } = useFavorites(token, accountId, activeSection);

    const [recordingsOpen, setRecordingsOpen] = useState(false);
    const [recordingsTitle, setRecordingsTitle] = useState('');
    const [recordingsLoading, setRecordingsLoading] = useState(false);
    const [recordingsItems, setRecordingsItems] = useState<EpgItem[]>([]);
    const [recordingsStreamId, setRecordingsStreamId] = useState<number | null>(null);

    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleTitle, setScheduleTitle] = useState('');
    const [scheduleLoading, setScheduleLoading] = useState(false);
    const [scheduleItems, setScheduleItems] = useState<EpgItem[]>([]);

    const { preferences, updatePreferences, resetPreferences } = usePreferences(token);
    const [vodProgressMap, setVodProgressMap] = useState<VodProgressMap>({});
    const [seriesProgressMap, setSeriesProgressMap] = useState<SeriesProgressMap>({});
    const [episodeProgressMap, setEpisodeProgressMap] = useState<EpisodeProgressMap>({});
    const [playerStartTime, setPlayerStartTime] = useState<number | undefined>(undefined);
    const [playerRealDuration, setPlayerRealDuration] = useState<number | undefined>(undefined);
    const [seriesDetailItemId, setSeriesDetailItemId] = useState<number | string | null>(null);
    const [currentSeriesPlayContext, setCurrentSeriesPlayContext] = useState<{
        seriesData: SeriesInfoResponse;
        currentEpisode: SeriesEpisode;
    } | null>(null);
    const currentlyPlayingRef = useRef<CurrentlyPlayingMeta | null>(null);
    // Tracks which media_sources row the series currently open in the
    // details page / episode list belongs to — needed because
    // SeriesEpisode (unlike ContentItem) never carries its own sourceId,
    // so handlePlayEpisode/handleNext/PreviousEpisode can't derive it from
    // the episode object alone. Set whenever a series is opened or played.
    const currentSeriesSourceIdRef = useRef<number | null>(null);
    const needsTranscodeFlagRef = useRef(false);

    const [integrations, setIntegrations] = useState<IntegrationsStatus | null>(null);
    const refreshIntegrations = useCallback(() => {
        if (!token) return;
        fetchIntegrations(token).then(setIntegrations).catch(() => {});
    }, [token]);
    useEffect(() => {
        refreshIntegrations();
    }, [refreshIntegrations]);

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

    // Films/series are always browsed merged across every source the user
    // owns (Xtream + Jellyfin) — no account switch needed to see "on
    // demand" content alongside the rest of the IPTV catalog. Live TV has
    // no Jellyfin equivalent (no tuner) and stays scoped to the ambient
    // accountId, which the Live-only account switcher in Header controls.
    const isMergedSection = activeSection !== 'live';

    useEffect(() => {
        if (!token) return;
        if (!isMergedSection && !accountId) return;

        let cancelled = false;

        const loadCategories = async () => {
            try {
                const result = await fetchCategories(token, accountId, activeSection, { merged: isMergedSection });
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
    }, [activeSection, accountId, isMergedSection, selectedCategories, token]);

    useEffect(() => {
        if (!token) return;
        if (!isMergedSection && !accountId) return;

        let cancelled = false;

        const loadFirstPage = async () => {
            setIsLoadingContent(true);
            try {
                const result = await fetchContentPage(token, {
                    accountId,
                    merged: isMergedSection,
                    section: activeSection,
                    categoryId: currentCategory,
                    searchQuery: deferredSearchQuery,
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
    }, [token, accountId, isMergedSection, activeSection, currentCategory, deferredSearchQuery]);

    useEffect(() => {
        const targets = items
            .filter((item) => !!item.seriesId && !seriesStatsMap[item.seriesId])
            .slice(0, 8);

        if (targets.length === 0) return;
        if (!token) return;

        let cancelled = false;

        const prefetch = async () => {
            for (const target of targets) {
                if (cancelled || !target.seriesId) break;
                const sid = target.sourceId ?? accountId;
                if (!sid) continue;
                try {
                    const details = await fetchSeriesInfo(token, sid, target.seriesId);
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

    useEffect(() => {
        if (!token || activeSection !== 'series' || items.length === 0) return;

        const targets = items.filter((item) => !!item.seriesId).slice(0, 8);
        if (targets.length === 0) return;

        let cancelled = false;

        const load = async () => {
            for (const target of targets) {
                if (cancelled || !target.seriesId) break;
                const sid = target.sourceId ?? accountId;
                if (!sid) continue;
                try {
                    const prog = await fetchSeriesProgress(token, sid, String(target.seriesId));
                    if (cancelled) break;
                    setSeriesProgressMap((prev) => ({
                        ...prev,
                        [`${sid}:${target.seriesId}`]: prog,
                    }));
                } catch {
                    // ignore
                }
            }
        };

        load();
        return () => { cancelled = true; };
    }, [token, accountId, activeSection, items]);

    useEffect(() => {
        if (!token || activeSection !== 'films' || items.length === 0) return;

        const targets = items.slice(0, 50).filter((item) => !!(item.sourceId ?? accountId) && item.id);
        if (targets.length === 0) return;

        const itemKeys = targets.map((item) => `${item.sourceId ?? accountId}:${item.id}`);

        let cancelled = false;

        fetchProgressMerged(token, 'vod', itemKeys)
            .then((result) => {
                if (cancelled) return;
                const map: VodProgressMap = {};
                for (const entry of result.items) {
                    map[`${entry.sourceId}:${entry.itemId}`] = entry;
                }
                setVodProgressMap((prev) => ({ ...prev, ...map }));
            })
            .catch(() => {});

        return () => { cancelled = true; };
    }, [token, accountId, activeSection, items]);

    const handleLoadMore = useCallback(async () => {
        if (!token || (!isMergedSection && !accountId) || isLoadingContent || !hasMore) {
            return;
        }

        setIsLoadingContent(true);
        try {
            const result = await fetchContentPage(token, {
                accountId,
                merged: isMergedSection,
                section: activeSection,
                categoryId: currentCategory,
                searchQuery: deferredSearchQuery,
                offset: nextOffset,
                limit: PAGE_SIZE,
            });

            setItems((prev) => [...prev, ...result.items]);
            setHasMore(result.pagination.hasMore);
            setNextOffset(result.pagination.nextOffset ?? nextOffset);
        } finally {
            setIsLoadingContent(false);
        }
    }, [token, accountId, isMergedSection, isLoadingContent, hasMore, activeSection, currentCategory, deferredSearchQuery, nextOffset]);

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
            const created = await addIptvAccount(token, payload);
            await refreshAccounts();
            setAccountId(Number(created.accountId));
            setShowIptvDialog(false);
        } catch (error) {
            setIptvSetupError(error instanceof Error ? error.message : "Impossible d'ajouter le compte IPTV");
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
        resetFavorites();
        setVodProgressMap({});
        setSeriesProgressMap({});
        setEpisodeProgressMap({});
        setCurrentSeriesPlayContext(null);
        setPlayerStartTime(undefined);
        setPlayerRealDuration(undefined);
        setPlayerIsLive(false);
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
        setPlayerIsLive(false);
        setSeriesDetailOpen(false);
        setSeriesDetailData(null);
        setIptvSetupError(null);
        setRecordingsOpen(false);
        setScheduleOpen(false);
        resetFavorites();
        resetPreferences();
        setVodProgressMap({});
        setSeriesProgressMap({});
        setEpisodeProgressMap({});
        setCurrentSeriesPlayContext(null);
        setPlayerStartTime(undefined);
        setPlayerRealDuration(undefined);
        needsTranscodeFlagRef.current = false;
        currentlyPlayingRef.current = null;
        navigate('/');
    };

    const resolvePlaybackSources = useCallback(
        async (
            item: ContentItem,
            section: SectionType,
            // A string identifier, not a numeric Xtream streamId: works for
            // both an Xtream stream (stringified number) and a Jellyfin item
            // (GUID) — see backend/src/routes/stream.ts's idFields.
            externalId: string,
            debugContext?: PlaybackDebugContext
        ) => {
            if (!token) return [];
            // Every item carries its own originating source (both providers
            // set it) — playback must always resolve against THAT source,
            // never whatever happens to be the ambient/default accountId,
            // now that films/series browse a merged Xtream+Jellyfin view.
            // accountId only remains a fallback for the few flows that don't
            // have a full item on hand (e.g. Live, still single-source).
            const sourceId = item.sourceId ?? accountId;
            if (!sourceId) return [];

            const normalizedContainer = (item.containerExtension ?? '').toLowerCase();

            // Jellyfin ignores containerExtension entirely (buildPlayback on
            // the backend ignores it) — the extension-permutation loop below
            // is Xtream-specific and, for Jellyfin, produces 2-3 near-
            // identical candidates that all resolve to the exact same raw
            // file. Raw Jellyfin downloads of ripped media very often carry
            // a non-web audio codec (DTS/TrueHD/EAC3), so trying that same
            // broken candidate 2-3 times before falling back was the root
            // cause of the "audio fallback loop then crash" bug — build a
            // minimal, explicitly ordered list instead: the ffmpeg transcode
            // (forced AAC audio, cheap now that the server stream-copies
            // browser-safe video instead of re-encoding it) first, the raw
            // download last as a pure last-resort.
            if (item.source === 'jellyfin' && (section === 'films' || section === 'series')) {
                const transcodeUrl = buildTranscodeUrl({
                    token, accountId: sourceId, section, itemId: externalId,
                    containerExtension: normalizedContainer || 'mp4',
                    durationSeconds: item.durationSeconds ?? undefined,
                    debugContext,
                });
                const rawUrl = buildStreamProxyUrl({ token, accountId: sourceId, section, itemId: externalId, containerExtension: normalizedContainer || 'mp4', debugContext });
                return [transcodeUrl, rawUrl];
            }

            const base =
                section === 'live'
                    ? ['ts', 'm3u8', normalizedContainer || 'ts']
                    : [normalizedContainer || 'mp4', 'mp4', 'ts', 'm3u8'];

            const candidates = uniqueExtensions(base);
            const urls = await Promise.all(
                candidates.map(async (extension) => {
                    try {
                        if (section === 'live') {
                            const mustProxy = window.location.protocol === 'https:';
                            if (mustProxy) {
                                return buildStreamProxyUrl({ token, accountId: sourceId, section, itemId: externalId, containerExtension: extension, debugContext });
                            }

                            const response = await fetchStreamUrl(token, { accountId: sourceId, section, itemId: externalId, containerExtension: extension, debugContext });

                            if (/^http:\/\//i.test(response.url)) {
                                return buildStreamProxyUrl({ token, accountId: sourceId, section, itemId: externalId, containerExtension: extension, debugContext });
                            }

                            return response.url;
                        }

                        return buildStreamProxyUrl({ token, accountId: sourceId, section, itemId: externalId, containerExtension: extension, debugContext });
                    } catch {
                        return null;
                    }
                })
            );

            if (section === 'films' || section === 'series') {
                const transcodeUrl = buildTranscodeUrl({
                    token, accountId: sourceId, section, itemId: externalId,
                    containerExtension: normalizedContainer || 'mp4',
                    durationSeconds: item.durationSeconds ?? undefined,
                    debugContext,
                });

                if (normalizedContainer === 'mkv') {
                    urls.splice(1, 0, transcodeUrl);
                } else {
                    urls.splice(Math.min(2, urls.length), 0, transcodeUrl);
                }
            }

            if (section === 'live') {
                urls.push(
                    buildTranscodeUrl({
                        token, accountId: sourceId, section, itemId: externalId,
                        containerExtension: normalizedContainer || 'ts',
                        durationSeconds: item.durationSeconds ?? undefined,
                        debugContext,
                    })
                );
            }

            return urls.filter((url): url is string => !!url);
        },
        [token, accountId]
    );

    const openPlayer = (title: string, sources: string[], isLive = false) => {
        if (sources.length === 0) return;
        setPlayerTitle(title);
        setPlayerUrl(sources[0]);
        setPlayerSources(sources);
        setPlayerIsLive(isLive);
        setPlayerOpen(true);
    };

    const handlePlayerProgress = useCallback(
        (currentTime: number, duration: number) => {
            const ctx = currentlyPlayingRef.current;
            if (!token || !ctx) return;

            const needsTranscode = needsTranscodeFlagRef.current || undefined;

            updateProgress(token, {
                accountId: ctx.accountId, type: ctx.type, itemId: ctx.itemId, seriesId: ctx.seriesId,
                seasonNumber: ctx.seasonNumber, episodeNumber: ctx.episodeNumber, currentTime, totalDuration: duration, needsTranscode,
            }).catch(() => {});

            const isWatched = duration > 0 && duration - currentTime <= 10;

            // Keyed by ctx.accountId (the item's own source, set correctly
            // in handlePlay/handlePlayEpisode) — NOT the ambient accountId,
            // which could be a different source than what's actually
            // playing now that films/series browse a merged view.
            if (ctx.type === 'vod') {
                setVodProgressMap((prev) => ({
                    ...prev,
                    [`${ctx.accountId}:${ctx.itemId}`]: {
                        itemId: ctx.itemId, currentTime, totalDuration: duration, isWatched,
                        needsTranscode: needsTranscode ?? false, updatedAt: Math.floor(Date.now() / 1000),
                    },
                }));
            } else if (ctx.type === 'series_episode' && ctx.seriesId) {
                setEpisodeProgressMap((prev) => ({
                    ...prev,
                    [ctx.itemId]: { currentTime, totalDuration: duration, isWatched, needsTranscode: needsTranscode ?? false },
                }));
                setSeriesProgressMap((prev) => {
                    const key = `${ctx.accountId}:${ctx.seriesId}`;
                    const existing = prev[key];
                    return {
                        ...prev,
                        [key]: {
                            lastEpisode: {
                                episodeId: ctx.itemId, seasonNumber: ctx.seasonNumber ?? null, episodeNumber: ctx.episodeNumber ?? null,
                                currentTime, totalDuration: duration, isWatched, needsTranscode: needsTranscode ?? false,
                            },
                            watchedEpisodeIds: existing?.watchedEpisodeIds ?? [],
                        },
                    };
                });
            }
        },
        [token]
    );

    const handlePlayerEnded = useCallback(
        (currentTime: number, duration: number) => {
            const ctx = currentlyPlayingRef.current;
            if (!token || !ctx) return;

            const needsTranscode = needsTranscodeFlagRef.current || undefined;

            updateProgress(token, {
                accountId: ctx.accountId, type: ctx.type, itemId: ctx.itemId, seriesId: ctx.seriesId,
                seasonNumber: ctx.seasonNumber, episodeNumber: ctx.episodeNumber, currentTime, totalDuration: duration, isWatched: true, needsTranscode,
            }).catch(() => {});

            if (ctx.type === 'vod') {
                setVodProgressMap((prev) => ({
                    ...prev,
                    [`${ctx.accountId}:${ctx.itemId}`]: {
                        itemId: ctx.itemId, currentTime, totalDuration: duration, isWatched: true,
                        needsTranscode: needsTranscode ?? false, updatedAt: Math.floor(Date.now() / 1000),
                    },
                }));
            } else if (ctx.type === 'series_episode' && ctx.seriesId) {
                setEpisodeProgressMap((prev) => ({
                    ...prev,
                    [ctx.itemId]: { currentTime, totalDuration: duration, isWatched: true, needsTranscode: needsTranscode ?? false },
                }));
                setSeriesProgressMap((prev) => {
                    const key = `${ctx.accountId}:${ctx.seriesId}`;
                    const existing = prev[key];
                    const newWatched = new Set(existing?.watchedEpisodeIds ?? []);
                    newWatched.add(ctx.itemId);
                    return {
                        ...prev,
                        [key]: {
                            lastEpisode: {
                                episodeId: ctx.itemId, seasonNumber: ctx.seasonNumber ?? null, episodeNumber: ctx.episodeNumber ?? null,
                                currentTime, totalDuration: duration, isWatched: true, needsTranscode: needsTranscode ?? false,
                            },
                            watchedEpisodeIds: [...newWatched],
                        },
                    };
                });
            }
        },
        [token]
    );

    const handleTranscodeFallback = useCallback(() => {
        needsTranscodeFlagRef.current = true;
    }, []);

    const handleClearWatchHistory = useCallback(async () => {
        if (!token || !accountId) return;
        try {
            await clearWatchHistory(token, accountId);
            setVodProgressMap({});
            setSeriesProgressMap({});
            setEpisodeProgressMap({});
        } catch (error) {
            console.error('Failed to clear watch history:', error);
            throw error;
        }
    }, [token, accountId]);

    const handleNextEpisode = useCallback(async () => {
        if (!token || !currentSeriesPlayContext) return;
        const { seriesData, currentEpisode } = currentSeriesPlayContext;
        const currentSeriesId = currentlyPlayingRef.current?.seriesId;
        // The currently-playing episode's own source is authoritative — a
        // Jellyfin series' next episode must stay on Jellyfin, never fall
        // back to whatever the ambient/default account happens to be.
        const sid = currentlyPlayingRef.current?.accountId ?? accountId;
        if (!sid) return;

        const next = findNextEpisode(seriesData, currentEpisode.seasonNumber, currentEpisode.episodeNumber);
        if (!next) return;

        const rawSources = await resolvePlaybackSources(
            {
                id: String(next.id), title: next.title, categoryId: '', poster: next.poster, description: null, genre: null, year: null,
                rating: next.rating ? String(next.rating) : null, containerExtension: next.containerExtension, streamId: null, seriesId: next.id,
                sourceId: sid,
            },
            'series', String(next.id),
            { mediaTitle: next.title, seriesTitle: seriesData.info.name, seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber }
        );

        if (rawSources.length === 0) return;

        const nextEpProg = episodeProgressMap[String(next.id)];
        const sources = nextEpProg?.needsTranscode ? reorderWithTranscodeFirst(rawSources) : rawSources;

        currentlyPlayingRef.current = { type: 'series_episode', itemId: String(next.id), accountId: sid, seriesId: currentSeriesId, seasonNumber: next.seasonNumber, episodeNumber: next.episodeNumber };
        setCurrentSeriesPlayContext({ seriesData, currentEpisode: next });
        setPlayerStartTime(undefined);
        setPlayerRealDuration(next.durationSeconds ?? undefined);
        needsTranscodeFlagRef.current = false;
        setPlayerTitle(next.title);
        setPlayerUrl(sources[0]);
        setPlayerSources(sources);
        setPlayerIsLive(false);
    }, [token, accountId, currentSeriesPlayContext, resolvePlaybackSources, episodeProgressMap]);

    const handlePreviousEpisode = useCallback(async () => {
        if (!token || !currentSeriesPlayContext) return;
        const { seriesData, currentEpisode } = currentSeriesPlayContext;
        const currentSeriesId = currentlyPlayingRef.current?.seriesId;
        const sid = currentlyPlayingRef.current?.accountId ?? accountId;
        if (!sid) return;

        const previous = findPreviousEpisode(seriesData, currentEpisode.seasonNumber, currentEpisode.episodeNumber);
        if (!previous) return;

        const rawSources = await resolvePlaybackSources(
            {
                id: String(previous.id), title: previous.title, categoryId: '', poster: previous.poster, description: null, genre: null, year: null,
                rating: previous.rating ? String(previous.rating) : null, containerExtension: previous.containerExtension, streamId: null, seriesId: previous.id,
                sourceId: sid,
            },
            'series', String(previous.id),
            { mediaTitle: previous.title, seriesTitle: seriesData.info.name, seasonNumber: previous.seasonNumber, episodeNumber: previous.episodeNumber }
        );

        if (rawSources.length === 0) return;

        const previousEpProg = episodeProgressMap[String(previous.id)];
        const sources = previousEpProg?.needsTranscode ? reorderWithTranscodeFirst(rawSources) : rawSources;

        currentlyPlayingRef.current = { type: 'series_episode', itemId: String(previous.id), accountId: sid, seriesId: currentSeriesId, seasonNumber: previous.seasonNumber, episodeNumber: previous.episodeNumber };
        setCurrentSeriesPlayContext({ seriesData, currentEpisode: previous });
        setPlayerStartTime(undefined);
        setPlayerRealDuration(previous.durationSeconds ?? undefined);
        needsTranscodeFlagRef.current = false;
        setPlayerTitle(previous.title);
        setPlayerUrl(sources[0]);
        setPlayerSources(sources);
        setPlayerIsLive(false);
    }, [token, accountId, currentSeriesPlayContext, resolvePlaybackSources, episodeProgressMap]);

    const handleOpenSeriesDetails = useCallback(
        async (item: ContentItem) => {
            const sid = item.sourceId ?? accountId;
            if (!token || !sid || !item.seriesId) return;

            // Netflix-style: a dedicated page instead of a modal — the page
            // reads seriesDetailData/seriesDetailLoading from this same context.
            if (!location.pathname.startsWith(`/tv/${sid}/${item.seriesId}`)) {
                navigate(`/tv/${sid}/${item.seriesId}`);
            }

            setSeriesDetailLoading(true);
            setSeriesDetailOpen(true);
            setSeriesDetailItemId(item.seriesId);
            currentSeriesSourceIdRef.current = sid;

            try {
                const data = await fetchSeriesInfo(token, sid, item.seriesId);
                setSeriesDetailData(data);

                const seasonsCount = data.seasons.length;
                const episodesCount = Object.values(data.episodesBySeason).reduce((total, list) => total + list.length, 0);
                setSeriesStatsMap((prev) => ({ ...prev, [item.seriesId as number]: { seasonsCount, episodesCount } }));

                const allEpisodeIds = Object.values(data.episodesBySeason).flat().map((ep) => String(ep.id));
                if (allEpisodeIds.length > 0) {
                    fetchProgress(token, sid, 'series_episode', allEpisodeIds)
                        .then((result) => {
                            const map: EpisodeProgressMap = {};
                            for (const entry of result.items) {
                                map[entry.itemId] = { currentTime: entry.currentTime, totalDuration: entry.totalDuration, isWatched: entry.isWatched, needsTranscode: entry.needsTranscode };
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
        [token, accountId, navigate, location.pathname]
    );

    const handlePlay = useCallback(
        async (item: ContentItem) => {
            const sid = item.sourceId ?? accountId;
            if (!token || !sid) return;
            try {
                if (activeSection === 'series') {
                    if (!item.seriesId) {
                        await handleOpenSeriesDetails(item);
                        return;
                    }

                    const progressKey = `${sid}:${item.seriesId}`;
                    const prog = seriesProgressMap[progressKey];

                    if (!prog?.lastEpisode) {
                        await handleOpenSeriesDetails(item);
                        return;
                    }

                    const { lastEpisode } = prog;
                    const remaining = lastEpisode.totalDuration > 0 ? lastEpisode.totalDuration - lastEpisode.currentTime : Infinity;

                    setSeriesDetailLoading(false);
                    let seriesData: SeriesInfoResponse;
                    try {
                        setSeriesDetailLoading(true);
                        seriesData = await fetchSeriesInfo(token, sid, item.seriesId);
                    } catch {
                        setSeriesDetailLoading(false);
                        await handleOpenSeriesDetails(item);
                        return;
                    }
                    setSeriesDetailLoading(false);

                    let targetEpisode: SeriesEpisode | null = null;
                    let startTimeSec: number | undefined = undefined;

                    if (lastEpisode.isWatched || remaining <= 10) {
                        targetEpisode = findNextEpisode(seriesData, lastEpisode.seasonNumber ?? 1, lastEpisode.episodeNumber ?? 1);
                        if (!targetEpisode) {
                            await handleOpenSeriesDetails(item);
                            return;
                        }
                    } else {
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
                            id: String(targetEpisode.id), title: targetEpisode.title, categoryId: '', poster: targetEpisode.poster, description: null, genre: null, year: null,
                            rating: targetEpisode.rating ? String(targetEpisode.rating) : null, containerExtension: targetEpisode.containerExtension, streamId: null, seriesId: targetEpisode.id,
                            sourceId: sid,
                        },
                        'series', String(targetEpisode.id),
                        { mediaTitle: targetEpisode.title, seriesTitle: seriesData.info.name, seasonNumber: targetEpisode.seasonNumber, episodeNumber: targetEpisode.episodeNumber }
                    );

                    const epNeedsTranscode = lastEpisode.needsTranscode || (episodeProgressMap[lastEpisode.episodeId]?.needsTranscode ?? false);
                    const sources = epNeedsTranscode ? addSeekToTranscodeSources(reorderWithTranscodeFirst(rawSources), startTimeSec) : rawSources;

                    currentSeriesSourceIdRef.current = sid;
                    currentlyPlayingRef.current = { type: 'series_episode', itemId: String(targetEpisode.id), accountId: sid, seriesId: String(item.seriesId), seasonNumber: targetEpisode.seasonNumber, episodeNumber: targetEpisode.episodeNumber };
                    setCurrentSeriesPlayContext({ seriesData, currentEpisode: targetEpisode });
                    setPlayerStartTime(startTimeSec);
                    setPlayerRealDuration(targetEpisode.durationSeconds ?? undefined);
                    needsTranscodeFlagRef.current = false;
                    openPlayer(targetEpisode.title, sources);
                    return;
                }

                // Xtream items carry a numeric streamId; Jellyfin items only
                // have itemId (a GUID) — streamId stays null for those (see
                // backend/src/sources/jellyfin.ts's mapItem). Prefer itemId
                // when present so both sources actually play.
                const externalId = item.itemId ?? (item.streamId ? String(item.streamId) : null);
                if (!externalId) return;

                const vodProg = vodProgressMap[`${sid}:${item.id}`];
                const vodStartTimeSec = vodProg && !vodProg.isWatched && vodProg.currentTime > 0 ? vodProg.currentTime : undefined;
                const rawVodSources = await resolvePlaybackSources(item, activeSection, externalId, { mediaTitle: item.title });
                const vodSources = vodProg?.needsTranscode ? addSeekToTranscodeSources(reorderWithTranscodeFirst(rawVodSources), vodStartTimeSec) : rawVodSources;
                currentlyPlayingRef.current = activeSection === 'live' ? null : { type: 'vod', itemId: item.id, accountId: sid };
                setCurrentSeriesPlayContext(null);
                setPlayerStartTime(vodStartTimeSec);
                const providerDuration = item.durationSeconds && item.durationSeconds > 0 ? item.durationSeconds : undefined;
                setPlayerRealDuration(providerDuration ?? (vodProg?.totalDuration && vodProg.totalDuration > 0 ? vodProg.totalDuration : undefined));
                needsTranscodeFlagRef.current = false;
                openPlayer(item.title, vodSources, activeSection === 'live');
            } catch (error) {
                console.error('Playback start failed', error);
            }
        },
        [token, accountId, activeSection, resolvePlaybackSources, handleOpenSeriesDetails, seriesProgressMap, episodeProgressMap, vodProgressMap]
    );

    const handlePlayEpisode = useCallback(
        async (episode: SeriesEpisode) => {
            // SeriesEpisode carries no sourceId of its own — the series
            // currently open in the details page set this when it loaded
            // (handleOpenSeriesDetails/handlePlay), so it's always the
            // right source for any of its episodes.
            const sid = currentSeriesSourceIdRef.current ?? accountId;
            if (!token || !sid) return;

            try {
                const epProg = episodeProgressMap[String(episode.id)];
                const startTimeSec = epProg && !epProg.isWatched && epProg.currentTime > 0 ? epProg.currentTime : undefined;

                const rawSources = await resolvePlaybackSources(
                    {
                        id: String(episode.id), title: episode.title, categoryId: '', poster: episode.poster, description: null, genre: null, year: null,
                        rating: episode.rating ? String(episode.rating) : null, containerExtension: episode.containerExtension, streamId: null, seriesId: episode.id,
                        sourceId: sid,
                    },
                    'series', String(episode.id),
                    { mediaTitle: episode.title, seriesTitle: seriesDetailData?.info.name ?? undefined, seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber }
                );

                const sources = epProg?.needsTranscode ? addSeekToTranscodeSources(reorderWithTranscodeFirst(rawSources), startTimeSec) : rawSources;

                currentlyPlayingRef.current = {
                    type: 'series_episode', itemId: String(episode.id), accountId: sid,
                    seriesId: seriesDetailItemId !== null ? String(seriesDetailItemId) : undefined,
                    seasonNumber: episode.seasonNumber, episodeNumber: episode.episodeNumber,
                };
                setCurrentSeriesPlayContext(seriesDetailData ? { seriesData: seriesDetailData, currentEpisode: episode } : null);
                setPlayerStartTime(startTimeSec);
                setPlayerRealDuration(episode.durationSeconds ?? undefined);
                needsTranscodeFlagRef.current = false;
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

            const duration = epgItem.startTimestamp && epgItem.stopTimestamp
                ? Math.max(1, Math.round((epgItem.stopTimestamp - epgItem.startTimestamp) / 60))
                : 60;

            try {
                const replayExtensions = ['ts', 'm3u8', 'mp4'];
                const replayUrls = await Promise.all(
                    replayExtensions.map(async (extension) => {
                        try {
                            const replay = await fetchReplayUrl(token, { accountId, streamId: recordingsStreamId, start: recordingStart, durationMinutes: duration, containerExtension: extension });
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

    const playerKeyboardEnabled = playerOpen && !showIptvDialog && !seriesDetailOpen && !recordingsOpen && !scheduleOpen;

    const contextValue: AppContextValue = {
        reducedMotion, setReducedMotion, isWeakDevice,
        token, accounts, accountId, handleSwitchAccount, handleLogout,
        isDarkMode, setIsDarkMode,
        activeSection, setActiveSection, categoriesBySection, currentCategories, currentCategory, handleCategoryChange,
        searchQuery, setSearchQuery,
        items, enrichedItems, featuredItem, hasMore, isLoadingContent, handleLoadMore,
        favoritesBySection, toggleFavorite,
        preferences, updatePreferences, handleClearWatchHistory,
        vodProgressMap, seriesProgressMap, episodeProgressMap, seriesStatsMap,
        handlePlay, handlePlayEpisode, handleOpenSeriesDetails, seriesDetailData, seriesDetailLoading, seriesDetailItemId,
        handleOpenSchedule, handleOpenRecordings,
        scheduleOpen, scheduleTitle, scheduleItems, scheduleLoading, setScheduleOpen,
        recordingsOpen, recordingsTitle, recordingsItems, recordingsLoading, setRecordingsOpen, handlePlayRecording,
        integrations, refreshIntegrations,
        showIptvDialog, setShowIptvDialog, isLoadingIptvSetup, iptvSetupError, handleAddIptvAccount,
    };

    if (!token) {
        return (
            <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
                <LoginPage onLogin={handleLogin} onRegister={handleRegister} isLoading={isLoadingAuth} error={authError} />
            </MotionConfig>
        );
    }

    return (
        <MotionConfig reducedMotion={reducedMotion ? 'always' : 'never'}>
            <div className={`min-h-screen transition-colors duration-300 ${isDarkMode ? 'bg-black text-white' : 'bg-gray-50 text-gray-900'}`}>
                <div
                    className={`fixed inset-0 pointer-events-none transition-colors duration-300 ${isDarkMode ? 'bg-gradient-to-br from-red-900/20 via-black to-orange-900/20' : 'bg-gradient-to-br from-red-50 via-white to-orange-50'}`}
                />

                <Header
                    activeSection={activeSection}
                    onSectionChange={(section) => {
                        setActiveSection(section);
                        navigate(section === 'live' ? '/live' : section === 'films' ? '/films' : '/series');
                    }}
                    searchQuery={searchQuery}
                    onSearchChange={(value) => {
                        setSearchQuery(value);
                        if (value && location.pathname !== '/search') navigate('/search');
                    }}
                    onLogout={handleLogout}
                    isDarkMode={isDarkMode}
                    onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
                    accounts={accounts}
                    activeAccountId={accountId}
                    onSwitchAccount={handleSwitchAccount}
                    onAddAccount={() => setShowIptvDialog(true)}
                    preferences={preferences}
                    onUpdatePreferences={updatePreferences}
                    onClearWatchHistory={handleClearWatchHistory}
                    reducedMotion={reducedMotion}
                    onToggleReducedMotion={setReducedMotion}
                    isWeakDevice={isWeakDevice}
                    requestsEnabled={!!(integrations?.radarr || integrations?.sonarr)}
                />

                <main className="relative">
                    <AnimatePresence mode="wait">
                        <motion.div
                            key={location.pathname}
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -20 }}
                            transition={{ duration: 0.3 }}
                        >
                            <AppContext.Provider value={contextValue}>
                                <Outlet />
                            </AppContext.Provider>
                        </motion.div>
                    </AnimatePresence>
                </main>

                <AppFooter isDarkMode={isDarkMode} />

                <Toaster theme={isDarkMode ? 'dark' : 'light'} position="top-center" richColors />

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
                                  const next = findNextEpisode(currentSeriesPlayContext.seriesData, currentSeriesPlayContext.currentEpisode.seasonNumber, currentSeriesPlayContext.currentEpisode.episodeNumber);
                                  return next ? `S${String(next.seasonNumber).padStart(2, '0')}E${String(next.episodeNumber).padStart(2, '0')} • ${next.title}` : undefined;
                              })()
                            : undefined
                    }
                    onNextEpisode={handleNextEpisode}
                    onPreviousEpisode={handlePreviousEpisode}
                    realDuration={playerRealDuration}
                    onTranscodeFallback={handleTranscodeFallback}
                    onExhausted={() => toast.error('Lecture impossible', { description: `Aucune source lisible n'a été trouvée pour "${playerTitle}".` })}
                    isLive={playerIsLive}
                    keyboardEnabled={playerKeyboardEnabled}
                    onClose={() => {
                        setPlayerOpen(false);
                        setPlayerUrl(null);
                        setPlayerSources([]);
                        setPlayerStartTime(undefined);
                        setPlayerRealDuration(undefined);
                        setPlayerIsLive(false);
                        needsTranscodeFlagRef.current = false;
                        currentlyPlayingRef.current = null;
                    }}
                />

                <LiveScheduleDialog open={scheduleOpen} title={scheduleTitle} items={scheduleItems} isLoading={scheduleLoading} onClose={() => setScheduleOpen(false)} />

                <LiveRecordingsDialog open={recordingsOpen} title={recordingsTitle} items={recordingsItems} isLoading={recordingsLoading} onClose={() => setRecordingsOpen(false)} onPlayRecording={handlePlayRecording} />

                <IptvCredentialsDialog
                    open={showIptvDialog}
                    isLoading={isLoadingIptvSetup}
                    error={iptvSetupError}
                    onClose={accountId ? () => setShowIptvDialog(false) : undefined}
                    onSubmit={handleAddIptvAccount}
                />
            </div>
        </MotionConfig>
    );
}
