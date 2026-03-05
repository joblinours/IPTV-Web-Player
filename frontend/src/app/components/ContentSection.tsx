import { ContentCard } from './ContentCard';

interface Category {
  id: string;
  name: string;
}

interface ContentSectionProps {
  title: string;
  categories: Category[];
  selectedCategory: string;
  onCategoryChange: (categoryId: string) => void;
  type: 'live' | 'film' | 'serie';
}

export function ContentSection({
  title,
  categories,
  selectedCategory,
  onCategoryChange,
  type,
}: ContentSectionProps) {
  // Mock content data
  const getContentItems = () => {
    const items = [];
    for (let i = 0; i < 8; i++) {
      items.push({
        id: `${type}-${selectedCategory}-${i}`,
        title: `${title} ${i + 1}`,
        category: selectedCategory,
      });
    }
    return items;
  };

  const contentItems = getContentItems();

  return (
    <div>
      {/* Sous-catégories */}
      <div className="mb-6 flex gap-3 flex-wrap">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => onCategoryChange(category.id)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              selectedCategory === category.id
                ? 'bg-red-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {category.name}
          </button>
        ))}
      </div>

      {/* Grille de contenu */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-6">
        {contentItems.map((item) => (
          <ContentCard key={item.id} title={item.title} type={type} />
        ))}
      </div>
    </div>
  );
}
