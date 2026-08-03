import React, { useEffect, useRef, useState } from 'react';
import { MediaPlayer, MediaOutlet, MediaCommunitySkin } from '@vidstack/react';
import type { MediaPlayerElement } from 'vidstack';
import { X, AlertTriangle } from 'lucide-react';
import { logPlaybackEvent } from '../utils/playerAnalytics';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  durationHint?: number; // Total duration in seconds from Cinemeta
  infoHash?: string; // For telemetry fetching
  onClose?: () => void;
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
  const playerRef = useRef<MediaPlayerElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [revealComplete, setRevealComplete] = useState(false);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Timeline tracking
  const [currentTime, setCurrentTime] = useState(0);
  const [nativeDuration, setNativeDuration] = useState<number>(0);



  useEffect(() => {
    setIsLoading(true);
    setRevealComplete(false);
    setIsFadingOut(false);
    setShowOverlay(true);
    setHasError(false);
    setErrorMessage('');
    setCurrentTime(0);
    setNativeDuration(0);

    logPlaybackEvent({
      type: 'play',
      infoHash,
      timestamp: Date.now(),
      detail: { src, poster }
    });
  }, [src, infoHash, poster]);



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

      {/* Vidstack Media Player */}
      <MediaPlayer
        ref={playerRef}
        src={src.includes('.m3u8') ? { src, type: 'application/x-mpegurl' } : { src, type: 'video/mp4' }}
        poster={poster}
        aspectRatio="16/9"
        autoplay
        playsinline
        onCanPlay={() => setIsLoading(false)}
        onPlaying={() => {
          setIsLoading(false);
          logPlaybackEvent({
            type: 'play',
            infoHash,
            timestamp: Date.now(),
          });
        }}
        onPause={(e: Record<string, any>) => {
          logPlaybackEvent({
            type: 'pause',
            infoHash,
            currentTime: e?.detail?.currentTime,
            duration: e?.detail?.duration,
            timestamp: Date.now(),
          });
        }}
        onEnded={(e: Record<string, any>) => {
          logPlaybackEvent({
            type: 'ended',
            infoHash,
            duration: e?.detail?.duration,
            timestamp: Date.now(),
          });
        }}
        onWaiting={() => {
          logPlaybackEvent({
            type: 'buffering',
            infoHash,
            timestamp: Date.now(),
          });
        }}
        onTimeUpdate={(e: Record<string, any>) => {
          if (e?.detail?.currentTime) {
            setCurrentTime(e.detail.currentTime);
          }
          if (e?.detail?.duration && isFinite(e.detail.duration)) {
            setNativeDuration(e.detail.duration);
          }
        }}
        onError={(e: Record<string, any>) => {
          setHasError(true);
          setErrorMessage('Failed to load video stream');
          setIsLoading(false);
          logPlaybackEvent({
            type: 'error',
            infoHash,
            timestamp: Date.now(),
            detail: { error: e?.detail },
          });
        }}
        className="w-full h-full object-contain"
      >
        <MediaOutlet />
        <MediaCommunitySkin />
      </MediaPlayer>

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
