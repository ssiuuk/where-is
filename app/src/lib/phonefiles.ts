// Where "this phone only" keeps things: one JSON file for the household and
// a folder of photos, inside the app's own storage. Uninstalling the app
// deletes them, which is why Settings offers a backup file.

import { Directory, File, Paths } from 'expo-file-system';

import { asPhoneData, Backup, emptyPhoneData, makeBackup, newId, parseBackup, PhoneData } from './phonestore';

const root = () => new Directory(Paths.document, 'phone');
const dataFile = () => new File(root(), 'data.json');
const photoDir = () => new Directory(root(), 'photos');

function ensureDirs() {
  if (!root().exists) root().create({ intermediates: true, idempotent: true });
  if (!photoDir().exists) photoDir().create({ intermediates: true, idempotent: true });
}

export async function loadPhoneData(): Promise<PhoneData> {
  const f = dataFile();
  if (!f.exists) return emptyPhoneData();
  return asPhoneData(JSON.parse(await f.text()));
}

/** Writes to a new file first, so a crash mid-write can't leave half a file. */
export async function savePhoneData(d: PhoneData): Promise<void> {
  ensureDirs();
  const tmp = new File(root(), 'data.json.new');
  if (tmp.exists) tmp.delete();
  tmp.create();
  await tmp.write(JSON.stringify(d));
  await tmp.move(dataFile(), { overwrite: true });
}

export function hasPhoneData(): boolean {
  try {
    return dataFile().exists;
  } catch {
    return false;
  }
}

/** Deletes the phone's household and photos (after they reached a server). */
export function clearPhoneData() {
  const r = root();
  if (r.exists) r.delete();
}

export const photoFileUri = (name: string) => (name ? new File(photoDir(), name).uri : '');

/** Copies a picked photo into the app's storage and returns its file name. */
export async function keepPhoto(uri: string, itemId: string): Promise<string> {
  ensureDirs();
  const name = `${itemId}_${newId().slice(0, 6)}.jpg`;
  await new File(uri).copy(new File(photoDir(), name));
  return name;
}

export function deletePhoto(name: string) {
  if (!name) return;
  try {
    const f = new File(photoDir(), name);
    if (f.exists) f.delete();
  } catch {
    // already gone
  }
}

export async function photoBase64(name: string): Promise<string> {
  return new File(photoDir(), name).base64();
}

export async function writePhoto(name: string, base64: string): Promise<void> {
  ensureDirs();
  const f = new File(photoDir(), name);
  if (f.exists) f.delete();
  f.create();
  await f.write(base64, { encoding: 'base64' });
}

// ---------------------------------------------------------------------
// backup file

/** Writes everything, photos included, into one file and returns it to share. */
export async function writeBackup(name: string): Promise<File> {
  const data = await loadPhoneData();
  const photos: Record<string, string> = {};
  for (const i of data.items) {
    if (!i.photo) continue;
    try {
      photos[i.photo] = await photoBase64(i.photo);
    } catch {
      // a photo file that went missing: the rest still gets saved
    }
  }
  const backup = makeBackup(name, data, photos);
  const day = backup.saved.slice(0, 10);
  const f = new File(Paths.cache, `where-is-backup-${day}.json`);
  if (f.exists) f.delete();
  f.create();
  await f.write(JSON.stringify(backup));
  return f;
}

/** Asks for a backup file and reads it, or returns null if the person cancelled. */
export async function pickBackup(): Promise<Backup | null> {
  const picked = await File.pickFileAsync({ mimeTypes: ['application/json', 'text/plain', 'application/octet-stream'] });
  if (picked.canceled) return null;
  return parseBackup(await picked.result.text());
}

/** Replaces what's on the phone with a backup. */
export async function restoreBackup(backup: Backup): Promise<void> {
  const dir = photoDir();
  if (dir.exists) dir.delete();
  for (const [name, base64] of Object.entries(backup.photos)) await writePhoto(name, base64);
  await savePhoneData(backup.data);
}
