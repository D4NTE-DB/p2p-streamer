import fs from 'fs';
import path from 'path';

const CACHE_ROOT = path.join(process.cwd(), 'data', 'subtitles');
const METADATA_DIR = path.join(CACHE_ROOT, 'metadata');
const VTT_DIR = path.join(CACHE_ROOT, 'vtt');

const METADATA_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Ensure directories exist
function ensureDirs() {
  try {
    if (!fs.existsSync(METADATA_DIR)) {
      fs.mkdirSync(METADATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(VTT_DIR)) {
      fs.mkdirSync(VTT_DIR, { recursive: true });
    }
  } catch (err: any) {
    console.error('[SubtitleCache] Failed to initialize cache directories:', err.message);
  }
}

ensureDirs();

function sanitizeId(id: string | number): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '');
}

export interface CachedMetadataEnvelope {
  cachedAt: number;
  data: any[];
}

export function getSubtitleMetadata(imdbId: string): any[] | null {
  try {
    ensureDirs();
    const cleanId = sanitizeId(imdbId);
    const filePath = path.join(METADATA_DIR, `${cleanId}.json`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const fileContent = fs.readFileSync(filePath, 'utf-8');
    const parsed: CachedMetadataEnvelope = JSON.parse(fileContent);

    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.data)) {
      // Corrupt file, remove it
      fs.unlinkSync(filePath);
      return null;
    }

    if (Date.now() - parsed.cachedAt > METADATA_TTL_MS) {
      // Expired metadata
      return null;
    }

    return parsed.data;
  } catch (err: any) {
    console.warn(`[SubtitleCache] Error reading metadata for ${imdbId}:`, err.message);
    return null;
  }
}

export function saveSubtitleMetadata(imdbId: string, data: any[]): void {
  try {
    ensureDirs();
    const cleanId = sanitizeId(imdbId);
    const filePath = path.join(METADATA_DIR, `${cleanId}.json`);
    const envelope: CachedMetadataEnvelope = {
      cachedAt: Date.now(),
      data,
    };
    fs.writeFileSync(filePath, JSON.stringify(envelope, null, 2), 'utf-8');
  } catch (err: any) {
    console.error(`[SubtitleCache] Error saving metadata for ${imdbId}:`, err.message);
  }
}

export function getVttFile(fileId: number | string): string | null {
  try {
    ensureDirs();
    const cleanId = sanitizeId(fileId);
    const filePath = path.join(VTT_DIR, `${cleanId}.vtt`);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content || !content.includes('WEBVTT') && !content.includes('-->')) {
      // Potentially empty or invalid
      return null;
    }

    return content;
  } catch (err: any) {
    console.warn(`[SubtitleCache] Error reading VTT for fileId ${fileId}:`, err.message);
    return null;
  }
}

export function saveVttFile(fileId: number | string, content: string): void {
  try {
    ensureDirs();
    const cleanId = sanitizeId(fileId);
    const filePath = path.join(VTT_DIR, `${cleanId}.vtt`);
    fs.writeFileSync(filePath, content, 'utf-8');
  } catch (err: any) {
    console.error(`[SubtitleCache] Error saving VTT for fileId ${fileId}:`, err.message);
  }
}

export function getCachedImdbIds(): string[] {
  try {
    ensureDirs();
    if (!fs.existsSync(METADATA_DIR)) return [];
    return fs.readdirSync(METADATA_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'));
  } catch (err: any) {
    console.warn('[SubtitleCache] Error reading cached IMDb IDs:', err.message);
    return [];
  }
}

export function getCacheStats() {
  try {
    ensureDirs();
    const cachedIds = getCachedImdbIds();
    const vttCount = fs.existsSync(VTT_DIR) ? fs.readdirSync(VTT_DIR).length : 0;
    return { 
      metadataCount: cachedIds.length, 
      vttCount,
      cachedImdbIds: cachedIds 
    };
  } catch (err: any) {
    return { metadataCount: 0, vttCount: 0, cachedImdbIds: [], error: err.message };
  }
}

