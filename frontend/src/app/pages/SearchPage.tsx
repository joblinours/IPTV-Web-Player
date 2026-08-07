import { Search } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { PaginatedContentGrid } from '../components/PaginatedContentGrid';

/**
 * Dedicated search results page — reuses the existing grid (PaginatedContentGrid)
 * rather than rows, matching the plan's "grid stays for search/genre results"
 * split. The actual search fetch/debounce logic already lives in AppShell
 * (unchanged from before routing existed); this page just renders its output.
 */
export function SearchPage() {
    const {
        isDarkMode, searchQuery, setSearchQuery, activeSection,
        enrichedItems, isLoadingContent, hasMore, handleLoadMore,
        handlePlay, handleOpenSeriesDetails, handleOpenSchedule, handleOpenRecordings,
        favoritesBySection, toggleFavorite, vodProgressMap, seriesProgressMap, accountId,
        currentCategory,
    } = useAppContext();

    return (
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-16">
            <div className="max-w-xl mb-8">
                <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`}>
                    <Search size={20} className={isDarkMode ? 'text-gray-400' : 'text-gray-500'} />
                    <input
                        autoFocus
                        value={searchQuery}
                        onChange={(event) => setSearchQuery(event.target.value)}
                        placeholder={`Rechercher dans ${activeSection === 'live' ? 'les chaînes' : activeSection === 'films' ? 'les films' : 'les séries'}...`}
                        className={`flex-1 bg-transparent outline-none ${isDarkMode ? 'text-white placeholder-gray-500' : 'text-gray-900 placeholder-gray-400'}`}
                    />
                </div>
            </div>

            {searchQuery.trim() === '' ? (
                <p className={isDarkMode ? 'text-gray-400' : 'text-gray-600'}>Commencez à taper pour rechercher.</p>
            ) : (
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
                    onToggleFavorite={toggleFavorite}
                    vodProgressMap={vodProgressMap}
                    seriesProgressMap={seriesProgressMap}
                    accountId={accountId}
                />
            )}
        </div>
    );
}
