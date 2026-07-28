import React from 'react';
import { Trash2, Tv, ExternalLink } from 'lucide-react';
import type { LibraryItem } from '../types';

interface LibraryItemCardProps {
  item: LibraryItem;
  onRemove: () => void;
  onPlayInBrowser: () => void;
  onPlayInVLC: () => void;
}

export const LibraryItemCard = React.memo<LibraryItemCardProps>(({ 
  item, 
  onRemove, 
  onPlayInBrowser, 
  onPlayInVLC 
}) => (
  <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 flex items-center justify-between group">
    <div className="flex-1 min-w-0 pr-3">
      <span className="inline-block px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-bold mb-1">
        {item.quality}
      </span>
      <p className="text-sm text-gray-300 truncate" title={item.title}>{item.title}</p>
      <p className="text-xs text-gray-500 mt-0.5">{item.size}</p>
    </div>
    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={onPlayInBrowser}
        className="p-1.5 text-gray-300 hover:text-white bg-gray-700/50 hover:bg-gray-700 rounded transition-colors"
        title="Play in Browser"
      >
        <Tv className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onPlayInVLC}
        className="p-1.5 text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded transition-colors"
        title="Play in VLC"
      >
        <ExternalLink className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={onRemove}
        className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
        title="Remove from Library"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  </div>
));