import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Play, CalendarDays, Clock3, CheckCircle2, Star } from 'lucide-react';
import { useAppContext } from '../AppContext';
import { DetailsSkeleton } from '../components/skeletons/DetailsSkeleton';
import { ContentRow } from '../components/ContentRow';

/**
 * Dedicated page for a series' seasons/episodes — replaces the old
 * SeriesDetailModal overlay. Reads seriesDetailData/seriesDetailLoading from
 * AppContext (fetched by handleOpenSeriesDetails, unchanged from before
 * routing existed) and renders it full-page instead of in a modal.
 */
export function SeriesDetailsPage() {
    const navigate = useNavigate();
    const params = useParams<{ accountId: string; seriesId: string }>();
    const {
        isDarkMode, seriesDetailData, seriesDetailLoading, episodeProgressMap,
        handlePlayEpisode, enrichedItems, activeSection, handlePlay, favoritesBySection, toggleFavorite,
        vodProgressMap, seriesProgressMap, accountId,
    } = useAppContext();

    const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

    useEffect(() => {
        if (seriesDetailData?.seasons.length) {
            setSelectedSeason(seriesDetailData.seasons[0].seasonNumber);
        }
    }, [seriesDetailData]);

    const activeEpisodes = useMemo(() => {
        if (!seriesDetailData || selectedSeason === null) return [];
        return seriesDetailData.episodesBySeason[String(selectedSeason)] ?? [];
    }, [seriesDetailData, selectedSeason]);

    if (seriesDetailLoading || !seriesDetailData) {
        return <DetailsSkeleton />;
    }

    const { info } = seriesDetailData;
    const similar = activeSection === 'series'
        ? enrichedItems.filter((item) => String(item.seriesId) !== params.seriesId).slice(0, 12)
        : [];

    return (
        <div>
            <div className="relative h-[45vh] min-h-[320px] overflow-hidden">
                {info.backdropPath[0] || info.cover ? (
                    <img src={info.backdropPath[0] ?? info.cover ?? undefined} alt={info.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-gradient-to-br from-red-900/40 via-black to-orange-900/30" />
                )}
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
                    <div className="space-y-4">
                        <div className="aspect-[2/3] rounded-xl overflow-hidden bg-white/5 border border-white/10 max-w-[280px]">
                            {info.cover && <img src={info.cover} alt={info.name} className="w-full h-full object-cover" />}
                        </div>
                    </div>

                    <div className="md:col-span-2 pt-4 md:pt-24">
                        <h1 className={`text-3xl md:text-4xl font-bold mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>{info.name}</h1>

                        <div className={`flex flex-wrap items-center gap-3 mb-4 text-sm ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`}>
                            {info.rating && (
                                <span className="inline-flex items-center gap-1">
                                    <Star size={14} className="text-yellow-500" fill="#EAB308" /> {info.rating}
                                </span>
                            )}
                            {info.releaseDate && <span>{info.releaseDate}</span>}
                            {info.genre && <span>{info.genre}</span>}
                        </div>

                        {info.plot && <p className={`mb-6 max-w-2xl ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>{info.plot}</p>}

                        <div className="flex flex-wrap gap-3 mb-8">
                            {seriesDetailData.seasons.map((season) => (
                                <button
                                    key={season.seasonNumber}
                                    onClick={() => setSelectedSeason(season.seasonNumber)}
                                    className={`px-4 py-2 rounded-full text-sm border transition-colors ${selectedSeason === season.seasonNumber
                                        ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white border-transparent'
                                        : isDarkMode ? 'border-white/20 text-gray-300 hover:bg-white/10' : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                                        }`}
                                >
                                    Saison {season.seasonNumber} ({season.episodeCount})
                                </button>
                            ))}
                        </div>

                        <div className="space-y-2">
                            <AnimatePresence mode="wait">
                                <motion.div key={selectedSeason} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-2">
                                    {activeEpisodes.map((episode) => {
                                        const prog = episodeProgressMap[String(episode.id)];
                                        return (
                                            <div
                                                key={episode.id}
                                                className={`rounded-xl border p-3 sm:p-4 flex items-center justify-between gap-3 ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'}`}
                                            >
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-1.5">
                                                        {prog?.isWatched && <CheckCircle2 size={14} className="text-green-500 shrink-0" />}
                                                        <p className={`font-medium truncate ${prog?.isWatched ? 'text-gray-500' : ''}`}>
                                                            E{episode.episodeNumber.toString().padStart(2, '0')} • {episode.title}
                                                        </p>
                                                    </div>
                                                    <div className={`text-xs mt-1 flex flex-wrap gap-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                        {episode.airDate && <span className="inline-flex items-center gap-1"><CalendarDays size={13} />{episode.airDate}</span>}
                                                        {episode.duration && <span className="inline-flex items-center gap-1"><Clock3 size={13} />{episode.duration}</span>}
                                                    </div>
                                                    {prog && !prog.isWatched && prog.currentTime > 0 && prog.totalDuration > 0 && (
                                                        <div className="mt-2 h-0.5 rounded-full bg-white/20 overflow-hidden max-w-xs">
                                                            <div className="h-full bg-gradient-to-r from-red-600 to-orange-500" style={{ width: `${Math.min(100, (prog.currentTime / prog.totalDuration) * 100)}%` }} />
                                                        </div>
                                                    )}
                                                </div>

                                                <button
                                                    onClick={() => handlePlayEpisode(episode)}
                                                    className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-200"
                                                >
                                                    <Play size={15} fill="currentColor" />
                                                    {prog && !prog.isWatched && prog.currentTime > 0 ? 'Reprendre' : 'Lire'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </motion.div>
                            </AnimatePresence>
                        </div>
                    </div>
                </div>

                {similar.length > 0 && (
                    <div className="mt-16 -mx-4 sm:-mx-6 lg:-mx-8">
                        <ContentRow
                            title="Séries similaires"
                            section="series"
                            items={similar}
                            isDarkMode={isDarkMode}
                            onPlay={handlePlay}
                            favoriteIds={favoritesBySection.series}
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
