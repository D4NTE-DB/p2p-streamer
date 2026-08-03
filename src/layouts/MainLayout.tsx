import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { MonitorPlay, Home, Settings, Search as SearchIcon, LogOut, ChevronLeft, ChevronRight, User as UserIcon, Loader2, X } from 'lucide-react';
import { useSelector, useDispatch } from 'react-redux';
import type { RootState } from '../store';
import { toggleSidebar } from '../store/configSlice';
import { logout } from '../store/authSlice';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { CINEMETA_API_URL } from '../constants';
import type { CinemetaMovie } from '../types';

export const MainLayout: React.FC = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { user } = useSelector((state: RootState) => state.auth);
  const { sidebarCollapsed } = useSelector((state: RootState) => state.config);

  // Global Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CinemetaMovie[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<any>(null);

  // Handle Search Input Change with Debounce
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      setShowDropdown(false);
      return;
    }

    setIsSearching(true);
    setShowDropdown(true);

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${CINEMETA_API_URL}/catalog/movie/top/search=${encodeURIComponent(query)}.json`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults((data.metas || []).slice(0, 8));
        }
      } catch (err) {
        console.error("Search failed:", err);
      } finally {
        setIsSearching(false);
      }
    }, 350);
  };

  // Close dropdown on click outside or Escape
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const handleSelectMovie = (movie: CinemetaMovie) => {
    setShowDropdown(false);
    setSearchQuery('');
    navigate(`/stream/${movie.id}?title=${encodeURIComponent(movie.name)}&poster=${encodeURIComponent(movie.poster || '')}`);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      dispatch(logout());
      navigate('/login');
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const navItems = [
    { path: '/', label: 'Dashboard', icon: Home },
    { path: '/settings', label: 'Settings', icon: Settings },
  ];

  return (
    <div className="flex h-screen bg-gray-950 text-gray-200 overflow-hidden font-sans">
      
      {/* Side Navigation */}
      <aside className={`bg-gray-900 border-r border-gray-800 transition-all duration-300 flex flex-col ${sidebarCollapsed ? 'w-20' : 'w-64'}`}>
        {/* Logo Area */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-gray-800">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2 overflow-hidden whitespace-nowrap">
              <MonitorPlay className="w-6 h-6 text-blue-500 shrink-0" />
              <span className="font-bold text-lg bg-gradient-to-r from-blue-400 to-purple-500 bg-clip-text text-transparent">P2P Streamer</span>
            </div>
          )}
          {sidebarCollapsed && (
            <MonitorPlay className="w-8 h-8 text-blue-500 mx-auto" />
          )}
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 py-6 px-3 flex flex-col gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-lg transition-colors ${
                  isActive ? 'bg-blue-600/20 text-blue-400' : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                } ${sidebarCollapsed ? 'justify-center' : ''}`
              }
              title={sidebarCollapsed ? item.label : undefined}
            >
              <item.icon className="w-5 h-5 shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">{item.label}</span>}
            </NavLink>
          ))}
        </nav>

        {/* Bottom Actions */}
        <div className="p-3 border-t border-gray-800 flex flex-col gap-2">
          <button 
            onClick={() => dispatch(toggleSidebar())}
            className={`flex items-center gap-3 px-3 py-3 text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
            title={sidebarCollapsed ? "Expand" : "Collapse"}
          >
            {sidebarCollapsed ? <ChevronRight className="w-5 h-5 shrink-0" /> : <ChevronLeft className="w-5 h-5 shrink-0" />}
            {!sidebarCollapsed && <span className="font-medium">Collapse</span>}
          </button>
          
          {user && (
            <button 
              onClick={handleLogout}
              className={`flex items-center gap-3 px-3 py-3 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors ${sidebarCollapsed ? 'justify-center' : ''}`}
              title={sidebarCollapsed ? "Logout" : undefined}
            >
              <LogOut className="w-5 h-5 shrink-0" />
              {!sidebarCollapsed && <span className="font-medium">Logout</span>}
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative">
        {/* Top Header */}
        <header className="h-16 flex items-center justify-between px-8 bg-gray-900/50 backdrop-blur-sm border-b border-gray-800/50 sticky top-0 z-20">
          
          {/* Global Search Bar */}
          <div ref={searchContainerRef} className="relative w-full max-w-md">
            <div className="relative flex items-center">
              <SearchIcon className="w-4 h-4 text-gray-400 absolute left-3.5 pointer-events-none" />
              <input
                type="text"
                placeholder="Search movies by title..."
                value={searchQuery}
                onChange={handleSearchChange}
                onFocus={() => searchQuery.trim() && setShowDropdown(true)}
                className="w-full bg-gray-950/80 border border-gray-800 text-gray-200 text-sm rounded-full pl-10 pr-10 py-2 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition-colors"
              />
              {isSearching ? (
                <Loader2 className="w-4 h-4 text-blue-500 animate-spin absolute right-3.5" />
              ) : searchQuery ? (
                <button 
                  onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false); }} 
                  className="absolute right-3.5 text-gray-500 hover:text-gray-300"
                >
                  <X className="w-4 h-4" />
                </button>
              ) : null}
            </div>

            {/* Suggestions Dropdown */}
            {showDropdown && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-gray-900 border border-gray-800 rounded-xl shadow-2xl overflow-hidden z-50 max-h-96 overflow-y-auto divide-y divide-gray-800/50">
                {isSearching && searchResults.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-400 flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-blue-500" /> Searching Cinemeta...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="p-4 text-center text-sm text-gray-500">
                    No movies found matching "{searchQuery}"
                  </div>
                ) : (
                  searchResults.map((movie) => (
                    <div
                      key={movie.id}
                      onClick={() => handleSelectMovie(movie)}
                      className="flex items-center gap-3 p-2.5 hover:bg-gray-800/80 cursor-pointer transition-colors"
                    >
                      <div className="w-10 h-14 bg-gray-800 rounded overflow-hidden shrink-0">
                        {movie.poster ? (
                          <img src={movie.poster} alt={movie.name} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-gray-600">No Img</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-semibold text-gray-200 truncate">{movie.name}</h4>
                        <p className="text-xs text-gray-500">{movie.year || 'Movie'}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* User Profile */}
          <div className="flex items-center gap-4">
            {user ? (
              <div className="flex items-center gap-3 bg-gray-800/50 px-3 py-1.5 rounded-full border border-gray-700/50">
                <UserIcon className="w-4 h-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-300">
                  {user.email || user.uid.slice(0, 8)}
                </span>
                <span className="ml-2 px-2 py-0.5 bg-yellow-500/10 text-yellow-500 rounded text-xs font-semibold">PRO</span>
              </div>
            ) : (
              <NavLink to="/login" className="text-sm font-medium text-blue-400 hover:text-blue-300">
                Sign In
              </NavLink>
            )}
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1 overflow-auto p-8 relative">
          <Outlet />
        </div>
      </main>
    </div>
  );
};
