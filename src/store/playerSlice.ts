import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface RecentStream {
  infoHash: string;
  title: string;
  poster: string | null;
  imdbId: string;
  timestamp: number;
}

interface PlayerState {
  playingUrl: string | null;
  playingInfoHash: string;
  lastPlayedInfoHash: string | null;
  recentStreams: RecentStream[];
}

const initialState: PlayerState = {
  playingUrl: null,
  playingInfoHash: '',
  lastPlayedInfoHash: null,
  recentStreams: [],
};

export const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setPlayingStream: (
      state,
      action: PayloadAction<{ url: string; infoHash: string; title?: string; poster?: string | null; imdbId?: string }>
    ) => {
      state.playingUrl = action.payload.url;
      state.playingInfoHash = action.payload.infoHash;
      state.lastPlayedInfoHash = action.payload.infoHash;

      if (action.payload.title && action.payload.imdbId) {
        // Remove if it already exists
        state.recentStreams = state.recentStreams.filter((s) => s.infoHash !== action.payload.infoHash);
        
        // Add to the front
        state.recentStreams.unshift({
          infoHash: action.payload.infoHash,
          title: action.payload.title,
          poster: action.payload.poster || null,
          imdbId: action.payload.imdbId,
          timestamp: Date.now(),
        });

        // Cap at 10 items
        if (state.recentStreams.length > 10) {
          state.recentStreams.pop();
        }
      }
    },
    closePlayer: (state) => {
      state.playingUrl = null;
      state.playingInfoHash = '';
    },
  },
});

export const { setPlayingStream, closePlayer } = playerSlice.actions;
export default playerSlice.reducer;
