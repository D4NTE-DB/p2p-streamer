import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { app } from '../src/index';

// Increase timeout for network/P2P operations
vi.setConfig({ testTimeout: 30000 });

describe('P2P Proxy Server API', () => {
  describe('GET /stats', () => {
    it('should return server status and torrent stats', async () => {
      const response = await request(app).get('/stats');
      
      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'online');
      expect(response.body).toHaveProperty('downloadSpeed');
      expect(response.body).toHaveProperty('activeTorrentsCount');
      expect(Array.isArray(response.body.torrents)).toBe(true);
    });
  });

  describe('HEAD /stream/:infoHash', () => {
    it('should gracefully timeout and return 504 for a dead torrent', async () => {
      // 40-character hex string guaranteed to have 0 peers
      const deadHash = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef';
      
      const startTime = Date.now();
      const response = await request(app).head(`/stream/${deadHash}`);
      const duration = Date.now() - startTime;
      
      // Our server is configured to timeout at 15000ms. 
      // It should return 504.
      expect(response.status).toBe(504);
      
      // Ensure the timeout actually happened around the 15s mark (give or take network overhead)
      expect(duration).toBeGreaterThanOrEqual(14000);
    });
  });
  
  describe('Subtitles API', () => {
    it('should require fileId for download', async () => {
      // Assuming a generic fileId that might not exist, we just want to ensure the API 
      // responds with the correct format, not a raw 500 crash.
      const response = await request(app).get('/api/subtitles/download/9999999999');
      
      // Depending on OPENSUBTITLES_API_KEY, it might be 503 (missing key), 404 (not found), or 406 (invalid file ID)
      expect([404, 503, 429, 406]).toContain(response.status);
    });
  });
});
