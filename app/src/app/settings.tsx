import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, Text, View } from 'react-native';

import { font, space, useColors } from '@/components/theme';
import { Body, Button, Card, ConfirmRow, ErrorText, Field, Heading } from '@/components/ui';
import { errorMessage } from '@/lib/client';
import { useData } from '@/lib/data';
import { PasswordChangedError, useMember } from '@/lib/session';

export default function Settings() {
  const c = useColors();
  const s = useMember();
  const { members } = useData();
  const [name, setName] = useState(s.household.name);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'' | 'code' | 'leave'>('');
  const [pw, setPw] = useState<null | { current: string; next: string; done: boolean }>(null);
  const [pwError, setPwError] = useState('');

  const act = async (what: string, fn: () => Promise<unknown>) => {
    setBusy(what);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
      setConfirm('');
    }
  };

  const inviteText =
    `Join our household "${s.household.name}" on Where Is.\n` +
    `1. Open ${s.serverUrl} in a browser, or install the Android app: https://github.com/ssiuuk/where-is/releases/tag/android-latest\n` +
    `2. Server: ${s.serverUrl}\n` +
    `3. Invite code: ${s.household.invite_code}`;
  const [showInvite, setShowInvite] = useState(false);
  const invite = async () => {
    try {
      await Share.share({ message: inviteText });
    } catch {
      // browsers without a share sheet: show the text to copy instead
      setShowInvite(true);
    }
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.md }} keyboardShouldPersistTaps="handled">
      <ErrorText>{error}</ErrorText>
      <Card>
        <Heading>Household</Heading>
        <Field value={name} onChangeText={setName} accessibilityLabel="Household name" />
        {name.trim() && name.trim() !== s.household.name ? (
          <Button title="Save name" busy={busy === 'name'} onPress={() => act('name', () => s.renameHousehold(name))} />
        ) : null}
        <Heading>Invite your family</Heading>
        <Text selectable style={{ color: c.text, fontSize: 28, fontFamily: 'monospace', fontWeight: '700', letterSpacing: 2 }}>
          {s.household.invite_code || '—'}
        </Text>
        <Body muted>Anyone with this code and the server address can join and see everything in the household.</Body>
        <Button icon="share-variant-outline" title="Send invite" onPress={invite} disabled={!s.household.invite_code} />
        {showInvite ? (
          <Text selectable style={{ color: c.text, fontSize: font.small }}>
            {inviteText}
          </Text>
        ) : null}
        {confirm === 'code' ? (
          <ConfirmRow
            ask="Make a new code? The current one stops working. People already in the household stay in."
            busy={busy === 'code'}
            onCancel={() => setConfirm('')}
            onConfirm={() => act('code', s.newInviteCode)}
          />
        ) : (
          <Button kind="plain" title="Make a new code" onPress={() => setConfirm('code')} />
        )}
      </Card>

      <Card>
        <Heading>{`Members (${members.length})`}</Heading>
        {s.household.owner ? <Body muted>{`Family admin: ${s.household.owner === s.user.id ? 'you' : members.find((m) => m.id === s.household.owner)?.name || members.find((m) => m.id === s.household.owner)?.email || 'someone'}`}</Body> : null}
        {members.map((m) => (
          <View key={m.id}>
            <Text style={{ color: c.text, fontSize: font.body }}>
              {(m.name || m.email || 'Someone') + (m.id === s.user.id ? ' (you)' : '')}
            </Text>
          </View>
        ))}
      </Card>

      {s.roles.family || s.roles.site || s.roles.siteNeedsVerify ? (
        <Card>
          <Heading>Admin</Heading>
          <Body muted>
            {[s.roles.family ? 'You are the family admin of this household.' : '', s.roles.site ? 'You are a site admin of this server.' : '']
              .filter(Boolean)
              .join(' ') || 'Your email is listed as a site admin; confirm it to get the server tools.'}
          </Body>
          <Button kind="secondary" icon="shield-account-outline" title="Open admin tools" onPress={() => router.push('/admin')} />
        </Card>
      ) : null}

      <Card>
        <Heading>You</Heading>
        <Body>{s.user.name || s.user.email}</Body>
        {s.user.email ? <Body muted>{s.user.email}</Body> : null}
        {pw && !pw.done ? (
          <View style={{ gap: space.sm }}>
            <Field
              label="Current password"
              value={pw.current}
              onChangeText={(current) => setPw({ ...pw, current })}
              secureTextEntry
              autoComplete="current-password"
              hint="Signed up with Google? Sign out, then use “Forgot password?” to set one."
            />
            <Field
              label="New password"
              value={pw.next}
              onChangeText={(next) => setPw({ ...pw, next })}
              secureTextEntry
              autoComplete="new-password"
              hint="At least 8 characters. Your other devices will need to sign in again."
            />
            <ErrorText>{pwError}</ErrorText>
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              <Button
                title="Change password"
                style={{ flex: 1 }}
                busy={busy === 'password'}
                disabled={!pw.current || pw.next.length < 8}
                onPress={async () => {
                  setBusy('password');
                  setPwError('');
                  try {
                    await s.changePassword(pw.current, pw.next);
                    setPw({ current: '', next: '', done: true });
                  } catch (e) {
                    // signed out: the sign-in screen takes over and says why
                    if (e instanceof PasswordChangedError) return;
                    const status = (e as { status?: number }).status;
                    setPwError(status === 400 ? 'The current password is wrong, or the new one is too short.' : errorMessage(e));
                  } finally {
                    setBusy('');
                  }
                }}
              />
              <Button kind="secondary" title="Cancel" style={{ flex: 1 }} onPress={() => setPw(null)} />
            </View>
          </View>
        ) : (
          <>
            {pw?.done ? <Body muted>Password changed.</Body> : null}
            <Button kind="secondary" title="Change password" onPress={() => setPw({ current: '', next: '', done: false })} />
          </>
        )}
        <Button kind="secondary" title="Sign out" onPress={s.signOut} />
        {confirm === 'leave' ? (
          <ConfirmRow
            ask={`Leave ${s.household.name}? You'll need the invite code to come back. Everything stays for the others.`}
            busy={busy === 'leave'}
            onCancel={() => setConfirm('')}
            onConfirm={() => act('leave', s.leaveHousehold)}
          />
        ) : (
          <Button kind="plain" title="Leave household" onPress={() => setConfirm('leave')} />
        )}
      </Card>

      <Text style={{ color: c.muted, fontSize: font.small, textAlign: 'center' }}>
        {`Server ${s.serverUrl} · app ${Constants.expoConfig?.version ?? ''}`}
      </Text>
    </ScrollView>
  );
}
