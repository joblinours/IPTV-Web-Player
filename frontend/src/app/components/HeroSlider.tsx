import { useCallback, useEffect, useRef, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Info, Radio } from 'lucide-react';
import { ImageWithFallback } from './figma/ImageWithFallback';
import { useTmdbMatch } from '../hooks/useTmdbMatch';
import type { ContentItem, SectionType } from '../lib/api';

const AUTO_ADVANCE_MS = 6000;

interface HeroSliderProps {
    type: SectionType;
    isDarkMode: boolean;
    items: ContentItem[];
    token?: string | null;
    onPlay: (item: ContentItem) => void;
    onInfo: (item: ContentItem) => void;
}

function Slide({ type, item, isActive, token, onPlay, onInfo }: {
    type: SectionType;
    item: ContentItem;
    isActive: boolean;
    token?: string | null;
    onPlay: () => void;
    onInfo: () => void;
}) {
    const tmdbType = type === 'films' ? 'movie' : type === 'series' ? 'series' : null;
    const tmdbMatch = useTmdbMatch(token, item.title, tmdbType, item.year ?? undefined);

    const fallbackTitle = type === 'live' ? 'Live' : type === 'films' ? 'Film' : 'Série';
    const badge = type === 'live' ? 'EN DIRECT' : type === 'films' ? 'TENDANCE' : 'POPULAIRE';
    const image = tmdbMatch?.backdropUrl ?? item.poster ?? 'entertainment';
    const description = tmdbMatch?.overview ?? item.description ?? 'Disponible dans le catalogue.';

    return (
        <div className="relative h-[70vh] min-h-[420px] max-h-[680px] flex-none w-full overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10">
            <div className="absolute inset-0">
                <ImageWithFallback
                    src={image.startsWith('http') ? image : `https://source.unsplash.com/1920x1080/?${image}`}
                    alt={item.title}
                    className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/50 to-transparent" />
                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/40 to-transparent" />
            </div>

            <div className="relative h-full max-w-[1920px] mx-auto px-6 sm:px-8 lg:px-12 flex items-end pb-16">
                <AnimatePresence>
                    {isActive && (
                        <motion.div
                            initial={{ opacity: 0, y: 30 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.5 }}
                            className="max-w-2xl"
                        >
                            <div className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full backdrop-blur-xl border mb-4 text-sm font-semibold ${type === 'live' ? 'bg-red-600/30 border-white/20' : 'bg-white/10 border-white/20'}`}>
                                {type === 'live' && <Radio size={14} className="text-red-500 animate-pulse" />}
                                {badge}
                            </div>

                            <h2 className="text-3xl md:text-5xl font-bold mb-3 bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                                {item.title || fallbackTitle}
                            </h2>

                            <p className="text-sm md:text-base text-gray-300 mb-6 line-clamp-3">{description}</p>

                            <div className="flex flex-wrap gap-3">
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={onPlay}
                                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-white text-black hover:bg-gray-200 transition-colors"
                                >
                                    <Play size={18} fill="currentColor" />
                                    {type === 'live' ? 'Regarder en direct' : 'Lecture'}
                                </motion.button>
                                <motion.button
                                    whileHover={{ scale: 1.05 }}
                                    whileTap={{ scale: 0.95 }}
                                    onClick={onInfo}
                                    className="flex items-center gap-2 px-6 py-3 rounded-xl font-semibold bg-white/15 border border-white/20 hover:bg-white/25 transition-colors"
                                >
                                    <Info size={18} />
                                    Plus d'infos
                                </motion.button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
        </div>
    );
}

/**
 * Netflix-style rotating hero — replaces the single-item Hero for the
 * catalog's home view. Reuses useTmdbMatch (already built for the previous
 * single-item Hero) per slide, capped at a handful of items so it never
 * fans out into more than a few TMDB lookups.
 */
export function HeroSlider({ type, isDarkMode, items, token, onPlay, onInfo }: HeroSliderProps) {
    const slides = items.slice(0, 5);
    const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, duration: 40 });
    const [selectedIndex, setSelectedIndex] = useState(0);
    const timerRef = useRef<ReturnType<typeof setTimeout>>();

    const onSelect = useCallback(() => {
        if (!emblaApi) return;
        setSelectedIndex(emblaApi.selectedScrollSnap());
    }, [emblaApi]);

    useEffect(() => {
        if (!emblaApi) return;
        emblaApi.on('select', onSelect);
        onSelect();
        return () => {
            emblaApi.off('select', onSelect);
        };
    }, [emblaApi, onSelect]);

    useEffect(() => {
        if (!emblaApi || slides.length <= 1) return;
        timerRef.current = setTimeout(() => emblaApi.scrollNext(), AUTO_ADVANCE_MS);
        return () => clearTimeout(timerRef.current);
    }, [emblaApi, selectedIndex, slides.length]);

    if (slides.length === 0) {
        return <div className="h-[40vh]" />;
    }

    return (
        <div className={`relative pt-4 px-2 sm:px-4 ${isDarkMode ? '' : ''}`}>
            <div className="overflow-hidden rounded-2xl sm:rounded-3xl" ref={emblaRef}>
                <div className="flex">
                    {slides.map((item, index) => (
                        <Slide
                            key={`${item.source ?? 'xt'}-${item.id}`}
                            type={type}
                            item={item}
                            isActive={index === selectedIndex}
                            token={token}
                            onPlay={() => onPlay(item)}
                            onInfo={() => onInfo(item)}
                        />
                    ))}
                </div>
            </div>

            {slides.length > 1 && (
                <div className="flex items-center justify-center gap-2 mt-4">
                    {slides.map((_, index) => (
                        <button
                            key={index}
                            onClick={() => emblaApi?.scrollTo(index)}
                            aria-label={`Diapositive ${index + 1}`}
                            className={`h-1.5 rounded-full transition-all ${index === selectedIndex ? 'w-8 bg-white' : 'w-1.5 bg-white/30'}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
