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

    const progressThrottleRef = useRef<number>(0);
    const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);

    // Countdown timer
    useEffect(() => {
        if (autoplayCountdown === null) return;
        if (autoplayCountdown === 0) {
            onNextEpisodeRef.current?.();
            setAutoplayCountdown(null);
            return;
        }
        const timer = window.setTimeout(
            () => setAutoplayCountdown((prev) => (prev !== null ? prev - 1 : null)),
            1000
        );
        return () => window.clearTimeout(timer);
    }, [autoplayCountdown]);

    // Reset countdown when player closes
    useEffect(() => {
        if (!open) setAutoplayCountdown(null);
    }, [open]);

    useEffect(() => {
        if (!open || allSources.length === 0 || !videoRef.current) return;

        const videoElement = videoRef.current;
        let hls: Hls | null = null;
        let sourceIndex = 0;
        let watchdogTimer: number | null = null;
        let switchedByWatchdog = false;
        let didSeek = false;

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
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();

            if (url.endsWith('.m3u8') && Hls.isSupported()) {
                hls = new Hls();
                hls.loadSource(url);
                hls.attachMedia(videoElement);
                hls.on(Hls.Events.ERROR, (_event, data) => {
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
            if (!didSeek) {
                const st = startTimeRef.current;
                if (st && st > 0) {
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
            const dur = videoElement.duration;
            if (ct > 0 && dur > 0 && Number.isFinite(dur)) {
                cb(ct, dur);
            }
        };

        const handleEnded = () => {
            const dur = Number.isFinite(videoElement.duration) ? videoElement.duration : 0;
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
