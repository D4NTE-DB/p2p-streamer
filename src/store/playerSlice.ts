import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface PlayerState {
  playingUrl: string | null;
  playingInfoHash: string;
  lastPlayedInfoHash: string | null;
}

const initialState: PlayerState = {
  playingUrl: null,
  playingInfoHash: '',
  lastPlayedInfoHash: null,
};

export const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    setPlayingStream: (state, action: PayloadAction<{ url: string; infoHash: string }>) => {
      state.playingUrl = action.payload.url;
      state.playingInfoHash = action.payload.infoHash;
      state.lastPlayedInfoHash = action.payload.infoHash;
    },
    closePlayer: (state) => {
      state.playingUrl = null;
      state.playingInfoHash = '';
    },
  },
});

export const { setPlayingStream, closePlayer } = playerSlice.actions;
export default playerSlice.reducer;
