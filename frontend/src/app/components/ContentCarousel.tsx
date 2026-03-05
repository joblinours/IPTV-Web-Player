import { useRef, useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { ContentCard } from './ContentCard';

interface ContentCarouselProps {
  title: string;
  type: 'live' | 'films' | 'series';
  category: string;
  isDarkMode: boolean;
}

export function ContentCarousel({ title, type, category, isDarkMode }: ContentCarouselProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `${type}-${category}-${title}-${i}`,
    title: `${type === 'live' ? 'Live' : type === 'films' ? 'Film' : 'Série'} ${i + 1}`,
    index: i,
  }));

  const checkScroll = () => {
    const container = scrollContainerRef.current;
    if (container) {
      setCanScrollLeft(container.scrollLeft > 0);
      setCanScrollRight(
        container.scrollLeft < container.scrollWidth - container.clientWidth - 10
      );
    }
  };

  useEffect(() => {
    checkScroll();
    window.addEventListener('resize', checkScroll);
    return () => window.removeEventListener('resize', checkScroll);
  }, []);

  const scroll = (direction: 'left' | 'right') => {
    const container = scrollContainerRef.current;
    if (container) {
      const scrollAmount = container.clientWidth * 0.8;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="group">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">{title}</h2>
        <div className="flex gap-2">
          <motion.button
            onClick={() => scroll('left')}
            disabled={!canScrollLeft}
            className={`p-2 rounded-lg border transition-all ${
              canScrollLeft
                ? isDarkMode 
                  ? 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-900'
                : isDarkMode
                  ? 'bg-white/5 border-white/10 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            whileHover={canScrollLeft ? { scale: 1.1 } : {}}
            whileTap={canScrollLeft ? { scale: 0.9 } : {}}
          >
            <ChevronLeft size={20} />
          </motion.button>
          <motion.button
            onClick={() => scroll('right')}
            disabled={!canScrollRight}
            className={`p-2 rounded-lg border transition-all ${
              canScrollRight
                ? isDarkMode 
                  ? 'bg-white/10 hover:bg-white/20 border-white/20 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 border-gray-300 text-gray-900'
                : isDarkMode
                  ? 'bg-white/5 border-white/10 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed'
            }`}
            whileHover={canScrollRight ? { scale: 1.1 } : {}}
            whileTap={canScrollRight ? { scale: 0.9 } : {}}
          >
            <ChevronRight size={20} />
          </motion.button>
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className="flex gap-4 overflow-x-auto scrollbar-hide pb-4"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item, index) => (
          <motion.div
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05, duration: 0.4 }}
            className="flex-shrink-0"
          >
            <ContentCard title={item.title} type={type} index={item.index} isDarkMode={isDarkMode} />
          </motion.div>
        ))}
      </div>
    </div>
  );
}
