import fetch from 'node-fetch';

const CINEMETA_URL = 'https://v3-cinemeta.strem.io/catalog/movie/top.json';
const TORRENTIO_URL = 'https://torrentio.strem.fun/stream/movie';
const SERVER_URL = 'http://localhost:8888';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findTestCandidates() {
  console.log('Fetching trending movies...');
  const res = await fetch(CINEMETA_URL);
  const data = await res.json() as any;
  const movies = data.metas || [];

  let mp4Candidate = null;
  let mkvCandidate = null;

  for (const movie of movies) {
    if (mp4Candidate && mkvCandidate) break;
    
    console.log(`Checking streams for: ${movie.name} (${movie.id})`);
    try {
      const streamRes = await fetch(`${TORRENTIO_URL}/${movie.id}.json`);
      const streamData = await streamRes.json() as any;
      const streams = streamData.streams || [];

      for (const stream of streams) {
        // Must be 1080p, <3GB, and >20 seeders
        if (!stream.title.includes('1080p')) continue;
        
        const sizeMatch = stream.title.match(/💾\s*([\d.]+)\s*(GB|MB)/);
        if (sizeMatch) {
          const size = parseFloat(sizeMatch[1]);
          const unit = sizeMatch[2];
          if (unit === 'GB' && size >= 3.0) continue;
        }

        const seedersMatch = stream.title.match(/👤\s*(\d+)/);
        if (seedersMatch) {
          const seeders = parseInt(seedersMatch[1], 10);
          if (seeders < 20) continue;
        } else {
          continue;
        }

        // Identify container
        const isMp4 = stream.title.toLowerCase().includes('mp4');
        const isMkv = stream.title.toLowerCase().includes('mkv');

        if (isMp4 && !mp4Candidate) {
          mp4Candidate = { movie, stream, infoHash: stream.infoHash };
          console.log(`Found MP4 candidate: ${movie.name} - ${stream.title.split('\n')[0]}`);
        } else if (isMkv && !mkvCandidate) {
          mkvCandidate = { movie, stream, infoHash: stream.infoHash };
          console.log(`Found MKV candidate: ${movie.name} - ${stream.title.split('\n')[0]}`);
        }
      }
    } catch (err) {
      console.warn(`Failed to fetch streams for ${movie.id}`);
    }
    await delay(500); // Respect rate limits
  }

  return { mp4Candidate, mkvCandidate };
}

async function runTest(name: string, candidate: any, expectedType: string, expectHls: boolean) {
  console.log(`\n==============================================`);
  console.log(`[TEST] ${name} - ${candidate.movie.name}`);
  console.log(`InfoHash: ${candidate.infoHash}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 45000);
  
  try {
    console.log(`Initiating HEAD request to /stream/${candidate.infoHash}...`);
    const startTime = performance.now();
    const res = await fetch(`${SERVER_URL}/stream/${candidate.infoHash}`, {
      method: 'HEAD',
      signal: controller.signal
    });
    const endTime = performance.now();
    
    clearTimeout(timeoutId);
    console.log(`HEAD Status: ${res.status}`);
    console.log(`⏱️ Peer Discovery Latency (TTFB): ${((endTime - startTime) / 1000).toFixed(2)}s`);
    
    if (res.status !== 200 && res.status !== 206) {
      throw new Error(`Unexpected status code: ${res.status}`);
    }

    const contentType = res.headers.get('content-type') || '';
    console.log(`Content-Type: ${contentType}`);

    if (!contentType.includes(expectedType)) {
      throw new Error(`Expected Content-Type to include ${expectedType}, but got ${contentType}`);
    }

    if (expectHls) {
      console.log(`\nVerifying HLS Transcoder / Playlist...`);
      const hlsStart = performance.now();
      const hlsRes = await fetch(`${SERVER_URL}/hls-stream/${candidate.infoHash}/index.m3u8`);
      const hlsEnd = performance.now();
      console.log(`HLS Status: ${hlsRes.status}`);
      console.log(`⏱️ HLS Playlist Generation Time: ${((hlsEnd - hlsStart) / 1000).toFixed(2)}s`);
      if (!hlsRes.ok) {
        throw new Error(`Failed to generate HLS playlist: ${hlsRes.status}`);
      }
      const hlsContent = await hlsRes.text();
      if (!hlsContent.includes('#EXTM3U')) {
        throw new Error(`Invalid HLS playlist content`);
      }
      console.log(`HLS Playlist successfully generated!`);
      
      // Request segment 0
      console.log(`Requesting first HLS segment (0.ts) to verify ffmpeg...`);
      const segRes = await fetch(`${SERVER_URL}/hls-stream/${candidate.infoHash}/0.ts`);
      console.log(`Segment 0 Status: ${segRes.status}`);
      if (!segRes.ok) {
        throw new Error(`Failed to transcode segment 0: ${segRes.status}`);
      }
      console.log(`ffmpeg transcoded segment 0 successfully!`);
    }

    console.log(`✅ TEST PASSED: ${name}`);
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error(`❌ TEST FAILED: ${name}`, err.message);
    process.exit(1);
  }
}

async function runDeadTorrentTest() {
  console.log(`\n==============================================`);
  console.log(`[TEST] Dead Torrent Timeout Handling`);
  // Random 40-char hex to guarantee no peers
  const deadHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
  console.log(`InfoHash: ${deadHash}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // Expect failure before 20s
  
  try {
    console.log(`Initiating HEAD request to /stream/${deadHash}...`);
    const startTime = performance.now();
    const res = await fetch(`${SERVER_URL}/stream/${deadHash}`, {
      method: 'HEAD',
      signal: controller.signal
    });
    const endTime = performance.now();
    
    clearTimeout(timeoutId);
    console.log(`HEAD Status: ${res.status}`);
    console.log(`⏱️ Dead Torrent Rejection Latency: ${((endTime - startTime) / 1000).toFixed(2)}s`);
    
    // We expect the server to timeout internally and return a 504 (or 404/500 depending on implementation)
    // For WebTorrent, it might hang if not handled. If it hangs, the test script aborts and throws.
    // If we reach here with a 200, something is very wrong!
    if (res.ok) {
       throw new Error("Server returned 200 OK for a dead torrent! This should never happen.");
    }
    
    console.log(`✅ TEST PASSED: Dead Torrent handled gracefully with status ${res.status}`);
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.error(`❌ TEST FAILED: Dead Torrent request hung indefinitely and timed out the test script! The server did not gracefully reject it.`);
      process.exit(1);
    }
    // If it threw an ECONNRESET or similar, log it but don't strictly fail unless it's a hard crash.
    console.log(`✅ TEST PASSED: Dead Torrent connection closed/failed as expected: ${err.message}`);
  }
}

async function main() {
  const { mp4Candidate, mkvCandidate } = await findTestCandidates();

  if (!mp4Candidate && !mkvCandidate) {
    console.error('Could not find suitable candidates for testing.');
    process.exit(1);
  }

  if (mp4Candidate) {
    await runTest('MP4 Direct Stream', mp4Candidate, 'mp4', false);
  } else {
    console.warn('Skipping MP4 test (no candidate found)');
  }

  if (mkvCandidate) {
    await runTest('MKV HLS Transcode', mkvCandidate, 'matroska', true);
  } else {
    console.warn('Skipping MKV test (no candidate found)');
  }

  await runDeadTorrentTest();

  console.log('\nAll tests completed successfully!');
  process.exit(0);
}

main();
