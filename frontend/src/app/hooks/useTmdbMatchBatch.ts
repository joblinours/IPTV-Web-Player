import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTmdbMatchBatch, type ContentItem, type TmdbMatch } from '../lib/api';

// Only the `enabled: true` shape is ever stored — entries are filtered on
// `.enabled` before being added (see applyResults below) — so the map's
// value type reflects that instead of the full match/no-match union.
type EnabledTmdbMatch = Extract<TmdbMatch, { enabled: true }>;

const BATCH_CHUNK_SIZE = 50; // matches POST /api/tmdb/match-batch's max(50) validation

function matchKey(title: string, type: 'movie' | 'series', year?: string | null): string {
    return `${type}|${title.trim().toLowerCase()}|${year ?? ''}`;
}

function chunk<T>(list: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
    return out;
}

/**
 * Batch counterpart of useTmdbMatch — enriches every item in a row/grid
 * (not just the Hero) with TMDB's poster/overview/rating as a fallback for
 * Xtream's often-thin metadata, without firing one lookup per card. Calls
 * the batch endpoint (chunked at 50 — its request-body cap — since a
 * paginated grid can grow well past that via "load more") once per distinct
 * set of titles, and retries once after a short delay for whichever entries
 * the backend reports as still resolving in the background.
 */
export function useTmdbMatchBatch(
    token: string | null | undefined,
    items: ContentItem[],
    type: 'movie' | 'series'
) {
    const [matches, setMatches] = useState<Map<string, EnabledTmdbMatch>>(new Map());
    const retryTimerRef = useRef<number | null>(null);

    // Stable key so the effect only re-runs when the actual set of titles
    // changes, not on every parent re-render with a new items array
    // reference (the same list, reloaded, shouldn't refire this).
    const requestItems = useMemo(() => {
        const seen = new Set<string>();
        const out: Array<{ title: string; type: 'movie' | 'series'; year?: string }> = [];
        for (const item of items) {
            if (!item.title) continue;
            const key = matchKey(item.title, type, item.year);
            if (seen.has(key)) continue;
            seen.add(key);
            out.push({ title: item.title, type, year: item.year ?? undefined });
        }
        return out;
    }, [items, type]);
    const requestKey = requestItems.map((item) => matchKey(item.title, item.type, item.year)).join('|');

    useEffect(() => {
        if (retryTimerRef.current !== null) {
            window.clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }

        if (!token || requestItems.length === 0) {
            setMatches(new Map());
            return;
        }

        let cancelled = false;

        const applyResults = (results: Array<Awaited<ReturnType<typeof fetchTmdbMatchBatch>>>) => {
            if (cancelled) return;
            const next = new Map<string, EnabledTmdbMatch>();
            const stillPending: typeof requestItems = [];
            for (const result of results) {
                for (const entry of result.items) {
                    if (entry.match.enabled) {
                        next.set(matchKey(entry.title, entry.type, entry.year), entry.match);
                    }
                    if (entry.pending) {
                        stillPending.push({ title: entry.title, type: entry.type, year: entry.year ?? undefined });
                    }
                }
            }
            setMatches((prev) => new Map([...prev, ...next]));

            if (stillPending.length > 0) {
                retryTimerRef.current = window.setTimeout(() => {
                    if (cancelled || !token) return;
                    Promise.all(chunk(stillPending, BATCH_CHUNK_SIZE).map((group) => fetchTmdbMatchBatch(token, group)))
                        .then(applyResults)
                        .catch(() => {});
                }, 4000);
            }
        };

        Promise.all(chunk(requestItems, BATCH_CHUNK_SIZE).map((group) => fetchTmdbMatchBatch(token, group)))
            .then(applyResults)
            .catch(() => {
                if (!cancelled) setMatches(new Map());
            });

        return () => {
            cancelled = true;
            if (retryTimerRef.current !== null) {
                window.clearTimeout(retryTimerRef.current);
                retryTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps -- requestKey is the real dependency, requestItems is derived from it
    }, [token, requestKey]);

    return useMemo(
        () => ({
            getMatch: (title: string, year?: string | null) => matches.get(matchKey(title, type, year)) ?? null,
        }),
        [matches, type]
    );
}
