import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { Loading, ToggleRow, useAction, useAdminApi, useLoad } from '@/components/admin';
import { font, space, useColors } from '@/components/theme';
import { Body, Button, Card, ErrorText, Field, Heading, Notice } from '@/components/ui';
import type { MailSettings } from '@/lib/admin';
import { useSession } from '@/lib/session';

type MailForm = Omit<MailSettings, 'hasPassword' | 'locked' | 'port'> & { port: string; password: string };

export default function ServerSettings() {
  const c = useColors();
  const { user } = useSession();
  const { api } = useAdminApi();
  const site = useLoad(() => api.site(), [api]);
  const a = useAction();
  const [mail, setMail] = useState<MailForm | null>(null);
  const [testTo, setTestTo] = useState('');
  const [google, setGoogle] = useState({ clientId: '', clientSecret: '' });
  const [check, setCheck] = useState<{ ok: boolean; problems: string[] } | null>(null);

  useEffect(() => {
    const m = site.data?.mail;
    if (m && !mail) setMail({ enabled: m.enabled, host: m.host, port: String(m.port || 587), username: m.username, tls: m.tls, fromAddress: m.fromAddress, fromName: m.fromName, password: '' });
    if (site.data && !google.clientId) setGoogle((g) => ({ ...g, clientId: site.data!.google.clientId }));
  }, [site.data, mail, google.clientId]);

  if (!site.data || !mail) return site.error ? <ErrorText>{site.error}</ErrorText> : <Loading />;
  const s = site.data;
  const m = s.mail;
  const g = s.google;
  const setM = (patch: Partial<MailForm>) => setMail({ ...mail, ...patch });

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <ErrorText>{a.error}</ErrorText>
      {a.done ? <Notice icon="check-circle-outline">{a.done}</Notice> : null}

      <Card>
        <Heading>New accounts</Heading>
        <ToggleRow
          title="Allow sign-up"
          subtitle={s.signup.locked ? 'Set by ALLOW_SIGNUP in .env. Remove it there to use this switch.' : 'Turn off once your family has accounts. Existing accounts still sign in.'}
          value={s.signup.open}
          disabled={s.signup.locked || !!a.busy}
          onChange={(open) =>
            a.run('signup', async () => {
              await api.setSignup(open);
              await site.reload();
            })
          }
        />
      </Card>

      <Card>
        <Heading>Email</Heading>
        <Body muted>Used for “Forgot password?” emails, password resets you send, and email confirmation.</Body>
        {m.locked ? <Notice>Set by SMTP_HOST in .env, so it can't be changed here. You can still send a test email.</Notice> : null}
        <ToggleRow title="Send emails" value={mail.enabled} disabled={m.locked} onChange={(enabled) => setM({ enabled })} />
        <Field label="Mail server" value={mail.host} onChangeText={(host) => setM({ host })} editable={!m.locked} placeholder="smtp.example.com" autoCapitalize="none" autoCorrect={false} />
        <Field label="Port" value={mail.port} onChangeText={(port) => setM({ port: port.replace(/\D/g, '') })} editable={!m.locked} keyboardType="number-pad" hint="587 uses STARTTLS; 465 uses TLS from the start" />
        <ToggleRow title="TLS from the start" subtitle="Usually on for port 465" value={mail.tls} disabled={m.locked} onChange={(tls) => setM({ tls })} />
        <Field label="Username" value={mail.username} onChangeText={(username) => setM({ username })} editable={!m.locked} autoCapitalize="none" autoCorrect={false} />
        <Field
          label="Password"
          value={mail.password}
          onChangeText={(password) => setM({ password })}
          editable={!m.locked}
          secureTextEntry
          placeholder={m.hasPassword ? 'Saved (leave empty to keep it)' : ''}
        />
        <Field label="From address" value={mail.fromAddress} onChangeText={(fromAddress) => setM({ fromAddress })} editable={!m.locked} placeholder="whereis@example.com" autoCapitalize="none" keyboardType="email-address" />
        <Field label="From name" value={mail.fromName} onChangeText={(fromName) => setM({ fromName })} editable={!m.locked} placeholder="Where Is" />
        {!m.locked ? (
          <Button
            title="Save email settings"
            busy={a.busy === 'mail'}
            onPress={() =>
              a.run(
                'mail',
                async () => {
                  await api.setMail({ ...mail, port: Number(mail.port) || 587, password: mail.password || undefined });
                  setM({ password: '' });
                  await site.reload();
                },
                'Email settings saved. Send a test to check them.',
              )
            }
          />
        ) : null}
        <Field label="Send a test to" value={testTo} onChangeText={setTestTo} placeholder={user?.email} autoCapitalize="none" keyboardType="email-address" />
        <Button
          kind="secondary"
          icon="email-fast-outline"
          title="Send test email"
          disabled={!m.enabled}
          busy={a.busy === 'test'}
          onPress={() => a.run('test', async () => a.setDone(`Test email sent to ${(await api.testMail(testTo)).to}. Check the inbox (and spam).`))}
        />
      </Card>

      <Card>
        <Heading>Google sign-in</Heading>
        <ToggleRow
          title="Allow Google sign-in"
          subtitle={g.enabled ? 'On' : g.configured ? 'Off' : 'Needs a client ID and secret'}
          value={g.enabled}
          disabled={!!a.busy}
          onChange={(enabled) =>
            a.run('google', async () => {
              await api.setGoogle({ enabled });
              setCheck(null);
              await site.reload();
            })
          }
        />
        {g.locked ? (
          <Notice>The client ID and secret are set in .env (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).</Notice>
        ) : (
          <>
            <Field label="Client ID" value={google.clientId} onChangeText={(clientId) => setGoogle({ ...google, clientId })} autoCapitalize="none" autoCorrect={false} placeholder="….apps.googleusercontent.com" />
            <Field
              label="Client secret"
              value={google.clientSecret}
              onChangeText={(clientSecret) => setGoogle({ ...google, clientSecret })}
              secureTextEntry
              placeholder={g.configured ? 'Saved (leave empty to keep it)' : ''}
            />
            <Button
              kind="secondary"
              title="Save and turn on"
              busy={a.busy === 'googleKeys'}
              disabled={!google.clientId.trim() || (!g.configured && !google.clientSecret.trim())}
              onPress={() =>
                a.run(
                  'googleKeys',
                  async () => {
                    await api.setGoogle({ enabled: true, clientId: google.clientId.trim(), clientSecret: google.clientSecret.trim() || undefined });
                    setGoogle({ ...google, clientSecret: '' });
                    setCheck(null);
                    await site.reload();
                  },
                  'Google sign-in saved and turned on. Check it below.',
                )
              }
            />
          </>
        )}
        {g.redirectUrl ? (
          <Text selectable style={{ color: c.muted, fontSize: font.small }}>{`Authorized redirect URI in Google Cloud console:\n${g.redirectUrl}`}</Text>
        ) : (
          <Notice>The server doesn't know its public address yet. Set PUBLIC_URL in .env so Google can send people back.</Notice>
        )}
        <Button kind="secondary" icon="stethoscope" title="Check with Google" busy={a.busy === 'check'} disabled={!g.configured} onPress={() => a.run('check', async () => setCheck(await api.checkGoogle()))} />
        {check ? (
          check.ok ? (
            <Notice icon="check-circle-outline">Google accepts the client ID and secret, and sign-in is on.</Notice>
          ) : (
            <ErrorText>{check.problems.join('\n')}</ErrorText>
          )
        ) : null}
      </Card>

      <Card>
        <Heading>Site admins</Heading>
        <Body muted>{`Set by ADMIN_EMAILS in .env: ${s.admins.join(', ') || 'none'}. The email must be confirmed (or used with Google sign-in).`}</Body>
      </Card>
    </ScrollView>
  );
}
