import { useRef, useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ContentCard } from './ContentCard';
import { useAppContext } from '../AppContext';
import { useTmdbMatchBatch } from '../hooks/useTmdbMatchBatch';
import type { ContentItem, ProgressEntry, SeriesProgressSummary, SectionType } from '../lib/api';

interface ContentRowProps {
    title: string;
    section: SectionType;
    items: ContentItem[];
    isDarkMode: boolean;
    onPlay: (item: ContentItem) => void;
    onOpenDetails?: (item: ContentItem) => void;
    onOpenSchedule?: (item: ContentItem) => void;
    onOpenRecordings?: (item: ContentItem) => void;
    favoriteIds?: Set<string>;
    onToggleFavorite?: (item: ContentItem) => void;
    vodProgressMap?: Record<string, ProgressEntry>;
    seriesProgressMap?: Record<string, SeriesProgressSummary>;
    accountId?: number | null;
}

/**
 * Netflix-style horizontal row — the primary browsing surface on HomePage,
 * replacing the flat grid for the "everything at once" view. Reuses the
 * existing ContentCard (poster + hover overlay with play/favorite/details)
 * unchanged; only the layout around it (horizontal scroll + chevrons
 * instead of a CSS grid) is new.
 */
export function ContentRow({
    title,
    section,
    items,
    isDarkMode,
    onPlay,
    onOpenDetails,
    onOpenSchedule,
    onOpenRecordings,
    favoriteIds,
    onToggleFavorite,
    vodProgressMap = {},
    seriesProgressMap = {},
    accountId,
}: ContentRowProps) {
    const { token } = useAppContext();
    // TMDB enrichment applies to every row now (films AND series), not just
    // the Hero — a plain, cache-only batch call per row, falling back to
    // Xtream/Jellyfin's own metadata wherever nothing's cached yet.
    const { getMatch } = useTmdbMatchBatch(token, section === 'live' ? [] : items, section === 'series' ? 'series' : 'movie');

    const scrollRef = useRef<HTMLDivElement>(null);
    const [canScrollLeft, setCanScrollLeft] = useState(false);
    const [canScrollRight, setCanScrollRight] = useState(false);

    const updateScrollState = () => {
        const node = scrollRef.current;
        if (!node) return;
        setCanScrollLeft(node.scrollLeft > 8);
        setCanScrollRight(node.scrollLeft + node.clientWidth < node.scrollWidth - 8);
    };

    useEffect(() => {
        updateScrollState();
    }, [items]);

    const scrollBy = (direction: 'left' | 'right') => {
        const node = scrollRef.current;
        if (!node) return;
        const delta = node.clientWidth * 0.85 * (direction === 'left' ? -1 : 1);
        node.scrollBy({ left: delta, behavior: 'smooth' });
    };

    if (items.length === 0) return null;

    return (
        <div className="group/row relative space-y-3">
            <h2 className={`text-xl md:text-2xl font-bold px-4 sm:px-6 lg:px-8 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                {title}
            </h2>

            <div className="relative">
                {canScrollLeft && (
                    <button
                        onClick={() => scrollBy('left')}
                        aria-label="Précédent"
                        className="absolute left-0 top-0 bottom-0 z-20 w-16 flex items-center justify-start pl-2 bg-gradient-to-r from-black/70 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity"
                    >
                        <span className="w-10 h-10 rounded-full bg-black/60 border border-white/10 flex items-center justify-center">
                            <ChevronLeft size={20} />
                        </span>
                    </button>
                )}

                <div
                    ref={scrollRef}
                    onScroll={updateScrollState}
                    className="flex gap-4 overflow-x-auto scroll-smooth px-4 sm:px-6 lg:px-8 pb-2"
                    style={{ scrollbarWidth: 'none' }}
                >
                    {items.map((item, index) => {
                        // Falls back to the ambient accountId only for items
                        // that somehow lack their own sourceId (shouldn't
                        // happen for real API responses, both providers set
                        // it) — keeps favorite/progress lookups correct once
                        // a row can mix items from more than one source.
                        const sid = item.sourceId ?? accountId;
                        const tmdb = section === 'live' ? null : getMatch(item.title, item.year);
                        return (
                        <div key={`${item.source ?? 'xt'}-${item.id}-${index}`} className="flex-none">
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
                        </div>
                        );
                    })}
                </div>

                {canScrollRight && (
                    <button
                        onClick={() => scrollBy('right')}
                        aria-label="Suivant"
                        className="absolute right-0 top-0 bottom-0 z-20 w-16 flex items-center justify-end pr-2 bg-gradient-to-l from-black/70 to-transparent opacity-0 group-hover/row:opacity-100 transition-opacity"
                    >
                        <span className="w-10 h-10 rounded-full bg-black/60 border border-white/10 flex items-center justify-center">
                            <ChevronRight size={20} />
                        </span>
                    </button>
                )}
            </div>
        </div>
    );
}
