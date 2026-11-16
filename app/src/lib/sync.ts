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

/**
 * Runs fetches so that only the newest one may change what's shown: an older one that finishes
 * later is dropped. `settle` waits for whichever fetch finally counts, so a manual sync reports
 * success only when fresh data was really applied, and fails if the newest fetch failed.
 */
export function latestOnly() {
  let seq = 0;
  let newest: Promise<boolean> | null = null;
  return {
    /** Resolves true once applied, false if a newer fetch replaced it; rejects with the fetch's error. */
    run<T>(fetch: () => Promise<T>, apply: (v: T) => void | Promise<void>, onError?: (e: unknown) => void): Promise<boolean> {
      const mine = ++seq;
      const p = (async () => {
        try {
          const v = await fetch();
          if (mine !== seq) return false;
          await apply(v);
          return true;
        } catch (e) {
          if (mine === seq) onError?.(e);
          throw e;
        }
      })();
      newest = p;
      // nobody may be waiting on an older fetch
      p.catch(() => {});
      return p;
    },
    /** Follows a fetch until one is applied; rejects only if the newest one, the one that counts, failed. */
    async settle(p: Promise<boolean>): Promise<void> {
      for (;;) {
        try {
          if (await p) return;
        } catch (e) {
          if (p === newest) throw e;
          // a newer fetch replaced this one: its failure doesn't matter
        }
        p = newest as Promise<boolean>;
      }
    },
  };
}

/** "Sync now" got fresh lists but a later step failed: shown as a warning, not "Sync failed". */
export class PartialSyncError extends Error {}
