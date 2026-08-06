import { useCallback, useEffect, useState } from 'react';
import { fetchPreferences, updatePreferences as requestUpdatePreferences, type UserPreferences } from '../lib/api';

const DEFAULT_PREFERENCES: UserPreferences = { autoplay: true, language: 'fr' };

/** User preferences (autoplay/language), synced with the backend with optimistic updates + rollback. */
export function usePreferences(token: string | null) {
    const [preferences, setPreferences] = useState<UserPreferences>(DEFAULT_PREFERENCES);

    useEffect(() => {
        if (!token) return;
        fetchPreferences(token)
            .then((prefs) => setPreferences(prefs))
            .catch(() => {});
    }, [token]);

    const updatePreferences = useCallback(
        (prefs: Partial<UserPreferences>) => {
            if (!token) return;
            const previous = preferences;
            setPreferences((prev) => ({ ...prev, ...prefs }));
            requestUpdatePreferences(token, prefs).catch(() => {
                // rollback on error
                setPreferences(previous);
            });
        },
        [token, preferences]
    );

    const resetPreferences = useCallback(() => {
        setPreferences(DEFAULT_PREFERENCES);
    }, []);

    return { preferences, updatePreferences, resetPreferences };
}
