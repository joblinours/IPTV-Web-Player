import { motion } from 'motion/react';
import { useRef, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface Category {
  id: string;
  name: string;
}

interface CategoryTabsProps {
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (categoryId: string) => void;
  isDarkMode: boolean;
}

export function CategoryTabs({ categories, selectedCategory, onCategoryChange, isDarkMode }: CategoryTabsProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

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
      const scrollAmount = 300;
      container.scrollBy({
        left: direction === 'left' ? -scrollAmount : scrollAmount,
        behavior: 'smooth',
      });
    }
  };

  return (
    <div className="relative group">
      {/* Left Arrow */}
      {canScrollLeft && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => scroll('left')}
          className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 backdrop-blur-xl rounded-full border opacity-0 group-hover:opacity-100 transition-opacity ${
            isDarkMode ? 'bg-black/80 border-white/20' : 'bg-white/80 border-gray-300'
          }`}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronLeft size={20} />
        </motion.button>
      )}

      {/* Categories */}
      <div
        ref={scrollContainerRef}
        onScroll={checkScroll}
        className="flex gap-3 overflow-x-auto scrollbar-hide py-2 px-12"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {categories.map((category) => (
          <motion.button
            key={category.id}
            onClick={() => onCategoryChange(category.id)}
            className={`relative px-6 py-2.5 rounded-full whitespace-nowrap transition-all duration-300 ${
              selectedCategory === category.id
                ? isDarkMode ? 'text-white' : 'text-white'
                : isDarkMode ? 'text-gray-400 hover:text-white' : 'text-gray-600 hover:text-gray-900'
            }`}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            {selectedCategory === category.id && (
              <motion.div
                layoutId="categoryBubble"
                className="absolute inset-0 bg-gradient-to-r from-red-600 to-orange-600 rounded-full"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
              />
            )}
            <span className="relative z-10 font-medium">{category.name}</span>
          </motion.button>
        ))}
      </div>

      {/* Right Arrow */}
      {canScrollRight && (
        <motion.button
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => scroll('right')}
          className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 backdrop-blur-xl rounded-full border opacity-0 group-hover:opacity-100 transition-opacity ${
            isDarkMode ? 'bg-black/80 border-white/20' : 'bg-white/80 border-gray-300'
          }`}
          whileHover={{ scale: 1.1 }}
          whileTap={{ scale: 0.9 }}
        >
          <ChevronRight size={20} />
        </motion.button>
      )}
    </div>
  );
}
