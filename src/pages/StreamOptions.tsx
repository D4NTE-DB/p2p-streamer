import React, { useEffect, useState, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { TORRENTIO_API_URL, CINEMETA_API_URL, QUALITY_CATEGORIES } from '../constants';
import { StreamItem } from '../components/StreamItem';
import { VideoPlayer } from '../components/VideoPlayer';
import type { CategorizedStreams, TorrentioStream } from '../types';
import { setAudioLanguage } from '../store/configSlice';
import { closePlayer } from '../store/playerSlice';
import { useDispatch, useSelector } from 'react-redux';
import type { RootState, AppDispatch } from '../store';

import { parseSizeToBytes, detectLanguages, detectSubtitles, detectFormat } from '../utils/streamParsers';

export const StreamOptions: React.FC = () => {
  const dispatch = useDispatch<AppDispatch>();
  const { imdbId } = useParams();
  const [searchParams] = useSearchParams();
  const title = searchParams.get('title') || 'Unknown Title';
  const poster = searchParams.get('poster') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [streams, setStreams] = useState<CategorizedStreams>({ '4K': [], '1080p': [], '720p': [], 'SD/Other': [] });
  const [activeTab, setActiveTab] = useState<string>('1080p');
  
  const playerContainerRef = useRef<HTMLDivElement | null>(null);

  const { selectedQualities, maxSizeGb, audioLanguage, requireSubtitles } = useSelector((state: RootState) => state.config);
  const { playingUrl, playingInfoHash } = useSelector((state: RootState) => state.player);


  // Smooth scroll to player when video starts playing
  useEffect(() => {
    if (playingUrl) {
      setTimeout(() => {
        playerContainerRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [playingUrl]);

  // Fetch Torrentio streams via proxy
  useEffect(() => {
    if (!imdbId) return;

    const fetchStreams = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${TORRENTIO_API_URL}/stream/movie/${imdbId}.json`);
        if (!res.ok) throw new Error(`Torrentio request failed (HTTP ${res.status})`);
        const data = await res.json();
        
        if (data.error) {
          throw new Error(data.error);
        }

        if (!data.streams || data.streams.length === 0) {
          throw new Error('No streams found for this movie.');
        }

        const categorized: CategorizedStreams = { '4K': [], '1080p': [], '720p': [], 'SD/Other': [] };
        
        data.streams.forEach((stream: TorrentioStream) => {
          let cleanTitle = stream.title || '';
          let sizeMatch = cleanTitle.match(/💾\s*([^👤⚙️\n]+)/);
          let size = sizeMatch ? sizeMatch[1].trim() : 'Unknown Size';

          let seedersMatch = cleanTitle.match(/👤\s*(\d+)/);
          let seeders = seedersMatch ? parseInt(seedersMatch[1], 10) : 0;

          let rawTitle = cleanTitle.split('\n')[1] || cleanTitle.split('\n')[0];

          let quality: keyof CategorizedStreams = 'SD/Other';
          const titleUpper = cleanTitle.toUpperCase();
          if (titleUpper.includes('4K') || titleUpper.includes('2160P')) quality = '4K';
          else if (titleUpper.includes('1080P')) quality = '1080p';
          else if (titleUpper.includes('720P')) quality = '720p';

          const languages = detectLanguages(cleanTitle);
          const hasSubtitles = detectSubtitles(cleanTitle);
          const format = detectFormat(cleanTitle);

          categorized[quality].push({
            id: stream.infoHash || stream.url || Math.random().toString(),
            infoHash: stream.infoHash || '',
            url: stream.url || '',
            name: stream.name || 'Unknown',
            title: cleanTitle,
            cleanTitle: rawTitle,
            size,
            seeders,
            quality,
            rawTitle,
            languages,
            hasSubtitles,
            format
          });
        });

        // Filter by max size & language preference, then sort by seeders descending
        const maxSizeBytes = (maxSizeGb || 10) * 1024 * 1024 * 1024;
        Object.keys(categorized).forEach(key => {
          categorized[key as keyof CategorizedStreams] = categorized[key as keyof CategorizedStreams]
            .filter(item => {
              const bytes = parseSizeToBytes(item.size);
              const passesSize = bytes === 0 || bytes <= maxSizeBytes;
              if (!passesSize) return false;
              if (requireSubtitles && !item.hasSubtitles) return false;

              if (audioLanguage === 'es') {
                return item.languages.some(l => l === 'MX' || l === 'ES' || l === 'MULTI');
              } else if (audioLanguage === 'en') {
                return item.languages.some(l => l === 'EN' || l === 'MULTI');
              }
              return true;
            })
            .sort((a, b) => b.seeders - a.seeders);
        });

        setStreams(categorized);

        // Auto-select tab
        const available = QUALITY_CATEGORIES.find(q => selectedQualities[q] && categorized[q].length > 0);
        if (available) setActiveTab(available);

      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchStreams();
  }, [imdbId, selectedQualities, maxSizeGb, audioLanguage, requireSubtitles]);

  const renderStreamListContent = () => (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden shadow-lg">
      {/* Language Switch Bar */}
      <div className="p-3.5 bg-gray-950/60 border-b border-gray-800 flex items-center justify-between gap-4 flex-wrap">
        <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Audio Language</span>
        <div className="flex items-center bg-gray-900 p-1 rounded-lg border border-gray-800 gap-1">
          <button
            onClick={() => dispatch(setAudioLanguage('all'))}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              audioLanguage === 'all'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            🌍 All
          </button>
          <button
            onClick={() => dispatch(setAudioLanguage('es'))}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              audioLanguage === 'es'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            🇲🇽🇪🇸 Español
          </button>
          <button
            onClick={() => dispatch(setAudioLanguage('en'))}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
              audioLanguage === 'en'
                ? 'bg-blue-600 text-white shadow-md'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800'
            }`}
          >
            🇬🇧 Global (EN)
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-800 overflow-x-auto scrollbar-hide">
        {QUALITY_CATEGORIES.map(category => {
          const count = streams[category]?.length || 0;
          const isEnabled = selectedQualities[category];
          if (!isEnabled || count === 0) return null;
          
          return (
            <button
              key={category}
              onClick={() => setActiveTab(category)}
              className={`flex-1 min-w-[100px] py-4 px-6 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
                activeTab === category 
                  ? 'border-blue-500 text-blue-400 bg-blue-500/5' 
                  : 'border-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
              }`}
            >
              {category} <span className="ml-2 px-2 py-0.5 bg-gray-800 rounded-full text-xs">{count}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      <div className="divide-y divide-gray-800 max-h-[800px] overflow-y-auto">
        {!selectedQualities[activeTab] ? (
            <div className="p-8 text-center text-gray-500">This quality is hidden by your filters.</div>
        ) : streams[activeTab as keyof CategorizedStreams].length === 0 ? (
          <div className="p-8 text-center text-gray-500">No streams found for this quality.</div>
        ) : (
          streams[activeTab as keyof CategorizedStreams].map((stream, idx) => (
            <StreamItem
              key={`${stream.infoHash}-${idx}`}
              stream={stream}
            />
          ))
        )}
      </div>
    </div>
  );

  return (
    <div className="max-w-7xl mx-auto pb-12 flex flex-col gap-8" ref={playerContainerRef}>
      {/* Full-Width Player Mode when playingUrl is active */}
      {playingUrl ? (
        <div className="w-full flex flex-col gap-6">
          <div className="w-full bg-gray-900 border border-gray-800 rounded-2xl overflow-hidden shadow-2xl">
            <VideoPlayer
              src={playingUrl}
              poster={poster}
              infoHash={playingInfoHash}
              onClose={() => dispatch(closePlayer())}
            />
          </div>

          {/* Title Header Bar when Player is active */}
          <div className="flex items-center justify-between px-2">
            <div>
              <h1 className="text-xl font-bold text-white">{title}</h1>
              <p className="text-xs text-gray-400">IMDB: {imdbId}</p>
            </div>
            <button
              onClick={() => dispatch(closePlayer())}
              className="text-xs text-gray-400 hover:text-white px-3 py-1.5 rounded-lg bg-gray-800 border border-gray-700"
            >
              Close Video
            </button>
          </div>

          {/* Stream Options List shifted down below full-width player with animation */}
          <div className="w-full animate-slide-down">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center bg-gray-900 border border-gray-800 rounded-xl">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                <p className="text-gray-400 font-medium">Scraping Torrentio...</p>
              </div>
            ) : error ? (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-xl flex items-start gap-4">
                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold mb-1">Failed to find streams</h3>
                  <p>{error}</p>
                </div>
              </div>
            ) : (
              renderStreamListContent()
            )}
          </div>
        </div>
      ) : (
        /* Default Side-by-Side Layout when not playing */
        <div className="flex flex-col md:flex-row gap-8">
          {/* Left Sidebar: Poster */}
          <div className="w-full md:w-1/3 flex flex-col gap-6">
            <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-xl sticky top-24">
              <div className="relative aspect-[2/3] bg-gray-800">
                {poster ? (
                  <img src={poster} alt={title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-gray-500">No Poster</div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-gray-900 to-transparent"></div>
                <div className="absolute bottom-0 left-0 p-6 w-full">
                  <h1 className="text-2xl font-bold text-white mb-2">{title}</h1>
                  <p className="text-gray-400 text-sm">
                    IMDB ID: {imdbId}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Content: Stream List */}
          <div className="w-full md:w-2/3">
            {loading ? (
              <div className="h-64 flex flex-col items-center justify-center bg-gray-900 border border-gray-800 rounded-xl">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-4" />
                <p className="text-gray-400 font-medium">Scraping Torrentio...</p>
              </div>
            ) : error ? (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-6 rounded-xl flex items-start gap-4">
                <AlertCircle className="w-6 h-6 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold mb-1">Failed to find streams</h3>
                  <p>{error}</p>
                </div>
              </div>
            ) : (
              renderStreamListContent()
            )}
          </div>
        </div>
      )}
    </div>
  );
};
