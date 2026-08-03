import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { LibraryItem } from '../types';

interface LibraryState {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
}

const initialState: LibraryState = {
  items: [],
  loading: false,
  error: null,
};

export const librarySlice = createSlice({
  name: 'library',
  initialState,
  reducers: {
    setLibrary: (state, action: PayloadAction<LibraryItem[]>) => {
      state.items = action.payload;
      state.loading = false;
      state.error = null;
    },
    setLibraryLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setLibraryError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
    addToLibrary: (state, action: PayloadAction<LibraryItem>) => {
      state.items.push(action.payload);
    },
    removeFromLibraryState: (state, action: PayloadAction<string>) => {
      state.items = state.items.filter(item => item.infoHash !== action.payload);
    }
  },
});

export const { setLibrary, setLibraryLoading, setLibraryError, addToLibrary, removeFromLibraryState } = librarySlice.actions;
export default librarySlice.reducer;
