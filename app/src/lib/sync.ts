import { timeAgo } from './time.ts';

/** The line under "Sync now" in Settings. */
export function syncStatusText(s: { syncing: boolean; status: 'loading' | 'live' | 'offline'; savedAt: string }, now: Date = new Date()): string {
  if (s.syncing) return 'Syncing with the server…';
  const ago = timeAgo(s.savedAt, now);
  const at = s.savedAt ? new Date(s.savedAt.replace(' ', 'T')) : null;
  const when = ago && at && !isNaN(at.getTime()) ? `${ago} (${at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})` : '';
  if (s.status === 'offline') {
    return when
      ? `Can't reach the server. This device is showing its saved copy from ${when}.`
      : "Can't reach the server, and this device has no saved copy yet.";
  }
  if (s.status === 'loading') return when ? `Checking the server… Last synced ${when}.` : 'Checking the server…';
  return when ? `Connected to the server. Last full sync ${when}.` : 'Connected to the server.';
}
