// Moving "this phone only" to a server: everything goes up in one request
// (keeping the same ids, so labels and stickers keep working), then each
// photo. Safe to run again after a failure: the server skips what it already
// has, and photos that made it are no longer on the phone's list.

import PocketBase from 'pocketbase';

import { photoForm } from './data';
import { clearPhoneData, deletePhoto, loadPhoneData, photoFileUri, savePhoneData } from './phonefiles';
import { isEmpty, uploadBody } from './phonestore';

export type UploadResult = { places: number; items: number; photos: number; photosFailed: number };

export async function phoneSummary(): Promise<{ items: number; places: number } | null> {
  try {
    const d = await loadPhoneData();
    return isEmpty(d) ? null : { items: d.items.length, places: d.places.length };
  } catch {
    return null;
  }
}

export async function uploadPhoneData(pb: PocketBase, onProgress?: (text: string) => void): Promise<UploadResult> {
  let d = await loadPhoneData();
  onProgress?.(`Uploading ${d.items.length} items and ${d.places.length} places…`);
  const res = await pb.send<{ places: number; items: number }>('/api/whereis/import-phone', { method: 'POST', body: uploadBody(d) });

  const withPhoto = d.items.filter((i) => i.photo);
  let photos = 0;
  let photosFailed = 0;
  for (const item of withPhoto) {
    onProgress?.(`Uploading photos (${photos + photosFailed + 1} of ${withPhoto.length})…`);
    try {
      await pb.collection('items').update(item.id, await photoForm({}, { uri: photoFileUri(item.photo), mimeType: 'image/jpeg' }));
      photos++;
      // done with this one: a retry won't send it again
      d = { ...d, items: d.items.map((i) => (i.id === item.id ? { ...i, photo: '' } : i)) };
      await savePhoneData(d);
      deletePhoto(item.photo);
    } catch {
      photosFailed++;
    }
  }
  if (!photosFailed) clearPhoneData();
  return { places: res.places, items: res.items, photos, photosFailed };
}
