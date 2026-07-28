import React from 'react';
import { Heart } from 'lucide-react';
import { LibraryItemCard } from './LibraryItemCard';
import type { LibraryItem } from '../types';

interface LibraryPanelProps {
  library: LibraryItem[];
  onRemove: (infoHash: string) => void;
  onPlayInBrowser: (infoHash: string, title: string) => void;
  onPlayInVLC: (infoHash: string, title: string) => void;
}

export const LibraryPanel: React.FC<LibraryPanelProps> = ({ 
  library, 
  onRemove, 
  onPlayInBrowser, 
  onPlayInVLC 
}) => (
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
          <LibraryItemCard 
            key={item.id} 
            item={item} 
            onRemove={() => onRemove(item.infoHash)} 
            onPlayInBrowser={() => onPlayInBrowser(item.infoHash, item.title)}
            onPlayInVLC={() => onPlayInVLC(item.infoHash, item.title)}
          />
        ))}
      </div>
    )}
  </div>
);