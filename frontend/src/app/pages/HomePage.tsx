import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import { useAppContext } from '../AppContext';
import { HeroSlider } from '../components/HeroSlider';
import { CategoryTabs } from '../components/CategoryTabs';
import { ContentRow } from '../components/ContentRow';
import { ContentRowSkeleton } from '../components/skeletons/ContentRowSkeleton';
import { HeroSkeleton } from '../components/skeletons/HeroSkeleton';
import { fetchContentPage, type ContentItem, type SectionType } from '../lib/api';

const ROW_ITEM_LIMIT = 15;
const MAX_EXTRA_ROWS = 5;

/**
 * Netflix-style home view: hero slider + the selected category as a
 * horizontal row (from the shared AppContext, same data the old grid used),
 * plus a handful of additional category rows fetched independently so the
 * page reads as "rows of categories" rather than one flat list. Each extra
 * row is a small, capped, self-contained fetch — it never touches the
 * shared catalog state in AppContext.
 */
export function HomePage() {
    const location = useLocation();
    const navigate = useNavigate();
    const {
        token, accountId, isDarkMode,
        activeSection, setActiveSection, currentCategories, currentCategory, handleCategoryChange,
        enrichedItems, isLoadingContent,
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

    useEffect(() => {
        if (!token || !accountId) return;
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
    }, [token, accountId, activeSection, currentCategories, currentCategory]);

    const favoriteIds = favoritesBySection[activeSection];
    const isFavoritesView = currentCategory === 'favorites';

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
                        onOpenDetails={
                            activeSection === 'series'
                                ? handleOpenSeriesDetails
                                : activeSection === 'films'
                                ? (item) => navigate(`/movie/${accountId}/${item.id}`)
                                : undefined
                        }
                        onOpenSchedule={activeSection === 'live' ? handleOpenSchedule : undefined}
                        onOpenRecordings={activeSection === 'live' ? handleOpenRecordings : undefined}
                        favoriteIds={favoriteIds}
                        onToggleFavorite={toggleFavorite}
                        vodProgressMap={vodProgressMap}
                        seriesProgressMap={seriesProgressMap}
                        accountId={accountId}
                    />
                )}

                {enrichedItems.length === 0 && !isLoadingContent && isFavoritesView && (
                    <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8">
                        <div className={`rounded-xl border px-4 py-6 text-sm ${isDarkMode ? 'border-white/10 text-gray-300 bg-white/5' : 'border-gray-200 text-gray-600 bg-white'}`}>
                            Aucun favori
                        </div>
                    </div>
                )}

                {!isFavoritesView && extraRows.map((row) => (
                    <ContentRow
                        key={row.categoryId}
                        title={row.name}
                        section={activeSection}
                        items={row.items}
                        isDarkMode={isDarkMode}
                        onPlay={handlePlay}
                        onOpenDetails={
                            activeSection === 'series'
                                ? handleOpenSeriesDetails
                                : activeSection === 'films'
                                ? (item) => navigate(`/movie/${accountId}/${item.id}`)
                                : undefined
                        }
                        onOpenSchedule={activeSection === 'live' ? handleOpenSchedule : undefined}
                        onOpenRecordings={activeSection === 'live' ? handleOpenRecordings : undefined}
                        favoriteIds={favoriteIds}
                        onToggleFavorite={toggleFavorite}
                        vodProgressMap={vodProgressMap}
                        seriesProgressMap={seriesProgressMap}
                        accountId={accountId}
                    />
                ))}

                {!isFavoritesView && extraRowsLoading && extraRows.length === 0 && <ContentRowSkeleton />}
            </div>

            <div className="h-12" />
        </div>
    );
}
