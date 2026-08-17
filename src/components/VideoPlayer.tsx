import React, { useEffect, useRef, useState } from 'react';
import { MediaPlayer, MediaProvider, Track, useMediaState, useMediaRemote, type MediaPlayerInstance } from '@vidstack/react';
import { DefaultVideoLayout, defaultLayoutIcons } from '@vidstack/react/player/layouts/default';
import { X, AlertTriangle, Activity, Wifi, ArrowDown, ArrowUp, Server } from 'lucide-react';
import { logPlaybackEvent } from '../utils/playerAnalytics';
import { SystemStatusPanel } from './SystemStatusPanel';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState, AppDispatch } from '../store';
import { fetchSubtitles, clearSubtitles, setSubtitleOffset } from '../store/subtitleSlice';
import { PROXY_BASE_URL } from '../constants';
import { shiftVttTimestamps } from '../utils/vttParser';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  infoHash?: string; // For telemetry fetching
  imdbId?: string; // For OpenSubtitles fetching
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
  if (urlLower.includes('/stream/')) return sourceUrl; // Let Vidstack infer from Content-Type header
  
  return sourceUrl;
}

interface SubtitleTrackProps {
  fileId: number;
  label: string;
  language: string;
  isDefault: boolean;
  offsetSeconds: number;
}

const SubtitleTrack: React.FC<SubtitleTrackProps> = ({ fileId, label, language, isDefault, offsetSeconds }) => {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let url = '';

    fetch(`${PROXY_BASE_URL}/api/subtitles/download/${fileId}`)
      .then((res) => res.text())
      .then((text) => {
        if (!active) return;
        const shiftedText = shiftVttTimestamps(text, offsetSeconds);
        const blob = new Blob([shiftedText], { type: 'text/vtt' });
        url = URL.createObjectURL(blob);
        setBlobUrl(url);
      })
      .catch((err) => console.error(`Failed to load subtitle ${fileId}:`, err));

    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [fileId, offsetSeconds]);

  if (!blobUrl) return null;

  return (
    <Track
      src={blobUrl}
      kind="subtitles"
      label={label}
      language={language}
      type="vtt"
      default={isDefault}
    />
  );
};

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
  const remote = useMediaRemote();
  const currentTime = useMediaState('currentTime');
  const duration = useMediaState('duration');
  const canPlay = useMediaState('canPlay');
  const playing = useMediaState('playing');
  const error = useMediaState('error');
  const videoWidth = useMediaState('mediaWidth'); // Using mediaWidth to detect missing video

  const isLoading = !canPlay && !playing;
  const hasError = !!error;
  let errorMessage = error?.message || 'An unknown error occurred during playback.';
  
  if (errorMessage.includes('hlsError')) {
    errorMessage = 'Torrent is dead or timed out. No seeders could be found for this stream.';
  }

  const [revealProgress, setRevealProgress] = useState(0);
  const [isFadingOut, setIsFadingOut] = useState(false);
  const [showOverlay, setShowOverlay] = useState(true);
  const [showProxyPanel, setShowProxyPanel] = useState(false);
  const [showCodecWarning, setShowCodecWarning] = useState(false);

  // Telemetry HUD state from Redux
  const dispatch = useDispatch<AppDispatch>();
  const globalStats = useSelector((state: RootState) => state.telemetry.stats);
  const telemetry = globalStats?.torrents?.find((t) => t.infoHash === infoHash) || 
                   (globalStats?.torrents?.length ? globalStats.torrents[globalStats.torrents.length - 1] : null);

  const { subtitleOffset, activeFileId } = useSelector((state: RootState) => state.subtitles);

  const proxyDuration = telemetry?.durationSeconds ?? null;

  // Override Vidstack's internal duration state if native stream reports Infinity or 0
  useEffect(() => {
    if (
      remote &&
      proxyDuration &&
      proxyDuration > 0 &&
      (!isFinite(duration) || duration === 0)
    ) {
      remote.changeDuration(proxyDuration);
    }
  }, [remote, proxyDuration, duration]);

  // Real progress from telemetry
  useEffect(() => {
    if (isLoading && telemetry?.progress) {
      const realProgress = parseFloat(telemetry.progress);
      setRevealProgress(Math.min(95, realProgress));
    } else if (!isLoading) {
      setRevealProgress(100);
    }
  }, [isLoading, telemetry?.progress]);

  // Smooth overlay fade-out when loading and reveal complete
  useEffect(() => {
    if (revealProgress >= 95 && showOverlay && !isFadingOut) {
      const timer = setTimeout(() => {
        setIsFadingOut(true);
        setTimeout(() => setShowOverlay(false), 650);
      }, 300); // Give the wipe a moment to finish visually
      return () => clearTimeout(timer);
    }
  }, [revealProgress, showOverlay, isFadingOut]);

  // Safety net: force dismiss overlay after 15s regardless of state
  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      if (showOverlay) {
        setIsFadingOut(true);
        setTimeout(() => setShowOverlay(false), 650);
      }
    }, 15000);
    return () => clearTimeout(safetyTimer);
  }, []); // Empty deps, only run on mount

  // Playback health check: If playing for 8 seconds but no video frames (width === 0)
  useEffect(() => {
    if (playing && videoWidth === 0 && !showOverlay) {
      const healthTimer = setTimeout(() => {
        // If still playing and no video width after 8 seconds
        setShowCodecWarning(true);
      }, 8000);
      return () => clearTimeout(healthTimer);
    } else if (videoWidth > 0) {
      setShowCodecWarning(false);
    }
  }, [playing, videoWidth, showOverlay]);

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

      {/* Codec Warning Banner */}
      {showCodecWarning && (
        <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-30 flex items-center gap-3 px-4 py-3 rounded-lg bg-red-500/90 backdrop-blur-md border border-red-400 text-white shadow-lg animate-in fade-in slide-in-from-top-4">
          <AlertTriangle className="w-5 h-5" />
          <span className="text-sm font-medium">
            This stream's video codec may not be supported by your browser. Try the VLC option for full compatibility.
          </span>
          <button 
            onClick={() => setShowCodecWarning(false)}
            className="ml-2 text-white/80 hover:text-white"
          >
            <X className="w-4 h-4" />
          </button>
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

      {/* Subtitle Sync Controls */}
      {activeFileId && (
        <div className="absolute top-3 right-28 z-30 flex items-center bg-black/70 backdrop-blur-md rounded-full border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto">
          <button
            onClick={() => dispatch(setSubtitleOffset(subtitleOffset - 0.25))}
            className="px-3 py-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-l-full font-mono text-sm"
            title="Delay Subtitles (-0.25s)"
          >
            -
          </button>
          <div className="px-2 py-1.5 text-xs font-medium text-gray-300 border-x border-white/10 min-w-[70px] text-center pointer-events-none">
            Sync: {subtitleOffset > 0 ? '+' : ''}{subtitleOffset.toFixed(2)}s
          </div>
          <button
            onClick={() => dispatch(setSubtitleOffset(subtitleOffset + 0.25))}
            className="px-3 py-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-r-full font-mono text-sm"
            title="Advance Subtitles (+0.25s)"
          >
            +
          </button>
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
  imdbId,
  onClose,
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const playerRef = useRef<MediaPlayerInstance>(null);
  const { audioLanguage, subtitleLanguage, requireSubtitles } = useSelector((state: RootState) => state.config);
  const { tracks: subtitleTracks, activeFileId, subtitleOffset } = useSelector((state: RootState) => state.subtitles);

  // Fetch OpenSubtitles when imdbId changes
  useEffect(() => {
    if (imdbId) {
      dispatch(fetchSubtitles({ imdbId, lang: subtitleLanguage }));
    } else {
      dispatch(clearSubtitles());
    }

    return () => {
      dispatch(clearSubtitles());
    };
  }, [imdbId, subtitleLanguage, dispatch]);

  useEffect(() => {
    logPlaybackEvent({
      type: 'play',
      infoHash,
      timestamp: Date.now(),
      detail: { src, poster },
    });
  }, [src, infoHash, poster]);

  useEffect(() => {
    if (!playerRef.current) return;
    const player = playerRef.current;
    
    const unsub = player.subscribe(({ audioTracks, textTracks }) => {
      if (audioLanguage && audioLanguage !== 'all' && audioTracks.length > 0) {
        const track = audioTracks.find(t => t.language?.toLowerCase().includes(audioLanguage));
        if (track) track.selected = true;
      }
      if (requireSubtitles && textTracks.length > 0) {
        const textTrack = textTracks.find(t => t.kind === 'subtitles' || t.kind === 'captions');
        if (textTrack && textTrack.mode !== 'showing') {
          textTrack.mode = 'showing';
        }
      }
    });
    
    return unsub;
  }, [audioLanguage, requireSubtitles]);

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
        onPlaying={() => {
          logPlaybackEvent({
            type: 'play',
            infoHash,
            timestamp: Date.now(),
          });
        }}
        onPause={(e) => {
          logPlaybackEvent({
            type: 'pause',
            infoHash,
            currentTime: playerRef.current?.currentTime,
            duration: playerRef.current?.duration,
            timestamp: Date.now(),
          });
        }}
        onEnded={(e) => {
          logPlaybackEvent({
            type: 'ended',
            infoHash,
            duration: playerRef.current?.duration,
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
        onError={(e) => {
          logPlaybackEvent({
            type: 'error',
            infoHash,
            timestamp: Date.now(),
            detail: { error: e?.detail },
          });
        }}
        className="w-full h-full object-contain"
      >
        <MediaProvider>
          {subtitleTracks.map((sub, idx) => (
            <SubtitleTrack
              key={sub.fileId}
              fileId={sub.fileId}
              label={sub.label}
              language={sub.language}
              isDefault={requireSubtitles && (activeFileId === sub.fileId || (!activeFileId && idx === 0))}
              offsetSeconds={subtitleOffset}
            />
          ))}
        </MediaProvider>
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
