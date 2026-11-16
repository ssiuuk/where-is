import { useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { ConfirmBox, Loading, Row, SmallButton, useAction, useAdminApi, useConfirm, useLoad } from '@/components/admin';
import { font, space, useColors } from '@/components/theme';
import { Body, Card, ErrorText, Field, Notice } from '@/components/ui';
import { useSession } from '@/lib/session';
import { timeAgo } from '@/lib/time';

export default function Accounts() {
  const c = useColors();
  const s = useSession();
  const { api } = useAdminApi();
  const list = useLoad(() => api.accounts(), [api]);
  const site = useLoad(() => api.site(), [api]);
  const a = useAction();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [password, setPassword] = useState<{ who: string; password: string } | null>(null);

  if (!list.data) return list.error ? <ErrorText>{list.error}</ErrorText> : <Loading />;
  const q = search.trim().toLowerCase();
  const shown = list.data.filter((u) => !q || `${u.name} ${u.email} ${u.household}`.toLowerCase().includes(q));
  const mail = !!site.data?.mail.enabled;

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <Body muted>{`${list.data.length} accounts on this server. Site admins (from .env) can't be changed here.`}</Body>
      <Field value={search} onChangeText={setSearch} placeholder="Search by name, email or household" autoCapitalize="none" />
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}
      {password ? (
        <Card>
          <Body>{`New password for ${password.who}:`}</Body>
          <Text selectable style={{ color: c.text, fontSize: 24, fontFamily: 'monospace', fontWeight: '700' }}>
            {password.password}
          </Text>
          <Body muted>Pass it on privately. They're signed out everywhere and can change it in Settings after signing in.</Body>
          <SmallButton title="Done" onPress={() => setPassword(null)} />
        </Card>
      ) : null}
      <Card>
        {shown.map((u) => {
          const who = u.name || u.email;
          const me = u.id === s.user?.id;
          const locked = me || u.site_admin;
          const badges = [u.site_admin ? 'Site admin' : '', u.family_admin ? 'Family admin' : '', u.disabled ? 'Turned off' : ''].filter(Boolean).join(' · ');
          return (
            <Row
              key={u.id}
              title={who + (me ? ' (you)' : '')}
              badge={badges || undefined}
              subtitle={[
                u.name ? u.email : '',
                u.household || 'no household',
                u.google ? 'Google' : 'Email and password',
                u.verified ? '' : 'email not confirmed',
                u.last_active ? `active ${timeAgo(u.last_active)}` : 'never active',
                `joined ${timeAgo(u.created)}`,
              ]
                .filter(Boolean)
                .join(' · ')}
            >
              {confirm.ask?.key.endsWith(u.id) ? (
                <ConfirmBox text={confirm.ask.text} yes={confirm.ask.yes} busy={!!a.busy} onNo={confirm.clear} onYes={confirm.ask.run} />
              ) : (
                <>
                  <SmallButton
                    title="Send password reset"
                    disabled={!mail || !u.email}
                    busy={a.busy === 'reset' + u.id}
                    onPress={() => a.run('reset' + u.id, () => api.siteResetEmail(u.id), `Reset email sent to ${u.email}.`)}
                  />
                  {locked ? null : (
                    <>
                      <SmallButton
                        title="Set new password"
                        onPress={() =>
                          confirm.setAsk({
                            key: 'pw' + u.id,
                            text: `Give ${who} a new password? It signs them out everywhere; you pass the new one on.`,
                            yes: 'Make one',
                            run: async () => {
                              await a.run('pw' + u.id, async () => setPassword({ who, password: (await api.newPassword(u.id)).password }));
                              confirm.clear();
                            },
                          })
                        }
                      />
                      <SmallButton
                        title={u.disabled ? 'Turn on' : 'Turn off'}
                        busy={a.busy === 'dis' + u.id}
                        onPress={() =>
                          u.disabled
                            ? a.run('dis' + u.id, async () => {
                                await api.setDisabled(u.id, false);
                                await list.reload();
                              })
                            : confirm.setAsk({
                                key: 'dis' + u.id,
                                text: `Turn off ${who}? They're signed out and can't sign in until you turn them back on. Nothing they added is lost.${u.family_admin ? ' Family admin passes to another member.' : ''}`,
                                yes: 'Turn off',
                                run: async () => {
                                  await a.run('dis' + u.id, async () => {
                                    await api.setDisabled(u.id, true);
                                    await list.reload();
                                  });
                                  confirm.clear();
                                },
                              })
                        }
                      />
                      <SmallButton
                        title="Delete"
                        danger
                        onPress={() =>
                          confirm.setAsk({
                            key: 'del' + u.id,
                            text: `Delete ${who}'s account for good? Their household and items stay. This can't be undone.`,
                            yes: 'Delete account',
                            run: async () => {
                              await a.run('del' + u.id, async () => {
                                await api.deleteAccount(u.id);
                                await list.reload();
                              }, `${who}'s account was deleted.`);
                              confirm.clear();
                            },
                          })
                        }
                      />
                    </>
                  )}
                </>
              )}
            </Row>
          );
        })}
        {!mail ? <Text style={{ color: c.muted, fontSize: font.small }}>Password reset emails need email set up in Server settings.</Text> : null}
      </Card>
    </ScrollView>
  );
}
