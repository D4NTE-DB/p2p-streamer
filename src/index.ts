import express from 'express';
import WebTorrent from 'webtorrent';
import cors from 'cors';
import rangeParser from 'range-parser';
import { exec } from 'child_process';
import ffmpeg from 'fluent-ffmpeg';
import ffmpegStatic from 'ffmpeg-static';

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

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Connection', 'keep-alive');

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
      console.error(`[Server] Stream error for ${file.name}:`, err.message);
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
      console.error(`[Server] Stream error for ${file.name}:`, err.message);
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
          console.error(`[Server] Transcoding error for ${file.name}:`, err.message);
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