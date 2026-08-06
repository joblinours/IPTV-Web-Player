import { useCallback, useEffect, useState } from 'react';
import {
    addFavorite,
    fetchFavorites,
    removeFavorite,
    type ContentItem,
    type SectionType,
} from '../lib/api';

export type FavoriteIdMap = Record<SectionType, Set<string>>;

export function createDefaultFavoriteMap(): FavoriteIdMap {
    return {
        live: new Set<string>(),
        films: new Set<string>(),
        series: new Set<string>(),
    };
}

/** Favorites for the active IPTV account/section, with optimistic toggle + rollback on failure. */
export function useFavorites(token: string | null, accountId: number | null, activeSection: SectionType) {
    const [favoritesBySection, setFavoritesBySection] = useState<FavoriteIdMap>(() => createDefaultFavoriteMap());

    useEffect(() => {
        if (!token || !accountId) return;

        let cancelled = false;

        const loadFavorites = async () => {
            try {
                const result = await fetchFavorites(token, accountId, activeSection);
                if (cancelled) return;

                setFavoritesBySection((prev) => ({
                    ...prev,
                    [activeSection]: new Set(result.items),
                }));
            } catch {
                if (!cancelled) {
                    setFavoritesBySection((prev) => ({
                        ...prev,
                        [activeSection]: new Set<string>(),
                    }));
                }
            }
        };

        loadFavorites();

        return () => {
            cancelled = true;
        };
    }, [token, accountId, activeSection]);

    const toggleFavorite = useCallback(
        async (item: ContentItem) => {
            if (!token || !accountId || !item.id) return;

            const itemId = item.id;
            const wasFavorite = favoritesBySection[activeSection]?.has(itemId) ?? false;

            setFavoritesBySection((prev) => {
                const nextSet = new Set(prev[activeSection]);
                if (nextSet.has(itemId)) {
                    nextSet.delete(itemId);
                } else {
                    nextSet.add(itemId);
                }

                return {
                    ...prev,
                    [activeSection]: nextSet,
                };
            });

            try {
                if (wasFavorite) {
                    await removeFavorite(token, { accountId, section: activeSection, itemId });
                } else {
                    await addFavorite(token, { accountId, section: activeSection, itemId });
                }
            } catch {
                setFavoritesBySection((prev) => {
                    const rollbackSet = new Set(prev[activeSection]);
                    if (wasFavorite) {
                        rollbackSet.add(itemId);
                    } else {
                        rollbackSet.delete(itemId);
                    }

                    return {
                        ...prev,
                        [activeSection]: rollbackSet,
                    };
                });
            }
        },
        [token, accountId, activeSection, favoritesBySection]
    );

    const resetFavorites = useCallback(() => {
        setFavoritesBySection(createDefaultFavoriteMap());
    }, []);

    return { favoritesBySection, toggleFavorite, resetFavorites };
}
