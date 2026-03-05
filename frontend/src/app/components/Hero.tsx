import { motion } from 'motion/react';
import { Play, Info, Radio } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import type { ContentItem } from '../lib/api';

interface HeroProps {
  type: 'live' | 'films' | 'series';
  isDarkMode: boolean;
  featuredItem?: ContentItem | null;
  onPlay?: () => void;
  onInfo?: () => void;
}

export function Hero({ type, isDarkMode, featuredItem, onPlay, onInfo }: HeroProps) {
  const getHeroContent = () => {
    const fallbackTitle = type === 'live' ? 'Live' : type === 'films' ? 'Film' : 'Série';
    switch (type) {
      case 'live':
        return {
          title: featuredItem?.title ?? fallbackTitle,
          description: featuredItem?.description ?? 'Chaîne en direct disponible.',
          badge: 'EN DIRECT',
          image: featuredItem?.poster ?? 'sports stadium live',
        };
      case 'films':
        return {
          title: featuredItem?.title ?? fallbackTitle,
          description: featuredItem?.description ?? 'Film disponible dans le catalogue.',
          badge: 'TENDANCE',
          duration: featuredItem?.year ?? '',
          image: featuredItem?.poster ?? 'movie cinema thriller',
        };
      case 'series':
        return {
          title: featuredItem?.title ?? fallbackTitle,
          description: featuredItem?.description ?? 'Série disponible dans le catalogue.',
          badge: 'POPULAIRE',
          seasons: featuredItem?.year ?? '',
          image: featuredItem?.poster ?? 'tv series drama',
        };
    }
  };

  const content = getHeroContent();

  return (
    <div className="relative h-[85vh] mt-20 overflow-hidden">
      {/* Background Image */}
      <div className="absolute inset-0">
        <ImageWithFallback
          src={content.image?.startsWith('http') ? content.image : `https://source.unsplash.com/1920x1080/?${content.image}&sig=${type}`}
          alt={content.title}
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black via-black/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent" />
      </div>

      {/* Content */}
      <div className="relative h-full max-w-[1920px] mx-auto px-4 sm:px-6 lg:px-8 flex items-end pb-20">
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.6 }}
          className="max-w-2xl"
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3, duration: 0.5 }}
            className={`inline-flex items-center gap-2 px-4 py-2 rounded-full backdrop-blur-xl border mb-6 ${isDarkMode
                ? 'bg-gradient-to-r from-red-600/30 to-orange-600/30 border-white/20'
                : 'bg-gradient-to-r from-red-100 to-orange-100 border-red-200'
              }`}
          >
            {type === 'live' && <Radio size={16} className="text-red-500 animate-pulse" />}
            <span className="text-sm font-semibold">{content.badge}</span>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className={`text-5xl md:text-7xl font-bold mb-4 ${isDarkMode
                ? 'bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent'
                : 'text-gray-900'
              }`}
          >
            {content.title}
          </motion.h1>

          {/* Meta Info */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.5 }}
            className="flex items-center gap-4 mb-6 text-sm"
          >
            {type === 'live' && (
              <>
                <span className="text-gray-300">Chaîne live</span>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
              </>
            )}
            {type === 'films' && (
              <>
                <span className="text-gray-300">{content.duration || 'Film'}</span>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
                <span className="text-gray-300">VOD</span>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
              </>
            )}
            {type === 'series' && (
              <>
                <span className="text-gray-300">{content.seasons || 'Série'}</span>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
                <span className="text-gray-300">Catalogue</span>
                <span className="w-1 h-1 bg-gray-500 rounded-full" />
              </>
            )}
            <div className="px-2 py-1 bg-white/10 backdrop-blur-sm rounded border border-white/20">
              <span className="text-xs font-semibold">16+</span>
            </div>
          </motion.div>

          {/* Description */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5 }}
            className={`text-lg mb-8 leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}
          >
            {content.description}
          </motion.p>

          {/* Actions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.5 }}
            className="flex flex-wrap gap-4"
          >
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onPlay}
              className={`flex items-center gap-3 px-8 py-4 rounded-xl font-semibold transition-colors shadow-2xl ${isDarkMode
                  ? 'bg-white text-black hover:bg-gray-200'
                  : 'bg-gradient-to-r from-red-600 to-orange-600 text-white hover:from-red-700 hover:to-orange-700'
                }`}
            >
              <Play size={20} fill="currentColor" />
              <span>{type === 'live' ? 'Regarder en Direct' : 'Lecture'}</span>
            </motion.button>

            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={onInfo}
              className={`flex items-center gap-3 px-8 py-4 backdrop-blur-xl border rounded-xl font-semibold transition-colors ${isDarkMode
                  ? 'bg-white/10 border-white/20 hover:bg-white/20'
                  : 'bg-white/50 border-gray-300 hover:bg-white/70'
                }`}
            >
              <Info size={20} />
              <span>Plus d'infos</span>
            </motion.button>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
