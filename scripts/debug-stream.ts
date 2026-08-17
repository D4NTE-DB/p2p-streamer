import fetch from 'node-fetch';

const SERVER_URL = 'http://localhost:8888';
const INFO_HASH = '90e301fb88e12f1f0aee0bbf42e3049f9e342e4b';

async function main() {
  console.log(`\n==============================================`);
  console.log(`[DEBUG] Analyzing InfoHash: ${INFO_HASH}`);
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  
  try {
    console.log(`Initiating HEAD request to /stream/${INFO_HASH}...`);
    const startTime = performance.now();
    const res = await fetch(`${SERVER_URL}/stream/${INFO_HASH}`, {
      method: 'HEAD',
      signal: controller.signal
    });
    const endTime = performance.now();
    
    clearTimeout(timeoutId);
    console.log(`HEAD Status: ${res.status}`);
    console.log(`⏱️ TTFB: ${((endTime - startTime) / 1000).toFixed(2)}s`);
    console.log(`Content-Type: ${res.headers.get('content-type')}`);

    if (res.status === 504) {
      console.error(`❌ Torrent is DEAD (504 Gateway Timeout). The proxy found 0 seeders after 15 seconds.`);
      process.exit(1);
    }
    
    if (res.status === 200 || res.status === 206) {
      console.log(`\nTorrent is ALIVE! Verifying HLS Transcoder...`);
      const hlsStart = performance.now();
      const hlsRes = await fetch(`${SERVER_URL}/hls-stream/${INFO_HASH}/index.m3u8`);
      const hlsEnd = performance.now();
      
      console.log(`HLS Status: ${hlsRes.status}`);
      console.log(`⏱️ HLS Playlist Generation Time: ${((hlsEnd - hlsStart) / 1000).toFixed(2)}s`);
      
      if (!hlsRes.ok) {
        console.error(`❌ HLS Playlist Generation FAILED!`);
        const text = await hlsRes.text();
        console.error(`Response: ${text}`);
      } else {
        console.log(`✅ HLS Playlist generated successfully.`);
      }
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.error(`❌ DEBUG FAILED:`, err.message);
  }
}

main();
