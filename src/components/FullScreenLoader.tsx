import React from 'react';
import { Loader2 } from 'lucide-react';

export const FullScreenLoader: React.FC = () => (
  <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
    <Loader2 className="w-8 h-8 animate-spin" />
  </div>
);