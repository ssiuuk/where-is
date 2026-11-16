import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import { Loading, useAdminApi } from '@/components/admin';
import { font, space, useColors } from '@/components/theme';
import { Button, Empty, ErrorText, Icon, IconName } from '@/components/ui';
import type { Activity } from '@/lib/admin';
import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { timeAgo } from '@/lib/time';

const icons: Record<string, IconName> = {
  added: 'plus-circle-outline',
  moved: 'arrow-right-bold-circle-outline',
  renamed: 'pencil-outline',
  edited: 'pencil-outline',
  deleted: 'delete-outline',
  restored: 'delete-restore',
  merged: 'call-merge',
  imported: 'file-upload-outline',
  removed: 'account-remove-outline',
  'handed over': 'account-switch-outline',
};

export default function ActivityLog() {
  const c = useColors();
  const { api } = useAdminApi();
  const data = useData();
  const [rows, setRows] = useState<Activity[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    async (next: number) => {
      setBusy(true);
      try {
        const r = await api.activity(next);
        setRows((prev) => (next === 1 ? r.items : [...prev, ...r.items]));
        setPage(next);
        setMore(r.more);
        setError('');
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );
  useEffect(() => {
    load(1);
  }, [load]);

  if (page === 0) return error ? <ErrorText>{error}</ErrorText> : <Loading />;

  const open = (a: Activity) => {
    if (a.kind === 'item' && data.items.some((i) => i.id === a.record)) router.push(`/i/${a.record}`);
    else if (a.kind === 'place' && data.places.some((p) => p.id === a.record)) router.push(`/p/${a.record}`);
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(a) => a.id}
      contentContainerStyle={{ padding: space.lg, gap: space.sm }}
      ListEmptyComponent={<Empty icon="history" title="Nothing yet">Changes show here from now on.</Empty>}
      ListFooterComponent={
        <View style={{ gap: space.sm }}>
          <ErrorText>{error}</ErrorText>
          {more && rows.length ? <Button kind="plain" title="Show older" busy={busy} onPress={() => load(page + 1)} /> : null}
        </View>
      }
      renderItem={({ item: a }) => {
        const what = a.kind === 'items' || a.kind === 'places' ? a.kind : a.kind === 'member' ? '' : a.kind;
        const line = [a.by || 'Someone', a.action, what === 'item' || what === 'place' ? '' : what, a.name].filter(Boolean).join(' ');
        return (
          <Pressable onPress={() => open(a)} style={{ flexDirection: 'row', gap: space.md, paddingVertical: 4 }}>
            <Icon name={icons[a.action] ?? 'circle-small'} color={a.action === 'deleted' ? c.danger : c.accent} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: c.text, fontSize: font.body }}>{line}</Text>
              <Text style={{ color: c.muted, fontSize: font.small }}>{[a.detail, timeAgo(a.created)].filter(Boolean).join(' · ')}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
