import type { FieldValue, Timestamp } from 'firebase/firestore';

export interface StreamMetadata {
  id: string;
  infoHash: string;
  fileIdx?: number;
  parsedQuality: string;
  seeders: number;
  size: string;
  tracker: string;
  cleanTitle: string;
  rawTitle: string;
}

export interface CategorizedStreams {
  '4K': StreamMetadata[];
  '1080p': StreamMetadata[];
  '720p': StreamMetadata[];
  'SD/Other': StreamMetadata[];
  [key: string]: StreamMetadata[]; // Index signature for dynamic access
}

export interface TorrentioStream {
  title: string;
  name: string;
  infoHash: string;
  fileIdx?: number;
  url: string;
}

export interface LibraryItem {
  id: string;
  infoHash: string;
  quality: string;
  size: string;
  title: string;
  savedAt?: Timestamp | FieldValue;
}

export interface CachedSearch {
  movieTitle: string;
  streams: CategorizedStreams;
  posterUrl: string;
}