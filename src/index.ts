import express from 'express';
import torrentStream from 'torrent-stream';
import cors from 'cors';
import rangeParser from 'range-parser';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import path from 'path';
import os from 'os';

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}

process.on('uncaughtException', (err) => {
  console.error('[Server] Uncaught Exception:', err.message);
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Server] Unhandled Rejection:', reason?.message || reason);
});

const app = express();
const port = 8888;

// Use CORS to allow requests from the React frontend (e.g., http://localhost:5173)
app.use(cors());

// Root endpoint to verify server is running
app.get('/', (req, res) => {
  res.send('P2P Proxy Server is running gracefully!');
});

// Torrentio Proxy Endpoint to bypass browser 403 blocks
app.get('/api/torrentio/stream/:type/:imdbId.json', async (req, res) => {
  const { type, imdbId } = req.params;
  const targetUrl = `https://torrentio.strem.fun/stream/${type}/${imdbId}.json`;
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Stremio/4.4.168 (desktop)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Torrentio returned HTTP ${response.status}` });
    }

    const data = await response.json();
    return res.json(data);
  } catch (err: any) {
    console.error('[Server] Torrentio proxy error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch from Torrentio proxy' });
  }
});

// ---------------------------------------------------------------------------
// Torrent Engine Management (torrent-stream)
// ---------------------------------------------------------------------------

// Engine-per-torrent map (torrent-stream creates one engine per magnet)
const engines = new Map<string, any>();
const torrentLastAccessed = new Map<string, number>();
const MAX_ACTIVE_TORRENTS = 2;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// High-availability public BitTorrent trackers to accelerate peer discovery
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittorrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.coppersurfer.tk:6969/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://tracker.cyberia.is:6969/announce',
  'wss://tracker.openwebtorrent.com'
];

function evictIdleTorrents() {
  const now = Date.now();
  for (const [hash, engine] of engines) {
    const lastAccess = torrentLastAccessed.get(hash) || 0;
    if (now - lastAccess > IDLE_TIMEOUT_MS) {
      console.log(`[Server] Evicting idle torrent: ${hash}`);
      try { engine.remove(false, () => {}); } catch {}
      try { engine.destroy(); } catch {}
      engines.delete(hash);
      durationCache.delete(hash);
      codecCache.delete(hash);
      torrentLastAccessed.delete(hash);
    }
  }

  // Enforce MAX_ACTIVE_TORRENTS — evict oldest if at limit
  if (engines.size >= MAX_ACTIVE_TORRENTS) {
    let oldestHash: string | null = null;
    let oldestTime = now;
    for (const [hash] of engines) {
      const time = torrentLastAccessed.get(hash) || 0;
      if (time < oldestTime) {
        oldestTime = time;
        oldestHash = hash;
      }
    }
    if (oldestHash) {
      console.log(`[Server] Evicting oldest torrent to respect limit: ${oldestHash}`);
      const oldEngine = engines.get(oldestHash);
      try { oldEngine?.remove(false, () => {}); } catch {}
      try { oldEngine?.destroy(); } catch {}
      engines.delete(oldestHash);
      durationCache.delete(oldestHash);
      codecCache.delete(oldestHash);
      torrentLastAccessed.delete(oldestHash);
    }
  }
}

function getMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mp4':
    case 'm4v':
    case 'mov':
      return 'video/mp4';
    case 'webm':
      return 'video/webm';
    case 'mkv':
      return 'video/x-matroska';
    case 'avi':
      return 'video/x-msvideo';
    case 'mp3':
      return 'audio/mpeg';
    case 'ogg':
      return 'audio/ogg';
    default:
      return 'video/mp4';
  }
}

function getMagnetUri(infoHash: string): string {
  const trackersParam = PUBLIC_TRACKERS.map(t => `tr=${encodeURIComponent(t)}`).join('&');
  return `magnet:?xt=urn:btih:${infoHash}&${trackersParam}`;
}

function formatBytes(bytes: number | undefined | null): string {
  if (!bytes || isNaN(bytes) || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function isClientAbortError(err: any): boolean {
  const msg = err?.message || String(err);
  return (
    msg.includes('Writable stream closed') ||
    msg.includes('ERR_STREAM_PREMATURE_CLOSE') ||
    msg.includes('aborted') ||
    msg.includes('ECANCELED') ||
    msg.includes('Premature close')
  );
}

function isNativeWebVideo(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase();
  return ext === '.mp4' || ext === '.webm' || ext === '.ogv' || ext === '.m4v';
}

// ---------------------------------------------------------------------------
// Duration & Codec Probing (cached per infoHash)
// ---------------------------------------------------------------------------

const durationCache = new Map<string, number>();
const durationPromises = new Map<string, Promise<number>>();

interface CodecInfo {
  videoCodec: string;  // e.g. 'h264', 'hevc', 'vp9', 'av1'
  audioCodec: string;  // e.g. 'aac', 'ac3', 'dts', 'eac3', 'opus'
}

const codecCache = new Map<string, CodecInfo>();

/**
 * Probe a torrent file for both codec info AND duration in a single ffprobe pass.
 * Results are cached per infoHash so subsequent calls are free.
 */
function getOrProbeMetadata(file: any, infoHash: string): Promise<{ codecs: CodecInfo; duration: number }> {
  // If both are already cached, return immediately
  if (codecCache.has(infoHash) && durationCache.has(infoHash)) {
    return Promise.resolve({
      codecs: codecCache.get(infoHash)!,
      duration: durationCache.get(infoHash)!,
    });
  }

  // Deduplicate concurrent probes
  const existingPromise = durationPromises.get(infoHash);
  if (existingPromise) {
    return existingPromise.then(duration => ({
      codecs: codecCache.get(infoHash) || { videoCodec: 'unknown', audioCodec: 'unknown' },
      duration,
    }));
  }

  const promise = new Promise<number>((resolve, reject) => {
    try {
      const inputStream = file.createReadStream();
      ffmpeg(inputStream).ffprobe((err: any, metadata: any) => {
        if (typeof inputStream.destroy === 'function') inputStream.destroy();
        if (err) {
          console.error(`[Server] ffprobe failed for ${file.name}:`, err.message);
          return reject(err);
        }

        // Extract codec info
        const videoStream = metadata.streams?.find((s: any) => s.codec_type === 'video');
        const audioStream = metadata.streams?.find((s: any) => s.codec_type === 'audio');
        const codecs: CodecInfo = {
          videoCodec: videoStream?.codec_name || 'unknown',
          audioCodec: audioStream?.codec_name || 'unknown',
        };
        codecCache.set(infoHash, codecs);
        console.log(`[Server] Codecs for ${infoHash}: video=${codecs.videoCodec}, audio=${codecs.audioCodec}`);

        // Extract duration
        const duration = metadata?.format?.duration;
        if (duration && !isNaN(duration) && isFinite(duration) && duration > 0) {
          const parsedDuration = parseFloat(duration);
          durationCache.set(infoHash, parsedDuration);
          console.log(`[Server] Duration for ${infoHash}: ${parsedDuration}s`);
          resolve(parsedDuration);
        } else {
          // Even without valid duration, codecs are cached — resolve with 0
          console.warn(`[Server] Could not determine duration for ${infoHash}, codecs still cached`);
          resolve(0);
        }
      });
    } catch (err: any) {
      console.error(`[Server] Error probing ${file.name}:`, err.message);
      reject(err);
    }
  });

  durationPromises.set(infoHash, promise);
  promise.finally(() => durationPromises.delete(infoHash)).catch(() => {});

  return promise.then(duration => ({
    codecs: codecCache.get(infoHash) || { videoCodec: 'unknown', audioCodec: 'unknown' },
    duration,
  }));
}

// Convenience wrappers that use the unified probe
function getOrProbeDuration(file: any, infoHash: string): Promise<number> {
  return getOrProbeMetadata(file, infoHash).then(m => m.duration);
}

function getOrProbeCodecs(file: any, infoHash: string): Promise<CodecInfo> {
  return getOrProbeMetadata(file, infoHash).then(m => m.codecs);
}

// ---------------------------------------------------------------------------
// Engine Factory: torrent-stream
// ---------------------------------------------------------------------------

const READY_TIMEOUT_MS = 30000;

function getOrCreateEngine(infoHash: string): Promise<any> {
  // Return existing engine if already tracked
  if (engines.has(infoHash)) {
    torrentLastAccessed.set(infoHash, Date.now());
    const existingEngine = engines.get(infoHash)!;
    // If already ready, resolve immediately
    if (existingEngine.files && existingEngine.files.length > 0) {
      return Promise.resolve(existingEngine);
    }
    // Otherwise wait for ready
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Torrent discovery timed out'));
      }, READY_TIMEOUT_MS);

      existingEngine.on('ready', () => {
        clearTimeout(timeout);
        resolve(existingEngine);
      });
    });
  }

  // Evict to make room
  evictIdleTorrents();

  return new Promise((resolve, reject) => {
    const magnetUri = getMagnetUri(infoHash);
    const engine = torrentStream(magnetUri, {
      connections: 500, // Increased from 100 to 500 to aggressively connect to more peers for better speed
      uploads: 5,       // Limit upload slots slightly to prioritize download bandwidth
      tmp: path.join(os.tmpdir(), 'p2p-streamer'),
      dht: true,
      tracker: true,
    });

    const timeout = setTimeout(() => {
      console.warn(`[Server] Discovery timeout for ${infoHash}`);
      try { engine.destroy(); } catch {}
      engines.delete(infoHash);
      torrentLastAccessed.delete(infoHash);
      reject(new Error('Torrent discovery timed out'));
    }, READY_TIMEOUT_MS);

    engine.on('ready', () => {
      clearTimeout(timeout);
      engines.set(infoHash, engine);
      torrentLastAccessed.set(infoHash, Date.now());
      console.log(`[Server] Engine ready for ${infoHash} — ${engine.files.length} files`);

      // Select the main video file and deselect others, then start background probe
      const file = engine.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
      engine.files.forEach((f: any) => { if (f !== file) f.deselect(); });
      file.select();

      // Eagerly probe metadata (codecs + duration) in background
      getOrProbeMetadata(file, infoHash).catch(() => {});

      resolve(engine);
    });

    engine.on('error', (err: Error) => {
      clearTimeout(timeout);
      console.error(`[Server] Engine error for ${infoHash}:`, err.message);
      try { engine.destroy(); } catch {}
      engines.delete(infoHash);
      torrentLastAccessed.delete(infoHash);
      reject(err);
    });
  });
}

/**
 * Get the primary video file from an engine (largest file).
 */
function getPrimaryFile(engine: any): any {
  return engine.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
}

// ---------------------------------------------------------------------------
// Direct Stream Endpoint (HTTP Range Requests)
// ---------------------------------------------------------------------------

function serveStream(engine: any, req: express.Request, res: express.Response) {
  const file = getPrimaryFile(engine);
  const infoHash = req.params.infoHash;
  const mimeType = getMimeType(file.name);
  console.log(`[Server] Streaming file: ${file.name} (${formatBytes(file.length)}, MIME: ${mimeType})`);

  // Ensure main file is selected
  engine.files.forEach((f: any) => { if (f !== file) f.deselect(); });
  file.select();

  // Trigger background metadata probe if not already cached
  getOrProbeMetadata(file, infoHash).catch(() => {});

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Content-Disposition', 'inline');

  const rangeHeader = req.headers.range;

  if (rangeHeader) {
    const ranges = rangeParser(file.length, rangeHeader, { combine: true });

    if (ranges === -1 || ranges === -2 || ranges.length > 1) {
      res.status(416).send('Unsatisfiable or multiple ranges requested');
      return;
    }

    const { start, end } = ranges[0];
    const contentLength = end - start + 1;

    res.status(206);
    res.setHeader('Content-Length', contentLength);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${file.length}`);

    const stream = file.createReadStream({ start, end }) as any;

    stream.pipe(res);

    req.on('close', () => {
      if (typeof stream.destroy === 'function') stream.destroy();
    });

    stream.on('error', (err: any) => {
      if (!isClientAbortError(err)) {
        console.error(`[Server] Stream error for ${file.name}:`, err.message);
      }
      if (!res.headersSent) res.status(500).send('Stream error');
    });
  } else {
    res.setHeader('Content-Length', file.length);
    const stream = file.createReadStream() as any;

    stream.pipe(res);

    req.on('close', () => {
      if (typeof stream.destroy === 'function') stream.destroy();
    });

    stream.on('error', (err: any) => {
      if (!isClientAbortError(err)) {
        console.error(`[Server] Stream error for ${file.name}:`, err.message);
      }
      if (!res.headersSent) res.status(500).send('Stream error');
    });
  }
}

app.get('/stream/:infoHash', async (req, res) => {
  const { infoHash } = req.params;

  if (!infoHash) {
    return res.status(400).send('Missing infoHash');
  }

  console.log(`[Server] Received stream request for infoHash: ${infoHash}`);

  try {
    const engine = await getOrCreateEngine(infoHash);
    serveStream(engine, req, res);
  } catch (err: any) {
    console.error(`[Server] Stream setup error:`, err.message);
    if (!res.headersSent) res.status(504).send(err.message);
  }
});

// ---------------------------------------------------------------------------
// HLS Playlist Endpoint
// ---------------------------------------------------------------------------

app.get('/hls-stream/:infoHash/index.m3u8', async (req, res) => {
  const { infoHash } = req.params;

  if (!infoHash) {
    return res.status(400).send('Missing infoHash');
  }

  console.log(`[Server] Generating HLS playlist for infoHash: ${infoHash}`);

  try {
    const engine = await getOrCreateEngine(infoHash);
    const file = getPrimaryFile(engine);

    const duration = await getOrProbeDuration(file, infoHash);
    if (!duration || duration <= 0) {
      return res.status(500).send('Could not determine duration for HLS');
    }

    const segmentLength = 10;
    const numSegments = Math.ceil(duration / segmentLength);

    let playlist = `#EXTM3U\n`;
    playlist += `#EXT-X-VERSION:3\n`;
    playlist += `#EXT-X-TARGETDURATION:${segmentLength}\n`;
    playlist += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    playlist += `#EXT-X-PLAYLIST-TYPE:VOD\n`;

    for (let i = 0; i < numSegments; i++) {
      const isLast = i === numSegments - 1;
      const currentDuration = isLast ? (duration - (i * segmentLength)).toFixed(3) : segmentLength.toFixed(3);
      playlist += `#EXTINF:${currentDuration},\n`;
      playlist += `${i}.ts\n`;
    }

    playlist += `#EXT-X-ENDLIST\n`;

    res.setHeader('Content-Type', 'application/x-mpegurl');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.send(playlist);
  } catch (err: any) {
    console.error(`[Server] HLS playlist error for ${infoHash}:`, err.message);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

// ---------------------------------------------------------------------------
// HLS Segment Endpoint — Tiered Budget Transcoding
// ---------------------------------------------------------------------------
//
// Tier 0: Container remux (-c copy)           → ~0% CPU   (H.264 + AAC/Opus)
// Tier 1: Audio-only transcode (-c:v copy)    → ~2-5% CPU (H.264 + DTS/AC3/EAC3)
// Tier 2: Full software transcode (libx264)   → ~50-80% CPU (HEVC/VP9/AV1 + any audio)
// ---------------------------------------------------------------------------

app.get('/hls-stream/:infoHash/:segment', async (req, res) => {
  const { infoHash, segment } = req.params;

  if (!segment.endsWith('.ts')) {
    return res.status(400).send('Invalid segment format');
  }

  const segmentIndex = parseInt(segment.replace('.ts', ''), 10);
  if (isNaN(segmentIndex)) {
    return res.status(400).send('Invalid segment index');
  }

  const segmentLength = 10;
  const startTime = segmentIndex * segmentLength;

  torrentLastAccessed.set(infoHash, Date.now());

  try {
    const engine = await getOrCreateEngine(infoHash);
    const file = getPrimaryFile(engine);
    const codecs = await getOrProbeCodecs(file, infoHash);

    // Determine transcoding tier
    const isH264 = codecs.videoCodec === 'h264';
    const isWebAudio = ['aac', 'opus', 'mp3', 'vorbis'].includes(codecs.audioCodec);

    let videoCodecArgs: string[];
    let audioCodecArgs: string[];
    let tierLabel: string;

    if (isH264 && isWebAudio) {
      // Tier 0: Pure container remux — near-zero CPU
      videoCodecArgs = ['-c:v', 'copy'];
      audioCodecArgs = ['-c:a', 'copy'];
      tierLabel = 'Tier 0 (remux)';
    } else if (isH264) {
      // Tier 1: Video copy, audio transcode only — ~2-5% CPU
      videoCodecArgs = ['-c:v', 'copy'];
      audioCodecArgs = ['-c:a', 'aac', '-ac', '2', '-b:a', '128k'];
      tierLabel = 'Tier 1 (audio transcode)';
    } else {
      // Tier 2: Full software transcode — libx264 ultrafast
      videoCodecArgs = ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-tune', 'zerolatency'];
      audioCodecArgs = ['-c:a', 'aac', '-ac', '2', '-b:a', '128k'];
      tierLabel = 'Tier 2 (full transcode)';
    }

    console.log(`[Server] ${tierLabel} segment ${segmentIndex} (start: ${startTime}s) for ${infoHash} [${codecs.videoCodec}/${codecs.audioCodec}]`);

    res.setHeader('Content-Type', 'video/mp2t');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');

    const streamUrl = `http://localhost:${port}/stream/${infoHash}`;

    const command = ffmpeg(streamUrl)
      .setStartTime(startTime)
      .setDuration(segmentLength)
      .outputOptions([...videoCodecArgs, ...audioCodecArgs, '-f', 'mpegts'])
      .on('error', (err) => {
        if (!isClientAbortError(err)) {
          console.error(`[Server] Transcoding error for segment ${segment}:`, err.message);
        }
        if (!res.headersSent) res.status(500).send('Transcoding error');
      });

    command.pipe(res, { end: true });

    req.on('close', () => {
      try { command.kill('SIGKILL'); } catch {}
    });
  } catch (err: any) {
    console.error(`[Server] HLS segment error:`, err.message);
    if (!res.headersSent) res.status(500).send(err.message);
  }
});

// ---------------------------------------------------------------------------
// VLC Launch Endpoint
// ---------------------------------------------------------------------------

app.get('/play-vlc/:infoHash', (req, res) => {
  const { infoHash } = req.params;
  const streamUrl = `http://localhost:${port}/stream/${infoHash}`;

  const platform = process.platform;
  let cmd = `vlc "${streamUrl}"`;

  if (platform === 'win32') {
    cmd = `start "" "vlc" "${streamUrl}" || start "" "%ProgramFiles%\\VideoLAN\\VLC\\vlc.exe" "${streamUrl}" || start "" "%ProgramFiles(x86)%\\VideoLAN\\VLC\\vlc.exe" "${streamUrl}"`;
  } else if (platform === 'darwin') {
    cmd = `open -a vlc "${streamUrl}"`;
  }

  console.log(`[Server] Triggering VLC for stream: ${streamUrl}`);

  exec(cmd, (err: any) => {
    if (err) {
      console.error('[Server] Could not start VLC automatically:', err.message);
      return res.status(500).json({ success: false, error: err.message, streamUrl });
    }
    return res.json({ success: true, message: 'VLC launched', streamUrl });
  });
});

// ---------------------------------------------------------------------------
// Telemetry & Real-Time Stats API
// ---------------------------------------------------------------------------

app.get('/stats', (_req, res) => {
  try {
    const torrentsStats: any[] = [];

    for (const [hash, engine] of engines) {
      const file = engine.files && engine.files.length > 0
        ? engine.files.reduce((a: any, b: any) => (a.length > b.length ? a : b), engine.files[0])
        : null;

      const swarm = engine.swarm;

      // torrent-stream exposes download speed via swarm wires
      let dlSpeed = 0;
      let ulSpeed = 0;
      let downloaded = 0;

      if (swarm) {
        // Sum speeds from individual wires
        for (const wire of (swarm.wires || [])) {
          dlSpeed += wire.downloadSpeed?.() || 0;
          ulSpeed += wire.uploadSpeed?.() || 0;
        }
        downloaded = swarm.downloaded || 0;
      }

      torrentsStats.push({
        infoHash: hash,
        name: file?.name || 'Loading...',
        progress: file && file.length > 0 ? ((downloaded / file.length) * 100).toFixed(1) : '0.0',
        downloadSpeed: formatBytes(dlSpeed) + '/s',
        uploadSpeed: formatBytes(ulSpeed) + '/s',
        downloaded: formatBytes(downloaded),
        totalSize: file && file.length ? formatBytes(file.length) : '0 B',
        numPeers: swarm?.wires?.length || 0,
        fileName: file ? file.name : 'Unknown',
        mimeType: file ? getMimeType(file.name) : 'video/mp4',
        durationSeconds: durationCache.get(hash) ?? null,
      });
    }

    // Aggregate speeds across all engines
    let totalDown = 0;
    let totalUp = 0;
    for (const [, engine] of engines) {
      const swarm = engine.swarm;
      if (swarm) {
        for (const wire of (swarm.wires || [])) {
          totalDown += wire.downloadSpeed?.() || 0;
          totalUp += wire.uploadSpeed?.() || 0;
        }
      }
    }

    return res.json({
      status: 'online',
      downloadSpeed: formatBytes(totalDown) + '/s',
      uploadSpeed: formatBytes(totalUp) + '/s',
      activeTorrentsCount: engines.size,
      torrents: torrentsStats,
    });
  } catch (err: any) {
    console.error('[Server] Error rendering stats telemetry:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

// ---------------------------------------------------------------------------
// Start Server
// ---------------------------------------------------------------------------

app.listen(port, () => {
  console.log(`[Server] High-performance P2P proxy server listening on http://localhost:${port}`);
});