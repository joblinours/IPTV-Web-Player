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

// `${sourceId}:${itemId}` — matches backend/src/utils.ts's favoriteKey().
// Every favorite is now looked up under this composite key (even in
// single-source/live mode) so a card component never needs to know whether
// it's rendering inside a merged view or not.
function favoriteKey(sourceId: number, itemId: string): string {
    return `${sourceId}:${itemId}`;
}

/**
 * Favorites for the active section, merged across every media_sources row
 * the user owns for films/series (so a Jellyfin item's favorite state
 * shows up in the same unified grid as Xtream's), single-source for live
 * (Jellyfin has no Live TV). Optimistic toggle + rollback on failure.
 */
export function useFavorites(token: string | null, accountId: number | null, activeSection: SectionType) {
    const [favoritesBySection, setFavoritesBySection] = useState<FavoriteIdMap>(() => createDefaultFavoriteMap());
    const merged = activeSection !== 'live';

    useEffect(() => {
        if (!token) return;
        if (!merged && !accountId) return;

        let cancelled = false;

        const loadFavorites = async () => {
            try {
                const result = await fetchFavorites(token, accountId, activeSection, { merged });
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
    }, [token, accountId, activeSection, merged]);

    const toggleFavorite = useCallback(
        async (item: ContentItem) => {
            if (!token || !item.id) return;
            const sourceId = item.sourceId ?? accountId;
            if (!sourceId) return;

            const key = favoriteKey(sourceId, item.id);
            const wasFavorite = favoritesBySection[activeSection]?.has(key) ?? false;

            setFavoritesBySection((prev) => {
                const nextSet = new Set(prev[activeSection]);
                if (nextSet.has(key)) {
                    nextSet.delete(key);
                } else {
                    nextSet.add(key);
                }

                return {
                    ...prev,
                    [activeSection]: nextSet,
                };
            });

            try {
                if (wasFavorite) {
                    await removeFavorite(token, { accountId: sourceId, section: activeSection, itemId: item.id });
                } else {
                    await addFavorite(token, { accountId: sourceId, section: activeSection, itemId: item.id });
                }
            } catch {
                setFavoritesBySection((prev) => {
                    const rollbackSet = new Set(prev[activeSection]);
                    if (wasFavorite) {
                        rollbackSet.add(key);
                    } else {
                        rollbackSet.delete(key);
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
