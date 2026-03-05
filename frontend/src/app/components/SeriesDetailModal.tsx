import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Play, CalendarDays, Clock3 } from 'lucide-react';
import type { SeriesEpisode, SeriesInfoResponse } from '../lib/api';

interface SeriesDetailModalProps {
    open: boolean;
    isDarkMode: boolean;
    data: SeriesInfoResponse | null;
    onClose: () => void;
    onPlayEpisode: (episode: SeriesEpisode) => void;
}

export function SeriesDetailModal({
    open,
    isDarkMode,
    data,
    onClose,
    onPlayEpisode,
}: SeriesDetailModalProps) {
    const initialSeason = data?.seasons[0]?.seasonNumber ?? 1;
    const [selectedSeason, setSelectedSeason] = useState<number>(initialSeason);

    useEffect(() => {
        if (!data || data.seasons.length === 0) return;
        setSelectedSeason(data.seasons[0].seasonNumber);
    }, [data]);

    const activeEpisodes = useMemo(() => {
        if (!data) return [];
        const key = String(selectedSeason);
        return data.episodesBySeason[key] ?? [];
    }, [data, selectedSeason]);

    if (!open || !data) return null;

    return (
        <div className="fixed inset-0 z-[110] bg-black/80 backdrop-blur-sm p-4 sm:p-8 overflow-y-auto">
            <div className={`max-w-6xl mx-auto rounded-2xl border ${isDarkMode ? 'bg-black border-white/10' : 'bg-white border-gray-200'}`}>
                <div className="relative h-56 sm:h-72 overflow-hidden rounded-t-2xl">
                    {data.info.cover ? (
                        <img src={data.info.cover} alt={data.info.name} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-r from-red-700 to-orange-600" />
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent" />
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 rounded-lg bg-black/50 text-white hover:bg-black/70"
                    >
                        <X size={18} />
                    </button>
                    <div className="absolute bottom-4 left-4 right-4 text-white">
                        <h2 className="text-2xl sm:text-3xl font-bold mb-2">{data.info.name}</h2>
                        {data.info.plot && <p className="text-sm sm:text-base text-gray-200 line-clamp-2">{data.info.plot}</p>}
                    </div>
                </div>

                <div className="p-4 sm:p-6 space-y-6">
                    <div className="flex flex-wrap gap-3">
                        {data.seasons.map((season) => (
                            <button
                                key={season.seasonNumber}
                                onClick={() => setSelectedSeason(season.seasonNumber)}
                                className={`px-4 py-2 rounded-full text-sm border transition-colors ${selectedSeason === season.seasonNumber
                                    ? 'bg-gradient-to-r from-red-600 to-orange-600 text-white border-transparent'
                                    : isDarkMode
                                        ? 'border-white/20 text-gray-300 hover:bg-white/10'
                                        : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                                    }`}
                            >
                                Saison {season.seasonNumber} ({season.episodeCount})
                            </button>
                        ))}
                    </div>

                    <div className="space-y-3">
                        <AnimatePresence mode="wait">
                            <motion.div
                                key={selectedSeason}
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                className="space-y-2"
                            >
                                {activeEpisodes.map((episode) => (
                                    <div
                                        key={episode.id}
                                        className={`rounded-xl border p-3 sm:p-4 flex items-center justify-between gap-3 ${isDarkMode ? 'border-white/10 bg-white/5' : 'border-gray-200 bg-gray-50'
                                            }`}
                                    >
                                        <div className="min-w-0">
                                            <p className="font-medium truncate">
                                                E{episode.episodeNumber.toString().padStart(2, '0')} • {episode.title}
                                            </p>
                                            <div className={`text-xs mt-1 flex flex-wrap gap-3 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                                {episode.airDate && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <CalendarDays size={13} />
                                                        {episode.airDate}
                                                    </span>
                                                )}
                                                {episode.duration && (
                                                    <span className="inline-flex items-center gap-1">
                                                        <Clock3 size={13} />
                                                        {episode.duration}
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        <button
                                            onClick={() => onPlayEpisode(episode)}
                                            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white text-black font-semibold hover:bg-gray-200"
                                        >
                                            <Play size={15} fill="currentColor" />
                                            Lire
                                        </button>
                                    </div>
                                ))}
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
            </div>
        </div>
    );
}
