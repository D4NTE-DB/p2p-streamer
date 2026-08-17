export interface PlaybackEvent {
  type: 'play' | 'pause' | 'ended' | 'buffering' | 'seeked' | 'error' | 'progress';
  infoHash?: string;
  currentTime?: number;
  duration?: number;
  timestamp: number;
  detail?: Record<string, unknown>;
}

/**
 * Log playback analytics events.
 * Swappable logger layer: currently outputs structured console logs,
 * but can be connected to Firestore, Firebase Analytics, or external monitoring in the future.
 */
export function logPlaybackEvent(event: PlaybackEvent): void {
  console.log(`[PlayerAnalytics] ${event.type.toUpperCase()}`, {
    infoHash: event.infoHash || 'N/A',
    currentTime: event.currentTime ? `${event.currentTime.toFixed(2)}s` : undefined,
    duration: event.duration ? `${event.duration.toFixed(2)}s` : undefined,
    timestamp: new Date(event.timestamp).toISOString(),
    detail: event.detail,
  });
}
