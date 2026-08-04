import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

export interface TelemetryTorrent {
  infoHash: string;
  name: string;
  progress: string;
  downloadSpeed: string;
  uploadSpeed: string;
  downloaded: string;
  totalSize: string;
  numPeers: number;
  fileName: string;
  mimeType: string;
}

export interface TelemetryStats {
  status: string;
  downloadSpeed: string;
  uploadSpeed: string;
  activeTorrentsCount: number;
  torrents: TelemetryTorrent[];
}

interface TelemetryState {
  isOnline: boolean;
  stats: TelemetryStats | null;
}

const initialState: TelemetryState = {
  isOnline: false,
  stats: null,
};

export const telemetrySlice = createSlice({
  name: 'telemetry',
  initialState,
  reducers: {
    setTelemetryData: (state, action: PayloadAction<TelemetryStats>) => {
      state.stats = action.payload;
      state.isOnline = true;
    },
    setTelemetryOffline: (state) => {
      state.stats = null;
      state.isOnline = false;
    },
  },
});

export const { setTelemetryData, setTelemetryOffline } = telemetrySlice.actions;
export default telemetrySlice.reducer;
