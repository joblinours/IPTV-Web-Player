import { useEffect, useState } from 'react';
import { fetchTmdbMatch, type TmdbMatch } from '../lib/api';

/**
 * Best-effort TMDB enrichment for a single title (backdrop/overview/rating).
 * Resolves to `null` whenever the backend has no TMDB_API_KEY, nothing
 * matches, or the lookup fails — callers keep using their existing Xtream
 * metadata as the fallback either way. Intentionally used sparingly (e.g.
 * the single featured Hero item) rather than per grid card, to avoid
 * firing dozens of TMDB lookups per page.
 */
export function useTmdbMatch(
    token: string | null | undefined,
    title: string | undefined,
    type: 'movie' | 'series' | null,
    year?: string
) {
    const [match, setMatch] = useState<TmdbMatch | null>(null);

    useEffect(() => {
        setMatch(null);
        if (!token || !title || !type) return;

        let cancelled = false;
        fetchTmdbMatch(token, { title, type, year })
            .then((result) => {
                if (!cancelled) setMatch(result);
            })
            .catch(() => {
                if (!cancelled) setMatch(null);
            });

        return () => {
            cancelled = true;
        };
    }, [token, title, type, year]);

    return match?.enabled ? match : null;
}
