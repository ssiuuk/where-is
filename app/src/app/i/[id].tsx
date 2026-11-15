import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';

import { OpenInApp } from '@/components/OpenInApp';
import { PhotoField } from '@/components/PhotoField';
import { PlacePicker } from '@/components/PlacePicker';
import { font, radius, space, useColors } from '@/components/theme';
import { Body, Button, Card, ConfirmRow, Empty, ErrorText, Field, Heading, Tape } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { Photo, useData } from '@/lib/data';
import { timeAgo } from '@/lib/time';
import type { Move } from '@/lib/types';

export default function ItemScreen() {
  const c = useColors();
  const { id } = useLocalSearchParams<{ id: string }>();
  const data = useData();
  const item = data.items.find((i) => i.id === id);
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [moves, setMoves] = useState<Move[] | null>(null);

  const { history } = data;
  const loadHistory = useCallback(() => {
    if (!id) return;
    history(id).then(setMoves, () => setMoves(null));
  }, [id, history]);

  // refresh the history whenever the item moves (here or on another phone)
  useEffect(loadHistory, [loadHistory, item?.place]);

  if (!item) {
    return (
      <>
        <Stack.Screen options={{ title: 'Not found' }} />
        <Empty icon="help-box-outline" title="This item isn't in your household">
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

  const who = data.memberName(item.moved_by);
  const photo = data.photoUrl(item, '800x0');

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: item.name }} />
      <OpenInApp kind="i" id={item.id} />
      {editing ? (
        <EditItem
          initial={{ name: item.name, note: item.note }}
          photo={photo}
          busy={busy === 'save'}
          onCancel={() => setEditing(false)}
          onSave={async (patch, newPhoto) => {
            if (await act('save', () => data.updateItem(item.id, patch, newPhoto))) setEditing(false);
          }}
          onError={setError}
        />
      ) : (
        <>
          {photo ? (
            <Image source={{ uri: photo }} style={{ width: '100%', aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: c.border }} />
          ) : null}
          <Card>
            <Heading>It's in</Heading>
            <Tape text={data.label(item.place)} empty="No place yet" onPress={() => setPicking(true)} />
            {item.moved_at ? <Body muted>{`Put there ${timeAgo(item.moved_at)}${who ? ` by ${who}` : ''}.`}</Body> : null}
            <Button icon="swap-horizontal" title="I moved it" onPress={() => setPicking(true)} busy={busy === 'move'} />
            <Button
              kind="secondary"
              icon="qrcode-scan"
              title="Move by scanning the new place"
              onPress={() => {
                data.setCarrying(item.id);
                router.push('/scan');
              }}
            />
          </Card>
          {item.note ? (
            <Card>
              <Heading>Note</Heading>
              <Body>{item.note}</Body>
            </Card>
          ) : null}
        </>
      )}
      <ErrorText>{error}</ErrorText>

      <Heading>History</Heading>
      {moves === null ? (
        <Body muted>History isn't available offline.</Body>
      ) : moves.length === 0 ? (
        <Body muted>No moves recorded yet.</Body>
      ) : (
        <View style={{ gap: space.sm }}>
          {moves.map((m) => (
            <View key={m.id} style={{ flexDirection: 'row', gap: space.sm }}>
              <Text style={{ color: c.muted, width: 92, fontSize: font.small }}>{timeAgo(m.created)}</Text>
              <Text style={{ color: c.text, flex: 1, fontSize: font.small }}>
                {`${data.label(m.to_place) || m.to_name || 'No place'}${data.memberName(m.by) ? ` · ${data.memberName(m.by)}` : ''}`}
              </Text>
            </View>
          ))}
        </View>
      )}

      {!editing ? (
        <View style={{ gap: space.sm, marginTop: space.md }}>
          <Button kind="secondary" icon="pencil-outline" title="Edit name, note or photo" onPress={() => setEditing(true)} />
          <Button
            kind="secondary"
            icon="tag-outline"
            title="Label this item"
            onPress={() => router.push({ pathname: '/label', params: { kind: 'i', id: item.id } })}
          />
          {confirmDelete ? (
            <ConfirmRow
              ask={`Delete ${item.name} and its history for everyone in the household?`}
              busy={busy === 'delete'}
              onCancel={() => setConfirmDelete(false)}
              onConfirm={async () => {
                if (await act('delete', () => data.deleteItem(item.id))) router.back();
              }}
            />
          ) : (
            <Button kind="plain" title="Delete item" onPress={() => setConfirmDelete(true)} />
          )}
        </View>
      ) : null}

      <PlacePicker
        visible={picking}
        title={`Where is ${item.name} now?`}
        current={item.place}
        noneLabel="Not sure"
        onPick={(placeId) => {
          setPicking(false);
          if (placeId !== item.place) act('move', () => data.moveItems([item.id], placeId));
        }}
        onClose={() => setPicking(false)}
      />
    </ScrollView>
  );
}

function EditItem({
  initial,
  photo,
  busy,
  onSave,
  onCancel,
  onError,
}: {
  initial: { name: string; note: string };
  photo: string;
  busy: boolean;
  onSave: (patch: { name: string; note: string }, photo: Photo | null | undefined) => void;
  onCancel: () => void;
  onError: (m: string) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [note, setNote] = useState(initial.note);
  // undefined keeps the photo, null removes it, a Photo replaces it
  const [newPhoto, setNewPhoto] = useState<Photo | null | undefined>(undefined);
  const shown = newPhoto === undefined ? photo : newPhoto === null ? '' : newPhoto.uri;
  return (
    <View style={{ gap: space.md }}>
      <Field label="Name" value={name} onChangeText={setName} />
      <Field label="Note" value={note} onChangeText={setNote} multiline />
      <PhotoField shown={shown} onPick={setNewPhoto} onRemove={() => setNewPhoto(null)} onError={onError} />
      <View style={{ flexDirection: 'row', gap: space.sm }}>
        <Button title="Save" onPress={() => onSave({ name, note }, newPhoto)} busy={busy} disabled={!name.trim()} style={{ flex: 1 }} />
        <Button kind="secondary" title="Cancel" onPress={onCancel} style={{ flex: 1 }} />
      </View>
    </View>
  );
}
