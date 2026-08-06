import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'iptv_reduced_motion';

const WEAK_DEVICE_UA_PATTERNS = [
    'tizen',
    'webos',
    'roku',
    'firetv',
    'fire tv',
    'aftb',
    'aft',
    'appletv',
    'apple tv',
    'smart-tv',
    'smarttv',
    'googletv',
    'google tv',
    'android tv',
    'viera',
    'netcast',
    'hbbtv',
    'crkey',
];

/** Best-effort sniff for TVs / set-top boxes, which tend to have weak GPUs/CPUs. */
function detectWeakDevice(): boolean {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent.toLowerCase();
    return WEAK_DEVICE_UA_PATTERNS.some((pattern) => ua.includes(pattern));
}

function readStoredPreference(): boolean | null {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
}

/**
 * Local-only "reduce animations" preference. Defaults to on when the
 * device looks like a TV/set-top box (weak GPU), but the user can always
 * override it — the override is what gets persisted.
 */
export function usePerformanceMode() {
    const [isWeakDevice] = useState<boolean>(() => detectWeakDevice());
    const [reducedMotion, setReducedMotionState] = useState<boolean>(() => {
        const stored = readStoredPreference();
        return stored ?? isWeakDevice;
    });

    useEffect(() => {
        if (typeof document === 'undefined') return;
        document.documentElement.dataset.reducedMotion = reducedMotion ? 'true' : 'false';
    }, [reducedMotion]);

    const setReducedMotion = useCallback((value: boolean) => {
        setReducedMotionState(value);
        if (typeof window !== 'undefined') {
            window.localStorage.setItem(STORAGE_KEY, String(value));
        }
    }, []);

    return { reducedMotion, setReducedMotion, isWeakDevice };
}
