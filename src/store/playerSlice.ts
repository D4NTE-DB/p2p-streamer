import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface PlayerState {
  playingUrl: string | null;
  playingInfoHash: string;
  runtimeSeconds: number;
}

const initialState: PlayerState = {
  playingUrl: null,
  playingInfoHash: '',
  runtimeSeconds: 0,
};

export const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setPlayingStream: (state, action: PayloadAction<{ url: string; infoHash: string }>) => {
      state.playingUrl = action.payload.url;
      state.playingInfoHash = action.payload.infoHash;
    },
    setRuntimeSeconds: (state, action: PayloadAction<number>) => {
      state.runtimeSeconds = action.payload;
    },
    closePlayer: (state) => {
      state.playingUrl = null;
      state.playingInfoHash = '';
    },
  },
});

export const { setPlayingStream, setRuntimeSeconds, closePlayer } = playerSlice.actions;
export default playerSlice.reducer;
