import express from 'express';
import WebTorrent from 'webtorrent';
import cors from 'cors';
import rangeParser from 'range-parser';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import fs from 'fs';
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

// Temporary directories for chunks removed

// Use CORS to allow requests from the React frontend (e.g., http://localhost:5173)
app.use(cors());

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

const client = new WebTorrent();

client.on('error', (err: string | Error) => {
  const msg = typeof err === 'string' ? err : err.message;
  console.error('[Server] WebTorrent client error:', msg);
});

// Resource limits for Torrents
const torrentLastAccessed = new Map<string, number>();
const MAX_ACTIVE_TORRENTS = 3;
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function evictIdleTorrents() {
  const now = Date.now();
  for (const t of client.torrents) {
    const lastAccess = torrentLastAccessed.get(t.infoHash) || 0;
    if (now - lastAccess > IDLE_TIMEOUT_MS) {
      console.log(`[Server] Evicting idle torrent: ${t.infoHash}`);
      client.remove(t.infoHash, { destroyStore: true });
      durationCache.delete(t.infoHash);
      torrentLastAccessed.delete(t.infoHash);
    }
  }

  // If we are at the limit, evict the oldest
  if (client.torrents.length >= MAX_ACTIVE_TORRENTS) {
    let oldestHash: string | null = null;
    let oldestTime = now;
    for (const t of client.torrents) {
      const time = torrentLastAccessed.get(t.infoHash) || 0;
      if (time < oldestTime) {
        oldestTime = time;
        oldestHash = t.infoHash;
      }
    }
    if (oldestHash) {
      console.log(`[Server] Evicting oldest torrent to respect limit: ${oldestHash}`);
      client.remove(oldestHash, { destroyStore: true });
      durationCache.delete(oldestHash);
      torrentLastAccessed.delete(oldestHash);
    }
  }
}

function attachTorrentLogging(torrent: any) {
  if (torrent.__loggingAttached) return;
  torrent.__loggingAttached = true;
  
  torrent.on('noPeers', (announceType: string) => {
    console.warn(`[Server] No peers found for ${torrent.infoHash} via ${announceType}`);
  });

  torrent.on('warning', (err: any) => {
    console.warn(`[Server] Torrent warning for ${torrent.infoHash}:`, err?.message || err);
  });
}

function prioritizePieces(torrent: any) {
  if (torrent.__prioritized) return;
  torrent.__prioritized = true;
  
  const totalPieces = torrent.pieces.length;
  if (totalPieces > 0) {
    // First 5 pieces for instant playback start
    torrent.critical(0, Math.min(4, totalPieces - 1));
    // Last 5 pieces for MKV Cues / MP4 moov at file end
    torrent.critical(Math.max(0, totalPieces - 5), totalPieces - 1);
  }
}

// High-availability public BitTorrent trackers to accelerate peer discovery
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittorrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://open.demonii.com:1337/announce'
];

// Active transcode processes removed (chunks architecture disabled)

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

const durationCache = new Map<string, number>();
const durationPromises = new Map<string, Promise<number>>();

function getOrProbeDuration(file: any, infoHash: string): Promise<number> {
  if (durationCache.has(infoHash)) return Promise.resolve(durationCache.get(infoHash)!);
  if (durationPromises.has(infoHash)) return durationPromises.get(infoHash)!;

  const promise = new Promise<number>((resolve, reject) => {
    try {
      const inputStream = file.createReadStream();
      ffmpeg(inputStream).ffprobe((err: any, metadata: any) => {
        if (typeof inputStream.destroy === 'function') inputStream.destroy();
        if (err) {
          console.error(`[Server] ffprobe duration check failed for ${file.name}:`, err.message);
          return reject(err);
        }
        const duration = metadata?.format?.duration;
        if (duration && !isNaN(duration) && isFinite(duration) && duration > 0) {
          const parsedDuration = parseFloat(duration);
          durationCache.set(infoHash, parsedDuration);
          console.log(`[Server] Duration sniffed for ${infoHash}: ${parsedDuration}s`);
          resolve(parsedDuration);
        } else {
          reject(new Error('Invalid duration from ffprobe'));
        }
      });
    } catch (err: any) {
      console.error(`[Server] Error probing duration for ${file.name}:`, err.message);
      reject(err);
    }
  });

  durationPromises.set(infoHash, promise);
  promise.finally(() => durationPromises.delete(infoHash)).catch(() => {});

  return promise;
}

function serveStream(torrent: any, req: express.Request, res: express.Response) {
  // Find the largest file in the torrent (usually the main video)
  const file = torrent.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
  const mimeType = getMimeType(file.name);
  console.log(`[Server] Streaming file: ${file.name} (${formatBytes(file.length)}, MIME: ${mimeType})`);

  // Prioritize main video file & deselect non-video files
  torrent.files.forEach((f: any) => {
    if (f !== file) f.deselect();
  });
  file.select();

  // Trigger background duration sniffing via ffprobe
  getOrProbeDuration(file, torrent.infoHash).catch(() => {});

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
    let torrent = await client.get(infoHash);
    if (!torrent) {
      evictIdleTorrents();
      const torrentId = getMagnetUri(infoHash);
      torrent = client.add(torrentId, { strategy: 'sequential' });
    }
    
    torrentLastAccessed.set(infoHash, Date.now());
    attachTorrentLogging(torrent);

    const READY_TIMEOUT_MS = 30000;
    const readyTimeout = setTimeout(() => {
      if (!torrent.ready) {
        console.warn(`[Server] Discovery timeout for ${infoHash}`);
        client.remove(infoHash, { destroyStore: true });
        durationCache.delete(infoHash);
        torrentLastAccessed.delete(infoHash);
        if (!res.headersSent) res.status(504).send('Torrent discovery timed out');
      }
    }, READY_TIMEOUT_MS);

    const onReady = () => {
      clearTimeout(readyTimeout);
      prioritizePieces(torrent);
      serveStream(torrent, req, res);
    };

    if (torrent.ready) {
      onReady();
    } else {
      torrent.once('ready', onReady);
      torrent.once('error', (err: Error) => {
        clearTimeout(readyTimeout);
        console.error(`[Server] Torrent error for infoHash ${infoHash}:`, err.message);
        if (!res.headersSent) res.status(500).send('Torrent error');
      });
    }
  } catch (err: any) {
    console.error(`[Server] Stream setup error:`, err.message);
    if (!res.headersSent) res.status(500).send('Stream setup error');
  }
});


app.get('/hls-stream/:infoHash/index.m3u8', async (req, res) => {
  const { infoHash } = req.params;

  if (!infoHash) {
    return res.status(400).send('Missing infoHash');
  }

  console.log(`[Server] Generating HLS playlist for infoHash: ${infoHash}`);

  try {
    let torrent = await client.get(infoHash);
    if (!torrent) {
      evictIdleTorrents();
      const torrentId = getMagnetUri(infoHash);
      torrent = client.add(torrentId, { strategy: 'sequential' });
    }

    torrentLastAccessed.set(infoHash, Date.now());
    attachTorrentLogging(torrent);

    const READY_TIMEOUT_MS = 30000;
    const readyTimeout = setTimeout(() => {
      if (!torrent.ready) {
        console.warn(`[Server] Discovery timeout for ${infoHash} (HLS playlist)`);
        client.remove(infoHash, { destroyStore: true });
        durationCache.delete(infoHash);
        torrentLastAccessed.delete(infoHash);
        if (!res.headersSent) res.status(504).send('Torrent discovery timed out');
      }
    }, READY_TIMEOUT_MS);

    const generatePlaylist = async () => {
      clearTimeout(readyTimeout);
      prioritizePieces(torrent);

      const file = torrent.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
      torrent.files.forEach((f: any) => {
        if (f !== file) f.deselect();
      });
      file.select();

      try {
        const duration = await getOrProbeDuration(file, infoHash);
        
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
      } catch (err) {
        console.error(`[Server] Failed to generate playlist, couldn't get duration for ${infoHash}:`, err);
        if (!res.headersSent) res.status(500).send('Could not determine duration for HLS');
      }
    };

    if (torrent.ready) {
      generatePlaylist();
    } else {
      torrent.once('ready', generatePlaylist);
      torrent.once('error', (err: Error) => {
        clearTimeout(readyTimeout);
        console.error(`[Server] Torrent error during HLS playlist for infoHash ${infoHash}:`, err.message);
        if (!res.headersSent) res.status(500).send('Torrent error');
      });
    }
  } catch (err: any) {
    console.error(`[Server] HLS playlist setup error:`, err.message);
    if (!res.headersSent) res.status(500).send('HLS playlist setup error');
  }
});

app.get('/hls-stream/:infoHash/:segment', (req, res) => {
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

  console.log(`[Server] Transcoding segment ${segmentIndex} (start: ${startTime}s) for infoHash: ${infoHash}`);

  res.setHeader('Content-Type', 'video/mp2t');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const streamUrl = `http://localhost:${port}/stream/${infoHash}`;

  const command = ffmpeg(streamUrl)
    .setStartTime(startTime)
    .setDuration(segmentLength)
    .videoCodec('libx264')
    .audioCodec('aac')
    .outputOptions([
      '-preset ultrafast',
      '-crf 28',
      '-tune zerolatency',
      '-f mpegts'
    ])
    .on('error', (err) => {
      if (!isClientAbortError(err)) {
        console.error(`[Server] Transcoding error for segment ${segment}:`, err.message);
      }
      if (!res.headersSent) res.status(500).send('Transcoding error');
    });

  command.pipe(res, { end: true });

  req.on('close', () => {
    try {
      command.kill('SIGKILL');
    } catch {}
  });
});

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

// Telemetry & Real-Time Stats API for Frontend Monitoring
app.get('/stats', (_req, res) => {
  try {
    const torrentsStats = client.torrents.map((t: any) => {
      const file = t.files && t.files.length > 0 ? t.files.reduce((a: any, b: any) => (a.length > b.length ? a : b), t.files[0]) : null;
      const progress = typeof t.progress === 'number' ? (t.progress * 100).toFixed(1) : '0.0';
      return {
        infoHash: t.infoHash || '',
        name: t.name || 'Loading...',
        progress,
        downloadSpeed: formatBytes(t.downloadSpeed) + '/s',
        uploadSpeed: formatBytes(t.uploadSpeed) + '/s',
        downloaded: formatBytes(t.downloaded),
        totalSize: file && file.length ? formatBytes(file.length) : formatBytes(t.length),
        numPeers: t.numPeers || 0,
        fileName: file ? file.name : 'Unknown',
        mimeType: file ? getMimeType(file.name) : 'video/mp4',
        durationSeconds: durationCache.get(t.infoHash) ?? null
      };
    });

    return res.json({
      status: 'online',
      downloadSpeed: formatBytes(client.downloadSpeed) + '/s',
      uploadSpeed: formatBytes(client.uploadSpeed) + '/s',
      activeTorrentsCount: client.torrents.length,
      torrents: torrentsStats
    });
  } catch (err: any) {
    console.error('[Server] Error rendering stats telemetry:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

app.listen(port, () => {
  console.log(`[Server] High-performance P2P proxy server listening on http://localhost:${port}`);
});