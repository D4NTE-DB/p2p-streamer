import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';

interface ConfigState {
  sidebarCollapsed: boolean;
  selectedQualities: Record<string, boolean>;
  maxSizeGb: number;
  audioLanguage: string;
  requireSubtitles: boolean;
}

const initialState: ConfigState = {
  sidebarCollapsed: false,
  selectedQualities: {
    '4K': true,
    '1080p': true,
    '720p': true,
    'SD/Other': true
  },
  maxSizeGb: 10,
  audioLanguage: 'all',
  requireSubtitles: false
};

export const configSlice = createSlice({
  name: 'config',
  initialState,
  reducers: {
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    toggleQuality: (state, action: PayloadAction<string>) => {
      const quality = action.payload;
      state.selectedQualities[quality] = !state.selectedQualities[quality];
    },
    setQualities: (state, action: PayloadAction<Record<string, boolean>>) => {
      state.selectedQualities = action.payload;
    },
    setMaxSizeGb: (state, action: PayloadAction<number>) => {
      state.maxSizeGb = action.payload;
    },
    setAudioLanguage: (state, action: PayloadAction<string>) => {
      state.audioLanguage = action.payload;
    },
    setRequireSubtitles: (state, action: PayloadAction<boolean>) => {
      state.requireSubtitles = action.payload;
    }
  },
});

export const { toggleSidebar, setSidebarCollapsed, toggleQuality, setQualities, setMaxSizeGb, setAudioLanguage, setRequireSubtitles } = configSlice.actions;
export default configSlice.reducer;
