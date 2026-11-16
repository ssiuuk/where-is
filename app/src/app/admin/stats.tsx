import { router } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Loading, Stat, useAdminApi, useLoad } from '@/components/admin';
import { font, space, useColors } from '@/components/theme';
import { Body, Card, ErrorText, Heading } from '@/components/ui';
import { formatBytes } from '@/lib/admin';
import { timeAgo } from '@/lib/time';

export default function Stats() {
  const c = useColors();
  const { api } = useAdminApi();
  const st = useLoad(() => api.stats(), [api]);
  if (!st.data) return st.error ? <ErrorText>{st.error}</ErrorText> : <Loading />;
  const s = st.data;
  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        <Stat label="items" value={s.items} />
        <Stat label="places" value={s.places} />
        <Stat label="members" value={s.members} />
        <Stat label="photo storage" value={formatBytes(s.photoBytes)} />
        <Stat label="items with a photo" value={s.withPhoto} />
        <Stat label="items with no place" value={s.noPlace} />
        <Stat label="places without a label" value={s.unlabeled} />
        <Stat label="changes this week" value={s.changesThisWeek} />
        <Stat label="in the recycle bin" value={s.trash} />
      </View>
      <Card>
        <Heading>{`Not moved for over a year (${s.staleTotal})`}</Heading>
        {s.stale.length === 0 ? <Body muted>Nothing: everything has been touched in the last year.</Body> : null}
        {s.stale.map((i) => (
          <Pressable key={i.id} onPress={() => router.push(`/i/${i.id}`)} style={{ paddingVertical: 4 }}>
            <Text style={{ color: c.text, fontSize: font.body }}>{i.name}</Text>
            <Text style={{ color: c.muted, fontSize: font.small }}>{[i.place || 'no place', `since ${timeAgo(i.since)}`].join(' · ')}</Text>
          </Pressable>
        ))}
        {s.staleTotal > s.stale.length ? <Body muted>{`…and ${s.staleTotal - s.stale.length} more.`}</Body> : null}
      </Card>
    </ScrollView>
  );
}
