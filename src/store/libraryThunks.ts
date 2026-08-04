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
    let targetUrl = `${PROXY_BASE_URL}/stream/${infoHash}`;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${PROXY_BASE_URL}/stream/${infoHash}`, {
        method: 'HEAD',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const contentType = res.headers.get('content-type') || '';
      if (
        contentType.includes('matroska') ||
        contentType.includes('msvideo') ||
        contentType.includes('avi') ||
        contentType.includes('mkv')
      ) {
        targetUrl = `${PROXY_BASE_URL}/hls-stream/${infoHash}/index.m3u8`;
      }
    } catch {
      // Fallback to direct stream
    }

    dispatch(setPlayingStream({ url: targetUrl, infoHash, title, poster, imdbId }));
  }
);
