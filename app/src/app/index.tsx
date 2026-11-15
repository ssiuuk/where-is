import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemRow } from '@/components/ItemRow';
import { OfflineNotice } from '@/components/OfflineNotice';
import { font, space, useColors } from '@/components/theme';
import { Button, Empty, Field, Icon, IconButton } from '@/components/ui';
import { useData } from '@/lib/data';
import { searchItems } from '@/lib/search';

export default function Find() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { items, label, status } = useData();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchItems(items, query, (i) => label(i.place)), [items, query, label]);

  const add = () => router.push({ pathname: '/new-item', params: query.trim() ? { name: query.trim() } : {} });

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={{ flexDirection: 'row', gap: space.xs }}>
              <IconButton icon="qrcode-scan" label="Scan a label" onPress={() => router.push('/scan')} />
              <IconButton icon="sitemap-outline" label="Places" onPress={() => router.push('/places')} />
              <IconButton icon="cog-outline" label="Settings" onPress={() => router.push('/settings')} />
            </View>
          ),
        }}
      />
      <View style={{ paddingHorizontal: space.lg, paddingBottom: space.sm, gap: space.sm }}>
        <Field
          value={query}
          onChangeText={setQuery}
          placeholder="Where is…"
          returnKeyType="search"
          autoCorrect={false}
          clearButtonMode="while-editing"
          accessibilityLabel="Search your things"
        />
        <OfflineNotice />
      </View>
      <FlatList
        data={results}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          results.length ? (
            <Text style={{ color: c.muted, fontSize: font.small, paddingHorizontal: space.lg, paddingBottom: space.xs }}>
              {query.trim() ? `${results.length} found` : `${items.length} things, latest first`}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => <ItemRow item={item} onPress={() => router.push(`/i/${item.id}`)} />}
        ListEmptyComponent={
          status === 'loading' ? undefined : query.trim() ? (
            <Empty icon="magnify-close" title={`Nothing called “${query.trim()}”`}>
              Check the spelling, or add it now so it's here next time.
            </Empty>
          ) : (
            <Empty icon="package-variant" title="Nothing recorded yet">
              Add the things you tend to lose, and where you put them. Everyone in your household sees the same list.
            </Empty>
          )
        }
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add item"
        onPress={add}
        style={({ pressed }) => ({
          position: 'absolute',
          right: space.lg,
          bottom: space.lg + insets.bottom,
          backgroundColor: c.accent,
          borderRadius: 28,
          paddingHorizontal: 20,
          height: 56,
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          opacity: pressed ? 0.85 : 1,
          elevation: 4,
        })}
      >
        <Icon name="plus" color={c.accentText} />
        <Text style={{ color: c.accentText, fontWeight: '700', fontSize: font.body }}>
          {query.trim() && !results.length ? `Add “${query.trim()}”` : 'Add item'}
        </Text>
      </Pressable>
    </View>
  );
}
