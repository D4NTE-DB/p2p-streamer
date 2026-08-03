# Enhanced P2P Stream Capabilities Implementation Plan

This plan outlines improvements to the local P2P streaming proxy engine and React frontend UI, designed with a decoupled architecture ready for future Flutter app integration.

## Architecture Guidelines (Flutter & Web Ready)

- **Strict Decoupling**: The Node.js headless engine operates independently on `127.0.0.1:8888`, exposing standard REST endpoints (`/stream/:infoHash`, `/play-vlc/:infoHash`, `/stats`). Any frontend (React web, Flutter mobile/desktop app, or external CLI) can consume these exact same endpoints.

---

## Performance & Streaming Enhancements

### 1. VLC Performance Optimizations
- **Header & Footer Pre-buffering (Moov Atom & MKV Cues)**:
  - VLC requires container metadata located at the beginning (~2 MB) and end (~1 MB) of MP4/MKV files to index keyframes and start playback immediately.
  - Automatically prioritize piece downloads for the head and tail of the video file upon initial request so VLC launches and begins playing in under 2 seconds.
- **Range Request Pipe Buffering**:
  - Optimize stream read pipes with a 256KB `highWaterMark` buffer to handle rapid range seeking from VLC without socket starvation or stutters.

### 2. Web Browser (`<video>`) Performance Optimizations
- **Dynamic MIME & Format Hints**:
  - Automatically map video extensions (`.mp4`, `.webm`, `.mkv`, `.avi`, `.m4v`).
  - Detect non-browser-native formats (e.g. `.mkv`, `.avi`, AC3 audio) and provide automatic UI recommendations to open in VLC when browser HTML5 codec limitations prevent native decoding.
- **Persistent HTTP Keep-Alive**:
  - Enable HTTP keep-alive connections and CORS header optimization to eliminate micro-stutters during HTML5 video range requests.

### 3. BitTorrent P2P Speed Optimizations
- **Sequential Downloading (`file.select()`)**:
  - Deselect non-video files (samples, NFOs, TXT) to allocate 100% of bandwidth to the video file.
- **Dynamic Seeking Reprioritization**:
  - Dynamically shift P2P piece priorities when seek requests arrive, prioritizing the playhead window (next 15–60 seconds).
- **High-Availability Tracker Injection**:
  - Append top public BitTorrent trackers (`opentrackr`, `stealth.si`, `torrent.eu.org`) to speed up peer discovery for any infoHash.

### 4. Real-time Telemetry & Status Monitoring (`/stats`)
- **GET `/stats` & GET `/stats/:infoHash`**:
  - Expose live metrics: download speed (MB/s), upload speed (MB/s), active peer/seeder count, progress %, file format, and buffer state.
- **React UI (`SystemStatusPanel.tsx`)**:
  - Poll `/stats` during active streaming to display live download speeds, active peers, and proxy status in real time.

---

## Proposed Code Changes

### Backend Proxy Engine

#### [MODIFY] [src/index.ts](file:///G:/Projects/Job%20works/React/p2p-streamer/src/index.ts)
- Add public tracker fallbacks.
- Implement head/tail metadata piece prioritization for fast VLC/Web startup.
- Implement Range Request stream pipe optimization (`highWaterMark: 256 * 1024`).
- Add dynamic MIME detection & format capability checking.
- Add GET `/stats` and GET `/stats/:infoHash` API endpoints.

---

### React Frontend UI

#### [MODIFY] [src/components/SystemStatusPanel.tsx](file:///G:/Projects/Job%20works/React/p2p-streamer/src/components/SystemStatusPanel.tsx)
- Connect to live `http://localhost:8888/stats` telemetry polling.
- Render live download speeds (e.g. `4.8 MB/s`), peer count, and container format indicators.

#### [MODIFY] [src/App.tsx](file:///G:/Projects/Job%20works/React/p2p-streamer/src/App.tsx)
- Handle player error states gracefully when non-browser-native formats (`.mkv`/`.avi`) fail in `<video>`, prompting one-click VLC opening.

---

## Verification Plan

### Automated / Build Verification
- Run `npx tsc --noEmit` (Frontend type check).
- Run `npx tsc -P src/tsconfig.json --noEmit` (Backend type check).

### Manual Verification
- Test GET `/stats` API endpoint response via browser/curl.
- Test instant start and seeking in VLC.
- Test in-browser player with `.mp4` and verify fallback prompt for `.mkv`.
- Verify real-time metrics (speed, peers, progress) updating live in the System Status panel.
# Enhanced P2P Stream Capabilities Implementation Plan

This plan outlines improvements to the local P2P streaming proxy engine and React frontend UI, designed with a decoupled architecture ready for future Flutter app integration.

## Architecture Guidelines (Flutter & Web Ready)

- **Strict Decoupling**: The Node.js headless engine operates independently on `127.0.0.1:8888`, exposing standard REST endpoints (`/stream/:infoHash`, `/play-vlc/:infoHash`, `/stats`). Any frontend (React web, Flutter mobile/desktop app, or external CLI) can consume these exact same endpoints.

---

## Performance & Streaming Enhancements

### 1. VLC Performance Optimizations
- **Header & Footer Pre-buffering (Moov Atom & MKV Cues)**:
  - VLC requires container metadata located at the beginning (~2 MB) and end (~1 MB) of MP4/MKV files to index keyframes and start playback immediately.
  - Automatically prioritize piece downloads for the head and tail of the video file upon initial request so VLC launches and begins playing in under 2 seconds.
- **Range Request Pipe Buffering**:
  - Optimize stream read pipes with a 256KB `highWaterMark` buffer to handle rapid range seeking from VLC without socket starvation or stutters.

### 2. Web Browser (`<video>`) Performance Optimizations
- **Dynamic MIME & Format Hints**:
  - Automatically map video extensions (`.mp4`, `.webm`, `.mkv`, `.avi`, `.m4v`).
  - Detect non-browser-native formats (e.g. `.mkv`, `.avi`, AC3 audio) and provide automatic UI recommendations to open in VLC when browser HTML5 codec limitations prevent native decoding.
- **Persistent HTTP Keep-Alive**:
  - Enable HTTP keep-alive connections and CORS header optimization to eliminate micro-stutters during HTML5 video range requests.

### 3. BitTorrent P2P Speed Optimizations
- **Sequential Downloading (`file.select()`)**:
  - Deselect non-video files (samples, NFOs, TXT) to allocate 100% of bandwidth to the video file.
- **Dynamic Seeking Reprioritization**:
  - Dynamically shift P2P piece priorities when seek requests arrive, prioritizing the playhead window (next 15–60 seconds).
- **High-Availability Tracker Injection**:
  - Append top public BitTorrent trackers (`opentrackr`, `stealth.si`, `torrent.eu.org`) to speed up peer discovery for any infoHash.

### 4. Real-time Telemetry & Status Monitoring (`/stats`)
- **GET `/stats` & GET `/stats/:infoHash`**:
  - Expose live metrics: download speed (MB/s), upload speed (MB/s), active peer/seeder count, progress %, file format, and buffer state.
- **React UI (`SystemStatusPanel.tsx`)**:
  - Poll `/stats` during active streaming to display live download speeds, active peers, and proxy status in real time.

---

## Proposed Code Changes

### Backend Proxy Engine

#### [MODIFY] [src/index.ts](file:///G:/Projects/Job%20works/React/p2p-streamer/src/index.ts)
- Add public tracker fallbacks.
- Implement head/tail metadata piece prioritization for fast VLC/Web startup.
- Implement Range Request stream pipe optimization (`highWaterMark: 256 * 1024`).
- Add dynamic MIME detection & format capability checking.
- Add GET `/stats` and GET `/stats/:infoHash` API endpoints.

---

### React Frontend UI

#### [MODIFY] [src/components/SystemStatusPanel.tsx](file:///G:/Projects/Job%20works/React/p2p-streamer/src/components/SystemStatusPanel.tsx)
- Connect to live `http://localhost:8888/stats` telemetry polling.
- Render live download speeds (e.g. `4.8 MB/s`), peer count, and container format indicators.

#### [MODIFY] [src/App.tsx](file:///G:/Projects/Job%20works/React/p2p-streamer/src/App.tsx)
- Handle player error states gracefully when non-browser-native formats (`.mkv`/`.avi`) fail in `<video>`, prompting one-click VLC opening.

---

## Verification Plan

### Automated / Build Verification
- Run `npx tsc --noEmit` (Frontend type check).
- Run `npx tsc -P src/tsconfig.json --noEmit` (Backend type check).

### Manual Verification
- Test GET `/stats` API endpoint response via browser/curl.
- Test instant start and seeking in VLC.
- Test in-browser player with `.mp4` and verify fallback prompt for `.mkv`.
- Verify real-time metrics (speed, peers, progress) updating live in the System Status panel.
