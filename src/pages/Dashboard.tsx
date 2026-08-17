import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, TrendingUp, Subtitles } from 'lucide-react';
import { CINEMETA_API_URL, PROXY_BASE_URL } from '../constants';

import type { CinemetaMovie } from '../types';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';
import { Clock } from 'lucide-react';

export const Dashboard: React.FC = () => {
  const [movies, setMovies] = useState<CinemetaMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cachedSubIds, setCachedSubIds] = useState<Set<string>>(new Set());
  const navigate = useNavigate();
  const recentStreams = useSelector((state: RootState) => state.player.recentStreams);

  useEffect(() => {
    const fetchTopMovies = async () => {
      try {
        const res = await fetch(`${CINEMETA_API_URL}/catalog/movie/top.json`);
        if (!res.ok) throw new Error('Failed to fetch trending movies');
        const data = await res.json();
        setMovies(data.metas || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchTopMovies();
  }, []);

  useEffect(() => {
    const fetchCachedSubtitles = async () => {
      try {
        const res = await fetch(`${PROXY_BASE_URL}/api/subtitles/cache-stats`);
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.cache?.cachedImdbIds)) {
            setCachedSubIds(new Set(data.cache.cachedImdbIds));
          }
        }
      } catch {
        // Non-critical, fail gracefully
      }
    };
    fetchCachedSubtitles();
  }, []);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-red-400 bg-red-500/10 rounded-xl border border-red-500/20">
        <h2 className="text-xl font-bold mb-2">Error Loading Dashboard</h2>
        <p>{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto pb-12">
      {recentStreams.length > 0 && (
        <div className="mb-12">
          <div className="flex items-center gap-3 mb-8">
            <Clock className="w-8 h-8 text-blue-500" />
            <h1 className="text-3xl font-bold text-gray-100">Recently Played</h1>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
            {recentStreams.map((stream) => (
              <div 
                key={stream.infoHash}
                onClick={() => navigate(`/stream/${stream.imdbId}?title=${encodeURIComponent(stream.title)}&poster=${encodeURIComponent(stream.poster || '')}`)}
                className="group relative rounded-xl overflow-hidden cursor-pointer bg-gray-900 border border-gray-800 transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-1"
              >
                <div className="aspect-[3/4] w-full bg-gray-800 relative">
                  {stream.poster ? (
                    <img 
                      src={stream.poster} 
                      alt={stream.title} 
                      className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-600 font-bold p-4 text-center">
                      {stream.title}
                    </div>
                  )}
                  {/* Subtitles Badge */}
                  {stream.imdbId && cachedSubIds.has(stream.imdbId) && (
                    <div 
                      className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-gray-950/80 backdrop-blur border border-blue-500/40 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded shadow"
                      title="Subtitles Available"
                    >
                      <Subtitles className="w-3 h-3" />
                      CC
                    </div>
                  )}
                  {/* Play Overlay */}
                  <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <div className="bg-blue-600 text-white rounded-full p-4 transform translate-y-4 group-hover:translate-y-0 transition-all">
                      <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                  </div>
                </div>
                
                <div className="p-3">
                  <h3 className="text-sm font-bold text-gray-200 truncate" title={stream.title}>{stream.title}</h3>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 mb-8">
        <TrendingUp className="w-8 h-8 text-purple-500" />
        <h1 className="text-3xl font-bold text-gray-100">Trending Movies</h1>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
        {movies.map((movie) => (
          <div 
            key={movie.id}
            onClick={() => navigate(`/stream/${movie.id}?title=${encodeURIComponent(movie.name)}&poster=${encodeURIComponent(movie.poster)}`)}
            className="group relative rounded-xl overflow-hidden cursor-pointer bg-gray-900 border border-gray-800 transition-all hover:border-blue-500/50 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-1"
          >
            <div className="aspect-[2/3] w-full bg-gray-800 relative">
              {movie.poster ? (
                <img 
                  src={movie.poster} 
                  alt={movie.name} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-600 font-bold p-4 text-center">
                  {movie.name}
                </div>
              )}
              {/* Subtitles Badge */}
              {cachedSubIds.has(movie.id) && (
                <div 
                  className="absolute top-2 left-2 z-10 flex items-center gap-1 bg-gray-950/80 backdrop-blur border border-blue-500/40 text-blue-400 text-[10px] font-bold px-1.5 py-0.5 rounded shadow"
                  title="Subtitles Available"
                >
                  <Subtitles className="w-3 h-3" />
                  CC
                </div>
              )}
              {/* Play Overlay */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <div className="bg-blue-600 text-white rounded-full p-4 transform translate-y-4 group-hover:translate-y-0 transition-all">
                  <svg className="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                </div>
              </div>
            </div>
            
            <div className="p-3">
              <h3 className="text-sm font-bold text-gray-200 truncate" title={movie.name}>{movie.name}</h3>
              <p className="text-xs text-gray-500 mt-1">{movie.year}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
