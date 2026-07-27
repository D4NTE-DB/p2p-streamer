import React, { useState, useEffect } from 'react';
import { 
  Search, Play, Heart, Trash2, HardDrive, Users, Settings, 
  CheckCircle, AlertCircle, Loader2, MonitorPlay, Film
} from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, type User } from 'firebase/auth';
import { 
  getFirestore, collection, doc, setDoc, deleteDoc, 
  onSnapshot, query, serverTimestamp, type FieldValue, type Timestamp
} from 'firebase/firestore';

// --- TYPESCRIPT INTERFACES ---
interface StreamMetadata {
  id: string;
  infoHash: string;
  parsedQuality: string;
  seeders: number;
  size: string;
  tracker: string;
  cleanTitle: string;
  rawTitle: string;
}

interface CategorizedStreams {
  '4K': StreamMetadata[];
  '1080p': StreamMetadata[];
  '720p': StreamMetadata[];
  'SD/Other': StreamMetadata[];
  [key: string]: StreamMetadata[]; // Index signature for dynamic access
}

interface TorrentioStream {
  title: string;
  name: string;
  infoHash: string;
  url: string;
}

interface LibraryItem {
  id: string;
  infoHash: string;
  quality: string;
  size: string;
  title: string;
  savedAt?: Timestamp | FieldValue;
}

interface CachedSearch {
  movieTitle: string;
  streams: CategorizedStreams;
}

// Global declarations for environment variables injected by the platform
declare global {
  var __initial_auth_token: string | undefined;
}

// --- CONSTANTS ---
const CINEMETA_API_URL = 'https://v3-cinemeta.strem.io';
const TORRENTIO_API_URL = 'https://torrentio.strem.fun';
const QUALITY_CATEGORIES: (keyof CategorizedStreams)[] = ['4K', '1080p', '720p', 'SD/Other'];
const PLAYING_TOAST_DURATION = 3000;

// --- FIREBASE INITIALIZATION ---
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = import.meta.env.VITE_APP_ID || 'p2p-streaming-app';

// --- IN-MEMORY METADATA CACHE ---
const API_CACHE = new Map<string, CachedSearch>();
const CACHE_MAX_SIZE = 20; // Cap at 20 recent searches

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [library, setLibrary] = useState<LibraryItem[]>([]);
  
  // Torrentio State
  const [searchQuery, setSearchQuery] = useState<string>('The Matrix'); 
  const [movieTitle, setMovieTitle] = useState<string>(''); 
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');
  const [categorizedStreams, setCategorizedStreams] = useState<CategorizedStreams>({ '4K': [], '1080p': [], '720p': [], 'SD/Other': [] });
  
  // UI State
  const [activeTab, setActiveTab] = useState<string | number>('1080p');
  const [playingStream, setPlayingStream] = useState<StreamMetadata | null>(null);
  
  // Quality Filters State
  const [selectedQualities, setSelectedQualities] = useState<Record<string, boolean>>({
    '4K': true,
    '1080p': true,
    '720p': true,
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
      if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
        await signInWithCustomToken(auth, __initial_auth_token).catch(() => signInAnonymously(auth));
      } else {
        await signInAnonymously(auth);
      }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. Fetch User Library (CRUD - Read)
  useEffect(() => {
    if (!user) return;
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
    setCategorizedStreams({ '4K': [], '1080p': [], '720p': [], 'SD/Other': [] });

    try {
      let targetImdbId = searchQuery.trim();
      let expectedTitle = '';
      let expectedYear = '';

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
          }
        } catch (err) {
          console.warn("Could not fetch Cinemeta info, skipping title validation.");
        }
      }
      
      const fullMovieTitle = expectedYear ? `${expectedTitle} (${expectedYear})` : expectedTitle;
      setMovieTitle(fullMovieTitle);

      const res = await fetch(`${TORRENTIO_API_URL}/stream/movie/${targetImdbId}.json`);
      if (!res.ok) throw new Error('Failed to fetch from Torrentio');
      
      const data = await res.json();
      if (!data.streams || data.streams.length === 0) {
        throw new Error('No streams found for this movie.');
      }

      processStreams(data.streams || [], expectedTitle, queryKey, fullMovieTitle);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'An unknown network error occurred.');
    } finally {
      setLoading(false);
    }
  };

  // 4. Organize by Quality and sort by Seeders
  const processStreams = (streams: TorrentioStream[], expectedTitle: string, queryKey: string, fullMovieTitle: string) => {
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

    Object.keys(categories).forEach(q => {
      categories[q].sort((a, b) => b.seeders - a.seeders);
    });

    if (API_CACHE.size >= CACHE_MAX_SIZE) {
      const oldestKey = API_CACHE.keys().next().value;
      if (oldestKey) API_CACHE.delete(oldestKey); 
    }
    API_CACHE.set(queryKey, { movieTitle: fullMovieTitle, streams: categories });

    setCategorizedStreams(categories);
    
    const availableQualities = QUALITY_CATEGORIES.filter(q => categories[q].length > 0 && selectedQualities[q]);
    if (availableQualities.length > 0) {
      setActiveTab(availableQualities[0]);
    } else {
      setActiveTab('SD/Other');
    }
  };

  const saveToLibrary = async (stream: StreamMetadata) => {
    if (!user || !stream.infoHash) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'library', stream.infoHash);
    await setDoc(docRef, {
      infoHash: stream.infoHash,
      quality: stream.parsedQuality,
      size: stream.size,
      title: stream.rawTitle,
      savedAt: serverTimestamp()
    });
  };

  const removeFromLibrary = async (infoHash: string) => {
    if (!user || !infoHash) return;
    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'library', infoHash);
    await deleteDoc(docRef);
  };

  const playLocally = (stream: StreamMetadata) => {
    setPlayingStream(stream);
    setTimeout(() => setPlayingStream(null), PLAYING_TOAST_DURATION); 
  };

  const isSaved = (infoHash: string) => library.some(item => item.infoHash === infoHash);

  if (!user) return <div className="flex h-screen items-center justify-center bg-gray-900 text-white"><Loader2 className="w-8 h-8 animate-spin" /></div>;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6 font-sans">
      
      {/* Header & User Info */}
      <header className="flex justify-between items-center mb-8 bg-gray-900 p-4 rounded-xl border border-gray-800 shadow-lg">
        <div className="flex items-center gap-3">
          <MonitorPlay className="w-8 h-8 text-blue-500" />
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">P2P Streamer</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-sm text-gray-400">
            User ID: <span className="text-gray-300 font-mono text-xs">{user.uid.slice(0, 8)}...</span>
          </div>
          <span className="px-3 py-1 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 rounded-full text-xs font-medium">
            Pro Plan (Active)
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Main Content Area */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Search Bar */}
          <div className="bg-gray-900 p-6 rounded-xl border border-gray-800">
            <h2 className="text-lg font-semibold mb-4">Search via Torrentio</h2>
            <form onSubmit={searchTorrentio} className="flex gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-5 h-5" />
                <input 
                  type="text" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Movie title (e.g. Inception) or IMDB ID (e.g. tt1375666)"
                  className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
              <button 
                type="submit" 
                disabled={loading}
                className="bg-blue-600 hover:bg-blue-500 text-white px-6 py-3 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Scrape'}
              </button>
            </form>
            <p className="text-xs text-gray-500 mt-3">Try: tt1630029 (Avatar 2), tt0111161 (Shawshank Redemption)</p>
            
            {/* Quality Filters */}
            <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-gray-800 pt-4">
              <span className="text-sm text-gray-400 font-medium">Show Qualities:</span>
              {Object.keys(selectedQualities).map(q => (
                <label key={q} className="flex items-center gap-2 cursor-pointer text-sm text-gray-300 hover:text-white transition-colors">
                  <input 
                    type="checkbox" 
                    checked={selectedQualities[q]}
                    onChange={() => setSelectedQualities(prev => ({ ...prev, [q]: !prev[q] }))}
                    className="w-4 h-4 rounded bg-gray-900 border-gray-700 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900 cursor-pointer accent-blue-600"
                  />
                  {q}
                </label>
              ))}
            </div>

            {/* Display Found Movie Title */}
            {movieTitle && (
              <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3">
                <Film className="w-5 h-5 text-blue-400" />
                <span className="text-blue-100 font-medium">Found Media: {movieTitle}</span>
              </div>
            )}
          </div>

          {/* Results Area */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-xl flex items-center gap-3">
              <AlertCircle className="w-5 h-5" />
              {error}
            </div>
          )}

          {/* Playing Simulation Toast */}
          {playingStream && (
            <div className="bg-green-500/10 border border-green-500/20 text-green-400 p-4 rounded-xl flex items-center gap-3 animate-pulse">
              <CheckCircle className="w-5 h-5" />
              Sending InfoHash to Local Node.js Proxy (Port 8080)... Opening VLC!
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
                {Object.keys(categorizedStreams)
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
                    {quality} ({categorizedStreams[quality].length})
                  </button>
                ))}
              </div>

              {/* Stream List */}
              <div className="divide-y divide-gray-800 max-h-[600px] overflow-y-auto">
                {!selectedQualities[activeTab] ? (
                   <div className="p-8 text-center text-gray-500">This quality is hidden by your filters.</div>
                ) : categorizedStreams[activeTab].length === 0 ? (
                  <div className="p-8 text-center text-gray-500">No streams found for this quality.</div>
                ) : (
                  categorizedStreams[activeTab].map((stream, idx) => (
                    <div key={`${stream.id || 'stream'}-${idx}`} className="p-4 hover:bg-gray-800/50 transition-colors flex items-center justify-between group">
                      
                      <div className="flex-1 min-w-0 pr-4">
                        <div className="mb-2">
                          <span className="text-sm font-semibold text-gray-200 block truncate" title={stream.cleanTitle}>
                            {stream.cleanTitle}
                          </span>
                        </div>
                        
                        <div className="flex items-center gap-4 text-sm">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-800 text-gray-300">
                            {stream.tracker}
                          </span>
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
                          onClick={() => isSaved(stream.infoHash) ? removeFromLibrary(stream.infoHash) : saveToLibrary(stream)}
                          className={`p-2 rounded-full border transition-colors ${
                            isSaved(stream.infoHash)
                              ? 'bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20'
                              : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
                          }`}
                          title={isSaved(stream.infoHash) ? "Remove from Library" : "Save to Library"}
                        >
                          <Heart className="w-4 h-4" fill={isSaved(stream.infoHash) ? "currentColor" : "none"} />
                        </button>
                        <button 
                          onClick={() => playLocally(stream)}
                          className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-full font-bold hover:bg-gray-200 transition-colors"
                        >
                          <Play className="w-4 h-4 fill-black" /> Play
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        {/* Sidebar: Cloud Library */}
        <div className="space-y-6">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
            <div className="flex items-center gap-2 mb-6 text-gray-100">
              <Heart className="w-5 h-5 text-red-500 fill-red-500" />
              <h2 className="text-lg font-semibold">Cloud Library</h2>
            </div>
            
            {library.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-8">
                Your library is empty. Save streams here to sync across devices.
              </p>
            ) : (
              <div className="space-y-3">
                {library.map(item => (
                  <div key={item.id} className="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 relative group">
                    <div className="pr-8">
                      <span className="inline-block px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-bold mb-1">
                        {item.quality}
                      </span>
                      <p className="text-sm text-gray-300 truncate" title={item.title}>{item.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{item.size}</p>
                    </div>
                    <button 
                      onClick={() => removeFromLibrary(item.id)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {/* Architecture Reminder Panel */}
          <div className="bg-blue-900/20 rounded-xl border border-blue-500/20 p-5 text-sm text-blue-200/80">
            <div className="flex items-center gap-2 text-blue-400 mb-2 font-semibold">
              <Settings className="w-4 h-4" />
              System Status
            </div>
            <ul className="space-y-1.5 ml-5 list-disc">
              <li>Node.js Local Proxy: <span className="text-gray-400">Awaiting InfoHash</span></li>
              <li>RAM Buffer: <span className="text-gray-400">Idle (0 MB)</span></li>
              <li>Seeding Policy: <span className="text-green-400">Adaptive (Active)</span></li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}