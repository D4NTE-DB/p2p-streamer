import React from 'react';

interface InitErrorScreenProps {
  error: string;
  config: Record<string, string | undefined>;
}

export const InitErrorScreen: React.FC<InitErrorScreenProps> = ({ error, config }) => (
  <div className="flex min-h-screen items-center justify-center bg-gray-950 text-gray-100 p-6">
    <div className="max-w-xl w-full rounded-3xl border border-red-500/20 bg-gray-900/90 p-8 shadow-xl">
      <h1 className="text-2xl font-semibold text-red-300 mb-4">Firebase initialization error</h1>
      <p className="text-sm text-gray-300 leading-relaxed mb-4">{error}</p>
      <p className="text-sm text-gray-400 mb-6">Verify your `.env` Firebase config values and restart the dev server.</p>
      <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 text-sm text-red-100">
        <strong>Env keys used:</strong>
        <ul className="mt-2 list-disc list-inside text-gray-300">
          {Object.keys(config).map(key => (
            <li key={key}>{key}: {config[key as keyof typeof config] ? 'set' : 'missing'}</li>
          ))}
        </ul>
      </div>
    </div>
  </div>
);