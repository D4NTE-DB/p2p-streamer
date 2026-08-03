import React, { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { X, AlertTriangle, Activity, Wifi, ArrowDown, ArrowUp } from 'lucide-react';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  durationHint?: number; // Total duration in seconds from Cinemeta
  infoHash?: string; // For telemetry fetching
  onClose?: () => void;
}

interface TelemetryItem {
  infoHash: string;
  downloadSpeed: string;
  uploadSpeed: string;
  progress: string;
  numPeers: number;
}

function formatSeconds(totalSeconds: number): string {
  if (!totalSeconds || isNaN(totalSeconds) || !isFinite(totalSeconds)) return '00:00';
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = Math.floor(totalSeconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  }
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  durationHint,
  infoHash,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [revealComplete, setRevealComplete] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Timeline tracking
  const [currentTime, setCurrentTime] = useState(0);
  const [nativeDuration, setNativeDuration] = useState<number>(0);

  // Telemetry HUD state
  const [telemetry, setTelemetry] = useState<TelemetryItem | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;

    setIsLoading(true);
    setRevealComplete(false);
    setIsFadingOut(false);
    setShowOverlay(true);
    setHasError(false);
    setErrorMessage('');
    setCurrentTime(0);
    setNativeDuration(0);

    let hls: Hls | null = null;
    const isHlsUrl = src.includes('.m3u8') || src.includes('/hls-stream/') || src.includes('/cmaf-stream/');

    if (isHlsUrl && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              console.error("[HLS] Network error, attempting recovery...");
              hls?.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              console.error("[HLS] Media error, attempting recovery...");
              hls?.recoverMediaError();
              break;
            default:
              setHasError(true);
              setErrorMessage('Fatal HLS streaming error');
              hls?.destroy();
              break;
          }
        }
      });
    } else if (isHlsUrl && video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    } else {
      video.src = src;
    }

    const handleCanPlay = () => setIsLoading(false);
    const handlePlaying = () => setIsLoading(false);
    const handleTimeUpdate = () => {
      if (video) {
        setCurrentTime(video.currentTime || 0);
        if (video.duration && isFinite(video.duration)) {
          setNativeDuration(video.duration);
        }
      }
    };
    const handleError = () => {
      setHasError(true);
      setErrorMessage('Failed to load video stream');
      setIsLoading(false);
    };

    video.addEventListener('canplay', handleCanPlay);
    video.addEventListener('playing', handlePlaying);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('error', handleError);

    return () => {
      if (hls) {
        hls.destroy();
      }
      video.removeEventListener('canplay', handleCanPlay);
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('error', handleError);
    };
  }, [src]);

  // Telemetry stats polling
  useEffect(() => {
    let isMounted = true;
    const fetchTelemetry = () => {
      fetch('http://localhost:8888/stats')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!isMounted || !data?.torrents) return;
          const matched =
            data.torrents.find((t: any) => t.infoHash === infoHash) ||
            data.torrents[data.torrents.length - 1];
          if (matched) {
            setTelemetry({
              infoHash: matched.infoHash,
              downloadSpeed: matched.downloadSpeed || '0 B/s',
              uploadSpeed: matched.uploadSpeed || '0 B/s',
              progress: matched.progress || '0',
              numPeers: matched.numPeers || 0,
            });
          }
        })
        .catch(() => {
          if (isMounted) setTelemetry(null);
        });
    };

    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, 2500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [infoHash]);

  // Smooth overlay fade-out when loading and reveal complete
  useEffect(() => {
    if (!isLoading && revealComplete && showOverlay && !isFadingOut) {
      setIsFadingOut(true);
      const timer = setTimeout(() => {
        setShowOverlay(false);
      }, 650);
      return () => clearTimeout(timer);
    }
  }, [isLoading, revealComplete, showOverlay, isFadingOut]);

  // Determine if we should use the custom Cinemeta duration timeline
  const effectiveDuration = nativeDuration > 60 ? nativeDuration : (durationHint && durationHint > 60 ? durationHint : 0);
  const showCustomTimeline = effectiveDuration > 0 && (nativeDuration <= 60 || !isFinite(nativeDuration));
  const progressPercent = effectiveDuration > 0 ? Math.min(100, (currentTime / effectiveDuration) * 100) : 0;

  return (
    <div className="w-full bg-black aspect-video flex flex-col relative group rounded-xl overflow-hidden shadow-2xl border border-gray-800">
      {/* Telemetry HUD Overlay (Visible on Hover at Top Left) */}
      {telemetry && (
        <div className="absolute top-3 left-3 z-30 flex items-center gap-3.5 px-3.5 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-xs font-mono text-gray-200 shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none">
          <div className="flex items-center gap-1 text-blue-400 font-bold">
            <ArrowDown className="w-3.5 h-3.5" />
            <span>{telemetry.downloadSpeed}</span>
          </div>
          <div className="flex items-center gap-1 text-green-400 font-bold">
            <ArrowUp className="w-3.5 h-3.5" />
            <span>{telemetry.uploadSpeed}</span>
          </div>
          <div className="flex items-center gap-1 text-gray-400">
            <Wifi className="w-3.5 h-3.5 text-yellow-400" />
            <span>{telemetry.numPeers} Peers</span>
          </div>
          <div className="flex items-center gap-1 text-orange-400 font-bold border-l border-white/10 pl-2.5">
            <Activity className="w-3.5 h-3.5" />
            <span>Buf: {telemetry.progress}%</span>
          </div>
        </div>
      )}

      {/* Video Element */}
      <video
        ref={videoRef}
        className="w-full h-full object-contain"
        controls
        autoPlay
        playsInline
      />

      {/* Custom Progress Bar Overlay (For transcoded live streams with Cinemeta hint) */}
      {showCustomTimeline && !showOverlay && (
        <div 
          className="absolute bottom-11 left-4 right-4 z-20 flex flex-col gap-1 pointer-events-auto opacity-0 group-hover:opacity-100 transition-opacity duration-300"
          title="Progress calculated from Cinemeta movie runtime. Seeking disabled on live transcode."
        >
          <div className="flex justify-between items-center text-[11px] font-mono text-gray-200 font-bold drop-shadow-md">
            <span className="bg-black/60 px-2 py-0.5 rounded border border-white/10">
              {formatSeconds(currentTime)}
            </span>
            <span className="bg-black/60 px-2 py-0.5 rounded border border-white/10 text-blue-400">
              {formatSeconds(effectiveDuration)} (Cinemeta)
            </span>
          </div>
          <div className="w-full h-1.5 bg-gray-900/80 backdrop-blur rounded-full overflow-hidden border border-white/10 shadow-inner">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Loading Overlay with Progress Reveal */}
      {showOverlay && !hasError && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-950 overflow-hidden ${
            isFadingOut ? 'animate-poster-done' : ''
          }`}
        >
          {poster ? (
            <div className="absolute inset-0 w-full h-full">
              {/* Sharp Base Poster Layer */}
              <div
                className={`absolute inset-0 bg-cover bg-center scale-105 ${
                  revealComplete && isLoading ? 'animate-pulse' : ''
                }`}
                style={{ backgroundImage: `url(${poster})` }}
              />

              {/* Animated Blur Cover (Single-run Left-to-Right Reveal) */}
              <div
                onAnimationEnd={() => setRevealComplete(true)}
                className="absolute inset-0 bg-cover bg-center scale-105 backdrop-blur-xl animate-poster-reveal"
                style={{ backgroundImage: `url(${poster})`, filter: 'blur(24px)' }}
              />

              <div className="absolute inset-0 bg-black/40" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-gray-950" />
          )}

          {/* Bottom Progress Text Label */}
          <div className="absolute bottom-6 z-20 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-center shadow-xl">
            <span className="text-white font-medium text-xs tracking-wide">
              {!revealComplete
                ? 'Buffering stream...'
                : isLoading
                ? 'Almost ready...'
                : 'Stream complete! Loading player...'}
            </span>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-950/90 backdrop-blur-md p-6 text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-3" />
          <h3 className="text-white font-bold text-lg mb-1">Playback Error</h3>
          <p className="text-gray-400 text-sm max-w-xs mb-4">{errorMessage || 'Unable to play this stream.'}</p>
          {onClose && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg text-sm font-medium border border-gray-700 transition-colors"
            >
              Close Player
            </button>
          )}
        </div>
      )}

      {/* Close Button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-30 bg-black/70 hover:bg-black p-2 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity border border-white/10"
          title="Close Player"
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
