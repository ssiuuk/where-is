import { useState } from 'react';
import { Text, View } from 'react-native';

import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { font, radius, space, useColors } from './theme';
import { Button, ErrorText } from './ui';

/** Shown on a place while someone is carrying an item they scanned. */
export function CarryingBanner({ placeId }: { placeId: string }) {
  const c = useColors();
  const { carrying, setCarrying, items, moveItems, label } = useData();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const item = items.find((i) => i.id === carrying);
  if (!item) return null;
  if (item.place === placeId) {
    return null;
  }
  const put = async () => {
    setBusy(true);
    setError('');
    try {
      await moveItems([item.id], placeId);
      setCarrying('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ backgroundColor: c.tape, borderRadius: radius.md, padding: space.md, gap: space.sm }}>
      <Text style={{ color: c.tapeText, fontSize: font.body, fontWeight: '700' }}>{`Put ${item.name} here?`}</Text>
      <Text style={{ color: c.tapeText }}>{`It's recorded in ${label(item.place) || 'no place yet'}.`}</Text>
      <ErrorText>{error}</ErrorText>
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Put it here" icon="arrow-down-bold-box-outline" onPress={put} busy={busy} style={{ flex: 1 }} />
        <Button title="Not now" kind="secondary" onPress={() => setCarrying('')} style={{ backgroundColor: c.card }} />
      </View>
    </View>
  );
}
