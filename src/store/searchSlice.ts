import { createSlice } from '@reduxjs/toolkit';
import type { PayloadAction } from '@reduxjs/toolkit';
import type { CinemetaMovie } from '../types';

interface SearchState {
  searchQuery: string;
  searchResults: CinemetaMovie[];
  isSearching: boolean;
  showDropdown: boolean;
}

const initialState: SearchState = {
  searchQuery: '',
  searchResults: [],
  isSearching: false,
  showDropdown: false,
};

export const searchSlice = createSlice({
  name: 'search',
  initialState,
  reducers: {
    setSearchQuery: (state, action: PayloadAction<string>) => {
      state.searchQuery = action.payload;
    },
    setSearchResults: (state, action: PayloadAction<CinemetaMovie[]>) => {
      state.searchResults = action.payload;
    },
    setIsSearching: (state, action: PayloadAction<boolean>) => {
      state.isSearching = action.payload;
    },
    setShowDropdown: (state, action: PayloadAction<boolean>) => {
      state.showDropdown = action.payload;
    },
    clearSearch: (state) => {
      state.searchQuery = '';
      state.searchResults = [];
      state.isSearching = false;
      state.showDropdown = false;
    }
  },
});

export const { setSearchQuery, setSearchResults, setIsSearching, setShowDropdown, clearSearch } = searchSlice.actions;
export default searchSlice.reducer;
