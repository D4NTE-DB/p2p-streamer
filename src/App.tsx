import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useDispatch, useSelector } from 'react-redux';
import { onAuthStateChanged } from 'firebase/auth';
import { collection, onSnapshot, query } from 'firebase/firestore';

import { store, type RootState } from './store';
import { setUser, setAuthLoading } from './store/authSlice';
import { setLibrary } from './store/librarySlice';
import { auth, db } from './firebase';
import type { LibraryItem } from './types';

// Layout & Pages
import { MainLayout } from './layouts/MainLayout';
import { Dashboard } from './pages/Dashboard';
import { StreamOptions } from './pages/StreamOptions';
import { Configuration } from './pages/Configuration';
import { Login } from './pages/Login';
import { Register } from './pages/Register';
import { FullScreenLoader } from './components/FullScreenLoader';

const appId = import.meta.env.VITE_APP_ID || 'p2p-streaming-app';

// Inner component to handle global side-effects requiring useDispatch
const AppContent = () => {
  const dispatch = useDispatch();
  const { user, loading } = useSelector((state: RootState) => state.auth);

  useEffect(() => {
    dispatch(setAuthLoading(true));
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      // Firebase User object is not strictly serializable, but for this boilerplate we pass it. 
      // Ignored in store/index.ts middleware.
      dispatch(setUser(firebaseUser));
    });
    return () => unsubscribe();
  }, [dispatch]);

  // Sync Library from Firestore
  useEffect(() => {
    if (!user || !db) {
      dispatch(setLibrary([]));
      return;
    }
    const q = query(collection(db, 'artifacts', appId, 'users', user.uid, 'library'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const items = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LibraryItem));
      dispatch(setLibrary(items));
    }, (err) => console.error("Firestore error:", err));
    return () => unsubscribe();
  }, [user, dispatch]);

  if (loading) {
    return <FullScreenLoader />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route path="/register" element={user ? <Navigate to="/" replace /> : <Register />} />
        
        {/* Protected Routes Wrapper (or partially protected) */}
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="stream/:imdbId" element={<StreamOptions />} />
          <Route path="settings" element={<Configuration />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
};

export default function App() {
  return (
    <Provider store={store}>
      <AppContent />
    </Provider>
  );
}