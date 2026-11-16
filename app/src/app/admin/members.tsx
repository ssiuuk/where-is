import { router } from 'expo-router';
import { ScrollView, Text } from 'react-native';

import { ConfirmBox, Loading, Row, SmallButton, useAction, useAdminApi, useConfirm, useLoad } from '@/components/admin';
import { font, space, useColors } from '@/components/theme';
import { Body, Button, Card, ErrorText, Heading, Notice } from '@/components/ui';
import type { Family } from '@/lib/admin';
import { useSession } from '@/lib/session';
import { timeAgo } from '@/lib/time';

export default function Members() {
  const c = useColors();
  const s = useSession();
  const { api } = useAdminApi();
  const fam = useLoad(() => api.family(), [api]);
  const a = useAction();
  const confirm = useConfirm();

  const apply = (key: string, fn: () => Promise<Family | unknown>, done = '') =>
    a.run(
      key,
      async () => {
        const r = await fn();
        if (r && typeof r === 'object' && 'members' in r) fam.setData(r as Family);
        else await fam.reload();
        await s.refresh(); // the invite code or roles may have changed
      },
      done,
    );

  if (!fam.data) return fam.error ? <ErrorText>{fam.error}</ErrorText> : <Loading />;
  const f = fam.data;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }}>
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
      <Card>
        <Heading>Invite code</Heading>
        <Text selectable style={{ color: f.invites_off ? c.muted : c.text, fontSize: 28, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 2, textDecorationLine: f.invites_off ? 'line-through' : 'none' }}>
          {f.invite_code}
        </Text>
        <Body muted>
          {f.invites_off
            ? 'Invites are off: nobody new can join with a code. People already in stay in.'
            : 'Anyone with this code and the server address can join. Make a new code if it got out; the old one stops working.'}
        </Body>
        <Button kind="secondary" title="Make a new code" busy={a.busy === 'new'} onPress={() => apply('new', () => api.invite('new'), 'New invite code made.')} />
        {f.invites_off ? (
          <Button kind="secondary" title="Turn invites on" busy={a.busy === 'on'} onPress={() => apply('on', () => api.invite('on'))} />
        ) : (
          <Button kind="plain" title="Turn invites off" busy={a.busy === 'off'} onPress={() => apply('off', () => api.invite('off'))} />
        )}
      </Card>

      <Card>
        <Heading>{`Members (${f.members.length})`}</Heading>
        {f.members.map((m) => {
          const who = m.name || m.email;
          const isMe = m.id === s.user?.id;
          return (
            <Row
              key={m.id}
              title={who + (isMe ? ' (you)' : '')}
              badge={m.owner ? 'Family admin' : m.disabled ? 'Turned off' : undefined}
              subtitle={[m.name ? m.email : '', m.google ? 'Google' : 'Email and password', m.last_active ? `active ${timeAgo(m.last_active)}` : 'not active yet']
                .filter(Boolean)
                .join(' · ')}
            >
              {confirm.ask?.key.endsWith(m.id) ? (
                <ConfirmBox text={confirm.ask.text} yes={confirm.ask.yes} busy={!!a.busy} onNo={confirm.clear} onYes={confirm.ask.run} />
              ) : isMe ? null : (
                <>
                  <SmallButton
                    title="Send password reset"
                    disabled={!f.mail}
                    busy={a.busy === 'reset' + m.id}
                    onPress={() => a.run('reset' + m.id, () => api.familyResetEmail(m.id), `Reset email sent to ${m.email}.`)}
                  />
                  <SmallButton
                    title="Make family admin"
                    onPress={() =>
                      confirm.setAsk({
                        key: 'owner' + m.id,
                        text: `Make ${who} the family admin? You'll lose these tools; they can hand it back.`,
                        yes: 'Hand over',
                        run: () => apply('owner' + m.id, () => api.handOver(m.id)).then((ok) => ok && router.replace('/admin')),
                      })
                    }
                  />
                  <SmallButton
                    title="Remove"
                    danger
                    onPress={() =>
                      confirm.setAsk({
                        key: 'remove' + m.id,
                        text: `Remove ${who} from the household? Their account stays; they'd need an invite code to come back. Make a new code if they know it.`,
                        yes: 'Remove',
                        run: () => apply('remove' + m.id, () => api.removeMember(m.id), `${who} was removed.`).then(confirm.clear),
                      })
                    }
                  />
                </>
              )}
            </Row>
          );
        })}
        {!f.mail ? <Text style={{ color: c.muted, fontSize: font.small }}>Password reset emails need email set up on the server (site admin).</Text> : null}
      </Card>
    </ScrollView>
  );
}
