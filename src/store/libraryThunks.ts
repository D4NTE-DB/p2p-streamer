import { createAsyncThunk } from '@reduxjs/toolkit';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { StreamMetadata } from '../types';
import type { RootState } from './index';
import { setPlayingStream } from './playerSlice';
import { PROXY_BASE_URL } from '../constants';

const appId = import.meta.env.VITE_APP_ID || 'p2p-streaming-app';

export const saveStreamToLibrary = createAsyncThunk(
  'library/saveStream',
  async (stream: StreamMetadata, { getState }) => {
    const state = getState() as RootState;
    const user = state.auth.user;
    if (!user || !stream.infoHash || !db) return;

    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'library', stream.infoHash);
    await setDoc(docRef, {
      infoHash: stream.infoHash,
      title: stream.cleanTitle,
      size: stream.size,
      rawTitle: stream.rawTitle,
      savedAt: serverTimestamp(),
    });
  }
);

export const removeStreamFromLibrary = createAsyncThunk(
  'library/removeStream',
  async (infoHash: string, { getState }) => {
    const state = getState() as RootState;
    const user = state.auth.user;
    if (!user || !infoHash || !db) return;

    const docRef = doc(db, 'artifacts', appId, 'users', user.uid, 'library', infoHash);
    await deleteDoc(docRef);
  }
);

export const launchStreamPlayback = createAsyncThunk(
  'player/launchPlayback',
  async ({ infoHash, title, poster, imdbId }: { infoHash: string, title?: string, poster?: string, imdbId?: string }, { dispatch }) => {
    // 1. Dispatch instantly with empty URL to mount Vidstack and show its native loading spinner
    dispatch(setPlayingStream({ url: '', infoHash, title, poster, imdbId }));

    // Default to HLS transcode on error or timeout to prevent browser decode failures for MKV/HEVC
    let targetUrl = `${PROXY_BASE_URL}/hls-stream/${infoHash}/index.m3u8`;

    try {
      const controller = new AbortController();
      // 15-second timeout allows backend enough time to discover peers and get true content-type
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const res = await fetch(`${PROXY_BASE_URL}/stream/${infoHash}`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      
      // If it's explicitly an MP4 or WebM, it can be streamed directly
      if (
        contentType.includes('mp4') ||
        contentType.includes('webm')
      ) {
        targetUrl = `${PROXY_BASE_URL}/stream/${infoHash}`;
      } else if (res.status === 504) {
         // Torrent is dead, don't fallback to HLS because HLS will just fail with 504 too!
         // We can set a specific error URL or let Vidstack handle the 504.
         // Actually, if we pass the HLS URL, Vidstack will hit 504 and throw hlsError.
         // Let's pass a dummy URL so VideoPlayer can explicitly show an error, or just rely on the HLS 504.
      }
      // Otherwise keep default HLS (for mkv, avi, or unknown)
    } catch {
      // Keep HLS fallback if fetch fails or times out
      console.warn(`[Client] HEAD request timed out or failed for ${infoHash}, falling back to HLS`);
    }

    // 2. Dispatch again with the finalized URL so Vidstack begins streaming
    dispatch(setPlayingStream({ url: targetUrl, infoHash, title, poster, imdbId }));
  }
);
