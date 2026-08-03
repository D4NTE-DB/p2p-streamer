# Project Instructions

This `GEMINI.md` file provides essential instructions and context for the `p2p-streamer` project. It serves as a central reference for developers working on this codebase, ensuring consistency and adherence to project standards.

## Project Overview

*   **Purpose:** P2P Streamer is a web-based interface for searching movie and TV show streams from Torrentio. It allows users to find available torrents, categorize them by quality, and manage a personal "Cloud Library" of saved streams using Firebase for synchronization across devices.
*   **Technology Stack:** React, TypeScript, Vite, Firebase (Authentication, Firestore), TailwindCSS, ESLint, WebRTC (implied by P2P streaming nature, but specifically mentioned in `p2p-streaming-dev.prompt.md`).
*   **Architecture:** The system consists of three main parts: a React Frontend (this project), a Firebase Backend (for authentication and Cloud Library), and External APIs (Cinemeta for IMDB IDs, Torrentio for stream data). A conceptual Local Node.js Proxy is mentioned for "Play" functionality.

## Getting Started

1.  **Installation:**
    ```bash
    npm install
    ```
2.  **Running the Application:**
    ```bash
    npm run dev
    ```
3.  **Building for Production:**
    ```bash
    npm run build
    ```

## Development Guidelines

*   **Coding Style:** Adherence to ESLint rules for code quality and consistency, and TailwindCSS for styling.
*   **Testing:** A formal testing strategy needs to be defined. No common test files (e.g., `.test.ts`, `.spec.tsx`) were found in the `src` directory.
*   **Branching Strategy:** To be defined by project maintainers.
*   **Commit Messages:** To be defined by project maintainers.

## Contributing

Guidelines for contributing to this project are to be defined by project maintainers.

## Codebase Structure & Architecture

The application follows a modern, scalable React architecture using React Router for navigation and Redux Toolkit for global state management.

### Codebase Breakdown

*   **`src/App.tsx`**: The Root application wrapper. It handles the Redux `<Provider>`, React Router `<BrowserRouter>`, and sets up global listeners (like Firebase Auth and Firestore `onSnapshot`).
*   **`src/store/`**: Contains the Redux Toolkit slices and thunks:
    *   `authSlice.ts`: Manages user authentication state.
    *   `librarySlice.ts`: Manages the user's saved items (Cloud Library).
    *   `configSlice.ts`: Manages user preferences (quality filters, max torrent size filter, audio language preference, and sidebar state).
    *   `playerSlice.ts`: Manages global video player state (`playingUrl`, `playingInfoHash`, `runtimeSeconds`).
    *   `libraryThunks.ts`: Encapsulates async Firestore CRUD (`saveStreamToLibrary`, `removeStreamFromLibrary`) and playback initialization.
*   **`src/layouts/`**:
    *   `MainLayout.tsx`: The primary wrapper containing the responsive Side Navigation and Header with global movie search. Renders nested routes via `<Outlet />`.
*   **`src/pages/`**: Dedicated page components:
    *   `Dashboard.tsx`: The home page showing trending movie posters.
    *   `StreamOptions.tsx`: The streaming page that scrapes Torrentio via the backend proxy, fetches Cinemeta movie runtime for timeline hints, filters by size and language, and toggles between poster preview and full-width video player mode with animated layout shift.
    *   `Configuration.tsx`: User settings page for quality and torrent size limits.
    *   `Login.tsx` & `Register.tsx`: Firebase Email/Password authentication.
*   **`src/components/`**: Presentational (UI) React components like `VideoPlayer.tsx` (with single-run blur progress reveal, Telemetry HUD overlay on hover, custom Cinemeta duration bar, and HLS support), `StreamItem.tsx` (connects directly to Redux for zero prop-drilling), and `SystemStatusPanel.tsx`.
*   **`src/firebase.ts`**: Handles the configuration and initialization of the Firebase SDK.
*   **`src/constants.ts`**: Application-wide constants.
*   **`src/types.ts`**: Shared TypeScript type definitions.

## Further Documentation

*   **API Documentation:** To be provided by project maintainers, if applicable.
*   **Design Documents:** To be provided by project maintainers.

## Agent-Specific Prompts/Instructions

This section contains instructions specifically tailored for AI agents interacting with this codebase.

### Explain Code Prompt

*   **Location:** `.github/prompts/explain-code.prompt.md`
*   **Purpose:** Provides context and guidelines for the AI agent when explaining code snippets or functionalities within this project.

### P2P Streaming Development Prompt

*   **Location:** `.github/prompts/p2p-streaming-dev.prompt.md`
*   **Purpose:** Offers specific guidance and architectural insights for the AI agent when assisting with P2P streaming feature development.

### Refactoring Opportunities Prompt

*   **Location:** `.github/prompts/refactoring-opportunities.prompt.md`
*   **Purpose:** Informs the AI agent about common refactoring patterns, existing technical debt, or areas to prioritize for code improvement in this project.
