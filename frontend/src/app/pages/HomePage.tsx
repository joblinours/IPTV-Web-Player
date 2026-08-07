import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAppContext } from '../AppContext';
import { HeroSlider } from '../components/HeroSlider';
import { CategoryTabs } from '../components/CategoryTabs';
import { ContentRow } from '../components/ContentRow';
import { PaginatedContentGrid } from '../components/PaginatedContentGrid';
import { ContentRowSkeleton } from '../components/skeletons/ContentRowSkeleton';
import { HeroSkeleton } from '../components/skeletons/HeroSkeleton';
import { fetchContentPage, type ContentItem, type SectionType } from '../lib/api';

const ROW_ITEM_LIMIT = 15;
const MAX_EXTRA_ROWS = 10;

/**
 * Netflix-style home view: hero slider always on top, then either —
 * - "Tous" (default): the selected category as a horizontal row (from the
 *   shared AppContext, same data the old grid used), plus a handful of
 *   additional category rows fetched independently so the page reads as
 *   "rows of categories" rather than one flat list. Each extra row is a
 *   small, capped, self-contained fetch — it never touches the shared
 *   catalog state in AppContext.
 * - a real category selected in the tabs below the hero: the row/extra-rows
 *   layout is replaced by a full paginated grid (PaginatedContentGrid,
 *   50-at-a-time, same "load more" mechanism SearchPage already uses) of
 *   every item in that category — reuses the exact same enrichedItems/
 *   hasMore/handleLoadMore state, no new fetch logic needed.
 */
export function HomePage() {
    const location = useLocation();
    const navigate = useNavigate();
    const {
        token, accountId, isDarkMode,
        activeSection, setActiveSection, currentCategories, currentCategory, handleCategoryChange,
        enrichedItems, isLoadingContent, hasMore, handleLoadMore,
        handlePlay, handleOpenSeriesDetails, handleOpenSchedule, handleOpenRecordings,
        favoritesBySection, toggleFavorite, vodProgressMap, seriesProgressMap,
    } = useAppContext();

    // The route (/live, /films, /series) drives which section is active —
    // keep it in sync with the shared context so Header/CategoryTabs agree.
    useEffect(() => {
        const routeSection = location.pathname.replace(/^\//, '') as SectionType;
        if (['live', 'films', 'series'].includes(routeSection) && routeSection !== activeSection) {
            setActiveSection(routeSection);
        }
    }, [location.pathname]); // eslint-disable-line react-hooks/exhaustive-deps

    const [extraRows, setExtraRows] = useState<Array<{ categoryId: string; name: string; items: ContentItem[] }>>([]);
    const [extraRowsLoading, setExtraRowsLoading] = useState(false);
    const isOverviewMode = currentCategory === 'all';

    // The extra-rows preview is only meaningful on the "Tous" overview —
    // once a real category is selected the grid below takes over, so skip
    // this fetch entirely (and clear anything already loaded, avoiding a
    // stale flash of the wrong rows when switching back).
    useEffect(() => {
        if (!token || !accountId || !isOverviewMode) {
            setExtraRows([]);
            return;
        }
        let cancelled = false;

        const realCategories = currentCategories
            .filter((c) => c.id !== 'favorites' && c.id !== 'all' && c.id !== currentCategory)
            .slice(0, MAX_EXTRA_ROWS);

        if (realCategories.length === 0) {
            setExtraRows([]);
            return;
        }

        setExtraRowsLoading(true);
        Promise.all(
            realCategories.map(async (category) => {
                try {
                    const result = await fetchContentPage(token, {
                        accountId,
                        section: activeSection,
                        categoryId: category.id,
                        searchQuery: '',
                        offset: 0,
                        limit: ROW_ITEM_LIMIT,
                    });
                    return { categoryId: category.id, name: category.name, items: result.items };
                } catch {
                    return { categoryId: category.id, name: category.name, items: [] as ContentItem[] };
                }
            })
        )
            .then((rows) => {
                if (!cancelled) setExtraRows(rows.filter((row) => row.items.length > 0));
            })
            .finally(() => {
                if (!cancelled) setExtraRowsLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [token, accountId, isOverviewMode, activeSection, currentCategories, currentCategory]);

    const favoriteIds = favoritesBySection[activeSection];
    const isFavoritesView = currentCategory === 'favorites';
    const onOpenDetails =
        activeSection === 'series'
            ? handleOpenSeriesDetails
            : activeSection === 'films'
            ? (item: ContentItem) => navigate(`/movie/${item.sourceId ?? accountId}/${item.id}`)
            : undefined;

    return (
        <div className="space-y-10">
            {isLoadingContent && enrichedItems.length === 0 ? (
                <HeroSkeleton />
            ) : (
                <HeroSlider
                    type={activeSection}
                    isDarkMode={isDarkMode}
                    items={enrichedItems}
                    token={token}
                    onPlay={handlePlay}
                    onInfo={(item) => {
                        if (activeSection === 'series') handleOpenSeriesDetails(item);
                        else handlePlay(item);
                    }}
                />
            )}

            <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
                <CategoryTabs
                    categories={currentCategories}
                    selectedCategory={currentCategory}
                    onCategoryChange={handleCategoryChange}
                    isDarkMode={isDarkMode}
                />
            </div>

            {isOverviewMode ? (
                <div className="max-w-[1920px] mx-auto space-y-10">
                    {isLoadingContent && enrichedItems.length === 0 ? (
                        <ContentRowSkeleton />
                    ) : (
                        <ContentRow
                            title={currentCategories.find((c) => c.id === currentCategory)?.name ?? 'Contenu'}
                            section={activeSection}
                            items={enrichedItems}
                            isDarkMode={isDarkMode}
                            onPlay={handlePlay}
                            onOpenDetails={onOpenDetails}
                            onOpenSchedule={activeSection === 'live' ? handleOpenSchedule : undefined}
                            onOpenRecordings={activeSection === 'live' ? handleOpenRecordings : undefined}
                            favoriteIds={favoriteIds}
                            onToggleFavorite={toggleFavorite}
                            vodProgressMap={vodProgressMap}
                            seriesProgressMap={seriesProgressMap}
                            accountId={accountId}
                        />
                    )}

                    {extraRows.map((row) => (
                        <ContentRow
                            key={row.categoryId}
                            title={row.name}
                            section={activeSection}
                            items={row.items}
                            isDarkMode={isDarkMode}
                            onPlay={handlePlay}
                            onOpenDetails={onOpenDetails}
                            onOpenSchedule={activeSection === 'live' ? handleOpenSchedule : undefined}
                            onOpenRecordings={activeSection === 'live' ? handleOpenRecordings : undefined}
                            favoriteIds={favoriteIds}
                            onToggleFavorite={toggleFavorite}
                            vodProgressMap={vodProgressMap}
                            seriesProgressMap={seriesProgressMap}
                            accountId={accountId}
                        />
                    ))}

                    {extraRowsLoading && extraRows.length === 0 && <ContentRowSkeleton />}
                </div>
            ) : (
                // A real category (or "Favoris") is selected: show every
                // item in it, 50 at a time, instead of a single row — no
                // new fetch logic, this is the exact same paginated state
                // (enrichedItems/hasMore/handleLoadMore) SearchPage already
                // renders through the same PaginatedContentGrid.
                <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
                    <PaginatedContentGrid
                        section={activeSection}
                        items={enrichedItems}
                        isDarkMode={isDarkMode}
                        isLoading={isLoadingContent}
                        hasMore={hasMore}
                        onLoadMore={handleLoadMore}
                        onPlay={handlePlay}
                        onOpenDetails={onOpenDetails}
                        onOpenSchedule={activeSection === 'live' ? handleOpenSchedule : undefined}
                        onOpenRecordings={activeSection === 'live' ? handleOpenRecordings : undefined}
                        isFavoritesView={isFavoritesView}
                        favoriteIds={favoriteIds}
                        onToggleFavorite={toggleFavorite}
                        vodProgressMap={vodProgressMap}
                        seriesProgressMap={seriesProgressMap}
                        accountId={accountId}
                    />
                </div>
            )}

            <div className="h-12" />
        </div>
    );
}
