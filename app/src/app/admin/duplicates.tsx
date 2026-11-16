import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Loading, Segmented, useAction, useAdminApi, useLoad } from '@/components/admin';
import { font, radius, space, useColors } from '@/components/theme';
import { Body, Button, Card, Empty, ErrorText, Icon, Notice } from '@/components/ui';
import type { DupRecord } from '@/lib/admin';
import { useData } from '@/lib/data';
import { timeAgo } from '@/lib/time';

export default function Duplicates() {
  const { api } = useAdminApi();
  const data = useData();
  const dups = useLoad(() => api.duplicates(), [api]);
  const a = useAction();
  const [kind, setKind] = useState<'items' | 'places'>('items');

  if (!dups.data) return dups.error ? <ErrorText>{dups.error}</ErrorText> : <Loading />;
  const groups = dups.data[kind];

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Segmented
        options={[
          { value: 'items', label: `Items (${dups.data.items.length})` },
          { value: 'places', label: `Places (${dups.data.places.length})` },
        ]}
        value={kind}
        onChange={setKind}
      />
      <Body muted>
        {kind === 'items'
          ? 'Items with the same name. Pick the one to keep: the others go to the recycle bin, and their notes, photo and history move to it.'
          : "Places with the same name inside the same place. Pick the one to keep: what's in the others moves into it. QR labels or stickers on the others stop working, so re-label if needed."}
      </Body>
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
      {groups.length === 0 ? <Empty icon="check-all" title="No duplicates found" /> : null}
      {groups.map((g) => (
        <Group
          key={g.map((r) => r.id).join()}
          kind={kind}
          records={g}
          busy={a.busy === g[0].id}
          onMerge={async (keep) => {
            const ok = await a.run(
              g[0].id,
              () => api.merge(kind, keep, g.map((r) => r.id).filter((id) => id !== keep)),
              `Merged into one ${kind === 'items' ? 'item' : 'place'}.`,
            );
            if (ok) await Promise.all([dups.reload(), data.reload()]);
          }}
        />
      ))}
    </ScrollView>
  );
}

function Group({ kind, records, busy, onMerge }: { kind: 'items' | 'places'; records: DupRecord[]; busy: boolean; onMerge: (keep: string) => void }) {
  const c = useColors();
  const [keep, setKeep] = useState(records[0].id);
  return (
    <Card>
      {records.map((r) => {
        const on = r.id === keep;
        const details = [
          kind === 'items' ? r.place || 'no place' : r.place,
          kind === 'places' ? `${r.items ?? 0} item${r.items === 1 ? '' : 's'}` : '',
          r.photo ? 'photo' : '',
          r.note ? `“${r.note.slice(0, 60)}”` : '',
          `changed ${timeAgo(r.updated)}`,
        ].filter(Boolean);
        return (
          <Pressable
            key={r.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            onPress={() => setKeep(r.id)}
            style={{ flexDirection: 'row', gap: space.md, alignItems: 'center', padding: space.sm, borderRadius: radius.md, backgroundColor: on ? c.accentSoft : 'transparent' }}
          >
            <Icon name={on ? 'radiobox-marked' : 'radiobox-blank'} color={on ? c.accent : c.muted} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: font.body, fontWeight: '600' }}>{r.name + (on ? '  (keep)' : '')}</Text>
              <Text style={{ color: c.muted, fontSize: font.small }}>{details.join(' · ')}</Text>
            </View>
          </Pressable>
        );
      })}
      <Button kind="secondary" icon="call-merge" title={`Merge ${records.length} into the one to keep`} busy={busy} onPress={() => onMerge(keep)} />
    </Card>
  );
}
