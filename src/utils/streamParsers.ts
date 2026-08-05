export function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr || sizeStr === 'Unknown Size') return 0;
  const match = sizeStr.match(/^([\d.]+)\s*(GB|MB|TB|KB|B)/i);
  if (!match) return 0;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit === 'TB') return val * 1024 * 1024 * 1024 * 1024;
  if (unit === 'GB') return val * 1024 * 1024 * 1024;
  if (unit === 'MB') return val * 1024 * 1024;
  if (unit === 'KB') return val * 1024;
  return val;
}


export function detectLanguages(titleStr: string): string[] {
  const langs = new Set<string>();

  if (/MULTI|DUAL|TRIAUDIO|AUDIO\s*MULTI/i.test(titleStr)) {
    langs.add('MULTI');
  }
  if (/LATINO|LAT|MEXICAN|MEXICO|\bMX\b|SPANISH\s*LATINO/i.test(titleStr)) {
    langs.add('MX');
  }
  if (/CASTELLANO|SPANISH|ESPAÑOL|\bESP\b|[\.\[\-_]ES[\.\]\-_]/i.test(titleStr) && !langs.has('MX')) {
    langs.add('ES');
  }
  if (/ENGLISH|ENG|[\.\[\-_]EN[\.\]\-_]/i.test(titleStr)) {
    langs.add('EN');
  }
  if (/FRENCH|FRANCAIS|FRANÇAIS|[\.\[\-_]FR[\.\]\-_]/i.test(titleStr)) {
    langs.add('FR');
  }
  if (/PORTUGUESE|PORTUGUES|PTBR|PT-BR|[\.\[\-_]PT[\.\]\-_]/i.test(titleStr)) {
    langs.add('PT');
  }
  if (/ITALIAN|ITALIANO|[\.\[\-_]IT[\.\]\-_]/i.test(titleStr)) {
    langs.add('IT');
  }
  if (/GERMAN|DEUTSCH|[\.\[\-_]DE[\.\]\-_]/i.test(titleStr)) {
    langs.add('DE');
  }

  if (langs.size === 0) {
    langs.add('EN');
  }

  return Array.from(langs);
}

export function detectSubtitles(titleStr: string): boolean {
  return /SUB|SUBS|SUBBED|SUBTITULADO|LEGENDADO|VOSE/i.test(titleStr);
}

export function detectFormat(titleStr: string): string {
  const upper = titleStr.toUpperCase();
  if (upper.includes('MKV') || upper.includes('.MKV')) return 'MKV';
  if (upper.includes('MP4') || upper.includes('.MP4')) return 'MP4';
  if (upper.includes('AVI') || upper.includes('.AVI')) return 'AVI';
  return '';
}
