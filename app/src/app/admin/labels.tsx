import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Segmented, useAction } from '@/components/admin';
import { font, space, useColors } from '@/components/theme';
import { Body, Button, ErrorText, Icon, Notice } from '@/components/ui';
import { printLabels } from '@/lib/admin';
import { useData } from '@/lib/data';
import { tagUrl } from '@/lib/links';
import { placeTree } from '@/lib/places';
import { useSession } from '@/lib/session';
import { timeAgo } from '@/lib/time';

type Filter = 'unlabeled' | 'all';

export default function BulkLabels() {
  const c = useColors();
  const { serverUrl } = useSession();
  const data = useData();
  const a = useAction();
  const [filter, setFilter] = useState<Filter>('unlabeled');
  const [size, setSize] = useState<'small' | 'large'>('small');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const rows = useMemo(() => placeTree(data.places), [data.places]);
  const isLabeled = (id: string) => {
    const p = data.map.get(id);
    return !!(p?.label_at || p?.nfc_at);
  };
  const unlabeledCount = data.places.filter((p) => !p.label_at && !p.nfc_at).length;
  const shown = filter === 'all' ? rows : rows.filter((r) => !isLabeled(r.place.id));

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownPicked = shown.length > 0 && shown.every((r) => picked.has(r.place.id));

  const print = async () => {
    const ids = rows.map((r) => r.place.id).filter((id) => picked.has(id));
    const ok = await a.run('print', () =>
      printLabels(
        ids.map((id) => ({ url: tagUrl(serverUrl, 'p', id), name: data.map.get(id)?.name ?? '', path: data.label(data.map.get(id)?.parent ?? '') })),
        size,
      ),
    );
    if (ok) {
      await data.markLabeled(ids, 'label');
      a.setDone(`Sent ${ids.length} label${ids.length === 1 ? '' : 's'} to print. They're now marked as labeled.`);
      setPicked(new Set());
    }
  };

  return (
    <FlatList
      data={shown}
      keyExtractor={(r) => r.place.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      ListHeaderComponent={
        <View style={{ gap: space.md, marginBottom: space.sm }}>
          <Body muted>
            {`${unlabeledCount} of ${data.places.length} places have no QR label or NFC sticker yet. Pick places, then print a sheet of labels (or save it as a PDF from the print dialog).`}
          </Body>
          <Segmented
            options={[
              { value: 'unlabeled', label: `Without a label (${unlabeledCount})` },
              { value: 'all', label: `All (${data.places.length})` },
            ]}
            value={filter}
            onChange={setFilter}
          />
          <Segmented
            options={[
              { value: 'small', label: 'Small labels' },
              { value: 'large', label: 'Large labels' },
            ]}
            value={size}
            onChange={setSize}
          />
          <ErrorText>{a.error}</ErrorText>
          {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button
              kind="secondary"
              style={{ flex: 1 }}
              title={allShownPicked ? 'Pick none' : 'Pick all shown'}
              onPress={() => setPicked(allShownPicked ? new Set() : new Set(shown.map((r) => r.place.id)))}
              disabled={!shown.length}
            />
            <Button style={{ flex: 1 }} icon="printer-outline" title={`Print ${picked.size || ''}`.trim()} disabled={!picked.size} busy={a.busy === 'print'} onPress={print} />
          </View>
        </View>
      }
      ListEmptyComponent={<Body muted>{filter === 'unlabeled' ? 'Every place has a label or sticker.' : 'No places yet.'}</Body>}
      renderItem={({ item: { place, depth } }) => {
        const on = picked.has(place.id);
        const when = place.nfc_at && (!place.label_at || place.nfc_at > place.label_at) ? `sticker ${timeAgo(place.nfc_at)}` : place.label_at ? `label ${timeAgo(place.label_at)}` : '';
        return (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            onPress={() => toggle(place.id)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingLeft: depth * 18, paddingVertical: 6 }}
          >
            <Icon name={on ? 'checkbox-marked' : 'checkbox-blank-outline'} color={on ? c.accent : c.muted} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: font.body }}>{place.name}</Text>
              {when ? <Text style={{ color: c.muted, fontSize: font.small }}>{when}</Text> : null}
            </View>
          </Pressable>
        );
      }}
    />
  );
}
