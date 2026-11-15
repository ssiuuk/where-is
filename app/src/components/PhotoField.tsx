import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Image, View } from 'react-native';

import type { Photo } from '@/lib/data';
import { radius, space, useColors } from './theme';
import { Button } from './ui';

/** Shrinks a photo before upload so it's quick on mobile data. */
async function shrink(uri: string): Promise<Photo> {
  try {
    const ctx = ImageManipulator.manipulate(uri).resize({ width: 1280 });
    const ref = await ctx.renderAsync();
    const out = await ref.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return { uri: out.uri, mimeType: 'image/jpeg' };
  } catch {
    return { uri, mimeType: 'image/jpeg' };
  }
}

export async function choosePhoto(source: 'camera' | 'library'): Promise<Photo | null> {
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8 };
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new Error('Allow camera access for Where Is in your phone settings to take photos.');
  }
  const res = source === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets?.[0]) return null;
  return shrink(res.assets[0].uri);
}

type Props = {
  /** URL or local uri of the photo shown now, "" for none. */
  shown: string;
  onPick: (p: Photo) => void;
  onRemove?: () => void;
  onError: (message: string) => void;
};

export function PhotoField({ shown, onPick, onRemove, onError }: Props) {
  const c = useColors();
  const get = async (source: 'camera' | 'library') => {
    try {
      const p = await choosePhoto(source);
      if (p) onPick(p);
    } catch (e) {
      onError((e as Error).message);
    }
  };
  return (
    <View style={{ gap: space.sm }}>
      {shown ? (
        <Image source={{ uri: shown }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: c.border }} resizeMode="cover" />
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' }}>
        <Button kind="secondary" icon="camera-outline" title={shown ? 'Retake' : 'Take photo'} onPress={() => get('camera')} style={{ flexGrow: 1 }} />
        <Button kind="secondary" icon="image-outline" title="Choose" onPress={() => get('library')} style={{ flexGrow: 1 }} />
        {shown && onRemove ? <Button kind="plain" title="Remove photo" onPress={onRemove} /> : null}
      </View>
    </View>
  );
}
