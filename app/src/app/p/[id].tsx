import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, Text, View } from 'react-native';

import { CarryingBanner } from '@/components/CarryingBanner';
import { ItemRow } from '@/components/ItemRow';
import { OfflineNotice } from '@/components/OfflineNotice';
import { OpenInApp } from '@/components/OpenInApp';
import { PlacePicker } from '@/components/PlacePicker';
import { font, radius, space, useColors } from '@/components/theme';
import { Body, Button, ConfirmRow, Empty, ErrorText, Field, Heading, Icon, Tape } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { descendants, placeTree } from '@/lib/places';
import { searchItems } from '@/lib/search';

/**
 * A place: what's in it, and the quickest way to record putting something
 * here. Scanning a shelf's QR code or NFC sticker opens this screen.
 */
export default function PlaceScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useData();
  const place = data.places.find((p) => p.id === id);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [panel, setPanel] = useState<'' | 'rename' | 'add-inside' | 'move' | 'delete'>('');
  const [text, setText] = useState('');
  const [movedHere, setMovedHere] = useState(0);

  const inside = useMemo(() => (id ? descendants(data.places, id) : new Set<string>()), [data.places, id]);
  const here = useMemo(() => data.items.filter((i) => i.place === id), [data.items, id]);
  const deeperCount = useMemo(() => data.items.filter((i) => inside.has(i.place)).length, [data.items, inside]);
  const children = useMemo(() => placeTree(data.places).filter((r) => r.place.parent === id), [data.places, id]);
  const { items, label } = data;
  const candidates = useMemo(
    () => (query.trim() ? searchItems(items.filter((i) => i.place !== id), query, (i) => label(i.place)).slice(0, 8) : []),
    [items, label, query, id],
  );

  if (!place || !id) {
    return (
      <>
        <Stack.Screen options={{ title: 'Not found' }} />
        <Empty icon="map-marker-question-outline" title="This place isn't in your household">
          It may have been deleted, or the label belongs to another household.
        </Empty>
      </>
    );
  }

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError('');
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy('');
    }
  };

  const putHere = (itemId: string) =>
    act(itemId, async () => {
      await data.moveItems([itemId], id);
      setMovedHere((n) => n + 1);
      setQuery('');
    });

  const header = (
    <View style={{ padding: space.lg, gap: space.md }}>
      <Stack.Screen options={{ title: place.name }} />
      {place.parent ? <Tape text={data.label(place.parent)} /> : null}
      <OpenInApp kind="p" id={id} />
      <OfflineNotice />
      <CarryingBanner placeId={id} />

      <Heading>Put something here</Heading>
      <Field value={query} onChangeText={setQuery} placeholder="Search your things" autoCorrect={false} />
      {candidates.map((item) => (
        <View key={item.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ color: c.text, fontSize: font.body, fontWeight: '600' }}>
              {item.name}
            </Text>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: font.small }}>
              {data.label(item.place) || 'No place yet'}
            </Text>
          </View>
          <Button title="Put here" kind="secondary" busy={busy === item.id} onPress={() => putHere(item.id)} />
        </View>
      ))}
      {query.trim() && !candidates.length ? <Body muted>{`No other item matches “${query.trim()}”.`}</Body> : null}
      <Button
        icon="plus"
        kind="secondary"
        title={query.trim() && !candidates.length ? `Add “${query.trim()}” here` : 'Add a new item here'}
        onPress={() =>
          router.push({ pathname: '/new-item', params: { place: id, ...(query.trim() ? { name: query.trim() } : {}) } })
        }
      />
      <ErrorText>{error}</ErrorText>

      {children.length ? (
        <>
          <Heading>Places inside</Heading>
          {children.map((r) => (
            <Pressable
              key={r.place.id}
              accessibilityRole="button"
              onPress={() => router.push(`/p/${r.place.id}`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 8 }}
            >
              <Icon name="subdirectory-arrow-right" size={18} color={c.muted} />
              <Text style={{ color: c.accent, fontSize: font.body, flex: 1 }}>{r.place.name}</Text>
              <Text style={{ color: c.muted, fontVariant: ['tabular-nums'] }}>
                {data.items.filter((i) => i.place === r.place.id).length}
              </Text>
            </Pressable>
          ))}
        </>
      ) : null}

      <Heading>{`In ${place.name} (${here.length})`}</Heading>
      {movedHere ? <Body muted>{`You put ${movedHere} ${movedHere === 1 ? 'thing' : 'things'} here just now.`}</Body> : null}
    </View>
  );

  const footer = (
    <View style={{ padding: space.lg, gap: space.sm }}>
      {deeperCount ? <Body muted>{`${deeperCount} more in the places inside.`}</Body> : null}
      {!here.length ? <Body muted>Nothing recorded directly in this place.</Body> : null}
      <Heading>This place</Heading>
      <Button
        kind="secondary"
        icon="tag-outline"
        title="Label: QR code or NFC sticker"
        onPress={() => router.push({ pathname: '/label', params: { kind: 'p', id } })}
      />
      <Button
        kind="secondary"
        icon="plus-box-outline"
        title="Add a place inside"
        onPress={() => {
          setText('');
          setPanel('add-inside');
        }}
      />
      <Button
        kind="plain"
        title="Rename"
        onPress={() => {
          setText(place.name);
          setPanel('rename');
        }}
      />
      <Button kind="plain" title="Move into another place" onPress={() => setPanel('move')} />
      {panel === 'delete' ? (
        <ConfirmRow
          ask={`Delete ${place.name}? Only an empty place can be deleted.`}
          busy={busy === 'delete'}
          onCancel={() => setPanel('')}
          onConfirm={async () => {
            const ok = await act('delete', () => data.deletePlace(id));
            setPanel('');
            if (ok) router.back();
          }}
        />
      ) : (
        <Button kind="plain" title="Delete place" onPress={() => setPanel('delete')} />
      )}
    </View>
  );

  const sheetSubmit = async () => {
    if (panel === 'rename') {
      if (await act('sheet', () => data.updatePlace(id, { name: text.trim() }))) setPanel('');
    } else if (panel === 'add-inside') {
      let newId = '';
      if (await act('sheet', async () => (newId = await data.ensurePlace(text, id)))) {
        setPanel('');
        router.push(`/p/${newId}`);
      }
    }
  };

  return (
    <>
      <FlatList
        data={here}
        keyExtractor={(i) => i.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        renderItem={({ item }) => <ItemRow item={item} onPress={() => router.push(`/i/${item.id}`)} />}
      />

      <Modal visible={panel === 'rename' || panel === 'add-inside'} transparent animationType="fade" onRequestClose={() => setPanel('')}>
        <Pressable accessibilityLabel="Close" onPress={() => setPanel('')} style={{ flex: 1, backgroundColor: '#0007' }} />
        <View style={{ backgroundColor: c.card, padding: space.lg, gap: space.md, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg }}>
          <Field
            label={panel === 'rename' ? 'New name' : `New place inside ${place.name}`}
            value={text}
            onChangeText={setText}
            autoFocus
            placeholder={panel === 'rename' ? '' : 'e.g. Top drawer'}
            hint={panel === 'add-inside' ? 'Type Drawer 2 > Blue box to add both.' : undefined}
            returnKeyType="done"
            onSubmitEditing={sheetSubmit}
          />
          <ErrorText>{error}</ErrorText>
          <Button
            title={panel === 'rename' ? 'Rename' : 'Add place'}
            busy={busy === 'sheet'}
            disabled={!text.trim()}
            onPress={sheetSubmit}
          />
          <Button kind="plain" title="Cancel" onPress={() => setPanel('')} />
        </View>
      </Modal>

      <PlacePicker
        visible={panel === 'move'}
        title={`Move ${place.name} into…`}
        current={place.parent}
        exclude={place.id}
        noneLabel="Top level (not inside anything)"
        onClose={() => setPanel('')}
        onPick={(parent) => {
          setPanel('');
          if (parent !== place.parent) act('move', () => data.updatePlace(id, { parent }));
        }}
      />
    </>
  );
}
