import * as WebBrowser from 'expo-web-browser';
import PocketBase from 'pocketbase';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { createClient, savedServer, saveServer } from './client';
import { normalizeServerUrl } from './links';
import type { Household } from './types';

export type SessionUser = { id: string; name: string; email: string; household: string; collectionId: string; avatar: string };

type Session = {
  ready: boolean;
  serverUrl: string;
  pb: PocketBase | null;
  user: SessionUser | null;
  household: Household | null;
  connectServer(input: string): Promise<void>;
  forgetServer(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
  signInWithGoogle(): Promise<void>;
  googleAvailable(): Promise<boolean>;
  signupOpen(): Promise<boolean>;
  signOut(): void;
  createHousehold(name: string): Promise<void>;
  joinHousehold(code: string): Promise<void>;
  leaveHousehold(): Promise<void>;
  newInviteCode(): Promise<void>;
  renameHousehold(name: string): Promise<void>;
  refresh(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  /** A message for the sign-in screen, e.g. after a password change signed this device out. */
  notice: string;
  requestPasswordReset(email: string): Promise<void>;
};

/** The new password was saved, but signing back in with it failed. */
export class PasswordChangedError extends Error {
  constructor() {
    super('Your password was changed, but signing back in failed. Sign in with your new password.');
    this.name = 'PasswordChangedError';
  }
}

const SessionContext = createContext<Session | null>(null);

/**
 * In the browser the app is served by the server itself, so the server is
 * wherever the page came from. EXPO_PUBLIC_SERVER_URL overrides it for
 * development with `npx expo start --web`.
 */
export const webServerUrl =
  Platform.OS === 'web'
    ? normalizeServerUrl(process.env.EXPO_PUBLIC_SERVER_URL || (typeof window !== 'undefined' ? window.location.origin : ''))
    : '';

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

/** Narrows the session to a signed-in member of a household. */
export function useMember() {
  const s = useSession();
  if (!s.pb || !s.user || !s.household) throw new Error('useMember needs a household');
  return { ...s, pb: s.pb, user: s.user, household: s.household };
}

function toUser(model: Record<string, unknown> | null): SessionUser | null {
  if (!model) return null;
  return {
    id: String(model.id),
    name: String(model.name ?? ''),
    email: String(model.email ?? ''),
    household: String(model.household ?? ''),
    collectionId: String(model.collectionId ?? ''),
    avatar: String(model.avatar ?? ''),
  };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState('');
  const [pb, setPb] = useState<PocketBase | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [household, setHousehold] = useState<Household | null>(null);
  const [notice, setNotice] = useState('');

  const loadHousehold = useCallback(async (client: PocketBase, u: SessionUser | null) => {
    if (!u?.household) {
      setHousehold(null);
      return;
    }
    try {
      const h = await client.collection('households').getOne<Household>(u.household);
      setHousehold(h);
    } catch (e) {
      const status = (e as { status?: number }).status;
      // offline: keep a placeholder so the cached lists still show
      if (status === 0) setHousehold((prev) => prev ?? { id: u.household, name: '', invite_code: '', owner: '' });
      else setHousehold(null);
    }
  }, []);

  const adopt = useCallback(
    async (client: PocketBase) => {
      const u = toUser(client.authStore.record as Record<string, unknown> | null);
      setUser(u);
      await loadHousehold(client, u);
    },
    [loadHousehold],
  );

  // start up: reopen the last server and sign-in
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = webServerUrl || (await savedServer());
      if (url) {
        const client = await createClient(url);
        if (client.authStore.isValid) {
          try {
            await client.collection('users').authRefresh();
          } catch (e) {
            // a rejected token signs out; no connection keeps the saved sign-in
            if ((e as { status?: number }).status !== 0) client.authStore.clear();
          }
        }
        if (cancelled) return;
        setServerUrl(url);
        setPb(client);
        await adopt(client);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [adopt]);

  const connectServer = useCallback(async (input: string) => {
    const url = normalizeServerUrl(input);
    if (!url) throw new Error('Enter the server address, like whereis.example.com.');
    const client = await createClient(url);
    try {
      await client.health.check();
    } catch {
      throw new Error(`Can't reach a Where Is server at ${url}. Check the address and your connection.`);
    }
    client.authStore.clear();
    await saveServer(url);
    setServerUrl(url);
    setPb(client);
    setUser(null);
    setHousehold(null);
  }, []);

  const forgetServer = useCallback(async () => {
    pb?.authStore.clear();
    pb?.realtime.unsubscribe().catch(() => {});
    await saveServer('');
    setServerUrl('');
    setPb(null);
    setUser(null);
    setHousehold(null);
  }, [pb]);

  const need = useCallback(() => {
    if (!pb) throw new Error('Choose a server first.');
    return pb;
  }, [pb]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const client = need();
      await client.collection('users').authWithPassword(email.trim(), password);
      setNotice('');
      await adopt(client);
    },
    [need, adopt],
  );

  const signUp = useCallback(
    async (name: string, email: string, password: string) => {
      const client = need();
      await client.collection('users').create({ name: name.trim(), email: email.trim(), password, passwordConfirm: password });
      await client.collection('users').authWithPassword(email.trim(), password);
      await adopt(client);
    },
    [need, adopt],
  );

  const googleAvailable = useCallback(async () => {
    if (!pb) return false;
    try {
      const methods = await pb.collection('users').listAuthMethods();
      return methods.oauth2.enabled && methods.oauth2.providers.some((p) => p.name === 'google');
    } catch {
      return false;
    }
  }, [pb]);

  const signupOpen = useCallback(async () => {
    if (!pb) return false;
    try {
      const c = await pb.send<{ signup: boolean }>('/api/whereis/config', {});
      return c.signup !== false;
    } catch {
      return true; // an older server: let it decide
    }
  }, [pb]);

  const signInWithGoogle = useCallback(async () => {
    const client = need();
    try {
      await client.collection('users').authWithOAuth2(
        Platform.OS === 'web'
          ? // in a browser the SDK opens its own popup window
            { provider: 'google' }
          : {
              provider: 'google',
              urlCallback: (url) => {
                WebBrowser.openBrowserAsync(url).catch(() => {});
              },
            },
      );
    } finally {
      if (Platform.OS !== 'web') WebBrowser.dismissBrowser().catch(() => {});
    }
    await adopt(client);
  }, [need, adopt]);

  const signOut = useCallback(() => {
    pb?.realtime.unsubscribe().catch(() => {});
    pb?.authStore.clear();
    setUser(null);
    setHousehold(null);
  }, [pb]);

  const refresh = useCallback(async () => {
    const client = need();
    await client.collection('users').authRefresh();
    await adopt(client);
  }, [need, adopt]);

  const changePassword = useCallback(
    async (current: string, next: string) => {
      const client = need();
      const me = client.authStore.record;
      if (!me) throw new Error('Sign in first.');
      await client.collection('users').update(me.id, { oldPassword: current, password: next, passwordConfirm: next });
      // a new password signs out every device, this one included: sign straight back in
      try {
        await client.collection('users').authWithPassword(me.email, next);
        await adopt(client);
      } catch {
        // the password did change; only signing back in failed (e.g. the network dropped)
        const err = new PasswordChangedError();
        setNotice(err.message);
        client.authStore.clear();
        setUser(null);
        setHousehold(null);
        throw err;
      }
    },
    [need, adopt],
  );

  const requestPasswordReset = useCallback(
    async (email: string) => {
      await need().collection('users').requestPasswordReset(email.trim());
    },
    [need],
  );

  const createHousehold = useCallback(
    async (name: string) => {
      await need().send('/api/whereis/households', { method: 'POST', body: { name } });
      await refresh();
    },
    [need, refresh],
  );

  const joinHousehold = useCallback(
    async (code: string) => {
      await need().send('/api/whereis/join', { method: 'POST', body: { code } });
      await refresh();
    },
    [need, refresh],
  );

  const leaveHousehold = useCallback(async () => {
    await need().send('/api/whereis/leave', { method: 'POST' });
    await refresh();
  }, [need, refresh]);

  const newInviteCode = useCallback(async () => {
    const h = await need().send<Household>('/api/whereis/invite-code', { method: 'POST' });
    setHousehold(h);
  }, [need]);

  const renameHousehold = useCallback(
    async (name: string) => {
      if (!household) return;
      const h = await need().collection('households').update<Household>(household.id, { name: name.trim() });
      setHousehold(h);
    },
    [need, household],
  );

  const value = useMemo<Session>(
    () => ({
      ready, serverUrl, pb, user, household,
      connectServer, forgetServer, signIn, signUp, signInWithGoogle, googleAvailable, signupOpen, signOut,
      createHousehold, joinHousehold, leaveHousehold, newInviteCode, renameHousehold, refresh,
      changePassword, requestPasswordReset, notice,
    }),
    [ready, serverUrl, pb, user, household, connectServer, forgetServer, signIn, signUp, signInWithGoogle,
      googleAvailable, signupOpen, signOut, createHousehold, joinHousehold, leaveHousehold, newInviteCode, renameHousehold, refresh,
      changePassword, requestPasswordReset, notice],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
