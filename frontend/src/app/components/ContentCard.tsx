import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { Play, Radio, Plus, ChevronDown, Star, Calendar, CheckCircle2 } from 'lucide-react';

interface ContentCardProgress {
  currentTime: number;
  totalDuration: number;
  isWatched: boolean;
}

interface ContentCardProps {
  title: string;
  type: 'live' | 'films' | 'series';
  index: number;
  isDarkMode: boolean;
  poster?: string | null;
  description?: string | null;
  genre?: string | null;
  year?: string | null;
  rating?: string | null;
  hasArchive?: boolean;
  seasonsCount?: number | null;
  episodesCount?: number | null;
  onPlay?: () => void;
  onDetails?: () => void;
  onOpenSchedule?: () => void;
  onOpenRecordings?: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
  progress?: ContentCardProgress;
}

export function ContentCard({
  title,
  type,
  index,
  isDarkMode,
  poster,
  description,
  genre,
  year,
  rating,
  hasArchive,
  seasonsCount,
  episodesCount,
  onPlay,
  onDetails,
  onOpenSchedule,
  onOpenRecordings,
  isFavorite = false,
  onToggleFavorite,
  progress,
}: ContentCardProps) {
  const [isHovered, setIsHovered] = useState(false);

  const getImageQuery = () => {
    switch (type) {
      case 'live':
        return 'live broadcast event';
      case 'films':
        return 'movie cinema film';
      case 'series':
        return 'tv show series';
      default:
        return 'entertainment';
    }
  };

  const getMetaInfo = () => {
    switch (type) {
      case 'live':
        return {
          primary: 'En direct',
          secondary: 'En direct',
          badge: 'LIVE',
        };
      case 'films':
        return {
          primary: year ?? 'Film',
          secondary: 'VOD',
          rating: rating ?? null,
        };
      case 'series':
        return {
          primary: seasonsCount ? `${seasonsCount} saison${seasonsCount > 1 ? 's' : ''}` : 'Série',
          secondary: episodesCount ? `${episodesCount} épisodes` : (year ?? 'Séries'),
          rating: rating ?? null,
        };
    }
  };

  const tags = (genre ?? '')
    .split(/[/,|]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);

  const meta = getMetaInfo();

  const showProgressBar = !!(progress && progress.currentTime > 0 && progress.totalDuration > 0 && !progress.isWatched);
  const progressPercent = showProgressBar
    ? Math.min(100, (progress!.currentTime / progress!.totalDuration) * 100)
    : 0;

  return (
    <motion.div
      className="relative w-[280px] cursor-pointer"
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      onClick={type === 'series' ? onDetails : onPlay}
      whileHover={{ scale: 1.05, zIndex: 10 }}
      transition={{ duration: 0.2 }}
    >
      {/* Main Card */}
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-gray-900">
        <ImageWithFallback
          src={poster ?? `https://source.unsplash.com/560x840/?${getImageQuery()}&sig=${index}`}
          alt={title}
          className="w-full h-full object-cover"
        />

        {/* Gradient Overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />

        {/* Watched badge */}
        {progress?.isWatched && (
          <div className="absolute top-2 left-2 flex items-center gap-1 px-1.5 py-0.5 bg-green-600/90 backdrop-blur-sm rounded-md">
            <CheckCircle2 size={11} className="text-white" />
            <span className="text-[10px] font-bold text-white">Vu</span>
          </div>
        )}

        {/* Live Badge */}
        {type === 'live' && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute top-3 right-3 flex items-center gap-1.5 px-3 py-1.5 bg-red-600 rounded-full"
          >
            <Radio size={12} className="animate-pulse" />
            <span className="text-xs font-bold">LIVE</span>
          </motion.div>
        )}

        {/* Rating Badge */}
        {type !== 'live' && meta.rating && (
          <div className="absolute top-3 right-3 flex items-center gap-1 px-2.5 py-1 bg-black/60 backdrop-blur-sm rounded-lg border border-white/20">
            <Star size={14} fill="#FFD700" className="text-yellow-500" />
            <span className="text-sm font-semibold">{meta.rating}</span>
          </div>
        )}

        {/* Bottom Info — default state, always visible, hidden behind the hover overlay below */}
        <div className="absolute bottom-0 left-0 right-0 p-4">
          <h3 className="text-white font-semibold mb-1 line-clamp-1">{title}</h3>
          <div className="flex items-center gap-2 text-xs text-gray-300">
            <span>{meta.primary}</span>
            <span className="w-1 h-1 bg-gray-500 rounded-full" />
            <span>{meta.secondary}</span>
          </div>
          {/* Progress bar */}
          {showProgressBar && (
            <div className="mt-2 h-1 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-red-600 to-orange-500 rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>

        {/* Hover overlay: title/description/actions superimposed on the
            thumbnail itself (was previously a separate block pushed below
            the card, forcing a scroll to reach it — everything now stays
            within the card's own bounds, `overflow-hidden` above clips it). */}
        <AnimatePresence>
          {isHovered && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="absolute inset-0 flex flex-col justify-between p-4 bg-black/80 backdrop-blur-sm"
            >
              <div>
                <h3 className="text-white font-semibold line-clamp-2">{title}</h3>
                <div className="flex items-center gap-2 text-xs text-gray-300 mt-1">
                  <span>{meta.primary}</span>
                  <span className="w-1 h-1 bg-gray-500 rounded-full" />
                  <span>{meta.secondary}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onPlay?.();
                  }}
                  className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-white text-black rounded-lg font-semibold hover:bg-gray-200 transition-colors"
                >
                  <Play size={16} fill="currentColor" />
                  <span className="text-sm">Lecture</span>
                </motion.button>

                <motion.button
                  whileHover={{ scale: 1.1 }}
                  whileTap={{ scale: 0.9 }}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFavorite?.();
                  }}
                  className="p-2 rounded-lg border bg-white/10 hover:bg-white/20 border-white/20 transition-colors"
                  aria-label={isFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'}
                >
                  <Star size={16} className={isFavorite ? 'text-yellow-500' : 'text-white'} fill={isFavorite ? '#EAB308' : 'none'} />
                </motion.button>

                {type !== 'live' && onDetails && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDetails();
                    }}
                    className="p-2 rounded-lg border bg-white/10 hover:bg-white/20 border-white/20 transition-colors"
                  >
                    <Plus size={16} className="text-white" />
                  </motion.button>
                )}

                {type === 'live' && onOpenSchedule && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenSchedule();
                    }}
                    className="p-2 rounded-lg border bg-white/10 hover:bg-white/20 border-white/20 transition-colors"
                  >
                    <Calendar size={16} className="text-white" />
                  </motion.button>
                )}

                {type === 'live' && onOpenRecordings && (
                  <motion.button
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.9 }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenRecordings();
                    }}
                    className="p-2 rounded-lg border bg-white/10 hover:bg-white/20 border-white/20 transition-colors"
                  >
                    <ChevronDown size={16} className="text-white" />
                  </motion.button>
                )}
              </div>

              <div>
                <p className="text-xs text-gray-300 line-clamp-3 mb-2">
                  {description ?? 'Aucune description disponible.'}
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {type === 'live' ? (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-gray-200">
                      {hasArchive ? 'Replay disponible' : 'Replay non disponible'}
                    </span>
                  ) : tags.length > 0 ? (
                    tags.slice(0, 2).map((tag) => (
                      <span key={tag} className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-gray-200">
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] bg-white/10 text-gray-200">
                      Non classé
                    </span>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
