import { useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { X } from 'lucide-react';

interface VideoPlayerModalProps {
    open: boolean;
    title: string;
    streamUrl: string | null;
    streamSources?: string[];
    onClose: () => void;
}

export function VideoPlayerModal({ open, title, streamUrl, streamSources = [], onClose }: VideoPlayerModalProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const allSources = streamSources.length > 0 ? streamSources : streamUrl ? [streamUrl] : [];

    useEffect(() => {
        if (!open || allSources.length === 0 || !videoRef.current) return;

        const videoElement = videoRef.current;
        let hls: Hls | null = null;
        let sourceIndex = 0;
        let watchdogTimer: number | null = null;
        let switchedByWatchdog = false;

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

        videoElement.addEventListener('error', handleError);
        loadSource(allSources[sourceIndex]);

        return () => {
            clearWatchdog();
            videoElement.removeEventListener('error', handleError);
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
                <div className="aspect-video bg-black">
                    <video ref={videoRef} controls className="w-full h-full" playsInline />
                </div>
                <div className="px-4 py-3 border-t border-white/10 text-xs text-gray-400">
                    Certains flux (ex: MKV avec codecs non supportés navigateur) peuvent être muets/non lisibles. Le lecteur tente automatiquement plusieurs formats.
                </div>
            </div>
        </div>
    );
}
