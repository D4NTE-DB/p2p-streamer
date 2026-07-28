import React from 'react';
import { Trash2 } from 'lucide-react';
import type { LibraryItem } from '../types';

interface LibraryItemCardProps {
  item: LibraryItem;
  onRemove: () => void;
}

export const LibraryItemCard = React.memo<LibraryItemCardProps>(({ item, onRemove }) => (
  <div className="bg-gray-800/50 p-3 rounded-lg border border-gray-700/50 relative group">
    <div className="pr-8">
      <span className="inline-block px-2 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-bold mb-1">
        {item.quality}
      </span>
      <p className="text-sm text-gray-300 truncate" title={item.title}>{item.title}</p>
      <p className="text-xs text-gray-500 mt-1">{item.size}</p>
    </div>
    <button
      onClick={onRemove}
      className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors opacity-0 group-hover:opacity-100"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  </div>
));