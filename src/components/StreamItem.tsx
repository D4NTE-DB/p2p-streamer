import React from 'react';
import { Heart, Users, HardDrive, Tv, ExternalLink, Subtitles, FileVideo } from 'lucide-react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import type { StreamMetadata } from '../types';
import type { RootState, AppDispatch } from '../store';
import { saveStreamToLibrary, removeStreamFromLibrary, launchStreamPlayback } from '../store/libraryThunks';
import { PROXY_BASE_URL } from '../constants';

interface StreamItemProps {
  stream: StreamMetadata;
}

const FLAG_MAP: Record<string, { flag: string; label: string; border: string }> = {
  MX: { flag: '🇲🇽', label: 'MX', border: 'border-green-500/30 text-green-400 bg-green-500/10' },
  ES: { flag: '🇪🇸', label: 'ES', border: 'border-yellow-500/30 text-yellow-400 bg-yellow-500/10' },
  EN: { flag: '🇬🇧', label: 'EN', border: 'border-blue-500/30 text-blue-400 bg-blue-500/10' },
  FR: { flag: '🇫🇷', label: 'FR', border: 'border-indigo-500/30 text-indigo-400 bg-indigo-500/10' },
  PT: { flag: '🇧🇷', label: 'PT', border: 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10' },
  IT: { flag: '🇮🇹', label: 'IT', border: 'border-red-500/30 text-red-400 bg-red-500/10' },
  DE: { flag: '🇩🇪', label: 'DE', border: 'border-amber-500/30 text-amber-400 bg-amber-500/10' },
  MULTI: { flag: '🌐', label: 'Multi', border: 'border-purple-500/30 text-purple-400 bg-purple-500/10' },
};

export const StreamItem = React.memo<StreamItemProps>(({ stream }) => {
  const dispatch = useDispatch<AppDispatch>();
  const { imdbId } = useParams();
  const [searchParams] = useSearchParams();
  const title = searchParams.get('title') || 'Unknown Title';
  const poster = searchParams.get('poster') || '';

  const isSaved = useSelector((state: RootState) =>
    state.library.items.some((item) => item.infoHash === stream.infoHash)
  );
  const lastPlayedInfoHash = useSelector((state: RootState) => state.player.lastPlayedInfoHash);
  const isRecentlyPlayed = lastPlayedInfoHash === stream.infoHash;

  const handleSaveToggle = () => {
    if (isSaved) {
      dispatch(removeStreamFromLibrary(stream.infoHash));
    } else {
      dispatch(saveStreamToLibrary(stream));
    }
  };

  const handlePlayInBrowser = () => {
    dispatch(launchStreamPlayback({ 
      infoHash: stream.infoHash, 
      title, 
      poster, 
      imdbId 
    }));
  };

  const handlePlayInVLC = () => {
    fetch(`${PROXY_BASE_URL}/play-vlc/${stream.infoHash}`).catch(console.error);
  };

  return (
    <div className={`p-4 transition-colors flex items-center justify-between group ${
      isRecentlyPlayed 
        ? 'bg-blue-900/20 border-l-4 border-blue-500' 
        : 'hover:bg-gray-800/50 border-l-4 border-transparent'
    }`}>
      <div className="flex-1 min-w-0 pr-4">
        <div className="mb-2 flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-gray-200 truncate" title={stream.cleanTitle}>
            {stream.cleanTitle}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm flex-wrap">
          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-300">
            {stream.tracker}
          </span>

          {/* Language Flag Tags */}
          {stream.languages && stream.languages.length > 0 && (
            <div className="flex items-center gap-1.5">
              {stream.languages.map((lang) => {
                const info = FLAG_MAP[lang] || { flag: '🌐', label: lang, border: 'border-gray-700 text-gray-400 bg-gray-800' };
                return (
                  <span 
                    key={lang} 
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold border flex items-center gap-1 ${info.border}`}
                  >
                    <span>{info.flag}</span>
                    <span>{info.label}</span>
                  </span>
                );
              })}
            </div>
          )}

          {/* Subtitles Badge */}
          {stream.hasSubtitles && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-gray-600 bg-gray-700/50 text-gray-300" title="Subtitles Available">
              <Subtitles className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold tracking-wider">CC</span>
            </div>
          )}

          {/* Format Badge */}
          {stream.format && (
            <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded border border-purple-500/30 text-purple-400 bg-purple-500/10" title="Video Format">
              <FileVideo className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold">{stream.format}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 text-green-400">
            <Users className="w-4 h-4" />
            <span className="font-bold">{stream.seeders}</span> Seeds
          </div>
          <div className="flex items-center gap-1.5 text-gray-400">
            <HardDrive className="w-4 h-4" />
            {stream.size}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={handleSaveToggle}
          className={`p-2 rounded-full border transition-colors ${
            isSaved
              ? 'bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20'
              : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
          }`}
          title={isSaved ? "Remove from Library" : "Save to Library"}
        >
          <Heart className="w-4 h-4" fill={isSaved ? "currentColor" : "none"} />
        </button>
        <button
          onClick={handlePlayInBrowser}
          className="flex items-center gap-1.5 bg-white text-black px-3.5 py-1.5 rounded-full text-xs font-bold hover:bg-gray-200 transition-colors"
          title="Play in Local Browser Player"
        >
          <Tv className="w-3.5 h-3.5" /> Browser
        </button>
        <button
          onClick={handlePlayInVLC}
          className="flex items-center gap-1.5 bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 px-3.5 py-1.5 rounded-full text-xs font-bold transition-colors"
          title="Launch Stream in VLC Player"
        >
          <ExternalLink className="w-3.5 h-3.5" /> VLC
        </button>
      </div>
    </div>
  );
});