import React from 'react';

interface SuggestionPanelProps {
  posterUrl: string;
  movieTitle: string;
}

export const SuggestionPanel: React.FC<SuggestionPanelProps> = ({ posterUrl, movieTitle }) => {
  if (!posterUrl) {
    return null; // Don't render if there's no poster
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <h2 className="text-base font-semibold mb-4 text-gray-200">Suggested Media</h2>
      <div className="relative aspect-[3/4] w-full rounded-lg overflow-hidden group shadow-lg">
        <img 
          src={posterUrl} 
          alt={`Poster for ${movieTitle}`} 
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent p-4">
          <h3 className="text-white font-bold text-lg truncate" title={movieTitle}>
            {movieTitle}
          </h3>
        </div>
      </div>
    </div>
  );
};