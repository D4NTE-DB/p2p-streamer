/**
 * Parses a VTT timestamp string into total seconds.
 * Supports "HH:MM:SS.mmm" or "MM:SS.mmm" formats.
 */
export function parseVttTime(timeStr: string): number {
  const parts = timeStr.trim().split(':');
  let seconds = 0;
  
  if (parts.length === 3) {
    // HH:MM:SS.mmm
    seconds += parseInt(parts[0], 10) * 3600;
    seconds += parseInt(parts[1], 10) * 60;
    seconds += parseFloat(parts[2]);
  } else if (parts.length === 2) {
    // MM:SS.mmm
    seconds += parseInt(parts[0], 10) * 60;
    seconds += parseFloat(parts[1]);
  }
  
  if (isNaN(seconds)) return 0;
  return Math.round(seconds * 1000) / 1000;
}

/**
 * Formats total seconds back into a strict VTT timestamp string: "HH:MM:SS.mmm".
 */
export function formatVttTime(totalSeconds: number): string {
  // Prevent negative timestamps
  const safeSeconds = Math.max(0, totalSeconds);
  
  const hrs = Math.floor(safeSeconds / 3600);
  const mins = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  // Round to nearest millisecond to avoid floating point precision issues
  const ms = Math.round((safeSeconds - Math.floor(safeSeconds)) * 1000);
  
  // Handle edge case where rounding pushes ms to 1000
  let adjustedSecs = secs;
  let finalMs = ms;
  if (ms >= 1000) {
    adjustedSecs += 1;
    finalMs = 0;
  }
  
  const hStr = hrs.toString().padStart(2, '0');
  const mStr = mins.toString().padStart(2, '0');
  const sStr = adjustedSecs.toString().padStart(2, '0');
  const msStr = finalMs.toString().padStart(3, '0');
  
  return `${hStr}:${mStr}:${sStr}.${msStr}`;
}

/**
 * Parses a full WebVTT string and mathematically shifts every timestamp boundary 
 * by the specified offset (in seconds).
 */
export function shiftVttTimestamps(vttText: string, offsetSeconds: number): string {
  if (offsetSeconds === 0 || !vttText) return vttText;

  // Regex to match VTT boundary lines, e.g., "00:01:23.450 --> 00:01:25.600"
  // Note: VTT timestamps can omit the hour, so we match loosely on digits/colons/dots
  const boundaryRegex = /^(\d{2,}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2,}:\d{2}:\d{2}\.\d{3}|\d{2}:\d{2}\.\d{3})(.*)$/gm;

  return vttText.replace(boundaryRegex, (match, startStr, endStr, rest) => {
    const startSecs = parseVttTime(startStr);
    const endSecs = parseVttTime(endStr);
    
    const newStart = formatVttTime(startSecs + offsetSeconds);
    const newEnd = formatVttTime(endSecs + offsetSeconds);
    
    return `${newStart} --> ${newEnd}${rest}`;
  });
}
