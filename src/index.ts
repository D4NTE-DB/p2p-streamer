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

// Create temp directories for HLS & CMAF segments
const HLS_TEMP_DIR = path.join(os.tmpdir(), 'p2p-streamer-hls');
const CMAF_TEMP_DIR = path.join(os.tmpdir(), 'p2p-streamer-cmaf');

[HLS_TEMP_DIR, CMAF_TEMP_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// Serve static HLS & CMAF segments
app.use('/hls', express.static(HLS_TEMP_DIR));
app.use('/cmaf', express.static(CMAF_TEMP_DIR));

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

// High-availability public BitTorrent trackers to accelerate peer discovery
const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://tracker.bittorrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://open.demonii.com:1337/announce'
];

// Map of active transcode ffmpeg processes by infoHash
const activeHlsProcesses = new Map<string, any>();
const activeCmafProcesses = new Map<string, any>();

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

function serveTranscodedStream(file: any, req: express.Request, res: express.Response) {
  console.log(`[Server] On-the-fly 1:1 Transcoding for non-web file: ${file.name}`);

  res.setHeader('Content-Type', 'video/mp4');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const inputStream = file.createReadStream();
  const command = ffmpeg(inputStream)
    .videoCodec('libx264')
    .audioCodec('aac')
    .outputOptions([
      '-preset ultrafast',
      '-tune zerolatency',
      '-movflags frag_keyframe+empty_moov+default_base_moof',
      '-map', '0:v:0',
      '-map', '0:a:0?'
    ])
    .format('mp4');

  command.on('error', (err: any) => {
    if (!isClientAbortError(err)) {
      console.error(`[Server] Transcode error for ${file.name}:`, err.message);
    }
  });

  req.on('close', () => {
    try {
      command.kill('SIGKILL');
    } catch {}
    if (typeof inputStream.destroy === 'function') inputStream.destroy();
  });

  command.pipe(res, { end: true });
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

  // If the file is not web compatible, transcode it on the fly
  if (!isNativeWebVideo(file.name)) {
    return serveTranscodedStream(file, req, res);
  }

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
      const torrentId = getMagnetUri(infoHash);
      torrent = client.add(torrentId);
    }

    if (torrent.ready) {
      serveStream(torrent, req, res);
    } else {
      torrent.once('ready', () => serveStream(torrent, req, res));
      torrent.once('error', (err: Error) => {
        console.error(`[Server] Torrent error for infoHash ${infoHash}:`, err.message);
        if (!res.headersSent) res.status(500).send('Torrent error');
      });
    }
  } catch (err: any) {
    console.error(`[Server] Stream setup error:`, err.message);
    if (!res.headersSent) res.status(500).send('Stream setup error');
  }
});

// HLS Live Transcoding Endpoint for Web Player Compatibility (Stremio-style)
app.get('/hls-stream/:infoHash/index.m3u8', async (req, res) => {
  const { infoHash } = req.params;

  if (!infoHash) {
    return res.status(400).send('Missing infoHash');
  }

  console.log(`[Server] Received HLS stream request for infoHash: ${infoHash}`);

  try {
    let torrent = await client.get(infoHash);
    if (!torrent) {
      const torrentId = getMagnetUri(infoHash);
      torrent = client.add(torrentId);
    }

    const startHlsTranscode = () => {
      const targetDir = path.join(HLS_TEMP_DIR, infoHash);
      const playlistFile = path.join(targetDir, 'index.m3u8');
      const segmentPattern = path.join(targetDir, 'segment%03d.ts');

      if (fs.existsSync(playlistFile) && fs.statSync(playlistFile).size > 0) {
        return res.redirect(`/hls/${infoHash}/index.m3u8`);
      }

      if (activeHlsProcesses.has(infoHash)) {
        // Wait for existing process to generate playlist
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          if (fs.existsSync(playlistFile) && fs.statSync(playlistFile).size > 0) {
            clearInterval(checkInterval);
            if (!res.headersSent) res.redirect(`/hls/${infoHash}/index.m3u8`);
          } else if (attempts > 30) {
            clearInterval(checkInterval);
            if (!res.headersSent) res.status(500).send('HLS transcode timeout');
          }
        }, 500);
        return;
      }

      fs.mkdirSync(targetDir, { recursive: true });

      const file = torrent.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
      console.log(`[Server] HLS Transcoding started for: ${file.name}`);

      torrent.files.forEach((f: any) => {
        if (f !== file) f.deselect();
      });
      file.select();

      const stream = file.createReadStream() as any;

      const command = ffmpeg(stream)
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset ultrafast',
          '-g 48',
          '-sc_threshold 0',
          '-hls_time 4',
          '-hls_list_size 0',
          '-hls_segment_filename', segmentPattern
        ])
        .output(playlistFile)
        .on('start', () => {
          let attempts = 0;
          const checkInterval = setInterval(() => {
            attempts++;
            if (fs.existsSync(playlistFile) && fs.statSync(playlistFile).size > 0) {
              clearInterval(checkInterval);
              if (!res.headersSent) {
                res.redirect(`/hls/${infoHash}/index.m3u8`);
              }
            } else if (attempts > 30) {
              clearInterval(checkInterval);
              if (!res.headersSent) res.status(500).send('HLS initialization timeout');
            }
          }, 400);
        })
        .on('error', (err) => {
          if (!isClientAbortError(err)) {
            console.error(`[Server] HLS error for ${file.name}:`, err.message);
          }
          activeHlsProcesses.delete(infoHash);
          if (!res.headersSent) res.status(500).send('HLS Transcoding error');
        })
        .on('end', () => {
          console.log(`[Server] HLS Transcode complete for infoHash: ${infoHash}`);
          activeHlsProcesses.delete(infoHash);
        });

      activeHlsProcesses.set(infoHash, command);
      command.run();
    };

    if (torrent.ready) {
      startHlsTranscode();
    } else {
      torrent.once('ready', startHlsTranscode);
      torrent.once('error', (err: Error) => {
        console.error(`[Server] Torrent error during HLS transcode:`, err.message);
        if (!res.headersSent) res.status(500).send('Torrent error');
      });
    }
  } catch (err: any) {
    console.error(`[Server] HLS setup error:`, err.message);
    if (!res.headersSent) res.status(500).send('HLS setup error');
  }
});

// Universal CMAF Stream Endpoint (DASH .mpd + HLS .m3u8 using shared .m4s segments)
app.get('/cmaf-stream/:infoHash', async (req, res) => {
  const { infoHash } = req.params;
  const formatType = req.query.format === 'hls' ? 'hls' : 'dash';

  if (!infoHash) {
    return res.status(400).send('Missing infoHash');
  }

  console.log(`[Server] Received CMAF stream request (${formatType.toUpperCase()}) for infoHash: ${infoHash}`);

  try {
    let torrent = await client.get(infoHash);
    if (!torrent) {
      const torrentId = getMagnetUri(infoHash);
      torrent = client.add(torrentId);
    }

    const startCmafTranscode = () => {
      const targetDir = path.join(CMAF_TEMP_DIR, infoHash);
      const mpdFile = path.join(targetDir, 'manifest.mpd');
      const hlsFile = path.join(targetDir, 'master.m3u8');
      const initSegPattern = path.join(targetDir, 'init-stream$RepresentationID$.m4s');
      const mediaSegPattern = path.join(targetDir, 'chunk-stream$RepresentationID$-$Number%05d$.m4s');

      const redirectPath = formatType === 'hls' ? `/cmaf/${infoHash}/master.m3u8` : `/cmaf/${infoHash}/manifest.mpd`;
      const targetFileToCheck = formatType === 'hls' ? hlsFile : mpdFile;

      if (fs.existsSync(targetFileToCheck) && fs.statSync(targetFileToCheck).size > 0) {
        return res.redirect(redirectPath);
      }

      if (activeCmafProcesses.has(infoHash)) {
        let attempts = 0;
        const checkInterval = setInterval(() => {
          attempts++;
          if (fs.existsSync(targetFileToCheck) && fs.statSync(targetFileToCheck).size > 0) {
            clearInterval(checkInterval);
            if (!res.headersSent) res.redirect(redirectPath);
          } else if (attempts > 30) {
            clearInterval(checkInterval);
            if (!res.headersSent) res.status(500).send('CMAF initialization timeout');
          }
        }, 400);
        return;
      }

      fs.mkdirSync(targetDir, { recursive: true });

      const file = torrent.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
      console.log(`[Server] CMAF Transcoding started for: ${file.name}`);

      torrent.files.forEach((f: any) => {
        if (f !== file) f.deselect();
      });
      file.select();

      const stream = file.createReadStream() as any;

      // FFmpeg CMAF Muxer Configuration (ABR Multi-Quality 1080p/720p/480p)
      const command = ffmpeg(stream)
        .complexFilter([
          '[0:v]split=3[v1][v2][v3]',
          '[v1]scale=-2:1080[v1out]',
          '[v2]scale=-2:720[v2out]',
          '[v3]scale=-2:480[v3out]'
        ])
        .format('dash')
        .outputOptions([
          '-map', '[v1out]',
          '-map', '[v2out]',
          '-map', '[v3out]',
          '-map', '0:a:0',
          '-c:v', 'libx264',
          '-c:a', 'aac',
          '-b:v:0', '3000k',
          '-b:v:1', '1500k',
          '-b:v:2', '800k',
          '-preset', 'ultrafast',
          '-g', '48',
          '-sc_threshold', '0',
          '-seg_duration', '4',
          '-use_timeline', '1',
          '-use_template', '1',
          '-hls_playlist', '1',
          '-adaptation_sets', 'id=0,streams=0,1,2 id=1,streams=3',
          '-init_seg_name', 'init-stream$RepresentationID$.m4s',
          '-media_seg_name', 'chunk-stream$RepresentationID$-$Number%05d$.m4s'
        ])
        .output(mpdFile)
        .on('stderr', (stderrLine) => {
          console.log('[FFmpeg]', stderrLine);
        })
        .on('start', () => {
          let attempts = 0;
          const checkInterval = setInterval(() => {
            attempts++;
            if (fs.existsSync(targetFileToCheck) && fs.statSync(targetFileToCheck).size > 0) {
              clearInterval(checkInterval);
              if (!res.headersSent) {
                res.redirect(redirectPath);
              }
            } else if (attempts > 30) {
              clearInterval(checkInterval);
              if (!res.headersSent) res.status(500).send('CMAF initialization timeout');
            }
          }, 400);
        })
        .on('error', (err) => {
          if (!isClientAbortError(err)) {
            console.error(`[Server] CMAF error for ${file.name}:`, err.message);
          }
          activeCmafProcesses.delete(infoHash);
          if (!res.headersSent) res.status(500).send('CMAF Transcoding error');
        })
        .on('end', () => {
          console.log(`[Server] CMAF Transcode complete for infoHash: ${infoHash}`);
          activeCmafProcesses.delete(infoHash);
        });

      activeCmafProcesses.set(infoHash, command);
      command.run();
    };

    if (torrent.ready) {
      startCmafTranscode();
    } else {
      torrent.once('ready', startCmafTranscode);
      torrent.once('error', (err: Error) => {
        console.error(`[Server] Torrent error during CMAF transcode:`, err.message);
        if (!res.headersSent) res.status(500).send('Torrent error');
      });
    }
  } catch (err: any) {
    console.error(`[Server] CMAF setup error:`, err.message);
    if (!res.headersSent) res.status(500).send('CMAF setup error');
  }
});

app.get('/stream-transcoded/:infoHash', async (req, res) => {
  const { infoHash } = req.params;

  if (!infoHash) {
    return res.status(400).send('Missing infoHash');
  }

  console.log(`[Server] Received TRANSCODE stream request for infoHash: ${infoHash}`);

  try {
    let torrent = await client.get(infoHash);
    if (!torrent) {
      const torrentId = getMagnetUri(infoHash);
      torrent = client.add(torrentId);
    }

    const startTranscode = () => {
      const file = torrent.files.reduce((a: any, b: any) => (a.length > b.length ? a : b));
      console.log(`[Server] Transcoding file: ${file.name}`);

      torrent.files.forEach((f: any) => {
        if (f !== file) f.deselect();
      });
      file.select();

      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Connection', 'keep-alive');

      const stream = file.createReadStream() as any;

      const command = ffmpeg(stream)
        .videoCodec('libx264')
        .audioCodec('aac')
        .format('mp4')
        .outputOptions([
          '-movflags frag_keyframe+empty_moov',
          '-preset ultrafast',
          '-crf 28',
          '-tune zerolatency'
        ])
        .on('error', (err) => {
          if (!isClientAbortError(err)) {
            console.error(`[Server] Transcoding error for ${file.name}:`, err.message);
          }
          if (!res.headersSent) res.status(500).send('Transcoding error');
        });

      command.pipe(res, { end: true });

      req.on('close', () => {
        if (typeof stream.destroy === 'function') stream.destroy();
        command.kill('SIGKILL');
      });
    };

    if (torrent.ready) {
      startTranscode();
    } else {
      torrent.once('ready', startTranscode);
      torrent.once('error', (err: Error) => {
        console.error(`[Server] Torrent error during transcode for infoHash ${infoHash}:`, err.message);
        if (!res.headersSent) res.status(500).send('Torrent error');
      });
    }
  } catch (err: any) {
    console.error(`[Server] Transcode setup error:`, err.message);
    if (!res.headersSent) res.status(500).send('Transcode setup error');
  }
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
        mimeType: file ? getMimeType(file.name) : 'video/mp4'
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