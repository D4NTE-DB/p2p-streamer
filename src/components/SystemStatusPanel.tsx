import React from 'react';
import { Settings, Activity, Wifi, ShieldCheck, Film } from 'lucide-react';
import { useSelector } from 'react-redux';
import type { RootState } from '../store';

export const SystemStatusPanel: React.FC = () => {
  const { stats, isOnline } = useSelector((state: RootState) => state.telemetry);



  const activeTorrent = stats?.torrents && stats.torrents.length > 0 ? stats.torrents[stats.torrents.length - 1] : null;

  return (
    <div className="bg-blue-900/20 rounded-xl border border-blue-500/20 p-5 text-sm text-blue-200/80 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-blue-400 font-semibold">
          <Settings className="w-4 h-4" />
          System & Telemetry Status
        </div>
        <div className="flex items-center gap-1.5 text-xs font-bold">
          <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-400 animate-pulse' : 'bg-red-500'}`} />
          <span className={isOnline ? 'text-green-400' : 'text-red-400'}>
            {isOnline ? 'Proxy Online' : 'Proxy Offline'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
        <div className="bg-gray-900/60 p-2.5 rounded-lg border border-gray-800">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Activity className="w-3.5 h-3.5 text-blue-400" /> Download Speed
          </div>
          <p className="text-sm font-bold text-white font-mono">
            {isOnline ? (stats?.downloadSpeed || '0 B/s') : 'N/A'}
          </p>
        </div>
        <div className="bg-gray-900/60 p-2.5 rounded-lg border border-gray-800">
          <div className="flex items-center gap-1.5 text-gray-400 mb-1">
            <Wifi className="w-3.5 h-3.5 text-green-400" /> Active Swarm Peers
          </div>
          <p className="text-sm font-bold text-white font-mono">
            {isOnline ? (activeTorrent ? `${activeTorrent.numPeers} Peers` : 'Idle (0)') : 'N/A'}
          </p>
        </div>
      </div>

      {activeTorrent && (
        <div className="bg-gray-900/60 p-2.5 rounded-lg border border-gray-800 text-xs space-y-1 font-mono">
          <div className="flex items-center gap-1.5 text-blue-300 font-sans font-semibold truncate">
            <Film className="w-3.5 h-3.5 text-orange-400 shrink-0" />
            <span className="truncate">{activeTorrent.fileName}</span>
          </div>
          <div className="flex justify-between text-gray-400 pt-1">
            <span>Buffer Progress:</span>
            <span className="text-green-400 font-bold">{activeTorrent.progress}%</span>
          </div>
          <div className="flex justify-between text-gray-400">
            <span>Container Format:</span>
            <span className="text-gray-200">{activeTorrent.mimeType}</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-gray-400 pt-1 border-t border-blue-500/10">
        <ShieldCheck className="w-3.5 h-3.5 text-blue-400" />
        <span>Seeding Policy: <strong className="text-green-400">Adaptive Read-Ahead</strong></span>
      </div>
    </div>
  );
};