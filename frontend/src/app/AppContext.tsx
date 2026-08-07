import { createContext, useContext } from 'react';
import type {
    ContentItem,
    EpgItem,
    IptvAccount,
    ProgressEntry,
    SeriesEpisode,
    SeriesInfoResponse,
    SeriesProgressSummary,
    UserPreferences,
    SectionType,
    CategoryItem,
    IntegrationsStatus,
} from './lib/api';

export type SeriesStatsMap = Record<number | string, { seasonsCount: number; episodesCount: number }>;
export type VodProgressMap = Record<string, ProgressEntry>;
export type SeriesProgressMap = Record<string, SeriesProgressSummary>;
export type EpisodeProgressMap = Record<string, { currentTime: number; totalDuration: number; isWatched: boolean; needsTranscode: boolean }>;

/**
 * Everything the routed pages (HomePage, DetailsPage, SearchPage, ...) need:
 * session/account state, the catalog for the active section, player control,
 * watch progress, and all the playback-resolution logic. This is the exact
 * same state App.tsx used to own directly — relocated here so multiple
 * routes can share it without prop-drilling, but not re-architected: every
 * handler below does exactly what it did before routing existed.
 */
export interface AppContextValue {
    reducedMotion: boolean;
    setReducedMotion: (value: boolean) => void;
    isWeakDevice: boolean;

    token: string | null;
    accounts: IptvAccount[];
    accountId: number | null;
    handleSwitchAccount: (accountId: number) => void;
    handleLogout: () => void;

    isDarkMode: boolean;
    setIsDarkMode: (value: boolean) => void;

    activeSection: SectionType;
    setActiveSection: (section: SectionType) => void;
    categoriesBySection: Record<SectionType, CategoryItem[]>;
    currentCategories: CategoryItem[];
    currentCategory: string;
    handleCategoryChange: (categoryId: string) => void;

    searchQuery: string;
    setSearchQuery: (value: string) => void;

    items: ContentItem[];
    enrichedItems: ContentItem[];
    featuredItem: ContentItem | null;
    hasMore: boolean;
    isLoadingContent: boolean;
    handleLoadMore: () => void;

    favoritesBySection: Record<SectionType, Set<string>>;
    toggleFavorite: (item: ContentItem) => void;

    preferences: UserPreferences;
    updatePreferences: (prefs: Partial<UserPreferences>) => void;
    handleClearWatchHistory: () => Promise<void>;

    vodProgressMap: VodProgressMap;
    seriesProgressMap: SeriesProgressMap;
    episodeProgressMap: EpisodeProgressMap;
    seriesStatsMap: SeriesStatsMap;

    handlePlay: (item: ContentItem) => void;
    handlePlayEpisode: (episode: SeriesEpisode) => void;
    handleOpenSeriesDetails: (item: ContentItem) => void;
    seriesDetailData: SeriesInfoResponse | null;
    seriesDetailLoading: boolean;
    seriesDetailItemId: number | string | null;

    handleOpenSchedule: (item: ContentItem) => void;
    handleOpenRecordings: (item: ContentItem) => void;
    scheduleOpen: boolean;
    scheduleTitle: string;
    scheduleItems: EpgItem[];
    scheduleLoading: boolean;
    setScheduleOpen: (value: boolean) => void;
    recordingsOpen: boolean;
    recordingsTitle: string;
    recordingsItems: EpgItem[];
    recordingsLoading: boolean;
    setRecordingsOpen: (value: boolean) => void;
    handlePlayRecording: (epgItem: EpgItem) => void;

    integrations: IntegrationsStatus | null;
    refreshIntegrations: () => void;

    showIptvDialog: boolean;
    setShowIptvDialog: (value: boolean) => void;
    isLoadingIptvSetup: boolean;
    iptvSetupError: string | null;
    handleAddIptvAccount: (payload: { name: string; serverUrl: string; username: string; password: string }) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
    const ctx = useContext(AppContext);
    if (!ctx) throw new Error('useAppContext must be used within <AppShell>');
    return ctx;
}
