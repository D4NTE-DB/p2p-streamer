import React, { useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import { toggleQuality, setMaxSizeGb, setAudioLanguage, setRequireSubtitles } from '../store/configSlice';
import { Settings, Shield, HardDrive, Filter, Database, Volume2, Subtitles } from 'lucide-react';
import { QUALITY_CATEGORIES } from '../constants';
import { SystemStatusPanel } from '../components/SystemStatusPanel';

export const Configuration: React.FC = () => {
  const dispatch = useDispatch();
  const { selectedQualities, maxSizeGb, audioLanguage, requireSubtitles } = useSelector((state: RootState) => state.config);
  const [proxyTestResult, setProxyTestResult] = useState<string>('');

  const testProxy = async () => {
    try {
      setProxyTestResult('Testing...');
      const res = await fetch('http://localhost:8888/status');
      if (res.ok) setProxyTestResult('Connected & Active');
      else setProxyTestResult('Error connecting to proxy');
    } catch {
      setProxyTestResult('Offline (Make sure Node proxy is running)');
    }
  };

  return (
    <div className="max-w-4xl mx-auto pb-12">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-8 h-8 text-blue-500" />
        <h1 className="text-3xl font-bold text-gray-100">Configuration</h1>
      </div>

      <div className="grid gap-8">
        
        {/* Quality Settings */}
        <section className="bg-gray-900 border border-gray-800 p-6 rounded-xl shadow-md">
          <div className="flex items-center gap-2 mb-6 border-b border-gray-800 pb-4">
            <Filter className="w-5 h-5 text-purple-400" />
            <h2 className="text-xl font-semibold text-gray-200">Default Stream Qualities</h2>
          </div>
          <div className="flex gap-4 flex-wrap">
            {QUALITY_CATEGORIES.map(quality => (
              <label 
                key={quality}
                className={`flex items-center gap-3 px-5 py-3 rounded-lg border cursor-pointer transition-all ${
                  selectedQualities[quality] 
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400' 
                    : 'border-gray-700 bg-gray-800/50 text-gray-400 hover:border-gray-600'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedQualities[quality]}
                  onChange={() => dispatch(toggleQuality(quality))}
                  className="w-4 h-4 rounded border-gray-700 text-blue-500 focus:ring-blue-600 focus:ring-offset-gray-900 bg-gray-800"
                />
                <span className="font-medium">{quality}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Audio & Subtitle Settings */}
        <section className="bg-gray-900 border border-gray-800 p-6 rounded-xl shadow-md">
          <div className="flex items-center gap-2 mb-6 border-b border-gray-800 pb-4">
            <Volume2 className="w-5 h-5 text-pink-400" />
            <h2 className="text-xl font-semibold text-gray-200">Audio & Subtitle Preferences</h2>
          </div>
          
          <div className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">Preferred Audio Language</label>
              <div className="flex gap-3 flex-wrap">
                {[
                  { id: 'all', label: '🌍 Any / All' },
                  { id: 'en', label: '🇺🇸 English' },
                  { id: 'es', label: '🇲🇽🇪🇸 Español' }
                ].map(lang => (
                  <button
                    key={lang.id}
                    onClick={() => dispatch(setAudioLanguage(lang.id))}
                    className={`px-4 py-2 rounded-lg text-sm font-bold transition-all border ${
                      audioLanguage === lang.id
                        ? 'bg-pink-600/20 border-pink-500 text-pink-400 shadow-md'
                        : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
                    }`}
                  >
                    {lang.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-4 border-t border-gray-800">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={requireSubtitles}
                  onChange={(e) => dispatch(setRequireSubtitles(e.target.checked))}
                  className="w-5 h-5 rounded border-gray-700 text-pink-500 focus:ring-pink-600 focus:ring-offset-gray-900 bg-gray-800"
                />
                <div className="flex flex-col">
                  <span className="font-medium text-gray-200 flex items-center gap-2">
                    <Subtitles className="w-4 h-4 text-gray-400" /> Require Subtitles
                  </span>
                  <span className="text-xs text-gray-400">Only show torrents that explicitly mention subtitles (SUB, VOSE, etc)</span>
                </div>
              </label>
            </div>
          </div>
        </section>

        {/* Max File Size Filter */}
        <section className="bg-gray-900 border border-gray-800 p-6 rounded-xl shadow-md">
          <div className="flex items-center justify-between mb-6 border-b border-gray-800 pb-4">
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-blue-400" />
              <h2 className="text-xl font-semibold text-gray-200">Maximum Torrent Size</h2>
            </div>
            <span className="px-3 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded-full text-sm font-bold">
              Max: {maxSizeGb} GB
            </span>
          </div>

          <div className="flex flex-col gap-4">
            <p className="text-sm text-gray-400">
              Filter out torrent streams larger than this threshold. Remaining streams are prioritized by seeders/peers.
            </p>
            <input 
              type="range" 
              min={1} 
              max={100} 
              step={1}
              value={maxSizeGb}
              onChange={(e) => dispatch(setMaxSizeGb(Number(e.target.value)))}
              className="w-full h-2 bg-gray-800 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-gray-500 font-mono">
              <span>1 GB</span>
              <span>10 GB</span>
              <span>25 GB</span>
              <span>50 GB</span>
              <span>100 GB</span>
            </div>
          </div>
        </section>

        {/* System / Proxy Engine */}
        <section className="bg-gray-900 border border-gray-800 p-6 rounded-xl shadow-md">
          <div className="flex items-center gap-2 mb-6 border-b border-gray-800 pb-4">
            <HardDrive className="w-5 h-5 text-green-400" />
            <h2 className="text-xl font-semibold text-gray-200">Local Proxy Engine</h2>
          </div>
          
          <div className="flex gap-4 items-center mb-6">
            <button 
              onClick={testProxy}
              className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-lg border border-gray-700 transition-colors"
            >
              Test Connection
            </button>
            {proxyTestResult && (
              <span className={`text-sm font-medium ${proxyTestResult.includes('Active') ? 'text-green-400' : 'text-red-400'}`}>
                {proxyTestResult}
              </span>
            )}
          </div>

          <SystemStatusPanel />
        </section>

      </div>
    </div>
  );
};
