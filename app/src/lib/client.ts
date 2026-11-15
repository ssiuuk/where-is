import AsyncStorage from '@react-native-async-storage/async-storage';
import PocketBase, { AsyncAuthStore } from 'pocketbase';
import EventSource from 'react-native-sse';

// PocketBase's realtime updates (and Google sign-in) use EventSource,
// which React Native doesn't have built in.
const g = globalThis as { EventSource?: unknown };
if (!g.EventSource) g.EventSource = EventSource;

export const SERVER_KEY = 'whereis.server';
const AUTH_KEY = 'whereis.auth';

export async function savedServer(): Promise<string> {
  try {
    return (await AsyncStorage.getItem(SERVER_KEY)) ?? '';
  } catch {
    return '';
  }
}

export async function saveServer(url: string): Promise<void> {
  if (url) await AsyncStorage.setItem(SERVER_KEY, url);
  else await AsyncStorage.removeItem(SERVER_KEY);
}

/** A PocketBase client for this server whose sign-in survives restarts. */
export async function createClient(serverUrl: string): Promise<PocketBase> {
  let initial = '';
  try {
    initial = (await AsyncStorage.getItem(AUTH_KEY)) ?? '';
  } catch {
    // start signed out
  }
  const store = new AsyncAuthStore({
    save: async (serialized) => AsyncStorage.setItem(AUTH_KEY, serialized),
    clear: async () => AsyncStorage.removeItem(AUTH_KEY),
    initial,
  });
  const pb = new PocketBase(serverUrl, store);
  // screens fire overlapping requests on purpose (e.g. typing in search)
  pb.autoCancellation(false);
  return pb;
}

/** Turns a PocketBase error into a sentence to show. */
export function errorMessage(e: unknown): string {
  const err = e as { status?: number; response?: { message?: string; data?: Record<string, { message?: string }> }; message?: string };
  if (err?.status === 0) return "Can't reach the server. Check your connection and try again.";
  const fieldErrors = Object.entries(err?.response?.data ?? {})
    .map(([field, v]) => (v?.message ? `${field}: ${v.message}` : ''))
    .filter(Boolean);
  if (fieldErrors.length) return fieldErrors.join('\n');
  return err?.response?.message || err?.message || 'Something went wrong.';
}
