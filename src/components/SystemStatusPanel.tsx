import React from 'react';
import { Settings } from 'lucide-react';

export const SystemStatusPanel: React.FC = () => (
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
);