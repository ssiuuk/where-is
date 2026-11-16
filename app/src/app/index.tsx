import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemRow } from '@/components/ItemRow';
import { Chip } from '@/components/NamesField';
import { OfflineNotice } from '@/components/OfflineNotice';
import { PhoneUpload } from '@/components/PhoneUpload';
import { font, space, useColors } from '@/components/theme';
import { Button, Empty, Field, Icon, IconButton } from '@/components/ui';
import { useData } from '@/lib/data';
import { matchedAlias, searchItems, withTag } from '@/lib/search';

export default function Find() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { items, label, status, tags } = useData();
  const params = useLocalSearchParams<{ tag?: string }>();
  const [query, setQuery] = useState('');
  // a tag chosen here, or tapped on an item's page
  const [tag, setTag] = useState(params.tag ?? '');
  useEffect(() => {
    if (params.tag) setTag(params.tag);
  }, [params.tag]);
  // a tag nobody uses any more (its last item was deleted or changed) stops filtering
  const activeTag = tags.some((t) => t.tag === tag) ? tag : '';
  const shown = useMemo(() => withTag(items, activeTag), [items, activeTag]);
  const results = useMemo(() => searchItems(shown, query, (i) => label(i.place)), [shown, query, label]);

  const add = () => router.push({ pathname: '/new-item', params: query.trim() ? { name: query.trim() } : {} });
  const chooseTag = (t: string) => {
    setTag(t);
    router.setParams({ tag: t || undefined });
  };

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
        {tags.length ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: space.sm }}>
            {activeTag ? <Chip text="All" icon="close" accessibilityLabel="Show everything" onPress={() => chooseTag('')} /> : null}
            {tags.map(({ tag: t, count }) => (
              <Chip
                key={t}
                text={`#${t} ${count}`}
                selected={t === activeTag}
                accessibilityLabel={`${t}, ${count} ${count === 1 ? 'thing' : 'things'}`}
                onPress={() => chooseTag(t === activeTag ? '' : t)}
              />
            ))}
          </ScrollView>
        ) : null}
        <OfflineNotice />
        <PhoneUpload />
      </View>
      <FlatList
        data={results}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 96 + insets.bottom }}
        ListHeaderComponent={
          results.length ? (
            <Text style={{ color: c.muted, fontSize: font.small, paddingHorizontal: space.lg, paddingBottom: space.xs }}>
              {query.trim()
                ? `${results.length} found${activeTag ? ` in #${activeTag}` : ''}`
                : `${shown.length} ${shown.length === 1 ? 'thing' : 'things'}${activeTag ? ` tagged #${activeTag}` : ''}, latest first`}
            </Text>
          ) : undefined
        }
        renderItem={({ item }) => (
          <ItemRow item={item} alias={matchedAlias(item, query)} onPress={() => router.push(`/i/${item.id}`)} />
        )}
        ListEmptyComponent={
          status === 'loading' ? undefined : query.trim() ? (
            <Empty icon="magnify-close" title={`Nothing called “${query.trim()}”${activeTag ? ` in #${activeTag}` : ''}`}>
              {activeTag
                ? 'Check the spelling, or tap All to search everything.'
                : "Check the spelling, or add it now so it's here next time. Giving things other names helps search find them."}
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
