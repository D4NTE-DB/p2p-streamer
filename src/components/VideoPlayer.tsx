import React, { useEffect, useRef, useState } from 'react';
import { MediaPlayer, MediaProvider, useMediaState, type MediaPlayerInstance } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import { X, AlertTriangle, Activity, Wifi, ArrowDown, ArrowUp, Server } from 'lucide-react';
import { logPlaybackEvent } from '../utils/playerAnalytics';
import { SystemStatusPanel } from './SystemStatusPanel';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';

interface VideoPlayerProps {
  src: string;
  poster?: string;
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

// Helper to determine the correct Vidstack source type based on URL or extension
function getSrcObject(sourceUrl: string) {
  if (!sourceUrl) return sourceUrl;
  
  const urlLower = sourceUrl.toLowerCase();
  
  // Native HLS/DASH Playlists
  if (urlLower.includes('.m3u8')) return { src: sourceUrl, type: 'application/x-mpegurl' };
  if (urlLower.includes('.mpd')) return { src: sourceUrl, type: 'application/dash+xml' };
  
  // Common Video Containers
  if (urlLower.includes('.mkv')) return { src: sourceUrl, type: 'video/x-matroska' };
  if (urlLower.includes('.avi')) return { src: sourceUrl, type: 'video/x-msvideo' };
  if (urlLower.includes('.mp4')) return { src: sourceUrl, type: 'video/mp4' };
  if (urlLower.includes('.webm')) return { src: sourceUrl, type: 'video/webm' };
  if (urlLower.includes('.ogg') || urlLower.includes('.ogv')) return { src: sourceUrl, type: 'video/ogg' };
  
  // Fallback for our proxy endpoints without explicit extensions
  if (urlLower.includes('/stream/')) return { src: sourceUrl, type: 'video/mp4' };
  
  return sourceUrl; // Let Vidstack infer
}

interface PlayerOverlaysProps {
  poster?: string;
  infoHash?: string;
  onClose?: () => void;
}

// Embedded Player Overlays component sitting INSIDE <MediaPlayer> to inherit Vidstack Context and Fullscreen scope
const PlayerOverlays: React.FC<PlayerOverlaysProps> = ({
  poster,
  infoHash,
  onClose,
}) => {
  // Read state directly from Vidstack Media Context (zero manual event listeners or parent re-renders)
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const canPlay = useMediaState('canPlay');
  const playing = useMediaState('playing');
  const error = useMediaState('error');

  const isLoading = !canPlay && !playing;
  const hasError = !!error;
  const errorMessage = error?.message || 'Failed to load video stream';

  const [revealProgress, setRevealProgress] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showProxyPanel, setShowProxyPanel] = useState(false);

  // Telemetry HUD state from Redux
  const globalStats = useSelector((state: RootState) => state.telemetry.stats);
  const telemetry = globalStats?.torrents?.find((t) => t.infoHash === infoHash) || 
                   (globalStats?.torrents?.length ? globalStats.torrents[globalStats.torrents.length - 1] : null);

  // Fake progress that completes exactly when ready
  useEffect(() => {
    if (isLoading) {
      const interval = setInterval(() => {
        setRevealProgress(prev => {
          const remaining = 90 - prev;
          return Math.min(90, prev + Math.max(0.5, remaining * 0.1));
        });
      }, 150);
      return () => clearInterval(interval);
    } else {
      setRevealProgress(100);
    }
  }, [isLoading]);

  // Smooth overlay fade-out when loading and reveal complete
  useEffect(() => {
    if (revealProgress === 100 && showOverlay && !isFadingOut) {
      const timer = setTimeout(() => {
        setIsFadingOut(true);
        setTimeout(() => setShowOverlay(false), 650);
      }, 300); // Give the 100% wipe a moment to finish visually
      return () => clearTimeout(timer);
    }
  }, [revealProgress, showOverlay, isFadingOut]);

  return (
    <>
      {/* Telemetry HUD Overlay (Natively embedded inside MediaPlayer, visible in Fullscreen!) */}
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


      {/* Loading Overlay with Progress Reveal */}
      {showOverlay && !hasError && (
        <div
          className={`absolute inset-0 z-10 flex flex-col items-center justify-center bg-gray-950 overflow-hidden pointer-events-none ${
            isFadingOut ? 'animate-poster-done' : ''
          }`}
        >
          {poster ? (
            <div className="absolute inset-0 w-full h-full">
              {/* Sharp Base Poster Layer */}
              <div
                className="absolute inset-0 bg-cover bg-center scale-105"
                style={{ backgroundImage: `url(${poster})` }}
              />

              {/* Blur Cover (Left-to-Right Wipe matching load state) */}
              <div
                className="absolute inset-0 bg-cover bg-center scale-105 backdrop-blur-xl transition-all duration-[150ms] ease-out"
                style={{ 
                  backgroundImage: `url(${poster})`, 
                  filter: 'blur(24px)',
                  clipPath: `inset(0 0 0 ${revealProgress}%)`
                }}
              />

              <div className="absolute inset-0 bg-black/40" />
            </div>
          ) : (
            <div className="absolute inset-0 bg-gray-950" />
          )}

          {/* Bottom Progress Text Label */}
          <div className="absolute bottom-6 z-20 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-center shadow-xl">
            <span className="text-white font-medium text-xs tracking-wide">
              {revealProgress < 100
                ? `Buffering stream... ${Math.round(revealProgress)}%`
                : 'Stream complete! Loading player...'}
            </span>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {hasError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-gray-950/90 backdrop-blur-md p-6 text-center pointer-events-auto">
          <AlertTriangle className="w-12 h-12 text-red-500 mb-3" />
          <h3 className="text-white font-bold text-lg mb-1">Playback Error</h3>
          <p className="text-gray-400 text-sm max-w-xs mb-4">{errorMessage}</p>
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

      {/* Local Proxy Engine Button */}
      <button
        onClick={() => setShowProxyPanel(prev => !prev)}
        className={`absolute top-3 right-14 z-30 p-2 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity border pointer-events-auto ${
          showProxyPanel ? 'bg-blue-600 border-blue-400' : 'bg-black/70 hover:bg-black border-white/10'
        }`}
        title="Local Proxy Engine"
      >
        <Server className="w-5 h-5" />
      </button>

      {/* Close Button */}
      {onClose && (
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-30 bg-black/70 hover:bg-black p-2 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity border border-white/10 pointer-events-auto"
          title="Close Player"
        >
          <X className="w-5 h-5" />
        </button>
      )}

      {/* Proxy Engine Panel */}
      {showProxyPanel && (
        <div className="absolute top-14 right-3 w-80 z-40 pointer-events-auto animate-in slide-in-from-top-2 fade-in duration-200">
          <SystemStatusPanel />
        </div>
      )}
    </>
  );
};

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  src,
  poster,
  infoHash,
  onClose,
}) => {
  const playerRef = useRef<MediaPlayerInstance>(null);
  const { audioLanguage, requireSubtitles } = useSelector((state: RootState) => state.config);

  useEffect(() => {
    logPlaybackEvent({
      type: 'play',
      infoHash,
      timestamp: Date.now(),
      detail: { src, poster },
    });
  }, [src, infoHash, poster]);

  return (
    <div className="w-full bg-black aspect-video flex flex-col relative group rounded-xl overflow-hidden shadow-2xl border border-gray-800">
      {/* Vidstack Media Player Container */}
      <MediaPlayer
        ref={playerRef}
        src={getSrcObject(src)}
        poster={poster}
        aspectRatio="16/9"
        autoplay
        playsInline
        load="eager"
        onCanPlay={() => {
          if (!playerRef.current) return;
          const player = playerRef.current;
          
          if (audioLanguage && audioLanguage !== 'all') {
            const track = player.audioTracks.toArray().find(t => t.language?.toLowerCase().includes(audioLanguage));
            if (track) track.selected = true;
          }
          
          if (requireSubtitles) {
            const textTrack = player.textTracks.toArray().find(t => t.kind === 'subtitles' || t.kind === 'captions');
            if (textTrack) textTrack.mode = 'showing';
          }
        }}
        onPlaying={() => {
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
            currentTime: e?.detail?.currentTime ?? e?.currentTime,
            duration: e?.detail?.duration ?? e?.duration,
            timestamp: Date.now(),
          });
        }}
        onEnded={(e: Record<string, any>) => {
          logPlaybackEvent({
            type: 'ended',
            infoHash,
            duration: e?.detail?.duration ?? e?.duration,
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
        onError={(e: Record<string, any>) => {
          logPlaybackEvent({
            type: 'error',
            infoHash,
            timestamp: Date.now(),
            detail: { error: e?.detail },
          });
        }}
        className="w-full h-full object-contain"
      >
        <MediaProvider />
        <DefaultVideoLayout icons={defaultLayoutIcons} />
        
        {/* Natively embedded overlays inside Vidstack player context */}
        <PlayerOverlays
          poster={poster}
          infoHash={infoHash}
          onClose={onClose}
        />
      </MediaPlayer>
    </div>
  );
};
