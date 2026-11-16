// Where "this phone only" keeps things: one JSON file for the household and
// a folder of photos, inside the app's own storage. Uninstalling the app
// deletes them, which is why Settings offers a backup file.

import { Directory, File, Paths } from 'expo-file-system';

import { asPhoneData, emptyPhoneData, newId, PhoneData } from './phonestore';

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
