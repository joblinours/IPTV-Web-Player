import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { X, SkipForward } from 'lucide-react';

const AUTOPLAY_COUNTDOWN_START = 5;

interface VideoPlayerModalProps {
    open: boolean;
    title: string;
    streamUrl: string | null;
    streamSources?: string[];
    onClose: () => void;
    /** Seek to this position (seconds) when the video is ready */
    startTime?: number;
    /** Called every ~5s with (currentTime, duration) while playing */
    onProgress?: (currentTime: number, duration: number) => void;
    /** Called when the video ends, receives (currentTime, duration) */
    onEnded?: (currentTime: number, duration: number) => void;
    /** Enable the autoplay countdown overlay at end of episode */
    autoplay?: boolean;
    /** Title shown in the autoplay countdown overlay */
    nextEpisodeTitle?: string;
    /** Called when the autoplay countdown reaches zero */
    onNextEpisode?: () => void;
    /** Real total duration (seconds) of the media, used when transcoding hides the true length */
    realDuration?: number;
    /** Called once when the player switches to the ffmpeg transcode fallback source */
    onTranscodeFallback?: () => void;
}

export function VideoPlayerModal({
    open,
    title,
    streamUrl,
    streamSources = [],
    onClose,
    startTime,
    onProgress,
    onEnded,
    autoplay = false,
    nextEpisodeTitle,
    onNextEpisode,
    realDuration,
    onTranscodeFallback,
}: VideoPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const allSources = streamSources.length > 0 ? streamSources : streamUrl ? [streamUrl] : [];

    // Use refs for callbacks/values that should not restart the video effect
    const startTimeRef = useRef(startTime);
    startTimeRef.current = startTime;
    const onProgressRef = useRef(onProgress);
    onProgressRef.current = onProgress;
    const onEndedRef = useRef(onEnded);
    onEndedRef.current = onEnded;
    const autoplayRef = useRef(autoplay);
    autoplayRef.current = autoplay;
    const nextEpisodeTitleRef = useRef(nextEpisodeTitle);
    nextEpisodeTitleRef.current = nextEpisodeTitle;
    const onNextEpisodeRef = useRef(onNextEpisode);
    onNextEpisodeRef.current = onNextEpisode;
    const realDurationRef = useRef(realDuration);
    realDurationRef.current = realDuration;
    const onTranscodeFallbackRef = useRef(onTranscodeFallback);
    onTranscodeFallbackRef.current = onTranscodeFallback;
    const activeSourceUrlRef = useRef<string | null>(null);

    const progressThrottleRef = useRef<number>(0);
    // Tracks whether the active source is the ffmpeg transcode fallback
    const isTranscodeModeRef = useRef(false);
    const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);

    const syncNativeDurationDisplay = (videoElement: HTMLVideoElement) => {
        try {
            delete (videoElement as HTMLVideoElement & { duration?: number }).duration;
        } catch {
            // noop
        }

        if (!isTranscodeModeRef.current || !realDurationRef.current || realDurationRef.current <= 0) {
            return;
        }

        try {
            Object.defineProperty(videoElement, 'duration', {
                configurable: true,
                get: () => realDurationRef.current ?? 0,
            });
            videoElement.dispatchEvent(new Event('durationchange'));
        } catch {
            // Some browsers do not allow overriding the instance getter.
        }
    };

    // Countdown timer
    useEffect(() => {
        if (autoplayCountdown === null) return;
        if (autoplayCountdown === 0) {
            onNextEpisodeRef.current?.();
            setAutoplayCountdown(null);
            return;
        }
        const timer = window.setTimeout(
            () => setAutoplayCountdown((prev: number | null) => (prev !== null ? prev - 1 : null)),
            1000
        );
        return () => window.clearTimeout(timer);
    }, [autoplayCountdown]);

    // Reset countdown when player closes
    useEffect(() => {
        if (!open) {
            setAutoplayCountdown(null);
        }
    }, [open]);

    useEffect(() => {
        if (!open || allSources.length === 0 || !videoRef.current) return;

        const videoElement = videoRef.current;
        let hls: Hls | null = null;
        let sourceIndex = 0;
        let watchdogTimer: number | null = null;
        let switchedByWatchdog = false;
        let didSeek = false;

        // Reset transcode mode for this new playback session
        isTranscodeModeRef.current = false;
        activeSourceUrlRef.current = null;

        const clearWatchdog = () => {
            if (watchdogTimer !== null) {
                window.clearInterval(watchdogTimer);
                watchdogTimer = null;
            }
        };

        const tryNextSource = () => {
            clearWatchdog();
            sourceIndex += 1;
            if (sourceIndex < allSources.length) {
                loadSource(allSources[sourceIndex]);
            }
        };

        const startWatchdog = (url: string) => {
            clearWatchdog();
            switchedByWatchdog = false;

            if (url.includes('/api/iptv/transcode')) {
                return;
            }

            let stableChecks = 0;
            let lastVideoDecoded = -1;
            let lastAudioDecoded = -1;

            watchdogTimer = window.setInterval(() => {
                if (switchedByWatchdog) return;
                if (sourceIndex >= allSources.length - 1) return;
                if (videoElement.paused || videoElement.ended) return;
                if (videoElement.currentTime < 6) return;

                const videoDecoded = Number((videoElement as any).webkitDecodedFrameCount ?? -1);
                const audioDecoded = Number((videoElement as any).webkitAudioDecodedByteCount ?? -1);

                const noPicture = videoElement.videoWidth === 0 || videoDecoded === 0;
                const noAudio = !videoElement.muted && audioDecoded === 0;

                if (noPicture || noAudio) {
                    switchedByWatchdog = true;
                    tryNextSource();
                    return;
                }

                if (videoDecoded >= 0 && audioDecoded >= 0) {
                    const stalled = videoDecoded === lastVideoDecoded && audioDecoded === lastAudioDecoded;
                    stableChecks = stalled ? stableChecks + 1 : 0;
                    lastVideoDecoded = videoDecoded;
                    lastAudioDecoded = audioDecoded;

                    if (stableChecks >= 3) {
                        switchedByWatchdog = true;
                        tryNextSource();
                    }
                }
            }, 2000);
        };

        const loadSource = (url: string) => {
            if (hls) {
                hls.destroy();
                hls = null;
            }

            clearWatchdog();
            didSeek = false;
            activeSourceUrlRef.current = url;
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();

            // Detect switch to ffmpeg transcode fallback
            if (url.includes('/api/iptv/transcode') && !isTranscodeModeRef.current) {
                isTranscodeModeRef.current = true;
                onTranscodeFallbackRef.current?.();
            }

            syncNativeDurationDisplay(videoElement);

            if (url.endsWith('.m3u8') && Hls.isSupported()) {
                hls = new Hls();
                hls.loadSource(url);
                hls.attachMedia(videoElement);
                hls.on(Hls.Events.ERROR, (_event: string, data: { fatal: boolean }) => {
                    if (data.fatal) {
                        tryNextSource();
                    }
                });
            } else {
                videoElement.src = url;
            }

            videoElement.play().catch(() => undefined);
            startWatchdog(url);
        };

        const handleError = () => {
            tryNextSource();
        };

        const handleCanPlay = () => {
            syncNativeDurationDisplay(videoElement);

            if (!didSeek) {
                const st = startTimeRef.current;
                const activeUrl = activeSourceUrlRef.current;
                const hasBackendSeek =
                    !!activeUrl && activeUrl.includes('/api/iptv/transcode') && activeUrl.includes('seekSeconds=');

                if (st && st > 0 && !hasBackendSeek) {
                    didSeek = true;
                    videoElement.currentTime = st;
                }
            }
        };

        const handleTimeUpdate = () => {
            const cb = onProgressRef.current;
            if (!cb) return;
            const now = Date.now();
            if (now - progressThrottleRef.current < 5000) return;
            progressThrottleRef.current = now;
            const ct = videoElement.currentTime;
            if (ct <= 0) return;
            // When transcoding, videoElement.duration only reflects the transcoded portion.
            // Use realDuration if provided, otherwise pass 0 so the backend never
            // auto-marks the item as watched based on an unreliable duration.
            const isTranscode = isTranscodeModeRef.current;
            const dur = isTranscode
                ? (realDurationRef.current ?? 0)
                : videoElement.duration;
            if (Number.isFinite(ct)) {
                cb(ct, Number.isFinite(dur) ? dur : 0);
            }
        };

        const handleEnded = () => {
            const isTranscode = isTranscodeModeRef.current;
            const realDur = realDurationRef.current;
            const nativeDur = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
            const dur = isTranscode && realDur && realDur > 0 ? realDur : nativeDur;
            const ct = dur > 0 ? dur : videoElement.currentTime;
            onEndedRef.current?.(ct, dur);

            if (autoplayRef.current && nextEpisodeTitleRef.current && onNextEpisodeRef.current) {
                setAutoplayCountdown(AUTOPLAY_COUNTDOWN_START);
            }
        };

        videoElement.addEventListener('error', handleError);
        videoElement.addEventListener('canplay', handleCanPlay);
        videoElement.addEventListener('timeupdate', handleTimeUpdate);
        videoElement.addEventListener('ended', handleEnded);
        loadSource(allSources[sourceIndex]);

        return () => {
            clearWatchdog();
            videoElement.removeEventListener('error', handleError);
            videoElement.removeEventListener('canplay', handleCanPlay);
            videoElement.removeEventListener('timeupdate', handleTimeUpdate);
            videoElement.removeEventListener('ended', handleEnded);
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();
            try {
                delete (videoElement as HTMLVideoElement & { duration?: number }).duration;
            } catch {
                // noop
            }
            if (hls) {
                hls.destroy();
            }
        };
    }, [open, streamUrl, allSources]);

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-5xl bg-black border border-white/10 rounded-2xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <h3 className="text-white font-semibold truncate">{title}</h3>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-white">
                        <X size={18} />
                    </button>
                </div>
                <div className="aspect-video bg-black relative">
                    <video ref={videoRef} controls className="w-full h-full" playsInline />

                    {/* Autoplay countdown overlay */}
                    {autoplayCountdown !== null && (
                        <div className="absolute inset-0 flex items-end justify-end p-5 pointer-events-none">
                            <div className="pointer-events-auto bg-black/85 backdrop-blur-sm border border-white/20 rounded-xl p-4 flex flex-col gap-3 min-w-[240px] max-w-xs">
                                <div className="flex items-center gap-2 text-white">
                                    <SkipForward size={15} className="text-orange-400 shrink-0" />
                                    <span className="text-sm font-semibold">
                                        Épisode suivant dans {autoplayCountdown}s
                                    </span>
                                </div>
                                {nextEpisodeTitle && (
                                    <p className="text-xs text-gray-300 truncate">{nextEpisodeTitle}</p>
                                )}
                                <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-red-600 to-orange-600 transition-all duration-1000"
                                        style={{
                                            width: `${((AUTOPLAY_COUNTDOWN_START - autoplayCountdown) / AUTOPLAY_COUNTDOWN_START) * 100}%`,
                                        }}
                                    />
                                </div>
                                <button
                                    onClick={() => setAutoplayCountdown(null)}
                                    className="text-xs text-gray-400 hover:text-white transition-colors text-center"
                                >
                                    Annuler
                                </button>
                            </div>
                        </div>
                    )}
                </div>
                <div className="px-4 py-3 border-t border-white/10 text-xs text-gray-400">
                    Certains flux (ex: MKV avec codecs non supportés navigateur) peuvent être muets/non lisibles. Le lecteur tente automatiquement plusieurs formats.
                </div>
            </div>
        </div>
    );
}
