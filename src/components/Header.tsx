import React from 'react';
import { MonitorPlay } from 'lucide-react';
import type { User } from 'firebase/auth';

interface HeaderProps {
  user: User;
}

export const Header: React.FC<HeaderProps> = ({ user }) => (
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
);