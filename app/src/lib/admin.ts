import * as Print from 'expo-print';
import * as Linking from 'expo-linking';
import PocketBase from 'pocketbase';
import { Platform } from 'react-native';

import { labelSheetHtml, LabelInput } from './labels';

export type Roles = { site: boolean; family: boolean; siteNeedsVerify: boolean };
export const noRoles: Roles = { site: false, family: false, siteNeedsVerify: false };

export type MemberInfo = {
  id: string;
  name: string;
  email: string;
  last_active: string;
  created: string;
  owner: boolean;
  disabled: boolean;
  google: boolean;
};

export type Account = MemberInfo & { household: string; verified: boolean; site_admin: boolean; family_admin: boolean };

export type Family = {
  household: string;
  name: string;
  invite_code: string;
  invites_off: boolean;
  members: MemberInfo[];
  mail: boolean;
};

export type DupRecord = { id: string; name: string; place: string; note: string; photo: boolean; items?: number; updated: string };
export type Duplicates = { items: DupRecord[][]; places: DupRecord[][] };

export type TrashEntry = { id: string; kind: 'item' | 'place'; name: string; place: string; photo: boolean; by: string; created: string };

export type Activity = { id: string; action: string; kind: string; record: string; name: string; detail: string; by: string; created: string };

export type Stats = {
  items: number;
  places: number;
  members: number;
  withPhoto: number;
  noPlace: number;
  photoBytes: number;
  unlabeled: number;
  trash: number;
  changesThisWeek: number;
  staleTotal: number;
  stale: { id: string; name: string; place: string; since: string }[];
};

export type ImportResult = { items: number; places: number; skipped: number };

export type MailSettings = {
  enabled: boolean;
  host: string;
  port: number;
  username: string;
  hasPassword: boolean;
  tls: boolean;
  fromAddress: string;
  fromName: string;
  locked: boolean;
};

export type GoogleStatus = { enabled: boolean; configured: boolean; clientId: string; locked: boolean; redirectUrl: string };

export type Site = {
  signup: { open: boolean; locked: boolean };
  mail: MailSettings;
  google: GoogleStatus;
  appUrl: string;
  admins: string[];
};

export type Backup = { name: string; size: number; modified: string };
export type Backups = { backups: Backup[]; cron: string; keep: number; busy: boolean };

const F = '/api/whereis/admin/family';
const S = '/api/whereis/admin/site';

/** The admin endpoints. The server checks the role on every call. */
export function adminApi(pb: PocketBase) {
  const get = <T>(path: string) => pb.send<T>(path, { method: 'GET' });
  const post = <T>(path: string, body?: unknown) => pb.send<T>(path, { method: 'POST', body: body ?? {} });
  const put = <T>(path: string, body: unknown) => pb.send<T>(path, { method: 'PUT', body });
  const id = encodeURIComponent;
  return {
    roles: () => get<Roles>('/api/whereis/admin/roles'),

    family: () => get<Family>(F),
    invite: (action: 'new' | 'off' | 'on') => post<Family>(`${F}/invite`, { action }),
    removeMember: (user: string) => post<Family>(`${F}/members/${id(user)}/remove`),
    familyResetEmail: (user: string) => post(`${F}/members/${id(user)}/reset-email`),
    handOver: (user: string) => post(`${F}/owner`, { user }),
    importCsv: (kind: 'items' | 'places', csv: string, dryRun: boolean) => post<ImportResult>(`${F}/import`, { kind, csv, dryRun }),
    duplicates: () => get<Duplicates>(`${F}/duplicates`),
    merge: (kind: 'items' | 'places', keep: string, merge: string[]) => post(`${F}/merge`, { kind, keep, merge }),
    trash: () => get<{ items: TrashEntry[]; days: number }>(`${F}/trash`),
    restore: (entry: string) => post(`${F}/trash/${id(entry)}/restore`),
    deleteForever: (entry: string) => pb.send(`${F}/trash/${id(entry)}`, { method: 'DELETE' }),
    activity: (page: number) => get<{ items: Activity[]; page: number; more: boolean }>(`${F}/activity?page=${page}`),
    stats: () => get<Stats>(`${F}/stats`),

    site: () => get<Site>(S),
    setSignup: (open: boolean) => put<{ open: boolean }>(`${S}/signup`, { open }),
    setMail: (m: Omit<MailSettings, 'hasPassword' | 'locked'> & { password?: string }) => put<Site>(`${S}/mail`, m),
    testMail: (to: string) => post<{ to: string }>(`${S}/mail/test`, { to }),
    setGoogle: (g: { enabled: boolean; clientId?: string; clientSecret?: string }) => put<GoogleStatus>(`${S}/google`, g),
    checkGoogle: () => post<{ ok: boolean; problems: string[]; redirectUrl: string }>(`${S}/google/check`),
    accounts: () => get<Account[]>(`${S}/users`),
    setDisabled: (user: string, disabled: boolean) => pb.send(`${S}/users/${id(user)}`, { method: 'PATCH', body: { disabled } }),
    deleteAccount: (user: string) => pb.send(`${S}/users/${id(user)}`, { method: 'DELETE' }),
    newPassword: (user: string) => post<{ password: string }>(`${S}/users/${id(user)}/password`),
    siteResetEmail: (user: string) => post(`${S}/users/${id(user)}/reset-email`),
    backups: () => get<Backups>(`${S}/backups`),
    backupNow: () => post<{ name: string }>(`${S}/backups`),
    deleteBackup: (name: string) => pb.send(`${S}/backups/${id(name)}`, { method: 'DELETE' }),
    restoreBackup: (name: string) => post(`${S}/backups/${id(name)}/restore`),
    scheduleBackups: (every: 'off' | 'daily' | 'weekly', keep: number) => put<{ cron: string; keep: number }>(`${S}/backups/schedule`, { every, keep }),
    uploadBackup: (file: File) => {
      const form = new FormData();
      form.append('file', file, file.name);
      return pb.send<{ name: string }>(`${S}/backups/upload`, { method: 'POST', body: form });
    },
  };
}

export type AdminApi = ReturnType<typeof adminApi>;

/**
 * Opens a download (a CSV export or a backup) as a plain link: in a browser
 * it saves the file, on a phone it opens in the browser. The link carries a
 * file token that stops working after a few minutes.
 */
export async function openDownload(pb: PocketBase, path: string): Promise<void> {
  const token = await pb.files.getToken();
  const url = pb.buildURL(`/api/whereis/admin/download/${path}`) + `?token=${encodeURIComponent(token)}`;
  if (Platform.OS === 'web') {
    const a = document.createElement('a');
    a.href = url;
    a.rel = 'noopener';
    a.click();
  } else {
    await Linking.openURL(url);
  }
}

/** Prints a sheet of QR labels (or saves it as a PDF from the print dialog). */
export function printLabels(labels: LabelInput[], size: 'small' | 'large'): Promise<void> {
  return printHtml(labelSheetHtml(labels, size));
}

/**
 * Opens the print dialog for a page of HTML; it can also save a PDF. It
 * resolves once the dialog has closed. Neither browsers nor phones say
 * whether anything was actually printed, so callers that record printing
 * should ask.
 */
export async function printHtml(html: string): Promise<void> {
  if (Platform.OS === 'web') {
    const w = window.open('', '_blank');
    if (!w) throw new Error('The browser blocked the print window. Allow pop-ups for this site and try again.');
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    await new Promise<void>((resolve) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearInterval(closed);
        resolve();
      };
      // the dialog closed (printed or cancelled), or the window was shut
      w.addEventListener('afterprint', finish);
      const closed = setInterval(() => w.closed && finish(), 500);
      // let the SVGs lay out before the print dialog takes a snapshot
      setTimeout(() => {
        try {
          w.print();
        } catch {
          finish();
        }
      }, 300);
    });
    return;
  }
  await Print.printAsync({ html });
}

/** Lets a browser user pick a file (CSV text, or a backup zip). */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    if (Platform.OS !== 'web') return resolve(null);
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
