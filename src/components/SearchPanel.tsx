import React from 'react';
import { Search, Loader2, Film } from 'lucide-react';

interface SearchPanelProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchTorrentio: (e: React.FormEvent) => void;
  loading: boolean;
  selectedQualities: Record<string, boolean>;
  setSelectedQualities: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  movieTitle: string;
}

export const SearchPanel: React.FC<SearchPanelProps> = ({
  searchQuery,
  setSearchQuery,
  searchTorrentio,
  loading,
  selectedQualities,
  setSelectedQualities,
  movieTitle
}) => (
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

    {movieTitle && (
      <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3">
        <Film className="w-5 h-5 text-blue-400" />
        <span className="text-blue-100 font-medium">Found Media: {movieTitle}</span>
      </div>
    )}
  </div>
);