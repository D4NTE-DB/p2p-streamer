# P2P Streamer

P2P Streamer is a web-based interface for searching movie and TV show streams from Torrentio. It allows users to find available torrents, categorize them by quality, and manage a personal "Cloud Library" of saved streams using Firebase for synchronization across devices.

## Features

-   **Movie & Show Search**: Find streams by title or IMDB ID.
-   **Torrentio Integration**: Fetches and parses stream data directly from the Torrentio API.
-   **Quality Filtering**: View streams categorized by quality (4K, 1080p, 720p, etc.) and filter them.
-   **Sort by Seeders**: Streams are automatically sorted by the number of seeders for best performance.
-   **Cloud Library**: Save your favorite streams to a personal library, synced in real-time with Firebase Firestore.
-   **Secure Authentication**: Uses Firebase Anonymous Authentication to give each user a unique, persistent library.
-   **Responsive UI**: Built with React and TailwindCSS for a clean and modern user experience.

## Architecture Overview

The system consists of three main parts:

1.  **React Frontend (This Project)**: The user interface you interact with in the browser. It handles searching, displaying results, and managing the library.
2.  **Firebase Backend**: Used for user authentication (anonymously) and storing the user's "Cloud Library" in Firestore.
3.  **External APIs**:
    *   **Cinemeta**: Used to find the IMDB ID and correct title from a search query.
    *   **Torrentio**: Used to find available streams for a given IMDB ID.

> **Note**: The "Play" functionality in this UI is a placeholder. It simulates sending a torrent's `infoHash` to a local process. To make this work, you would need to build a separate **Local Node.js Proxy**, which is described in Part 4.

---

## Step-by-Step Installation and Setup Guide

Follow these steps carefully to configure and run the project on your local machine.

### Part 1: Firebase Setup

This application requires a Firebase project for authentication and the cloud library feature.

1.  **Create a Firebase Project**:
    *   Go to the Firebase Console.
    *   Click **"Add project"** and give it a name (e.g., `p2p-streamer-app`). Follow the on-screen instructions.

2.  **Enable Authentication**:
    *   In your project's dashboard, go to **Build > Authentication** from the left-hand menu.
    *   Click **"Get started"**.
    *   Select **"Anonymous"** from the list of sign-in providers and **enable** it.

3.  **Set up Firestore Database**:
    *   Go to **Build > Firestore Database**.
    *   Click **"Create database"**.
    *   Start in **test mode**. This allows open read/write access during development. Click "Next" and choose a location for your database.
    *   **Important**: For a more secure setup, navigate to the **Rules** tab in Firestore and replace the default rules with the following. This ensures users can only access their own library data.

    ```
    rules_version = '2';
    service cloud.firestore {
      match /databases/{database}/documents {
        // Allow users to read and write only to their own library
        match /artifacts/{appId}/users/{userId}/library/{docId} {
          allow read, write: if request.auth != null && request.auth.uid == userId;
        }
      }
    }
    ```

4.  **Get Firebase Configuration**:
    *   Go to your **Project Settings** (click the gear icon ⚙️ next to "Project Overview").
    *   In the "Your apps" section, click the web icon (`</>`) to register a new web app.
    *   Give it a nickname (e.g., "Web Client") and click **"Register app"**.
    *   Firebase will provide you with a `firebaseConfig` object. **Copy this entire object**; you will need it in the next part.

### Part 2: Local Project Setup

Now, let's configure the React application itself.

1.  **Clone the Repository**:
    ```bash
    git clone <your-repository-url>
    cd p2p-streamer
    ```

2.  **Install Dependencies**:
    ```bash
    npm install
    ```

3.  **Configure Environment Variables**:
    This project uses environment variables to handle sensitive keys like your Firebase configuration.

    *   In the root of the project, create a new file named `.env` by copying the example file:
        ```bash
        cp .env.example .env
        ```
    *   Open the new `.env` file in your editor.
    *   Replace the placeholder values with your actual Firebase project configuration details obtained in Part 1.

    Your `.env` file should look like this, but with your real credentials:
    ```ini
    # Firebase Configuration
    VITE_FIREBASE_API_KEY="AIza..."
    VITE_FIREBASE_AUTH_DOMAIN="your-project.firebaseapp.com"
    VITE_FIREBASE_PROJECT_ID="your-project-id"
    VITE_FIREBASE_STORAGE_BUCKET="your-project.appspot.com"
    VITE_FIREBASE_MESSAGING_SENDER_ID="12345..."
    VITE_FIREBASE_APP_ID="1:12345...:web:abcd..."

    # Application Configuration
    VITE_APP_ID="p2p-streaming-app"
    ```

    > **Security Note**: The `.env` file is typically added to `.gitignore` to prevent committing sensitive keys to your repository. Please ensure `.env` is included in your `.gitignore` file.

### Part 3: Running the Application

You are now ready to run the frontend.

1.  **Start the Development Server**:
    ```bash
    npm run dev
    ```
2.  **Open in Browser**:
    Open your browser and navigate to the local URL provided (usually `http://localhost:5173`). The application should load, automatically sign you in anonymously, and you can start searching for movies.

### Part 4: Understanding the "Play" Button (Optional)

The "Play" button in this UI is a **simulation**. It shows a toast message but does not actually stream any video. To build a fully functional player, you would need to create a separate local Node.js server that this frontend can communicate with.

Here is a conceptual guide to what that server would do:

1.  **Create a simple Node.js server** using a framework like Express.
2.  **Use a torrent-streaming library** like `webtorrent-hybrid`.
3.  **Create an API endpoint** (e.g., `POST /play`) that accepts an `infoHash`.
4.  When the endpoint is called, use WebTorrent to start downloading the torrent and expose it as an HTTP stream (e.g., `http://localhost:8888/0`).
5.  **Launch a media player** like VLC using Node's `child_process`, pointing it to the local streaming URL.
6.  Finally, you would **modify the `playLocally` function** in `App.tsx` to send a `fetch` request to your local server's `/play` endpoint instead of just setting state.

This separation keeps the heavy-lifting of torrenting out of the browser and on your local machine.