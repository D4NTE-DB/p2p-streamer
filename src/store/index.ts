import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import libraryReducer from './librarySlice';
import configReducer from './configSlice';
import playerReducer from './playerSlice';
import telemetryReducer from './telemetrySlice';
import searchReducer from './searchSlice';
import subtitleReducer from './subtitleSlice';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    library: libraryReducer,
    config: configReducer,
    player: playerReducer,
    telemetry: telemetryReducer,
    search: searchReducer,
    subtitles: subtitleReducer,
  },
  middleware: (getDefaultMiddleware) => 
    getDefaultMiddleware({
      serializableCheck: {
        // Ignore specific paths regarding Firebase user objects
        ignoredPaths: ['auth.user'],
        ignoredActionPaths: ['payload.user', 'payload'],
      },
    }),
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
