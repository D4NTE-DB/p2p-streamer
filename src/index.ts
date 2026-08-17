import express from 'express';
import WebTorrent from 'webtorrent';
import cors from 'cors';
import rangeParser from 'range-parser';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';
import ffprobeStatic from 'ffprobe-static';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  getSubtitleMetadata,
  saveSubtitleMetadata,
  getVttFile,
  saveVttFile,
  getCacheStats
} from './subtitleCache';

function loadEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('[Server] Could not load .env file:', err.message);
  }
}
loadEnv();

if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic as unknown as string);
}
if (ffprobeStatic && ffprobeStatic.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path);
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

// OpenSubtitles Helper Function to Search Subtitles
async function fetchOpenSubtitlesSearch(imdbId: string, lang: string = 'en'): Promise<any[]> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    console.warn('[OpenSubtitles] OPENSUBTITLES_API_KEY is not set or is using placeholder.');
    return [];
  }

  // OpenSubtitles accepts imdb_id as numeric or with tt prefix
  const languages = lang === 'all' ? 'en' : lang || 'en';
  const url = `https://api.opensubtitles.com/api/v1/subtitles?imdb_id=${encodeURIComponent(imdbId)}&languages=${encodeURIComponent(languages)}&order_by=download_count&order_direction=desc`;

  const response = await fetch(url, {
    headers: {
      'Api-Key': apiKey,
      'User-Agent': 'P2PStreamer v1.0.0',
      'Accept': 'application/json',
    },
  });

  if (response.status === 429) {
    console.warn('[OpenSubtitles] Rate limit reached (429).');
    return [];
  }

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    console.error(`[OpenSubtitles] Search failed with status ${response.status}: ${errText}`);
    return [];
  }

  const json: any = await response.json();
  const rawData = Array.isArray(json?.data) ? json.data : [];

  const tracks = rawData.map((item: any) => {
    const attr = item.attributes || {};
    const file = Array.isArray(attr.files) && attr.files[0] ? attr.files[0] : {};
    return {
      fileId: file.file_id,
      label: attr.release || `${attr.language || 'Subtitles'} (${file.file_name || 'VTT'})`,
      language: attr.language || 'en',
      downloadCount: attr.download_count || 0,
      hearingImpaired: !!attr.hearing_impaired,
    };
  }).filter((t: any) => t.fileId);

  return tracks;
}

// OpenSubtitles Search Endpoint (Cache-First)
app.get('/api/subtitles/search', async (req, res) => {
  const imdbId = req.query.imdbId as string;
  const lang = (req.query.lang as string) || 'en';

  if (!imdbId) {
    return res.status(400).json({ error: 'Missing imdbId query parameter', data: [] });
  }

  try {
    // 1. Check local persistent disk cache first
    const cached = getSubtitleMetadata(imdbId);
    if (cached && Array.isArray(cached) && cached.length > 0) {
      return res.json({ data: cached, cached: true });
    }

    // 2. Fetch from OpenSubtitles API
    const tracks = await fetchOpenSubtitlesSearch(imdbId, lang);
    if (tracks.length > 0) {
      saveSubtitleMetadata(imdbId, tracks);
    }

    return res.json({ data: tracks, cached: false });
  } catch (err: any) {
    console.error(`[Server] Error searching subtitles for ${imdbId}:`, err.message);
    return res.status(500).json({ error: 'Failed to retrieve subtitles', data: [] });
  }
});

let openSubtitlesToken: string | null = null;
let tokenExpiresAt: number = 0;

async function getOpenSubtitlesAuthToken(): Promise<string | null> {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  const username = process.env.OPENSUBTITLES_USERNAME;
  const password = process.env.OPENSUBTITLES_PASSWORD;

  if (!apiKey || !username || !password) {
    return null;
  }

  // Reuse existing token if valid
  if (openSubtitlesToken && Date.now() < tokenExpiresAt) {
    return openSubtitlesToken;
  }

  try {
    const res = await fetch('https://api.opensubtitles.com/api/v1/login', {
      method: 'POST',
      headers: {
        'Api-Key': apiKey,
        'User-Agent': 'P2PStreamer v1.0.0',
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ username, password }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      console.warn(`[OpenSubtitles] Login failed (${res.status}): ${text}`);
      return null;
    }

    const data: any = await res.json();
    if (data?.token) {
      openSubtitlesToken = data.token;
      tokenExpiresAt = Date.now() + 6 * 60 * 60 * 1000; // 6 hours
      console.log(`[OpenSubtitles] Logged in as "${data.user?.level || 'User'}" (Downloads left: ${data.user?.allowed_downloads ?? 'N/A'})`);
      return openSubtitlesToken;
    }
  } catch (err: any) {
    console.error('[OpenSubtitles] Login error:', err.message);
  }

  return null;
}

// OpenSubtitles Download Endpoint (Cache-First with VTT conversion)
app.get('/api/subtitles/download/:fileId', async (req, res) => {
  const { fileId } = req.params;

  if (!fileId) {
    return res.status(400).send('Missing fileId');
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // 1. Check local disk cache for cached .vtt file
    const cachedVtt = getVttFile(fileId);
    if (cachedVtt) {
      res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
      return res.send(cachedVtt);
    }

    const apiKey = process.env.OPENSUBTITLES_API_KEY;
    if (!apiKey || apiKey === 'your-api-key-here') {
      console.warn('[OpenSubtitles] Cannot download subtitle: OPENSUBTITLES_API_KEY missing.');
      return res.status(503).send('OpenSubtitles API key not configured on proxy server');
    }

    const headers: Record<string, string> = {
      'Api-Key': apiKey,
      'User-Agent': 'P2PStreamer v1.0.0',
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const token = await getOpenSubtitlesAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // 2. Request download link from OpenSubtitles in webvtt format
    const dlResponse = await fetch('https://api.opensubtitles.com/api/v1/download', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        file_id: parseInt(fileId, 10),
        sub_format: 'webvtt',
      }),
    });

    if (dlResponse.status === 429) {
      console.warn('[OpenSubtitles] Download rate limit reached (429).');
      return res.status(429).send('OpenSubtitles rate limit reached. Please try again later.');
    }

    if (!dlResponse.ok) {
      const errText = await dlResponse.text().catch(() => '');
      console.error(`[OpenSubtitles] Download request failed (${dlResponse.status}): ${errText}`);
      return res.status(dlResponse.status).send('Failed to obtain download link from OpenSubtitles');
    }

    const dlJson: any = await dlResponse.json();
    const downloadLink = dlJson?.link;

    if (!downloadLink) {
      console.error('[OpenSubtitles] No download link returned:', dlJson);
      return res.status(500).send('OpenSubtitles did not provide a download link');
    }

    // 3. Fetch the raw subtitle file content
    const fileRes = await fetch(downloadLink);
    if (!fileRes.ok) {
      console.error(`[OpenSubtitles] Fetching raw subtitle failed with status ${fileRes.status}`);
      return res.status(fileRes.status).send('Failed to fetch subtitle content from source URL');
    }

    let vttContent = await fileRes.text();

    // Ensure it starts with WEBVTT if missing
    if (!vttContent.trim().startsWith('WEBVTT')) {
      vttContent = `WEBVTT\n\n${vttContent}`;
    }

    // 4. Save permanently to disk cache
    saveVttFile(fileId, vttContent);

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    return res.send(vttContent);
  } catch (err: any) {
    console.error(`[Server] Error downloading subtitle file ${fileId}:`, err.message);
    return res.status(500).send('Internal error downloading subtitle');
  }
});

// Cache diagnostics endpoint
app.get('/api/subtitles/cache-stats', (_req, res) => {
  return res.json({ status: 'online', cache: getCacheStats() });
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
      // Polyfill unpipe for WebTorrent stream to prevent fluent-ffmpeg crash
      if (typeof inputStream.unpipe !== 'function') {
        inputStream.unpipe = () => {};
      }
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

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

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

    const READY_TIMEOUT_MS = 15000;
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

    const READY_TIMEOUT_MS = 15000;
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

// Background Subtitle Pre-warming for Trending Movies
async function prewarmTrendingSubtitles() {
  const apiKey = process.env.OPENSUBTITLES_API_KEY;
  if (!apiKey || apiKey === 'your-api-key-here') {
    console.log('[Subtitles Pre-warm] Skipped: OPENSUBTITLES_API_KEY not configured.');
    return;
  }

  console.log('[Subtitles Pre-warm] Starting background pre-warming for trending movies...');

  try {
    const res = await fetch('https://v3-cinemeta.strem.io/catalog/movie/top.json', {
      headers: {
        'User-Agent': 'Stremio/4.4.168 (desktop)',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) {
      console.warn(`[Subtitles Pre-warm] Failed to fetch trending movies (status: ${res.status})`);
      return;
    }

    const data: any = await res.json();
    const movies = Array.isArray(data?.metas) ? data.metas : [];
    console.log(`[Subtitles Pre-warm] Found ${movies.length} trending movies to verify.`);

    let cachedCount = 0;
    let fetchedCount = 0;

    // Pre-warm the top 25 movies
    const candidateList = movies.slice(0, 25);

    for (const movie of candidateList) {
      if (!movie || !movie.id) continue;

      const existing = getSubtitleMetadata(movie.id);
      if (existing && existing.length > 0) {
        cachedCount++;
        continue;
      }

      // Throttle: 300ms between requests to stay well within OpenSubtitles rate limits
      await new Promise((resolve) => setTimeout(resolve, 300));

      const tracks = await fetchOpenSubtitlesSearch(movie.id, 'en');
      if (tracks.length > 0) {
        saveSubtitleMetadata(movie.id, tracks);
        fetchedCount++;
        console.log(`[Subtitles Pre-warm] Cached ${tracks.length} subtitles for "${movie.name}" (${movie.id})`);
      }
    }

    console.log(`[Subtitles Pre-warm] Finished: ${cachedCount} already cached, ${fetchedCount} freshly pre-warmed.`);
  } catch (err: any) {
    console.warn('[Subtitles Pre-warm] Non-fatal error during pre-warming:', err.message);
  }
}

if (process.env.NODE_ENV !== 'test') {
  app.listen(port, () => {
    console.log(`[Server] High-performance P2P proxy server listening on http://localhost:${port}`);
    prewarmTrendingSubtitles().catch((err) => {
      console.warn('[Subtitles Pre-warm] Background pre-warm failed:', err.message);
    });
  });
}

export { app };