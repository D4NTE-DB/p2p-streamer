import { createSlice, createAsyncThunk, type PayloadAction } from '@reduxjs/toolkit';
import type { SubtitleTrack } from '../types';
import { PROXY_BASE_URL } from '../constants';

interface SubtitleState {
  tracks: SubtitleTrack[];
  activeFileId: number | null;
  subtitleOffset: number;
  loading: boolean;
  error: string | null;
}

const initialState: SubtitleState = {
  tracks: [],
  activeFileId: null,
  subtitleOffset: 0,
  loading: false,
  error: null,
};

export const fetchSubtitles = createAsyncThunk(
  'subtitles/fetchSubtitles',
  async ({ imdbId, lang }: { imdbId: string; lang?: string }, { rejectWithValue }) => {
    try {
      const targetLang = lang === 'all' ? 'en' : lang || 'en';
      const res = await fetch(
        `${PROXY_BASE_URL}/api/subtitles/search?imdbId=${encodeURIComponent(imdbId)}&lang=${encodeURIComponent(targetLang)}`
      );

      if (!res.ok) {
        return rejectWithValue(`Server returned HTTP ${res.status}`);
      }

      const json = await res.json();
      return (Array.isArray(json?.data) ? json.data : []) as SubtitleTrack[];
    } catch (err: any) {
      return rejectWithValue(err.message || 'Network error fetching subtitles');
    }
  }
);

export const subtitleSlice = createSlice({
  name: 'subtitles',
  initialState,
  reducers: {
    setActiveFileId: (state, action: PayloadAction<number | null>) => {
      state.activeFileId = action.payload;
    },
    setSubtitleOffset: (state, action: PayloadAction<number>) => {
      state.subtitleOffset = action.payload;
    },
    clearSubtitles: (state) => {
      state.tracks = [];
      state.activeFileId = null;
      state.subtitleOffset = 0;
      state.loading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSubtitles.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchSubtitles.fulfilled, (state, action) => {
        state.loading = false;
        state.tracks = action.payload;
        if (action.payload.length > 0 && !state.activeFileId) {
          state.activeFileId = action.payload[0].fileId;
        }
      })
      .addCase(fetchSubtitles.rejected, (state, action) => {
        state.loading = false;
        state.error = (action.payload as string) || action.error.message || 'Failed to load subtitles';
      });
  },
});

export const { setActiveFileId, setSubtitleOffset, clearSubtitles } = subtitleSlice.actions;
export default subtitleSlice.reducer;
