import React from 'react';
import { Play, Heart, Users, HardDrive } from 'lucide-react';
import type { StreamMetadata } from '../types';

interface StreamItemProps {
  stream: StreamMetadata;
  isSaved: boolean;
  onSaveToggle: () => void;
  onPlay: () => void;
}

export const StreamItem = React.memo<StreamItemProps>(({ stream, isSaved, onSaveToggle, onPlay }) => (
  <div className="p-4 hover:bg-gray-800/50 transition-colors flex items-center justify-between group">
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
        onClick={onSaveToggle}
        className={`p-2 rounded-full border transition-colors ${isSaved
            ? 'bg-red-500/10 border-red-500/20 text-red-500 hover:bg-red-500/20'
            : 'border-gray-700 text-gray-400 hover:text-white hover:border-gray-500'
          }`}
        title={isSaved ? "Remove from Library" : "Save to Library"}
      >
        <Heart className="w-4 h-4" fill={isSaved ? "currentColor" : "none"} />
      </button>
      <button
        onClick={onPlay}
        className="flex items-center gap-2 bg-white text-black px-4 py-2 rounded-full font-bold hover:bg-gray-200 transition-colors"
      >
        <Play className="w-4 h-4 fill-black" /> Play
      </button>
    </div>
  </div>
));