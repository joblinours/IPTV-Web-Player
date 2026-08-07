import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Play, Star, Star as StarFilled } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { useTmdbMatch } from '../hooks/useTmdbMatch';
import { ContentRow } from '../components/ContentRow';

/**
 * Dedicated page for a VOD movie. Xtream has no "single item" lookup
 * endpoint, so the item is found in the already-loaded catalog (from
 * AppContext) by id — the normal path when navigating from a row/card. A
 * direct deep link to an item that isn't currently loaded shows a graceful
 * "go back" state instead of a broken page.
 */
export function MovieDetailsPage() {
    const navigate = useNavigate();
    const params = useParams<{ accountId: string; itemId: string }>();
    const {
        isDarkMode, token, items, enrichedItems, handlePlay, vodProgressMap, accountId,
        favoritesBySection, toggleFavorite, seriesProgressMap,
    } = useAppContext();

    const item = items.find((candidate) => candidate.id === params.itemId);
    const tmdbMatch = useTmdbMatch(token, item?.title, item ? 'movie' : null, item?.year ?? undefined);

    if (!item) {
        return (
            <div className="max-w-2xl mx-auto px-4 py-24 text-center">
                <p className={isDarkMode ? 'text-gray-300' : 'text-gray-700'}>
                    Ce contenu n'est plus dans la liste chargée. Retournez au catalogue pour le retrouver.
                </p>
                <button
                    onClick={() => navigate('/films')}
                    className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 border border-white/20 hover:bg-white/20"
                >
                    <ArrowLeft size={16} /> Retour aux films
                </button>
            </div>
        );
    }

    const itemSourceId = item.sourceId ?? accountId;
    const progress = itemSourceId ? vodProgressMap[`${itemSourceId}:${item.id}`] : undefined;
    const isFavorite = favoritesBySection.films?.has(item.id) ?? false;
    const backdrop = tmdbMatch?.backdropUrl ?? item.poster;
    const description = tmdbMatch?.overview ?? item.description;

    const similar = enrichedItems.filter((candidate) => candidate.id !== item.id).slice(0, 12);

    return (
        <div>
            <div className="relative h-[45vh] min-h-[320px] overflow-hidden">
                {backdrop && <img src={backdrop} alt={item.title} className="w-full h-full object-cover" />}
                <div className={`absolute inset-0 bg-gradient-to-t ${isDarkMode ? 'from-black via-black/60' : 'from-gray-50 via-gray-50/60'} to-transparent`} />
                <button
                    onClick={() => navigate(-1)}
                    className="absolute top-6 left-4 sm:left-8 p-2.5 rounded-xl bg-black/50 backdrop-blur-sm text-white hover:bg-black/70 transition-colors"
                    aria-label="Retour"
                >
                    <ArrowLeft size={20} />
                </button>
            </div>

            <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 -mt-24 relative">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="aspect-[2/3] rounded-xl overflow-hidden bg-white/5 border border-white/10 max-w-[280px]">
                        {item.poster && <img src={item.poster} alt={item.title} className="w-full h-full object-cover" />}
                    </div>

                    <div className="md:col-span-2 pt-4 md:pt-24">
                        <h1 className={`text-3xl md:text-4xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{item.title}</h1>

                        <div className={`flex flex-wrap items-center gap-3 mb-6 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            {item.rating && (
                                <span className="inline-flex items-center gap-1">
                                    <Star size={14} className="text-yellow-500" fill="#EAB308" /> {item.rating}
                                </span>
                            )}
                            {item.year && <span>{item.year}</span>}
                            {item.genre && <span>{item.genre}</span>}
                            {item.duration && <span>{item.duration}</span>}
                        </div>

                        {description && <p className={`mb-8 max-w-2xl ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{description}</p>}

                        <div className="flex flex-wrap gap-3">
                            <button
                                onClick={() => handlePlay(item)}
                                className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-white text-black hover:bg-gray-200 transition-colors"
                            >
                                <Play size={18} fill="currentColor" />
                                {progress && !progress.isWatched && progress.currentTime > 0 ? 'Reprendre' : 'Lecture'}
                            </button>
                            <button
                                onClick={() => toggleFavorite(item)}
                                className="flex items-center gap-2 px-5 py-3 rounded-xl font-semibold bg-white/10 border border-white/20 hover:bg-white/20 transition-colors"
                            >
                                <StarFilled size={18} className={isFavorite ? 'text-yellow-500' : ''} fill={isFavorite ? '#EAB308' : 'none'} />
                                {isFavorite ? 'Dans les favoris' : 'Ajouter aux favoris'}
                            </button>
                        </div>

                        {progress && !progress.isWatched && progress.currentTime > 0 && progress.totalDuration > 0 && (
                            <div className="mt-4 h-1 rounded-full bg-white/20 overflow-hidden max-w-sm">
                                <div className="h-full bg-gradient-to-r from-red-600 to-orange-500" style={{ width: `${Math.min(100, (progress.currentTime / progress.totalDuration) * 100)}%` }} />
                            </div>
                        )}
                    </div>
                </div>

                {similar.length > 0 && (
                    <div className="mt-16 -mx-4 sm:-mx-6 lg:-mx-8">
                        <ContentRow
                            title="Films similaires"
                            section="films"
                            items={similar}
                            isDarkMode={isDarkMode}
                            onPlay={handlePlay}
                            favoriteIds={favoritesBySection.films}
                            onToggleFavorite={toggleFavorite}
                            vodProgressMap={vodProgressMap}
                            seriesProgressMap={seriesProgressMap}
                            accountId={accountId}
                        />
                    </div>
                )}

                <div className="h-16" />
            </div>
        </div>
    );
}
