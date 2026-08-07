import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { ContentCard } from './ContentCard';
import { useAppContext } from '../AppContext';
import { useTmdbMatchBatch } from '../hooks/useTmdbMatchBatch';
import type { ContentItem, ProgressEntry, SeriesProgressSummary, SectionType } from '../lib/api';

interface PaginatedContentGridProps {
    section: SectionType;
    items: ContentItem[];
    isDarkMode: boolean;
    isLoading: boolean;
    hasMore: boolean;
    onLoadMore: () => void;
    onPlay: (item: ContentItem) => void;
    onOpenDetails?: (item: ContentItem) => void;
    onOpenSchedule?: (item: ContentItem) => void;
    onOpenRecordings?: (item: ContentItem) => void;
    isFavoritesView?: boolean;
    favoriteIds?: Set<string>;
    onToggleFavorite?: (item: ContentItem) => void;
    vodProgressMap?: Record<string, ProgressEntry>;
    seriesProgressMap?: Record<string, SeriesProgressSummary>;
    accountId?: number | null;
}

export function PaginatedContentGrid({
    section,
    items,
    isDarkMode,
    isLoading,
    hasMore,
    onLoadMore,
    onPlay,
    onOpenDetails,
    onOpenSchedule,
    onOpenRecordings,
    isFavoritesView = false,
    favoriteIds,
    onToggleFavorite,
    vodProgressMap = {},
    seriesProgressMap = {},
    accountId,
}: PaginatedContentGridProps) {
    const { token } = useAppContext();
    const { getMatch } = useTmdbMatchBatch(token, section === 'live' ? [] : items, section === 'series' ? 'series' : 'movie');

    const sentinelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const node = sentinelRef.current;
        if (!node || !hasMore || isLoading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const entry = entries[0];
                if (entry.isIntersecting) {
                    onLoadMore();
                }
            },
            { rootMargin: '200px' }
        );

        observer.observe(node);
        return () => observer.disconnect();
    }, [hasMore, isLoading, onLoadMore]);

    return (
        <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
                {items.map((item, index) => {
                    // Falls back to the ambient accountId only for items
                    // that somehow lack their own sourceId — both providers
                    // set it on every real API response.
                    const sid = item.sourceId ?? accountId;
                    const tmdb = section === 'live' ? null : getMatch(item.title, item.year);
                    return (
                    <motion.div
                        key={`${item.source ?? 'xt'}-${item.id}-${index}`}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.25 }}
                    >
                        <ContentCard
                            title={item.title}
                            type={section}
                            index={index}
                            isDarkMode={isDarkMode}
                            poster={item.poster ?? tmdb?.posterUrl ?? null}
                            description={item.description ?? tmdb?.overview ?? null}
                            genre={item.genre}
                            year={item.year}
                            rating={item.rating ?? (tmdb?.rating != null ? tmdb.rating.toFixed(1) : null)}
                            hasArchive={item.hasArchive}
                            seasonsCount={item.seasonsCount}
                            episodesCount={item.episodesCount}
                            onPlay={() => onPlay(item)}
                            onDetails={onOpenDetails ? () => onOpenDetails(item) : undefined}
                            onOpenSchedule={onOpenSchedule ? () => onOpenSchedule(item) : undefined}
                            onOpenRecordings={onOpenRecordings ? () => onOpenRecordings(item) : undefined}
                            isFavorite={(sid ? favoriteIds?.has(`${sid}:${item.id}`) : false) ?? false}
                            onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(item) : undefined}
                            progress={
                                section === 'films' && sid
                                    ? (() => {
                                          const e = vodProgressMap[`${sid}:${item.id}`];
                                          return e ? { currentTime: e.currentTime, totalDuration: e.totalDuration, isWatched: e.isWatched } : undefined;
                                      })()
                                    : section === 'series' && sid && item.seriesId
                                    ? (() => {
                                          const s = seriesProgressMap[`${sid}:${item.seriesId}`];
                                          if (!s?.lastEpisode) return undefined;
                                          const { lastEpisode } = s;
                                          return {
                                              currentTime: lastEpisode.currentTime,
                                              totalDuration: lastEpisode.totalDuration,
                                              isWatched: lastEpisode.isWatched && s.watchedEpisodeIds.length > 0,
                                          };
                                      })()
                                    : undefined
                            }
                        />
                    </motion.div>
                    );
                })}
            </div>

            {items.length === 0 && !isLoading && isFavoritesView && (
                <div className={`rounded-xl border px-4 py-6 text-sm ${isDarkMode ? 'border-white/10 text-gray-300 bg-white/5' : 'border-gray-200 text-gray-600 bg-white'}`}>
                    Aucun favori
                </div>
            )}

            <div ref={sentinelRef} className="h-10 flex items-center justify-center">
                {isLoading && (
                    <div className={`inline-flex items-center gap-2 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>
                        <Loader2 size={16} className="animate-spin" />
                        Chargement de 50 éléments...
                    </div>
                )}
                {!hasMore && items.length > 0 && (
                    <span className={`text-sm ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                        Fin de la liste
                    </span>
                )}
            </div>
        </div>
    );
}
