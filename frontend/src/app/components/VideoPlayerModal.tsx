import React, { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, SkipForward, Volume2, VolumeX, X } from 'lucide-react';

const AUTOPLAY_COUNTDOWN_START = 5;

function fmtTime(sec: number): string {
    if (!Number.isFinite(sec) || sec < 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

function isHlsSource(url: string): boolean {
    if (/\.m3u8(?:$|[?#])/i.test(url)) return true;

    try {
        const parsed = new URL(url, window.location.origin);
        const ext = (parsed.searchParams.get('containerExtension') ?? parsed.searchParams.get('ext') ?? '').toLowerCase();
        return ext === 'm3u8';
    } catch {
        return false;
    }
}

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
    /** Called when user requests previous episode navigation */
    onPreviousEpisode?: () => void;
    /** Real total duration (seconds) of the media, used when transcoding hides the true length */
    realDuration?: number;
    /** Called once when the player switches to the ffmpeg transcode fallback source */
    onTranscodeFallback?: () => void;
    /** Enable/disable keyboard shortcuts for this player instance */
    keyboardEnabled?: boolean;
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
    onPreviousEpisode,
    realDuration,
    onTranscodeFallback,
    keyboardEnabled = true,
}: VideoPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const allSources = streamSources.length > 0 ? streamSources : streamUrl ? [streamUrl] : [];

    // Stable refs for callbacks — changing these never re-triggers the main video effect
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
    const onPreviousEpisodeRef = useRef(onPreviousEpisode);
    onPreviousEpisodeRef.current = onPreviousEpisode;
    const realDurationRef = useRef(realDuration);
    realDurationRef.current = realDuration;
    const onTranscodeFallbackRef = useRef(onTranscodeFallback);
    onTranscodeFallbackRef.current = onTranscodeFallback;

    const activeSourceUrlRef = useRef<string | null>(null);
    // Seconds already consumed by a backend -ss seek (ffmpeg seekSeconds param).
    // videoElement.currentTime is relative to this offset.
    const seekOffsetRef = useRef(0);
    const progressThrottleRef = useRef<number>(0);
    const isTranscodeModeRef = useRef(false);
    const controlsTimeoutRef = useRef<number | null>(null);

    // ── Custom player UI state ───────────────────────────────────────────────
    const [isPlaying, setIsPlaying] = useState(false);
    // currentTimeSec = videoElement.currentTime + seekOffset  (true position in the media)
    const [currentTimeSec, setCurrentTimeSec] = useState(0);
    const [effectiveDuration, setEffectiveDuration] = useState(0);
    const effectiveDurationRef = useRef(0);
    const [bufferedEnd, setBufferedEnd] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [autoplayCountdown, setAutoplayCountdown] = useState<number | null>(null);
    // isDragging: pointer is held on the seek bar
    const [isDragging, setIsDragging] = useState(false);
    const seekBarRef = useRef<HTMLDivElement>(null);

    // ── Controls auto-hide ───────────────────────────────────────────────────
    const resetControlsTimeout = useCallback(() => {
        setShowControls(true);
        if (controlsTimeoutRef.current) window.clearTimeout(controlsTimeoutRef.current);
        controlsTimeoutRef.current = window.setTimeout(() => setShowControls(false), 3000);
    }, []);

    // ── Autoplay countdown ───────────────────────────────────────────────────
    useEffect(() => {
        if (autoplayCountdown === null) return;
        if (autoplayCountdown === 0) {
            onNextEpisodeRef.current?.();
            setAutoplayCountdown(null);
            return;
        }
        const t = window.setTimeout(
            () => setAutoplayCountdown((p: number | null) => (p !== null ? p - 1 : null)),
            1000
        );
        return () => window.clearTimeout(t);
    }, [autoplayCountdown]);

    // ── Reset when modal closes ──────────────────────────────────────────────
    useEffect(() => {
        effectiveDurationRef.current = effectiveDuration;
    }, [effectiveDuration]);

    useEffect(() => {
        if (!open) {
            setAutoplayCountdown(null);
            setIsPlaying(false);
            setCurrentTimeSec(0);
            setEffectiveDuration(0);
            effectiveDurationRef.current = 0;
            setBufferedEnd(0);
            setShowControls(true);
        }
    }, [open]);

    // ── Fullscreen listener ──────────────────────────────────────────────────
    useEffect(() => {
        const onFsChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    // ── Keyboard shortcuts ───────────────────────────────────────────────────
    useEffect(() => {
        if (!open || !keyboardEnabled) return;
        const onKey = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            const v = videoRef.current;
            if (!v) return;
            if (e.code === 'Space') {
                e.preventDefault();
                v.paused ? v.play().catch(() => undefined) : v.pause();
                resetControlsTimeout();
            } else if (e.code === 'ArrowLeft') {
                e.preventDefault();
                v.currentTime = Math.max(0, v.currentTime - 10);
                resetControlsTimeout();
            } else if (e.code === 'ArrowRight') {
                e.preventDefault();
                v.currentTime = v.currentTime + 10;
                resetControlsTimeout();
            } else if (e.code === 'ArrowUp' && onNextEpisodeRef.current) {
                e.preventDefault();
                onNextEpisodeRef.current();
                resetControlsTimeout();
            } else if (e.code === 'ArrowDown' && onPreviousEpisodeRef.current) {
                e.preventDefault();
                onPreviousEpisodeRef.current();
                resetControlsTimeout();
            } else if (e.code === 'KeyF') {
                e.preventDefault();
                document.fullscreenElement
                    ? document.exitFullscreen()
                    : containerRef.current?.requestFullscreen();
            } else if (e.code === 'KeyM') {
                e.preventDefault();
                v.muted = !v.muted;
                setIsMuted(v.muted);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, keyboardEnabled, resetControlsTimeout]);

    // ── Main video management effect ─────────────────────────────────────────
    useEffect(() => {
        if (!open || allSources.length === 0 || !videoRef.current) return;

        const videoElement = videoRef.current;
        let hls: Hls | null = null;
        let hlsRecoverAttempted = false;
        let sourceIndex = 0;
        let watchdogTimer: number | null = null;
        let switchedByWatchdog = false;
        let didSeek = false;

        isTranscodeModeRef.current = false;
        activeSourceUrlRef.current = null;
        seekOffsetRef.current = 0;
        setCurrentTimeSec(0);
        setEffectiveDuration(0);
        effectiveDurationRef.current = 0;
        setBufferedEnd(0);

        const resolveDuration = (): number => {
            const nativeDuration =
                Number.isFinite(videoElement.duration) && videoElement.duration > 0
                    ? videoElement.duration
                    : 0;
            const realDurationValue = realDurationRef.current && realDurationRef.current > 0
                ? realDurationRef.current
                : 0;

            if (isTranscodeModeRef.current) {
                if (realDurationValue > 0) return realDurationValue;
                if (effectiveDurationRef.current > 0) return effectiveDurationRef.current;
                return nativeDuration;
            }

            if (nativeDuration > 0) return nativeDuration;
            return effectiveDurationRef.current > 0 ? effectiveDurationRef.current : 0;
        };

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
            if (url.includes('/api/iptv/transcode')) return;

            let stableChecks = 0;
            let lastVideoDecoded = -1;
            let lastAudioDecoded = -1;
            const startedAt = Date.now();

            watchdogTimer = window.setInterval(() => {
                if (switchedByWatchdog) return;
                if (sourceIndex >= allSources.length - 1) return;
                if (videoElement.paused || videoElement.ended) return;

                const elapsed = Date.now() - startedAt;
                const notStartedYet = videoElement.currentTime < 0.2 || videoElement.readyState < 2;
                if (elapsed > 10000 && notStartedYet) {
                    switchedByWatchdog = true;
                    tryNextSource();
                    return;
                }

                if (videoElement.currentTime < 6) return;

                const videoDecoded = Number((videoElement as any).webkitDecodedFrameCount ?? -1);
                const audioDecoded = Number((videoElement as any).webkitAudioDecodedByteCount ?? -1);
                const noPicture = videoDecoded === 0 && audioDecoded === 0;
                const noAudio = !videoElement.muted && audioDecoded === 0;

                if (noPicture || noAudio) {
                    switchedByWatchdog = true;
                    tryNextSource();
                    return;
                }

                if (videoDecoded >= 0 && audioDecoded >= 0) {
                    const stalled =
                        videoDecoded === lastVideoDecoded && audioDecoded === lastAudioDecoded;
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
            if (hls) { hls.destroy(); hls = null; }
            clearWatchdog();
            didSeek = false;
            activeSourceUrlRef.current = url;
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();

            // Extract the seek offset already applied server-side
            const seekMatch = url.match(/[?&]seekSeconds=(\d+(?:\.\d+)?)/);
            const newOffset = seekMatch ? parseFloat(seekMatch[1]) : 0;
            seekOffsetRef.current = newOffset;
            if (newOffset > 0) setCurrentTimeSec(newOffset);

            if (url.includes('/api/iptv/transcode') && !isTranscodeModeRef.current) {
                isTranscodeModeRef.current = true;
                onTranscodeFallbackRef.current?.();
                // Update effective duration now that we know it's transcode
                const rd = realDurationRef.current;
                if (rd && rd > 0) {
                    effectiveDurationRef.current = rd;
                    setEffectiveDuration(rd);
                }
            }

            if (isHlsSource(url) && Hls.isSupported()) {
                hlsRecoverAttempted = false;
                hls = new Hls({
                    enableWorker: true,
                    lowLatencyMode: true,
                    backBufferLength: 30,
                });
                hls.loadSource(url);
                hls.attachMedia(videoElement);
                hls.on(Hls.Events.ERROR, (_: string, data: { fatal: boolean; type?: string }) => {
                    if (!data.fatal) return;

                    if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !hlsRecoverAttempted) {
                        hlsRecoverAttempted = true;
                        hls?.recoverMediaError();
                        return;
                    }

                    tryNextSource();
                });
            } else {
                videoElement.src = url;
            }

            videoElement.play().catch(() => undefined);
            startWatchdog(url);
        };

        const refreshDuration = () => {
            const dur = resolveDuration();
            if (dur > 0 && Math.abs(dur - effectiveDurationRef.current) > 0.01) {
                effectiveDurationRef.current = dur;
                setEffectiveDuration(dur);
            }
        };

        const handleError = () => tryNextSource();

        const handleCanPlay = () => {
            refreshDuration();
            if (didSeek) return;

            const expectedStart = startTimeRef.current;
            if (expectedStart && expectedStart > 0) {
                const effectiveCt = videoElement.currentTime + seekOffsetRef.current;
                // Correct drift when backend seek and real playback position differ noticeably.
                if (Math.abs(effectiveCt - expectedStart) > 2) {
                    const localTarget = Math.max(0, expectedStart - seekOffsetRef.current);
                    videoElement.currentTime = localTarget;
                }
            }

            didSeek = true;
        };

        const handleDurationChange = () => refreshDuration();

        const handleTimeUpdate = () => {
            const effectiveCt = videoElement.currentTime + seekOffsetRef.current;
            setCurrentTimeSec(effectiveCt);

            if (videoElement.buffered.length > 0) {
                setBufferedEnd(
                    videoElement.buffered.end(videoElement.buffered.length - 1) +
                        seekOffsetRef.current
                );
            }

            const cb = onProgressRef.current;
            if (!cb) return;
            const now = Date.now();
            if (now - progressThrottleRef.current < 5000) return;
            progressThrottleRef.current = now;
            if (effectiveCt <= 0) return;
            const dur = resolveDuration();
            // Never persist invalid duration values, they break resume and progress UI.
            if (!Number.isFinite(dur) || dur <= 0) return;
            cb(effectiveCt, dur);
        };

        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);

        const handleEnded = () => {
            setIsPlaying(false);
            const dur = resolveDuration();
            const ct = dur > 0 ? dur : videoElement.currentTime + seekOffsetRef.current;
            onEndedRef.current?.(ct, dur);
            if (autoplayRef.current && nextEpisodeTitleRef.current && onNextEpisodeRef.current) {
                setAutoplayCountdown(AUTOPLAY_COUNTDOWN_START);
            }
        };

        videoElement.addEventListener('error', handleError);
        videoElement.addEventListener('canplay', handleCanPlay);
        videoElement.addEventListener('timeupdate', handleTimeUpdate);
        videoElement.addEventListener('durationchange', handleDurationChange);
        videoElement.addEventListener('ended', handleEnded);
        videoElement.addEventListener('play', handlePlay);
        videoElement.addEventListener('pause', handlePause);
        loadSource(allSources[sourceIndex]);

        return () => {
            clearWatchdog();
            videoElement.removeEventListener('error', handleError);
            videoElement.removeEventListener('canplay', handleCanPlay);
            videoElement.removeEventListener('timeupdate', handleTimeUpdate);
            videoElement.removeEventListener('durationchange', handleDurationChange);
            videoElement.removeEventListener('ended', handleEnded);
            videoElement.removeEventListener('play', handlePlay);
            videoElement.removeEventListener('pause', handlePause);
            videoElement.pause();
            videoElement.removeAttribute('src');
            videoElement.load();
            if (hls) hls.destroy();
        };
    }, [open, streamUrl, allSources]);

    // ── Seek bar interaction ─────────────────────────────────────────────────
    const seekToRatio = (ratio: number) => {
        const v = videoRef.current;
        if (!v || effectiveDuration <= 0) return;
        const clamped = Math.max(0, Math.min(1, ratio));
        const targetEffectiveTime = clamped * effectiveDuration;
        // Adjust for the server-side seek offset already baked into the stream
        v.currentTime = Math.max(0, targetEffectiveTime - seekOffsetRef.current);
        setCurrentTimeSec(targetEffectiveTime);
    };

    const ratioFromMouseEvent = (e: React.MouseEvent<HTMLDivElement> | globalThis.MouseEvent) => {
        const bar = seekBarRef.current;
        if (!bar) return 0;
        const rect = bar.getBoundingClientRect();
        return (e.clientX - rect.left) / rect.width;
    };

    const handleSeekBarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        setIsDragging(true);
        seekToRatio(ratioFromMouseEvent(e));
        resetControlsTimeout();
    };

    useEffect(() => {
        if (!isDragging) return;
        const onMove = (e: globalThis.MouseEvent) => seekToRatio(ratioFromMouseEvent(e));
        const onUp = () => setIsDragging(false);
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
        return () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isDragging, effectiveDuration]);

    // ── Control actions ──────────────────────────────────────────────────────
    const handlePlayPause = (e: React.MouseEvent) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;
        v.paused ? v.play().catch(() => undefined) : v.pause();
        resetControlsTimeout();
    };

    const handleSkip = (e: React.MouseEvent, seconds: number) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;
        v.currentTime = Math.max(0, v.currentTime + seconds);
        resetControlsTimeout();
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const v = videoRef.current;
        if (!v) return;
        const val = parseFloat(e.target.value);
        v.volume = val;
        v.muted = val === 0;
        setVolume(val);
        setIsMuted(val === 0);
        resetControlsTimeout();
    };

    const handleToggleMute = (e: React.MouseEvent) => {
        e.stopPropagation();
        const v = videoRef.current;
        if (!v) return;
        v.muted = !v.muted;
        setIsMuted(v.muted);
        resetControlsTimeout();
    };

    const handleToggleFullscreen = (e: React.MouseEvent) => {
        e.stopPropagation();
        document.fullscreenElement
            ? document.exitFullscreen()
            : containerRef.current?.requestFullscreen();
        resetControlsTimeout();
    };

    // ── Derived display values ───────────────────────────────────────────────
    const progressPct = effectiveDuration > 0 ? (currentTimeSec / effectiveDuration) * 100 : 0;
    const bufferedPct =
        effectiveDuration > 0
            ? (Math.min(bufferedEnd, effectiveDuration) / effectiveDuration) * 100
            : 0;

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-5xl bg-black border border-white/10 rounded-2xl overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <h3 className="text-white font-semibold truncate">{title}</h3>
                    <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10 text-white">
                        <X size={18} />
                    </button>
                </div>

                {/* Video area with custom controls */}
                <div
                    ref={containerRef}
                    className="aspect-video bg-black relative select-none"
                    style={{ cursor: showControls || !isPlaying ? 'default' : 'none' }}
                    onMouseMove={resetControlsTimeout}
                    onClick={handlePlayPause}
                >
                    <video ref={videoRef} className="w-full h-full" playsInline />

                    {/* Controls overlay — auto-hides during playback */}
                    <div
                        className={`absolute inset-0 flex flex-col justify-end transition-opacity duration-300 ${
                            showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
                        }`}
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    >
                        {/* Gradient scrim */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent pointer-events-none" />

                        <div className="relative z-10 px-4 pb-4 pt-2 flex flex-col gap-2">
                            {/* ── Seek bar ── */}
                            <div
                                ref={seekBarRef}
                                className="w-full h-4 flex items-center cursor-pointer group"
                                onMouseDown={handleSeekBarMouseDown}
                            >
                                <div className="relative w-full h-1 group-hover:h-1.5 transition-all duration-150 rounded-full bg-white/20">
                                    {/* Buffered */}
                                    <div
                                        className="absolute inset-y-0 left-0 bg-white/35 rounded-full"
                                        style={{ width: `${bufferedPct}%` }}
                                    />
                                    {/* Played */}
                                    <div
                                        className="absolute inset-y-0 left-0 bg-red-500 rounded-full"
                                        style={{ width: `${progressPct}%` }}
                                    >
                                        <div
                                            className={`absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-3 h-3 bg-white rounded-full shadow-md transition-opacity ${
                                                isDragging ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                            }`}
                                        />
                                    </div>
                                </div>
                            </div>

                            {/* ── Bottom controls row ── */}
                            <div className="flex items-center gap-3">
                                {/* Play / Pause */}
                                <button
                                    onClick={handlePlayPause}
                                    className="text-white hover:text-red-400 transition-colors shrink-0"
                                    aria-label={isPlaying ? 'Pause' : 'Lecture'}
                                >
                                    {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
                                </button>

                                {/* Skip −10 s */}
                                <button
                                    onClick={(e: React.MouseEvent) => handleSkip(e, -10)}
                                    className="text-white hover:text-red-400 transition-colors shrink-0"
                                    aria-label="Reculer 10 secondes"
                                >
                                    <RotateCcw size={16} />
                                </button>

                                {/* Skip +10 s */}
                                <button
                                    onClick={(e: React.MouseEvent) => handleSkip(e, 10)}
                                    className="text-white hover:text-red-400 transition-colors shrink-0"
                                    aria-label="Avancer 10 secondes"
                                >
                                    <RotateCw size={16} />
                                </button>

                                {/* Volume */}
                                <div className="flex items-center gap-1.5 group/vol shrink-0">
                                    <button
                                        onClick={handleToggleMute}
                                        className="text-white hover:text-red-400 transition-colors"
                                        aria-label={isMuted ? 'Activer le son' : 'Couper le son'}
                                    >
                                        {isMuted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
                                    </button>
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={isMuted ? 0 : volume}
                                        onChange={handleVolumeChange}
                                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                                        className="w-0 group-hover/vol:w-16 overflow-hidden transition-all duration-200 accent-red-500 cursor-pointer"
                                        aria-label="Volume"
                                    />
                                </div>

                                {/* Time display */}
                                <span className="text-white/90 text-xs font-mono tabular-nums ml-1 shrink-0">
                                    {fmtTime(currentTimeSec)}&nbsp;/&nbsp;{effectiveDuration > 0 ? fmtTime(effectiveDuration) : '--:--'}
                                </span>

                                <div className="flex-1" />

                                {/* Fullscreen */}
                                <button
                                    onClick={handleToggleFullscreen}
                                    className="text-white hover:text-red-400 transition-colors shrink-0"
                                    aria-label={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
                                >
                                    {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
                                </button>
                            </div>
                        </div>
                    </div>

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
            </div>
        </div>
    );
}
