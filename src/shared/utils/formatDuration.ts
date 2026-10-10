/** "48s", "12m 31s", "1h 05m": a length of time for people, from milliseconds. */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** How long between two ISO timestamps, formatted; null when either is missing or unreadable. */
export function durationBetween(startIso: string | null | undefined, endIso: string | null | undefined): string | null {
  if (!startIso || !endIso) return null;
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  return Number.isFinite(ms) && ms >= 0 ? formatDuration(ms) : null;
}
