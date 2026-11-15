import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { OfflineNotice } from '@/components/OfflineNotice';
import { font, space, useColors } from '@/components/theme';
import { Button, Empty, ErrorText, Field, Icon } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { placeTree } from '@/lib/places';

export default function Places() {
  const c = useColors();
  const { places, items, ensurePlace } = useData();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rows = useMemo(() => placeTree(places), [places]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of items) if (i.place) m.set(i.place, (m.get(i.place) ?? 0) + 1);
    return m;
  }, [items]);

  const add = async () => {
    setBusy(true);
    setError('');
    try {
      await ensurePlace(name);
      setName('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.place.id}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={
        <View style={{ padding: space.lg, gap: space.sm }}>
          <OfflineNotice />
          <Field
            value={name}
            onChangeText={setName}
            placeholder="New place, e.g. Garage > Shelf 3"
            returnKeyType="done"
            onSubmitEditing={add}
          />
          <ErrorText>{error}</ErrorText>
          <Button kind="secondary" icon="plus" title="Add place" onPress={add} busy={busy} disabled={!name.trim()} />
        </View>
      }
      ListEmptyComponent={
        <Empty icon="sitemap-outline" title="No places yet">
          Start with rooms, then add what's in them: cupboards, shelves, drawers, boxes.
        </Empty>
      }
      renderItem={({ item: r }) => (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push(`/p/${r.place.id}`)}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.sm,
            paddingVertical: 14,
            paddingRight: space.lg,
            paddingLeft: space.lg + r.depth * 22,
            backgroundColor: pressed ? c.accentSoft : c.card,
            borderBottomWidth: 1,
            borderColor: c.border,
          })}
        >
          <Icon name={r.depth ? 'subdirectory-arrow-right' : 'home-outline'} size={18} color={c.muted} />
          <Text style={{ color: c.text, fontSize: font.body, flex: 1, fontWeight: r.depth ? '400' : '600' }}>{r.place.name}</Text>
          <Text style={{ color: c.muted, fontVariant: ['tabular-nums'] }}>{counts.get(r.place.id) ?? ''}</Text>
        </Pressable>
      )}
    />
  );
}
