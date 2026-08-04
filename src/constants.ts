import type { CategorizedStreams } from './types';

export const CINEMETA_API_URL = 'https://v3-cinemeta.strem.io';
export const PROXY_BASE_URL = import.meta.env.VITE_PROXY_URL || 'http://localhost:8888';
export const TORRENTIO_API_URL = `${PROXY_BASE_URL}/api/torrentio`;
export const QUALITY_CATEGORIES: (keyof CategorizedStreams)[] = ['4K', '1080p', '720p', 'SD/Other'];
export const PLAYING_TOAST_DURATION = 5000;
export const CACHE_MAX_SIZE = 20; // Cap at 20 recent searches