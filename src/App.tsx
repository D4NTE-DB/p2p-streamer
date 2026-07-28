import React, { useState, useEffect, useRef } from 'react';
import Hls from 'hls.js';
import { 
  CheckCircle, AlertCircle, Loader2, X, ExternalLink
} from 'lucide-react';
import { signInAnonymously, signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';
import { 
  collection, doc, setDoc, deleteDoc, 
  onSnapshot, query, serverTimestamp
} from 'firebase/firestore';

import { auth, db, firebaseConfig, firebaseConfigValid, firebaseConfigValidationMessages } from './firebase';
import { CINEMETA_API_URL, TORRENTIO_API_URL, QUALITY_CATEGORIES, PLAYING_TOAST_DURATION, CACHE_MAX_SIZE } from './constants';
import type { StreamMetadata, CategorizedStreams, TorrentioStream, LibraryItem, CachedSearch } from './types';

import { InitErrorScreen } from './components/InitErrorScreen';
import { FullScreenLoader } from './components/FullScreenLoader';
import { Header } from './components/Header';
import { SearchPanel } from './components/SearchPanel';
import { StreamItem } from './components/StreamItem';
import { LibraryPanel } from './components/LibraryPanel';
import { SystemStatusPanel } from './components/SystemStatusPanel';
import { SuggestionPanel } from './components/SuggestionPanel';

// Global declarations for environment variables injected by the platform
declare global {
  var __initial_auth_token: string | undefined;
}

const appId = import.meta.env.VITE_APP_ID || 'p2p-streaming-app';

// --- IN-MEMORY METADATA CACHE ---
const API_CACHE = new Map<string, CachedSearch>();

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  
  // Torrentio State
  const [searchQuery, setSearchQuery] = useState<string>('The Matrix'); 
  const [movieTitle, setMovieTitle] = useState<string>(''); 
  const [posterUrl, setPosterUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [initError, setInitError] = useState<string>('');
  const [categorizedStreams, setCategorizedStreams] = useState<CategorizedStreams>({ '4K': [], '1080p': [], '720p': [], 'SD/Other': [] });
  
  // UI State
  const [activeTab, setActiveTab] = useState<string | number>('1080p');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [playingStreamUrl, setPlayingStreamUrl] = useState<string | null>(null);
  // Quality Filters State
  const [selectedQualities, setSelectedQualities] = useState<Record<string, boolean>>({
    '4K': true,
    '1080p': true,
    '720p': false,
    'SD/Other': true
  });

  // Auto-switch tab if the active one gets disabled via checkbox
  useEffect(() => {
    if (!selectedQualities[activeTab] && Object.values(categorizedStreams).some(arr => arr.length > 0)) {
      const availableTab = QUALITY_CATEGORIES.find(
        q => selectedQualities[q] && categorizedStreams[q].length > 0
      );
      if (availableTab) setActiveTab(availableTab);
    }
  }, [selectedQualities, activeTab, categorizedStreams]);

  // 1. Initialize Auth
  useEffect(() => {
    const initAuth = async () => {
      if (!firebaseConfigValid || !auth) {
        setInitError(firebaseConfigValidationMessages.join('; '));
        return;
      }

      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token).catch(() => signInAnonymously(auth));
        } else {
          await signInAnonymously(auth);
        }
      } catch (err: unknown) {
        setInitError(err instanceof Error ? err.message : 'Firebase auth failed');
      }
    };

    initAuth();
    let unsubscribe = () => {};
    if (auth) {
      unsubscribe = onAuthStateChanged(auth, setUser);
    }
    return () => unsubscribe();
  }, []);

  // 2. Fetch User Library (CRUD - Read)
  useEffect(() => {
    if (!user || !db) return;
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'library'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LibraryItem));
      setLibrary(items);
    }, (err) => console.error("Firestore error:", err));
    return () => unsubscribe();
  }, [user]);

  // 3. Fetch and Parse from Torrentio
  const searchTorrentio = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!searchQuery.trim()) return;

    const queryKey = searchQuery.trim().toLowerCase();

    // CACHE HIT: Serve instantly from memory
    if (API_CACHE.has(queryKey)) {
      const cachedData = API_CACHE.get(queryKey)!;
      setMovieTitle(cachedData.movieTitle);
      setPosterUrl(cachedData.posterUrl);
      setCategorizedStreams(cachedData.streams);
      
      const availableQualities = QUALITY_CATEGORIES.filter(
        q => cachedData.streams[q].length > 0 && selectedQualities[q]
      );
      setActiveTab(availableQualities.length > 0 ? availableQualities[0] : 'SD/Other');
      return; 
    }

    setLoading(true);
    setError('');
    setMovieTitle('');
    setPosterUrl('');
    setCategorizedStreams({ '4K': [], '1080p': [], '720p': [], 'SD/Other': [] });

    try {
      let targetImdbId = searchQuery.trim();
      let expectedTitle = '';
      let expectedYear = '';

      let fetchedPosterUrl = '';
      if (!/^tt\d+$/i.test(targetImdbId)) {
        const searchRes = await fetch(`${CINEMETA_API_URL}/catalog/movie/top/search=${encodeURIComponent(targetImdbId)}.json`);
        const searchData = await searchRes.json();
        
        if (!searchData.metas || searchData.metas.length === 0) {
          throw new Error(`No movies found for "${targetImdbId}". Check spelling or try an IMDB ID.`);
        }
        
        targetImdbId = searchData.metas[0].imdb_id;
        expectedTitle = searchData.metas[0].name;
        expectedYear = searchData.metas[0].year;
      }

      if (!expectedTitle) {
        try {
          const metaRes = await fetch(`${CINEMETA_API_URL}/meta/movie/${targetImdbId}.json`);
          const metaData = await metaRes.json();
          if (metaData?.meta?.name) {
            expectedTitle = metaData.meta.name;
            expectedYear = metaData?.meta?.year || '';
            fetchedPosterUrl = metaData.meta.poster || '';
          }
        } catch (err) {
          console.warn("Could not fetch Cinemeta info, skipping title validation.");
        }
      }
      
      const fullMovieTitle = expectedYear ? `${expectedTitle} (${expectedYear})` : expectedTitle;
      setMovieTitle(fullMovieTitle);
      setPosterUrl(fetchedPosterUrl);

      const res = await fetch(`${TORRENTIO_API_URL}/stream/movie/${targetImdbId}.json`);
      if (!res.ok) throw new Error('Failed to fetch from Torrentio');
      
      const data = await res.json();
      if (!data.streams || data.streams.length === 0) {
        throw new Error('No streams found for this movie.');
      }

      processStreams(data.streams || [], expectedTitle, queryKey, fullMovieTitle, fetchedPosterUrl);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unknown network error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Organize by Quality and sort by Seeders
  const processStreams = (streams: TorrentioStream[], expectedTitle: string, queryKey: string, fullMovieTitle: string, posterUrl: string) => {
    const categories: CategorizedStreams = { '4K': [], '1080p': [], '720p': [], 'SD/Other': [] };

    const titleWords = expectedTitle 
      ? expectedTitle.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(' ').filter(w => w.length > 2)
      : [];

    streams.forEach(stream => {
      const title = stream.title || '';
      const name = stream.name || '';
      const fullText = (name + " " + title).toLowerCase();

      const rawFileName = title.split('\n')[0] || '';
      const cleanFileName = rawFileName.replace(/[\._]/g, ' ').trim();
      const searchFriendlyName = cleanFileName.toLowerCase();

      if (titleWords.length > 0) {
        const hasMatch = titleWords.some(word => searchFriendlyName.includes(word));
        if (!hasMatch) return; 
      }

      let quality = 'SD/Other';
      if (fullText.includes('4k') || fullText.includes('2160p')) quality = '4K';
      else if (fullText.includes('1080p')) quality = '1080p';
      else if (fullText.includes('720p')) quality = '720p';

      let seeders = 0;
      const seederMatch = title.match(/👤\s*(\d+)/);
      if (seederMatch) seeders = parseInt(seederMatch[1], 10);

      let size = 'Unknown';
      const sizeMatch = title.match(/💾\s*([\d.]+\s*[M|G|K]B)/i);
      if (sizeMatch) size = sizeMatch[1];

      let tracker = 'Unknown';
      const trackerMatch = title.match(/⚙️\s*([^\n]+)/);
      if (trackerMatch) tracker = trackerMatch[1].trim();

      categories[quality].push({
        id: stream.infoHash || stream.url,
        infoHash: stream.infoHash,
        parsedQuality: quality,
        seeders,
        size,
        tracker,
        cleanTitle: cleanFileName, 
        rawTitle: title.split('\n').pop() || ''
      });
    });

    Object.keys(categories).forEach(key => {
      categories[key as keyof CategorizedStreams].sort((a, b) => b.seeders - a.seeders);
    });

    if (API_CACHE.size >= CACHE_MAX_SIZE) {
      const oldestKey = API_CACHE.keys().next().value;
      if (oldestKey) API_CACHE.delete(oldestKey); 
    }
    API_CACHE.set(queryKey, { movieTitle: fullMovieTitle, streams: categories, posterUrl });

    setCategorizedStreams(categories);
    
    const availableQualities = QUALITY_CATEGORIES.filter(q => categories[q].length > 0 && selectedQualities[q]);
    if (availableQualities.length > 0) {
      setActiveTab(availableQualities[0]);
    } else {
      setActiveTab('SD/Other');
    }
  };

  const saveToLibrary = async (stream: StreamMetadata) => {
    if (!user || !stream.infoHash || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'library', stream.infoHash);
    await setDoc(docRef, {
      infoHash: stream.infoHash,
      quality: stream.parsedQuality,
      size: stream.size,
      title: stream.rawTitle,
      savedAt: serverTimestamp()
    });
  };

  const videoRef = useRef<HTMLVideoElement | null>(null);

  // HLS.js Player Integration for Stremio-Style Transcoding
  useEffect(() => {
    if (!playingStreamUrl || !videoRef.current) return;

    const isHls = playingStreamUrl.includes('/hls-stream/') || playingStreamUrl.endsWith('.m3u8');

    if (isHls && Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true,
      });
      hls.loadSource(playingStreamUrl);
      hls.attachMedia(videoRef.current);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        videoRef.current?.play().catch(e => console.log('Autoplay prevented:', e));
      });
      return () => {
        hls.destroy();
      };
    } else if (isHls && videoRef.current.canPlayType('application/vnd.apple.mpegurl')) {
      videoRef.current.src = playingStreamUrl;
    }
  }, [playingStreamUrl]);

  const removeFromLibrary = async (infoHash: string) => {
    if (!user || !infoHash || !db) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'library', infoHash);
    await deleteDoc(docRef);
  };

  const playInBrowser = (infoHash: string, title?: string, mode: 'raw' | 'transcode' | 'hls' = 'raw') => {
    let localProxyUrl = `http://localhost:8888/stream/${infoHash}`;
    if (mode === 'transcode') {
      localProxyUrl = `http://localhost:8888/stream-transcoded/${infoHash}`;
    } else if (mode === 'hls') {
      localProxyUrl = `http://localhost:8888/hls-stream/${infoHash}/index.m3u8`;
    }
    setPlayingStreamUrl(localProxyUrl);
    setToastMessage(
      mode === 'hls' 
        ? `HLS Transcoding & Streaming: ${title || infoHash}`
        : mode === 'transcode'
        ? `Transcoding & Streaming: ${title || infoHash}` 
        : `Streaming in Browser: ${title || infoHash}`
    );
    setTimeout(() => setToastMessage(null), PLAYING_TOAST_DURATION);
  };

  const playInVLC = (infoHash: string, title?: string) => {
    setToastMessage(`Triggering VLC for: ${title || infoHash}...`);
    fetch(`http://localhost:8888/play-vlc/${infoHash}`)
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setToastMessage('VLC Player Launched successfully!');
        } else {
          setToastMessage('Failed to launch VLC. Check server logs.');
        }
      })
      .catch(() => {
        setToastMessage('Proxy server not reachable for VLC launch.');
      })
      .finally(() => {
        setTimeout(() => setToastMessage(null), PLAYING_TOAST_DURATION);
      });
  };

  const isSaved = (infoHash: string) => library.some(item => item.infoHash === infoHash);

  if (initError) {
    return <InitErrorScreen error={initError} config={firebaseConfig} />;
  }

  if (!user) return <FullScreenLoader />;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      
      <Header user={user} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Search Bar */}
          <SearchPanel
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchTorrentio={searchTorrentio}
            loading={loading}
            selectedQualities={selectedQualities}
            setSelectedQualities={setSelectedQualities}
            movieTitle={movieTitle}
          />

          {/* Results Area */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Generic Toast Message */}
          {toastMessage && (
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl flex items-center gap-3 animate-pulse">
              <CheckCircle className="w-5 h-5" />
              {toastMessage}
            </div>
          )}

          {/* Skeleton Loader */}
          {loading && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden animate-pulse mt-4">
              <div className="flex border-b border-gray-800">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="flex-1 py-4 flex justify-center border-r border-gray-800/50 last:border-0">
                    <div className="h-4 bg-gray-800 rounded w-16"></div>
                  </div>
                ))}
              </div>
              <div className="divide-y divide-gray-800">
                {[1, 2, 3, 4].map(i => (
                  <div key={i} className="p-4 flex items-center justify-between">
                    <div className="flex-1 pr-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div className="h-5 bg-gray-800 rounded w-12"></div>
                        <div className="h-4 bg-gray-800 rounded w-2/3 max-w-md"></div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="h-3 bg-gray-800 rounded w-20"></div>
                        <div className="h-3 bg-gray-800 rounded w-16"></div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                       <div className="w-9 h-9 bg-gray-800 rounded-full"></div>
                       <div className="w-24 h-9 bg-gray-800 rounded-full"></div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Categorized Results */}
          {!loading && !error && Object.values(categorizedStreams).some(arr => arr.length > 0) && (
            <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
              
              {/* Tabs */}
              <div className="flex border-b border-gray-800">
                {(Object.keys(categorizedStreams) as Array<keyof CategorizedStreams>)
                  .filter(quality => selectedQualities[quality])
                  .map(quality => (
                  <button
                    key={quality}
                    onClick={() => setActiveTab(quality)}
                    className={`flex-1 py-4 text-sm font-medium transition-colors ${
                      activeTab === quality 
                        ? 'text-blue-400 border-b-2 border-blue-400 bg-blue-500/5'
                        : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                    }`}
                  >
                    {quality} ({categorizedStreams[quality]!.length})
                  </button>
                ))}
              </div>

              {/* Stream List */}
              <div className="divide-y divide-gray-800 max-h-[600px] overflow-y-auto">
                {!selectedQualities[activeTab as keyof typeof selectedQualities] ? (
                   <div className="p-8 text-center text-gray-500">This quality is hidden by your filters.</div>
                ) : categorizedStreams[activeTab as keyof CategorizedStreams].length === 0 ? (
                  <div className="p-8 text-center text-gray-500">No streams found for this quality.</div>
                ) : (
                  categorizedStreams[activeTab as keyof CategorizedStreams].map((stream, idx) => (
                    <StreamItem
                      key={`${stream.id || 'stream'}-${idx}`}
                      stream={stream}
                      isSaved={isSaved(stream.infoHash)}
                      onSaveToggle={() => isSaved(stream.infoHash) ? removeFromLibrary(stream.infoHash) : saveToLibrary(stream)}
                      onPlayInBrowser={() => playInBrowser(stream.infoHash, stream.cleanTitle)}
                      onPlayInVLC={() => playInVLC(stream.infoHash, stream.cleanTitle)}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Cloud Library */}
        <div className="space-y-6">
          <SuggestionPanel posterUrl={posterUrl} movieTitle={movieTitle} />
          <LibraryPanel 
            library={library} 
            onRemove={removeFromLibrary} 
            onPlayInBrowser={playInBrowser}
            onPlayInVLC={playInVLC}
          />
          <SystemStatusPanel />
        </div>

      </div>

      {playingStreamUrl && (
          <div className="fixed inset-0 bg-gray-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-gray-900 border border-gray-800 rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden">
                  <div className="flex justify-between items-center p-4 bg-gray-900/80 border-b border-gray-800">
                      <h3 className="text-lg font-semibold text-gray-200">In-Browser Player (Test)</h3>
                      <div className="flex items-center gap-3">
                          {playingStreamUrl && (
                            <button
                              onClick={() => {
                                const infoHash = playingStreamUrl.split('/').pop();
                                if (infoHash) playInVLC(infoHash);
                              }}
                              className="flex items-center gap-1.5 px-3 py-1 bg-orange-500/20 text-orange-400 border border-orange-500/30 hover:bg-orange-500/30 text-xs font-bold rounded-lg transition-colors"
                              title="Open current stream in VLC player"
                            >
                              <ExternalLink className="w-3.5 h-3.5" /> Open in VLC
                            </button>
                          )}
                          <button 
                              onClick={() => setPlayingStreamUrl(null)} 
                              className="text-gray-400 hover:text-white transition-colors rounded-full p-1"
                              aria-label="Close player"
                          >
                              <X size={20} />
                          </button>
                      </div>
                  </div>
                  <div className="p-1 bg-black">
                      <video
                          ref={videoRef}
                          key={playingStreamUrl} // Key forces re-mount on new stream
                          className="w-full aspect-video"
                          controls
                          autoPlay
                          src={playingStreamUrl?.includes('/hls-stream/') ? undefined : (playingStreamUrl || undefined)}
                          onError={(e) => {
                              console.error('Video player error:', e);
                              const matches = playingStreamUrl?.match(/(?:stream|stream-transcoded|hls-stream)\/([a-fA-F0-9]{40})/);
                              const infoHash = matches ? matches[1] : null;

                              if (infoHash && !playingStreamUrl?.includes('/hls-stream/')) {
                                setToastMessage('Browser HTML5 cannot decode container. Switching to Stremio HLS Transcoding...');
                                playInBrowser(infoHash, undefined, 'hls');
                              } else if (infoHash) {
                                setToastMessage('HLS Transcoding failed. Opening stream in VLC...');
                                playInVLC(infoHash);
                              } else {
                                setToastMessage('Failed to load video. Ensure the local Node.js proxy is running.');
                              }
                          }}
                      >
                          Your browser does not support the video tag.
                      </video>
                  </div>
                  <div className="p-4 text-xs text-gray-500 bg-gray-900/50 flex items-center justify-between">
                      <div>
                          <p><strong>Note:</strong> Browsers natively play MP4/WebM. For MKV/AVI/AC3 streams, the proxy will transcode on-the-fly, or you can use VLC for native hardware decoding.</p>
                          <p className="mt-1 font-mono bg-gray-800 p-1.5 rounded-md text-[11px] text-gray-400">{playingStreamUrl}</p>
                      </div>
                      {playingStreamUrl && (
                        <button
                          onClick={() => {
                            const infoHash = playingStreamUrl.split('/').pop();
                            if (infoHash) playInVLC(infoHash);
                          }}
                          className="px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white font-bold rounded-lg text-xs shrink-0 ml-4 transition-colors"
                        >
                          Launch in VLC
                        </button>
                      )}
                  </div>
              </div>
          </div>
      )}
    </div>
  );
}