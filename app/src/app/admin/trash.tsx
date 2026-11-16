import { ScrollView } from 'react-native';

import { ConfirmBox, Loading, Row, SmallButton, useAction, useAdminApi, useConfirm, useLoad } from '@/components/admin';
import { space } from '@/components/theme';
import { Body, Card, Empty, ErrorText, Notice } from '@/components/ui';
import { useData } from '@/lib/data';
import { timeAgo } from '@/lib/time';

export default function Trash() {
  const { api } = useAdminApi();
  const data = useData();
  const bin = useLoad(() => api.trash(), [api]);
  const a = useAction();
  const confirm = useConfirm();

  if (!bin.data) return bin.error ? <ErrorText>{bin.error}</ErrorText> : <Loading />;
  const { items, days } = bin.data;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <Body muted>{`Deleted items and places stay here for ${days} days. Restoring brings back the same item or place, so its labels work again.`}</Body>
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
      {items.length === 0 ? (
        <Empty icon="delete-empty-outline" title="The recycle bin is empty" />
      ) : (
        <Card>
          {items.map((t) => (
            <Row
              key={t.id}
              title={t.name}
              badge={t.kind === 'place' ? 'Place' : undefined}
              subtitle={[t.place ? `was in ${t.place}` : '', t.photo ? 'with photo' : '', `deleted ${timeAgo(t.created)}`, t.by ? `by ${t.by}` : '']
                .filter(Boolean)
                .join(' · ')}
            >
              {confirm.ask?.key === t.id ? (
                <ConfirmBox text={confirm.ask.text} yes={confirm.ask.yes} busy={!!a.busy} onNo={confirm.clear} onYes={confirm.ask.run} />
              ) : (
                <>
                  <SmallButton
                    title="Restore"
                    busy={a.busy === 'restore' + t.id}
                    onPress={async () => {
                      if (await a.run('restore' + t.id, () => api.restore(t.id), `${t.name} is back.`)) {
                        await Promise.all([bin.reload(), data.reload()]);
                      }
                    }}
                  />
                  <SmallButton
                    title="Delete forever"
                    danger
                    onPress={() =>
                      confirm.setAsk({
                        key: t.id,
                        text: `Delete ${t.name} for good? This can't be undone.`,
                        yes: 'Delete forever',
                        run: async () => {
                          if (await a.run('delete' + t.id, () => api.deleteForever(t.id))) await bin.reload();
                          confirm.clear();
                        },
                      })
                    }
                  />
                </>
              )}
            </Row>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}
