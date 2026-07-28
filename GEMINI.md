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

## Codebase Structure & Refactoring

The main application logic resides in `src/App.tsx`. To improve readability and maintainability, the original monolithic `App` component has been refactored. The application now follows a standard React project structure, separating concerns into different files and directories.

### Codebase Breakdown

*   **`src/App.tsx`**: This is the primary container component. It is responsible for:
    *   **State Management**: All application state (user, library, search results, UI state) is managed here using `useState`.
    *   **Side Effects**: All side effects, such as Firebase authentication, Firestore subscriptions, and API calls, are handled here using `useEffect`.
    *   **Logic & Handlers**: All event handlers (`searchTorrentio`, `saveToLibrary`, etc.) are defined here.
    *   **Composition**: It renders the overall application layout by importing and composing the presentational components, passing the necessary state and handlers to them as props.

*   **`src/components/`**: This directory contains all the presentational (UI) React components. Each component is in its own file, making them reusable and easy to manage.
    *   `FullScreenLoader.tsx`: A simple loading spinner shown while the user is being authenticated.
    *   `Header.tsx`: The main application header, showing the title and user information.
    *   `InitErrorScreen.tsx`: Displays a fatal error if Firebase fails to initialize.
    *   `LibraryItemCard.tsx`: Renders a single item from the user's library with a button to remove it. It is memoized with `React.memo`.
    *   `LibraryPanel.tsx`: The sidebar component that displays the user's saved "Cloud Library".
    *   `SearchPanel.tsx`: Contains the search input form and quality filter checkboxes.
    *   `StreamItem.tsx`: Renders a single torrent stream result with its details and action buttons. It is memoized with `React.memo`.
    *   `SuggestionPanel.tsx`: Displays the movie poster for the current search result.
    *   `SystemStatusPanel.tsx`: A static informational panel about the conceptual local proxy.

*   **`src/firebase.ts`**: Handles the configuration and initialization of the Firebase SDK, including Auth and Firestore instances. It also includes validation for the necessary environment variables.

*   **`src/constants.ts`**: A central place for application-wide constants, such as API endpoints, quality categories, and cache settings.

*   **`src/types.ts`**: Contains all shared TypeScript type definitions and interfaces (e.g., `StreamMetadata`, `LibraryItem`), ensuring type safety across the application.

This refactoring separates the application's concerns: the `App` component is the "brain" that holds the state and logic, while the components in the `src/components` directory are "dumb" renderers. This makes the code easier to understand, debug, and maintain.

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
